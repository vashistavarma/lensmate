// Offline checks for web.js: which questions trigger a lookup (no network used). Run: node eval/test_web.js
const w = require('../web'); let bad = 0;
const t = (name, ok) => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name); };
const k = q => w.plan(q)?.kind || null;
t('weather in a named place', k('What is the weather in Berlin today?') === 'weather' && w.plan('weather in Berlin').place === 'Berlin');
t('weather without a place asks for one', w.plan('what is the weather like').place === null);
t('"search for ..." always searches', w.plan('search for usb microphones').text === 'usb microphones');
t('fresh facts search', k('Who is the current prime minister of Japan?') === 'search' && k('Who won the latest Formula 1 race?') === 'search');
t('questions about the picture never search', ['what is this?', 'what is this object', 'who is this', 'how many fingers am I holding up', 'what colour is the cup', 'what is in the picture'].every(q => k(q) === null));
t('time questions use the local clock', w.wantsTime('What time is it?') && w.wantsTime("what's the date today") && !w.wantsTime('what is this'));
t('wrap marks results as data', /DATA from the internet/.test(w.wrap({ kind: 'search', query: 'x', text: 'y' })));
process.exit(bad ? 1 : 0);
