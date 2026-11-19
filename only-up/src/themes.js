// Theme definitions (atmosphere per altitude band) + material registry
import * as THREE from 'three';
import { buildTextures } from './textures.js';

export const LEVEL_H = 120;
export const EDEN_H = 80;
const C = (h) => new THREE.Color(h);

// atmosphere: top/hor sky colours, sun, fog, light, particles, audio root
export const THEMES = [
  { id: 'nature', name: 'Verdant Reach', sub: 'Nature is beautiful',
    top: C(0x2a74d4), hor: C(0xffe0b0), sunEl: 20, sunAz: 40, sunCol: C(0xfff0c8), sunInt: 3.2, sunSize: 0.045, stars: 0,
    cloud: C(0xffffff), cloudAmt: 0.6, fog: 0.0011, hemiSky: C(0xbfe0ff), hemiGnd: C(0x4a6b3a), hemi: 0.9,
    aurora: 0, nebula: 0, planet: 0, bloom: 0.35,
    part: { col: C(0xfff2c0), vel: [0.4, -0.15, 0.2], size: 2.4, op: 0.8, sway: 1.5 }, root: 261.6, scale: [0, 2, 4, 7, 9] },
  { id: 'industrial', name: 'The Foundry', sub: 'Steel, steam and sweat',
    top: C(0x66798f), hor: C(0xf0b57c), sunEl: 26, sunAz: 100, sunCol: C(0xffc389), sunInt: 2.6, sunSize: 0.05, stars: 0,
    cloud: C(0xb9a898), cloudAmt: 0.75, fog: 0.0019, hemiSky: C(0xc7b8a8), hemiGnd: C(0x3a3631), hemi: 0.8,
    aurora: 0, nebula: 0, planet: 0, bloom: 0.5,
    part: { col: C(0xe0c8a8), vel: [0.6, 0.5, 0.2], size: 2.8, op: 0.5, sway: 1.0 }, root: 196, scale: [0, 3, 5, 7, 10] },
  { id: 'war', name: 'No Man\'s Ladder', sub: 'The long night of the front',
    top: C(0x30343f), hor: C(0xd0603c), sunEl: 5, sunAz: 160, sunCol: C(0xff6a38), sunInt: 2.4, sunSize: 0.06, stars: 0.1,
    cloud: C(0x5d4a48), cloudAmt: 0.9, fog: 0.0021, hemiSky: C(0x8a6a66), hemiGnd: C(0x2a2a22), hemi: 0.7,
    aurora: 0, nebula: 0, planet: 0, bloom: 0.55,
    part: { col: C(0xff9a50), vel: [0.5, 0.8, 0.3], size: 1.8, op: 0.9, sway: 2.2 }, root: 164.8, scale: [0, 2, 3, 7, 8] },
  { id: 'apoc', name: 'Ashfall', sub: 'What the world left behind',
    top: C(0x6a4a3a), hor: C(0xe6a05a), sunEl: 11, sunAz: 220, sunCol: C(0xffa14e), sunInt: 2.8, sunSize: 0.085, stars: 0,
    cloud: C(0x8c6a50), cloudAmt: 0.8, fog: 0.0024, hemiSky: C(0xc89a70), hemiGnd: C(0x3b2c22), hemi: 0.8,
    aurora: 0, nebula: 0, planet: 0, bloom: 0.5,
    part: { col: C(0xd8c0a0), vel: [1.6, -0.35, 0.7], size: 2.2, op: 0.85, sway: 2.5 }, root: 146.8, scale: [0, 1, 3, 5, 8] },
  { id: 'victorian', name: 'Brass & Neon', sub: 'Gaslight under a cyber moon',
    top: C(0x0a0630), hor: C(0xb73a9a), sunEl: 34, sunAz: 280, sunCol: C(0xcfe8ff), sunInt: 2.2, sunSize: 0.09, stars: 0.7,
    cloud: C(0x56307a), cloudAmt: 0.65, fog: 0.0016, hemiSky: C(0x7a5aa8), hemiGnd: C(0x2a1a3a), hemi: 0.75,
    aurora: 0, nebula: 0.15, planet: 0, bloom: 0.8,
    part: { col: C(0x9ad8ff), vel: [0.4, -9.0, 0.15], size: 1.1, op: 0.55, sway: 0.2 }, root: 220, scale: [0, 2, 3, 7, 8] },
  { id: 'frozen', name: 'Frostworks', sub: 'Machines asleep in ice',
    top: C(0x1a3a6c), hor: C(0xbce6ff), sunEl: 7, sunAz: 330, sunCol: C(0xe4f6ff), sunInt: 2.6, sunSize: 0.04, stars: 0.5,
    cloud: C(0xdfeeff), cloudAmt: 0.55, fog: 0.0025, hemiSky: C(0xcfe6ff), hemiGnd: C(0x5a6f86), hemi: 1.0,
    aurora: 1, nebula: 0, planet: 0, bloom: 0.55,
    part: { col: C(0xffffff), vel: [1.2, -1.3, 0.5], size: 2.2, op: 0.95, sway: 1.4 }, root: 233, scale: [0, 2, 4, 7, 11] },
  { id: 'alien', name: 'Xenith', sub: 'Beyond the sky',
    top: C(0x06021c), hor: C(0x6a2fb8), sunEl: 45, sunAz: 20, sunCol: C(0xa8ffe0), sunInt: 1.6, sunSize: 0.025, stars: 1,
    cloud: C(0x6a3fb0), cloudAmt: 0.25, fog: 0.0011, hemiSky: C(0x8a6adf), hemiGnd: C(0x1a0f3a), hemi: 0.8,
    aurora: 0.2, nebula: 1, planet: 1, bloom: 1.0,
    part: { col: C(0x80ffd8), vel: [0.1, 0.55, 0.1], size: 2.6, op: 0.9, sway: 3.0 }, root: 130.8, scale: [0, 2, 5, 7, 10] },
  { id: 'eden', name: 'The Garden Above', sub: 'You made it',
    top: C(0x2262c4), hor: C(0xffeab8), sunEl: 38, sunAz: 60, sunCol: C(0xfff0c0), sunInt: 3.6, sunSize: 0.06, stars: 0.15,
    cloud: C(0xffffff), cloudAmt: 0.4, fog: 0.0008, hemiSky: C(0xd0e8ff), hemiGnd: C(0x6a8a4a), hemi: 1.0,
    aurora: 0, nebula: 0, planet: 0, bloom: 0.45,
    part: { col: C(0xffd0e0), vel: [0.5, -0.4, 0.3], size: 3.0, op: 0.9, sway: 2.0 }, root: 293.7, scale: [0, 2, 4, 7, 9] },
];
export const levelY0 = (i) => i * LEVEL_H;
export const levelY1 = (i) => (i === 7 ? 7 * LEVEL_H + EDEN_H : (i + 1) * LEVEL_H);
export const TOP_Y = levelY1(7);

export function levelAt(y) {
  for (let i = 7; i >= 0; i--) if (y >= levelY0(i) - 2) return i;
  return 0;
}

// smooth blend between themes by altitude
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function blendInfo(y) {
  const f = y / LEVEL_H;
  let i = Math.floor(f); if (i < 0) i = 0; if (i > 7) i = 7;
  const bY = (i + 1) * LEVEL_H;
  const t = i >= 7 ? 0 : smooth(bY - 28, bY + 28, y);
  return { a: THEMES[i], b: THEMES[Math.min(7, i + 1)], t };
}

// ---------------- materials ----------------
export function makeMaterials() {
  const T = buildTextures();
  const cache = new Map();
  const M = { T };
  const std = (key, tk, o = {}) => {
    const t = T[tk];
    const m = new THREE.MeshStandardMaterial({
      map: t.map, bumpMap: t.bump, bumpScale: o.bump ?? 1.5, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0,
      vertexColors: true, color: o.color ?? 0xffffff, side: o.side ?? THREE.FrontSide,
      emissiveMap: t.emissive || null, emissive: t.emissive ? new THREE.Color(o.em ?? 1, o.em ?? 1, o.em ?? 1) : 0x000000,
    });
    m.userData.tile = o.tile ?? 4;
    M[key] = m; return m;
  };
  std('grass', 'grass', { tile: 4, rough: 0.95 });
  std('rock', 'rock', { tile: 6, rough: 0.95, bump: 3 });
  std('moss', 'moss', { tile: 6, rough: 0.95, bump: 3 });
  std('wood', 'wood', { tile: 3, rough: 0.8 });
  std('steel', 'steel', { tile: 3, rough: 0.45, metal: 0.8 });
  std('rust', 'rust', { tile: 4, rough: 0.8, metal: 0.45, bump: 2.5 });
  std('grating', 'grating', { tile: 2, rough: 0.5, metal: 0.8, bump: 3 });
  std('hazard', 'hazard', { tile: 2, rough: 0.7, metal: 0.2 });
  std('concrete', 'concrete', { tile: 5, rough: 0.95, bump: 3 });
  std('olive', 'olive', { tile: 3, rough: 0.7, metal: 0.4 });
  std('sandbag', 'sandbag', { tile: 2, rough: 1, bump: 4 });
  std('brick', 'brick', { tile: 3.5, rough: 0.9, bump: 3 });
  std('brass', 'brass', { tile: 3, rough: 0.35, metal: 0.9 });
  std('ice', 'ice', { tile: 5, rough: 0.12, metal: 0.1, bump: 1.5 });
  std('snow', 'snow', { tile: 4, rough: 0.9, bump: 2 });
  std('frost', 'frost', { tile: 3, rough: 0.5, metal: 0.6 });
  std('obsidian', 'obsidian', { tile: 4, rough: 0.2, metal: 0.6, em: 0.8 });
  std('marble', 'marble', { tile: 4, rough: 0.3, metal: 0.05 });
  std('leaf', 'leaf', { tile: 2, rough: 0.9, side: THREE.DoubleSide });
  std('cherry', 'cherry', { tile: 2, rough: 0.9, side: THREE.DoubleSide });
  std('bark', 'bark', { tile: 2, rough: 1 });
  std('windows', 'windows', { tile: 24, rough: 0.8, em: 2.5 });
  // plain coloured materials
  M.flat = (hex, rough = 0.7, metal = 0.1) => {
    const k = `f${hex}_${rough}_${metal}`;
    if (!cache.has(k)) { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, vertexColors: true }); m.userData.tile = 4; cache.set(k, m); }
    return cache.get(k);
  };
  // HDR emissive (unlit) — bloom picks these up
  M.glow = (hex, k = 3) => {
    const key = `g${hex}_${k}`;
    if (!cache.has(key)) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), vertexColors: true, toneMapped: true });
      m.userData.tile = 4; cache.set(key, m);
    }
    return cache.get(key);
  };
  M.clock = new THREE.MeshBasicMaterial({ map: T.clock.map, color: new THREE.Color(1.6, 1.5, 1.2) });
  M.flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a20).multiplyScalar(3.5), vertexColors: true });
  M.flame.userData.tile = 4;
  return M;
}
