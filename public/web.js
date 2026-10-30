// Client side of real-time data: the 🌐 switch (off by default, remembered) and "set my location to ...".
const webbox = document.getElementById('webbox');
try { webbox.checked = localStorage.getItem('lensmate.web') === '1'; } catch {}
webbox.addEventListener('change', () => { try { localStorage.setItem('lensmate.web', webbox.checked ? '1' : '0'); } catch {} status.textContent = webbox.checked ? '🌐 web on: search text may be sent online' : '🌐 web off: nothing leaves this computer'; });
window.lensWebOn = () => webbox.checked;
window.lensPlace = () => { try { return localStorage.getItem('lensmate.place') || ''; } catch { return ''; } };
const prevIntent = window.lensIntent;
window.lensIntent = async question => {
  const m = question.trim().replace(/[?.!]+$/, '').match(/^(?:set|change) (?:my )?(?:location|city|place)(?: to)? (.+)$/i);
  if (m) {
    const place = m[1].trim();
    try { localStorage.setItem('lensmate.place', place); } catch {}
    const text = `Okay, I'll use ${place} for weather questions.` + (webbox.checked ? '' : ' Switch on the 🌐 web button so I can look it up.');
    addMsg(text, 'bot'); history.push({ role: 'user', content: question }, { role: 'assistant', content: text }); window.onBotText?.(text, true); return true;
  }
  return prevIntent ? prevIntent(question) : false;
};
