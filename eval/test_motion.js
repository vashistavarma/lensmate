// Unit tests for the motion analysis on synthetic 64x36 grayscale clips with known motion.
const M = require('../public/motion.js');
const { W, H } = M;
let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const frame = (drawFn, bg = 200, noise = 4) => { const g = new Uint8Array(W * H); for (let i = 0; i < g.length; i++) g[i] = bg + (rnd() - 0.5) * 2 * noise; drawFn(g); return g; };
const blob = (cx, cy, r = 5, v = 40) => g => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y * W + x] = v; };
const clip = (n, f) => Array.from({ length: n }, (_, i) => frame(f(i / (n - 1))));
let fails = 0; const check = (name, ok, info) => { console.log(ok ? 'PASS' : 'FAIL', name, info || ''); if (!ok) fails++; };

let r = M.analyze(clip(12, t => blob(8 + t * 48, 18)), 4);
check('left->right', r.moving && /to the right/.test(r.summary) && !/back-and-forth/.test(r.summary), r.summary);
r = M.analyze(clip(12, t => blob(48 - t * 40, 18)), 4);
check('right->left', /to the left/.test(r.summary), r.summary);
r = M.analyze(clip(12, t => blob(32, 30 - t * 24)), 4);
check('upward', /upward/.test(r.summary), r.summary);
r = M.analyze(clip(16, t => blob(32 + 20 * Math.sin(t * Math.PI * 6), 18)), 5);
check('waving (3 cycles) -> back-and-forth', /back-and-forth/.test(r.summary), `rev=${r.rev} ${r.summary}`);
check('waving: peak frame is a middle key frame', r.keyIdx.length === 3, `keyIdx=${r.keyIdx}`);
r = M.analyze(clip(12, () => blob(32, 18)), 4);
check('static scene with camera noise -> no motion', !r.moving, r.summary);
const tex = Uint8Array.from({ length: W * 3 * H }, () => 40 + rnd() * 170); // textured world, camera pans across it
r = M.analyze(Array.from({ length: 12 }, (_, i) => Uint8Array.from({ length: W * H }, (_, k) => tex[Math.floor(k / W) * W * 3 + (k % W) + i * 5])), 4);
check('camera pan over a textured scene -> camera moved', r.global === true, r.summary);
r = M.analyze(Array.from({ length: 12 }, (_, i) => frame(() => {}, 200 - i * 12)), 4);
check('slow brightness ramp is not motion', !r.moving, r.summary);
r = M.analyze(clip(12, t => blob(8 + t * 48, 18, 5, 40)).map(g => g), 4);
check('motion location reported (centre)', /centre of the picture/.test(r.summary), r.summary);
check('few frames handled', !M.analyze([frame(() => {})], 1).moving);
process.exit(fails ? 1 : 0);
