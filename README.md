# LensMate: a general-purpose Mixed Reality chatbot

Point your camera at anything, talk to it, and an AI companion answers by voice, **draws labels on the live view**, and **flies over to the object it is talking about**. It runs on a laptop with a webcam, with no headset and no paid API. The vision-language model runs locally.

> Built for the *Introduction to Generative AI* course.

![architecture](docs/architecture.png)

## What it does

| Capability | How |
|---|---|
| See and chat | Every question is sent with the current camera frame to a local vision-language model (Qwen2.5-VL 7B via Ollama). Replies stream in token by token. |
| Talk | Push-to-talk speech input (Web Speech API) and spoken replies (browser TTS), sentence by sentence while the answer streams. |
| Spatial labels | `find my keys`, `label everything`: the model returns bounding boxes (grounding), drawn as neon boxes over the video. |
| 3D companion | A Three.js orb that idles, listens, thinks, and talks, and flies next to the object it labelled. |
| Modes | 💬 Chat, 🎓 Explain, 👁 Describe (accessibility style), 📖 Read / translate. |
| Teach me | Say *"this is an L298N motor driver"* or *"remember that the red box is mine"*. The fact is injected into later prompts, persisted in the browser, and cleared with *"forget everything"*. |

## Architecture

```
 Browser (Chrome)                                   Node server              Ollama (local GPU)
┌────────────────────────────────────┐          ┌───────────────┐          ┌──────────────────┐
│ webcam ─► <video> (the "passthrough")│          │ POST /api/chat │ ───────► │ qwen2.5vl:7b      │
│ mic ─► Web Speech STT ─► text        │ ─frame─► │ POST /api/detect│ ◄─JSON── │ (vision + text)   │
│ canvas overlay ◄─ boxes + labels     │          │ static files   │          └──────────────────┘
│ Three.js avatar ◄─ state/point events│          └───────────────┘
│ TTS ◄─ streamed sentences            │
└────────────────────────────────────┘
```

Key design points:
- **Grounding calibration:** Qwen2.5-VL returns boxes in the pixel space of the image *after Ollama resizes it*. Smaller images are upscaled, so coordinates come back about 1.2× too large. Sending frames at exactly **1204×672** gives 1:1 coordinates, which I verified empirically (mean IoU 0.96 on the benchmark).
- **Cheap context:** only the newest user turn carries an image. History is text-only.
- **Event bus:** the avatar listens to small `lens-state` and `lens-point` browser events, so UI modules stay decoupled.

## Run it

Requirements: Linux, Node 18+, [Ollama](https://ollama.com) with a vision model, Chrome or Edge (for speech recognition), a webcam. About 8 GB of VRAM is comfortable for the 7B model.

```bash
ollama pull qwen2.5vl:7b
cd lensmate && node server.js        # no npm install, no dependencies
# open http://localhost:3000 in Chrome and allow camera + microphone
```

Try: *"What is this?"*, *"label everything"*, *"find the scissors"*, hold **Space** to talk.

## Evaluation

`eval/` contains a reproducible harness that exercises the real server endpoints (`python3 eval/make_cases.py && python3 eval/run_eval.py`).

Results on the synthetic benchmark (8 cases, RTX 5060 Laptop 8 GB, Qwen2.5-VL 7B):

| Metric | Result |
|---|---|
| Chat / reading / describe / memory | **5/5** |
| Detection passing IoU ≥ 0.5 | **3/3** (mean IoU **0.96**) |
| Time to first token (median) | **1.3 s** |
| Full chat answer (median) | **1.5 s** |
| Detection scan (median) | **1.3 s** |

**Memory ablation:** asked *"What is the green triangle called?"* **with** the taught fact the model answers *"a Zorp"*, and **without** it, *"a triangle"*. So the improvement comes from the memory feature.

### Honest limitations
- The benchmark is **synthetic** (clean shapes and text). It proves the pipeline, the grounding calibration, and the memory feature. It does **not** measure accuracy on real-world objects.
- In manual tests, the 7B model **misidentified niche hardware** (motor driver, mecanum wheel, ultrasonic sensor, a glue tube). Common objects are far more reliable. The teach-me memory and the "describe cues, give a labelled best guess" prompt are mitigations, not a cure. A larger or fine-tuned model would be the real fix.
- Labels are **pinned to the screen, not tracked**. They are cleared after 15 s because they go stale when the camera moves.
- Chrome's speech recognition sends audio to a cloud service. Vision and reasoning are fully local.
- A webcam is not a headset. This is a "mixed reality" prototype (virtual companion and anchored labels over a live camera feed), not spatial mapping.

## Project layout

```
server.js            static server + /api/chat (streaming) + /api/detect (grounding), prompts and modes
public/app.js        camera, frame capture, chat streaming
public/voice.js      push-to-talk STT, sentence-level TTS
public/spatial.js    boxes over video, find/label commands
public/avatar.js     Three.js companion (idle/listening/thinking/speaking/pointing)
public/ui.js         modes, teach-me memory, snapshot
eval/                benchmark generator, runner, results.json
```

## Future work
Object tracking so labels follow the camera, a larger or fine-tuned vision model, local Whisper for fully offline speech, a WebXR build for a Quest headset, and visual (not just textual) memory of taught objects.
