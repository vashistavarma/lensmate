// Step 1: webcam + text chat. Each question sends the current camera frame to the local VLM.
const cam = document.getElementById('cam');
const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('q');
const send = document.getElementById('send');
const status = document.getElementById('status');
const history = []; // text-only history; only the newest turn carries an image

navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
  .then(stream => { cam.srcObject = stream; status.textContent = 'camera live'; })
  .catch(e => { status.textContent = 'camera unavailable: ' + e.message; });

function grabFrame(maxW = 1024) {
  if (!cam.videoWidth) return null;
  const scale = Math.min(1, maxW / cam.videoWidth);
  const c = document.createElement('canvas');
  c.width = cam.videoWidth * scale; c.height = cam.videoHeight * scale;
  c.getContext('2d').drawImage(cam, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function addMsg(text, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
  return d;
}

async function ask(question, imageOverride) {
  addMsg(question, 'user');
  window.dispatchEvent(new CustomEvent('lens-state', { detail: 'thinking' }));
  if (await window.lensIntent?.(question)) return;
  history.push({ role: 'user', content: question });
  const bubble = addMsg('…', 'bot');
  let answer = '';
  const t0 = performance.now();
  const res = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history, image: imageOverride || grabFrame(), mode: window.lensMode?.(), facts: window.lensFacts?.(), refs: window.lensRefs?.() }),
  });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines.filter(Boolean)) {
      const j = JSON.parse(l);
      if (j.error) { bubble.textContent = '⚠ ' + j.error; return; }
      if (j.matched) { status.textContent = j.matched.length ? '🧠 recognised: ' + j.matched.join(', ') : 'no taught object in view'; continue; }
      answer += j.message?.content || '';
      bubble.textContent = answer;
      window.onBotText?.(answer, false);
    }
  }
  history.push({ role: 'assistant', content: answer });
  window.onBotText?.(answer, true);
  status.textContent = `reply in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
}

window.lensAsk = async (q, img) => { send.disabled = true; try { await ask(q, img); } catch (err) { addMsg('⚠ ' + err.message, 'bot'); } send.disabled = false; };

form.addEventListener('submit', async e => {
  e.preventDefault();
  const q = input.value.trim(); if (!q) return;
  input.value = ''; send.disabled = true;
  try { await ask(q); } catch (err) { addMsg('⚠ ' + err.message, 'bot'); }
  send.disabled = false; input.focus();
});
