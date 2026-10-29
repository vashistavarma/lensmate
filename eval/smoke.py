"""30-second pre-flight check before a demo: python3 eval/smoke.py   (server must be running via ./start.sh)"""
import base64, json, os, subprocess, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
b64 = lambda p: 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(HERE, p), 'rb').read()).decode()
def post(path, body): return urllib.request.urlopen(urllib.request.Request(BASE + path, json.dumps(body).encode(), {'Content-Type': 'application/json'}), timeout=180)
results = []
def check(name, fn):
    t = time.time()
    try: ok, info = fn()
    except Exception as e: ok, info = False, f'{type(e).__name__}: {e}'
    results.append(ok); print(f"{'PASS' if ok else 'FAIL'}  {name:<34} {time.time() - t:4.1f}s  {info}")

def health():
    h = json.load(urllib.request.urlopen(BASE + '/api/health', timeout=10))
    return h['vision'], f"vision model {h['model']}: {'ready' if h['vision'] else 'MISSING (ollama pull)'}; offline speech: {'up' if h['speech'] else 'not running (optional)'}"
def chat():
    r = post('/api/chat', dict(messages=[dict(role='user', content='What colour is the circle? One word.')], image=b64('images/colour.jpg')))
    text = ''.join(json.loads(l).get('message', {}).get('content', '') for l in r if l.strip())
    return 'blue' in text.lower(), repr(text.strip()[:40])
def detect():
    j = json.load(post('/api/detect', dict(image=b64('images/shapes.jpg'), query='the red square')))
    b = j['boxes'][0]['box'] if j['boxes'] else None
    return bool(b) and abs(b[0] - 120) < 40 and abs(b[1] - 330) < 40, f'box {b} (expected about [120, 330, 360, 570])'
def tracker():
    r = subprocess.run(['node', os.path.join(HERE, 'test_tracker.js')], capture_output=True, text=True)
    return r.returncode == 0, r.stdout.count('PASS') and f"{r.stdout.count('PASS')} unit tests"
def motion():
    r = subprocess.run(['node', os.path.join(HERE, 'test_motion.js')], capture_output=True, text=True)
    return r.returncode == 0, f"{r.stdout.count('PASS')} unit tests"
check('services health', health); check('vision chat (colour question)', chat)
check('grounding (find the red square)', detect); check('tracker unit tests', tracker); check('motion-analysis unit tests', motion)
print('\nALL GOOD, ready to demo' if all(results) else f'\n{results.count(False)} check(s) FAILED')
sys.exit(0 if all(results) else 1)
