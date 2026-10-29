// Step 3: spatial labels. "find X" / "label everything" (or the 🔍 button) asks the VLM for
// boxes, then draws them over the live video. Labels are pinned to the screen, not tracked.
const overlay = document.getElementById('overlay');
const DET_W = 1204, DET_H = 672; // must match the server (see detect() in server.js)
let clearTimer;

function grabDetectFrame() {
  if (!cam.videoWidth) return null;
  const c = document.createElement('canvas');
  c.width = DET_W; c.height = DET_H;
  c.getContext('2d').drawImage(cam, 0, 0, DET_W, DET_H); // slight stretch if camera is not 16:9
  return c.toDataURL('image/jpeg', 0.85);
}

function clearOverlay() {
  clearTimeout(clearTimer);
  window.dispatchEvent(new CustomEvent('lens-point', { detail: null }));
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

function drawBoxes(boxes) {
  overlay.width = overlay.clientWidth * devicePixelRatio;
  overlay.height = overlay.clientHeight * devicePixelRatio;
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
  clearTimeout(clearTimer);
  clearTimer = setTimeout(clearOverlay, 15000); // stale labels are misleading once the view moves
}

async function runDetect(query) {
  const frame = grabDetectFrame();
  if (!frame) return 'The camera is not ready yet.';
  const res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: frame, query, facts: window.lensFacts?.() }) });
  const j = await res.json();
  if (j.error) return '⚠ ' + j.error;
  if (!j.boxes.length) { clearOverlay(); return query ? `I could not spot ${query}.` : 'I could not spot any clear objects.'; }
  drawBoxes(j.boxes);
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
