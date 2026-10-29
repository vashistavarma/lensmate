// Spatial labels. "find X" / "label everything" (or the 🔍 button) asks the VLM for boxes, then
// draws them over the live video. A lightweight tracker (tracker.js) keeps them on the objects.
const overlay = document.getElementById('overlay');
const DET_W = 1204, DET_H = 672; // must match the server (see detect() in server.js)
const LOST_COST = 16, MAX_MISS = 8, LABEL_TTL_MS = 60000; // see eval/test_tracker.js for the threshold
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
    return { label: b.label, target: r.box, shown: r.box.slice(), miss: 0 };
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
        if (r.cost === null) continue;                     // untextured patch: keep the box where it is
        if (r.cost > LOST_COST) t.miss++; else { t.miss = 0; t.target = r.box; }
      }
      tracks = tracks.filter(t => t.miss < MAX_MISS);      // object left the view or the scene changed
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
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.font = `${14 * devicePixelRatio}px system-ui`;
  boxes.forEach(({ label, box: [x1, y1, x2, y2] }, i) => {
    const color = `hsl(${(i * 67 + 170) % 360} 85% 60%)`;
    const x = x1 * sx, y = y1 * sy, w = (x2 - x1) * sx, h = (y2 - y1) * sy;
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
  window.dispatchEvent(new CustomEvent('lens-point', { detail: { x: ((bx1 + bx2) / 2) * sx / devicePixelRatio, y: by1 * sy / devicePixelRatio } }));
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
