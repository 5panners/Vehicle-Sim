// Shared helpers for the procedural car generators (no dependencies).
// Mesh: triangle soup with per-face orientation hints -> smooth-shaded, per-material
// indexed primitives; writeGLB packs nodes into a binary glTF.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------- vector helpers
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const rad = (d) => d * Math.PI / 180;
// "design" coords (x left, y rearward, z up) -> game coords; a pure rotation
export const B = (p) => [p[0], p[2], -p[1]];
export const rotX = (p, d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
export const rotY = (p, d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };

// ---------------------------------------------------------------- mesh builder
// Orientation hint `o`: { away: point } | { toward: point } | { dir: vector } | (centre) => hint
export class Mesh {
  tris = [];
  tri(a, b, c, m, o) {
    const n = cross(sub(b, a), sub(c, a));
    if (len(n) < 1e-9) return;
    if (o) {
      const ctr = mul(add(add(a, b), c), 1 / 3);
      if (typeof o === 'function') o = o(ctr);
      const d = o.dir ?? (o.away ? sub(ctr, o.away) : sub(o.toward, ctr));
      if (dot(n, d) < 0) [b, c] = [c, b];
    }
    this.tris.push({ p: [a, b, c], m });
  }
  quad(a, b, c, d, m, o) { this.tri(a, b, c, m, o); this.tri(a, c, d, m, o); }
  box(c, s, m, rot = (p) => p) {
    const v = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push(add(c, rot([x * s[0] / 2, y * s[1] / 2, z * s[2] / 2])));
    for (const f of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], m, { away: c });
  }
  tube(pts, r, m, sides = 6) {
    const rings = pts.map((p, i) => {
      const t = unit(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
      const u = unit(cross(t, Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(t, u);
      return Array.from({ length: sides }, (_, k) => { const a = 2 * Math.PI * k / sides; return add(p, add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a)))); });
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = mul(add(pts[i], pts[i + 1]), 0.5);
      for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; this.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k], m, { away: mid }); }
    }
  }
  // profile [(axial x, radius)] revolved about the X axis
  revolveX(prof, segs, m, o) {
    const P = (q, a) => [q[0], q[1] * Math.cos(a), q[1] * Math.sin(a)];
    for (let s = 0; s < segs; s++) {
      const a0 = 2 * Math.PI * s / segs, a1 = 2 * Math.PI * (s + 1) / segs;
      for (let i = 0; i < prof.length - 1; i++) this.quad(P(prof[i], a0), P(prof[i + 1], a0), P(prof[i + 1], a1), P(prof[i], a1), m, o);
    }
  }
  // convex 2D outline extruded between lo and hi; to3(w, p2) places it in 3D
  polyPrism(out, to3, lo, hi, m) {
    const c2 = [out.reduce((a, p) => a + p[0], 0) / out.length, out.reduce((a, p) => a + p[1], 0) / out.length];
    const o = { away: to3((lo + hi) / 2, c2) };
    out.forEach((p, i) => {
      const q = out[(i + 1) % out.length];
      this.tri(to3(lo, c2), to3(lo, p), to3(lo, q), m, o); this.tri(to3(hi, c2), to3(hi, p), to3(hi, q), m, o);
      this.quad(to3(lo, p), to3(lo, q), to3(hi, q), to3(hi, p), m, o);
    });
  }
  // strip between two 2D polylines A and B (same length), extruded between lo and hi
  stripPrism(A, Bl, to3, lo, hi, m) {
    const axis = sub(to3(1, [0, 0]), to3(0, [0, 0])), d3 = (d) => sub(to3(0, d), to3(0, [0, 0]));
    for (let i = 0; i < A.length - 1; i++) {
      const out = d3([A[i][0] - Bl[i][0] + A[i + 1][0] - Bl[i + 1][0], A[i][1] - Bl[i][1] + A[i + 1][1] - Bl[i + 1][1]]);
      this.quad(to3(lo, A[i]), to3(lo, A[i + 1]), to3(lo, Bl[i + 1]), to3(lo, Bl[i]), m, { dir: mul(axis, lo < hi ? -1 : 1) });
      this.quad(to3(hi, A[i]), to3(hi, A[i + 1]), to3(hi, Bl[i + 1]), to3(hi, Bl[i]), m, { dir: mul(axis, lo < hi ? 1 : -1) });
      this.quad(to3(lo, A[i]), to3(lo, A[i + 1]), to3(hi, A[i + 1]), to3(hi, A[i]), m, { dir: out });
      this.quad(to3(lo, Bl[i]), to3(lo, Bl[i + 1]), to3(hi, Bl[i + 1]), to3(hi, Bl[i]), m, { dir: mul(out, -1) });
    }
    const n = A.length - 1;
    this.quad(to3(lo, A[0]), to3(lo, Bl[0]), to3(hi, Bl[0]), to3(hi, A[0]), m, { dir: d3([A[0][0] - A[1][0], A[0][1] - A[1][1]]) });
    this.quad(to3(lo, A[n]), to3(lo, Bl[n]), to3(hi, Bl[n]), to3(hi, A[n]), m, { dir: d3([A[n][0] - A[n - 1][0], A[n][1] - A[n - 1][1]]) });
  }
  ellipsoid(c, r, m, segs = 10, rings = 6) {
    const P = (i, k) => { const th = Math.PI * i / rings, ph = 2 * Math.PI * k / segs; return add(c, [r[0] * Math.sin(th) * Math.cos(ph), r[1] * Math.sin(th) * Math.sin(ph), r[2] * Math.cos(th)]); };
    for (let i = 0; i < rings; i++) for (let k = 0; k < segs; k++) this.quad(P(i, k), P(i, k + 1), P(i + 1, k + 1), P(i + 1, k), m, { away: c });
  }
  addFrom(other, fn = (p) => p) { for (const t of other.tris) this.tris.push({ p: t.p.map(fn), m: t.m }); return this; }
  mirroredX() { const o = new Mesh(); for (const t of this.tris) { const [a, b, c] = t.p.map((p) => [-p[0], p[1], p[2]]); o.tris.push({ p: [a, c, b], m: t.m }); } return o; }
  // smooth normals within a crease angle -> per-material indexed primitives
  build(creaseDeg) {
    const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    const cosT = Math.cos(rad(creaseDeg)), at = new Map();
    const fn = this.tris.map((t) => cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]))), fu = fn.map(unit);
    this.tris.forEach((t, i) => t.p.forEach((p) => { const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push(i); }));
    const prims = new Map();
    this.tris.forEach((t, i) => {
      if (!prims.has(t.m)) prims.set(t.m, { pos: [], nrm: [], idx: [], lut: new Map() });
      const pr = prims.get(t.m);
      for (const p of t.p) {
        let n = [0, 0, 0];
        for (const j of at.get(key(p))) if (dot(fu[i], fu[j]) >= cosT) n = add(n, fn[j]);
        n = unit(n);
        const vk = key(p) + '|' + key(n);
        if (!pr.lut.has(vk)) { pr.lut.set(vk, pr.pos.length / 3); pr.pos.push(...p); pr.nrm.push(...n); }
        pr.idx.push(pr.lut.get(vk));
      }
    });
    return prims;
  }
}

// monotone cubic (Fritsch-Carlson): smooth through the stations, no overshoot
export function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) if (d[i - 1] * d[i] > 0) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  return (x) => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
// ---------------------------------------------------------------- GLB writer
export function writeGLB(path, nodes, MATS) {
  const matIds = Object.keys(MATS), chunks = [], gltf = {
    asset: { version: '2.0', generator: 'vehicle-sim build-gt3rs.mjs' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes: [], meshes: [],
    materials: matIds.map((k) => { const d = MATS[k]; return { name: d.name, pbrMetallicRoughness: { baseColorFactor: [...d.c, d.a ?? 1], metallicFactor: d.mt ?? 0, roughnessFactor: d.r }, ...(d.a ? { alphaMode: 'BLEND' } : {}), ...(d.e ? { emissiveFactor: d.e } : {}), ...(d.ds ? { doubleSided: true } : {}) }; }),
    accessors: [], bufferViews: [], buffers: [],
  };
  let offset = 0;
  const push = (arr, target, type, compType, minmax) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - (buf.length % 4)) % 4;
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    chunks.push(buf, Buffer.alloc(pad)); offset += buf.length + pad;
    const acc = { bufferView: gltf.bufferViews.length - 1, componentType: compType, count: arr.length / (type === 'VEC3' ? 3 : 1), type };
    if (minmax) { acc.min = [Infinity, Infinity, Infinity]; acc.max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i++) { acc.min[i % 3] = Math.min(acc.min[i % 3], arr[i]); acc.max[i % 3] = Math.max(acc.max[i % 3], arr[i]); } }
    gltf.accessors.push(acc); return gltf.accessors.length - 1;
  };
  let total = 0;
  for (const n of nodes) {
    const primitives = [];
    for (const [mat, p] of n.prims) {
      total += p.idx.length / 3;
      const big = p.pos.length / 3 > 65535;
      primitives.push({ attributes: { POSITION: push(new Float32Array(p.pos), 34962, 'VEC3', 5126, true), NORMAL: push(new Float32Array(p.nrm), 34962, 'VEC3', 5126) },
        indices: push(big ? new Uint32Array(p.idx) : new Uint16Array(p.idx), 34963, 'SCALAR', big ? 5125 : 5123), material: matIds.indexOf(mat) });
    }
    gltf.meshes.push({ name: n.name, primitives });
    gltf.nodes.push({ name: n.name, mesh: gltf.meshes.length - 1, ...(n.at ? { translation: n.at } : {}) });
  }
  const bin = Buffer.concat(chunks); gltf.buffers.push({ byteLength: bin.length });
  let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + json.length + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([head, jh, json, bh, bin]));
  return total;
}

export function mergePrims(list) {
  const out = new Map();
  for (const prims of list) for (const [mat, p] of prims) {
    if (!out.has(mat)) out.set(mat, { pos: [], nrm: [], idx: [] });
    const o = out.get(mat), base = o.pos.length / 3;
    o.pos.push(...p.pos); o.nrm.push(...p.nrm); for (const i of p.idx) o.idx.push(base + i);
  }
  return out;
}
