# Design notes: what I tried, what broke, what I measured

LensMate was built step by step, and several of the most useful lessons came from things that failed. Each entry: the symptom, the cause, the fix, and how it was verified.

## 1. Bounding boxes were 1.2× too large
**Symptom.** Asked to locate shapes, Qwen2.5-VL returned boxes about 20% larger than the real positions (a square at x 100-300 came back as 117-360).
**Cause.** Ollama resizes images before the model sees them (smaller images are upscaled to roughly 800k pixels), and the model reports pixel coordinates in *that* resized space. A 1008×560 input came back in ~1204×672 space; a 1512×840 input came back unscaled.
**Fix.** Capture frames at exactly **1204×672**, where coordinates map 1:1.
**Verified.** Boxes within a couple of pixels of ground truth; mean IoU 0.96 on the benchmark.

## 2. Reference photos in the prompt caused false matches
**Symptom.** With two taught photos attached to the prompt, the model recognised held-out photos 6/6, but also said "motor driver" for a plain shapes image and a text sign (4/4 unrelated images wrongly matched).
**Cause.** Prompting a 7B model with "these are references, use them only if they match" is not enough; it collapses toward naming a reference.
**Fix.** Verify each taught photo separately with a yes/no query ("Image 1 is a reference photo of a X. Is a X of the same kind clearly visible in image 2? Answer only YES or NO."), then give the main model only the verified names.
**Verified.** Prototype: 19/20 pair decisions correct, no false positives. Final pipeline: 5/6 to 6/6 recognition across three runs (6/6, 5/6, 5/6), **0/10** false claims. Cost: ~1.3 s per taught photo checked (max 3 per question).

## 3. The model cannot follow motion across frames
**Symptom.** Given 9 frames as a numbered 3×3 contact sheet, it described left-to-right motion as "circular rotation". Given 5 separate images it said a moving ball was "stationary", and took 18 s.
**Cause.** Through Ollama each image is an independent picture with no temporal encoding, and every small image still costs ~1,000 tokens (4 images overflowed the 4096 context).
**What did work.** Comparing only the first and last frame (5/6 synthetic cases right, 2.6 s).
**Fix.** A hybrid: `motion.js` measures direction, location, repetition (back-and-forth swings, like waving) and duration from the whole clip using frame differencing on 64×36 grayscale frames; the model sees start / peak-movement / end frames plus the measurement and names the moving thing.
**Verified.** 10 motion unit tests; end-to-end in headless Chrome with a synthetic camera: 6/6.

## 4. A newer model was worse
Qwen3-VL 8B (also reports boxes on a 0-1000 grid, supported via `GROUND=norm1000`) scored **0/8** on the real photos (vs 1/8) and took ~9 s per answer (vs ~1.4 s) on an 8 GB GPU. Rejected; the lesson matches entry 2: for niche objects, teaching beats model swapping.

## 5. Whisper does not know "mecanum"
Offline speech got 2-4% WER on 10 command sentences (it varies by a word between runs), and the errors were always in one sentence: "mecanum wheel" was heard as "mechanism wheel". Passing the taught object names as `hotwords` fixed it (0.0%). Caveat: that test reused the same vocabulary, which is what taught names are, so it is not a general improvement; and the speech is clean synthetic audio, a best case.

## 6. Tracking labels cheaply
Detection takes 1-3 s, so labels would land on a scene that already moved. A block-matching tracker (sum of absolute differences on 301×168 grayscale, ±6 px per step at ~20 fps) first catches each box up from the frame it was detected in (±20 px search), then follows it. A "lost" threshold of 16 (good matches cost ~2, an unrelated scene ~25) drops labels whose object left. Untextured patches are left in place instead of drifting randomly. Verified with 8 unit tests and an in-browser integration test (box within 2 px after an 80 px pan).

## 7. Ollama quirks worth knowing
- **Context size:** the default 4096 tokens overflowed with 4+ images. All calls now use `num_ctx: 8192` consistently, because changing it between calls makes Ollama reload the model.
- **Thinking models:** `think: false` is sent on every request so models such as Qwen3-VL do not spend seconds "thinking" first.
- **Grounding convention differs by model:** pixels (Qwen2.5-VL) vs a 0-1000 grid (Qwen3-VL).

## 8. Environment notes (Ubuntu 24.04)
`pip` and `python3-venv` were missing and `sudo` cannot prompt from a tool, so the Python venv was created with `--without-pip` and pip bootstrapped with `get-pip.py`. faster-whisper 1.2.1 needs PyAV < 17 (newer PyAV removed an argument it passes), hence `av>=14,<17` in `requirements.txt`.

## What I would do next
Tune the motion thresholds on real webcam clips; classify gestures from pose keypoints; track scale and re-detect periodically; try a larger or fine-tuned vision model; store taught objects as embeddings instead of verifying each photo with a model call; build the WebXR/Quest version.
