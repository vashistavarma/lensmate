// LensMate server: serves ./public and proxies /api/chat to the local Ollama (streaming).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // localhost only: the camera frames and the GPU are not exposed to the LAN
const STT = process.env.STT_URL || 'http://127.0.0.1:3001'; // offline speech service (stt_server.py)
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.MODEL || 'qwen2.5vl:7b';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const SYSTEM = 'You are LensMate, a friendly mixed-reality assistant. You see the user\'s ' +
  'camera view through the attached image. Answer in one or two short sentences (about 25 words) in plain speech, unless the user asks for detail; ' +
  'no markdown or lists. For objects you are unsure about, never just say you do not know: ' +
  'describe the visible cues (shape, labels, text, parts) and give your best guess, marked as ' +
  'a guess. If the user tells you what something is, trust them and remember it.';

const KEEP = '2h'; // keep the model in GPU memory between questions: a cold start costs about 10 s
const CTX = 8192; // one context size for every call: changing num_ctx between calls makes Ollama reload the model
const MODES = {
  chat: '',
  explain: ' MODE EXPLAIN: identify the main object, say what it is, what it does, and give one practical tip, in at most 4 sentences.',
  describe: ' MODE DESCRIBE: describe the scene for someone who cannot see it, from left to right, in at most 4 sentences.',
  read: ' MODE READ: read out any visible text exactly; if it is not English, also give an English translation. If there is no text, say so.',
};
const factsText = facts => Array.isArray(facts) && facts.length
  ? ' Facts taught by the user (trust them over your own guess): ' + facts.slice(-10).map(f => String(f).slice(0, 200)).join('; ') + '.'
  : '';

// --- request handling that survives bad input: a malformed request must never take the server down ---
const MAX_BODY = 40e6; // frames and photos are base64, so generous, but not unlimited
const bad = (status, msg) => Object.assign(new Error(msg), { status });
const fail = (res, status, msg) => {
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
};
async function readBody(req, limit = MAX_BODY) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw bad(413, 'request too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJSON(req) {
  let j;
  try { j = JSON.parse((await readBody(req)).toString()); } catch (e) { if (e.status) throw e; throw bad(400, 'body is not valid JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw bad(400, 'body must be a JSON object');
  return j;
}
const arr = v => (Array.isArray(v) ? v : []);
const str = (v, d = '') => (typeof v === 'string' ? v : d);

function serveStatic(req, res) {
  const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const full = path.join(__dirname, 'public', path.normalize(file));
  if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'text/plain' });
    res.end(data);
  });
}

const MAX_REFS = 3; // each reference costs one ~1.3 s yes/no check before the answer starts
async function matchRefs(refs, image, stopAtFirst = false) {
  const strip = d => d.replace(/^data:image\/\w+;base64,/, '');
  const hits = [];
  for (const r of refs.slice(-MAX_REFS)) {
    if (!r || typeof r.image !== 'string' || !r.name) continue;
    const name = String(r.name).replace(/[\r\n"]/g, ' ').slice(0, 60);
    const prompt = `Image 1 is a reference photo of a ${name}. Image 2 is a live camera view. ` +
      `Is a ${name} of the same kind as in image 1 clearly visible in image 2? Answer only YES or NO.`;
    const j = await (await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, stream: false, keep_alive: KEEP, options: { temperature: 0, num_predict: 4, num_ctx: CTX },
        messages: [{ role: 'user', content: prompt, images: [strip(r.image), strip(image)] }] }),
    })).json();
    if (/^\s*yes/i.test(j.message?.content || '')) { hits.push(name); if (stopAtFirst) break; }
  }
  return hits;
}

// Taught-photo check on its own: the browser calls this while you are still speaking or typing, so the answer does not wait for it.
async function match(req, res) {
  const b = await readJSON(req);
  const image = str(b.image);
  if (!image) throw bad(400, 'image is required');
  const t0 = Date.now();
  const matched = await matchRefs(arr(b.refs), image, b.first === true); // first: stop at the first match (used when the user is already waiting)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ matched, ms: Date.now() - t0 }));
}

async function chat(req, res) {
  const b = await readJSON(req);
  const messages = arr(b.messages), refs = arr(b.refs), facts = arr(b.facts);
  const frames = arr(b.frames).filter(f => typeof f === 'string');
  const pre = Array.isArray(b.matched) ? b.matched.filter(s => typeof s === 'string').map(s => s.slice(0, 60)).slice(0, 5) : null; // taught objects the browser already verified
  const image = str(b.image) || undefined, mode = str(b.mode, 'chat'), motion = str(b.motion), seconds = Number(b.seconds) || 0;
  if (!messages.length || !messages.every(m => m && typeof m.role === 'string' && typeof m.content === 'string')) throw bad(400, 'messages must be a non-empty list of {role, content}');
  // Attach the current camera frame to the latest user message only (keeps context small).
  const strip = d => d.replace(/^data:image\/\w+;base64,/, '');
  let msgs;
  if (frames.length) {
    // Action mode: the model cannot track motion across frames, so it gets 2-3 key frames plus motion measured in the browser.
    const fs = frames.slice(0, 3);
    const labels = fs.length === 3 ? 'first frame, peak-movement frame, last frame' : 'first frame, last frame';
    msgs = [{ role: 'system', content: SYSTEM + factsText(facts) + ` ACTION MODE: the ${fs.length} attached images are key frames in time order (${labels}) from a ` +
      `${Math.round(seconds) || 'few'}-second camera clip. ${String(motion).slice(0, 600)} Describe the action in one or two plain sentences: who or what is doing what, and how. ` +
      'Trust the measured motion for direction and repetition, and use the images to say what the moving thing is. Describe it naturally: do not quote the measurement wording or mention areas or percentages. If no movement was measured, say that nothing is moving.' },
      ...messages.slice(-4)]; // short history: the key frames already cost ~1k tokens each
    msgs[msgs.length - 1].images = fs.map(strip);
  } else {
    msgs = [{ role: 'system', content: SYSTEM + (MODES[mode] || '') + factsText(facts) }, ...messages];
    if (image) msgs[msgs.length - 1].images = [strip(image)];
  }
  const ac = new AbortController();           // stop generating if the browser goes away (e.g. new chat, closed tab)
  res.on('close', () => ac.abort());
  try {
    // Visual memory: verify each taught reference photo against the live frame (yes/no), then tell the
    // model only the verified names. Verifying first avoids false matches (see eval/visual_memory_eval.py).
    const matched = pre || ((image && !frames.length) ? await matchRefs(refs, image) : []);
    if (matched.length) msgs[0].content += ' Verified by comparing with photos the user taught you, the camera view contains: ' +
      matched.join(', ') + '. Use these exact names for those objects.';
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, messages: msgs, stream: true, keep_alive: KEEP, options: { num_ctx: CTX, num_predict: frames.length ? 120 : (mode === 'chat' ? 110 : 220) } }), // caps stop rambling
      signal: ac.signal,
    });
    if (!r.ok) throw new Error('Ollama returned ' + r.status + ': ' + (await r.text()).slice(0, 200));
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (refs.length) res.write(JSON.stringify({ matched }) + '\n');
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return res.end();    // the client left: nothing to report
    fail(res, 502, 'Ollama error: ' + e.message); // fail() also copes with headers already sent (stream broke midway)
  }
}

// Spatial grounding: ask the VLM for labelled boxes. Frames must be DET_W x DET_H (see app.js)
// because Qwen2.5-VL returns pixel coords in the size Ollama resizes to, which equals this size.
const DET = { w: 1204, h: 672 };
const GROUND = process.env.GROUND || 'pixel'; // 'pixel' (Qwen2.5-VL) or 'norm1000' (Qwen3-VL): how the model reports box coordinates
const toPixels = ([x1, y1, x2, y2]) => GROUND === 'norm1000'
  ? [x1 * DET.w / 1000, y1 * DET.h / 1000, x2 * DET.w / 1000, y2 * DET.h / 1000].map(Math.round) : [x1, y1, x2, y2];
async function detect(req, res) {
  const b = await readJSON(req);
  const image = str(b.image), query = str(b.query), facts = arr(b.facts);
  if (!image) throw bad(400, 'image is required');
  const target = query ? `Locate: ${query}. Only include matches.` : 'Locate every distinct, clearly visible object.';
  const prompt = `${target} Give each a short specific name (best guess if unsure, e.g. "ultrasonic sensor"). ` +
    'Output only compact JSON on a single line, no spaces or line breaks: [{"bbox_2d":[x1,y1,x2,y2],"label":"name"}]. Output [] if nothing matches.' + factsText(facts);
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, stream: false, keep_alive: KEEP, options: { temperature: 0, num_ctx: CTX, num_predict: 400 },
        messages: [{ role: 'user', content: prompt, images: [image.replace(/^data:image\/\w+;base64,/, '')] }] }),
    });
    const text = (await r.json()).message?.content || '';
    const m = text.match(/\[[\s\S]*\]/);
    let boxes = [];
    try { boxes = JSON.parse(m ? m[0] : '[]'); } catch { boxes = []; }
    boxes = arr(boxes).filter(b => b && Array.isArray(b.bbox_2d) && b.bbox_2d.length === 4)
      .map(b => ({ label: String(b.label || 'object'), box: toPixels(b.bbox_2d.map(Number)) })).slice(0, 12);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ boxes, ...DET }));
  } catch (e) {
    fail(res, 502, 'Ollama error: ' + e.message);
  }
}

// Service status for the UI lights: is the vision model installed in Ollama, is the speech service up?
async function health(res) {
  const j = { model: MODEL, vision: false, speech: false };
  try {
    const t = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) })).json();
    j.vision = (t.models || []).some(m => m.name === MODEL || m.name === MODEL + ':latest');
  } catch {}
  try { j.speech = (await fetch(`${STT}/`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j));
}

// Offline speech-to-text: forward the recorded audio to stt_server.py (faster-whisper).
async function stt(req, res) {
  const audio = await readBody(req, 25e6);
  try {
    const r = await fetch(`${STT}/transcribe${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`, { method: 'POST', body: audio });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(await r.text());
  } catch (e) {
    fail(res, 502, 'Offline speech service is not running (start stt_server.py): ' + e.message);
  }
}

async function route(req, res) {
  if (req.method === 'GET' && req.url === '/api/health') return health(res);
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/stt') return stt(req, res);
  if (req.method === 'POST' && req.url === '/api/match') return match(req, res);
  if (req.method === 'POST' && req.url === '/api/chat') return chat(req, res);
  if (req.method === 'POST' && req.url === '/api/detect') return detect(req, res);
  serveStatic(req, res);
}

http.createServer((req, res) => {
  route(req, res).catch(e => {
    const status = e.status || 500;
    if (status === 500) console.error('request failed:', e);
    fail(res, status, status === 500 ? 'internal server error' : e.message);
  });
}).listen(PORT, HOST, () => {
  console.log(`LensMate on http://${HOST}:${PORT} (model ${MODEL})`);
  // load the model now so the first question is not the slow one
  fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, prompt: '', keep_alive: KEEP, options: { num_ctx: CTX } }) }).catch(() => {});
});
