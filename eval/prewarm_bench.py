"""Latency of a spoken-style question with and without the frame pre-read, in a real browser with a synthetic camera showing a real photo.
Run: .venv/bin/python eval/prewarm_bench.py   (server running; needs eval/real photos and websocket-client)"""
import base64, csv, io, json, os, random, statistics as st, subprocess, tempfile, time, urllib.request
import websocket
from PIL import Image
BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
REAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'real')
f = [r['image'] for r in csv.DictReader(open(REAL + '/labels.csv'))]
def b64(p, w):
    im = Image.open(p).convert('RGB'); im = im.resize((w, round(im.height * w / im.width))); b = io.BytesIO(); im.save(b, 'JPEG', quality=82); return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
scene = b64(f'{REAL}/{f[5]}', 640)
CAM = """(() => { const c=document.createElement('canvas'); c.width=640; c.height=360; const x=c.getContext('2d'); const img=new Image(); img.src=%s; let n=Math.floor(Math.random()*9999);
  setInterval(()=>{ if(img.complete) x.drawImage(img,0,0,640,360); n++; x.fillStyle='rgb('+(n*37%%255)+','+(n*91%%255)+','+(n*13%%255)+')'; x.fillRect(560+(n%%40),0,40,24); },66);
  navigator.mediaDevices.getUserMedia=async()=>c.captureStream(30); })();""" % json.dumps(scene)
ch = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--user-data-dir=' + tempfile.mkdtemp(), '--remote-debugging-port=9377', '--window-size=1280,720', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9377/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'], max_size=None); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAM)
    def load(prewarm):
        before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
        for _ in range(200):
            time.sleep(0.05)
            if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
        js("localStorage.clear(); localStorage.setItem('lensmate.mirror','0'); localStorage.setItem('lensmate.prewarm','%s'); localStorage.setItem('lensmate.autocheck','0')" % ('1' if prewarm else '0'))
        before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
        for _ in range(200):
            time.sleep(0.05)
            if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
        time.sleep(0.8)
    def trial(prewarm, speak_s):
        load(prewarm)
        js("var q=document.getElementById('q'); q.value='w'; q.dispatchEvent(new Event('input'))")   # the user starts typing / speaking
        time.sleep(speak_s); js("document.getElementById('q').value=''")                              # ... for a couple of seconds, then asks
        js("window.__t=performance.now(); window.__first=null; window.__obs=setInterval(()=>{const b=[...document.querySelectorAll('#log .msg.bot')].pop(); if(b && b.textContent && b.textContent!=='…' && window.__first===null) window.__first=performance.now()-window.__t;},20); window.lensAsk('What is this object?')")
        for _ in range(250):
            time.sleep(0.1)
            if (js("document.getElementById('status').textContent") or '').startswith('reply in'): break
        o = js("[window.__first, performance.now()-window.__t]"); js("clearInterval(window.__obs)"); return o
    print('plain question, no taught objects; the user speaks or types for the given time, then asks; new frame each trial; 4 trials\n')
    for speak_s in (1.5, 3.0):
        for pw in (False, True):
            r = [trial(pw, speak_s) for _ in range(4)]
            print(f"  speaking {speak_s:.1f} s | pre-read {'ON ' if pw else 'OFF'} | first word {st.mean(x[0] for x in r)/1000:4.2f}s [{min(x[0] for x in r)/1000:.2f}-{max(x[0] for x in r)/1000:.2f}]  total {st.mean(x[1] for x in r)/1000:4.2f}s")
finally:
    ch.terminate()
