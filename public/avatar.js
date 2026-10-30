// The LensMate companion. A glowing orb that reacts to idle / listening / thinking / speaking and flies next to whatever it
// just labelled. By default it SITS in the room: world.js gives it an anchor that moves with the camera picture, so when you
// pan the camera it stays on its spot (2-D only: it does not understand depth or rotation). It also has a small attention
// system (looks at what moves, at you while listening, wanders with saccades), blinks irregularly, gets drowsy when ignored,
// and its mouth follows the loudness of the local voice.
import * as THREE from './vendor/three.module.min.js';

const canvas = document.getElementById('avatar');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const cam3 = new THREE.OrthographicCamera(0, 1, 1, 0, -500, 500); // 1 unit = 1 CSS pixel, y down

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-1, 1.5, 2); scene.add(key);
const glow = new THREE.PointLight(0x4fd1c5, 2, 0); scene.add(glow);

const rig = new THREE.Group(); scene.add(rig);

const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3),
  new THREE.MeshStandardMaterial({ color: 0x1b2a2e, emissive: 0x4fd1c5, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.2 }));
rig.add(body);
const base = body.geometry.attributes.position.array.slice(); // rest shape for the wobble

const halo = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.12, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
rig.add(halo);

const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.04, 8, 64),
  new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.8 }));
ring.rotation.x = 1.2; rig.add(ring);

const eyes = [-0.38, 0.38].map(x => {
  const g = new THREE.Group(); g.position.set(x, 0.18, 0.9);
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4fffe }));
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: 0x07201d }));
  pupil.position.z = 0.15; g.add(white, pupil); rig.add(g); g.userData.pupil = pupil; return g;
});
const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0x07201d }));
mouth.position.set(0, -0.3, 0.92); mouth.scale.set(1.4, 0.15, 0.4); rig.add(mouth);

const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
shadow.position.z = -300; scene.add(shadow);

const COLORS = { idle: 0x4fd1c5, listening: 0x63b3ed, thinking: 0xf6ad55, speaking: 0x68d391 };
const pos = new THREE.Vector2(), vel = new THREE.Vector2(), ground = new THREE.Vector2();
let state = 'idle', lastText = 0, point = null;
const color = new THREE.Color(COLORS.idle);
let W = 1, H = 1, R = 50;

// attention / life state
const at = { mode: 'wander', gx: 0, gy: 0, eyeX: 0, eyeY: 0, headX: 0, headY: 0, wx: 0, wy: 0, nextSaccade: 1, jx: 0, jy: 0, nextJitter: 0.3,
             fgX: 0, fgY: 0, fgSeen: -99, fgPrev: -99, startle: 0, dodge: 0, lastActive: performance.now(), drowsy: 0,
             nextBlink: 2, blink: 0, blinkAgain: false, drop: 0, dropV: 0, squash: 0, landedAt: 0, mouth: 0.15 };
const wake = () => { at.lastActive = performance.now(); };

function setState(s) { state = s; wake(); }
window.addEventListener('lens-state', e => setState(e.detail));
window.addEventListener('lens-point', e => { point = e.detail; wake(); }); // {x,y} in CSS px, or null
const prevText = window.onBotText; // wrap the TTS hook from voice.js
window.onBotText = (t, done) => { prevText?.(t, done); lastText = performance.now(); setState('speaking'); };
const forced = new URLSearchParams(location.hash.slice(1)).get('state');
if (forced) setState(forced);

function resize() {
  W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(W, H, false);
  cam3.right = W; cam3.bottom = H; cam3.updateProjectionMatrix();
  R = Math.max(28, Math.min(W, H) * 0.09);
  pos.set(W - R * 2.2, H - R * 2.2); vel.set(0, 0); ground.set(pos.x, pos.y + R * 1.2); // snap home on layout change
}
new ResizeObserver(resize).observe(canvas); resize();

const clampN = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
let lastT = performance.now() / 1000, t = 0;
function frame() {
  const nowS = performance.now() / 1000, dt = Math.min(nowS - lastT, 0.05); lastT = nowS; t += dt;
  const now = performance.now();
  if (state === 'speaking' && !speechSynthesis.speaking && !window.lensTtsActive?.() && now - lastText > 900) state = 'idle';
  const world = window.lensWorld, view = world?.view?.() || { mode: 'floating' };
  const anchored = view.mode === 'anchored', S = anchored ? view.scale : 1;
  const Rs = R * S;

  // ---- where to be ----
  let tx, ty;
  const flying = !!point;
  if (flying) { tx = Math.min(W - R * 1.5, point.x + R * 1.6); ty = Math.max(R * 1.5, point.y - R * 1.4); }
  else if (anchored) { tx = view.x; ty = view.y - Rs * 1.15; }
  else { tx = W - R * 2.2; ty = H - R * 2.2; }
  if (anchored && view.landedAt !== at.landedAt) { at.landedAt = view.landedAt; at.drop = -R * 4; at.dropV = 0; if (!flying) { pos.set(view.x, view.y - Rs * 1.15); vel.set(0, 0); } wake(); }

  // foreground motion (somebody/something moving in the picture, not the camera itself)
  const fg = world?.fg, camMoving = world && Math.abs(world.motion.dx) + Math.abs(world.motion.dy) > 1.5;
  let fgScreen = null;
  if (fg && fg.frac > 0.05 && !camMoving) { const m = window.lensMirror?.(); fgScreen = { x: (m ? 1 - fg.cx : fg.cx) * W, y: fg.cy * H, frac: fg.frac }; }
  if (fgScreen) {
    if (now - at.fgSeen > 2500) { at.startle = 1; wake(); }          // something new appeared: notice it
    at.fgSeen = now;
    const k = 1 - Math.exp(-dt / 0.15);                              // reaction lag ~150 ms
    at.fgX += (fgScreen.x - at.fgX) * k; at.fgY += (fgScreen.y - at.fgY) * k;
    wake();
  }
  // dodge: step aside when something big moves up close (only while sitting in the room)
  let dodgeT = 0;
  if (anchored && !flying && fgScreen && fgScreen.frac > 0.08 && Math.hypot(at.fgX - pos.x, at.fgY - pos.y) < Rs * 2.6) dodgeT = Math.sign(pos.x - at.fgX || 1) * Rs * 1.1;
  at.dodge += (dodgeT - at.dodge) * (1 - Math.exp(-dt / 0.18));
  tx += at.dodge;

  ty += Math.sin(t * 1.6) * R * 0.1 * (1 - at.drowsy * 0.6);          // float / breathe
  const near = Math.hypot(tx - pos.x, ty - pos.y) < R * 2.5 && !flying;
  const k1 = near && anchored ? 0.35 : 0.06, k2 = near && anchored ? 0.55 : 0.80;  // anchored and close: stiff, so it stays glued to its spot while the picture moves
  vel.x = (vel.x + (tx - pos.x) * k1) * k2; vel.y = (vel.y + (ty - pos.y) * k1) * k2;
  pos.add(vel);

  // landing: drop + squash
  if (at.drop < 0 || at.dropV) {
    at.dropV += R * 0.06; at.drop += at.dropV;
    if (at.drop >= 0) { at.drop = 0; if (at.dropV > R * 0.5) { at.squash = Math.min(0.35, at.dropV / (R * 1.6)); at.dropV *= -0.3; } else at.dropV = 0; }
  }
  at.squash *= 0.88;
  rig.position.set(pos.x, pos.y + at.drop, 0);

  // contact shadow: on the ground under the spot; when flying it lies under the orb and fades with height
  const gy = anchored && !flying ? view.y + at.drop * 0 : pos.y + Rs * 1.5;
  ground.x += ((anchored && !flying ? view.x + at.dodge : pos.x) - ground.x) * 0.5; ground.y += (gy - ground.y) * 0.5;
  const height = Math.max(0, ground.y - (pos.y + at.drop) - Rs * 1.15);
  shadow.position.set(ground.x, ground.y, -300);
  shadow.scale.set(Rs * 1.05 / (1 + height / (R * 4)), Rs * 0.3 / (1 + height / (R * 4)), 1);
  shadow.material.opacity = 0.34 / (1 + height / (R * 1.2)) * (anchored || flying ? 1 : 0.5);

  const lean = state === 'listening' ? 1.12 : 1, base1 = Rs * lean * (1 + Math.sin(t * 2) * 0.02) * (1 + at.startle * 0.12);
  rig.scale.set(base1 * (1 + at.squash * 0.6), base1 * (1 - at.squash), base1);
  // lean when the picture pans or the orb moves
  const panDx = view.motion ? view.motion.dx : 0;
  rig.rotation.z += (clampN(-(panDx * 0.05 + vel.x * 0.02), -0.3, 0.3) - rig.rotation.z) * 0.2;

  // ---- attention: pointing target > moving thing > the user (while listening) > wandering ----
  let gazeX, gazeY;
  if (point) { at.mode = 'point'; gazeX = point.x; gazeY = point.y; }
  else if (fgScreen || now - at.fgSeen < 700) { at.mode = 'motion'; gazeX = at.fgX; gazeY = at.fgY; }
  else if (state === 'listening' || state === 'speaking') { at.mode = 'user'; gazeX = pos.x; gazeY = pos.y; }
  else {
    at.mode = 'wander';
    if (t > at.nextSaccade) { at.wx = (Math.random() * 2 - 1) * W * 0.35; at.wy = (Math.random() * 2 - 1) * H * 0.25; at.nextSaccade = t + 0.8 + Math.random() * 1.8; }
    gazeX = pos.x + at.wx; gazeY = pos.y + at.wy;
  }
  if (t > at.nextJitter) { at.jx = (Math.random() - 0.5) * 0.12; at.jy = (Math.random() - 0.5) * 0.08; at.nextJitter = t + 0.2 + Math.random() * 0.4; }   // micro-saccades
  const wantX = clampN((gazeX - pos.x) / (R * 4)) + at.jx, wantY = clampN((gazeY - pos.y) / (R * 3)) + at.jy;
  at.eyeX += (wantX - at.eyeX) * 0.4; at.eyeY += (wantY - at.eyeY) * 0.4;          // eyes jump first
  at.headX += (wantX - at.headX) * 0.07; at.headY += (wantY - at.headY) * 0.07;    // head follows later
  eyes.forEach(g => g.userData.pupil.position.set(at.eyeX * 0.13, -at.eyeY * 0.11, 0.15));
  rig.rotation.y += ((at.headX * 0.45) - rig.rotation.y) * 0.1;
  rig.rotation.x += ((-at.headY * 0.3) - rig.rotation.x) * 0.1;

  // drowsy after a long quiet spell, wakes on any activity
  const quiet = state === 'idle' && now - at.lastActive > 45000;
  at.drowsy += ((quiet ? 1 : 0) - at.drowsy) * (quiet ? 0.004 : 0.15);
  at.startle = Math.max(0, at.startle - dt * 3);

  // blinks: irregular, sometimes double
  if (t > at.nextBlink) { at.blink = 1; at.nextBlink = at.blinkAgain ? t + 0.25 : t + 1.5 + Math.random() * 5; at.blinkAgain = !at.blinkAgain && Math.random() < 0.2; }
  at.blink = Math.max(0, at.blink - dt * 8);
  const lid = Math.max(1 - 0.9 * Math.sin(at.blink * Math.PI), 0), open = (1 - at.drowsy * 0.55 + at.startle * 0.25) * lid;
  eyes.forEach(g => g.scale.y = Math.max(0.05, open));

  // mouth: follows the loudness of the local voice; browser voice falls back to a rhythm
  const lvl = window.lensVoiceLevel?.() || 0;
  const talk = state === 'speaking' ? (lvl > 0 ? 0.12 + lvl * 1.3 : (speechSynthesis.speaking ? 0.25 + Math.abs(Math.sin(t * 14) * Math.sin(t * 5.3)) * 0.9 : 0.15)) : 0.15;
  at.mouth += (talk - at.mouth) * 0.5; mouth.scale.y = at.mouth;

  // body wobble (stronger when thinking / speaking), ring spin, colour blend
  const amp = { idle: 0.03, listening: 0.07, thinking: 0.08, speaking: 0.06 }[state] * (1 - at.drowsy * 0.5);
  const p = body.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    const n = 1 + amp * Math.sin(x * 3 + t * 2.2) * Math.cos(y * 3 - t * 1.7) * Math.sin(z * 3 + t * 1.3);
    p.setXYZ(i, x * n, y * n, z * n);
  }
  p.needsUpdate = true; body.geometry.computeVertexNormals();
  ring.rotation.z += state === 'thinking' ? 0.12 : 0.012;
  ring.material.opacity = state === 'thinking' ? 0.95 : 0.5;
  halo.scale.setScalar(1 + (state === 'listening' ? Math.sin(t * 6) * 0.08 : 0));
  color.lerp(new THREE.Color(COLORS[state]), 0.12);
  body.material.emissive.copy(color); ring.material.color.copy(color); halo.material.color.copy(color); glow.color.copy(color);
  glow.position.set(pos.x, pos.y, 120);

  renderer.render(scene, cam3);
  requestAnimationFrame(frame);
}
frame();

window.lensAvatar = { setState, point: p => { point = p; }, debug: () => ({
  state, gaze: at.mode, anchored: window.lensWorld?.view?.().mode === 'anchored', x: pos.x, y: pos.y, groundX: ground.x, groundY: ground.y,
  drowsy: at.drowsy, startle: at.startle, dodge: at.dodge, mouth: at.mouth, blink: at.blink, squash: at.squash, scale: rig.scale.y, shadow: shadow.material.opacity,
  eyeX: at.eyeX, headX: at.headX, lastActiveMs: performance.now() - at.lastActive }),
  forceDrowsy: () => { at.lastActive -= 60000; } };
