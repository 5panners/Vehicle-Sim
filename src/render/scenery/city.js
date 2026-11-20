import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../../world/noise.js';
import { SURF } from '../../world/Surfaces.js';
import { lighting } from '../lighting.js';
import { Workshops } from './workshop.js';
import { broadleafTree, birchTree, pineTree, garageFacade, seatTexture, bannerTexture } from './lowpoly.js';
import { CANAL, WATER } from '../../world/maps/city.js';

/**
 * Harbour Street surroundings (low-poly): a city of facade-textured blocks that lights up at night, a straight canal with quay
 * walls, rails, moored boats and a stone arch bridge carrying the lap, a steel footbridge, kart garages and a race-control
 * tower on the pit straight, a stand opposite, sponsor boards, street lamps and tree-lined promenades.
 * Placed by lap distance + lateral offset (+ = right).
 */
export function buildCityScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const PIT = map.pit, C = map.corners;
  const rand = rng(77);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const keepOut = [];
  const free = (x, z, r) => !T.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = { concrete: lam(0xd2cfc8, { map: view.detail }), white: lam(0xf3f3f0), grey: lam(0x8d9196), dark: lam(0x2c2f33), orange: lam(0xff7a1a), red: lam(0xc62828), roof: lam(0xe9ecef),
    stone: lam(0xb9ab94, { map: view.detail }), stoneDark: lam(0x8e8472, { map: view.detail }), iron: lam(0x2d3a45),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.75, roughness: 0.35 }), glass: new THREE.MeshStandardMaterial({ color: 0x2b4258, metalness: 0.6, roughness: 0.12 }) };
  const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
  const box = (w, h, d, m, x, y, z, yaw = 0) => { const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = yaw; o.castShadow = h > 1.5; o.receiveShadow = true; group.add(o); return o; };
  const panel = (w, h, m, x, y, z, faceYaw, uRepeat = 1) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uRepeat);
    const o = new THREE.Mesh(g, m); o.position.set(x, y + h / 2, z); o.rotation.y = faceYaw; group.add(o); return o;
  };
  const solid = (x, z, w, d, yaw, h = 3) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (u, v) => [x + v * c + u * s, z - v * s + u * c];
    world.addWall([P(-d / 2, -w / 2), P(-d / 2, w / 2), P(d / 2, w / 2), P(d / 2, -w / 2), P(-d / 2, -w / 2)], { height: h, thickness: 0.6, style: 'building' });
    keepOut.push({ x, z, r: Math.hypot(w, d) / 2 + 3 });
  };
  const B = map._bridge, G = map._gap;
  const nearCrossing = (z, r = 22) => Math.abs(z - B.z) < r || Math.abs(z - G.z) < r;

  // ================================================================= pit lane markings, edge lines
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 + 2.2, t.w / 2 + 6.2];
  const i0 = idx(PIT.from), i1 = idx(PIT.to), to = i1 + (i1 < i0 ? M : 0);
  view._ribbon({ offA: (t) => band(t)[1] - 0.2, offB: (t) => band(t)[1], yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => band(t)[0], offB: (t) => band(t)[0] + 0.2, yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => t.w / 2 - 0.18, offB: (t) => t.w / 2 - 0.02, yOff: 0.02, mat: lineMat, step: 1, filter: (t) => !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.18), yOff: 0.02, mat: lineMat, step: 1 });

  // ================================================================= the canal: water, quay rails, boats
  const wc = document.createElement('canvas'); wc.width = wc.height = 128;
  { const g = wc.getContext('2d'); g.fillStyle = '#2d6d8c'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${i % 3 ? 190 : 255},${i % 3 ? 225 : 255},255,${0.05 + rand() * 0.12})`; g.lineWidth = 1 + rand() * 2; const x = rand() * 128, y = rand() * 128; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y + 2, x + 20, y); g.stroke(); } }
  const waterTex = new THREE.CanvasTexture(wc); waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping; waterTex.colorSpace = THREE.SRGBColorSpace; waterTex.repeat.set(2, world.size / 18);
  const water = new THREE.Mesh(new THREE.PlaneGeometry((CANAL.wall + 1.4) * 2, world.size), new THREE.MeshStandardMaterial({ map: waterTex, color: 0xcfe6f2, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2; water.position.set(CANAL.x, WATER, 0); water.receiveShadow = true; group.add(water);
  view.updaters?.push(() => { waterTex.offset.y = (performance.now() * 0.00004) % 1; });
  // rails along both quays (not across the bridge deck or the jump)
  {
    const posts = [], railRuns = [];
    for (const sd of [-1, 1]) {
      const x = CANAL.x + sd * (CANAL.wall + 1.0);
      for (let z = -world.half + 10; z < world.half - 10; z += 3) {
        if (nearCrossing(z + 1.5, 10.5)) continue;
        posts.push([x, world.heightAtGrid(x, z), z]); railRuns.push([x, world.heightAtGrid(x, z + 1.5), z + 1.5]);
      }
    }
    const pm = new THREE.InstancedMesh(BOX, mat.iron, posts.length), rm = new THREE.InstancedMesh(BOX, mat.iron, railRuns.length * 2), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    posts.forEach(([x, y, z], k) => { p.set(x, y, z); s.set(0.07, 1.05, 0.07); m4.compose(p, q, s); pm.setMatrixAt(k, m4); });
    railRuns.forEach(([x, y, z], k) => { for (let r = 0; r < 2; r++) { p.set(x, y + 0.5 + r * 0.45, z); s.set(0.05, 0.05, 3.05); m4.compose(p, q, s); rm.setMatrixAt(k * 2 + r, m4); } });
    group.add(pm, rm);
  }
  // moored boats and bollards
  const hulls = [0xf2f2f0, 0x1d4f91, 0xc62828, 0x2e7d32, 0xf2b705];
  for (let k = 0; k < 14; k++) {
    const z = -world.half + 60 + k * 62 + rand() * 20, sd = k % 2 ? 1 : -1;
    if (nearCrossing(z, 30)) continue;
    const x = CANAL.x + sd * 2.4, c = hulls[k % hulls.length], len = 6 + rand() * 4;
    box(2.3, 0.7, len, lam(c), x, WATER - 0.35, z);
    box(1.8, 0.8, len * 0.45, mat.white, x, WATER + 0.35, z - len * 0.1);
    box(1.9, 0.12, len * 0.5, mat.dark, x, WATER + 1.15, z - len * 0.1);
  }
  for (const sd of [-1, 1]) for (let z = -world.half + 30; z < world.half - 20; z += 24) {
    if (nearCrossing(z, 12)) continue;
    const x = CANAL.x + sd * (CANAL.wall + 0.3); box(0.3, 0.45, 0.3, mat.iron, x, world.heightAtGrid(x, z), z);
  }

  // ================================================================= the arch bridge (the road runs on it; the heightfield under the deck is solid)
  {
    const t = T[B.i], yaw = Math.atan2(t.tx, t.tz), hwB = t.w / 2 + 1.6, deck = t.y;
    const halfSpan = CANAL.wall + 0.15;
    // the stone body between the quays, parapets along the road edges, the arch openings on the canal faces
    box(halfSpan * 2, deck - (CANAL.depth - 0.4), hwB * 2, mat.stone, B.x, CANAL.depth - 0.4, B.z, 0);
    for (const sd of [-1, 1]) {
      box(halfSpan * 2 + 5, 1.15, 0.5, mat.stoneDark, B.x, deck - 0.02, B.z + sd * (hwB - 0.2), 0);                    // parapet
      for (let u = -halfSpan - 2; u <= halfSpan + 2; u += 3) box(0.5, 1.5, 0.7, mat.stone, B.x + u, deck - 0.02, B.z + sd * (hwB - 0.2), 0);   // pilasters
      box(halfSpan * 2 + 5.4, 0.12, 0.8, mat.stone, B.x, deck + 1.12, B.z + sd * (hwB - 0.2), 0);                        // coping
      const arch = new THREE.Shape(); const R = 3.5;
      arch.moveTo(-R, CANAL.depth); arch.lineTo(-R, WATER + 0.9); arch.absarc(0, WATER + 0.9, R, Math.PI, 0, true); arch.lineTo(R, CANAL.depth); arch.lineTo(-R, CANAL.depth);
      const hole = new THREE.Mesh(new THREE.ShapeGeometry(arch, 24), new THREE.MeshBasicMaterial({ color: 0x0f2230 }));
      hole.position.set(B.x, 0, B.z + sd * (hwB + 0.04)); hole.rotation.y = sd > 0 ? 0 : Math.PI; group.add(hole);
      const ring = new THREE.Mesh(new THREE.RingGeometry(R, R + 0.55, 24, 1, 0, Math.PI), mat.stoneDark);
      ring.position.set(B.x, WATER + 0.9, B.z + sd * (hwB + 0.06)); ring.rotation.y = sd > 0 ? 0 : Math.PI; group.add(ring);
    }
    keepOut.push({ x: B.x, z: B.z, r: 16 });
    // ... and lamps on the parapet
    for (const sd of [-1, 1]) for (const u of [-halfSpan - 1, halfSpan + 1]) {
      box(0.12, 3.2, 0.12, mat.iron, B.x + u, deck + 0.4, B.z + sd * (hwB - 0.2), 0);
      box(0.4, 0.4, 0.4, lam(0xfff1c8, { emissive: 0x332a10 }), B.x + u, deck + 3.5, B.z + sd * (hwB - 0.2), 0);
    }
    void yaw;
  }
  // a steel arch footbridge upstream of the start, over the quiet middle of the canal
  {
    const z = 20, span2 = CANAL.wall + 1.3, hl = world.heightAtGrid(CANAL.x - span2 - 3, z), hr = world.heightAtGrid(CANAL.x + span2 + 3, z), y = Math.max(hl, hr) + 0.4;
    box((span2 + 3) * 2, 0.35, 3.2, mat.stoneDark, CANAL.x, y, z);
    const tor = new THREE.TorusGeometry(span2 + 3, 0.12, 6, 28, Math.PI);
    for (const sz of [-1.5, 1.5]) { const a = new THREE.Mesh(tor, mat.steel); a.position.set(CANAL.x, y + 0.2, z + sz); a.scale.set(1, 0.42, 1); a.castShadow = true; group.add(a); }
    for (let u = -span2 - 2; u <= span2 + 2; u += 2.6) for (const sz of [-1.5, 1.5]) {
      const h = Math.sqrt(Math.max(0, 1 - (u / (span2 + 3)) ** 2)) * (span2 + 3) * 0.42;
      box(0.05, h, 0.05, mat.steel, CANAL.x + u, y + 0.3, z + sz);
    }
  }

  // ================================================================= kart garages and race control (the pit straight)
  const g0 = PIT.from + 10, g1 = PIT.to - 10, glat0 = hw(0) + 12.5, glat1 = glat0 + 6;
  const n = Math.round(span(g0, g1) / 7), len = span(g0, g1) / n;
  const facade = new THREE.MeshLambertMaterial({ map: garageFacade(1), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shops = new Workshops();
  for (let k = 0; k < n; k++) {
    const d = g0 + (k + 0.5) * len, f = frame(d, (glat0 + glat1) / 2), base = Math.min(frame(d, glat0).y, frame(d, glat1).y) - 0.2;
    if (!free(f.x, f.z, 6) || !free(frame(d, glat0).x, frame(d, glat0).z, 3)) continue;
    const depth = glat1 - glat0;
    let floorY = 0.2;
    if (k % 2 === 0) {
      const at = (lx, lz) => [f.x - f.t.rx * lx + f.t.tx * lz, f.z - f.t.rz * lx + f.t.tz * lz];
      let [x, z] = at(-depth / 2 - 0.15, 0); box(0.3, 3.4, len - 0.4, mat.concrete, x, base, z, f.yaw);
      for (const sd of [-1, 1]) { [x, z] = at(0, sd * (len / 2 - 0.35)); box(depth, 3.4, 0.3, mat.concrete, x, base, z, f.yaw); }
      box(depth + 0.8, 0.3, len, mat.grey, f.x, base + 3.4, f.z, f.yaw);
      [x, z] = at(depth / 2 - 0.1, 0); box(0.3, 0.45, len - 0.4, mat.red, x, base + 3.0, z, f.yaw);
      let gmax = base;
      for (const lx of [-depth / 2, 0, depth / 2]) for (const lz of [-len / 2, 0, len / 2]) { const [qx, qz] = at(lx, lz); gmax = Math.max(gmax, world.heightAtGrid(qx, qz)); }
      floorY = Math.min(0.45, Math.max(0.2, gmax - base + 0.04));
      [x, z] = at(0, 0); box(depth, floorY, len - 0.4, mat.dark, x, base, z, f.yaw);
      const [bx, bz] = at(depth / 2, 0);
      shops.add('kart', bx, base + floorY, bz, Math.atan2(-f.t.rx, -f.t.rz), [0xff6d00, 0x00b0ff, 0xffd600, 0xc62828][(k / 2 | 0) % 4]);
    } else {
      box(depth, 3.4, len - 0.4, mat.concrete, f.x, base, f.z, f.yaw);
      box(depth + 0.8, 0.3, len, mat.grey, f.x, base + 3.4, f.z, f.yaw);
      const fx = f.x - f.t.rx * (depth / 2 + 0.05), fz = f.z - f.t.rz * (depth / 2 + 0.05);
      panel(len - 0.4, 3.2, facade, fx, base, fz, Math.atan2(-f.t.rx, -f.t.rz), (len - 0.4) / 9);
    }
    solid(f.x, f.z, depth, len, f.yaw, 3.4);
  }
  shops.build(group);
  {
    const f = frame(24, glat1 + 6);
    if (free(f.x, f.z, 8)) {
      box(8, 10, 6, mat.white, f.x, f.y, f.z, f.yaw); box(8.6, 3.2, 6.6, mat.glass, f.x, f.y + 10, f.z, f.yaw); box(9, 0.5, 7.2, mat.dark, f.x, f.y + 13.2, f.z, f.yaw);
      box(0.15, 5, 0.15, mat.steel, f.x, f.y + 13.7, f.z); solid(f.x, f.z, 8, 6, f.yaw, 13);
    }
  }

  // ================================================================= stand opposite the pits
  const seat = new THREE.MeshLambertMaterial({ map: seatTexture('#1f4e9a'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stand = (d0, d1, side, lat0, rows = 7, bays = 3) => {
    const sp = span(d0, d1) / bays;
    for (let k = 0; k < bays; k++) {
      const d = d0 + (k + 0.5) * sp, f = frame(d, side * (lat0 + rows * 0.45)), base = frame(d, side * lat0).y - 0.2;
      if (!free(f.x, f.z, rows * 0.45 + 3.5)) continue;
      for (let r = 0; r < rows; r++) {
        const g = frame(d, side * (lat0 + (r + 0.5) * 0.9)), top = base + 0.5 + (r + 1) * 0.45;
        box(0.9, top - base, sp - 0.6, mat.concrete, g.x, base, g.z, f.yaw);
        panel(sp - 0.6, 0.45, seat, g.x - side * g.t.rx * 0.51, top - 0.45, g.z - side * g.t.rz * 0.51, Math.atan2(-side * f.t.rx, -side * f.t.rz), (sp - 0.6) / 5);
      }
      const rH = base + 0.5 + rows * 0.45 + 2.6, roof = frame(d, side * (lat0 + rows * 0.45));
      const r2 = box(rows * 0.9 + 1.6, 0.25, sp - 0.3, mat.roof, roof.x, rH, roof.z, f.yaw); r2.rotation.z = side * 0.06;
      for (const u of [-0.5, 0.5]) { const p = frame(d + u * sp, side * (lat0 + rows * 0.9)); box(0.25, rH - base, 0.25, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * 0.9 + 1, sp, f.yaw, rH - base);
    }
  };
  stand(PIT.from + 14, 110, -1, hw(0) + 5.5, 7, 5);
  const t1 = C['Turn 1'] ?? 215;
  stand(t1 - 22, t1 + 26, map.outside(world, t1), hw(t1) + 7, 5, 2);

  // ================================================================= sponsor boards, marshal posts, brake boards
  const WORDS = [['HARBOUR BANK', '#0b3d7a', '#fff'], ['NORDWIND ENERGY', '#111', '#ffc400'], ['CANAL COFFEE', '#6d3b1c', '#fff'], ['PIT STOP', '#e8e8e8', '#111'], ['METROLINE', '#c62828', '#fff'], ['GRIP', '#1b5e20', '#fff']];
  const ads = WORDS.map(([t, bg, fg]) => { const x = bannerTexture(t, { bg, fg, w: 512, h: 96 }); x.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: x }); });
  let ak = 0;
  for (let d = 4; d < L; d += 16) {
    const side = Math.floor(d / 140) % 2 ? 1 : -1, off = hw(d) + 3.9;
    if (side > 0 && (d > PIT.from - 15 || d < PIT.to + 15)) continue;
    const f = frame(d, side * off), info = world.trackInfo(f.x, f.z);
    if (!free(f.x, f.z, 2.2) || Math.abs(f.x) < CANAL.wall + 6) continue;
    if (info.index >= 0 && Math.min(Math.abs(info.index - idx(d)), M - Math.abs(info.index - idx(d))) > 30 && info.dist < 9) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.9), ads[ak++ % ads.length]);
    m.position.set(f.x, f.y + 1.5, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
  }
  for (const key of Object.keys(C)) {
    const dd = C[key], out = map.outside(world, dd), f = frame(dd + 6, out * (hw(dd) + 5.6));
    if (!free(f.x, f.z, 2.5) || Math.abs(f.x) < CANAL.wall + 6) continue;
    box(1.4, 2.4, 1.4, mat.orange, f.x, f.y - 0.1, f.z, f.yaw); box(1.7, 0.2, 1.7, mat.dark, f.x, f.y + 2.3, f.z, f.yaw);
  }
  for (const key of ['Turn 1', 'Turn 4', 'Turn 9']) {
    if (C[key] === undefined) continue;
    const out = map.outside(world, C[key]);
    for (const m of [100, 50]) {
      const f = frame(C[key] - m - 6, -out * (hw(C[key]) + 2.6));
      if (!free(f.x, f.z, 1.4) || Math.abs(f.x) < CANAL.wall + 4) continue;
      const tex = bannerTexture(String(m), { bg: '#f1f1ec', fg: '#111', w: 128, h: 96 }); tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshLambertMaterial({ map: tex })); pm.position.set(f.x, f.y + 2.1, f.z); pm.rotation.y = Math.atan2(out * f.t.rx, out * f.t.rz); group.add(pm);
      box(0.08, 2.1, 0.08, mat.steel, f.x, f.y, f.z, f.yaw);
    }
  }
  // a warning sign before the jump
  { const f = frame(G.i + (L - M) * 0 - 60, hw(G.i) + 3); const tex = bannerTexture('JUMP', { bg: '#f2b705', fg: '#111', w: 192, h: 96 }); tex.colorSpace = THREE.SRGBColorSpace;
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshLambertMaterial({ map: tex })); sg.position.set(f.x, f.y + 2.4, f.z); sg.rotation.y = Math.atan2(-f.t.rx, -f.t.rz); group.add(sg); box(0.1, 2.2, 0.1, mat.steel, f.x, f.y, f.z); }

  // ================================================================= the city: facade blocks with lit windows
  const bw = 25.6, bh = 27.2, TILE = 512;
  const LIT = ['#ffd890', '#ffd890', '#ffc878', '#ffb868', '#fff0cc', '#f4f8ff', '#bfe0ff', '#cfe8d0', '#ffd0b0'];   // warm bulbs, daylight tubes, a few cool and soft green screens
  const wallC = document.createElement('canvas'); wallC.width = wallC.height = TILE;
  const litC = document.createElement('canvas'); litC.width = litC.height = TILE;
  {
    const g = wallC.getContext('2d'), e = litC.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, TILE, TILE); e.fillStyle = '#000'; e.fillRect(0, 0, TILE, TILE);
    const cols = 8, rows = 8, cw = TILE / cols, rh = TILE / rows;
    const rowP = Array.from({ length: rows }, () => (rand() < 0.3 ? 0.55 : rand() < 0.5 ? 0.12 : 0.02)), colP = Array.from({ length: cols }, () => 0.4 + rand() * 0.9);   // lit floors and lit bays come in uneven runs
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + 5, y = r * rh + 6, w = cw - 10, h = rh - 13;
      g.fillStyle = '#26394a'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(170,205,235,0.35)'; g.fillRect(x, y, w, h * 0.35);
      g.fillStyle = '#bdbdb6'; g.fillRect(x - 3, y + h, w + 6, 4);                 // sill
      if (rand() < rowP[r] * colP[c]) { e.fillStyle = LIT[(rand() * LIT.length) | 0]; e.fillRect(x, y, w, h); }
    }
  }
  const wallTex = new THREE.CanvasTexture(wallC), litTex = new THREE.CanvasTexture(litC);
  for (const t of [wallTex, litTex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; }
  const cityMat = new THREE.MeshLambertMaterial({ map: wallTex, vertexColors: true, emissive: 0xffffff, emissiveMap: litTex, emissiveIntensity: 0 });
  const PALETTE = [0xe9dfd0, 0xd9c7ae, 0xc9a68a, 0xb4573f, 0x9c7a64, 0xcfd6dc, 0x9fb1be, 0xe6e0d4, 0xd8cdb8, 0x8a97a0, 0xf0e8da];
  const parts = [], rects = [];
  const cc = new THREE.Color();
  const addBuilding = (x, z, w, d, h) => {
    let y0 = Infinity; for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) y0 = Math.min(y0, world.heightAtGrid(x + dx * w / 2, z + dz * d / 2));
    const ou = Math.floor(rand() * 8) / 8, ov = Math.floor(rand() * 8) / 8;   // every building starts at a different window of the tile
    const g = new THREE.BoxGeometry(w, h + 2.5, d); g.translate(x, y0 - 2.5 + (h + 2.5) / 2, z);
    const uv = g.attributes.uv, nrm = g.attributes.normal, cnt = uv.count;
    const col = new Float32Array(cnt * 3); cc.set(PALETTE[(rand() * PALETTE.length) | 0]);
    for (let i = 0; i < cnt; i++) {
      const face = Math.floor(i / 4);
      if (face === 2 || face === 3) { uv.setXY(i, 0.01, 0.01); }                                        // roof / underside: a plain patch of wall
      else { const wd = face < 2 ? d : w; uv.setXY(i, uv.getX(i) * wd / bw + ou, uv.getY(i) * (h + 2.5) / bh + ov); }
      const v = face === 2 ? 0.72 : 1; col[i * 3] = cc.r * v; col[i * 3 + 1] = cc.g * v; col[i * 3 + 2] = cc.b * v;
    }
    void nrm;
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g); rects.push({ x, z, r: Math.hypot(w, d) / 2 });
  };
  const STEP = 34;
  for (let gx = -world.half + 24; gx < world.half - 24; gx += STEP) for (let gz = -world.half + 24; gz < world.half - 24; gz += STEP) {
    const x = gx + (rand() - 0.5) * 8, z = gz + (rand() - 0.5) * 8;
    if (Math.abs(x) < CANAL.wall + 16) continue;                                                   // the promenade along the canal stays open
    const w = 16 + rand() * 12, d = 16 + rand() * 12, rr = Math.hypot(w, d) / 2;
    const info = world.trackInfo(x, z);
    if (info.index >= 0 && info.dist < rr + 15) continue;
    if (!free(x, z, rr + 13) || keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + rr + 4) ** 2)) continue;
    const pb = T.some((s) => s.noKerbR && (s.x - x) ** 2 + (s.z - z) ** 2 < 55 * 55);                 // keep the pit area clear
    if (pb) continue;
    const r = Math.hypot(x, z), park = fbm(x * 0.012 + 40, z * 0.012 - 7, 2) > 0.2;
    if (park && rand() < 0.8) continue;
    const h = 9 + rand() * 9 + (r > 200 ? rand() * 42 * Math.min(1, (r - 200) / 200) : 0) + (rand() < 0.07 ? 30 : 0);
    addBuilding(x, z, w, d, h);
  }
  if (parts.length) { const mesh = new THREE.Mesh(mergeGeometries(parts, false), cityMat); mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh); }
  view.updaters?.push(() => { cityMat.emissiveIntensity = 0.02 + 0.6 * lighting.dark; });

  // ================================================================= street lamps round the lap (they glow at night; the nearest ones really light the road)
  {
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c0, emissiveIntensity: 0.15 });
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const pg = pc.getContext('2d'), gr = pg.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,240,200,0.85)'); gr.addColorStop(0.45, 'rgba(255,230,170,0.35)'); gr.addColorStop(1, 'rgba(255,220,150,0)');
    pg.fillStyle = gr; pg.fillRect(0, 0, 128, 128);
    const poolTex = new THREE.CanvasTexture(pc); poolTex.colorSpace = THREE.SRGBColorSpace;
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pools = [], masts = [];
    const mk = (f, side, d, w, ph, bars = 1) => {
      const here = frame(d), face = Math.atan2(-side * f.t.rx, -side * f.t.rz);
      box(0.18, ph, 0.18, mat.iron, f.x, f.y, f.z);
      box(0.12, 0.12, 2.2, mat.iron, f.x - side * f.t.rx * 1.0, f.y + ph, f.z - side * f.t.rz * 1.0, face);
      const bx = f.x - side * f.t.rx * 2.0, bz = f.z - side * f.t.rz * 2.0;
      for (let k = 0; k < bars; k++) {
        const along = (k - (bars - 1) / 2) * 1.1;
        const bar = new THREE.Mesh(BOX, lampMat); bar.scale.set(0.5, 0.14, 0.9); bar.position.set(bx + f.t.tx * along, f.y + ph - 0.05, bz + f.t.tz * along); bar.rotation.y = face; group.add(bar);
      }
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), poolMat), pc2 = frame(d, side * (w * 0.1));
      pool.position.set(pc2.x, here.y + 0.06, pc2.z); pool.rotation.x = -Math.PI / 2; pool.renderOrder = 4; group.add(pool); pools.push(pool);
      masts.push({ x: bx, y: f.y + ph - 0.15, z: bz, tx: pc2.x, ty: here.y, tz: pc2.z });
    };
    let alt = 1;
    for (let d = 6; d < L; d += 36) {
      alt = -alt;
      let side = alt; if (side > 0 && (d > PIT.from - 4 || d < PIT.to + 4)) side = -1;
      const f = frame(d, side * (hw(d) + 3.2));
      const onBridge = Math.abs(f.x) < CANAL.wall + 3 && Math.abs(f.z - B.z) < 16, inGap = Math.abs(f.x) < CANAL.wall + 6 && Math.abs(f.z - G.z) < 16;
      if (onBridge || inGap || !free(f.x, f.z, 1.6) || keepOut.some((k) => (k.x - f.x) ** 2 + (k.z - f.z) ** 2 < (k.r + 0.5) ** 2)) continue;
      if (side < 0 && d > PIT.from + 8 && d < 118) continue;                            // the stand has its own floodlights
      if (side > 0 && (d > PIT.from - 4 || d < PIT.to + 4)) continue;                      // so do the pits
      mk(f, side, d, hw(d), 8.2);
    }
    // floodlights on the main stand: a row of towers at the back of the seating, each with a bank of three lamps
    for (let d = PIT.from + 18; span(PIT.from, d) < span(PIT.from, 105); d += 24) {
      const f = frame(d, -(hw(d) + 5.5 + 7 * 0.9 + 2.2));
      if (!free(f.x, f.z, 1.6)) continue;
      mk(f, -1, d, hw(d), 14.5, 3);
    }
    // floodlights over the pit lane, hung from posts at the front of the garages, lighting the lane and the pit wall
    for (let d = PIT.from + 6; span(PIT.from, d) < span(PIT.from, PIT.to - 4); d += 24) {
      const f = frame(d, hw(d) + 9.2);
      if (!free(f.x, f.z, 1.2)) continue;
      mk(f, 1, d, hw(d) + 8, 9.2, 2);
    }
    const K = Math.min(6, masts.length), spots = [];
    for (let k = 0; k < K; k++) {
      const sp = new THREE.SpotLight(0xfff0d0, 0, 190, 1.2, 0.9, 2);
      sp.castShadow = k < 3; sp.shadow.mapSize.set(1024, 1024); sp.shadow.camera.near = 3; sp.shadow.camera.far = 190;
      sp.shadow.bias = -0.0004; sp.shadow.normalBias = 0.04; sp.shadow.radius = 3;
      scene.add(sp, sp.target); spots.push({ sp, mast: -1 });
    }
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    view.updaters?.push((camera) => {
      const dk = lighting.dark;
      lampMat.emissiveIntensity = 0.15 + 3.5 * dk; poolMat.opacity = 0.2 * dk;
      for (const p of pools) p.visible = dk > 0.02;
      const near = masts.map((m, i) => ({ i, d: Math.hypot(m.x - camera.position.x, m.z - camera.position.z) })).sort((a, b) => a.d - b.d).slice(0, K).map((o) => o.i);
      spots.forEach((s, i) => { s.mast = i < near.length ? near[i] : -1; });
      for (const s of spots) {
        const m = masts[s.mast]; s.sp.visible = true;
        if (!m || dk < 0.02) { s.sp.intensity = 0; s.sp.shadow.autoUpdate = false; continue; }
        s.sp.position.set(m.x, m.y, m.z); s.sp.target.position.set(m.tx, m.ty, m.tz); s.sp.target.updateMatrixWorld();
        const dist = Math.hypot(m.x - camera.position.x, m.z - camera.position.z);
        s.sp.intensity = 1700 * dk * sm(160, 75, dist); s.sp.shadow.autoUpdate = true;
      }
    });
  }

  // ================================================================= trees: avenues on the quays, groves in the parks
  const trees = [];
  for (const sd of [-1, 1]) for (let z = -world.half + 20; z < world.half - 20; z += 15) {
    const x = CANAL.x + sd * (CANAL.wall + 4.2); if (nearCrossing(z, 24)) continue; trees.push({ x, z: z + (rand() - 0.5) * 3 });
  }
  const tooClose = (x, z, r) => { const info = world.trackInfo(x, z); return info.index >= 0 && info.dist < r; };
  for (let tries = 0; tries < 30000 && trees.length < 420; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 20), z = (rand() * 2 - 1) * (world.half - 20);
    if (world.surfaceAt(x, z) !== SURF.Grass || Math.abs(x) < CANAL.wall + 2.5) continue;
    if (tooClose(x, z, 9) || keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 3) ** 2) || rects.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + 3) ** 2)) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 25)) continue;
    trees.push({ x, z });
  }
  const treeOK = trees.filter((t) => free(t.x, t.z, 4) && !rects.some((b) => (b.x - t.x) ** 2 + (b.z - t.z) ** 2 < (b.r + 2) ** 2));
  const geos = [broadleafTree(5, { h: 9, crown: 4 }), birchTree(9, { h: 8.5 }), pineTree(4, { h: 11 }), broadleafTree(12, { h: 8, crown: 3.4, leaf: 0x6a9a3a })];
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  geos.forEach((g, v) => {
    const mine = treeOK.filter((_, k) => k % geos.length === v), im = new THREE.InstancedMesh(g, treeMat, Math.max(1, mine.length));
    mine.forEach((t, k) => { q.setFromAxisAngle(up, rand() * 6.28); const s = 0.85 + rand() * 0.4; pos.set(t.x, world.heightAtGrid(t.x, t.z) - 0.2, t.z); sc.set(s, s, s); m4.compose(pos, q, sc); im.setMatrixAt(k, m4); });
    im.count = mine.length; im.castShadow = true; group.add(im);
  });
}
