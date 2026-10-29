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

  // --- "is the object still under the box?" ---
  // The frame-to-frame tracker alone follows whatever is under the box, even after the object has left (for example a
  // black shirt behind a black battery). So each label also remembers how its object looked when it was detected, and
  // anchorScore() compares that to what is under the box NOW with normalised correlation (insensitive to brightness).
  const FLAT_VAR = 30; // a patch with less pixel variance than this has no structure to compare

  function patch(gray, w, h, box) { // copy of the region under a box, as the label's reference appearance
    const x1 = Math.max(0, Math.round(box[0])), y1 = Math.max(0, Math.round(box[1]));
    const x2 = Math.min(w, Math.round(box[2])), y2 = Math.min(h, Math.round(box[3]));
    const pw = Math.max(0, x2 - x1), ph = Math.max(0, y2 - y1), data = new Float32Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) data[y * pw + x] = gray[(y1 + y) * w + x1 + x];
    return { w: pw, h: ph, data };
  }

  // Correlation (-1..1) between the stored appearance and the current region; null when it cannot be judged.
  function anchorScore(gray, w, h, box, anchor) {
    if (!anchor || anchor.w < 8 || anchor.h < 8) return null;
    const x1 = Math.round(box[0]), y1 = Math.round(box[1]);
    if (x1 < 0 || y1 < 0 || x1 + anchor.w > w || y1 + anchor.h > h) return 0; // pushed out of the picture
    let sa = 0, sc = 0, n = 0;
    for (let y = 0; y < anchor.h; y += 2) for (let x = 0; x < anchor.w; x += 2) { sa += anchor.data[y * anchor.w + x]; sc += gray[(y1 + y) * w + x1 + x]; n++; }
    const ma = sa / n, mc = sc / n; let va = 0, vc = 0, cov = 0;
    for (let y = 0; y < anchor.h; y += 2) for (let x = 0; x < anchor.w; x += 2) {
      const a = anchor.data[y * anchor.w + x] - ma, c = gray[(y1 + y) * w + x1 + x] - mc; va += a * a; vc += c * c; cov += a * c;
    }
    va /= n; vc /= n;
    if (va < FLAT_VAR) return null;          // the object itself had no structure: cannot tell
    if (vc < FLAT_VAR) return 0;             // it had structure, the region is now flat: the object is gone
    return cov / n / Math.sqrt(va * vc);
  }

  function blendAnchor(anchor, gray, w, box, alpha) { // follow slow changes (rotation, lighting) without forgetting the object
    const x1 = Math.round(box[0]), y1 = Math.round(box[1]);
    if (!anchor || x1 < 0 || y1 < 0) return;
    for (let y = 0; y < anchor.h; y++) for (let x = 0; x < anchor.w; x++) {
      const i = y * anchor.w + x; anchor.data[i] += alpha * (gray[(y1 + y) * w + x1 + x] - anchor.data[i]);
    }
  }

  return { SCALE, TW, TH, toGray, track, patch, anchorScore, blendAnchor };
})();
if (typeof module !== 'undefined') module.exports = LensTracker;
