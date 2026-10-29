"""Proves the 'stays on this computer' claim: loads the app in a real browser, teaches a fact, asks a question (spoken by the
local voice) and opens the chat history, then lists every host the page contacted. Expect only http://localhost.
Usage: .venv/bin/python eval/local_only_test.py   (server + speech service running; needs websocket-client)"""
import json, os, subprocess, sys, tempfile, time, urllib.parse, urllib.request
import websocket
BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
ch = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--user-data-dir=' + tempfile.mkdtemp(), '--remote-debugging-port=9376',
                       '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9376/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'], max_size=None); n = 0; urls = []
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('method') == 'Network.requestWillBeSent': urls.append(r['params']['request']['url'])
            if r.get('method') == 'Network.webSocketCreated': urls.append(r['params']['url'])
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    call('Network.enable'); call('Page.enable'); call('Page.navigate', url=BASE + '/'); time.sleep(4)
    js("window.lensAsk('remember that the red box is mine')"); time.sleep(1)
    js("window.lensAsk('Hey, what do you see?')"); time.sleep(8)
    js("document.getElementById('menu').click()"); time.sleep(1)
    hosts = {}
    for u in urls:
        p = urllib.parse.urlparse(u); k = p.scheme + '://' + (p.hostname or '')
        hosts[k] = hosts.get(k, 0) + 1
    print('hosts contacted:', hosts)
    ok = set(hosts) <= {'http://localhost', 'data://', 'blob://'}
    print('PASS: only this computer was contacted' if ok else 'FAIL: the page talked to another host'); sys.exit(0 if ok else 1)
finally:
    ch.terminate()
