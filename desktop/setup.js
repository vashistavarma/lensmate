const $ = id => document.getElementById(id);
const api = window.lensmateSetup;
const setRow = (n, state, text) => { $('d' + n).className = 'dot ' + state; $('s' + n).textContent = text; };
const gb = n => (n / 1e9).toFixed(1);
let busy = false;

async function check() {
  if (busy) return;
  $('msg').textContent = '';
  const s = await api.status();
  if (!s.ollama) {
    setRow(1, 'bad', 'Not found. Install Ollama (free), start it, then press "Check again".');
    $('b1').style.display = ''; setRow(2, 'wait', 'Waiting for Ollama');
    $('b2').style.display = 'none'; return;
  }
  setRow(1, 'ok', 'Running'); $('b1').style.display = 'none';
  if (!s.model) { setRow(2, 'bad', `${s.modelName} is not downloaded yet (about 6 GB, one time).`); $('b2').style.display = ''; return; }
  setRow(2, 'ok', `${s.modelName} ready`); $('b2').style.display = 'none';
  $('msg').textContent = 'Starting LensMate…';
  await api.launch();
}

$('b1').onclick = () => api.openExternal('https://ollama.com/download');
$('recheck').onclick = check;
$('b2').onclick = async () => {
  busy = true; $('b2').disabled = true; $('bar').style.display = 'block'; setRow(2, 'wait', 'Downloading…');
  api.onProgress(p => {
    if (p.total) { $('fill').style.width = (100 * p.completed / p.total) + '%'; $('s2').textContent = `Downloading ${gb(p.completed)} of ${gb(p.total)} GB`; }
    else $('s2').textContent = p.status || 'Working…';
  });
  try { await api.pull(); busy = false; await check(); }
  catch (e) {
    busy = false; $('b2').disabled = false; $('bar').style.display = 'none';
    setRow(2, 'bad', 'Download failed: ' + e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
};
check();
