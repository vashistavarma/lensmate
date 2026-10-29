// Upgrade: lightweight box tracker. Block matching (mean absolute difference) on small
// grayscale frames, so labels follow the object when the camera or the object moves.
// Tracks translation only (not scale/rotation). Runs on the CPU in well under a millisecond per box.
const LensTracker = (() => {
  const SCALE = 4, TW = 301, TH = 168; // tracking frame = 1204x672 detect frame / 4

  function toGray(rgba) {
    const g = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < g.length; i++) g[i] = (rgba[4 * i] * 77 + rgba[4 * i + 1] * 150 + rgba[4 * i + 2] * 29) >> 8;
    return g;
  }

  // Find where the patch `box` of frame `prev` moved to in `cur`, searching +-radius pixels.
  // Returns {box, cost}: cost = mean abs gray difference (0-255), or null when the patch has
  // too little texture to track (the box is then left where it is).
  function track(prev, cur, w, h, box, radius = 6) {
    let [x1, y1, x2, y2] = box.map(Math.round);
    x1 = Math.max(0, x1); y1 = Math.max(0, y1); x2 = Math.min(w, x2); y2 = Math.min(h, y2);
    const bw = x2 - x1, bh = y2 - y1;
    if (bw < 8 || bh < 8) return { box, cost: null };

    let s = 0, s2 = 0, n = 0;
    for (let y = 0; y < bh; y += 2) for (let x = 0; x < bw; x += 2) { const v = prev[(y1 + y) * w + x1 + x]; s += v; s2 += v * v; n++; }
    if (s2 / n - (s / n) ** 2 < 30) return { box, cost: null }; // flat patch: matching would be random

    let best = Infinity, bdx = 0, bdy = 0, bestCost = 255;
    for (let dy = -radius; dy <= radius; dy++) {
      if (y1 + dy < 0 || y2 + dy > h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        if (x1 + dx < 0 || x2 + dx > w) continue;
        let sad = 0, c = 0;
        for (let y = 0; y < bh; y += 2) {
          const a = (y1 + y) * w + x1, b = (y1 + dy + y) * w + x1 + dx;
          for (let x = 0; x < bw; x += 2) { sad += Math.abs(prev[a + x] - cur[b + x]); c++; }
        }
        const cost = sad / c, score = cost + 0.15 * (Math.abs(dx) + Math.abs(dy)); // small bias against jitter
        if (score < best) { best = score; bestCost = cost; bdx = dx; bdy = dy; }
      }
    }
    return { box: [x1 + bdx, y1 + bdy, x2 + bdx, y2 + bdy], cost: bestCost };
  }

  return { SCALE, TW, TH, toGray, track };
})();
if (typeof module !== 'undefined') module.exports = LensTracker;
