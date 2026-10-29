"""Run cases.json against a running LensMate server and report accuracy + latency."""
import base64, json, statistics, sys, time, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
IOU_OK = 0.5

def b64(path): return 'data:image/jpeg;base64,' + base64.b64encode(open(path, 'rb').read()).decode()
def post(path, body):
    return urllib.request.urlopen(urllib.request.Request(BASE + path, json.dumps(body).encode(), {'Content-Type': 'application/json'}), timeout=300)

def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy; u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / u if u else 0

def run_chat(c):
    t0 = time.time(); ttft = None; text = ''
    r = post('/api/chat', dict(messages=[dict(role='user', content=c['question'])], image=b64(c['image']), mode=c.get('mode', 'chat'), facts=c.get('facts', [])))
    for line in r:
        if not line.strip(): continue
        piece = json.loads(line).get('message', {}).get('content', '')
        if piece and ttft is None: ttft = time.time() - t0
        text += piece
    low = text.lower()
    ok = (any(k in low for k in c['expect_any']) if 'expect_any' in c else True) and all(k in low for k in c.get('expect_all', []))
    return dict(ok=ok, ttft=ttft, total=time.time() - t0, answer=text.strip()[:160])

def run_detect(c):
    t0 = time.time()
    j = json.load(post('/api/detect', dict(image=b64(c['image']), query=c.get('query'))))
    boxes = [b['box'] for b in j['boxes']]
    # each ground-truth target is matched to the best-overlapping predicted box
    ious = [max([iou(t['box'], b) for b in boxes] or [0]) for t in c['targets']]
    return dict(ok=all(v >= IOU_OK for v in ious), mean_iou=statistics.mean(ious), total=time.time() - t0, answer=f"{len(boxes)} boxes, IoU {[round(v, 2) for v in ious]}")

cases = json.load(open('cases.json'))
run_chat(dict(question='hi', image=cases[0]['image'], expect_any=['']))  # warm-up: loads the model into VRAM
rows = []
for c in cases:
    res = (run_chat if c['type'] == 'chat' else run_detect)(c)
    rows.append((c, res))
    print(f"{'PASS' if res['ok'] else 'FAIL'}  {c['id']:<18} {res['total']:.1f}s  {res['answer']}")

chat = [r for c, r in rows if c['type'] == 'chat']; det = [r for c, r in rows if c['type'] == 'detect']
summary = dict(
    chat_accuracy=f"{sum(r['ok'] for r in chat)}/{len(chat)}",
    detect_pass_iou50=f"{sum(r['ok'] for r in det)}/{len(det)}",
    detect_mean_iou=round(statistics.mean(r['mean_iou'] for r in det), 3) if det else None,
    chat_first_token_s_median=round(statistics.median(r['ttft'] for r in chat), 2) if chat else None,
    chat_total_s_median=round(statistics.median(r['total'] for r in chat), 2) if chat else None,
    detect_s_median=round(statistics.median(r['total'] for r in det), 2) if det else None,
)
print('\nSUMMARY', json.dumps(summary, indent=1))
json.dump(dict(summary=summary, cases=[dict(id=c['id'], **r) for c, r in rows]), open('results.json', 'w'), indent=1)
