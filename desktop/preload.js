// Runs before each page. The app pages only learn that they are inside the desktop app; the setup page also gets its few IPC calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lensmateDesktop', { isDesktop: true, platform: process.platform });

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('lensmateSetup', {
    status: () => ipcRenderer.invoke('status'),
    pull: () => ipcRenderer.invoke('pull'),
    launch: () => ipcRenderer.invoke('launch'),
    openExternal: url => ipcRenderer.invoke('open-external', url),
    onProgress: cb => ipcRenderer.on('pull-progress', (_e, p) => cb(p)),
  });
}
