// Unit tests for camera-motion estimation and the occlusion mask, on synthetic textured frames with known motion.
const World = require('../public/world.js');
const W = 301, H = 168;
let seed = 21; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
function smoothTexture(w, h) {  // blurred noise: looks like a real scene to a block matcher
  let a = Float32Array.from({ length: w * h }, () => rnd() * 255);
  for (let p = 0; p < 2; p++) { const b = new Float32Array(a.length); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[(y + j) * w + x + i]; b[y * w + x] = s / 9; } a = b; }
  const lo = Math.min(...a), hi = Math.max(...a); return Uint8Array.from(a, v => (v - lo) / (hi - lo) * 255);
}
const world = smoothTexture(W + 80, H + 60);                               // a bigger room; the camera sees a W x H window
const view = (ox, oy) => { const f = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = world[(y + oy) * (W + 80) + x + ox]; return f; };
let fails = 0; const check = (name, ok, info) => { console.log(ok ? 'PASS' : 'FAIL', name, info || ''); if (!ok) fails++; };

// camera pans right by 5 px and down by 3 px: the world appears to move LEFT 5 and UP 3
let e = World.estimate(view(40, 30), view(45, 33), W, H);
check('pan right 5, down 3 -> world moves (-5,-3)', Math.abs(e.dx + 5) < 0.4 && Math.abs(e.dy + 3) < 0.4 && e.conf > 0.9, `dx ${e.dx.toFixed(2)} dy ${e.dy.toFixed(2)} conf ${e.conf.toFixed(2)}`);
e = World.estimate(view(40, 30), view(40, 30), W, H);
check('static camera -> no motion, no foreground (with real patches, not by default)', e.n > 30 && e.conf > 0.9 && Math.abs(e.dx) < 0.2 && Math.abs(e.dy) < 0.2 && e.fg === null, `n ${e.n} conf ${e.conf.toFixed(2)} fg ${JSON.stringify(e.fg)}`);
e = World.estimate(view(40, 30), view(33, 30), W, H);
check('pan left 7 -> world moves (+7,0)', Math.abs(e.dx - 7) < 0.4 && Math.abs(e.dy) < 0.4, `dx ${e.dx.toFixed(2)} dy ${e.dy.toFixed(2)} conf ${e.conf.toFixed(2)} n ${e.n}`);

// a hand-like object moves across the scene while the camera pans: the camera estimate must ignore it and the foreground must find it
const prev = view(40, 30), cur = view(44, 30);
for (let y = 40; y < 100; y++) for (let x = 200; x < 260; x++) { prev[y * W + x] = world[(y + 5) * (W + 80) + x + 90]; cur[y * W + x + 12] = world[(y + 5) * (W + 80) + x + 90]; } // block shifts 12 px right, differently
e = World.estimate(prev, cur, W, H);
check('a moving object does not disturb the camera estimate', Math.abs(e.dx + 4) < 0.5, `dx ${e.dx.toFixed(2)} (true -4)`);
check('...and is reported as foreground at its position', e.fg && e.fg.cx > 0.55 && e.fg.cx < 0.95 && e.fg.cy > 0.15 && e.fg.cy < 0.75, e.fg ? `centroid (${e.fg.cx.toFixed(2)}, ${e.fg.cy.toFixed(2)}) frac ${e.fg.frac.toFixed(2)}` : 'none');

// blank wall: nothing to track, so the estimate must say so instead of inventing motion
e = World.estimate(new Uint8Array(W * H).fill(120), new Uint8Array(W * H).fill(120), W, H);
check('blank wall -> zero confidence (do not guess)', e.conf === 0 && e.dx === 0, `n ${e.n}`);

// occlusion mask
const N = 40, bg = new Uint8Array(N * N); for (let i = 0; i < bg.length; i++) bg[i] = 90 + (i * 7) % 40;
let m = World.diffMask(bg, bg.slice(), N, N);
check('mask: nothing changed -> coverage 0', m.coverage === 0);
const cl = Uint8Array.from(bg, v => Math.min(255, v + 6)); m = World.diffMask(bg, cl, N, N);
check('mask: slight lighting change is ignored', m.coverage === 0, `coverage ${m.coverage}`);
const hand = bg.slice(); for (let y = 10; y < 30; y++) for (let x = 5; x < 25; x++) hand[y * N + x] = 230; m = World.diffMask(bg, hand, N, N);
check('mask: a bright hand over the anchor is detected', m.coverage > 0.2 && m.coverage < 0.3 && m.mask[20 * N + 15] === 1 && m.mask[35 * N + 35] === 0, `coverage ${m.coverage.toFixed(2)}`);
const speck = bg.slice(); speck[5 * N + 5] = 255; m = World.diffMask(bg, speck, N, N);
check('mask: a single noisy pixel is removed', m.coverage === 0);

// drift correction: the anchor believes it is 3 px right and 2 px up of where its surroundings really are
{
  const T = require('../public/tracker.js'), f0 = view(40, 30), f1 = view(41, 30);          // the world moves 1 px; we look for the spot in f1
  const spot = T.patch(f0, W, H, [140, 70, 180, 110]);                                     // remembered look of a 40x40 spot centred (160,90)
  const r = World.locate(spot, f1, W, H, 160 + 3 - 1, 90 - 2, 5);                          // the true centre is now (159,90); the anchor guesses (162,88)
  check('locate: finds where the spot really is (corrects +3,-2 drift)', r.dx === -3 && r.dy === 2 && r.cost < 8, `correction (${r.dx},${r.dy}) cost ${r.cost.toFixed(1)}`);
  const covered = Uint8Array.from(f1); for (let y = 70; y < 110; y++) for (let x = 140; x < 180; x++) covered[y * W + x] = 250;
  const r2 = World.locate(spot, covered, W, H, 159, 90, 4);
  check('locate: a hand covering the spot gives a high cost (correction not trusted)', r2.cost > 40, `cost ${r2.cost.toFixed(1)}`);
}
process.exit(fails ? 1 : 0);
