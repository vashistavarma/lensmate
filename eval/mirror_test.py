"""Mirror-view test in a real browser with a synthetic camera: a red ball sits on the TRUE left of the camera frame.
With the mirror on it must appear on the right of the screen, and clicks, labels and motion wording must follow the screen.
Usage: .venv/bin/python eval/mirror_test.py   (server running; needs websocket-client)"""
import json, os, subprocess, sys, time, urllib.request
import websocket

CAMERA_JS = r"""(() => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
  window.__sc = { name: 'left', t0: performance.now() };
  setInterval(() => {
    const t = Math.min(4, (performance.now() - window.__sc.t0) / 1000), n = window.__sc.name;
    let bx = 110, by = 180;                                  // 'left': static ball on the true left
    if (n === 'moveright') bx = 60 + (t / 4) * 520;          // true-right motion
    x.fillStyle = '#e6e6e0'; x.fillRect(0, 0, 640, 360);
    x.fillStyle = '#c53030'; x.beginPath(); x.arc(bx, by, 45, 0, 7); x.fill();
  }, 33);
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
})();"""

chrome = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--remote-debugging-port=9343', '--window-size=1280,720', 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = 0
def check(name, ok, info=''):
    global fails; fails += (not ok); print('PASS' if ok else 'FAIL', name, info)
try:
    for _ in range(30):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9343/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    def load(mirror):
        js("localStorage.clear(); localStorage.setItem('lensmate.mirror','%s')" % ('1' if mirror else '0'))
        call('Page.navigate', url=os.environ.get('LENSMATE_URL', 'http://localhost:3000') + '/'); time.sleep(3.5)
        js("window.__sc = { name: 'left', t0: performance.now() }")
    def wait_reply(prefix):
        for _ in range(80):
            time.sleep(0.5)
            if (js("document.getElementById('status').textContent") or '').startswith(prefix): return
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAMERA_JS)
    call('Emulation.setDeviceMetricsOverride', width=1280, height=720, deviceScaleFactor=1, mobile=False)

    for mirror in (True, False):
        tag = 'mirror ON ' if mirror else 'mirror OFF'
        load(mirror)
        check(f'[{tag}] video flipped only when on', (js("getComputedStyle(document.getElementById('cam')).transform") != 'none') == mirror)
        # click where the ball APPEARS on screen: right side when mirrored, left side when not
        frac = 0.8125 if mirror else 0.1875
        js("window.__body=null; const f=window.fetch; window.fetch=(u,o)=>{ if(String(u).includes('/api/chat')) window.__body=JSON.parse(o.body); return f(u,o); }")
        rect = js("(()=>{const r=document.getElementById('wrap').getBoundingClientRect(); return [r.left,r.top,r.width,r.height]})()")
        cx, cy = rect[0] + rect[2] * frac, rect[1] + rect[3] * 0.5
        call('Input.dispatchMouseEvent', type='mousePressed', x=cx, y=cy, button='left', clickCount=1)
        call('Input.dispatchMouseEvent', type='mouseReleased', x=cx, y=cy, button='left', clickCount=1)
        time.sleep(1.0)
        px = js("""new Promise(res => { const b = window.__body; if (!b || !b.image) return res(null);
            const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
            const g = c.getContext('2d'); g.drawImage(im, 0, 0); res(Array.from(g.getImageData(im.width/2, im.height/2, 1, 1).data)); }; im.src = b.image; })""")
        check(f'[{tag}] click on the ball zooms into the ball (crop centre is red)', bool(px) and px[0] > 150 and px[1] < 90 and px[2] < 90, f'centre pixel {px}')
        wait_reply('reply in')
        # labels: both objects live on the true left, so boxes must be on the screen right when mirrored
        js("document.getElementById('status').textContent=''; window.lensAsk('label everything')"); wait_reply('scan in'); time.sleep(0.6)
        cxs = js("""(() => { const o = document.getElementById('overlay'); const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data; let sx = 0, c = 0;
            for (let y = 0; y < o.height; y += 2) for (let x = 0; x < o.width; x += 2) if (d[(y * o.width + x) * 4 + 3] > 40) { sx += x / o.width; c++; } return c ? sx / c : null; })()""")
        check(f'[{tag}] labels drawn on the {"right" if mirror else "left"} half', cxs is not None and (cxs > 0.5) == mirror, f'mean x {cxs and round(cxs, 2)}')

    load(True)   # motion wording: the ball moves to the TRUE right, which a mirror shows moving LEFT
    js("document.getElementById('newchat').click(); document.getElementById('status').textContent = ''; window.__sc = { name: 'moveright', t0: performance.now() }; window.lensAsk('record for 4 seconds')"); wait_reply('reply in')  # fresh chat: earlier turns would bias the small model
    ans = (js("[...document.querySelectorAll('#log .msg.bot')].pop().textContent") or '').lower()
    import re
    # on a mirror the ball travels from the screen's right side to its left side: accept "to/toward the left", reject "to the right"
    check('[mirror ON ] ball moving to the true right is described as moving left (as on screen)', bool(re.search(r'(to|toward|towards) the left|leftward', ans)) and not re.search(r'(to|toward|towards) the right|rightward', ans), '')
finally:
    chrome.terminate()
print('\nFAILED:', fails); sys.exit(1 if fails else 0)
