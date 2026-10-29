// Copies the server and the front end from the repo root into desktop/server so electron-builder can package them.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'server');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(out, 'server.js'));
fs.cpSync(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });
console.log('synced server.js and public/ into desktop/server');
