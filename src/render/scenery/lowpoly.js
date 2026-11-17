import * as THREE from 'three';

// ---------------------------------------------------------------- geometry merging
/**
 * Merge parts into one non-indexed BufferGeometry with a per-vertex colour attribute.
 * parts: [{ geo, color, matrix? }]. Lets a whole tree (trunk + branches + crown lobes)
 * be one instanced draw call.
 */
export function mergeParts(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const { geo, color, matrix } of parts) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(color);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]);
      // a touch of per-vertex variation breaks up flat colours
      const v = 0.92 + ((Math.sin(p[i] * 12.9 + p[i + 1] * 78.2 + p[i + 2] * 37.7) * 43758.5) % 1 + 1) % 1 * 0.16;
      col.push(c.r * v, c.g * v, c.b * v);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// a cylinder from a to b (for trunks and branches)
function limb(a, b, r0, r1, seg = 5) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true); // open-ended: caps are never seen
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// ---------------------------------------------------------------- trees
// Deterministic pseudo-random for shape variation
function prng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** Broadleaf (oak / beech / ash): stout trunk, a few limbs, a crown of clustered lobes. */
export function broadleafTree(seed, { h = 12, crown = 5, bark = 0x4e3b2c, leaf = 0x4c7a34 } = {}) {
  const r = prng(seed), parts = [];
  const top = new THREE.Vector3(0, h * 0.55, 0);
  parts.push({ geo: limb(new THREE.Vector3(0, -0.5, 0), top, 0.42, 0.28, 5), color: bark });
  for (let i = 0; i < 3; i++) { // main limbs into the crown
    const a = (i / 3) * Math.PI * 2 + r(), end = new THREE.Vector3(Math.cos(a) * crown * 0.55, h * (0.68 + r() * 0.12), Math.sin(a) * crown * 0.55);
    parts.push({ geo: limb(top, end, 0.2, 0.08, 4), color: bark });
  }
  const lobes = 5 + Math.floor(r() * 2);
  for (let i = 0; i < lobes; i++) {
    const a = r() * Math.PI * 2, d = r() * crown * 0.6, y = h * 0.62 + r() * h * 0.32;
    const s = crown * (0.42 + r() * 0.3);
    const g = new THREE.IcosahedronGeometry(1, 0);
    const shade = new THREE.Color(leaf).offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.1, (r() - 0.5) * 0.08);
    parts.push({ geo: g, color: shade, matrix: M4(Math.cos(a) * d, y, Math.sin(a) * d, r() * 3, r() * 3, 0, s, s * (0.75 + r() * 0.25), s) });
  }
  return mergeParts(parts);
}

/** Silver birch: slim white trunk, narrow airy crown. */
export function birchTree(seed, { h = 11 } = {}) {
  const r = prng(seed), parts = [];
  parts.push({ geo: limb(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(r() - 0.5, h * 0.85, r() - 0.5), 0.2, 0.08, 5), color: 0xe6e2da });
  for (let i = 0; i < 5; i++) {
    const s = 1.4 + r() * 1.2, a = r() * 6.28, d = r() * 1.3;
    parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), color: new THREE.Color(0x7aa44a).offsetHSL(0, 0, (r() - 0.5) * 0.08), matrix: M4(Math.cos(a) * d, h * (0.45 + i * 0.11), Math.sin(a) * d, r() * 3, r() * 3, 0, s, s * 1.3, s) });
  }
  return mergeParts(parts);
}

/** Bare (early spring) tree: trunk and two levels of branching, a few buds of leaf. */
export function bareTree(seed, { h = 12, bark = 0x5a4a3c } = {}) {
  const r = prng(seed), parts = [];
  const base = new THREE.Vector3(0, -0.5, 0), fork = new THREE.Vector3((r() - 0.5) * 0.6, h * 0.42, (r() - 0.5) * 0.6);
  parts.push({ geo: limb(base, fork, 0.38, 0.24, 5), color: bark });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + r() * 0.8, el = 0.7 + r() * 0.5, len = h * (0.35 + r() * 0.2);
    const end = new THREE.Vector3(fork.x + Math.cos(a) * Math.cos(el) * len, fork.y + Math.sin(el) * len, fork.z + Math.sin(a) * Math.cos(el) * len);
    parts.push({ geo: limb(fork, end, 0.18, 0.07, 4), color: bark });
    for (let k = 0; k < 1; k++) {
      const b = a + (r() - 0.5) * 1.6, l2 = len * 0.45, e2 = el + (r() - 0.3) * 0.6;
      const tip = new THREE.Vector3(end.x + Math.cos(b) * Math.cos(e2) * l2, end.y + Math.sin(e2) * l2, end.z + Math.sin(b) * Math.cos(e2) * l2);
      parts.push({ geo: limb(end, tip, 0.07, 0.025, 3), color: bark });
      if (r() < 0.7) parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), color: 0x8fb05a, matrix: M4(tip.x, tip.y, tip.z, r() * 3, r() * 3, 0, 1.1, 0.9, 1.1) });
    }
  }
  return mergeParts(parts);
}

/** Scots pine / conifer for variety at the woodland edges. */
export function pineTree(seed, { h = 15 } = {}) {
  const r = prng(seed), parts = [];
  parts.push({ geo: limb(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, h * 0.8, 0), 0.32, 0.16, 5), color: 0x6b4a33 });
  for (let i = 0; i < 3; i++) parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), color: 0x2f5530, matrix: M4((r() - 0.5) * 2, h * (0.72 + i * 0.1), (r() - 0.5) * 2, r() * 3, r() * 3, 0, 2.6 - i * 0.4, 1.4, 2.6 - i * 0.4) });
  return mergeParts(parts);
}

// ---------------------------------------------------------------- façade & detail textures
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  return t;
}

/** Pit garages: roller doors with numbers below, glazed upper floor, red fascia band. One tile = one garage bay. */
export function garageFacade(n = 1) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#d8d6d0'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#c62828'; g.fillRect(0, 0, 256, 22);                         // red fascia
    g.fillStyle = '#25384c'; g.fillRect(8, 30, 240, 82);                         // upper glazing
    g.fillStyle = '#e8e8e8'; for (let x = 8; x <= 248; x += 40) g.fillRect(x - 2, 30, 4, 82); g.fillRect(8, 68, 240, 3);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(12, 34, 70, 30);           // sky reflection
    g.fillStyle = '#8a8d91'; g.fillRect(0, 118, 256, 6);
    g.fillStyle = '#5d6166'; g.fillRect(28, 140, 200, 116);                      // roller door
    g.fillStyle = '#4c5055'; for (let y = 144; y < 256; y += 7) g.fillRect(28, y, 200, 2);
    g.fillStyle = '#f2f2f2'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.fillText(String(n), 128, 136);
  }, [n, 1]);
}

/** Office / hospitality building: horizontal glass bands with mullions on white render. */
export function officeFacade(floors = 3, bays = 10, { wall = '#f1f1ee', glass = '#2c4357', band = null } = {}) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = wall; g.fillRect(0, 0, 256, 256);
    const fh = 256 / floors;
    for (let f = 0; f < floors; f++) {
      const y = f * fh;
      g.fillStyle = glass; g.fillRect(0, y + fh * 0.22, 256, fh * 0.56);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, y + fh * 0.22, 256, fh * 0.12);
      g.fillStyle = wall; for (let x = 0; x < 256; x += 32) g.fillRect(x, y + fh * 0.22, 3, fh * 0.56);
    }
    if (band) { g.fillStyle = band; g.fillRect(0, 0, 256, 10); }
  }, [bays / 8, 1]);
}

/** Grandstand seating: rows of coloured seats with dark gaps (one tile = one row height across). */
export function seatTexture(color = '#c2185b') {
  return canvasTex(128, 32, (g) => {
    g.fillStyle = '#3d4044'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = color; for (let x = 2; x < 128; x += 8) g.fillRect(x, 6, 6, 20);
    g.fillStyle = 'rgba(255,255,255,0.18)'; for (let x = 2; x < 128; x += 8) g.fillRect(x, 6, 6, 4);
  }, [8, 1]);
}

/** Black advertising board / banner with white lettering. */
export function bannerTexture(text, { bg = '#111', fg = '#fff', w = 512, h = 96 } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${Math.round(h * 0.5)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

/** Debris/catch fence: wire mesh (mostly transparent). */
export function meshFenceTexture() {
  return canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(200,205,210,0.75)'; g.lineWidth = 1.2;
    for (let i = -64; i < 128; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); }
  }, [1, 1]);
}

/** Distant stand-in: trunk + two crown lobes (~45 triangles), same overall size/colour. */
export function farTree(seed, { h = 12, crown = 5, leaf = 0x4c7a34, bark = 0x4e3b2c, bare = false } = {}) {
  const r = prng(seed), parts = [{ geo: limb(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, h * 0.6, 0), 0.4, 0.25, 4), color: bark }];
  const c = bare ? 0x6f6450 : leaf;
  parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), color: c, matrix: M4(0, h * 0.72, 0, r(), r(), 0, crown * 0.85, crown * 0.6, crown * 0.85) });
  parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), color: c, matrix: M4(crown * 0.3, h * 0.9, -crown * 0.2, r(), r(), 0, crown * 0.6, crown * 0.5, crown * 0.6) });
  return mergeParts(parts);
}
