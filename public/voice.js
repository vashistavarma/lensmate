// Push-to-talk speech input + spoken replies (sentence by sentence while streaming).
// Two input engines: Chrome/Edge Web Speech API (cloud), or "offline mic": record in the browser and
// transcribe locally with faster-whisper through /api/stt (works in Firefox too).
const mic = document.getElementById('mic');
const speakBox = document.getElementById('speak');
const offlineBox = document.getElementById('offline');
const statusEl = document.getElementById('status');
const inputEl = document.getElementById('q');
const setState = s => window.dispatchEvent(new CustomEvent('lens-state', { detail: s }));

// --- Speech out ---
// Preferred: a local neural voice (Piper) served by our own speech service, so replies are spoken without any cloud voice.
// Fallback: the browser's voice (in Chrome that is an online Google voice, so the reply text would leave the computer).
let localTts = false;
fetch('/api/health').then(r => r.json()).then(h => { localTts = !!h.tts; }).catch(() => {});
let audioCtx = null, ttsGen = 0, playChain = Promise.resolve(), ttsPending = 0, currentSrc = null;
const actx = () => { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); return audioCtx; };

let analyser = null, lvBuf = null;                                   // the mouth follows the loudness of the local voice
function levelNode() {
  if (!analyser) { analyser = actx().createAnalyser(); analyser.fftSize = 512; analyser.connect(actx().destination); lvBuf = new Uint8Array(analyser.fftSize); }
  return analyser;
}
window.lensVoiceLevel = () => {                                       // 0..1, 0 when nothing local is playing
  if (!analyser || !currentSrc) return 0;
  analyser.getByteTimeDomainData(lvBuf);
  let s = 0; for (let i = 0; i < lvBuf.length; i++) { const v = (lvBuf[i] - 128) / 128; s += v * v; }
  return Math.min(1, Math.sqrt(s / lvBuf.length) * 4);
};
function speakBrowser(text) { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); }
function speakLocal(text) {
  const gen = ttsGen; ttsPending++;
  // start synthesising now (in parallel with the previous sentence still playing); play in order
  const audio = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    .then(r => { if (!r.ok) throw new Error('tts ' + r.status); return r.arrayBuffer(); }).then(b => actx().decodeAudioData(b));
  audio.catch(() => {});
  playChain = playChain.then(async () => {
    try {
      const buf = await audio;
      if (gen !== ttsGen) return;                                   // interrupted while waiting
      await new Promise(res => {
        const src = actx().createBufferSource(); src.buffer = buf; src.connect(levelNode()); currentSrc = src;
        src.onended = res; src.start();
        setTimeout(res, buf.duration * 1000 + 800);               // watchdog: with no working audio output "ended" may never fire; never stall the queue
      });
    } catch { if (gen === ttsGen) speakBrowser(text); }              // the local voice failed: use the browser voice instead
    finally { ttsPending = Math.max(0, ttsPending - 1); currentSrc = null; }
  });
}
const speak = text => (localTts ? speakLocal(text) : speakBrowser(text));
function stopSpeaking() { ttsGen++; try { currentSrc?.stop(); } catch {} speechSynthesis.cancel(); playChain = Promise.resolve(); ttsPending = 0; currentSrc = null; }
window.lensStopSpeaking = stopSpeaking;
window.lensTtsActive = () => ttsPending > 0 || !!currentSrc;      // the companion keeps "speaking" while audio plays
speakBox.addEventListener('change', () => { if (!speakBox.checked) stopSpeaking(); });

let spoken = 0;
window.onBotText = (text, done) => {
  if (!speakBox.checked) return;
  if (text.length < spoken) spoken = 0; // new answer started
  const pending = text.slice(spoken);
  const m = done ? [pending] : pending.match(/^[\s\S]*?[.!?](\s|$)/g); // complete sentences only
  let chunk = done ? pending : (m ? m.join('') : '');
  if (!done && !chunk && spoken === 0 && pending.length >= 45) {          // first words of an answer: do not wait for a full sentence, start at the last clause break
    const c = pending.match(/^[\s\S]{30,}[,;:](\s)/); if (c) chunk = c[0];
  }
  if (chunk.trim()) speak(chunk);
  spoken = done ? 0 : spoken + chunk.length;
};

// --- Speech in ---
const SR = window.lensmateDesktop ? null : (window.SpeechRecognition || window.webkitSpeechRecognition); // desktop app: no cloud speech
let offline = !SR; // no Web Speech API (e.g. Firefox): offline engine is the only option
try { const v = localStorage.getItem('lensmate.offline'); if (SR && v !== null) offline = v === '1'; } catch {}
offlineBox.checked = offline;
if (!SR) { offlineBox.disabled = true; offlineBox.title = 'Only option in this browser'; }
offlineBox.addEventListener('change', () => {
  offline = offlineBox.checked;
  try { localStorage.setItem('lensmate.offline', offline ? '1' : '0'); } catch {}
});

let pressed = false;

// Engine 1: Web Speech API (Chrome/Edge send the audio to the browser vendor's service)
let rec, webListening = false, finalText = '';
if (SR) {
  rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  rec.onresult = e => { finalText = [...e.results].map(r => r[0].transcript).join(''); inputEl.value = finalText; };
  rec.onend = () => {
    webListening = false; mic.classList.remove('live');
    const q = finalText.trim(); finalText = '';
    if (q) { inputEl.value = ''; window.lensAsk(q); }
    else { statusEl.textContent = 'camera live'; setState('idle'); }
  };
  rec.onerror = e => { statusEl.textContent = 'mic: ' + e.error; };
}
const startWeb = () => {
  if (webListening) return;
  webListening = true; finalText = '';
  try { rec.start(); } catch {}
};
const stopWeb = () => { if (webListening) rec.stop(); };

// Engine 2: record with MediaRecorder, transcribe locally (faster-whisper via /api/stt)
let stream, recorder, chunks = [], recStart = 0;
async function startOffline() {
  try {
    stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) { statusEl.textContent = 'mic: ' + e.message; endPress(); return; }
  if (!pressed) { endPress(); return; } // released while the permission prompt / device was opening
  chunks = []; recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = transcribe;
  recorder.start(); recStart = performance.now();
}
const stopOffline = () => { if (recorder?.state === 'recording') recorder.stop(); };

async function transcribe() {
  mic.classList.remove('live');
  if (performance.now() - recStart < 400) { statusEl.textContent = 'too short: hold the button while you speak'; setState('idle'); return; }
  statusEl.textContent = 'transcribing offline…'; setState('thinking');
  try {
    const hw = encodeURIComponent((window.lensRefs?.() || []).map(r => r.name).join(',')); // taught names help Whisper spell them
    const t0 = performance.now();
    const res = await fetch('/api/stt?hw=' + hw, { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    const text = (j.text || '').trim();
    statusEl.textContent = `heard in ${((performance.now() - t0) / 1000).toFixed(1)}s (offline)`;
    if (text) window.lensAsk(text); else { statusEl.textContent = 'did not catch that'; setState('idle'); }
  } catch (e) {
    statusEl.textContent = /not running|not available/i.test(e.message) ? 'Voice needs the optional speech add-on: you can type instead' : 'offline mic: ' + e.message;
    setState('idle');
  }
}

// --- push-to-talk wiring (button, or hold Space while the text box is not focused) ---
function start() {
  if (pressed) return;
  pressed = true;
  stopSpeaking(); spoken = 0;                     // stop talking when the user speaks
  mic.classList.add('live'); setState('listening');
  statusEl.textContent = offline ? '🎤 recording (offline)…' : '🎤 listening…';
  if (offline) startOffline(); else startWeb();
}
function endPress() { pressed = false; }
function stop() {
  if (!pressed) return;
  pressed = false;
  if (offline) stopOffline(); else stopWeb();
  if (offline && !(recorder?.state === 'recording')) { mic.classList.remove('live'); setState('idle'); } // never started
}
mic.addEventListener('pointerdown', start);
mic.addEventListener('pointerup', stop);
mic.addEventListener('pointerleave', stop);
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && document.activeElement.id !== 'q') { e.preventDefault(); start(); } });
addEventListener('keyup', e => { if (e.code === 'Space') stop(); });
