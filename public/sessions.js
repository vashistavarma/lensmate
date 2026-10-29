// Chat history: multiple chats saved in this browser (like ChatGPT/Claude): new chat, switch, rename, delete, export.
// Saved: the text of each chat and the model's text context. Not saved: camera frames. Taught photos/facts stay shared across chats.
(() => {
  const KEY = 'lensmate.sessions', CUR = 'lensmate.currentSession', MAX_SESSIONS = 50, MAX_MSGS = 200;
  const drawer = document.getElementById('drawer'), listEl = document.getElementById('sessions');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const blank = () => ({ id: uid(), title: 'New chat', created: Date.now(), updated: Date.now(), ui: [], messages: [] });

  let sessions = [];
  try { sessions = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
  let curId = null; try { curId = localStorage.getItem(CUR); } catch {}
  let cur = sessions.find(s => s.id === curId) || blank();

  function persist() {
    sessions.sort((a, b) => b.updated - a.updated);
    sessions = sessions.slice(0, MAX_SESSIONS);
    for (;;) { // if the browser quota is hit, drop the oldest chat and retry
      try { localStorage.setItem(KEY, JSON.stringify(sessions)); localStorage.setItem(CUR, cur.id); return; }
      catch { if (sessions.length <= 1) return; sessions.pop(); }
    }
  }

  function snapshot() { // copy what is on screen + the model context into the current session
    cur.ui = [...log.querySelectorAll('.msg:not(.welcome)')].map(d => ({ cls: d.classList.contains('user') ? 'user' : 'bot', text: d.textContent })).slice(-MAX_MSGS);
    cur.messages = history.map(m => ({ role: m.role, content: m.content })).slice(-MAX_MSGS);
    const first = cur.ui.find(m => m.cls === 'user');
    if (cur.title === 'New chat' && first) cur.title = first.text.slice(0, 40);
    cur.updated = Date.now();
  }

  function save() {
    snapshot();
    if (!cur.ui.length) return;                       // empty chats are never listed
    if (!sessions.includes(cur)) sessions.unshift(cur);
    persist(); if (!drawer.hidden) render();
  }

  function show(session) { // replace the visible chat + model context with a session
    speechSynthesis.cancel();
    cur = session;
    log.replaceChildren(); history.length = 0; history.push(...cur.messages);
    cur.ui.forEach(m => addMsg(m.text, m.cls));
    if (!cur.ui.length) window.lensWelcome?.();
    try { localStorage.setItem(CUR, cur.id); } catch {}
    window.dispatchEvent(new CustomEvent('lens-state', { detail: 'idle' }));
  }

  const fmt = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function render() {
    listEl.replaceChildren();
    if (!sessions.length) { const d = document.createElement('div'); d.style.cssText = 'padding:14px;color:var(--muted)'; d.textContent = 'No saved chats yet. Ask something and it will appear here.'; listEl.append(d); return; }
    for (const s of sessions) {
      const row = document.createElement('div'); row.className = 'sess' + (s === cur ? ' cur' : '');
      const t = document.createElement('div'); t.className = 't';
      const a = document.createElement('div'); a.textContent = s.title;                       // textContent: titles are user text, never HTML
      const b = document.createElement('small'); b.textContent = `${fmt(s.updated)} · ${s.ui.length} messages`;
      t.append(a, b);
      const ren = document.createElement('button'); ren.textContent = '✎'; ren.title = 'Rename';
      const del = document.createElement('button'); del.textContent = '✕'; del.title = 'Delete';
      row.append(t, ren, del);
      row.onclick = () => { save(); show(s); drawer.hidden = true; };
      ren.onclick = e => { e.stopPropagation(); const n = prompt('Rename chat', s.title); if (n && n.trim()) { s.title = n.trim().slice(0, 60); persist(); render(); } };
      del.onclick = e => {
        e.stopPropagation();
        if (!confirm(`Delete "${s.title}"?`)) return;
        sessions = sessions.filter(x => x !== s); persist();
        if (s === cur) show(blank()); render();
      };
      listEl.append(row);
    }
  }

  function newChat() { save(); show(blank()); drawer.hidden = true; document.getElementById('q').focus(); }
  function exportChat() {
    snapshot();
    const md = `# ${cur.title}\n\n` + cur.ui.map(m => `**${m.cls === 'user' ? 'You' : 'LensMate'}:** ${m.text}`).join('\n\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `lensmate-chat-${new Date(cur.created).toISOString().slice(0, 10)}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById('menu').addEventListener('click', () => { save(); render(); drawer.hidden = !drawer.hidden; });
  document.getElementById('closedrawer').addEventListener('click', () => { drawer.hidden = true; });
  document.getElementById('newchat').addEventListener('click', newChat);
  document.getElementById('newchat2').addEventListener('click', newChat);
  document.getElementById('exportchat').addEventListener('click', exportChat);

  // Autosave (debounced) whenever the chat changes, including streamed text; and on page close.
  let timer; new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(save, 500); }).observe(log, { childList: true, subtree: true, characterData: true });
  addEventListener('beforeunload', save);

  if (cur.ui.length) show(cur); // restore the last open chat after a reload
})();
