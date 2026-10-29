// Response modes, "teach me" memory (text facts + reference photos), and frame snapshot.
const modeSel = document.getElementById('mode');
const factsEl = document.getElementById('facts');
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
const showFacts = () => { factsEl.textContent = (facts.length || refs.length) ? `🧠 ${facts.length} facts · 📷 ${refs.length}` : ''; };
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
