import * as THREE from 'three';
import { rng, fbm } from '../../world/noise.js';
import { SURF } from '../../world/Surfaces.js';
import { decodeMask, MASK } from '../../world/maps/monaco-mask.js';
import { LENGTH } from '../../world/maps/monaco-track.js';
import { mergeParts, garageFacade, seatTexture, bannerTexture } from './lowpoly.js';

/**
 * Monaco surroundings (low-poly):
 *  - the Mediterranean, the harbour with moored yachts, and distant mountains behind the town
 *  - the hillside town: pastel apartment blocks with windows, oriented along the streets and the coast
 *  - Beaux-Arts landmarks on the map's building footprints (Casino de Monte-Carlo with its towers and domes)
 *  - the tunnel under the hotel, the pit garages on the start straight, scaffold grandstands
 *  - palms and gardens, street lamps, advertising boards
 * Everything is placed by lap distance + lateral offset (+ = right of travel), or by world position
 * from the map's land-use grid (water, parks, building footprints).
 */
export function buildMonacoScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = LENGTH;
  const rand = rng(1929);                                  // the first Monaco Grand Prix
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => {
    const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat;
    return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t };
  };
  const hwAt = (d) => T[idx(d)].w / 2;
  const wrapD = (d) => ((d % L) + L) % L;
  const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);
  const group = new THREE.Group(); scene.add(group);
  const sea = map.seaLevel ?? 0;
  const GRID = decodeMask(), MN = MASK.n, MRES = MASK.res, MHALF = MASK.size / 2;
  const cls = (x, z) => map.landUse(x, z);
  /** exact distance to the nearest track sample where the 1 m grid knows it, else the coarse estimate */
  const dTrack = (x, z) => {
    const n = world.n, i = Math.round((x + world.half) / world.res), j = Math.round((z + world.half) / world.res);
    if (i >= 0 && j >= 0 && i < n && j < n) { const d = world.trackDist[j * n + i]; if (d < 1e8) { const s = T[world.trackIdx[j * n + i]]; return d - s.w / 2; } }
    return map.nearestTrack(world, x, z).d - 6;
  };
  const onLand = (x, z, margin = 3) => Math.abs(x) < world.half - 4 && Math.abs(z) < world.half - 4 && map.shoreAt(x, z) > margin;

  // ---- materials
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = {
    white: lam(0xf3f1ea), cream: lam(0xeadfc4), concrete: lam(0xc9c5bc, { map: view.detail }), dark: lam(0x2c2f33), grey: lam(0x8d9196),
    roofGreen: lam(0x6f9288), roofTile: lam(0xb4623f), glass: new THREE.MeshStandardMaterial({ color: 0x35546b, metalness: 0.5, roughness: 0.15 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.75, roughness: 0.35 }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff4d8 }),
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
  const box = (w, h, d, m, x, y, z, yaw = 0, parent = group, shadow = h > 1.5) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = yaw;
    o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
  };

  // ============================================================ the sea, far hills, mountains
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshLambertMaterial({ color: 0x2b93cc }));
  seaMesh.rotation.x = -Math.PI / 2; seaMesh.position.y = sea; seaMesh.receiveShadow = true; group.add(seaMesh);
  farHills();

  /** a coarse ring of terrain outside the 1.6 km world: the coast continues, the land climbs into the hills behind the town */
  function farHills() {
    const step = 50, R = 4200, n = Math.round(R * 2 / step) + 1, half = world.half - 14, outer = R;
    const cl = (v) => Math.max(-half, Math.min(half, v));
    const ht = (x, z) => {
      const cx = cl(x), cz = cl(z), e = Math.hypot(x - cx, z - cz), base = map.terrain(cx, cz);
      if (base < 0.4) return base;                                                   // open sea / the harbour
      // land: the town climbs steeply behind the harbour, with ridges of Mont Agel and La Turbie further back
      const ridge = fbm(x * 0.0018 + 4, z * 0.0018 - 2, 4);
      return base + e * 0.085 + Math.pow(e / 1000, 1.25) * 70 * (0.5 + 0.9 * ridge) + fbm(x * 0.006, z * 0.006, 3) * 26 * Math.min(1, e / 400);
    };
    const pos = [], col = [], idxs = [], id = new Map();
    const cA = new THREE.Color(0x58783f), cB = new THREE.Color(0x6f7c5c), cC = new THREE.Color(0x8d9187), c = new THREE.Color();
    const vert = (i, j) => {
      const k = j * n + i; if (id.has(k)) return id.get(k);
      const x = i * step - R, z = j * step - R, y = ht(x, z);
      c.copy(cA).lerp(cB, Math.min(1, Math.max(0, (y - 40) / 220))).lerp(cC, Math.min(1, Math.max(0, (y - 280) / 300)));
      const v = 0.9 + fbm(x * 0.01, z * 0.01, 2) * 0.3; col.push(c.r * v, c.g * v, c.b * v); pos.push(x, y - 0.4, z);
      id.set(k, pos.length / 3 - 1); return id.get(k);
    };
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const x0 = i * step - R, x1 = x0 + step, z0 = j * step - R, z1 = z0 + step;
      if (x0 > -world.half + 30 && x1 < world.half - 30 && z0 > -world.half + 30 && z1 < world.half - 30) continue;   // the real terrain covers this
      const a = vert(i, j), b = vert(i + 1, j), cc = vert(i, j + 1), d = vert(i + 1, j + 1);
      idxs.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idxs); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = false; group.add(m);
  }

  // ---- pit lane: asphalt with its entry and exit lanes, white edge lines, concrete apron in front of the garages
  const PIT = map.pit, band = (t) => map.pitBand(world, t) ?? [t.w / 2 - 7, t.w / 2];
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  view._ribbon({ offA: (t) => Math.max(band(t)[0], t.w / 2 - 0.05), offB: (t) => Math.max(band(t)[1], t.w / 2), yOff: 0.06, mat: view.asphaltMaterial(), uvScale: 14, from: idx(PIT.entry), to: idx(PIT.exit) + M, cols: 4, step: 1 });
  view._ribbon({ offA: (t) => band(t)[1] - 0.2, offB: (t) => band(t)[1], yOff: 0.07, mat: lineMat, from: idx(PIT.entry), to: idx(PIT.exit) + M, step: 1 });
  view._ribbon({ offA: (t) => Math.max(band(t)[0], t.w / 2) , offB: (t) => Math.max(band(t)[0] + 0.2, t.w / 2), yOff: 0.07, mat: lineMat, from: idx(PIT.entry), to: idx(PIT.exit) + M, step: 1 });
  // white edge lines along the whole circuit (street circuits paint them right at the kerb)
  view._ribbon({ offA: (t) => t.w / 2 - 0.22, offB: (t) => t.w / 2 - 0.02, yOff: 0.05, mat: lineMat, step: 1, filter: (t) => !(t.noKerbR) });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.22), yOff: 0.05, mat: lineMat, step: 1 });
  // grid boxes are drawn by WorldView; start/finish gantry too

  // ---- 4 m occupancy grid: where buildings stand (so trees, lamps and boats keep clear)
  const OC = 4, ON = Math.round(world.size / OC), occupied = new Uint8Array(ON * ON);
  const occ = (x, z) => { const i = Math.floor((x + world.half) / OC), j = Math.floor((z + world.half) / OC); return i < 0 || j < 0 || i >= ON || j >= ON ? 1 : occupied[j * ON + i]; };
  const markRect = (cx, cz, w, d, yaw, pad = 2) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), r = Math.hypot(w, d) / 2 + pad;
    for (let x = cx - r; x <= cx + r; x += OC * 0.7) for (let z = cz - r; z <= cz + r; z += OC * 0.7) {
      const dx = x - cx, dz = z - cz, u = dx * s + dz * c, v = dx * c - dz * s;
      if (Math.abs(u) <= d / 2 + pad && Math.abs(v) <= w / 2 + pad) { const i = Math.floor((x + world.half) / OC), j = Math.floor((z + world.half) / OC); if (i >= 0 && j >= 0 && i < ON && j < ON) occupied[j * ON + i] = 1; }
    }
  };

  // ============================================================ window texture shared by the town
  const windowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e4e1da'; g.fillRect(0, 118, 128, 10);                                  // floor band
    g.fillStyle = '#b9c2c8'; g.fillRect(30, 22, 68, 86);                                    // frame
    g.fillStyle = '#42576a'; g.fillRect(34, 26, 60, 78);                                    // glass
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(34, 26, 60, 22);
    g.fillStyle = '#b9c2c8'; g.fillRect(62, 26, 4, 78);
    g.fillStyle = '#d8d3c6'; g.fillRect(24, 106, 80, 6);                                    // sill
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.magFilter = THREE.LinearFilter;
    return t;
  })();
  const townMat = new THREE.MeshLambertMaterial({ map: windowTex, vertexColors: true });
  const PASTEL = [0xe6cfa3, 0xedbd9d, 0xf2e6cc, 0xdb9a84, 0xf0dc9c, 0xe6b8b2, 0xf4f1ea, 0xd7cfc2, 0xe9c58f, 0xc9d6cf, 0xefcfae];
  const ROOF = [0xb4623f, 0xa65a3c, 0x8d9196, 0xc07a52, 0x9aa09b];

  /** merged-geometry builder for blocks: walls carry window UVs (3.4 x 3.1 m cells), roofs a flat colour */
  class Blocks {
    constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
    wall(a, b, y0, y1, color) {                                                           // a, b = [x, z]
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), nx = dz / len, nz = -dx / len;
      const k = this.pos.length / 3, u1 = len / 3.4, v1 = (y1 - y0) / 3.1;
      this.pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
      for (let i = 0; i < 4; i++) { this.nor.push(nx, 0, nz); this.col.push(color.r, color.g, color.b); }
      this.uv.push(0, 0, u1, 0, u1, v1, 0, v1); this.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    roof(pts, y, color) {
      const k = this.pos.length / 3;
      for (const [x, z] of pts) { this.pos.push(x, y, z); this.nor.push(0, 1, 0); this.uv.push(0.02, 0.5); this.col.push(color.r, color.g, color.b); }
      this.idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    /** an oriented box footprint (cx, cz, w along yaw, d across), y0 .. y1 */
    block(cx, cz, w, d, yaw, y0, y1, wall, roof) {
      const c = Math.cos(yaw), s = Math.sin(yaw), P = (u, v) => [cx + u * s + v * c, cz + u * c - v * s];
      const q = [P(-d / 2, -w / 2), P(-d / 2, w / 2), P(d / 2, w / 2), P(d / 2, -w / 2)];
      for (let i = 0; i < 4; i++) this.wall(q[i], q[(i + 1) % 4], y0, y1, wall);
      this.roof(q, y1, roof);
    }
    mesh() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setIndex(this.idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, townMat); m.castShadow = true; m.receiveShadow = true; return m;
    }
  }
  const tint = (hex, v = 1) => { const c = new THREE.Color(hex); c.multiplyScalar(v * (0.94 + rand() * 0.12)); return c; };

  // ============================================================ landmarks from the map's building footprints
  const landmarks = footprints(3, 120).filter((f) => f.area > 1500);
  const nonLandmarkBuilding = new Set();
  /** connected components of one land-use class: area, centroid, principal axis (yaw), extent */
  function footprints(klass, minArea) {
    const seen = new Uint8Array(MN * MN), out = [];
    for (let k0 = 0; k0 < MN * MN; k0++) {
      if (GRID[k0] !== klass || seen[k0]) continue;
      const st = [k0]; seen[k0] = 1; let n = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0; const cells = [];
      while (st.length) {
        const c = st.pop(), i = c % MN, j = (c / MN) | 0, x = i * MRES - MHALF, z = j * MRES - MHALF;
        n++; sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z; cells.push(c);
        for (const d of [1, -1, MN, -MN]) { const q = c + d; if (q < 0 || q >= MN * MN || seen[q] || GRID[q] !== klass) continue; if (Math.abs(d) === 1 && ((q / MN) | 0) !== j) continue; seen[q] = 1; st.push(q); }
      }
      const area = n * MRES * MRES; if (area < minArea) continue;
      const cx = sx / n, cz = sz / n, vxx = sxx / n - cx * cx, vzz = szz / n - cz * cz, vxz = sxz / n - cx * cz;
      const ang = 0.5 * Math.atan2(2 * vxz, vxx - vzz), l1 = (vxx + vzz) / 2 + Math.sqrt(((vxx - vzz) / 2) ** 2 + vxz ** 2), l2 = (vxx + vzz) / 2 - Math.sqrt(((vxx - vzz) / 2) ** 2 + vxz ** 2);
      // extents along the principal axes (robust to blobs): project every cell
      let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9; const ca = Math.cos(ang), sa = Math.sin(ang);
      for (const c of cells) { const x = (c % MN) * MRES - MHALF - cx, z = ((c / MN) | 0) * MRES - MHALF - cz, u = x * ca + z * sa, v = -x * sa + z * ca; umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
      // yaw as used by this scene: rotation about +Y whose local +Z points along the long axis
      out.push({ area, x: cx + ((umin + umax) / 2) * ca - ((vmin + vmax) / 2) * sa, z: cz + ((umin + umax) / 2) * sa + ((vmin + vmax) / 2) * ca, len: umax - umin, wid: vmax - vmin, axis: ang, yaw: Math.atan2(ca, sa) });
    }
    return out.sort((a, b) => b.area - a.area);
  }
  buildLandmarks();

  function buildLandmarks() {
    // the Casino is the large footprint closest to the track at Casino Square; the rest become grand hotels
    const cs = frame(906, 0);
    landmarks.sort((a, b) => Math.hypot(a.x - cs.x, a.z - cs.z) - Math.hypot(b.x - cs.x, b.z - cs.z));
    landmarks.forEach((f, i) => {
      const g = Math.min(...[[0, 0], [f.len / 2, 0], [-f.len / 2, 0], [0, f.wid / 2], [0, -f.wid / 2]].map(([u, v]) => world.heightAtGrid(f.x + u * Math.sin(f.yaw) + v * Math.cos(f.yaw), f.z + u * Math.cos(f.yaw) - v * Math.sin(f.yaw)))) - 0.5;
      grandBuilding(f, g, i === 0); markRect(f.x, f.z, f.wid, f.len, f.yaw, 3);
    });
  }

  /** Belle Epoque block: cream stone walls, a mansard roof, corner pavilions with domes; the Casino adds twin towers */
  function grandBuilding(f, ground, isCasino) {
    const b = new Blocks(), stone = tint(0xeee2c6), stone2 = tint(0xe6d6b4), slate = tint(0x68877f);
    const w = f.len, d = f.wid, yaw = f.yaw, floors = isCasino ? 4 : 6, h = floors * 4.0, y0 = ground - 1.5;
    const P = (u, v) => [f.x + u * Math.sin(yaw) + v * Math.cos(yaw), f.z + u * Math.cos(yaw) - v * Math.sin(yaw)];
    b.block(f.x, f.z, w, d, yaw, y0, ground + h, stone, tint(0x9a9a92));
    // mansard roof: a smaller block stepped in, in patinated copper
    b.block(f.x, f.z, w - 3, d - 3, yaw, ground + h, ground + h + 4.2, slate, slate);
    b.block(f.x, f.z, w - 9, d - 9, yaw, ground + h + 4.2, ground + h + 5.2, slate, slate);
    // end pavilions, a little taller, with their own roofs
    for (const sgn of [-1, 1]) {
      const [px, pz] = P(sgn * (w / 2 - 7), 0);
      b.block(px, pz, 14, d + 1.5, yaw, y0, ground + h + 2.2, stone2, tint(0x9a9a92));
      b.block(px, pz, 11, d - 2, yaw, ground + h + 2.2, ground + h + 8.5, slate, slate);
    }
    const mesh = b.mesh(); group.add(mesh);
    // domes and towers (smooth shapes, merged separately)
    const domeMat = mat.roofGreen, cap = (x, y, z, r, hgt) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat); o.position.set(x, y, z); o.scale.y = hgt / r; o.castShadow = true; group.add(o); return o; };
    for (const sgn of [-1, 1]) { const [px, pz] = P(sgn * (w / 2 - 7), 0); cap(px, ground + h + 8.5, pz, 5.2, 5); box(0.5, 4, 0.5, mat.roofGreen, px, ground + h + 13.4, pz, 0, group, false); }
    if (isCasino) {
      for (const sgn of [-1, 1]) {                                                        // the two belfry towers
        const [px, pz] = P(sgn * (w / 2 - 16), -d / 2 + 4);
        box(8, 15, 8, mat.cream, px, ground + h, pz, yaw);
        box(8.6, 1.2, 8.6, mat.white, px, ground + h + 15, pz, yaw);
        cap(px, ground + h + 16.2, pz, 4.6, 9);
        box(0.35, 3.5, 0.35, mat.steel, px, ground + h + 25, pz, 0, group, false);
      }
      const [cx, cz] = P(0, -d / 2 + 2);                                                  // central pediment over the entrance
      box(18, 5, 3, mat.white, cx, ground + h + 4.2, cz, yaw);
      const [tx, tz] = P(0, -d / 2 - 5);                                                  // terrace with balustrade
      box(w * 0.55, 1.2, 10, mat.white, tx, ground, tz, yaw);
      for (let u = -w * 0.27; u <= w * 0.27; u += 2.4) { const [qx, qz] = P(u, -d / 2 - 9.6); box(0.5, 1.3, 0.5, mat.white, qx, ground + 1.2, qz, yaw, group, false); }
    }
    // window bands on the long faces are carried by the shared texture; add a pale cornice line
    const [mx, mz] = P(0, 0);
    box(w + 0.8, 0.5, d + 0.8, mat.white, mx, ground + h - 0.3, mz, yaw, group, false);
  }

  // ============================================================ the tunnel and hotel, pit garages and stands go up first so the town keeps clear of them
  tunnelAndHotel(); pitGarages(); grandstands();

  // ============================================================ the town
  // Jittered grid of apartment blocks across the land: aligned with the street beside the circuit
  // near the track and with the coastline further up the hill; taller and denser up the slope.
  townBlocks();
  function townBlocks() {
    const tiles = new Map(), step = 21, lm = landmarks;
    const nearLandmark = (x, z) => lm.some((f) => { const ca = Math.cos(f.axis), sa = Math.sin(f.axis), dx = x - f.x, dz = z - f.z; return Math.abs(dx * ca + dz * sa) < f.len / 2 + 14 && Math.abs(-dx * sa + dz * ca) < f.wid / 2 + 14; });
    let count = 0;
    for (let gx = -world.half + 20; gx < world.half - 20; gx += step) for (let gz = -world.half + 20; gz < world.half - 20; gz += step) {
      const x = gx + (rand() - 0.5) * step * 0.7, z = gz + (rand() - 0.5) * step * 0.7;
      const sd = map.shoreAt(x, z); if (sd < 9) continue;
      const k = cls(x, z); if (k === 2 || k === 3 || k === 4) continue;
      const dt = dTrack(x, z); if (dt < 11) continue;
      if (nearLandmark(x, z)) continue;
      const info = world.trackInfo(x, z), tr = T[Math.max(0, info.index)];
      // keep the pit apron and quay free along the start straight (right of the circuit)
      const along = map.dist(world, tr);
      if (info.lat > 0 && dt < 38 && (inRange(along, 2980, 3337) || inRange(along, 0, 200))) continue;
      const nearTrack = dt < 90, far = Math.max(0, dt - 90);
      // footprint
      const w = 14 + rand() * 12, d = 12 + rand() * 9;
      const ground = world.heightAtGrid(x, z), y = ground;
      // orientation
      let yaw;
      if (nearTrack && tr) yaw = Math.atan2(tr.tx, tr.tz) + (rand() < 0.5 ? 0 : Math.PI / 2) * (rand() < 0.15 ? 1 : 0);
      else { const e = 6, gxs = map.shoreAt(x + e, z) - map.shoreAt(x - e, z), gzs = map.shoreAt(x, z + e) - map.shoreAt(x, z - e); yaw = Math.atan2(gxs, gzs) + Math.PI / 2 + (rand() - 0.5) * 0.15; }
      // all four corners must be on land, away from the circuit, and on ground that isn't too steep
      const c = Math.cos(yaw), s = Math.sin(yaw); let ok = true, gmin = Infinity, gmax = -Infinity;
      for (const [u, v] of [[-d / 2, -w / 2], [-d / 2, w / 2], [d / 2, w / 2], [d / 2, -w / 2], [0, 0]]) {
        const px = x + u * s + v * c, pz = z + u * c - v * s;
        if (!onLand(px, pz, 6) || dTrack(px, pz) < 8.5 || cls(px, pz) === 2 || cls(px, pz) === 3) { ok = false; break; }
        const hg = world.heightAtGrid(px, pz); gmin = Math.min(gmin, hg); gmax = Math.max(gmax, hg);
      }
      if (!ok || gmax - gmin > 9) continue;
      // taller up the hill and away from the circuit; low and varied along the harbour front
      const rise = Math.min(1, Math.max(0, (ground - 6) / 70));
      const floors = Math.round(4 + rand() * 5 + rise * (4 + rand() * 8) + (far > 0 ? rand() * 3 : 0));
      const hgt = Math.min(floors, 20) * 3.1;
      const key = `${Math.floor(x / 280)},${Math.floor(z / 280)}`;
      if (!tiles.has(key)) tiles.set(key, new Blocks());
      const B = tiles.get(key);
      const wall = tint(PASTEL[(rand() * PASTEL.length) | 0]);
      B.block(x, z, w, d, yaw, gmin - 2.5, gmin + hgt, wall, tint(ROOF[(rand() * ROOF.length) | 0]));
      if (rand() < 0.5) B.block(x + (rand() - 0.5) * 3, z + (rand() - 0.5) * 3, w * 0.45, d * 0.45, yaw, gmin + hgt, gmin + hgt + 2.6, tint(0xe9e4d8), tint(0x9a9a92));   // lift house / roof terrace
      markRect(x, z, w, d, yaw, 2.5);
      count++;
    }
    for (const B of tiles.values()) group.add(B.mesh());
    view.townCount = count;
  }

  // ============================================================ palms, gardens and hillside trees
  palmsAndTrees();
  function palmGeometry() {
    const parts = [], trunkCol = 0x8b7b66, leafCol = 0x3f7a35;
    for (let k = 0; k < 3; k++) {                                                          // slightly curved, tapered trunk
      const r0 = 0.34 - k * 0.07, r1 = r0 - 0.07, h = 3.4, g = new THREE.CylinderGeometry(r1, r0, h, 6, 1, true);
      g.translate(0, h / 2, 0); g.rotateZ(0.045 * k); g.translate(-0.09 * k * k * 0.5, k * 3.3, 0);
      parts.push({ geo: g, color: trunkCol });
    }
    const topX = -0.09 * 4 * 0.5 + 0.045 * 3, topY = 9.9;
    for (let f = 0; f < 11; f++) {                                                          // drooping fronds: a tapered, curved blade
      const a = (f / 11) * Math.PI * 2 + 0.3, L2 = 3.8 + (f % 3) * 0.5, seg = 5, pos = [], idx2 = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg, w = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (1 - 0.4 * t), r = t * L2, y = 0.9 * Math.sin(t * 1.9) - 1.5 * t * t;
        pos.push(r, y, -w * 0.5, r, y, w * 0.5);
      }
      for (let i = 0; i < seg; i++) { const q = i * 2; idx2.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx2);
      g.rotateY(a); g.translate(topX, topY, 0);
      parts.push({ geo: g, color: f % 2 ? leafCol : 0x4a8a3c });
    }
    parts.push({ geo: new THREE.SphereGeometry(0.5, 6, 4).translate(topX, topY - 0.2, 0), color: 0x5b4b36 });
    return mergeParts(parts);
  }
  function palmsAndTrees() {
    const palm = palmGeometry(), pm = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const spots = [], pines = [];
    const free = (x, z, r = 3) => onLand(x, z, 2.5) && dTrack(x, z) > 2.2 && !occ(x, z) && !occ(x + r, z) && !occ(x - r, z) && !occ(x, z + r) && !occ(x, z - r);
    // gardens (Casino Square and the slopes above the harbour): palms and pines on the park cells
    for (let x = -world.half + 10; x < world.half - 10; x += 11) for (let z = -world.half + 10; z < world.half - 10; z += 11) {
      const px = x + (rand() - 0.5) * 8, pz = z + (rand() - 0.5) * 8;
      if (cls(px, pz) !== 2 || !free(px, pz)) continue;
      (rand() < 0.5 ? spots : pines).push({ x: px, z: pz, h: 0.8 + rand() * 0.5 });
    }
    // palms along the avenues and the harbour front, on whichever side is land
    for (const [a, b, gap] of [[2960, 3337, 17], [0, 190, 17], [2090, 2350, 21], [2400, 2560, 19], [210, 470, 24], [620, 780, 22]]) {
      for (let d = a; d <= b; d += gap) for (const side of [-1, 1]) {
        const hw = hwAt(d), lat = side * (hw + 5.5 + rand() * 1.5), f = frame(d + rand() * 3, lat);
        if (!free(f.x, f.z, 1.2)) continue;
        spots.push({ x: f.x, z: f.z, h: 0.85 + rand() * 0.45 });
      }
    }
    const mesh = new THREE.InstancedMesh(palm, pm, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    spots.forEach((p, i) => { q.setFromAxisAngle(up, rand() * 6.28); m4.compose(new THREE.Vector3(p.x, world.heightAtGrid(p.x, p.z) - 0.15, p.z), q, new THREE.Vector3(p.h, p.h, p.h)); mesh.setMatrixAt(i, m4); });
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    // Aleppo pines and holm oaks over the unbuilt hillside beyond the town
    for (let n = 0; n < 2600; n++) {
      const x = (rand() - 0.5) * (world.size - 20), z = (rand() - 0.5) * (world.size - 20);
      if (!onLand(x, z, 10) || cls(x, z) === 3) continue;
      const dt = dTrack(x, z); if (dt < 14 || occ(x, z) || occ(x + 5, z) || occ(x, z + 5)) continue;
      const hill = world.heightAtGrid(x, z); if (rand() > 0.22 + Math.min(0.6, hill / 140)) continue;
      pines.push({ x, z, h: 0.7 + rand() * 0.7 });
    }
    const tree = (() => {
      const parts = [{ geo: new THREE.CylinderGeometry(0.22, 0.34, 6, 5).translate(0, 3, 0), color: 0x5a4632 }];
      const g1 = new THREE.IcosahedronGeometry(1, 0); for (const [x, y, z, r] of [[0, 7.6, 0, 3.0], [1.4, 6.4, 0.6, 2.2], [-1.3, 6.8, -0.8, 2.4]]) parts.push({ geo: g1.clone().scale(r, r * 0.75, r).translate(x, y, z), color: 0x3c6a37 });
      return mergeParts(parts);
    })();
    const tm = new THREE.InstancedMesh(tree, new THREE.MeshLambertMaterial({ vertexColors: true }), pines.length);
    pines.forEach((p, i) => { q.setFromAxisAngle(up, rand() * 6.28); m4.compose(new THREE.Vector3(p.x, world.heightAtGrid(p.x, p.z) - 0.2, p.z), q, new THREE.Vector3(p.h, p.h * (0.9 + rand() * 0.4), p.h)); tm.setMatrixAt(i, m4); });
    tm.castShadow = true; tm.receiveShadow = true; group.add(tm);
    view.palmCount = spots.length; view.treeCount = pines.length;
  }

  // ============================================================ tunnel under the hotel
  function tunnelAndHotel() {
    const [t0, t1] = map.tunnel, seg = 8, concrete = lam(0xb9b4aa, { map: view.detail });
    for (let d = t0; d < t1; d += seg) {
      const c = d + seg / 2, hw = hwAt(c), f = frame(c, 0), y = f.t.y, w2 = hw + 2.2;
      box(w2 * 2, 1.4, seg + 0.4, concrete, f.x, y + 6.2, f.z, f.yaw);                      // roof slab
      for (const side of [-1, 1]) { const q = frame(c, side * (hw + 1.75)); box(1.1, 6.6, seg + 0.4, concrete, q.x, y - 0.3, q.z, q.yaw); }   // side walls
      for (const side of [-0.45, 0.45]) { const q = frame(c, side * hw); box(0.35, 0.12, seg * 0.8, mat.light, q.x, y + 6.05, q.z, q.yaw, group, false); }   // ceiling lights
    }
    for (const d of [t0, t1]) { const hw = hwAt(d), f = frame(d, 0); box((hw + 3) * 2, 2.2, 1.6, mat.concrete, f.x, f.t.y + 5.5, f.z, f.yaw); }   // portal lintels
    // the hotel: a terraced pale block over the tunnel
    const hb = new Blocks(), hotelStart = t0 + 20, hotelEnd = t1 - 40, n = Math.round((hotelEnd - hotelStart) / 22);
    for (let k = 0; k < n; k++) {
      const c = hotelStart + (k + 0.5) * (hotelEnd - hotelStart) / n, f = frame(c, 0), hw = hwAt(c), floors = 7 + (k % 3);
      const wall = tint(k % 2 ? 0xf2efe6 : 0xe7dcc2), span = (hotelEnd - hotelStart) / n + 1;
      hb.block(f.x, f.z, hw * 2 + 22, span, f.yaw, f.t.y + 5.9, f.t.y + 6.9 + floors * 3.1, wall, tint(0xa0a09a));
      markRect(f.x, f.z, hw * 2 + 22, span, f.yaw, 4);
    }
    group.add(hb.mesh());
  }

  // ============================================================ pit garages on the harbour side of the start straight
  function pitGarages() {
    const pit = map.pit, start = pit.from, len = ((pit.to - pit.from + L) % L) || L, nb = Math.floor(len / 8.4);
    let built = 0;
    for (let k = 0; k < nb; k++) {
      const d = wrapD(start + (k + 0.5) * len / nb), hw = hwAt(d), lat0 = hw + 9.9, depth = 7.5, f = frame(d, lat0 + depth / 2), back = frame(d, lat0 + depth);
      if (!onLand(f.x, f.z, 2) || !onLand(back.x, back.z, 1)) continue;
      const y = Math.min(f.y, frame(d, lat0).y) - 0.2, w = len / nb - 0.25;
      box(depth, 6.4, w, mat.concrete, f.x, y, f.z, f.yaw);
      const front = frame(d, lat0 - 0.06), face = Math.atan2(-front.t.rx, -front.t.rz);
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(w, 6.2), new THREE.MeshLambertMaterial({ map: garageFacade(k + 1) }));
      pm.position.set(front.x, y + 3.2, front.z); pm.rotation.y = face; group.add(pm);
      box(depth + 0.6, 0.3, w + 0.1, mat.dark, f.x, y + 6.4, f.z, f.yaw);
      markRect(f.x, f.z, w, depth, f.yaw, 3); built++;
    }
    view.pitBays = built;
  }

  // ============================================================ scaffold grandstands (the red blocks on the F1 map)
  function grandstands() {
    const stands = footprints(4, 60), colours = ['#1565c0', '#c62828', '#e8e8e8', '#1b5e20'];
    stands.forEach((f, i) => {
      const info = world.trackInfo(f.x, f.z), t = T[Math.max(0, info.index)];
      let nx = t.x - f.x, nz = t.z - f.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const yaw = Math.atan2(nx, nz), w = Math.max(f.len, f.wid), rows = 6, rowH = 0.55, rowD = 0.95;
      const seat = new THREE.MeshLambertMaterial({ map: seatTexture(colours[i % colours.length]) }), base = world.heightAtGrid(f.x, f.z);
      for (let r = 0; r < rows; r++) {
        const back = (rows - r) * rowD, px = f.x - nx * (back - rowD * rows / 2), pz = f.z - nz * (back - rowD * rows / 2);
        box(w, rowH * (r + 1), rowD, r % 2 ? mat.grey : seat, px, base, pz, yaw);
      }
      box(w, rows * rowH + 3.2, 0.25, mat.dark, f.x - nx * (rowD * rows / 2 + 0.3), base, f.z - nz * (rowD * rows / 2 + 0.3), yaw);
      box(w + 0.4, 0.25, rowD * rows * 0.9, lam(0xf4f4f0), f.x - nx * rowD * rows * 0.1, base + rows * rowH + 3.3, f.z - nz * rowD * rows * 0.1, yaw, group, false);
      markRect(f.x, f.z, w + 4, rows * rowD + 4, yaw, 3);
    });
    view.standCount = stands.length;
  }

  // ============================================================ yachts moored in the harbour
  boats();
  function boats() {
    const hull = (Lg, B, H, col, cab) => {
      const parts = [{ geo: new THREE.BoxGeometry(B, H, Lg).translate(0, H / 2, 0), color: col }];
      parts.push({ geo: new THREE.ConeGeometry(B * 0.5, Lg * 0.22, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, H / (B * 0.7), 1).translate(0, H / 2, Lg * 0.5 + Lg * 0.09), color: col });
      parts.push({ geo: new THREE.BoxGeometry(B * 0.8, H * 0.8, Lg * 0.5).translate(0, H + H * 0.4, -Lg * 0.1), color: cab });
      parts.push({ geo: new THREE.BoxGeometry(B * 0.6, H * 0.6, Lg * 0.28).translate(0, H * 2 + H * 0.3, -Lg * 0.14), color: 0xdfe6ea });
      return mergeParts(parts);
    };
    const sail = (Lg) => mergeParts([{ geo: new THREE.BoxGeometry(Lg * 0.22, Lg * 0.07, Lg).translate(0, Lg * 0.035, 0), color: 0xf4f4f1 }, { geo: new THREE.BoxGeometry(Lg * 0.14, Lg * 0.05, Lg * 0.4).translate(0, Lg * 0.09, -Lg * 0.1), color: 0xcfd6db }, { geo: new THREE.CylinderGeometry(0.1, 0.12, Lg * 1.15, 4).translate(0, Lg * 0.6, Lg * 0.05), color: 0xc7ccd1 }]);
    const kinds = [hull(24, 6.5, 2.6, 0xf6f6f2, 0xeef0f1), hull(34, 8, 3, 0xf1f1ee, 0xe7e9ea), hull(14, 4.2, 1.7, 0xe9eef2, 0x2e5d8c), sail(15), sail(11), hull(9, 2.8, 1.2, 0xf1f1ee, 0xc9d5db)];
    const bm = new THREE.MeshLambertMaterial({ vertexColors: true }), spots = kinds.map(() => []), all = [];
    // the harbour basin sits in the middle of the circuit's loop between Sainte Devote and the chicane
    let hx = 0, hz = 0, hn = 0; for (let d = 2100; d < L + 420; d += 20) { const f = frame(d, 0); hx += f.x; hz += f.z; hn++; } hx /= hn; hz /= hn;
    for (let n = 0; n < 20000 && all.length < 330; n++) {
      const x = (rand() - 0.5) * world.size * 0.7, z = (rand() - 0.5) * world.size * 0.7, sd = map.shoreAt(x, z);
      if (sd > -4 || sd < -30 || Math.hypot(x - hx, z - hz) > 300) continue;                // berthed beside a quay or pontoon, inside the harbour
      const e = 5, gx = map.shoreAt(x + e, z) - map.shoreAt(x - e, z), gz = map.shoreAt(x, z + e) - map.shoreAt(x, z - e);
      if (Math.hypot(gx, gz) < 0.2) continue;
      const dt = dTrack(x, z); if (dt < 9) continue;
      if (all.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 36)) continue;
      const p = { x, z, yaw: Math.atan2(gx, gz), s: 0.9 + rand() * 0.3 }; all.push(p); spots[(rand() * kinds.length) | 0].push(p);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    kinds.forEach((g, k) => {
      if (!spots[k].length) return;
      const im = new THREE.InstancedMesh(g, bm, spots[k].length);
      spots[k].forEach((p, i) => { q.setFromAxisAngle(up, p.yaw + (rand() - 0.5) * 0.08); m4.compose(new THREE.Vector3(p.x, sea - 0.5, p.z), q, new THREE.Vector3(p.s, p.s, p.s)); im.setMatrixAt(i, m4); });
      im.castShadow = true; group.add(im);
    });
    view.boatCount = all.length;
  }

  // ============================================================ street lamps and advertising boards
  furniture();
  function furniture() {
    const post = mergeParts([{ geo: new THREE.CylinderGeometry(0.1, 0.16, 9, 6).translate(0, 4.5, 0), color: 0x3b4044 }, { geo: new THREE.BoxGeometry(0.2, 0.2, 2.6).translate(0, 9, 1.2), color: 0x3b4044 }, { geo: new THREE.BoxGeometry(0.5, 0.18, 0.9).translate(0, 8.85, 2.4), color: 0xf4eecf }]);
    const spots = [];
    for (const [a, b, gap, side] of [[2960, 3337, 36, -1], [0, 200, 36, -1], [2050, 2570, 40, 1], [2050, 2570, 40, -1], [210, 480, 40, 1]]) {
      for (let d = a; d < b; d += gap) {
        const f = frame(d, side * (hwAt(d) + 3.4)); if (!onLand(f.x, f.z, 2) || occ(f.x, f.z)) continue;
        spots.push({ x: f.x, z: f.z, yaw: f.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    const im = new THREE.InstancedMesh(post, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    spots.forEach((p, i) => { q.setFromAxisAngle(up, p.yaw); m4.compose(new THREE.Vector3(p.x, world.heightAtGrid(p.x, p.z), p.z), q, one); im.setMatrixAt(i, m4); });
    im.castShadow = true; group.add(im);
    // boards on the barrier: generic Riviera lettering (no real brands)
    const WORDS = [['MONTE-CARLO', '#0b3d7a', '#fff'], ['CÔTE D’AZUR', '#e8e8e8', '#0b3d7a'], ['PRINCIPAUTÉ', '#7a1020', '#fff'], ['PORT HERCULE', '#0f6e5a', '#fff'], ['RIVIERA', '#f2c230', '#111'], ['MÉDITERRANÉE', '#111', '#fff']];
    const tex = WORDS.map(([t, bg, fg]) => { const x = bannerTexture(t, { bg, fg, w: 512, h: 96 }); x.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: x }); });
    let k = 0;
    for (const [a, b, sides] of [[2080, 2340, [1]], [2380, 2520, [1, -1]], [3000, 3337, [-1]], [0, 110, [-1]], [215, 470, [-1]], [1990, 2080, [-1]]]) {
      for (let d = a; d < b; d += 7.2) for (const side of sides) {
        const hw = hwAt(d), f = frame(d, side * (hw + 0.55 + (T[idx(d)].kerb ? 0.85 : 0)));
        const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 1.0), tex[k++ % tex.length]);
        m.position.set(f.x, f.y + 1.55, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
      }
    }
  }
}
