// Spatial labels. "find X" / "label everything" (or the 🔍 button) asks the VLM for boxes, then
// draws them over the live video. A lightweight tracker (tracker.js) keeps them on the objects.
const overlay = document.getElementById('overlay');
const DET_W = 1204, DET_H = 672; // must match the server (see detect() in server.js)
const LOST_COST = 16, MAX_MISS = 8;
const LABEL_TTL_MS = 20000;               // a label never outlives this, even if it still seems to match
const ANCHOR_MIN = 0.4, ANCHOR_BLEND = 0.8, GONE_TICKS = 10; // object 'gone': correlation with its detected look < 0.4 for 10 ticks (~0.5 s)
let clearTimer, tracks = [], prevGray = null, trackRaf = 0, lastTick = 0;
const gctx = Object.assign(document.createElement('canvas'), { width: LensTracker.TW, height: LensTracker.TH }).getContext('2d', { willReadFrequently: true });
const S = LensTracker.SCALE;

function grabDetectFrame() {
  if (!cam.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = DET_W; c.height = DET_H;
  c.getContext('2d').drawImage(cam, 0, 0, DET_W, DET_H); // slight stretch if camera is not 16:9
  return c.toDataURL('image/jpeg', 0.85);
}

function grabGray() {
  if (!cam.videoWidth) return null;
  gctx.drawImage(cam, 0, 0, LensTracker.TW, LensTracker.TH);
  return LensTracker.toGray(gctx.getImageData(0, 0, LensTracker.TW, LensTracker.TH).data);
}

// Start following the detected boxes. The model took ~1-3 s to answer, so first re-locate each
// box from the frame it was detected in (gray0) to the current frame with a wide search.
function startTracking(boxes, gray0) {
  const cur = grabGray();
  tracks = boxes.map(b => {
    const box = b.box.map(v => v / S);
    const r = gray0 && cur ? LensTracker.track(gray0, cur, LensTracker.TW, LensTracker.TH, box, 20) : { box };
    return { label: b.label, target: r.box, shown: r.box.slice(), miss: 0, gone: 0, anchor: cur ? LensTracker.patch(cur, LensTracker.TW, LensTracker.TH, r.box) : null };
  });
  prevGray = cur; lastTick = 0;
  cancelAnimationFrame(trackRaf); trackRaf = requestAnimationFrame(tick);
  clearTimeout(clearTimer); clearTimer = setTimeout(clearOverlay, LABEL_TTL_MS);
}

function tick(ts) {
  trackRaf = requestAnimationFrame(tick);
  if (ts - lastTick >= 50) { // track at ~20 fps, draw at display rate
    lastTick = ts;
    const cur = grabGray();
    if (cur && prevGray) {
      for (const t of tracks) {
        const r = LensTracker.track(prevGray, cur, LensTracker.TW, LensTracker.TH, t.target, 6);
        if (r.cost !== null) { if (r.cost > LOST_COST) t.miss++; else { t.miss = 0; t.target = r.box; } } // cost null: untextured, box stays
        // is the detected object still there? (the box may be following the background after the object left)
        const sc = LensTracker.anchorScore(cur, LensTracker.TW, LensTracker.TH, t.target, t.anchor);
        if (sc !== null) {
          if (sc < ANCHOR_MIN) t.gone++;
          else { t.gone = 0; if (sc > ANCHOR_BLEND) LensTracker.blendAnchor(t.anchor, cur, LensTracker.TW, t.target, 0.15); }
        }
      }
      tracks = tracks.filter(t => t.miss < MAX_MISS && t.gone < GONE_TICKS); // object left the view, was replaced, or the scene changed
      if (!tracks.length) return clearOverlay();
    }
    prevGray = cur;
  }
  for (const t of tracks) t.shown = t.shown.map((v, i) => v + (t.target[i] - v) * 0.5); // smooth the 4 px steps
  drawBoxes(tracks.map(t => ({ label: t.label, box: t.shown.map(v => v * S) })));
}

function clearOverlay() {
  cancelAnimationFrame(trackRaf); tracks = [];
  clearTimeout(clearTimer);
  window.dispatchEvent(new CustomEvent('lens-point', { detail: null }));
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

function drawBoxes(boxes) {
  const cw = overlay.clientWidth * devicePixelRatio, ch = overlay.clientHeight * devicePixelRatio;
  if (overlay.width !== cw || overlay.height !== ch) { overlay.width = cw; overlay.height = ch; } // resizing clears the canvas
  const ctx = overlay.getContext('2d');
  const sx = overlay.width / DET_W, sy = overlay.height / DET_H;
  const mir = !!window.lensMirror?.(); // mirrored view: boxes are in true-camera coordinates, flip them for the screen
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.font = `${14 * devicePixelRatio}px system-ui`;
  boxes.forEach(({ label, box: [x1, y1, x2, y2] }, i) => {
    const color = `hsl(${(i * 67 + 170) % 360} 85% 60%)`;
    const x = (mir ? DET_W - x2 : x1) * sx, y = y1 * sy, w = (x2 - x1) * sx, h = (y2 - y1) * sy;
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10 * devicePixelRatio;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;
    const tw = ctx.measureText(label).width + 12 * devicePixelRatio, th = 22 * devicePixelRatio;
    const ty = y - th < 0 ? y : y - th; // keep the tag on screen
    ctx.fillStyle = color; ctx.fillRect(x, ty, tw, th);
    ctx.fillStyle = '#04201d'; ctx.fillText(label, x + 6 * devicePixelRatio, ty + 16 * devicePixelRatio);
  });
  // fly the companion next to the first labelled object (box centre-top, in CSS px)
  const [bx1, by1, bx2] = boxes[0].box;
  const bcx = (bx1 + bx2) / 2;
  window.dispatchEvent(new CustomEvent('lens-point', { detail: { x: (mir ? DET_W - bcx : bcx) * sx / devicePixelRatio, y: by1 * sy / devicePixelRatio } }));
}

async function runDetect(query) {
  const frame = grabDetectFrame(), gray0 = grabGray();
  if (!frame) return 'The camera is not ready yet.';
  const res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: frame, query, facts: window.lensFacts?.() }) });
  const j = await res.json();
  if (j.error) return '⚠ ' + j.error;
  if (!j.boxes.length) { clearOverlay(); return query ? `I could not spot ${query}.` : 'I could not spot any clear objects.'; }
  startTracking(j.boxes, gray0);
  const names = j.boxes.map(b => b.label);
  return query ? `Found ${names.join(', ')}.` : `I can see: ${names.join(', ')}.`;
}

// Returns true when the message was a spatial command (handled here instead of normal chat).
window.lensIntent = async question => {
  const q = question.trim().replace(/[?.!]+$/, '');
  let m, query = null, spatial = false;
  if (/^(clear|hide)( the)?( labels| boxes| overlay)?$/i.test(q)) { clearOverlay(); addMsg('Cleared.', 'bot'); return true; }
  if ((m = q.match(/^(?:find|locate|highlight|point (?:to|at)|show me|where(?: is|'s| are))\s+(?:the |a |an |my )?(.+)$/i))) { query = m[1]; spatial = true; }
  else if (/^(label|detect|scan|identify)\b|^what (objects|things)|^what do you see$/i.test(q)) spatial = true;
  if (!spatial) return false;
  const bubble = addMsg('Scanning…', 'bot');
  const t0 = performance.now();
  let reply;
  try { reply = await runDetect(query); } catch (e) { reply = '⚠ ' + e.message; }
  bubble.textContent = reply;
  history.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
  window.onBotText?.(reply, true);
  status.textContent = `scan in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
  return true;
};

document.getElementById('scan').addEventListener('click', () => window.lensAsk('label everything'));

// --- Click-to-ask: click an object in the video; LensMate zooms into that spot (a crop at the camera's
// native resolution, so small parts get more pixels), asks about it, and the companion flies there. ---
const wrapEl = document.getElementById('wrap');
const CROP_FRAC = 0.4; // crop width as a fraction of the frame
function cropAround(fx, fy) { // fx, fy in 0..1 of the video; returns a 1204x672 JPEG of the zoomed region
  const vw = cam.videoWidth, vh = cam.videoHeight;
  const cw = vw * CROP_FRAC, ch = cw * DET_H / DET_W;           // keep 16:9 like the detect frame
  const x = Math.min(Math.max(fx * vw - cw / 2, 0), vw - cw), y = Math.min(Math.max(fy * vh - ch / 2, 0), vh - ch);
  const c = document.createElement('canvas'); c.width = DET_W; c.height = DET_H;
  c.getContext('2d').drawImage(cam, x, y, cw, ch, 0, 0, DET_W, DET_H);
  return c.toDataURL('image/jpeg', 0.88);
}
wrapEl.addEventListener('click', e => {
  if (!cam.videoWidth) return;
  const r = wrapEl.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (window.lensWorld?.placing) { const res = window.lensWorld.place(px, py); const ring0 = document.createElement('div'); ring0.className = 'ping'; ring0.style.left = px + 'px'; ring0.style.top = py + 'px'; wrapEl.append(ring0); setTimeout(() => ring0.remove(), 1300); status.textContent = res.perched ? `perched on the ${res.perched}` : 'companion placed'; return; } // placing mode: this click sets the companion's spot instead of asking a question
  const ring = document.createElement('div'); ring.className = 'ping'; ring.style.left = px + 'px'; ring.style.top = py + 'px';
  wrapEl.append(ring); setTimeout(() => ring.remove(), 1300);
  window.dispatchEvent(new CustomEvent('lens-point', { detail: { x: px, y: py } })); // companion flies to the click
  clearTimeout(clearTimer); clearTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('lens-point', { detail: null })), 8000);
  window.lensAsk('What is the object at the centre of this zoomed view? Name it specifically.', cropAround(window.lensMirror?.() ? 1 - px / r.width : px / r.width, py / r.height)); // the click is on the mirrored picture
});
