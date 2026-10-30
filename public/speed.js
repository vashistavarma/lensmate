// Latency: the taught-photo check (one model call per photo, ~1.3 s each) used to run AFTER you sent a question.
// Now it starts when you press the mic or type a letter, is reused while the scene stays the same, and is skipped
// for questions it cannot help with. Questions get the same answers, only sooner.
const MATCH_TTL_MS = 25000;   // how long a result stays valid
const SAME_SCENE = 10;        // mean gray difference (0-255) on a 16x9 thumbnail below which the scene counts as unchanged
const NO_NEED = /^(how many|count|what colou?r|what time|read|translate|what does (it|this|that|the .+) say|how (big|far|tall|long|much))\b/i;

let mcache = null;            // { t, sig, key, names }
let minflight = null;         // { sig, key, promise }

function remember(names) { // most recently recognised first, so the next blocking check tries it first
  if (!names.length) return;
  recent = [...names, ...recent.filter(n => !names.includes(n))].slice(0, 8);
  try { localStorage.setItem('lensmate.recent', JSON.stringify(recent)); } catch {}
}

const sigCtx = Object.assign(document.createElement('canvas'), { width: 16, height: 9 }).getContext('2d', { willReadFrequently: true });
function sceneSig() {
  if (!cam.videoWidth) return null;
  sigCtx.drawImage(cam, 0, 0, 16, 9);
  const d = sigCtx.getImageData(0, 0, 16, 9).data, s = new Uint8Array(144);
  for (let i = 0; i < 144; i++) s[i] = (d[4 * i] * 77 + d[4 * i + 1] * 150 + d[4 * i + 2] * 29) >> 8;
  return s;
}
const sceneDiff = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };
let recent = []; try { recent = JSON.parse(localStorage.getItem('lensmate.recent') || '[]'); } catch {}   // names recognised lately, most recent first
const refsList = () => (window.lensRefs?.() || []).slice().sort((a, b) => (recent.indexOf(a.name) + 1 || 99) - (recent.indexOf(b.name) + 1 || 99)); // likeliest first
const refsKey = () => refsList().map(r => r.name + ':' + r.image.length).sort().join('|'); // changes when something is taught or deleted (NOT when the check order changes)
const fresh = (c, key, sig) => c && c.key === key && sig && c.sig && performance.now() - (c.t ?? performance.now()) < MATCH_TTL_MS && sceneDiff(c.sig, sig) < SAME_SCENE;

async function runMatch(image, first = false) {
  const res = await fetch('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, refs: refsList(), first }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.matched || [];
}

function startMatch(image, sig, key, first = false) {
  const p = runMatch(image, first).then(names => { remember(names); mcache = { t: performance.now(), sig, key, names }; return names; })
    .finally(() => { if (minflight && minflight.promise === p) minflight = null; });
  p.catch(() => {});
  minflight = { sig, key, promise: p };
  return p;
}

// ---- pre-read the camera frame (the biggest part of the wait) ----
// The model needs ~1.1 s to read a new frame. If the server reads it BEFORE the question arrives (same system prompt, same history,
// same picture), Ollama keeps that reading and the real question needs ~20 ms for it. We remember which frame was pre-read and
// send exactly that frame with the question, as long as the scene, the chat so far, the mode and the taught facts are unchanged.
let warm = null; // { img, sig, t, key }
const prewarmOn = () => { try { return localStorage.getItem('lensmate.prewarm') !== '0'; } catch { return true; } };
const warmKey = n => JSON.stringify([history.slice(0, n), window.lensMode?.(), window.lensFacts?.()]);
const warmValid = (sig, nPrior) => !!(warm && sig && performance.now() - warm.t < 25000 && warm.key === warmKey(nPrior) && sceneDiff(warm.sig, sig) < SAME_SCENE);
function startWarm(img, sig) {
  const n = history.length;
  const mine = warm = { img, sig, t: performance.now(), key: warmKey(n) };
  fetch('/api/prewarm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: img, messages: history.slice(0, n), mode: window.lensMode?.(), facts: window.lensFacts?.() }) })
    .catch(() => { if (warm === mine) warm = null; });
}
// ask() calls this after the question is already in history, so the chat "before the question" has one entry fewer
window.lensWarmFor = () => (prewarmOn() && warmValid(sceneSig(), history.length - 1)) ? warm : null;

// Called when the user starts speaking or typing (or the picture settles): read the frame, then check the taught objects.
function prefetchMatch() {
  if (!cam.videoWidth) return;
  const sig = sceneSig(); if (!sig) return;
  const key = refsKey();
  const needWarm = prewarmOn() && !warmValid(sig, history.length);
  const needMatch = refsList().length && !(fresh(mcache, key, sig) || (minflight && minflight.key === key && sceneDiff(minflight.sig, sig) < SAME_SCENE));
  if (!needWarm && !needMatch) return;
  const img = grabFrame();
  if (needWarm) startWarm(img, sig);          // first: every question needs the picture read
  if (needMatch) startMatch(img, sig, key);   // then the taught-object checks
}
window.addEventListener('lens-state', e => { if (e.detail === 'listening') prefetchMatch(); });
document.getElementById('q').addEventListener('input', e => { if (e.target.value.length === 1) prefetchMatch(); });

// -> { names, skipped } or undefined (nothing taught: the server has nothing to check either)
window.lensMatchFor = async (question, image, isCrop) => {
  const refs = refsList();
  if (!refs.length) return undefined;
  const mentions = refs.some(r => question.toLowerCase().includes(String(r.name).toLowerCase()));
  if (window.lensMode?.() === 'read' || (NO_NEED.test(question.trim()) && !mentions)) return { names: [], skipped: true };
  const key = refsKey();
  if (isCrop) { const names = await runMatch(image, true); remember(names); return { names, skipped: false }; } // a click zooms into a crop, so the full-frame result does not apply
  const sig = sceneSig();
  if (fresh(mcache, key, sig)) return { names: mcache.names, skipped: false };
  if (minflight && minflight.key === key && sig && sceneDiff(minflight.sig, sig) < SAME_SCENE) {
    status.textContent = 'checking taught objects…';
    try { return { names: await minflight.promise, skipped: false }; } catch {}
  }
  const names = await startMatch(image, sig, key, true); // nothing ready and the user is waiting: likeliest object first, stop at the first match
  return { names, skipped: false };
};

// Auto-check: once the picture has been still for a moment, check the taught objects in the background, so the answer to
// the next question is usually ready before you even start speaking. Idle when nothing is taught, the tab is hidden,
// or a question is being answered; at most one background check every few seconds.
let lastSig = null, changedAt = performance.now(), lastAuto = -1e9; // lastAuto: time of the last background check (none yet)
setInterval(() => {
  if (document.hidden || !cam.videoWidth) return;
  try { if (localStorage.getItem('lensmate.autocheck') === '0') return; } catch {}   // opt out: localStorage 'lensmate.autocheck' = '0'
  const sig = sceneSig(); if (!sig) return;
  if (lastSig && sceneDiff(lastSig, sig) > SAME_SCENE) changedAt = performance.now();
  lastSig = sig;
  const settled = performance.now() - changedAt > 900;
  const busy = document.getElementById('send').disabled;
  if (settled && !busy && !minflight && performance.now() - lastAuto > 6000) { lastAuto = performance.now(); prefetchMatch(); } // does nothing if everything is already fresh
}, 700);
