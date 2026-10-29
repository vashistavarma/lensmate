# LensMate desktop app

LensMate as an installable program: the web app and its local server in one window, with a first-run setup screen.

## What users need

- A computer with a GPU that has about **8 GB of memory** (or an Apple Silicon Mac).
- [Ollama](https://ollama.com/download), installed and running. LensMate's first-run screen checks for it and downloads the vision model (`qwen2.5vl:7b`, about 6 GB, one time).
- A webcam. Camera and microphone are only ever used on your computer.

## Install (Linux, tested)

```bash
# AppImage (no install): needs FUSE; if it won't start, add --appimage-extract-and-run
chmod +x LensMate-0.1.0-linux-x86_64.AppImage && ./LensMate-0.1.0-linux-x86_64.AppImage

# or the Debian/Ubuntu package
sudo apt install ./LensMate-0.1.0-linux-amd64.deb
```

Windows (`.exe`) and macOS (`.dmg`) installers are built by CI (see below) and are **not tested yet**. They are unsigned: Windows SmartScreen shows "unknown publisher" (More info, Run anyway), and on macOS right-click the app and choose Open the first time.

## Your data and moving taught objects

The app always serves itself on `http://127.0.0.1:47831`, so taught objects, chats and settings persist between launches (a browser keeps them per address). The desktop app and the browser version at `localhost:3000` do **not** share memory. To carry taught objects across: in the app that has them open the 🧠 panel and press **Export**, then in the other app open 🧠 and press **Import**. Importing merges, and never creates duplicates.

## Voice

Chrome's cloud speech recognition does not work inside Electron, so the desktop app uses the **offline microphone** engine, which needs the optional speech service (`stt_server.py`, faster-whisper; see the main README). Without it, the app says so and you can type your questions. Everything else works without it. Bundling speech into the installer is a possible next step.

## Build it yourself

```bash
cd desktop
npm install
npm run start:linux      # run from source on Linux (--no-sandbox is needed on Ubuntu 24.04); use `npm start` elsewhere
npm run dist             # build installers for the current OS into desktop/dist/
```

`npm run sync` (called automatically) copies `server.js` and `public/` from the repo root into `desktop/server/`, which is git-ignored.

## Releases (Windows, macOS, Linux)

`.github/workflows/desktop-release.yml` builds all three on GitHub's runners and attaches the installers to a **draft** release. Push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Then open the draft release on GitHub, check the files, and publish it. The Windows and macOS builds have never been run by the author; test them before sharing.

## How it works

`main.js` shows `setup.html`, asks Ollama (`/api/tags`) whether the model is present, can download it (`/api/pull`, with a progress bar), then starts the bundled server on a free `127.0.0.1` port and loads the app. Camera and microphone are granted only to the app's own pages, outside links open in your browser, and the setup page's few IPC calls are never exposed to the app page.
