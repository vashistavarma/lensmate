# LensMate: demo recording script (60-75 s)

**Setup (2 min):** Chrome fullscreen on http://localhost:3000, good light, plain background, 4-5 *different* objects within reach (mix everyday + one niche, e.g. mug, plant, phone, a sensor module, a book page). Close other GPU apps. Run `./start.sh` and `python3 eval/smoke.py` first (all green). Do one throwaway question so the model is loaded (the first reply is slow), then press **＋ New chat** and delete old test chats in ☰ so the video starts clean. Tick **🔒 offline mic** if you want to say "no cloud" on camera. Record with OBS (or Ubuntu's built-in Ctrl+Shift+Alt+R screen recorder), 1080p, mic on, system audio on so the AI voice is captured. Do 2-3 takes and keep the best.

| Time | You do | What the viewer sees |
|---|---|---|
| 0:00 | Say: "This is LensMate, a mixed-reality chatbot running fully on my laptop." | Orb floating idle over the live camera |
| 0:08 | Hold an everyday object. Hold **Space**: "What is this?" | Orb turns blue (listening), amber (thinking), green (speaking), answer streams and is spoken |
| 0:20 | Spread 3-4 objects on the desk. Type/say: **"label everything"** | Neon boxes + names appear, orb flies next to the first one |
| 0:32 | Say: **"find the [object]"**, then slowly move the camera or the object | Only that object boxed, orb jumps to it, and the label *follows* |
| 0:38 | **Click** a small part of an object in the video | Ring pulse, the companion flies there, zoomed identification |
| 0:42 | Show the niche item. Ask "what is this?" (it may guess wrong, keep it: honesty is a strength). Then say: **"this is a [real name]"** | "Got it, I'll remember" + 🧠 1 taught |
| 0:55 | Ask "what is this?" again in **🎓 Explain** mode | Correct name + what it does |
| 1:05 | Switch to **📖 Read**, hold up text in another language | Reads and translates |
| 1:08 | Open ☰ and show the saved chats, then ＋ New chat | Chat history like ChatGPT |
| 1:12 | Say: "Local Qwen2.5-VL, Three.js, no headset, no API costs." | Orb waves off, end card (architecture.png) |

**Tips:** keep the take under 90 s (LinkedIn autoplay drops off fast); crop to the camera area plus chat; add captions (many watch muted); thumbnail = the moment the labels + orb are on screen.

**Don't:** fake a success. If a take shows a wrong answer, either re-take or keep it and use the teach-me moment. It tells the real story.
