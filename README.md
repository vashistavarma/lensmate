# LensMate: a mixed-reality chatbot that runs on your laptop

Point a webcam at anything and talk to it. LensMate answers by voice, **draws labels that follow objects on the live video**, lets you **click an object to ask about it**, **describes what you are doing**, **records clips**, and a 3D companion floats over the scene and flies to whatever it is talking about. You can **teach it new objects** by showing them once.

No headset, no cloud API, no API bill: the vision-language model runs locally through [Ollama](https://ollama.com), and speech can run fully offline too.

![architecture](docs/architecture.png)

> Built for the *Introduction to Generative AI* course. Demo video: _add link after recording_.

## What it does

| | |
|---|---|
| **See and chat** | Every question carries the current camera frame to a local vision-language model (Qwen2.5-VL 7B). Replies stream in token by token and are spoken sentence by sentence. Modes: 💬 Chat, 🎓 Explain, 👁 Describe, 📖 Read / translate. |
| **Spatial labels** | `find my keys`, `label everything`: the model returns bounding boxes (grounding) and neon labels are drawn over the video. A lightweight block-matching tracker keeps each label on its object at ~20 fps, after first catching it up for the 1-3 s the model took to answer. Each label also remembers how its object looked: when the patch under the box stops resembling it (the object left or was swapped) the label disappears within about half a second, and no label lives longer than 20 s. |
| **Mirror view** | On by default (the 🪞 button toggles it): the camera is shown like a mirror. Only the picture on screen and the action frames are mirrored; frames sent for chat, reading and detection stay true, so text stays readable. Labels, clicks and left/right wording follow what you see. |
| **Click-to-ask** | Click any object in the video: LensMate zooms into that spot (a crop at the camera's native resolution, so small parts get more pixels), identifies it, and the companion flies there. |
| **Actions and recording** | Ask *"what am I doing?"* (last ~4 s from an in-browser rolling buffer) or say *"record for 5 seconds"* (records, keeps a downloadable `.webm`, then describes what happened). Motion is **measured in code**; the model gets 2-3 key frames plus that measurement. |
| **Teach it** | Hold an object up and say *"this is an L298N motor driver"* (or *"remember this as …"*): it stores your words **and a photo**. Later, each taught photo is verified against the live view with a separate yes/no vision query, so it recognises the object on sight without false matches. A 🧠 panel shows and deletes what it knows. Up to 8 photos are stored and 3 are checked per question (~1.3 s each). |
| **Voice** | Hold 🎤 or Space to talk. Two engines: Chrome's Web Speech API, or **🔒 offline mic** (the browser records, `faster-whisper` transcribes on your CPU in ~0.8 s). Replies are spoken by a **local neural voice** (Piper, ~0.15 s per sentence) when it is installed; otherwise the browser's voice is used, which in Chrome is an online Google voice. Taught object names are passed to Whisper as hotwords so it can spell words like "mecanum". |
| **Chat history** | Like ChatGPT/Claude: ＋ New chat, ☰ a list of past chats to reopen, rename, delete or export (Markdown). Saved in the browser (up to 50 chats); your current chat survives a reload. |
| **Companion** | A Three.js orb that idles, listens, thinks and talks, and flies next to whatever it labelled or you clicked. |
| **Helpful UI** | Suggestion chips, a welcome message, service status lights (vision model, offline speech), and a pre-flight smoke test. |

## Quick start

Requirements: Linux (developed on Ubuntu 24.04), Node 18+ (developed on Node 22), [Ollama](https://ollama.com), a webcam, and a GPU with about 8 GB of VRAM (developed on an RTX 5060 Laptop). Python 3.10+ is only needed for the optional offline speech.

```bash
ollama pull qwen2.5vl:7b
git clone https://github.com/vashistavarma/lensmate.git && cd lensmate
node server.js            # no npm install: the server has zero dependencies
# open http://localhost:3000, allow camera (and microphone)
```

**Offline speech (optional):**
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # Ubuntu may need: sudo apt install python3-venv
./start.sh                # starts the speech service (faster-whisper small.en, CPU) and the web server
```
The first start downloads the Whisper model (~460 MB). Tick **🔒 offline mic** in the app. In Firefox (no Web Speech API) it is the only mic option.

**Local voice for spoken replies (optional but recommended):** without it Chrome speaks with an online Google voice, so the reply text leaves your computer.
```bash
.venv/bin/pip install piper-tts
mkdir -p models/piper && cd models/piper
for f in en_US-lessac-medium.onnx en_US-lessac-medium.onnx.json; do curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/$f; done
```
Restart `./start.sh`; `python3 eval/smoke.py` then reports `local voice: yes`.

**Before a demo:** `python3 eval/smoke.py` runs a 30-second pre-flight check (services, a vision answer, grounding, and the tracker and motion unit tests).

Options (environment variables): `PORT` (3000), `HOST` (default `127.0.0.1`: camera frames and your GPU are not exposed to the network), `MODEL` (`qwen2.5vl:7b`), `GROUND` (`pixel`, or `norm1000` for Qwen3-VL), `OLLAMA_URL`, `STT_URL`; for the speech service `WHISPER_MODEL` (`small.en`) and `STT_PORT` (3001). The server answers malformed requests with 400/413 errors instead of crashing, and stops generating if the browser disconnects.

**Desktop app (Linux tested):** instead of running the server yourself, install the packaged app: an AppImage or `.deb` with a first-run screen that checks Ollama and downloads the model. It still needs Ollama and a ~8 GB GPU. Windows and macOS installers are built by CI but untested. See [desktop/README.md](desktop/README.md).

## Things to say or do

| Say / do | What happens |
|---|---|
| "What is this?" / any question | Answers about the camera view |
| "Label everything" / 🔍 | Boxes and names for every object, tracked as you move |
| "Find the scissors" | Boxes only the scissors |
| Click an object | Zoomed identification, companion flies there |
| "This is a motor driver" / "Remember this as …" | Saves a photo + the name |
| "Remember that the red box is mine" | Saves a text fact |
| "What do you remember?" / "Forget everything" | Lists / clears memory (or use 🧠) |
| "What am I doing?" | Describes your action from the last ~4 s |
| "Record for 5 seconds" | Records, saves a clip, describes the action |
| "Clear" | Removes labels |

## Evaluation

Everything below is reproducible from `eval/`. Numbers are from the final code on an RTX 5060 Laptop (8 GB). Run these from the repo root with the server running:

```bash
.venv/bin/pip install -r eval/requirements.txt                       # Pillow, websocket-client, Piper (eval only)
node eval/test_tracker.js && node eval/test_motion.js                # unit tests (no GPU needed)
.venv/bin/python eval/make_cases.py && .venv/bin/python eval/run_eval.py   # synthetic benchmark
.venv/bin/python eval/action_eval.py                                 # actions (needs Chrome)
.venv/bin/python eval/stt_eval.py path/to/en_US-lessac-medium.onnx   # offline speech (a Piper voice file)
google-chrome --headless=new --user-data-dir=$(mktemp -d) --virtual-time-budget=6000 --dump-dom file://$PWD/eval/track_page.html | grep -o "<title>.*</title>"   # tracker in a browser
.venv/bin/python eval/stale_label_test.py                            # labels vanish when their object leaves (needs Chrome)
```
The real-photo scripts (`real_eval.py`, `visual_memory_eval.py`) need your own labelled snapshots: see below.

Note on latency: the figures below are for fresh images. Re-sending an identical image is far faster because Ollama caches the prompt, so repeated benchmark runs look quicker than real use, where every camera frame is new. Model output is not fully deterministic, so small runs vary by a case or two.

| Area | Test | Result |
|---|---|---|
| Vision chat | 5 synthetic questions (colour, counting, reading, scene description, taught fact) | **5/5**, median **1.3 s** per answer, **1.2 s** to first token (fresh images) |
| Grounding | 3 detection cases, IoU ≥ 0.5 (`python3 eval/run_eval.py`) | **3/3**, mean IoU **0.96**, 0.8 s per scan |
| Real objects, unaided | 8 real photos: mecanum wheel ×4, motor driver ×4 (`eval/real_eval.py`) | **1/8** (mecanum 0/4, motor driver 1/4) |
| Real objects, taught | same photos, taught name given as text | **8/8** (easy test: the name is supplied) |
| Visual memory | one taught photo per object, held-out photos as tests (`eval/visual_memory_eval.py`) | **5/6 to 6/6** (three runs: 6/6, 5/6, 5/6) |
| Visual memory, false claims | unrelated images + other object with the wrong reference (10 cases) | **0/10** false claims, both runs |
| Model comparison | Qwen3-VL 8B on the same 8 real photos | **0/8**, ~9 s per answer: rejected |
| Offline speech | 10 commands, Piper-synthesised, WebM/Opus through `/api/stt` (`eval/stt_eval.py`) | **2-4%** WER across runs (always "mecanum" heard as "mechanism"), **0.0%** with taught-name hotwords, ~0.8-1 s |
| Offline mic in a real browser | headless Chrome + fake microphone (`eval/stt_browser_test.py`) | pass, 0.7 s |
| Actions | headless Chrome + synthetic camera: right / up / wave / still via `record`, wave / right via "what am I doing?" (`eval/action_eval.py`) | **6/6**, ~3-5 s after the clip |
| Motion analysis | directions, waving, noise, camera pan, lighting ramp (`node eval/test_motion.js`) | **10/10** |
| Tracker | single shifts, large catch-up, 20-frame chain, flat patch (`node eval/test_tracker.js`) | **8/8**; in-browser box within 2 px after an 80 px pan |

## Speed

A plain question starts answering in about **1.2 s** and finishes in about **1.7 s** (shorter default answers, model kept loaded for 2 hours and warmed at startup). The slow part used to be **taught objects**: each taught photo is verified with its own model call (~1.3 s each), and it ran *after* you asked. Now it runs *before*:

| 3 taught photos, unique camera frame each time (`eval/latency_bench.py`) | First word | Total |
|---|---|---|
| Before: check at question time | 5.5 s | 6.3 s |
| Now, cold, nothing recognised recently (checks the likeliest object first, stops at the first match) | 2.6-3.8 s | 3.1-4.3 s |
| Now, cold, the object was recognised recently | 2.6 s | 3.1 s |
| Now, you spoke or typed for a couple of seconds first (check starts on mic press or first key) | ~1.7 s | ~2.1 s |
| Now, picture held still a few seconds (background check) | **1.3 s** | **1.7 s** |

The browser keeps the result while the scene is unchanged, skips the check for questions it cannot help with (reading text, counting, colours), and the background check can be switched off with `localStorage.setItem('lensmate.autocheck', '0')`. Accuracy is unchanged (re-run: chat 5/5, detection 3/3 at IoU 0.96, taught-photo recognition 6/6 with 0 false claims, actions 6/6). Things I tried that did **not** help: running the checks in parallel (no gain, the GPU is the bottleneck), putting the live image first for cache reuse (accuracy fell from 18/20 to 14/20), Ollama flash attention with a compact KV cache (about 5% slower here), and the smaller `qwen2.5vl:3b` (only ~27% faster, but label detection fell to 0/3, taught-photo recognition to 0/6 and real photos to 0/8).

## What did not work first (and what I did about it)

Full notes with measurements are in [docs/DESIGN_NOTES.md](docs/DESIGN_NOTES.md). The short version:

- **Box coordinates were 1.2× too big.** Ollama upscales small images before the model sees them, and the model reports pixels in that resized space. Sending frames at exactly 1204×672 makes coordinates map 1:1.
- **Putting reference photos in the prompt made the model claim matches on unrelated images** (4/4 false positives). Verifying each taught photo with its own yes/no question removed them.
- **The model cannot follow motion across frames** through Ollama (a contact sheet turned left-to-right motion into "circular rotation"). Motion is now measured in code and the model sees start / peak / end frames.
- **A newer model was worse:** Qwen3-VL 8B got 0/8 and was ~6× slower here.
- **Whisper heard "mecanum" as "mechanism."** Passing taught names as hotwords fixed it.

## Honest limitations

- The benchmark is **synthetic** where noted. Real-object evidence is **8 photos of 2 objects**: indicative, not precise.
- A 7B local model **does not know niche hardware by name** (mecanum wheel, motor driver). Teaching fixes the *name*, not the model's *knowledge* about the object (it once explained a mecanum wheel as a "caster wheel").
- Visual-memory tests use reference and test photos from the same room and lighting, so they are optimistic.
- Action recognition was tested on **synthetic clips only**. The motion measure follows one blob (several moving things merge), cannot name gestures beyond direction and repetition, and its thresholds are untested on real webcam noise. The model sometimes repeats the measurement wording.
- The tracker follows **translation only** (no scale/rotation), can drop a label if more than about half of the object is covered (for example by your hand), loses fast motion, and ignores featureless patches.
- A webcam is not a headset: this is a mixed-reality *prototype* (virtual companion and anchored labels over a live camera feed), not spatial mapping.
- Chrome's built-in speech recognition sends audio to a cloud service. Tick **🔒 offline mic** to keep audio on the machine. Spoken replies are local only if the Piper voice is installed.

## Privacy

Vision and reasoning run locally. With the 🔒 offline mic ticked and the local Piper voice installed, nothing leaves your computer (`eval/local_only_test.py` checks that the page only ever talks to `localhost`); without the local voice, Chrome speaks replies with an online Google voice. Chats, taught photos and facts are stored in your browser's `localStorage` (never uploaded). The 12-second action buffer lives in browser memory and frames go only to the local model (when you ask, and in the background to check taught objects). Nothing is written to disk unless you click *Save clip* or *Export*. `eval/real/` (your own test photos) is git-ignored.

## Project layout

```
server.js            static server + /api/chat (streaming), /api/detect (grounding), /api/stt, /api/health
stt_server.py        offline speech-to-text service (faster-whisper, CPU)
start.sh             starts the speech service and the web server
public/app.js        camera, frame capture, chat streaming
public/voice.js      push-to-talk (Web Speech or offline mic), sentence-level TTS
public/spatial.js    boxes over video, find/label commands, tracking loop, click-to-ask
public/tracker.js    block-matching box tracker (pure functions, unit-tested)
public/motion.js     motion measurement for actions (pure, unit-tested)
public/actions.js    rolling frame buffer, "what am I doing?" and "record"
public/avatar.js     Three.js companion
public/ui.js         modes, teach-me memory, memory panel, chips, service lights
public/speed.js      latency: checks taught objects before you ask, caches the result
public/sessions.js   chat history
desktop/             Electron shell, setup screen and installer build (see desktop/README.md)
eval/                benchmarks, unit tests, browser tests, smoke test
docs/                architecture diagram, design notes, live-demo runbook, LinkedIn post kit, LensMate_presentation.pptx (10-minute deck with speaker notes)
```

## Roadmap

Tracking with scale and re-detection; a larger or fine-tuned vision model; real-webcam tuning of the motion thresholds and a gesture classifier; a WebXR build for a Quest headset; visual memory by embedding similarity instead of per-photo checks.

## Acknowledgements

Built on open-source work: [Ollama](https://ollama.com) and the Qwen2.5-VL model, [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Three.js](https://threejs.org), and [Piper](https://github.com/rhasspy/piper) (used only to synthesise speech for the evaluation). Each keeps its own license; check them before redistributing models or voices.

## License

MIT, see [LICENSE](LICENSE). Three.js (MIT) is vendored in `public/vendor/`.
