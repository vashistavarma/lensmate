"""Spatial-context test in a real browser: a synthetic scene (red square LEFT, blue circle CENTRE, green triangle RIGHT) is scanned by the
real model, then layout questions must be answered correctly by the measured layout (also in mirrored view), and the layout must be sent
to the model as context. Usage: .venv/bin/python eval/spatial_context_test.py   (server running; needs websocket-client)"""
import json, os, subprocess, sys, tempfile, time, urllib.request
import websocket
BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
CAM = r"""(() => { const c=document.createElement('canvas'); c.width=640; c.height=360; const x=c.getContext('2d'); let n=0;
  setInterval(()=>{ x.fillStyle='#ececE6'; x.fillRect(0,0,640,360);
    x.fillStyle='#c53030'; x.fillRect(60,120,110,110);                                   // red square: left
    x.fillStyle='#2b6cb0'; x.beginPath(); x.arc(320,180,60,0,7); x.fill();               // blue circle: centre
    x.fillStyle='#2f855a'; x.beginPath(); x.moveTo(520,110); x.lineTo(590,240); x.lineTo(450,240); x.fill();   // green triangle: right
    n++; x.fillStyle='rgb('+(n*37%255)+',40,40)'; x.fillRect(0,0,14,14); },50);
  navigator.mediaDevices.getUserMedia=async()=>c.captureStream(25);
  window.__bodies=[]; const F=window.fetch; window.fetch=(u,o)=>{ if(String(u).includes('/api/chat')){ try{ window.__bodies.push(JSON.parse(o.body)) }catch(e){} } return F(u,o); }; })();"""
ch = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--user-data-dir=' + tempfile.mkdtemp(), '--remote-debugging-port=9378', '--window-size=1280,720', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = 0
def check(name, ok, info=''):
    global fails; fails += (not ok); print('PASS' if ok else 'FAIL', name, info)
try:
    for _ in range(40):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9378/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'], max_size=None); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    def load(mirror):
        before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
        for _ in range(200):
            time.sleep(0.05)
            if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
        js("localStorage.clear(); localStorage.setItem('lensmate.mirror','%s'); localStorage.setItem('lensmate.autocheck','0')" % ('1' if mirror else '0'))
        before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
        for _ in range(200):
            time.sleep(0.05)
            if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
        time.sleep(1.0)
    def ask(q, wait=40):
        js("document.getElementById('newchat').click()") if False else None
        t0 = time.time(); k = js("document.querySelectorAll('#log .msg.bot').length")
        js("window.lensAsk(%s)" % json.dumps(q))
        for _ in range(int(wait * 10)):
            time.sleep(0.1)
            if js("document.getElementById('send').disabled") is False and js("document.querySelectorAll('#log .msg.bot').length") > k: break
        time.sleep(0.3)
        return js("[...document.querySelectorAll('#log .msg.bot')].pop().textContent") or '', time.time() - t0
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAM)

    load(False)
    a, t = ask('label everything'); print('   scan says:', a[:90])
    labels = js("tracks.map(t => t.label)"); check('the model labelled the three shapes', len(labels) >= 3, str(labels))
    a, t = ask('What is to the left of the blue circle?'); check('left of the blue circle is the red square (answered by the measured layout)', 'red square' in a.lower() and 'left of the' in a.lower(), f'{a!r} in {t:.1f}s')
    check('...and it needed no model call (instant)', t < 1.5, f'{t:.1f}s')
    a, t = ask('What is to the right of the blue circle?'); check('right of the blue circle is the green triangle', 'triangle' in a.lower() and 'right of' in a.lower(), repr(a))
    a, t = ask('How many objects are there?'); check('counts the labelled objects', a.startswith('I can see 3'), repr(a))
    a, t = ask('Where is the green triangle?'); check('"where is" a labelled object -> position in the picture', 'right' in a.lower() and 'triangle' in a.lower(), repr(a))
    a, t = ask('What is the closest object?'); check('closest object answered', 'looks closest' in a, repr(a))
    js("window.__bodies.length = 0"); a, t = ask('What colour is the circle? One word.')
    ctx = (js("window.__bodies[window.__bodies.length-1] && window.__bodies[window.__bodies.length-1].spatial") or '')
    check('an ordinary question carries the measured layout to the model', 'blue circle' in ctx.lower() and 'Layout of the labelled objects' in ctx, ctx[:110])
    check('...and the model still answers it', 'blue' in a.lower(), repr(a))

    load(True)
    ask('label everything')
    a, t = ask('What is to the left of the blue circle?'); check('MIRRORED view: left of the blue circle is now the green triangle', 'triangle' in a.lower() and 'left of' in a.lower(), repr(a))

    load(False)   # no labels yet: a layout question must scan first, then answer
    a, t = ask('What is to the right of the red square?', 60); check('no labels yet: scans first, then answers from the layout', ('blue circle' in a.lower() or 'circle' in a.lower()) and 'right of' in a.lower(), f'{a!r} in {t:.1f}s')
finally:
    ch.terminate()
print('\nFAILED:', fails); sys.exit(1 if fails else 0)
