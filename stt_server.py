"""Offline speech-to-text for LensMate: faster-whisper on the CPU (keeps the GPU free for the VLM).
POST /transcribe with raw audio bytes (webm/ogg/wav) -> {"text": ..., "seconds": ..., "audio_seconds": ...}"""
import json, os, tempfile, time
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer
from faster_whisper import WhisperModel

MODEL = os.environ.get('WHISPER_MODEL', 'small.en')
PORT = int(os.environ.get('STT_PORT', 3001))
model = WhisperModel(MODEL, device='cpu', compute_type='int8', cpu_threads=8)

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):  # health check
        self._send(200, {'ok': True, 'model': MODEL})

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        if n <= 0 or n > 25_000_000: return self._send(400, {'error': 'bad audio size'})
        data = self.rfile.read(n)
        # ?hw=a,b,c : taught object names, passed to Whisper as hotwords so it can spell words it has never seen
        hw = parse_qs(urlparse(self.path).query).get('hw', [''])[0]
        hotwords = ', '.join(w.strip() for w in hw.split(',') if w.strip())[:300] or None
        with tempfile.NamedTemporaryFile(suffix='.audio') as f:
            f.write(data); f.flush(); t0 = time.time()
            try:
                # vad_filter drops silence, which stops Whisper from hallucinating text on quiet clips
                segs, info = model.transcribe(f.name, language='en', beam_size=1, vad_filter=True, condition_on_previous_text=False, hotwords=hotwords)
                text = ' '.join(s.text.strip() for s in segs).strip()
            except Exception as e:
                return self._send(422, {'error': f'could not decode audio: {e}'})
        self._send(200, {'text': text, 'seconds': round(time.time() - t0, 2), 'audio_seconds': round(info.duration, 2)})

    def log_message(self, *a): pass

if __name__ == '__main__':
    print(f'LensMate STT ({MODEL}, CPU int8) on http://127.0.0.1:{PORT}', flush=True)
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
