"""Stale-label test in a real browser with a synthetic camera: a dark, low-contrast object (like a black battery in front of
a black T-shirt). The label must follow the object while it is there and vanish soon after it leaves or is swapped.
Usage: .venv/bin/python eval/stale_label_test.py   (server running; needs websocket-client)"""
import json, os, subprocess, sys, time, urllib.request
import websocket

BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
CAMERA_JS = r"""(() => {
  const W = 640, H = 360, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  window.__sc = { name: 'present', t0: performance.now() };
  let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H; const b = bg.getContext('2d');   // dark cloth texture, low contrast
  b.fillStyle = '#161616'; b.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { const v = 12 + Math.floor(rnd() * 34); b.fillStyle = `rgb(${v},${v},${v})`; b.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 2 + rnd() * 6); }
  function battery(px, py) {                     // dark body with white lettering and a coloured connector
    x.fillStyle = '#1c1c20'; x.fillRect(px, py, 170, 80); x.fillStyle = '#eee'; x.font = 'bold 34px sans-serif'; x.fillText('2200', px + 14, py + 50);
    x.fillStyle = '#d33'; x.fillRect(px + 170, py + 20, 26, 14); x.fillStyle = '#e8b800'; x.fillRect(px + 170, py + 44, 26, 14);
    x.strokeStyle = '#888'; x.lineWidth = 3; x.strokeRect(px + 3, py + 3, 164, 74);
  }
  function stripes(px, py) { for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? '#c9c93a' : '#2a6fb0'; x.fillRect(px, py + i * 7, 170, 7); } }
  setInterval(() => {
    const t = Math.min(4, (performance.now() - window.__sc.t0) / 1000), n = window.__sc.name;
    x.drawImage(bg, 0, 0);
    const px = 200 + (n === 'moving' ? t * 60 : 0), py = 140;
    if (n === 'present' || n === 'moving') battery(px, py);
    if (n === 'swapped') stripes(200, py);
    x.fillStyle = `rgb(${(performance.now() / 7) % 255},40,40)`; x.fillRect(0, 0, 14, 14);   // a changing pixel block: frames are never identical
  }, 40);
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(25);
})();"""

chrome = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--remote-debugging-port=9370', '--window-size=1280,720', 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = 0
def check(name, ok, info=''):
    global fails; fails += (not ok); print('PASS' if ok else 'FAIL', name, info)
try:
    for _ in range(30):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9370/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAMERA_JS)
    before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
    for _ in range(200):
        time.sleep(0.05)
        if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
    time.sleep(1.0)
    SC = 1204 / 640   # camera pixels -> detection-frame pixels
    def label_on_object():   # label the battery exactly as a detection would, then start tracking
        js("window.__sc.name = 'present'; window.__sc.t0 = performance.now()"); time.sleep(0.6)
        box = [200 * SC, 140 * SC, 396 * SC, 220 * SC]
        js("startTracking([{label: 'battery', box: %s}], grabGray())" % json.dumps(box))
    def alive(): return js("tracks.length")
    def wait_gone(limit=3.0):
        t0 = time.time()
        while time.time() - t0 < limit:
            if alive() == 0: return time.time() - t0
            time.sleep(0.05)
        return None

    label_on_object(); time.sleep(2.5)
    check('label stays while the object is there (2.5 s)', alive() == 1)

    js("window.__sc = { name: 'moving', t0: performance.now() }"); time.sleep(3.2)
    cx = js("(()=>{ const t = tracks[0]; return t ? (t.shown[0] + t.shown[2]) / 2 * LensTracker.SCALE / %f : null })()" % SC)
    check('label still alive and follows the object while it moves', alive() == 1 and cx is not None and abs(cx - (200 + 60 * 3.2 + 98)) < 40, f'centre x {cx and round(cx)} (expected ~{round(200 + 60 * 3.2 + 98)})')

    label_on_object(); time.sleep(1.5)
    js("window.__sc = { name: 'removed', t0: performance.now() }")          # the object leaves; only the dark cloth remains
    g = wait_gone()
    check('object removed -> label disappears within 2 s', g is not None and g < 2.0, f'gone after {g and round(g, 2)} s')

    label_on_object(); time.sleep(1.5)
    js("window.__sc = { name: 'swapped', t0: performance.now() }")          # a different object takes its place
    g = wait_gone()
    check('object swapped for another -> label disappears within 2 s', g is not None and g < 2.0, f'gone after {g and round(g, 2)} s')

    check('label lifetime is 20 s (was 60 s)', js("LABEL_TTL_MS") == 20000, str(js("LABEL_TTL_MS")))
finally:
    chrome.terminate()
print('\nFAILED:', fails); sys.exit(1 if fails else 0)
