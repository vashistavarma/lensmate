# LinkedIn post (draft). Edit, then post with the video

**Option A, main (recommended)**

I built a mixed-reality chatbot that runs entirely on my laptop. No headset, no API bill. 👓🧠

For my Introduction to Generative AI course I wanted to see how far a *local* vision-language model could go as a "see and talk" assistant. Meet LensMate:

🎥 Your webcam is the passthrough view
🗣️ Talk to it (push-to-talk), and it answers out loud
🔍 Say "find my keys" and it draws labels on the live video
🛸 A 3D companion floats over the scene and flies to whatever it's talking about
🧠 Tell it "this is an L298N motor driver" and it remembers

How it works: Qwen2.5-VL 7B on Ollama (8 GB laptop GPU) for vision + language, a tiny zero-dependency Node server, and a browser front end with Three.js and the Web Speech API.

Three things I learned:
1️⃣ Grounding has a trap: the model's box coordinates are in the space of the image *after* Ollama resizes it. My boxes were ~1.2× too big until I sent frames at exactly 1204×672. After that, IoU hit 0.96.
2️⃣ A 7B model doesn't know niche hardware. It missed a motor driver and a mecanum wheel. A simple "teach me" memory helps: in a controlled test on an invented object, the answer was "a Zorp" with the taught fact and "a triangle" without it.
3️⃣ Honest evaluation matters: my benchmark is synthetic, so it proves the pipeline, not real-world accuracy. Labels are pinned to the screen, not tracked, which is the next thing to build.

Median ~1.3 s to first token, fully offline vision and reasoning.

Code, architecture diagram and eval harness: [GitHub link]

#GenerativeAI #MixedReality #ComputerVision #LLM #Ollama #ThreeJS #BuildInPublic

---
**Option B, shorter**

Built a mixed-reality chatbot for my GenAI course: webcam + voice + a local vision-language model (Qwen2.5-VL on a laptop GPU). It labels objects on the live video, talks back, and a 3D companion flies to what it's describing. Biggest lesson: coordinate calibration. Boxes were 1.2× off until I matched the model's resize resolution. Demo + code: [GitHub link] #GenerativeAI #MixedReality #Ollama

**Posting tips:** upload the video natively (not a link), put the GitHub link in the first comment if you want more reach, post Tue-Thu morning, reply to every comment in the first hour, and tag your course/instructor only if they're fine with it.
