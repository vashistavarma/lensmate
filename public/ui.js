// Response modes, "teach me" memory (text facts + reference photos), and frame snapshot.
const modeSel = document.getElementById('mode');
const factsEl = document.getElementById('facts');
const memEl = document.getElementById('mem');
window.lensMode = () => modeSel.value;

// --- Teach-me memory, persisted in this browser ---
//   facts: short statements injected into every prompt
//   refs:  {name, image} reference photos; the server verifies each against the live frame (visual memory)
const MAX_REFS_STORED = 8;
let facts = [], refs = [];
try { facts = JSON.parse(localStorage.getItem('lensmate.facts') || '[]'); } catch {}
try { refs = JSON.parse(localStorage.getItem('lensmate.refs') || '[]'); } catch {}
const saveFacts = () => { try { localStorage.setItem('lensmate.facts', JSON.stringify(facts)); } catch {} showFacts(); };
function saveRefs() {
  for (;;) { // drop the oldest photo until it fits the browser's storage quota
    try { localStorage.setItem('lensmate.refs', JSON.stringify(refs)); break; } catch { if (!refs.length) break; refs.shift(); }
  }
  showFacts();
}
const showFacts = () => { factsEl.textContent = `🧠 ${facts.length} · 📷 ${refs.length}`; if (!memEl.hidden) renderMem(); };
window.lensFacts = () => facts;
window.lensRefs = () => refs;
showFacts();

function grabRefFrame() { // 512 px wide JPEG of the current view (small: it is sent for each check)
  if (!cam.videoWidth) return null;
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * cam.videoHeight / cam.videoWidth);
  c.getContext('2d').drawImage(cam, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

const prevIntent = window.lensIntent; // spatial commands live in spatial.js
window.lensIntent = async question => {
  const q = question.trim();
  const article = /^(?:an?\s+|the\s+)?/i;
  let m, reply = null;
  if (/^forget (everything|all)\b/i.test(q)) { facts = []; refs = []; saveFacts(); saveRefs(); reply = 'Okay, I have forgotten everything you taught me, including photos.'; }
  else if (/^what do you (remember|know)\b/i.test(q))
    reply = (facts.length || refs.length) ? `You taught me: ${facts.join('; ') || 'no facts'}. Photos: ${refs.map(r => r.name).join(', ') || 'none'}.` : 'You have not taught me anything yet.';
  else if ((m = q.match(/^(?:remember|learn|save)\s+this\s+as\s+(.+)$/i)) ||
           (!q.endsWith('?') && (m = q.match(/^(?:this|that|it)\s+(?:is|'s)\s+(?:called\s+)?(.+)$/i)))) {
    // "this is X" / "remember this as X": store the words AND a reference photo of what the camera sees
    const name = m[1].replace(/[.!]+$/, '').replace(article, '').slice(0, 60);
    facts.push(`this is a ${name}`); saveFacts();
    const img = grabRefFrame();
    if (img) { refs.push({ name, image: img }); if (refs.length > MAX_REFS_STORED) refs.shift(); saveRefs(); }
    reply = img ? `Got it. I saved a photo and will recognise the ${name} next time. Tip: hold it close and centred when teaching.`
                : `Got it, I will remember it is a ${name} (no camera frame, so no photo).`;
  } else if ((m = q.match(/^(?:remember|note)(?: that)?\s+(.+)$/i))) {
    const fact = m[1].replace(/[.!]+$/, '').slice(0, 200); facts.push(fact); saveFacts();
    reply = `Got it, I will remember: ${fact}.`;
  }
  if (reply === null) return prevIntent ? prevIntent(question) : false;
  addMsg(reply, 'bot');
  history.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
  window.onBotText?.(reply, true);
  return true;
};

// --- Snapshot: download the current frame (1204x672) to build the evaluation set from real objects ---
document.getElementById('snap').addEventListener('click', () => {
  const f = grabDetectFrame(); if (!f) return;
  const a = document.createElement('a');
  a.href = f; a.download = `lensmate_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`; a.click();
});

// --- Memory panel: see and delete what was taught (photos and facts) ---
function renderMem() {
  memEl.replaceChildren();
  const head = t => { const d = document.createElement('div'); d.className = 'memhead'; d.textContent = t; memEl.append(d); };
  const row = (label, img, onDelete) => {
    const d = document.createElement('div'); d.className = 'memrow';
    if (img) { const i = document.createElement('img'); i.src = img; d.append(i); }
    const sp = document.createElement('span'); sp.textContent = label; // textContent: taught text is never parsed as HTML
    const b = document.createElement('button'); b.textContent = '✕'; b.title = 'Delete'; b.onclick = onDelete;
    d.append(sp, b); memEl.append(d);
  };
  if (!facts.length && !refs.length) { const d = document.createElement('div'); d.textContent = "Nothing taught yet. Hold an object up and say \"this is a …\"."; memEl.append(d); return; }
  if (refs.length) head('Photos');
  refs.forEach((r, i) => row(r.name, r.image, () => { refs.splice(i, 1); saveRefs(); }));
  if (facts.length) head('Facts');
  facts.forEach((f, i) => row(f, null, () => { facts.splice(i, 1); saveFacts(); }));
}
factsEl.addEventListener('click', () => { memEl.hidden = !memEl.hidden; if (!memEl.hidden) renderMem(); });
showFacts();

// --- First-run help: welcome message + one-tap suggestions ---
window.lensWelcome = () => { addMsg("Hi, I'm LensMate. Hold 🎤 (or Space) to talk, or type. I can describe what the camera sees, label and follow objects, click any object to ask about it, and learn new ones: hold something up and say \"this is a …\".", 'bot').classList.add('welcome'); }; // not saved into chat history
window.lensWelcome();
const chipsEl = document.getElementById('chips'), inputEl2 = document.getElementById('q');
[['🔍 Label everything', 'label everything', true], ['🎬 What am I doing?', 'what am I doing?', true], ['⏺ Record 5 s', 'record for 5 seconds', true], ['What is this?', 'What is this?', true], ['Find…', 'find ', false],
 ['This is…', 'this is a ', false], ['What do you remember?', 'what do you remember?', true]].forEach(([label, text, send]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label;
  b.onclick = () => { if (send) window.lensAsk(text); else { inputEl2.value = text; inputEl2.focus(); } };
  chipsEl.append(b);
});

// --- Service lights (vision model in Ollama, offline speech service) ---
const healthEl = document.getElementById('health');
async function pollHealth() {
  try {
    const h = await (await fetch('/api/health')).json();
    healthEl.innerHTML = '';
    for (const [name, ok, tip] of [['vision', h.vision, `model ${h.model} ${h.vision ? 'ready' : 'not found: run ollama pull ' + h.model}`], ['speech', h.speech, h.speech ? 'offline speech ready' : 'offline speech service not running (optional)']]) {
      const d = document.createElement('span'); d.className = 'dot ' + (ok ? 'ok' : 'bad'); d.title = tip;
      healthEl.append(d, name);
    }
  } catch { healthEl.textContent = 'server unreachable'; }
}
pollHealth(); setInterval(pollHealth, 5000);
