"""End-to-end action test: headless Chrome with a synthetic animated camera (a ball with known motion),
the real app, the real `record for 4 seconds` command, motion analysis, and the vision model.
Usage: .venv/bin/python eval/action_eval.py   (server running; needs websocket-client)"""
import base64, json, subprocess, sys, time, urllib.request
import websocket

CAMERA_JS = r"""(() => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
  window.__sc = { name: 'still', t0: performance.now() };
  setInterval(() => {
    const t = Math.min(4, (performance.now() - window.__sc.t0) / 1000), n = window.__sc.name;
    let bx = 320, by = 180;
    if (n === 'right') bx = 60 + (t / 4) * 520;
    if (n === 'up') by = 320 - (t / 4) * 260;
    if (n === 'wave') bx = 320 + 200 * Math.sin(2 * Math.PI * 0.75 * t);
    x.fillStyle = '#e6e6e0'; x.fillRect(0, 0, 640, 360);
    x.fillStyle = '#2b6cb0'; x.fillRect(40, 260, 90, 60);            // a static object that must NOT count as motion
    x.fillStyle = '#c53030'; x.beginPath(); x.arc(bx, by, 32, 0, 7); x.fill();
  }, 33);
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
})();"""
SCENARIOS = [  # name, accepted words in the answer
    ('right', ['right']), ('up', ['up']),
    ('wave', ['back', 'forth', 'wav', 'side', 'left and right', 'repeat', 'shak', 'oscillat', 'swing']),
    ('still', ['not moving', 'nothing', 'no movement', 'stationary', 'still', 'not move', 'no significant', "isn't moving", 'static']),
]
RECENT = [('right', ['right']), ('wave', ['back', 'forth', 'wav', 'side', 'left and right', 'repeat', 'shak', 'oscillat', 'swing'])]  # via "what am I doing?" (last 4 s of buffer)

chrome = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--remote-debugging-port=9338', '--window-size=1280,720', 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9338/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True)['result'].get('result', {}).get('value')
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAMERA_JS)
    call('Page.navigate', url='http://localhost:3000/'); time.sleep(3)
    js("localStorage.clear()"); call('Page.navigate', url='http://localhost:3000/'); time.sleep(3)
    passed = 0
    for name, words in SCENARIOS:
        js("document.getElementById('newchat').click()"); time.sleep(0.3)
        js("document.getElementById('status').textContent = ''; window.__sc = { name: '%s', t0: performance.now() }; window.lensAsk('record for 4 seconds')" % name)
        t0 = time.time()
        while time.time() - t0 < 60:
            time.sleep(0.5)
            if (js("document.getElementById('status').textContent") or '').startswith('reply in'): break
        ans = js("[...document.querySelectorAll('#log .msg.bot')].pop().textContent") or ''
        link = js("document.querySelector('#log .msg.bot a')?.download || ''")
        ok = any(w in ans.lower() for w in words); passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:<6} {time.time() - t0 - 4:4.1f}s after recording  clip-link={'yes' if link.endswith('.webm') else 'NO'}\n      -> {ans[:170]}")
    for name, words in RECENT:
        js("document.getElementById('newchat').click(); document.getElementById('status').textContent = ''; window.__sc = { name: '%s', t0: performance.now() }" % name)
        time.sleep(4.3); js("window.lensAsk('what am I doing?')"); t0 = time.time()
        while time.time() - t0 < 60:
            time.sleep(0.5)
            if (js("document.getElementById('status').textContent") or '').startswith('reply in'): break
        ans = js("[...document.querySelectorAll('#log .msg.bot')].pop().textContent") or ''
        ok = any(w in ans.lower() for w in words); passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:<6} instant 'what am I doing?' {time.time() - t0:4.1f}s\n      -> {ans[:170]}")
    total = len(SCENARIOS) + len(RECENT)
    print(f'\nACTION EVAL: {passed}/{total}')
    sys.exit(0 if passed == total else 1)
finally:
    chrome.terminate()
