"""Offline speech-to-text check: synthesise command sentences with Piper, encode them as WebM/Opus
(what the browser's MediaRecorder sends), transcribe through the real /api/stt, report WER + speed.
Usage: .venv/bin/python eval/stt_eval.py /path/to/en_US-lessac-medium.onnx ['mecanum wheel,L298N']
NOTE: synthetic speech is clean and one voice, so this is a best-case check, not a real-world WER."""
import io, json, re, urllib.parse, subprocess, sys, tempfile, time, urllib.request, wave
import av

VOICE = sys.argv[1]
BASE = 'http://localhost:3000'
HOTWORDS = sys.argv[2] if len(sys.argv) > 2 else ''  # e.g. 'mecanum wheel,L298N' (the names you taught)
SENTENCES = [
    'What is this object?', 'Label everything in the view.', 'Find the ultrasonic sensor.',
    'Remember this as a mecanum wheel.', 'This is an L298N motor driver.',
    'Read the text on the box and translate it.', 'Where is the red mug?', 'What do you remember?',
    'Describe the scene for me.', 'Forget everything.',
]
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower().replace('-', ' ')).split()

def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
    return d[len(h)], len(r)

def synth(text):
    out = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    subprocess.run([sys.executable, '-m', 'piper', '-m', VOICE, '-f', out], input=text.encode(), check=True, capture_output=True)
    return out

def to_webm(wav_path):  # same container/codec family as the browser's MediaRecorder output
    out = io.BytesIO()
    with av.open(wav_path) as src, av.open(out, 'w', format='webm') as dst:
        s_in = src.streams.audio[0]
        s_out = dst.add_stream('libopus', rate=48000); s_out.layout = 'mono'
        rs = av.AudioResampler(format='s16', layout='mono', rate=48000)
        for frame in src.decode(s_in):
            for f in rs.resample(frame):
                for pkt in s_out.encode(f): dst.mux(pkt)
        for pkt in s_out.encode(None): dst.mux(pkt)
    return out.getvalue()

errs = words = 0; lat = []; rtf = []
for text in SENTENCES:
    wav = synth(text); audio = to_webm(wav)
    t0 = time.time()
    j = json.load(urllib.request.urlopen(urllib.request.Request(BASE + '/api/stt' + ('?hw=' + urllib.parse.quote(HOTWORDS) if HOTWORDS else ''), audio, {'Content-Type': 'audio/webm'}), timeout=120))
    lat.append(time.time() - t0); rtf.append(j['seconds'] / max(j['audio_seconds'], 0.1))
    e, n = wer(text, j['text']); errs += e; words += n
    print(f"{'OK ' if e == 0 else f'{e}err'}  {text!r:<46} -> {j['text']!r}  ({j['seconds']}s for {j['audio_seconds']}s audio)")
print(f'\nWER {100 * errs / words:.1f}% ({errs} word errors / {words} words)   median latency {sorted(lat)[len(lat)//2]:.2f}s   median real-time factor {sorted(rtf)[len(rtf)//2]:.2f}x')
