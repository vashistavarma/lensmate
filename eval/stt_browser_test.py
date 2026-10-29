"""Real-browser test of the offline mic: headless Chrome with a fake microphone that plays a WAV file,
push-to-talk via the real voice.js, transcription through the running /api/stt.
Usage: .venv/bin/python eval/stt_browser_test.py clip.wav "expected text"   (needs `pip install websocket-client`)"""
import json, os, shutil, subprocess, sys, time, urllib.request
import websocket
HERE = os.path.dirname(os.path.abspath(__file__)); PAGE = os.path.join(HERE, '..', 'public', '_stt_test.html')
wav, expect = sys.argv[1], sys.argv[2].lower().rstrip('.')
shutil.copy(os.path.join(HERE, 'stt_browser_test.html'), PAGE)
chrome = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--remote-debugging-port=9333', '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream', f'--use-file-for-fake-audio-capture={wav}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl']); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True)['result'].get('result', {}).get('value')
    call('Page.enable'); call('Page.navigate', url='http://localhost:3000/_stt_test.html'); time.sleep(2)
    js("document.getElementById('mic').dispatchEvent(new Event('pointerdown'))"); time.sleep(3.5)
    js("document.getElementById('mic').dispatchEvent(new Event('pointerup'))")
    for _ in range(30):
        time.sleep(0.5); asked = json.loads(js('JSON.stringify(asked)'))
        if asked: break
    got = (asked[0] if asked else '').lower().rstrip('.')
    print('heard:', asked, '| status:', js("document.getElementById('status').textContent"))
    ok = expect in got  # the fake mic loops the clip, so the sentence may be heard more than once
    print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
finally:
    chrome.terminate(); os.path.exists(PAGE) and os.remove(PAGE)
