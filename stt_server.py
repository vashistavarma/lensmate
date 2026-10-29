"""Offline speech for LensMate, all on the CPU (keeps the GPU free for the VLM).
  POST /transcribe  raw audio bytes (webm/ogg/wav) -> {"text": ..., "seconds": ..., "audio_seconds": ...}   (faster-whisper)
  POST /tts         {"text": "..."} -> audio/wav   (Piper, a local neural voice; optional: needs piper-tts and a voice file)"""
import io, json, os, re, tempfile, threading, time, wave
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from faster_whisper import WhisperModel

MODEL = os.environ.get('WHISPER_MODEL', 'small.en')
PORT = int(os.environ.get('STT_PORT', 3001))
model = WhisperModel(MODEL, device='cpu', compute_type='int8', cpu_threads=8)
stt_lock = threading.Lock()   # one transcription at a time

# Optional local voice for spoken replies. Without it the browser falls back to its built-in voice, which in Chrome is an
# online Google voice (the reply text would leave the computer).
VOICE_PATH = os.environ.get('PIPER_VOICE', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'piper', 'en_US-lessac-medium.onnx'))
voice, tts_lock = None, threading.Lock()
try:
    from piper import PiperVoice
    if os.path.exists(VOICE_PATH): voice = PiperVoice.load(VOICE_PATH)
except Exception as e:
    print('local voice unavailable:', e, flush=True)

def synthesize(text):
    text = re.sub(r'[*_#`>]+', ' ', text)                 # markdown marks would be read out
    text = re.sub(r'\s+', ' ', text).strip()[:800]
    buf = io.BytesIO()
    with tts_lock, wave.open(buf, 'wb') as w: voice.synthesize_wav(text, w)
    return buf.getvalue()

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):  # health check
        self._send(200, {'ok': True, 'model': MODEL, 'tts': voice is not None})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        if n <= 0 or n > 25_000_000: return self._send(400, {'error': 'bad audio size'})
        data = self.rfile.read(n)
        if urlparse(self.path).path == '/tts':
            if voice is None: return self._send(503, {'error': 'no local voice installed'})
            try: text = str(json.loads(data).get('text', ''))
            except Exception: return self._send(400, {'error': 'body must be JSON {"text": ...}'})
            if not text.strip(): return self._send(400, {'error': 'empty text'})
            wav = synthesize(text)
            self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(wav))); self.end_headers(); self.wfile.write(wav)
            return
        # ?hw=a,b,c : taught object names, passed to Whisper as hotwords so it can spell words it has never seen
        hw = parse_qs(urlparse(self.path).query).get('hw', [''])[0]
        hotwords = ', '.join(w.strip() for w in hw.split(',') if w.strip())[:300] or None
        with tempfile.NamedTemporaryFile(suffix='.audio') as f:
            f.write(data); f.flush(); t0 = time.time()
            try:
              with stt_lock:
                # vad_filter drops silence, which stops Whisper from hallucinating text on quiet clips
                segs, info = model.transcribe(f.name, language='en', beam_size=1, vad_filter=True, condition_on_previous_text=False, hotwords=hotwords)
                text = ' '.join(s.text.strip() for s in segs).strip()
            except Exception as e:
                return self._send(422, {'error': f'could not decode audio: {e}'})
        self._send(200, {'text': text, 'seconds': round(time.time() - t0, 2), 'audio_seconds': round(info.duration, 2)})

    def log_message(self, *a): pass

if __name__ == '__main__':
    print(f'LensMate speech ({MODEL} speech-to-text, CPU int8; local voice: {"yes" if voice else "no"}) on http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
