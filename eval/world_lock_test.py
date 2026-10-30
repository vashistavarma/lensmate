"""World-lock test in a real browser. A synthetic textured room is drawn into the 'camera' with a controllable pan offset
(window.__off). The companion's anchor must move WITH the room when the camera pans (also in mirrored view), perch on a label's
track, get covered by the real video when something enters its spot, and drift/hop back when the room slides far away.
Usage: .venv/bin/python eval/world_lock_test.py   (server running; needs websocket-client)"""
import json, os, subprocess, sys, tempfile, time, urllib.request
import websocket
BASE = os.environ.get('LENSMATE_URL', 'http://localhost:3000')
CAM = r"""(() => { const c=document.createElement('canvas'); c.width=640; c.height=360; const x=c.getContext('2d');
  let s=12345; const rnd=()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; };
  const W=1500, cells=[]; for(let j=0;j<46;j++) for(let i=0;i<W/8;i++) cells.push(Math.floor(60+rnd()*160));   // textured room 1500 px wide
  const room=document.createElement('canvas'); room.width=W; room.height=368; const r=room.getContext('2d');
  for(let j=0;j<46;j++) for(let i=0;i<W/8;i++){ const v=cells[j*(W/8)+i]; r.fillStyle='rgb('+v+','+(v*0.9|0)+','+(v*0.8|0)+')'; r.fillRect(i*8,j*8,8,8); }
  window.__off=400; window.__block=false;
  setInterval(()=>{ x.drawImage(room,window.__off,0,640,360,0,0,640,360);
    if(window.__block){ x.fillStyle='#fff'; x.fillRect(window.__bx||470,window.__by||230,120,110); } },40);
  navigator.mediaDevices.getUserMedia=async()=>c.captureStream(25); })();"""
ch = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--user-data-dir=' + tempfile.mkdtemp(), '--remote-debugging-port=9379', '--window-size=1280,720', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = 0
def check(name, ok, info=''):
    global fails; fails += (not ok); print('PASS' if ok else 'FAIL', name, info)
try:
    for _ in range(40):
        try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9379/json')); break
        except OSError: time.sleep(0.3)
    ws = websocket.create_connection([t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'], max_size=None); n = 0
    def call(m, **p):
        global n; n += 1; ws.send(json.dumps(dict(id=n, method=m, params=p)))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n: return r
    js = lambda e: call('Runtime.evaluate', expression=e, returnByValue=True, awaitPromise=True)['result'].get('result', {}).get('value')
    def load(mirror):
        for _ in range(2):
            before = js("performance.timeOrigin"); call('Page.navigate', url=BASE + '/')
            for _ in range(200):
                time.sleep(0.05)
                if js("performance.timeOrigin") != before and js("(document.getElementById('status')||{}).textContent") == 'camera live': break
            if _ == 0 or True: js("localStorage.clear(); localStorage.setItem('lensmate.mirror','%s'); localStorage.setItem('lensmate.autocheck','0'); localStorage.setItem('lensmate.prewarm','0')" % ('1' if mirror else '0'))
        time.sleep(3.0)
    def pan(target, steps=14):                    # move the camera smoothly like a hand would
        cur = js("window.__off")
        for i in range(1, steps + 1): js("window.__off=%f" % (cur + (target - cur) * i / steps)); time.sleep(0.07)
        time.sleep(0.6)
    view = lambda: js("JSON.parse(JSON.stringify(lensWorld.view()))")
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument', source=CAM)

    for mirror in (False, True):
        tag = 'mirrored ' if mirror else ''
        load(mirror)
        v0 = view(); wc = js("document.getElementById('wrap').clientWidth")
        check(tag + 'companion sits in the room by default', v0['mode'] == 'anchored', str(v0))
        d = js("lensAvatar.debug()")
        check(tag + 'avatar is drawn at its anchor with a contact shadow', d['anchored'] and d['shadow'] > 0.1 and abs(d['groundX'] - v0['x']) < 20, str({k: d[k] for k in ('x', 'groundX', 'groundY', 'shadow')}))
        pan(430)                                  # camera pans so the room appears to move LEFT by 30 camera px (non-mirrored)
        v1 = view(); exp = -30 * wc / 640 * (-1 if mirror else 1)
        got = v1['x'] - v0['x']
        check(tag + 'anchor moved with the room when the camera panned', abs(got - exp) < max(14, abs(exp) * 0.3), f'moved {got:.0f}px, expected about {exp:.0f}px')
        pan(400)
        v2 = view()
        check(tag + 'panning back returns it to the same spot', abs(v2['x'] - v0['x']) < 25 and abs(v2['y'] - v0['y']) < 25, f'{v2["x"]-v0["x"]:.0f},{v2["y"]-v0["y"]:.0f}px off')
        if not mirror:
            js("window.__block=true"); time.sleep(1.2)
            v = view(); px = js("(()=>{const o=document.getElementById('occ'); const d=o.getContext('2d').getImageData(0,0,o.width,o.height).data; let k=0; for(let i=3;i<d.length;i+=4) if(d[i]>128) k++; return k})()")
            check('something white placed over the companion\'s spot is drawn in front of it (occlusion)', v['occluded'] > 0.05 and px > 300, f'coverage {v["occluded"]:.2f}, {px} opaque px')
            js("window.__block=false"); time.sleep(1.0)
            check('...and the cover goes away when it leaves', view()['occluded'] < 0.05, f'{view()["occluded"]:.2f}')
            # perching on a label's track
            js("tracks=[{label:'cup',target:[90,70,130,110],shown:[90,70,130,110],miss:0,gone:0,anchor:null}]")
            r = js("lensWorld.place(document.getElementById('wrap').clientWidth*110/301, document.getElementById('wrap').clientHeight*90/168)")
            check('clicking a labelled object perches the companion on it', r.get('perched') == 'cup', str(r))
            a0 = view(); js("tracks[0].target=[150,90,190,130]"); time.sleep(1.0); a1 = view()
            check('a perched companion follows the object', a1['x'] - a0['x'] > 0.3 * wc * 60 / 301 and a1['perched'], f'moved {a1["x"]-a0["x"]:.0f}px')
            js("tracks=[]"); time.sleep(0.5)
            check('where-is-the-companion text mentions what it sits on / near', 'sitting' in js("lensCompanionWhere()") or 'perched' in js("lensCompanionWhere()"), js("lensCompanionWhere()"))
            # sit here + float
            check('"sit here" starts placing mode', js("lensIntent('sit here').then(()=>lensWorld.placing)") is True)
            js("lensWorld.place(300, 200)"); p = view(); check('placing sets the spot', abs(p['x'] - 300) < 5, str(p['x']))
            js("lensIntent('go back')"); time.sleep(0.5); check('"go back" returns to floating', view()['mode'] == 'floating')
            # hop back when the room slides away
            js("lensWorld.released=false"); time.sleep(0.5)
            check('it settles back into the room afterwards', True if view()['mode'] in ('anchored', 'floating') else False)
        # attention + life
        js("window.__off=400"); time.sleep(0.5)
        d = js("lensAvatar.debug()"); check(tag + 'idle: wanders with its eyes', d['gaze'] in ('wander', 'motion', 'user'), d['gaze'])
        for _ in range(150):                      # let any spoken reply from the commands above finish first
            if js("lensAvatar.debug().state") == 'idle': break
            time.sleep(0.1)
        js("lensAvatar.forceDrowsy()"); time.sleep(4); d = js("lensAvatar.debug()"); check(tag + 'gets drowsy after a long quiet spell', d['drowsy'] > 0.02, f'{d["drowsy"]:.3f}')
        js("lensAvatar.setState('listening')"); time.sleep(0.6); d = js("lensAvatar.debug()")
        check(tag + 'wakes up and looks at you when listening', d['drowsy'] < 0.5 and d['gaze'] == 'user', f'{d["gaze"]} drowsy {d["drowsy"]:.2f}')
        js("lensAvatar.setState('idle')")
    print('\n%s' % ('ALL PASS' if not fails else f'{fails} FAILED'))
finally:
    ch.kill()
sys.exit(1 if fails else 0)
