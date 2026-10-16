// The assistant's avatar, as the app draws it: a port of
// source/src/components/layout/AIAvatar.tsx without React. Same scene (glowing
// octahedron core, 35 shards, bloom, drifting particles), same three states and
// colours, same cursor parallax. Keep the two in step when the app's avatar
// changes.
//
// Like the app, it always animates (prefers-reduced-motion is not applied:
// the motion is the avatar). Showcase-only additions: it draws only while on
// screen, and when WebGL isn't available the CSS diamond in the element stays.
//
// build.mjs bundles this file (with three) into window.PMCAvatar.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// One cursor for every avatar on the page, as in the app (window-wide).
let mouseX = 0, mouseY = 0;
window.addEventListener('mousemove', e => {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
}, { passive: true });
window.addEventListener('touchmove', e => {
  if (!e.touches.length) return;
  mouseX = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
  mouseY = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
}, { passive: true });

const coreVertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewDirection;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const coreFragmentShader = `
  uniform vec3 color;
  uniform float time;
  uniform float intensity;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewDirection;
  void main() {
    float dist = length(vPosition);
    float radialGlow = smoothstep(2.5, 0.0, dist);
    float facingRatio = dot(vNormal, vViewDirection);
    float rim = pow(1.0 - max(0.0, facingRatio), 3.0);
    float direct = pow(max(0.0, facingRatio), 2.0);
    float combinedGlow = (radialGlow * 0.4) + (rim * 0.8) + (direct * 0.3);
    combinedGlow *= intensity;
    gl_FragColor = vec4(color * combinedGlow, min(combinedGlow, 1.0));
  }
`;

function smoothNoise(t) { return Math.sin(t) * Math.cos(t * 1.5) * Math.sin(t * 0.5); }

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}
const HAS_GL = webglOK();

// opts.distance: camera distance (the app's is 6); a larger tile reads better a little further back.
function create(container, initial = 'idle', opts = {}) {
  let state = initial;
  let wake = () => {};
  const api = { el: container, setState(s) { if (s === state) return; state = s; wake(); }, get state() { return state; } };
  if (!HAS_GL) return api;

  const width = container.clientWidth || 44;
  const height = container.clientHeight || 44;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1520, 0.05);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.z = opts.distance || 6;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
  catch { return api; }
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.querySelector('.ai-core')?.remove();
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.01, 0.6);
  const outerGlowPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.1, 0.03, 0.1);
  composer.addPass(bloomPass);
  composer.addPass(outerGlowPass);

  const group = new THREE.Group();
  scene.add(group);

  const coreMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x00e5ff) }, time: { value: 0 }, intensity: { value: 1.5 } },
    vertexShader: coreVertexShader, fragmentShader: coreFragmentShader,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(2, 0), coreMat);
  group.add(core);

  const innerCore = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), new THREE.MeshStandardMaterial({
    color: 0x004466, emissive: 0x0088cc, emissiveIntensity: 0.8, flatShading: true,
  }));
  group.add(innerCore);

  const shards = [];
  const shardGeo = new THREE.TetrahedronGeometry(0.4, 0);
  const shardMat = new THREE.MeshStandardMaterial({
    color: 0x1a202c, metalness: 0.6, roughness: 0.5, emissive: 0x00e5ff, emissiveIntensity: 0.1, flatShading: true,
  });
  for (let i = 0; i < 35; i++) {
    const mesh = new THREE.Mesh(shardGeo, shardMat.clone());
    const radius = 1.8 + Math.random() * 2.0;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const s = 0.5 + Math.random() * 0.8;
    mesh.scale.set(s, s, s);
    shards.push({
      mesh, baseX: x, baseY: y, baseZ: z, target: new THREE.Vector3(x, y, z),
      speed: 0.5 + Math.random() * 1.5, offset: Math.random() * Math.PI * 2,
      rx: (Math.random() - 0.5) * 0.02, ry: (Math.random() - 0.5) * 0.02,
    });
    group.add(mesh);
  }

  scene.add(new THREE.AmbientLight(0x002244, 0.2));
  const coreLight = new THREE.PointLight(0x00e5ff, 15, 20);
  group.add(coreLight);
  const d1 = new THREE.DirectionalLight(0xffffff, 0.15); d1.position.set(5, 5, 5); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x00aaff, 0.1); d2.position.set(-5, -5, -5); scene.add(d2);

  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(300);
  for (let i = 0; i < 300; i++) pos[i] = (Math.random() - 0.5) * 15;
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.05, color: 0x00e5ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
  }));
  scene.add(particles);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer.setSize(w, h);
  };
  new ResizeObserver(resize).observe(container);

  let time = 0, lastState = '', lastFrame = 0, ticking = false;
  const FRAME_MS = 1000 / 30;

  function step(steps) {
    time += 0.016 * steps;
    if (state !== lastState) {
      lastState = state;
      const hex = state === 'thinking' ? 0xff3333 : state === 'responding' ? 0x00ffff : 0x00e5ff;
      coreMat.uniforms.color.value.setHex(hex);
      coreLight.color.setHex(state === 'thinking' ? 0xff0000 : hex);
      coreLight.intensity = state === 'thinking' ? 20 : state === 'responding' ? 25 : 15;
    }
    coreMat.uniforms.time.value = time;

    group.rotation.y += (mouseX * 0.8 - group.rotation.y) * 0.05;
    group.rotation.x += (-mouseY * 0.8 - group.rotation.x) * 0.05;
    group.position.y = Math.sin(time * 2) * 0.3;
    group.position.x = Math.cos(time * 1.5) * 0.1;
    particles.rotation.y = time * 0.05;

    if (state === 'idle') {
      core.rotation.y += 0.005; core.rotation.x += 0.003; innerCore.rotation.y -= 0.004;
      const p = 1 + Math.sin(time * 3) * 0.05;
      core.scale.set(p, p, p);
      coreLight.intensity = 15 + Math.sin(time * 3) * 5;
      for (const s of shards) {
        s.target.set(
          s.baseX + Math.sin(time * s.speed + s.offset) * 0.2,
          s.baseY + Math.cos(time * s.speed * 0.8 + s.offset) * 0.2,
          s.baseZ + Math.sin(time * s.speed * 1.2 + s.offset) * 0.2);
        s.mesh.rotation.x += s.rx; s.mesh.rotation.y += s.ry;
        s.mesh.material.emissiveIntensity = 0.1;
      }
    } else if (state === 'thinking') {
      core.rotation.y += 0.02; core.rotation.z += 0.01; innerCore.rotation.y -= 0.015;
      const p = 1 + Math.sin(time * 8) * 0.08;
      core.scale.set(p, p, p);
      coreLight.intensity = 20 + Math.sin(time * 8) * 8;
      for (const s of shards) {
        const k = 0.8, a = time * s.speed * 0.5 + s.offset;
        s.target.set(
          s.baseX * k * Math.cos(a) - s.baseZ * k * Math.sin(a),
          s.baseY * k + Math.sin(time * s.speed * 2) * 0.3,
          s.baseZ * k * Math.cos(a) + s.baseX * k * Math.sin(a));
        s.mesh.rotation.x += s.rx * 3; s.mesh.rotation.y += s.ry * 3;
        s.mesh.material.emissiveIntensity = 0.2;
      }
    } else {
      const speech = Math.abs(smoothNoise(time * 5)) * 0.8 + Math.abs(Math.sin(time * 10)) * 0.4;
      core.rotation.y += 0.01; innerCore.rotation.y += 0.01;
      const sc = 1 + speech * 0.3;
      core.scale.set(sc, sc, sc);
      coreLight.intensity = 15 + speech * 20;
      for (const s of shards) {
        const push = 1 + speech * (0.5 + Math.sin(s.offset) * 0.5);
        s.target.set(s.baseX * push, s.baseY * push, s.baseZ * push);
        s.mesh.rotation.x += s.rx * 2;
        s.mesh.material.emissiveIntensity = speech > 0.6 ? 0.8 : 0.1;
      }
    }
    for (const s of shards) s.mesh.position.lerp(s.target, 0.1);
    composer.render();
  }

  // Drawn only while on screen. Visibility is measured here rather than with
  // IntersectionObserver, and each frame is asked of requestAnimationFrame
  // with a timer as backup: embedded previews (an app's side panel, a
  // sandboxed iframe) can misreport the one and throttle the other, which
  // froze the avatar after its first frame.
  function onScreen() {
    if (document.hidden) return false;
    const r = container.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
      && r.top < (window.innerHeight || document.documentElement.clientHeight)
      && r.left < (window.innerWidth || document.documentElement.clientWidth);
  }
  function next(delay) {
    let done = false, raf = 0, to = 0;
    const run = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(to); tick(); };
    if (delay) { to = setTimeout(run, delay); return; }
    raf = requestAnimationFrame(run);
    to = setTimeout(run, 50);
  }
  function tick() {
    if (!onScreen()) { lastFrame = 0; next(300); return; }   // check back cheaply
    const now = performance.now();
    if (lastFrame && now - lastFrame < FRAME_MS - 1) { next(); return; }
    const steps = lastFrame ? Math.min(4, (now - lastFrame) / (1000 / 60)) : 1;
    lastFrame = now;
    step(steps);
    next();
  }
  function kick() { if (!ticking) { ticking = true; tick(); } }

  wake = kick;
  resize();
  kick();
  return api;
}

// The demo re-renders its sidebar with innerHTML; a WebGL canvas can't survive
// that, so each keyed avatar lives once and is moved into the new slot.
const kept = new Map();
function mount(slot, key, state = 'idle') {
  let a = kept.get(key);
  if (!a) {
    a = create(slot, state);
    kept.set(key, a);
  } else {
    slot.replaceWith(a.el);
  }
  a.setState(state);
  return a;
}

window.PMCAvatar = { create, mount, get: key => kept.get(key) };
