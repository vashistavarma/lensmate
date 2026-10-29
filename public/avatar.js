// Step 4: the LensMate companion. A glowing orb that floats over the camera view, reacts to
// idle / listening / thinking / speaking, and flies next to whatever it just labelled.
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

const COLORS = { idle: 0x4fd1c5, listening: 0x63b3ed, thinking: 0xf6ad55, speaking: 0x68d391 };
const pos = new THREE.Vector2(), vel = new THREE.Vector2();
let state = 'idle', lastText = 0, point = null, nextBlink = 2, blink = 0;
const color = new THREE.Color(COLORS.idle);
let W = 1, H = 1, R = 50;

function setState(s) { state = s; }
window.addEventListener('lens-state', e => setState(e.detail));
window.addEventListener('lens-point', e => { point = e.detail; }); // {x,y} in CSS px, or null
const prevText = window.onBotText; // wrap the TTS hook from voice.js
window.onBotText = (t, done) => { prevText?.(t, done); lastText = performance.now(); setState('speaking'); };
window.lensAvatar = { setState, point: p => { point = p; } }; // handy for debugging / demos
const forced = new URLSearchParams(location.hash.slice(1)).get('state');
if (forced) setState(forced);

function resize() {
  W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(W, H, false);
  cam3.right = W; cam3.bottom = H; cam3.updateProjectionMatrix();
  R = Math.max(28, Math.min(W, H) * 0.09);
  pos.set(W - R * 2.2, H - R * 2.2); vel.set(0, 0); // snap home on layout change
}
new ResizeObserver(resize).observe(canvas); resize();

const clock = new THREE.Clock();
function frame() {
  const t = clock.getElapsedTime(), dt = Math.min(clock.getDelta() || 0.016, 0.05);
  const now = performance.now();
  if (state === 'speaking' && !speechSynthesis.speaking && now - lastText > 900) state = 'idle';

  // Target position: next to the labelled object when pointing, otherwise home (bottom-right).
  let tx = W - R * 2.2, ty = H - R * 2.2;
  if (point) { tx = Math.min(W - R * 1.5, point.x + R * 1.6); ty = Math.max(R * 1.5, point.y - R * 1.4); }
  ty += Math.sin(t * 1.6) * R * 0.12; // float
  // critically-damped-ish spring toward the target
  vel.x += (tx - pos.x) * 0.06; vel.y += (ty - pos.y) * 0.06; vel.multiplyScalar(0.80);
  pos.add(vel);
  rig.position.set(pos.x, pos.y, 0);
  const lean = state === 'listening' ? 1.12 : 1;
  rig.scale.setScalar(R * lean * (1 + Math.sin(t * 2) * 0.02));

  // face: look toward the pointed-at object, else slowly around
  const lookX = point ? Math.sign(point.x - pos.x) * 0.5 : Math.sin(t * 0.6) * 0.35;
  const lookY = point ? Math.sign(point.y - pos.y) * 0.3 : Math.sin(t * 0.9) * 0.15;
  eyes.forEach(g => g.userData.pupil.position.set(lookX * 0.12, -lookY * 0.12, 0.15));
  rig.rotation.y += ((lookX * 0.4) - rig.rotation.y) * 0.08;
  rig.rotation.x += ((-lookY * 0.3) - rig.rotation.x) * 0.08;

  // blink
  if (t > nextBlink) { blink = 1; nextBlink = t + 2 + Math.random() * 3; }
  blink = Math.max(0, blink - 0.12);
  eyes.forEach(g => g.scale.y = 1 - 0.9 * Math.sin(blink * Math.PI));

  // mouth: talks while speaking, tiny smile otherwise
  const talk = state === 'speaking' ? 0.25 + Math.abs(Math.sin(t * 14) * Math.sin(t * 5.3)) * 0.9 : 0.15;
  mouth.scale.y += (talk - mouth.scale.y) * 0.4;

  // body wobble (stronger when thinking / speaking), ring spin, colour blend
  const amp = { idle: 0.03, listening: 0.07, thinking: 0.08, speaking: 0.06 }[state];
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
