import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { THEMES, TOP_Y, levelAt } from './themes.js';
import { Sky } from './sky.js';
import { Player } from './player.js';
import { Avatar, PALETTE } from './avatar.js';
import { Net } from './net.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('ascent.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ascent.' + k, JSON.stringify(v)); } catch {} } };
const qs = new URLSearchParams(location.search);

// ------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xffffff, 0.001);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 9000);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 320 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const pool = []; for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 20, 2); scene.add(l); pool.push(l); }

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.7, 0.9);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.35 }, uFall: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig,uFall; varying vec2 vUv;
    void main(){ vec2 c=vUv-0.5; float d=dot(c,c); float ab=uFall*0.012*d;
      vec3 col=vec3(texture2D(tDiffuse,vUv+c*ab).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-c*ab).b);
      col*=1.0-uVig*smoothstep(0.12,0.62,d*1.7);
      gl_FragColor=vec4(col,1.0); }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ------------------------------------------------------------ state
const world = new World(scene);
const sky = new Sky(scene, renderer);
const player = new Player(world);
const audio = new Audio();
const net = new Net();
const me = { name: store.get('name', ''), col: store.get('col', 0) };
let avatar = null;
const remotes = new Map();
const S = { running: false, cp: 0, best: store.get('best', 0), level: 0, bannerT: 0, locked: false, chat: false, summit: false, respawnCD: 0 };
const cam = { yaw: Math.PI, pitch: 0.28, dist: 6.2, tdist: 6.2 };
const keys = {}; let jumpEdge = false;
const inp = { mx: 0, mz: 0, sprint: false, jumpPressed: false, jumpHeld: false };

// ------------------------------------------------------------ UI helpers
function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms); }
function banner(title, sub) { const b = $('banner'); $('bt').textContent = title; $('bs').textContent = sub; b.classList.add('on'); clearTimeout(banner.h); banner.h = setTimeout(() => b.classList.remove('on'), 4200); }
function chatLine(name, text, col) {
  const d = document.createElement('div'); d.innerHTML = '<b></b> <span></span>';
  d.querySelector('b').textContent = name + ':'; d.querySelector('b').style.color = col; d.querySelector('span').textContent = text;
  const log = $('chatlog'); log.appendChild(d); while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => d.remove(), 14000);
}
function lock() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch {} }
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

// ------------------------------------------------------------ build
async function boot() {
  const bar = $('ldbar'), txt = $('ldtxt');
  const msgs = ['Raising the meadows…', 'Casting the Foundry…', 'Digging the trenches…', 'Scattering the ashes…', 'Lighting the gas lamps…', 'Freezing the machines…', 'Growing alien crystals…', 'Planting the garden…'];
  await new Promise((r) => setTimeout(r, 30));
  await world.generate(scene, async (n, tot) => { bar.style.width = (n / tot * 100) + '%'; txt.textContent = msgs[n - 1] || ''; await new Promise((r) => setTimeout(r, 16)); });
  // restore progress
  const saved = qs.has('fresh') ? 0 : store.get('cp', 0);
  S.cp = Math.min(saved, world.checkpoints.length - 1);
  if (qs.has('lvl')) { const L = +qs.get('lvl'); const i = world.checkpoints.findIndex((c) => c.lvl === L && c.idx === 0); if (i >= 0) S.cp = i; }
  if (qs.has('cp')) S.cp = Math.min(+qs.get('cp'), world.checkpoints.length - 1);
  world.activateCheckpoint(world.checkpoints[S.cp], true);
  respawn(true);
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (qs.has('solo')) startGame(null);
  requestAnimationFrame(frame);
}

function respawn(silent) {
  const cp = world.checkpoints[S.cp];
  let yaw = player.yaw;
  if (S.cp === 0) yaw = world.spawn.yaw;
  player.teleport(cp.x, cp.y + 0.05, cp.z, yaw);
  if (S.cp === 0) { player.pos.set(world.spawn.x, world.spawn.y, world.spawn.z); }
  cam.yaw = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) * 0 + (Math.PI + player.yaw) * 1;
  if (!silent) { audio.respawn(); }
}

// ------------------------------------------------------------ menu
const sw = $('swatches');
PALETTE.forEach((c, i) => { const e = document.createElement('i'); e.style.background = hexCss(c); if (i === me.col) e.classList.add('on'); e.onclick = () => { me.col = i; [...sw.children].forEach((x, j) => x.classList.toggle('on', j === i)); }; sw.appendChild(e); });
$('name').value = me.name;
$('room').value = store.get('room', '');
$('relay').value = store.get('relay', '');

function startGame(info) {
  me.name = ($('name').value || 'Wanderer').trim().slice(0, 16);
  store.set('name', me.name); store.set('col', me.col);
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (avatar) scene.remove(avatar.root);
  avatar = new Avatar(PALETTE[me.col]); scene.add(avatar.root);
  S.running = true;
  audio.start();
  lock();
  buildMeterDots();
  banner(THEMES[levelAt(player.pos.y)].name, THEMES[levelAt(player.pos.y)].sub);
  if (info) toast(info);
}
$('solo').onclick = () => { net.close(); startGame(null); };
$('join').onclick = async () => {
  const room = $('room').value.trim(), pass = $('pass').value, err = $('err');
  err.textContent = '';
  if (!room || pass.length < 3) { err.textContent = 'Enter a room name and a password (3+ characters).'; return; }
  let relay = $('relay').value.trim();
  if (!relay) relay = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  else if (!/^wss?:\/\//.test(relay)) relay = 'wss://' + relay;
  store.set('room', room); store.set('relay', $('relay').value.trim());
  $('join').disabled = true; $('join').textContent = 'Connecting…';
  try {
    me.name = ($('name').value || 'Wanderer').trim().slice(0, 16);
    const w = await net.connect(relay, { room, pass, name: me.name, col: me.col });
    wireNet(w);
    startGame(w.created ? `Room “${room}” created — share the name and password` : `Joined “${room}”`);
  } catch (e) { err.textContent = e.message; }
  $('join').disabled = false; $('join').textContent = 'Create / join room';
};

// ------------------------------------------------------------ networking
function addRemote(p) {
  if (remotes.has(p.id)) return;
  const av = new Avatar(PALETTE[p.col % 8], p.name); scene.add(av.root);
  const r = { id: p.id, name: p.name, col: p.col % 8, av, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), yaw: 0, tyaw: 0, anim: 'idle', speed: 0, init: false };
  if (p.s) applyState(r, p.s);
  remotes.set(p.id, r);
}
function applyState(r, s) {
  r.tgt.set(s.p[0], s.p[1], s.p[2]); r.tyaw = s.r; r.anim = s.a || 'idle'; r.speed = s.v || 0;
  if (!r.init) { r.pos.copy(r.tgt); r.yaw = r.tyaw; r.init = true; }
}
function wireNet(w) {
  remotes.forEach((r) => scene.remove(r.av.root)); remotes.clear();
  w.players.forEach(addRemote);
  net.on.join = (m) => { addRemote(m); toast(`${m.name} joined`); chatLine('•', `${m.name} joined`, '#9ad'); };
  net.on.leave = (m) => { const r = remotes.get(m.id); if (r) { scene.remove(r.av.root); remotes.delete(m.id); chatLine('•', `${r.name} left`, '#9ad'); } };
  net.on.s = (m) => { const r = remotes.get(m.id); if (r) applyState(r, m); };
  net.on.chat = (m) => { const r = remotes.get(m.id); chatLine(m.name, m.m, hexCss(PALETTE[(r ? r.col : (m.id === net.id ? me.col : 0)) % 8])); audio.chat(); };
  net.on.cp = (m) => { chatLine('⚑', `${m.name} reached level ${m.l + 1}`, '#ffcf6b'); };
  net.on.summit = (m) => { toast(`${m.name} reached the summit!`, 4000); chatLine('★', `${m.name} reached the summit`, '#ffe080'); };
  net.on.close = () => { toast('Disconnected from relay — continuing solo', 4000); remotes.forEach((r) => scene.remove(r.av.root)); remotes.clear(); };
}

// ------------------------------------------------------------ input
addEventListener('keydown', (e) => {
  if (S.chat) {
    if (e.code === 'Enter') { const v = $('chatin').value.trim(); if (v) net.send({ t: 'chat', m: v }); closeChat(); }
    else if (e.code === 'Escape') closeChat();
    return;
  }
  if (!S.running) return;
  keys[e.code] = true;
  if (e.code === 'Space') { jumpEdge = true; e.preventDefault(); }
  if (e.code === 'KeyR' && S.respawnCD <= 0) { respawn(); S.respawnCD = 0.5; }
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); toast(audio.muted ? 'Sound off' : 'Sound on', 1200); }
  if (e.code === 'Enter' && net.connected) openChat();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
function openChat() { S.chat = true; for (const k in keys) keys[k] = false; document.exitPointerLock && document.exitPointerLock(); const c = $('chatin'); c.classList.remove('hidden'); c.value = ''; setTimeout(() => c.focus(), 0); }
function closeChat() { S.chat = false; const c = $('chatin'); c.classList.add('hidden'); c.blur(); lock(); }
addEventListener('mousemove', (e) => {
  if (!S.locked || !S.running) return;
  cam.yaw -= e.movementX * 0.0024; cam.pitch = Math.max(-0.6, Math.min(1.25, cam.pitch + e.movementY * 0.0022));
});
addEventListener('wheel', (e) => { cam.tdist = Math.max(2.5, Math.min(14, cam.tdist + e.deltaY * 0.005)); }, { passive: true });
document.addEventListener('pointerlockchange', () => { S.locked = document.pointerLockElement === canvas; $('hint').style.display = S.locked || !S.running ? 'none' : 'block'; });
canvas.addEventListener('click', () => { if (S.running && !S.locked && !S.chat) lock(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ------------------------------------------------------------ meter + HUD
let dots = [];
function buildMeterDots() {
  const md = $('meterdots'); md.innerHTML = '';
  THEMES.forEach((t, i) => {
    const y = i === 0 ? 0 : i * 120; const d = document.createElement('i');
    d.style.bottom = (y / TOP_Y * 100) + '%'; d.style.background = hexCss(t.hor.getHex()); d.style.opacity = 0.7; d.style.width = '9px'; d.style.height = '9px'; d.style.left = '-2px'; d.style.border = '1px solid #fff';
    md.appendChild(d);
  });
}
function updateHud(y) {
  $('altv').textContent = Math.max(0, Math.round(y));
  $('best').textContent = `best ${Math.round(S.best)} m`;
  $('lvlname').innerHTML = `${S.level + 1}/8 · ${THEMES[S.level].name}`;
  $('meterfill').style.height = Math.max(0, Math.min(100, y / TOP_Y * 100)) + '%';
  const md = $('meterdots');
  md.querySelectorAll('i.pl').forEach((e) => e.remove());
  const add = (yy, col, cls) => { const d = document.createElement('i'); d.className = cls; d.style.bottom = Math.max(0, Math.min(100, yy / TOP_Y * 100)) + '%'; d.style.background = col; md.appendChild(d); };
  remotes.forEach((r) => add(r.tgt.y, hexCss(PALETTE[r.col]), 'pl'));
  add(y, hexCss(PALETTE[me.col]), 'pl me');
  if (net.connected) {
    let h = `<div><i style="background:${hexCss(PALETTE[me.col])}"></i>${me.name} <span style="opacity:.6">(you)</span></div>`;
    remotes.forEach((r) => { h += `<div><i style="background:${hexCss(PALETTE[r.col])}"></i>${r.name.replace(/</g, '')} <span style="opacity:.6">${Math.round(r.tgt.y)} m</span></div>`; });
    $('players').innerHTML = h;
    $('net').textContent = `${net.rtt} ms · ${remotes.size + 1} climbing`;
  } else { $('players').innerHTML = ''; $('net').textContent = 'solo'; }
}

// ------------------------------------------------------------ main loop
let last = performance.now(), acc = 0, hudT = 0, lampT = 0, sendT = 0, tAbs = 0, fallVis = 0;
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), tmpV = new THREE.Vector3();
const STEP = 1 / 120;

function tick(dt) {
  if (!(S.running && !S.chat)) return;
  inp.mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  inp.mz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  inp.sprint = !!(keys.ShiftLeft || keys.ShiftRight); inp.jumpHeld = !!keys.Space;
  acc += dt;
  let first = true;
  while (acc >= STEP) {
    world.update(net.connected ? net.serverTime() : Date.now() / 1000);
    inp.jumpPressed = first && jumpEdge; if (first) jumpEdge = false; first = false;
    player.step(STEP, inp, cam.yaw);
    acc -= STEP;
  }
  handleEvents();
  gameLogic(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1;
  tAbs += dt; S.respawnCD -= dt;
  const p = player.pos;

  tick(dt);
  world.flicker(tAbs);

  // ---- camera
  cam.dist += (cam.tdist - cam.dist) * Math.min(1, dt * 6);
  camTarget.set(p.x, p.y + 1.45, p.z);
  const cp = Math.cos(cam.pitch), spn = Math.sin(cam.pitch);
  tmpV.set(Math.sin(cam.yaw) * cp, spn, Math.cos(cam.yaw) * cp);
  let d = cam.dist;
  for (let s = 0.6; s < cam.dist; s += 0.6) { if (world.solidAt(camTarget.x + tmpV.x * s, camTarget.y + tmpV.y * s, camTarget.z + tmpV.z * s)) { d = Math.max(1.2, s - 0.6); break; } }
  camPos.copy(camTarget).addScaledVector(tmpV, d);
  if (camPos.y < camTarget.y - 3 && p.y < 1) camPos.y = Math.max(camPos.y, 0.4);
  camera.position.copy(camPos); camera.lookAt(camTarget);
  const spd = Math.hypot(player.vel.x, player.vel.z), fall = Math.max(0, -player.vel.y);
  const fov = 65 + Math.min(14, spd * 0.9) + Math.min(14, fall * 0.4);
  if (Math.abs(fov - camera.fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix(); }

  // ---- avatar
  if (avatar) {
    avatar.root.position.copy(p); avatar.root.rotation.y = player.yaw; avatar.animate(dt, player.anim, player.speed);
    avatar.root.visible = d > 1.6;
  }
  remotes.forEach((r) => {
    const k = 1 - Math.exp(-dt * 12);
    r.pos.lerp(r.tgt, k);
    let dy = r.tyaw - r.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.yaw += dy * k;
    r.av.root.position.copy(r.pos); r.av.root.rotation.y = r.yaw; r.av.animate(dt, r.anim, r.speed);
  });

  // ---- atmosphere
  const A = sky.update(camera.position.y, camera.position, tAbs, renderer.domElement.height, camera.fov);
  scene.fog.color.copy(A.hor).lerp(A.top, 0.12); scene.fog.density = A.fog;
  hemi.color.copy(A.hemiSky); hemi.groundColor.copy(A.hemiGnd); hemi.intensity = A.hemi * 1.7;
  sun.color.copy(A.sunCol); sun.intensity = A.sunInt * 1.25;
  sun.position.set(p.x + A.sunDir.x * 140, p.y + A.sunDir.y * 140, p.z + A.sunDir.z * 140); sun.target.position.copy(p);
  bloom.strength = A.bloom * 0.9 + 0.1;
  grade.uniforms.uFall.value += (Math.min(1, fall / 45) - grade.uniforms.uFall.value) * Math.min(1, dt * 4);
  S.level = levelAt(p.y);
  for (const g of world.levels) g.visible = Math.abs(g.userData.level - S.level) <= 2;

  lampT -= dt;
  if (lampT <= 0) { lampT = 0.15; updateLamps(); }
  for (const l of pool) { l.intensity += (l.userData.tint - l.intensity) * Math.min(1, dt * 6); }

  audio.update(dt, p.y, player.vel.y, S.level);

  hudT -= dt; if (hudT <= 0 && S.running) { hudT = 0.1; updateHud(p.y); }
  if (net.connected && S.running) { sendT -= dt; if (sendT <= 0) { sendT = 1 / 15; net.send({ t: 's', p: [p.x, p.y, p.z], r: player.yaw, a: player.anim, v: player.speed, l: S.level }); } }

  composer.render();
}

function updateLamps() {
  const p = camera.position, L = world.lamps, best = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i], dy = Math.abs(l.y - p.y); if (dy > 30) continue;
    const d2 = (l.x - p.x) ** 2 + dy * dy + (l.z - p.z) ** 2; if (d2 > 3600) continue;
    best.push([d2, l]);
  }
  best.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < pool.length; i++) {
    const l = pool[i], b = best[i];
    if (b) { const t = b[1]; l.position.set(t.x, t.y, t.z); l.color.set(t.col); l.distance = t.dist; l.userData.tint = t.int * 3.2; if (l.intensity < 0.05) l.intensity = 0.05; }
    else l.userData.tint = 0;
  }
}

function handleEvents() {
  for (const e of player.events) {
    if (e === 'jump') audio.jump(); else if (e === 'pad') audio.pad();
    else if (e.startsWith('land:')) audio.land(+e.slice(5));
  }
  player.events.length = 0;
  if (player.onGround && player.speed > 2) audio.footstep(inp.sprint);
}

function gameLogic(dt) {
  const p = player.pos;
  if (p.y > S.best) { S.best = p.y; store.set('best', Math.round(S.best)); }
  // checkpoints
  for (let i = 0; i < world.checkpoints.length; i++) {
    const c = world.checkpoints[i];
    if (i === S.cp) continue;
    if (Math.abs(p.y - c.y) > 3.5) continue;
    if (Math.hypot(p.x - c.x, p.z - c.z) < c.r) {
      world.activateCheckpoint(world.checkpoints[S.cp], false);
      S.cp = i; world.activateCheckpoint(c, true); store.set('cp', i); audio.checkpoint();
      toast(c.idx === 0 ? `${THEMES[c.lvl].name} — checkpoint` : 'Checkpoint');
      if (c.idx === 0 && net.connected) net.send({ t: 'cp', l: c.lvl });
      break;
    }
  }
  if (p.y < -48) { toast('You fell into the clouds…'); respawn(); }
  if (world.summit && !S.summit) {
    const s = world.summit;
    if (Math.hypot(p.x - s.x, p.z - s.z) < s.r && Math.abs(p.y - s.y) < 3) {
      S.summit = true; banner('Summit', 'You reached the top'); audio.checkpoint(); setTimeout(() => audio.checkpoint(), 500);
      if (net.connected) net.send({ t: 'summit', l: 7 });
    }
  }
  if (S.level !== S.lastLevel) {
    if (S.lastLevel !== undefined && S.running) banner(THEMES[S.level].name, THEMES[S.level].sub);
    S.lastLevel = S.level;
  }
}

window.__game = { tick, keys, inp, world, player, camera, S, cam, scene, sky, renderer, respawn };
boot().catch((e) => { console.error(e); $('ldtxt').textContent = 'Failed to build: ' + e.message; });
