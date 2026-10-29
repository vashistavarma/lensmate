// Step 2: push-to-talk speech input + spoken replies (sentence by sentence while streaming).
const mic = document.getElementById('mic');
const speakBox = document.getElementById('speak');
const statusEl = document.getElementById('status');

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

// --- Speech in (Web Speech API; Chrome/Edge send audio to the browser vendor's service) ---
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  mic.disabled = true; mic.title = 'Speech recognition needs Chrome or Edge';
} else {
  const rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  let listening = false, finalText = '';

  rec.onresult = e => {
    finalText = [...e.results].map(r => r[0].transcript).join('');
    document.getElementById('q').value = finalText;
  };
  rec.onend = () => {
    listening = false; mic.classList.remove('live');
    const q = finalText.trim(); finalText = '';
    if (q) { document.getElementById('q').value = ''; window.lensAsk(q); }
    else { statusEl.textContent = 'camera live'; window.dispatchEvent(new CustomEvent('lens-state', { detail: 'idle' })); }
  };
  rec.onerror = e => { statusEl.textContent = 'mic: ' + e.error; };

  const start = () => {
    if (listening) return;
    speechSynthesis.cancel(); spoken = 0;           // stop talking when the user speaks
    listening = true; finalText = '';
    window.dispatchEvent(new CustomEvent('lens-state', { detail: 'listening' }));
    mic.classList.add('live'); statusEl.textContent = '🎤 listening…';
    try { rec.start(); } catch {}
  };
  const stop = () => { if (listening) rec.stop(); };

  mic.addEventListener('pointerdown', start);
  mic.addEventListener('pointerup', stop);
  mic.addEventListener('pointerleave', stop);
  addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && document.activeElement.id !== 'q') { e.preventDefault(); start(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') stop(); });
}
