// LensMate desktop shell: a first-run setup screen (Ollama + vision model), then the app served from a local server.
const { app, BrowserWindow, ipcMain, session, shell, Menu, systemPreferences } = require('electron');
const path = require('path');
const net = require('net');

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.MODEL || 'qwen2.5vl:7b';
const ALLOWED_LINKS = /^https:\/\/(ollama\.com|github\.com)\//;

// The AppImage cannot ship the setuid sandbox helper, and Ubuntu 24.04 blocks the alternative: run without it.
// Only local content (our own server and setup page) is ever loaded.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');

let win = null, port = 0, started = false;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function ollamaStatus() {
  try {
    const j = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) })).json();
    return { ollama: true, model: (j.models || []).some(m => m.name === MODEL || m.name === MODEL + ':latest'), modelName: MODEL };
  } catch { return { ollama: false, model: false, modelName: MODEL }; }
}

ipcMain.handle('status', ollamaStatus);
ipcMain.handle('open-external', (_e, url) => { if (ALLOWED_LINKS.test(String(url))) shell.openExternal(url); });

ipcMain.handle('pull', async e => { // download the vision model through Ollama, relaying progress to the setup page
  const res = await fetch(`${OLLAMA}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, stream: true }) });
  if (!res.ok) throw new Error('Ollama returned ' + res.status);
  const dec = new TextDecoder(); let buf = '';
  const layers = {}; // Ollama downloads a model in several pieces: add them up into one overall progress
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines.filter(Boolean)) {
      const j = JSON.parse(l);
      if (j.error) throw new Error(j.error);
      if (j.digest) layers[j.digest] = { total: j.total || 0, completed: j.completed || 0 };
      const all = Object.values(layers);
      e.sender.send('pull-progress', { status: j.status, total: all.reduce((n, x) => n + x.total, 0), completed: all.reduce((n, x) => n + x.completed, 0) });
    }
  }
  return true;
});

async function startApp() {
  if (started) return;
  started = true;
  if (process.platform === 'darwin') { // macOS asks the user once for camera and microphone access
    await systemPreferences.askForMediaAccess('camera').catch(() => {});
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  port = await freePort();
  process.env.PORT = String(port); process.env.HOST = '127.0.0.1'; process.env.MODEL = MODEL;
  require('./server/server.js'); // starts listening on 127.0.0.1:<port>
  for (let i = 0; i < 50; i++) { // wait until it answers
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  win.loadURL(`http://127.0.0.1:${port}/`);
}
ipcMain.handle('launch', startApp);

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 820, minWidth: 900, minHeight: 600, backgroundColor: '#0e1116', title: 'LensMate',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // camera and microphone are allowed for our own pages only
  const ours = url => url.startsWith('file://') || (port && url.startsWith(`http://127.0.0.1:${port}/`));
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(permission === 'media' && ours(details.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && ours(origin));
  win.webContents.setWindowOpenHandler(({ url }) => { if (ALLOWED_LINKS.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!ours(url)) e.preventDefault(); });
  win.loadFile(path.join(__dirname, 'setup.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' }, { role: 'viewMenu' },
    { label: 'Help', submenu: [{ label: 'Project page', click: () => shell.openExternal('https://github.com/vashistavarma/lensmate') }] },
  ]));
  createWindow();
});
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
