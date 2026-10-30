"""Time from sending a question to the first spoken audio (local Piper voice), real browser + real model, synthetic camera.
Usage: .venv/bin/python eval/first_audio_bench.py   (server running; needs websocket-client)"""
import json, os, subprocess, sys, tempfile, time, urllib.request
import websocket
BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
CAM = r"""(() => { const c=document.createElement('canvas'); c.width=640; c.height=360; const x=c.getContext('2d');
  setInterval(()=>{ x.fillStyle='#ececE6'; x.fillRect(0,0,640,360); x.fillStyle='#c53030'; x.fillRect(60,120,110,110); x.fillStyle='#2b6cb0'; x.beginPath(); x.arc(320,180,60,0,7); x.fill(); },50);
  navigator.mediaDevices.getUserMedia=async()=>c.captureStream(25); })();"""
ch = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + tempfile.mkdtemp(), '--remote-debugging-port=9380', '--window-size=1280,720', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9380/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'], max_size=None); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAM)
    for _ in range(2):
        before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
        for _ in range(200):
            time.sleep(0.05)
            if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
    js("localStorage.setItem('lensmate.autocheck','0')"); time.sleep(2)
    res = []
    for q in ['Describe what you see in the picture.', 'What colours are the shapes, and where are they?', 'Is anything in the picture round?']:
        for pre in (False, True):
            js("lensStopSpeaking()"); time.sleep(1.0)
            if pre: js("(()=>{const e=new Event('input'); const q=document.getElementById('q'); q.value='x'; q.dispatchEvent(e); q.value='';})()"); time.sleep(2.5 if pre else 0)
            js("window.__t0=performance.now(); window.__ta=null; window.__iv=setInterval(()=>{ if(window.lensTtsActive() && !window.__ta){ window.__ta=performance.now()-window.__t0; } },10); window.lensAsk(%s)" % json.dumps(q))
            for _ in range(300):
                time.sleep(0.1)
                if js("window.__ta") is not None: break
            v = js("window.__ta"); js("clearInterval(window.__iv)")
            res.append((pre, v)); print(f"{'pre-read' if pre else 'cold    '} {q[:40]:40} first audio: {v/1000:.2f}s" if v else 'no audio')
            for _ in range(300):
                time.sleep(0.1)
                if js("document.getElementById('send').disabled") is False: break
    for pre in (False, True):
        xs = [v for p, v in res if p == pre and v]; print(('pre-read' if pre else 'cold    '), 'median first audio', f'{sorted(xs)[len(xs)//2]/1000:.2f}s' if xs else 'n/a')
finally:
    ch.kill()
