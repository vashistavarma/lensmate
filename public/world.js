// Spatial anchoring. The companion used to be glued to a fixed spot on the SCREEN, so when the camera moved the room slid past it
// ("floating ghost"). This module (1) estimates how the camera is moving by tracking a grid of small patches over the whole picture
// and taking the median (moving objects and hands disagree with the median, so they are ignored), (2) keeps an anchor point
// locked to the WORLD by moving it with that motion, (3) can perch the anchor on a labelled object, (4) works out what in front of
// the anchor changed so a hand passing the companion can occlude it, and (5) reports where the foreground action is (used for gaze).
// The pure estimator is unit-tested in eval/test_world.js. Honest limit: this is 2-D translation only (no depth, rotation or zoom).
const LensWorld = (() => {
  const tracker = () => (typeof LensTracker !== 'undefined' ? LensTracker : require('./tracker.js'));
  const COLS = 8, ROWS = 5, SIZE = 28;           // patch grid on the 301x168 tracking frame

  // Camera motion between two gray frames. dx,dy = how far the WORLD moved in the picture (a point fixed in the room moves by dx,dy).
  function estimate(prev, cur, w, h) {
    const T = tracker(), mx = (w - COLS * SIZE) / (COLS + 1), my = (h - ROWS * SIZE) / (ROWS + 1), pts = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x1 = Math.round(mx + c * (SIZE + mx)), y1 = Math.round(my + r * (SIZE + my));
      const t = T.track(prev, cur, w, h, [x1, y1, x1 + SIZE, y1 + SIZE], 8);
      if (t.cost === null || t.cost > 22) continue;   // flat or unmatched patch: no information
      pts.push({ dx: t.box[0] - x1, dy: t.box[1] - y1, cx: x1 + SIZE / 2, cy: y1 + SIZE / 2 });
    }
    if (pts.length < 6) return { dx: 0, dy: 0, conf: 0, n: pts.length, fg: null };
    const med = a => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    const mdx = med(pts.map(p => p.dx)), mdy = med(pts.map(p => p.dy));
    const agree = p => Math.abs(p.dx - mdx) <= 1 && Math.abs(p.dy - mdy) <= 1;
    const inl = pts.filter(agree), out = pts.filter(p => !agree(p));
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      dx: mean(inl.map(p => p.dx)), dy: mean(inl.map(p => p.dy)),       // mean of the agreeing patches gives sub-pixel precision
      conf: inl.length / pts.length, n: pts.length,
      fg: out.length ? { frac: out.length / pts.length, cx: mean(out.map(p => p.cx)) / w, cy: mean(out.map(p => p.cy)) / h } : null, // where the 'other' motion is (0..1)
    };
  }

  // Foreground mask: where the picture around the anchor now differs from how it looked when the companion was placed.
  // bg and cur are same-size gray patches (row-major). Returns {mask (0/1), coverage (0..1)}.
  function diffMask(bg, cur, w, h, thr = 26) {
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.abs(bg[i] - cur[i]) > thr ? 1 : 0;
    const mask = new Uint8Array(w * h); let on = 0;                       // 3x3 majority: removes speckle, fills small holes
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += raw[yy * w + xx]; n++; } }
      if (s * 2 > n) { mask[y * w + x] = 1; on++; }
    }
    return { mask, coverage: on / (w * h) };
  }

  // Re-find the anchor's own surroundings: integrating camera motion drifts a little, so every now and then the stored look of the
  // spot (bg: {w,h,data}) is searched for around where the anchor thinks it is. Returns {dx,dy,cost}; a high cost means something
  // (a hand, a moved object) is covering the spot, and the correction is not trusted.
  function locate(bg, cur, w, h, ax, ay, radius = 4) {
    let best = { dx: 0, dy: 0, cost: Infinity };
    const x0 = Math.round(ax - bg.w / 2), y0 = Math.round(ay - bg.h / 2);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x1 = x0 + dx, y1 = y0 + dy;
      if (x1 < 0 || y1 < 0 || x1 + bg.w > w || y1 + bg.h > h) continue;
      let sad = 0, n = 0;
      for (let y = 0; y < bg.h; y += 2) for (let x = 0; x < bg.w; x += 2) { sad += Math.abs(bg.data[y * bg.w + x] - cur[(y1 + y) * w + x1 + x]); n++; }
      const cost = sad / n + 0.2 * (Math.abs(dx) + Math.abs(dy));
      if (cost < best.cost) best = { dx, dy, cost: sad / n };
    }
    return best;
  }

  return { estimate, diffMask, locate, COLS, ROWS, SIZE };
})();
if (typeof module !== 'undefined') module.exports = LensWorld;

// ---- browser glue: the world-locked anchor, placement, perching and occlusion ----
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('occ')) {
  const TW = LensTracker.TW, TH = LensTracker.TH;                      // 301 x 168 tracking frame
  const wrap = document.getElementById('wrap'), occ = document.getElementById('occ'), octx = occ.getContext('2d');
  const mirror = () => !!window.lensMirror?.();
  const Wc = () => wrap.clientWidth || 1, Hc = () => wrap.clientHeight || 1;
  const radiusCss = () => Math.max(28, Math.min(Wc(), Hc()) * 0.09);   // same formula as avatar.js
  const enabled = () => { try { return localStorage.getItem('lensmate.anchor') !== 'screen'; } catch { return true; } };   // opt out: 'screen' = old floating corner
  const api = window.lensWorld = { placing: false, released: false, anchor: null, motion: { dx: 0, dy: 0, conf: 0, n: 0 }, fg: null, coverage: 0 };
  let prev = null, ticks = 0, offSince = 0, stillTicks = 0;
  const started = performance.now();

  const resizeOcc = () => { occ.width = Wc(); occ.height = Hc(); };
  new ResizeObserver(resizeOcc).observe(wrap); resizeOcc();
  const syncMirror = () => occ.classList.toggle('mirrored', mirror());   // the occlusion layer is flipped with the video, so it lines up
  window.addEventListener('lens-mirror', syncMirror); syncMirror();

  const toCam = (px, py) => ({ x: (mirror() ? Wc() - px : px) * TW / Wc(), y: py * TH / Hc() });                  // screen CSS px -> tracking px
  const toScreen = (ax, ay) => ({ x: mirror() ? Wc() - ax * Wc() / TW : ax * Wc() / TW, y: ay * Hc() / TH });      // tracking px -> screen CSS px
  const liveTracks = () => (typeof tracks !== 'undefined' ? tracks : []);

  function captureBg(gray) { // remember how the spot looks (clean video, the companion is not part of it) for occlusion and drift correction
    const a = api.anchor; if (!a || !gray || a.track) return;
    const rh = Math.round(1.7 * radiusCss() * TW / Wc());
    a.bg = LensTracker.patch(gray, TW, TH, [a.x - rh, a.y - rh, a.x + rh, a.y + rh]);
    a.bgCx = a.x; a.bgCy = a.y;
  }
  function setAnchor(cx, cy, track) {
    api.anchor = { x: cx, y: cy, t0: performance.now(), track: track || null, bg: null };
    api.placing = false; api.released = false; document.getElementById('place')?.classList.remove('on');
    if (prev) captureBg(prev);
    offSince = 0;
    window.dispatchEvent(new CustomEvent('lens-anchor', { detail: { t: api.anchor.t0 } }));
  }
  const topCentre = t => [(t.target[0] + t.target[2]) / 2, t.target[1]];

  api.place = (px, py) => {                                              // a click while placing: on a label = perch on it, elsewhere = sit on that spot
    const c = toCam(px, py);
    const hit = liveTracks().find(t => c.x >= t.target[0] && c.x <= t.target[2] && c.y >= t.target[1] && c.y <= t.target[3]);
    if (hit) { setAnchor(...topCentre(hit), hit); return { perched: hit.label }; }
    setAnchor(c.x, c.y); return {};
  };
  api.perchOn = name => {
    const n = name.toLowerCase().replace(/^(the|my|a|an)\s+/, '').trim();
    const t = liveTracks().find(t => t.label.toLowerCase() === n) || liveTracks().find(t => t.label.toLowerCase().includes(n) || n.includes(t.label.toLowerCase()));
    if (!t) return false; setAnchor(...topCentre(t), t); return t.label;
  };
  api.release = () => { api.anchor = null; api.released = true; window.dispatchEvent(new CustomEvent('lens-anchor', { detail: { t: 0 } })); };
  api.startPlacing = () => { api.placing = true; document.getElementById('place')?.classList.add('on'); status.textContent = 'click where the companion should sit (or on a label to perch on it)'; };

  api.view = () => {                                                      // what the companion needs to draw itself
    const a = api.anchor; if (!a) return { mode: 'floating' };
    const p = toScreen(a.x, a.y), m = mirror() ? -1 : 1;
    return { mode: 'anchored', x: p.x, y: p.y, scale: 0.8 + 0.55 * Math.min(1, Math.max(0, a.y / TH)),   // lower in the picture = closer = bigger
             landedAt: a.t0, perched: !!a.track, occluded: api.coverage,
             motion: { dx: api.motion.dx * Wc() / TW * m, dy: api.motion.dy * Hc() / TH, conf: api.motion.conf } };
  };
  window.lensCompanionWhere = () => {                                     // for the model: where the companion is
    const v = api.view(); if (v.mode !== 'anchored') return 'floating in the corner of the screen';
    const here = { cx: v.x / Wc() * LensScene.W, cy: v.y / Hc() * LensScene.H };
    const objs = LensScene.toView(liveTracks().map(t => ({ label: t.label, box: t.target.map(z => z * LensTracker.SCALE) })), mirror());
    const near = objs.map(o => ({ o, d: Math.hypot(o.cx - here.cx, o.cy - here.cy) })).sort((p, q) => p.d - q.d)[0];
    return `${v.perched ? 'perched on' : 'sitting in'} the ${v.perched && near ? near.o.label : LensScene.zone(here) + ' of the picture'}${!v.perched && near && near.d < 260 ? `, next to the ${near.o.label}` : ''}`;
  };

  function drawOcclusion(cur) {                                           // re-draw the real video over the companion wherever something changed in front of it
    octx.clearRect(0, 0, occ.width, occ.height); api.coverage = 0;
    const a = api.anchor; if (!a || !a.bg || a.track) return;
    const bg = a.bg, x1 = Math.round(a.x - bg.w / 2), y1 = Math.round(a.y - bg.h / 2);
    if (x1 < 0 || y1 < 0 || x1 + bg.w > TW || y1 + bg.h > TH) return;
    const patch = new Float32Array(bg.w * bg.h);
    for (let j = 0; j < bg.h; j++) for (let i = 0; i < bg.w; i++) patch[j * bg.w + i] = cur[(y1 + j) * TW + x1 + i];
    const { mask, coverage } = LensWorld.diffMask(bg.data, patch, bg.w, bg.h);
    api.coverage = coverage;
    if (stillTicks > 6 && coverage < 0.02) for (let i = 0; i < bg.data.length; i++) bg.data[i] += 0.04 * (patch[i] - bg.data[i]); // follow slow lighting changes
    if (coverage < 0.05) return;
    const cw = Wc() / TW, ch = Hc() / TH, ow = Math.max(2, Math.round(bg.w * cw)), oh = Math.max(2, Math.round(bg.h * ch));
    const mc = document.createElement('canvas'); mc.width = bg.w; mc.height = bg.h;
    const mctx = mc.getContext('2d'), id = mctx.createImageData(bg.w, bg.h);
    for (let i = 0; i < mask.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = mask[i] ? 255 : 0; }
    mctx.putImageData(id, 0, 0);
    const vc = document.createElement('canvas'); vc.width = ow; vc.height = oh; const vctx = vc.getContext('2d');
    vctx.drawImage(cam, x1 / TW * cam.videoWidth, y1 / TH * cam.videoHeight, bg.w / TW * cam.videoWidth, bg.h / TH * cam.videoHeight, 0, 0, ow, oh);
    vctx.globalCompositeOperation = 'destination-in'; vctx.filter = 'blur(2px)'; vctx.imageSmoothingEnabled = true; vctx.drawImage(mc, 0, 0, ow, oh);   // soft edge
    octx.drawImage(vc, x1 * cw, y1 * ch);
  }

  setInterval(() => {
    if (document.hidden || !cam.videoWidth) return;
    const cur = grabGray(); if (!cur) return;
    ticks++;
    if (prev) {
      const e = LensWorld.estimate(prev, cur, TW, TH);
      api.motion = { dx: e.dx, dy: e.dy, conf: e.conf, n: e.n }; api.fg = e.fg;
      stillTicks = (Math.abs(e.dx) + Math.abs(e.dy) < 0.5 && e.conf > 0.5) ? stillTicks + 1 : 0;
      const a = api.anchor;
      if (a) {
        const tr = a.track && liveTracks().includes(a.track) ? a.track : null;
        if (tr) { const [tx, ty] = topCentre(tr); a.x += (tx - a.x) * 0.5; a.y += (ty - a.y) * 0.5; }      // perched: ride on the object
        else {
          if (a.track) { a.track = null; captureBg(cur); }                                                 // the object is gone: stay where it was, now locked to the room
          if (e.conf >= 0.55 && e.n >= 6) { a.x += e.dx; a.y += e.dy; }                                    // world lock: move with the room
          if (a.bg && stillTicks > 12 && ticks % 15 === 0 && api.coverage < 0.05) {                        // camera still: pull back any drift
            const r = LensWorld.locate(a.bg, cur, TW, TH, a.x, a.y, 4);
            if (r.cost < 12 && (r.dx || r.dy)) { a.x += r.dx; a.y += r.dy; }
          }
        }
        const out = a.x < -12 || a.x > TW + 12 || a.y < -12 || a.y > TH + 12;                              // the room slid away: after a moment, hop back into view
        if (out) { offSince ||= performance.now(); if (performance.now() - offSince > 2500) setAnchor(TW * 0.8, TH * 0.78); } else offSince = 0;
      }
    }
    prev = cur;
    if (!api.anchor && enabled() && !api.released && performance.now() - started > 1500) setAnchor(TW * 0.8, TH * 0.78); // by default the companion sits on the table, not on the glass
    if (ticks % 2 === 0) drawOcclusion(cur);
  }, 66);

  // ---- commands ----
  const prevIntent = window.lensIntent;
  const say = (q, text) => { addMsg(text, 'bot'); history.push({ role: 'user', content: q }, { role: 'assistant', content: text }); window.onBotText?.(text, true); return true; };
  window.lensIntent = async question => {
    const t = question.trim().replace(/[?.!]+$/, ''); let m;
    if (/^(?:please )?(?:sit|land|stand|settle)(?: down)?(?: here| there)?$|^(?:place|put) yourself(?: here| there)?$|^come (?:and )?sit(?: here| down)?$/i.test(t)) { api.startPlacing(); return say(question, 'Click where I should sit, or on a labelled object to perch on it.'); }
    if ((m = t.match(/^(?:sit|perch|land|stand|stay) (?:on|next to|beside|by|near) (?:the |my )?(.+)$/i))) {
      const got = api.perchOn(m[1]);
      return say(question, got ? `Okay, I'm perched on the ${got}.` : `I don't see a ${m[1]} labelled. Say "label everything" first, then ask again.`);
    }
    if (/^(?:go|fly|come|get) back(?: to the corner| home)?$|^(?:go|fly) home$|^float(?: again)?$|^(?:reset|release) (?:your )?(?:position|anchor)$/i.test(t)) { api.release(); return say(question, "Okay, I'm floating in the corner again. Say 'sit here' to put me back in the room."); }
    return prevIntent ? prevIntent(question) : false;
  };
  document.getElementById('place')?.addEventListener('click', () => { if (api.placing) { api.placing = false; document.getElementById('place').classList.remove('on'); } else api.startPlacing(); });
}
