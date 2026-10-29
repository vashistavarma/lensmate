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
  'camera view through the attached image. Answer concisely (1-3 sentences) in plain speech, ' +
  'no markdown or lists. For objects you are unsure about, never just say you do not know: ' +
  'describe the visible cues (shape, labels, text, parts) and give your best guess, marked as ' +
  'a guess. If the user tells you what something is, trust them and remember it.';

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
async function matchRefs(refs, image) {
  const strip = d => d.replace(/^data:image\/\w+;base64,/, '');
  const hits = [];
  for (const r of refs.slice(-MAX_REFS)) {
    if (!r || !r.image || !r.name) continue;
    const name = String(r.name).replace(/[\r\n"]/g, ' ').slice(0, 60);
    const prompt = `Image 1 is a reference photo of a ${name}. Image 2 is a live camera view. ` +
      `Is a ${name} of the same kind as in image 1 clearly visible in image 2? Answer only YES or NO.`;
    const j = await (await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, stream: false, keep_alive: '10m', options: { temperature: 0, num_predict: 4, num_ctx: CTX },
        messages: [{ role: 'user', content: prompt, images: [strip(r.image), strip(image)] }] }),
    })).json();
    if (/^\s*yes/i.test(j.message?.content || '')) hits.push(name);
  }
  return hits;
}

async function chat(req, res) {
  let body = '';
  for await (const c of req) body += c;
  const { messages = [], image, mode = 'chat', facts = [], refs = [], frames = [], motion = '', seconds = 0 } = JSON.parse(body);
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
  try {
    // Visual memory: verify each taught reference photo against the live frame (yes/no), then tell the
    // model only the verified names. Verifying first avoids false matches (see eval/visual_memory_eval.py).
    const matched = (image && !frames.length) ? await matchRefs(refs, image) : [];
    if (matched.length) msgs[0].content += ' Verified by comparing with photos the user taught you, the camera view contains: ' +
      matched.join(', ') + '. Use these exact names for those objects.';
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, messages: msgs, stream: true, keep_alive: '10m', options: { num_ctx: CTX } }),
    });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (refs.length) res.write(JSON.stringify({ matched }) + '\n');
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.writeHead(502); res.end(JSON.stringify({ error: 'Ollama unreachable: ' + e.message }));
  }
}

// Spatial grounding: ask the VLM for labelled boxes. Frames must be DET_W x DET_H (see app.js)
// because Qwen2.5-VL returns pixel coords in the size Ollama resizes to, which equals this size.
const DET = { w: 1204, h: 672 };
const GROUND = process.env.GROUND || 'pixel'; // 'pixel' (Qwen2.5-VL) or 'norm1000' (Qwen3-VL): how the model reports box coordinates
const toPixels = ([x1, y1, x2, y2]) => GROUND === 'norm1000'
  ? [x1 * DET.w / 1000, y1 * DET.h / 1000, x2 * DET.w / 1000, y2 * DET.h / 1000].map(Math.round) : [x1, y1, x2, y2];
async function detect(req, res) {
  let body = '';
  for await (const c of req) body += c;
  const { image, query, facts = [] } = JSON.parse(body);
  const target = query ? `Locate: ${query}. Only include matches.` : 'Locate every distinct, clearly visible object.';
  const prompt = `${target} Give each a short specific name (best guess if unsure, e.g. "ultrasonic sensor"). ` +
    'Output only JSON: [{"bbox_2d":[x1,y1,x2,y2],"label":"name"}]. Output [] if nothing matches.' + factsText(facts);
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, stream: false, keep_alive: '10m', options: { temperature: 0, num_ctx: CTX },
        messages: [{ role: 'user', content: prompt, images: [image.replace(/^data:image\/\w+;base64,/, '')] }] }),
    });
    const text = (await r.json()).message?.content || '';
    const m = text.match(/\[[\s\S]*\]/);
    let boxes = [];
    try { boxes = JSON.parse(m ? m[0] : '[]'); } catch { boxes = []; }
    boxes = boxes.filter(b => Array.isArray(b.bbox_2d) && b.bbox_2d.length === 4)
      .map(b => ({ label: String(b.label || 'object'), box: toPixels(b.bbox_2d.map(Number)) })).slice(0, 12);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ boxes, ...DET }));
  } catch (e) {
    res.writeHead(502); res.end(JSON.stringify({ error: 'Ollama unreachable: ' + e.message }));
  }
}

// Service status for the UI lights: is the vision model installed in Ollama, is the speech service up?
async function health(res) {
  const j = { model: MODEL, think: false, vision: false, speech: false };
  try {
    const t = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) })).json();
    j.vision = (t.models || []).some(m => m.name === MODEL || m.name === MODEL + ':latest');
  } catch {}
  try { j.speech = (await fetch(`${STT}/`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j));
}

// Offline speech-to-text: forward the recorded audio to stt_server.py (faster-whisper).
async function stt(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const r = await fetch(`${STT}/transcribe${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`, { method: 'POST', body: Buffer.concat(chunks) });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(await r.text());
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Offline speech service is not running (start stt_server.py): ' + e.message }));
  }
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') return health(res);
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/stt') return stt(req, res);
  if (req.method === 'POST' && req.url === '/api/chat') return chat(req, res);
  if (req.method === 'POST' && req.url === '/api/detect') return detect(req, res);
  serveStatic(req, res);
}).listen(PORT, HOST, () => console.log(`LensMate on http://${HOST}:${PORT} (model ${MODEL})`));
