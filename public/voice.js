// Push-to-talk speech input + spoken replies (sentence by sentence while streaming).
// Two input engines: Chrome/Edge Web Speech API (cloud), or "offline mic": record in the browser and
// transcribe locally with faster-whisper through /api/stt (works in Firefox too).
const mic = document.getElementById('mic');
const speakBox = document.getElementById('speak');
const offlineBox = document.getElementById('offline');
const statusEl = document.getElementById('status');
const inputEl = document.getElementById('q');
const setState = s => window.dispatchEvent(new CustomEvent('lens-state', { detail: s }));

// --- Speech out (browser TTS, runs locally) ---
let spoken = 0;
window.onBotText = (text, done) => {
  if (!speakBox.checked) return;
  if (text.length < spoken) spoken = 0; // new answer started
  const pending = text.slice(spoken);
  const m = done ? [pending] : pending.match(/^[\s\S]*?[.!?](\s|$)/g); // complete sentences only
  const chunk = done ? pending : (m ? m.join('') : '');
  if (chunk.trim()) {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
  spoken = done ? 0 : spoken + chunk.length;
};

// --- Speech in ---
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
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
  } catch (e) { statusEl.textContent = 'offline mic: ' + e.message; setState('idle'); }
}

// --- push-to-talk wiring (button, or hold Space while the text box is not focused) ---
function start() {
  if (pressed) return;
  pressed = true;
  speechSynthesis.cancel(); spoken = 0;           // stop talking when the user speaks
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
