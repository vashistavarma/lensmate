// Step 5: response modes, "teach me" memory, and frame snapshot.
const modeSel = document.getElementById('mode');
const factsEl = document.getElementById('facts');
window.lensMode = () => modeSel.value;

// --- Teach-me memory: short facts the user states, injected into every prompt (persisted locally) ---
let facts = [];
try { facts = JSON.parse(localStorage.getItem('lensmate.facts') || '[]'); } catch {}
const saveFacts = () => { try { localStorage.setItem('lensmate.facts', JSON.stringify(facts)); } catch {} showFacts(); };
const showFacts = () => { factsEl.textContent = facts.length ? `🧠 ${facts.length} taught` : ''; };
window.lensFacts = () => facts;
showFacts();

const prevIntent = window.lensIntent; // spatial commands live in spatial.js
window.lensIntent = async question => {
  const q = question.trim();
  let m, reply = null;
  if (/^forget (everything|all)\b/i.test(q)) { facts = []; saveFacts(); reply = 'Okay, I have forgotten everything you taught me.'; }
  else if (/^what do you (remember|know)\b/i.test(q)) reply = facts.length ? 'You taught me: ' + facts.join('; ') + '.' : 'You have not taught me anything yet.';
  else if ((m = q.match(/^(?:remember|note)(?: that)?\s+(.+)$/i)) ||
           (!q.endsWith('?') && (m = q.match(/^((?:this|that|these|it)\s+(?:is|are|'s)\s+.+)$/i)))) {
    const fact = m[1].replace(/[.!]+$/, '');
    facts.push(fact.length > 200 ? fact.slice(0, 200) : fact); saveFacts();
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
