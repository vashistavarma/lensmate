// Unit test for the tracker on synthetic textured frames with known motion.
const T = require('../public/tracker.js');
const LOST_COST = 16; // keep in sync with spatial.js: good matches ~2-8, unrelated scene ~25
const { TW: w, TH: h } = T;
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
// smooth-ish random texture (box blur of noise) so it resembles a real scene
function scene() {
  let a = Float32Array.from({ length: w * h }, () => rnd() * 255);
  for (let pass = 0; pass < 2; pass++) { const b = new Float32Array(a.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[(y + j) * w + x + i]; b[y * w + x] = s / 9; } a = b; }
  const lo = Math.min(...a), hi = Math.max(...a); return Uint8Array.from(a, v => (v - lo) / (hi - lo) * 255);
}
function shift(g, dx, dy, noise = 4) { const o = new Uint8Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(w - 1, Math.max(0, x - dx)), sy = Math.min(h - 1, Math.max(0, y - dy));
    o[y * w + x] = Math.max(0, Math.min(255, g[sy * w + sx] + (rnd() - 0.5) * 2 * noise)); } return o; }

const base = scene(), box = [100, 60, 160, 110];
let fails = 0;
const check = (name, ok, extra) => { console.log(ok ? 'PASS' : 'FAIL', name, extra || ''); if (!ok) fails++; };

for (const [dx, dy] of [[0, 0], [5, -3], [-6, 4], [6, 6]]) {
  const r = T.track(base, shift(base, dx, dy), w, h, box, 6);
  const err = Math.max(Math.abs(r.box[0] - (box[0] + dx)), Math.abs(r.box[1] - (box[1] + dy)));
  check(`shift (${dx},${dy}) within 1px`, err <= 1, `box=${r.box} cost=${r.cost.toFixed(1)}`);
}
// catch-up after a slow detection (large motion, wide search), like the 3 s model delay
const r = T.track(base, shift(base, 17, -12), w, h, box, 20);
check('relocate big shift (17,-12) radius 20', Math.abs(r.box[0] - 117) <= 1 && Math.abs(r.box[1] - 48) <= 1, `box=${r.box}`);
// chained frame-to-frame tracking: 20 steps of (2,1) = (40,20) total, drift must stay small
let prev = base, b = box.slice(), cum = [0, 0];
for (let i = 0; i < 20; i++) { cum = [cum[0] + 2, cum[1] + 1]; const cur = shift(base, cum[0], cum[1]); b = T.track(prev, cur, w, h, b, 6).box; prev = cur; }
check('20-frame chain, drift <= 3px', Math.abs(b[0] - (box[0] + 40)) <= 3 && Math.abs(b[1] - (box[1] + 20)) <= 3, `box=${b}`);
// a scene change is flagged by high cost; flat regions are reported untrackable
const other = scene(); const lost = T.track(base, other, w, h, box, 6);
check('unrelated scene -> high cost', lost.cost > LOST_COST, `cost=${lost.cost.toFixed(1)}`);
const flat = new Uint8Array(w * h).fill(128);
check('flat patch -> cost null, box unchanged', T.track(flat, flat, w, h, box).cost === null);
process.exit(fails ? 1 : 0);
