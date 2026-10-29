# LensMate demo video script (about 80 seconds)

Goal: in 80 seconds show the five things that make LensMate different, include one honest failure (the teach moment), and end on the repo link. One continuous screen recording of the browser, voiceover recorded live or added after. Captions on (most people watch muted).

## Setup (before pressing record)

1. `cd ~/lensmate && ./start.sh`, then `python3 eval/smoke.py`: all PASS.
2. Chrome at http://localhost:3000, fullscreen (F11), zoom 100%. Notifications off.
3. Press **＋ New chat**; in ☰ delete test chats. In **🧠** delete every taught object (so the motor driver is *unknown* at the start of the teach scene).
4. Ask one throwaway question so the model is warm (the first answer is slow).
5. On the desk, in reach: **the motor driver**, a **mug or phone** (everyday item), **one more small object** to click. Plain background, light on the objects and your face.
6. Tick **🔒 offline mic** if you want to say "no cloud" (then the voice never leaves the laptop).
7. OBS (or Ctrl+Shift+Alt+R): 1080p, 30 fps, record the Chrome window, mic on, **system audio on** (so the companion's voice is captured).

## Script

| Time | On screen / what you do | You say (voiceover or live) | Caption |
|---|---|---|---|
| 0:00-0:07 | Full screen: live camera, orb floating at the corner. | "This is LensMate, a mixed-reality chatbot that runs entirely on my laptop. No headset, no cloud." | **LensMate**: mixed-reality chatbot, 100% local |
| 0:07-0:16 | Hold **Space**: "Hey, what do you see?" The orb goes blue, amber, green; the answer streams and is spoken. | (let the AI voice play; no voiceover) | Talk to it: voice in, voice out |
| 0:16-0:30 | Spread 3 objects. Hold Space: "Label everything." Neon boxes appear. Slowly move one object and the camera. | "It labels what it sees, and the labels follow the objects as I move." | Labels that follow objects |
| 0:30-0:38 | **Click** the small object. Ring pulse, orb flies there, zoomed answer. | "Click anything to zoom in and ask about it." | Click to ask |
| 0:38-0:58 | Hold the motor driver up. "What is this?" (expect a wrong guess: **keep it**). Then: "**This is a motor driver.**" ("Got it, I'll remember"). Move it away, bring it back: "What is this?" The badge shows 🧠 recognised. | "A small local model doesn't know niche hardware, so it guesses wrong. But show it once, say what it is, and it remembers." | It guessed wrong, then I taught it once |
| 0:58-1:10 | Wave at the camera. "What am I doing?" The answer describes waving. | "It can even describe what I'm doing. The motion is measured in code; the model just names it." | Action recognition |
| 1:10-1:20 | Cut to the public-safe diagram (`architecture_public.png`, or slide 5), then the end card. | "It all runs locally: a vision model on the GPU, Whisper for speech, Three.js for the companion. The code, the benchmarks, and the things that broke first are on GitHub." | github.com/vashistavarma/lensmate |

Word count of the voiceover is about 150 words, roughly 60 seconds of speech at a natural pace, leaving room for the pauses where the AI speaks.

## Exact phrases (the app understands these patterns)

- "Hey, what do you see?" (a normal question). Careful: the bare phrase "What do you see?" is a *label everything* command, so keep the "Hey," in front
- "Label everything." / "Find the [object]."
- "What is this?"
- "**This is a motor driver.**" (starts with "this is"; also "Remember this as a motor driver")
- "**What am I doing?**" (or "Record for 5 seconds")
- Not understood as commands: "That's a motor driver" (use "this is …").

## If something goes wrong while recording

- **Wrong answer on a take:** keep it if it is the teach scene (that is the story); otherwise re-take.
- **Mic misheard you:** type the command instead and re-cut that scene, or switch the 🔒 offline mic on/off.
- **Labels do not appear:** say "clear", keep the camera still for 2 seconds, and say "label everything" again.
- **Recognition after teaching fails:** hold it closer and centred, and teach again. Do not fake it.
- Never edit out a failure to make it look better than it is; the README is explicit about the limits.

## Editing (15 minutes)

1. Trim dead air; keep the AI voice at full length (do not cut off sentences).
2. Burn in captions (the Caption column above). White text, dark translucent box, bottom third.
3. Add the end card for 4-5 seconds: the public-safe architecture image + "github.com/vashistavarma/lensmate" + "Qwen2.5-VL · faster-whisper · Three.js · all local".
4. Export 1080p MP4, under 90 seconds, under 200 MB.
5. Thumbnail: a frame with labels on the objects and the orb visible.

## Before you post

- Watch it once on a phone with the sound off. Can you follow it from the captions alone?
- Check it opens with the labels and companion on screen within 3 seconds (no long intro).
- Add the video link to the README (edit on GitHub, no key needed) and to the post.
