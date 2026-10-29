"""Real-object evaluation from webcam snapshots (the 📷 button).

  python3 real_eval.py ingest ~/Downloads     # copy lensmate_*.jpg into real/ and create real/labels.csv
  (edit real/labels.csv: fill `truth` with accepted names separated by |, e.g.  motor driver|l298n|h-bridge)
  python3 real_eval.py run                    # ask the running server "What is this object?", auto-score
Options: --dir DIR (default eval/real), --server URL.  real/ is git-ignored: your photos stay private."""
import base64, csv, glob, json, os, shutil, statistics, sys, time, urllib.request

args = sys.argv[1:]
def opt(name, default):
    if name in args: i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.expanduser(opt('--dir', os.path.join(HERE, 'real')))
BASE = opt('--server', 'http://localhost:3000')
QUESTION = 'What is this object? Name it specifically.'

def ingest(src):
    os.makedirs(DIR, exist_ok=True)
    names = []
    for f in sorted(glob.glob(os.path.join(os.path.expanduser(src), 'lensmate_*.jpg'))):
        shutil.copy2(f, DIR); names.append(os.path.basename(f))
    path = os.path.join(DIR, 'labels.csv')
    old = {r['image']: r['truth'] for r in csv.DictReader(open(path))} if os.path.exists(path) else {}
    imgs = sorted(set(old) | set(names))
    with open(path, 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['image', 'truth'])
        for i in imgs: w.writerow([i, old.get(i, '')])
    print(f'{len(names)} copied; {len(imgs)} rows in {path}. Fill the `truth` column (accepted names separated by |).')

def ask(img):
    b = 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(DIR, img), 'rb').read()).decode()
    t0 = time.time(); text = ''
    r = urllib.request.urlopen(urllib.request.Request(BASE + '/api/chat', json.dumps(
        dict(messages=[dict(role='user', content=QUESTION)], image=b)).encode(), {'Content-Type': 'application/json'}), timeout=300)
    for line in r:
        if line.strip(): text += json.loads(line).get('message', {}).get('content', '')
    return text.strip(), time.time() - t0

def run():
    rows = [r for r in csv.DictReader(open(os.path.join(DIR, 'labels.csv'))) if r['truth'].strip()]
    if not rows: sys.exit('No rows with a `truth` value yet.')
    ask(rows[0]['image'])  # warm-up
    out, lat = [], []
    for r in rows:
        ans, t = ask(r['image']); lat.append(t)
        hit = any(a.strip().lower() in ans.lower() for a in r['truth'].split('|') if a.strip())
        out.append(dict(image=r['image'], truth=r['truth'], answer=ans, hit=int(hit), seconds=round(t, 1)))
        print(f"{'HIT ' if hit else 'MISS'} {r['truth'].split('|')[0]:<22} -> {ans[:90]}")
    with open(os.path.join(DIR, 'results.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
    n, h = len(out), sum(o['hit'] for o in out)
    print(f'\nReal-object accuracy: {h}/{n} = {100 * h / n:.0f}%   median latency {statistics.median(lat):.1f}s   (n={n}: treat as indicative, not precise)')

cmd = args[0] if args else ''
if cmd == 'ingest' and len(args) > 1: ingest(args[1])
elif cmd == 'run': run()
else: print(__doc__)
