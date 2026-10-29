// Motion analysis for the action feature. The vision model cannot follow motion across frames (Ollama feeds it
// independent images), so we MEASURE the motion here and give the model a text summary plus 2-3 key frames.
// Pure functions on small grayscale frames (64x36), unit-tested in eval/test_motion.js.
const LensMotion = (() => {
  const W = 64, H = 36, N = W * H;
  const PIX_THRESH = 28;       // gray-level change that counts as "this pixel moved" (camera noise is ~2-6)
  const ACTIVE_FRAC = 0.004;   // a frame pair is "moving" if >0.4% of pixels changed
  const GLOBAL_FRAC = 0.35;    // more than this changing = the camera or the lighting moved, not an object

  function toGray(rgba) { // rgba of a W x H canvas -> gray
    const g = new Uint8Array(N);
    for (let i = 0; i < N; i++) g[i] = (rgba[4 * i] * 77 + rgba[4 * i + 1] * 150 + rgba[4 * i + 2] * 29) >> 8;
    return g;
  }

  function diffStats(a, b) { // changed-pixel fraction and centroid (0..1) between two frames
    let c = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.abs(a[y * W + x] - b[y * W + x]) > PIX_THRESH) { c++; sx += x; sy += y; }
    }
    return { frac: c / N, cx: c ? sx / c / W : 0.5, cy: c ? sy / c / H : 0.5 };
  }

  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);

  // grays: array of Uint8Array frames, evenly spaced; seconds: clip length. Returns {moving, summary, keyIdx:[...]}
  function analyze(grays, seconds) {
    const n = grays.length;
    if (n < 3) return { moving: false, summary: 'Too few frames to measure motion.', keyIdx: [0, Math.max(0, n - 1)] };
    const st = []; for (let i = 1; i < n; i++) st.push(diffStats(grays[i - 1], grays[i]));
    const active = st.filter(s => s.frac >= ACTIVE_FRAC);
    if (!active.length) return { moving: false, summary: 'Measured motion: no significant movement was detected.', keyIdx: [0, n - 1] };

    // peak frame = most different from the first frame (middle key frame; catches there-and-back actions)
    let peak = 0, best = -1;
    for (let i = 1; i < n; i++) { const f = diffStats(grays[0], grays[i]).frac; if (f > best) { best = f; peak = i; } }
    const keyIdx = (peak >= 2 && peak <= n - 3) ? [0, peak, n - 1] : [0, n - 1];

    const medFrac = [...active.map(s => s.frac)].sort((a, b) => a - b)[Math.floor(active.length / 2)];
    if (medFrac > GLOBAL_FRAC) return { moving: true, global: true, keyIdx: [0, n - 1],
      summary: 'Measured motion: most of the picture changed at once, so the camera itself probably moved (or the lighting changed) rather than one object.' };

    const xs = active.map(s => s.cx), ys = active.map(s => s.cy);
    const third = Math.max(1, Math.floor(active.length / 3));
    const dx = mean(xs.slice(-third)) - mean(xs.slice(0, third)), dy = mean(ys.slice(-third)) - mean(ys.slice(0, third));
    const dirs = [];
    if (Math.abs(dx) > 0.12) dirs.push(dx > 0 ? 'to the right' : 'to the left');
    if (Math.abs(dy) > 0.12) dirs.push(dy > 0 ? 'downward' : 'upward');

    const swings = v => { // direction reversals of a smoothed coordinate track
      let rev = 0, last = 0;
      for (let i = 2; i < v.length; i++) { const d = (v[i] + v[i - 1]) / 2 - (v[i - 1] + v[i - 2]) / 2; if (Math.abs(d) < 0.015) continue; const s = Math.sign(d); if (last && s !== last) rev++; last = s; }
      return rev;
    };
    const rev = Math.max(swings(xs), swings(ys));

    const mx = mean(xs), my = mean(ys), frac = mean(active.map(s => s.frac));
    const v = my < 0.33 ? 'upper' : my > 0.66 ? 'lower' : 'middle', h = mx < 0.33 ? 'left' : mx > 0.66 ? 'right' : 'centre';
    const where = (v === 'middle' && h === 'centre') ? 'centre of the picture' : `${v} ${h} of the picture`;
    const size = frac < 0.02 ? 'a small area' : frac < 0.1 ? 'a medium-sized area' : 'a large area';
    const duty = active.length / st.length;

    const parts = [`movement in the ${where}, covering ${size}`];
    if (rev >= 3) parts.push(`repeating back-and-forth motion (about ${rev} direction changes, like waving, shaking or stirring)`);
    else if (dirs.length) parts.push(`overall drift ${dirs.join(' and ')}`);
    else parts.push('no clear overall direction');
    parts.push(duty > 0.8 ? 'movement throughout the clip' : `movement during about ${Math.round(duty * 100)}% of the clip`);
    return { moving: true, rev, dx, dy, keyIdx, summary: `Measured motion over ${Math.round(seconds)} s (reliable): ${parts.join('; ')}.` };
  }

  return { W, H, toGray, analyze };
})();
if (typeof module !== 'undefined') module.exports = LensMotion;
