// Action recognition + recording.
//  "what am I doing?"       -> looks at the last ~4 s from a rolling frame buffer
//  "record [for N seconds]" -> records N s (and keeps a downloadable .webm), then describes what happened
// The browser measures the motion (motion.js); the vision model sees 2-3 key frames plus that measurement.
const A_BUF_MS = 12000, A_STEP_MS = 333, A_RECENT_MS = 4000;
const abuf = []; // {t, gray, jpg}
const aSmall = Object.assign(document.createElement('canvas'), { width: LensMotion.W, height: LensMotion.H }).getContext('2d', { willReadFrequently: true });
const aBig = Object.assign(document.createElement('canvas'), { width: 640, height: 360 }).getContext('2d');
setInterval(() => {
  if (document.hidden || !cam.videoWidth) return;
  aSmall.drawImage(cam, 0, 0, LensMotion.W, LensMotion.H);
  const gray = LensMotion.toGray(aSmall.getImageData(0, 0, LensMotion.W, LensMotion.H).data);
  aBig.drawImage(cam, 0, 0, 640, 360);
  abuf.push({ t: performance.now(), gray, jpg: aBig.canvas.toDataURL('image/jpeg', 0.7) });
  const cut = performance.now() - A_BUF_MS; while (abuf.length && abuf[0].t < cut) abuf.shift();
}, A_STEP_MS);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lensState = s => window.dispatchEvent(new CustomEvent('lens-state', { detail: s }));

function describeEntries(entries) { // -> {frames, motion, seconds} for ask(), or null if too little video
  if (entries.length < 6) return null;
  const seconds = (entries[entries.length - 1].t - entries[0].t) / 1000;
  const r = LensMotion.analyze(entries.map(e => e.gray), seconds);
  return { frames: r.keyIdx.map(i => entries[i].jpg), motion: r.summary, seconds };
}

async function recordClip(secs) {
  const bubble = addMsg('', 'bot'), t0 = performance.now();
  let rec, chunks = [];
  try { if (window.MediaRecorder && cam.srcObject) { rec = new MediaRecorder(cam.srcObject); rec.ondataavailable = e => chunks.push(e.data); rec.start(); } } catch { rec = null; }
  lensState('listening');
  while (performance.now() - t0 < secs * 1000) { bubble.textContent = `● Recording… ${Math.ceil(secs - (performance.now() - t0) / 1000)} s`; await sleep(200); }
  if (rec) { const stopped = new Promise(r => { rec.onstop = r; }); rec.stop(); await stopped; }
  bubble.textContent = `Recorded ${secs} s.`;
  if (chunks.length) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
    a.download = `lensmate-clip-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    a.textContent = ' 💾 Save clip'; a.style.color = 'var(--accent)';
    bubble.append(a);
  }
  return abuf.filter(f => f.t >= t0);
}

const RECENT = /^(?:what (?:am|are|was|were|is) (?:i|we|he|she|they|someone|somebody|it) doing|what did (?:i|we|he|she|they|someone|somebody) (?:just )?do|what(?:'s| is) (?:happening|going on)|what (?:action|movement|motion|activity)\b.*|describe (?:my|the|this) (?:action|movement|motion|activity))$/i;
const RECORD = /^(?:please\s+)?(?:start\s+)?(?:record(?:ing)?|watch|observe|film)(?:\s+(?:me|this|it|my action))?(?:\s+(?:for\s+)?(\d{1,2})\s*(?:s|sec|secs|second|seconds))?$/i;

const prevActionIntent = window.lensIntent;
window.lensIntent = async question => {
  const q = question.trim().replace(/[?.!]+$/, '');
  let m, entries;
  if (RECENT.test(q)) entries = abuf.filter(f => f.t >= performance.now() - A_RECENT_MS);
  else if ((m = q.match(RECORD))) entries = await recordClip(Math.min(10, Math.max(2, parseInt(m[1] || '5', 10))));
  else return prevActionIntent ? prevActionIntent(question) : false;
  const clip = describeEntries(entries);
  if (!clip) { const msg = 'I need a few more seconds of video first. Make sure the camera is on and try again.'; addMsg(msg, 'bot'); window.onBotText?.(msg, true); lensState('idle'); return true; }
  return clip; // ask() sends the key frames + measured motion to the model and streams the answer
};
