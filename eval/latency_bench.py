"""Question latency with 3 taught photos, in a real browser with a synthetic camera showing a real photo.
Run: .venv/bin/python eval/latency_bench.py   (needs the eval/real photos and a running server; set OLD_PORT to also time a second server)"""
import base64, csv, io, json, random, subprocess, sys, time, urllib.request, websocket, statistics as st
from PIL import Image
REAL='/home/v9prime/gen ai project/lensmate/eval/real'
rows=list(csv.DictReader(open(REAL+'/labels.csv'))); f=[r['image'] for r in rows]
def b64(path,w,q=82):
    im=Image.open(path).convert('RGB'); im=im.resize((w,round(im.height*w/im.width))); b=io.BytesIO(); im.save(b,'JPEG',quality=q); return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
scene=b64(f'{REAL}/{f[5]}',640)
R={'mecanum wheel':b64(f'{REAL}/{f[0]}',512),'sensor':b64(f'{REAL}/{f[6]}',512),'motor driver':b64(f'{REAL}/{f[4]}',512)}
CAM="""(() => { const c=document.createElement('canvas'); c.width=640; c.height=360; const x=c.getContext('2d'); const img=new Image(); img.src=%s; let n=Math.floor(Math.random()*9999);
  setInterval(()=>{ if(img.complete) x.drawImage(img,0,0,640,360); n++; x.fillStyle='rgb('+(n*37%%255)+','+(n*91%%255)+','+(n*13%%255)+')'; x.fillRect(560+(n%%40),0,40,24); },66);
  navigator.mediaDevices.getUserMedia=async()=>c.captureStream(30);
  window.__log=[]; const F=window.fetch; window.fetch=async(u,o)=>{ const t=performance.now(); const r=await F(u,o); const rec={url:String(u).slice(5)};
     if(String(u).includes('/api/match')){ try{ rec.got=(await r.clone().json()).matched }catch(e){} }
     if(String(u).includes('/api/chat')){ try{ const b=JSON.parse(o.body); rec.sentMatched=b.matched; rec.refsSent=(b.refs||[]).length }catch(e){} }
     rec.ms=Math.round(performance.now()-t); window.__log.push(rec); return r; };
  })();""" % json.dumps(scene)
import os
PORTS={'old':int(os.environ.get('OLD_PORT',3000)),'new':int(os.environ.get('NEW_PORT',3000))}
chrome=subprocess.Popen(['google-chrome','--headless=new','--no-sandbox','--remote-debugging-port=9366','--window-size=1280,720','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        try: tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9366/json')); break
        except OSError: time.sleep(0.3)
    ws=websocket.create_connection([t for t in tabs if t['type']=='page'][0]['webSocketDebuggerUrl'],max_size=None); n=0
    def call(m,**p):
        global n; n+=1; ws.send(json.dumps(dict(id=n,method=m,params=p)))
        while True:
            r=json.loads(ws.recv())
            if r.get('id')==n: return r
    js=lambda e: call('Runtime.evaluate',expression=e,returnByValue=True,awaitPromise=True)['result'].get('result',{}).get('value')
    call('Page.enable'); call('Page.addScriptToEvaluateOnNewDocument',source=CAM)
    def load(port):
        before=js("performance.timeOrigin"); call('Page.navigate',url=f'http://localhost:{port}/')
        for _ in range(200):
            time.sleep(0.05)
            if js("performance.timeOrigin")!=before and js("(document.getElementById('status')||{}).textContent")=='camera live': return
        raise RuntimeError('load')
    def trial(port, recent, wait=0.0):
        names=list(R); random.shuffle(names)
        load(port)
        js("localStorage.clear(); localStorage.setItem('lensmate.refs', %s); localStorage.setItem('lensmate.mirror','0'); localStorage.setItem('lensmate.recent', %s)" % (json.dumps(json.dumps([dict(name=k,image=R[k]) for k in names])), json.dumps(json.dumps(recent))))
        load(port)
        for _ in range(100):   # wait until the synthetic camera is really showing the photo (not its initial black frame)
            if js("(()=>{const c=document.createElement('canvas');c.width=16;c.height=9;const x=c.getContext('2d');x.drawImage(cam,0,0,16,9);const d=x.getImageData(0,0,16,9).data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i]+d[i+1]+d[i+2];return s/(d.length/4*3)})()")>40: break
            time.sleep(0.05)
        time.sleep(wait)
        js("document.getElementById('newchat').click(); window.__log.length=0; window.__t=performance.now(); window.__first=null; window.__obs=setInterval(()=>{const b=[...document.querySelectorAll('#log .msg.bot')].pop(); if(b && b.textContent && b.textContent!=='…' && window.__first===null) window.__first=performance.now()-window.__t;},30); window.lensAsk('What is this object?')")
        for _ in range(300):
            time.sleep(0.1)
            if (js("document.getElementById('status').textContent") or '').startswith('reply in'): break
        o=js("[window.__first, performance.now()-window.__t, [...document.querySelectorAll('#log .msg.bot')].pop().textContent, window.__log.filter(r=>/match|chat/.test(r.url)).map(r=>r.url+':'+r.ms)]"); js("clearInterval(window.__obs)"); return o
    def run(label, port, recent, wait=0.0, trials=3):
        res=[trial(port,recent,wait) for _ in range(trials)]
        fw=[r[0]/1000 for r in res]; tot=[r[1]/1000 for r in res]; ok=sum('motor driver' in r[2].lower() for r in res)
        print(f"{label:56} first word {st.mean(fw):4.1f}s [{min(fw):.1f}-{max(fw):.1f}]  total {st.mean(tot):4.1f}s  named it {ok}/{trials}   e.g. {res[0][3]}")
    print('3 taught photos, random stored order; every trial is a fresh page and a unique frame\n')
    if os.environ.get('OLD_PORT'): run('OLD server, ask the moment the camera is live', PORTS['old'], [])
    run('cold, nothing recognised recently (worst case)', PORTS['new'], [])
    run('cold, this object recognised recently', PORTS['new'], ['motor driver'])
    run('picture still ~8 s first (background check)', PORTS['new'], [], wait=8.0)
finally:
    chrome.terminate()
