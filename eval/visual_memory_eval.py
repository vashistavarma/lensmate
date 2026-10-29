"""Visual-memory test on the real photos in eval/real (needs the labelled mecanum + motor driver sets).
One photo per object is the taught reference; the others are tests (leave-one-out).
Also checks false positives: unrelated images, and objects shown with only a *different* reference."""
import base64, csv, io, json, os, sys, time, urllib.request
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); REAL = os.path.join(HERE, 'real')
rows = list(csv.DictReader(open(os.path.join(REAL, 'labels.csv'))))
mec = [r['image'] for r in rows if r['truth'] == 'mecanum']; drv = [r['image'] for r in rows if r['truth'].startswith('motor')]
def b64(path, w=None):
    im = Image.open(path).convert('RGB')
    if w: im = im.resize((w, round(im.height * w / im.width)))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=85); return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
def ref(name, f): return dict(name=name, image=b64(os.path.join(REAL, f), 512))
def ask(path, refs, q='What is this object? Name it specifically.'):
    r = urllib.request.urlopen(urllib.request.Request(os.environ.get('LENSMATE_URL', 'http://localhost:3000') + '/api/chat', json.dumps(dict(
        messages=[dict(role='user', content=q)], image=b64(path), refs=refs)).encode(), {'Content-Type': 'application/json'}), timeout=300)
    return ''.join(json.loads(l).get('message', {}).get('content', '') for l in r if l.strip()).strip()
R_M, R_D = ref('mecanum wheel', mec[0]), ref('motor driver', drv[0])
ask(os.path.join(REAL, mec[1]), [R_M, R_D])  # warm-up
res = {}
def run(group, cases, refs):  # cases: (path, must_contain or None, must_not_contain)
    out = []
    for p, want, forbid in cases:
        a = ask(p, refs).lower(); ok = (want in a if want else True) and not any(f in a for f in forbid)
        out.append(ok); print(('OK  ' if ok else 'BAD '), group, os.path.basename(p)[:28], '->', a[:80])
    res[group] = f'{sum(out)}/{len(out)}'
P = lambda f: os.path.join(REAL, f)
run('positives (both refs)', [(P(f), 'mecanum', []) for f in mec[1:]] + [(P(f), 'motor driver', []) for f in drv[1:]], [R_M, R_D])
run('negatives: unrelated images', [(os.path.join(HERE, 'images', n), None, ['mecanum', 'motor driver']) for n in ('shapes.jpg', 'read.jpg', 'colour.jpg', 'count.jpg')], [R_M, R_D])
run('negatives: other object, wrong ref only', [(P(f), None, ['motor driver']) for f in mec[1:]] + [(P(f), None, ['mecanum']) for f in drv[1:]][:0], [R_D])
run('negatives: driver shown, mecanum ref only', [(P(f), None, ['mecanum']) for f in drv[1:]], [R_M])
print('\nSUMMARY', json.dumps(res, indent=1))
