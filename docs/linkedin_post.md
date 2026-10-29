# LinkedIn post kit

Note: the public repo contains the front end only; the server and evaluation code are private.

Attach the **demo video** (upload natively). Use the public-safe diagram (`assets/architecture.png` in the public repo, also saved as `architecture_public.png`) as the second image; the internal `docs/architecture.png` shows endpoint names, so keep it private. The repo link is already filled in.

## Main post (recommended)

I built a mixed-reality chatbot that runs entirely on my laptop. No headset. No API bill. 👓

For my Introduction to Generative AI course I wanted to see how far a *local* vision-language model could go as a "see, talk and understand" assistant. Meet LensMate:

🎥 My webcam is the passthrough view
🗣️ I talk to it, it answers out loud (speech can run fully offline)
🔍 "Find my keys": labels appear on the live video and follow the object as I move
👆 Click any object to zoom in and ask about it
🎬 "What am I doing?": it describes my action, and can record a clip
🧠 Show it something once, say "this is a motor driver", and it recognises it next time
🛸 A 3D companion floats over the scene and flies to whatever it's talking about

Under the hood: Qwen2.5-VL 7B on Ollama (8 GB laptop GPU), faster-whisper on the CPU, a zero-dependency Node server, and a browser front end with Three.js.

What I learned by measuring instead of assuming:

1️⃣ My boxes were 1.2× too big. The model reports coordinates in the image size *after* Ollama resizes it. Sending frames at exactly 1204×672 fixed it (IoU 0.96).
2️⃣ A 7B model doesn't know niche hardware: on my real photos it named a mecanum wheel and a motor driver correctly just 1 time in 8. Teaching it with a photo fixed that (5-6 of 6 on held-out photos). My first version also claimed matches on unrelated images, so I added a separate yes/no check per taught photo: 0 false claims in 10 tests.
3️⃣ The model can't follow motion across frames (it called left-to-right motion "circular rotation"). So motion is measured in code, and the model just names what's moving.
4️⃣ A newer model (Qwen3-VL 8B) scored 0/8 and was 6× slower, so I kept the older one.

Honest limits: the real-object test is 8 photos of 2 objects, and action recognition is only tested on synthetic clips so far. 

Front-end code and architecture: https://github.com/vashistavarma/lensmate

#GenerativeAI #MixedReality #ComputerVision #LLM #Ollama #BuildInPublic

## Short version

Built a mixed-reality chatbot for my GenAI course: webcam + voice + a local vision-language model on a laptop GPU. Labels follow objects on the live video, it describes what you're doing, and you can teach it new objects with one photo. Best lesson: my 7B model named niche hardware correctly 1 time in 8, until I taught it, and the boxes were 1.2× off until I matched the model's resize resolution. Demo + front-end code: https://github.com/vashistavarma/lensmate #GenerativeAI #MixedReality #Ollama

## First comment (post it right after)

The front-end code and the architecture diagram are in the repo; the model server and evaluation code stay private for now. Happy to answer questions about running a vision model locally, the box-scaling bug, or how the teach-by-showing memory works!

## Image alt text (for architecture.png)

Architecture diagram of LensMate: camera, voice, text and click inputs feed a browser front end with a 3D companion, label tracking, action analysis and memory; a local Node server talks to Qwen2.5-VL on Ollama and faster-whisper on the CPU.

## Posting checklist

- [ ] Video is under 90 s, has captions, starts with the labels + companion on screen (no long intro)
- [ ] `https://github.com/vashistavarma/lensmate` filled in; the public repo is front end only and its README opens with the architecture image
- [ ] Numbers in the post match `README.md` (they were measured on the final code)
- [ ] Post Tue-Thu morning; reply to every comment in the first hour
- [ ] Mention your course or instructor only if they are fine with it
- [ ] Don't claim "real-world accuracy": say synthetic where it is synthetic
