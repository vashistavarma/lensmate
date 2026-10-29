# LensMate: live demo runbook (10-minute slot)

Slide deck: `LensMate_presentation.pptx`. Demo time budget: **about 4 minutes**, split into short segments between slides so a failure never costs more than one segment.

## T-30 min: set up
1. Plug in the laptop, close GPU-heavy apps (browsers with video, games). Disable notifications.
2. Good light on your face and the table, plain background, **5 objects within reach**: 2 everyday (mug, phone), 1 niche you will teach (the motor driver), 1 with text (a book page or box), 1 small part to click.
3. `cd ~/lensmate && ./start.sh` (leave this terminal visible but out of the way).
4. `python3 eval/smoke.py`: every line must be PASS.
5. Open Chrome at `http://localhost:3000`, allow camera + mic, fullscreen (F11), zoom 100%.
6. Warm up: ask "what is this?" once (the first answer loads the model and is slow). Then **＋ New chat** and delete old test chats in ☰ so the screen starts clean. In 🧠, delete taught objects you do *not* want in the demo.
7. Tick **🔒 offline mic** if you want to say "no cloud at all". Test one spoken command.
8. Record a 60-s **backup video** of the whole demo path (see "Recording" below) and keep it in `~/Videos` plus on a USB stick / phone.
9. Put these on the second screen or paper: the segment script below and the fallback table.

## T-5 min
Check the three green lights (vision, speech), battery plugged, camera framing, volume at a sensible level. New chat open. Mic test.

## Demo script (segments are independent)

| # | Slide before it | You do / say | What the audience sees | If it fails |
|---|---|---|---|---|
| D1 | "What it is" | "Hello LensMate, what do you see?" (hold Space) | Orb listens → thinks → speaks; spoken answer streams | Type the question instead; mention latency is ~1-2 s |
| D2 | "Spatial labels" | Spread 3-4 objects. Say **"label everything"**, then slowly move the camera/an object | Neon labels appear, orb flies to the first; labels follow | Say **"clear"** and retry once; if still wrong, show the recorded clip |
| D3 | same | **Click** the small part | Ring pulse, orb flies there, zoomed answer | Skip; mention it uses a native-resolution crop |
| D4 | "Teaching" | Hold the niche item: "What is this?" (expect a wrong guess: *keep it*). Then "**This is a motor driver.**" Move it away and back: "What is this?" | Wrong guess → 🧠 count increases → "recognised: motor driver" | If it misses, teach again closer/centred; fallback: show the 🧠 panel photo |
| D5 | "Actions" | Wave: "**What am I doing?**" Then "**Record for 5 seconds**" while picking up an object | Countdown, description, **💾 Save clip** link | Use the typed command; mention real-webcam thresholds are untuned |
| D6 | "Results" | (no demo) open ☰ chats, show export | Chat history like ChatGPT | skip |

Total demo time is about 4 minutes if each segment takes ~40 s. Do not improvise new objects live: the model **does** misidentify niche hardware, which is exactly the point of D4. Say so before it happens.

## What to say when it gets something wrong
"This is a 7-billion-parameter model running on my laptop: it describes the object well but does not know every niche part by name. That's why I built teaching: show it once and it remembers. It is the honest limit of local models today."

## Fallback table
| Problem | Fix |
|---|---|
| Camera blank | Reload the page and click *Allow*; check another app is not using the camera |
| Red dot on "vision" | `ollama serve` then `ollama pull qwen2.5vl:7b` |
| Very slow first answer | Model was cold: ask a throwaway question next time before presenting |
| Mic not heard | Use the typed box; or toggle 🔒 offline mic |
| Boxes jitter / drift | Say "clear" then "label everything" again; keep the camera still for 2 s |
| Whole thing down | Play the backup video; talk through the architecture slide |

## Likely questions (answers)
- **Why local, not GPT/Claude vision?** Privacy, no per-request cost, and offline capability; the trade-off is a weaker model.
- **How accurate is it?** Synthetic benchmark 5/5 chat and IoU 0.96 grounding; on 8 real photos of niche hardware it names them **1/8 unaided**, which is why there is a teach feature (5-6/6 on held-out photos, 0 false claims). Small samples.
- **Is it really mixed reality?** It is a webcam-based prototype: virtual companion and anchored labels over a live camera feed. No spatial mapping or headset yet (WebXR is the next step).
- **How does action recognition work if the model cannot see motion?** Motion is measured in code (frame differencing); the model sees start/peak/end frames plus that measurement.
- **What would you improve?** Real-webcam tuning of motion thresholds, gesture classification, a bigger or fine-tuned model, label tracking with scale.
- **What was the hardest bug?** Boxes were 1.2× too large because Ollama resizes images before the model sees them.

## Recording the LinkedIn / backup video (60-90 s)
OBS (or Ubuntu's Ctrl+Shift+Alt+R recorder), 1080p, mic and system audio on. Same flow as D1-D5, tighter: hello (8 s) → label everything + move (15 s) → click (8 s) → teach (20 s) → "what am I doing?" / record (15 s) → architecture end card (5 s). Add captions (most people watch muted); thumbnail = labels and orb on screen. Do 2-3 takes; if a take shows a wrong answer, either re-take or keep it and use the teach moment, because that tells the real story. Do **not** fake a success.
