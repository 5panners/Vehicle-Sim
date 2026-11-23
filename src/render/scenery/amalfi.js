import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../../world/noise.js';
import { SURF } from '../../world/Surfaces.js';
import { lighting } from '../lighting.js';
import { Workshops } from './workshop.js';
import { garageFacade, seatTexture, bannerTexture } from './lowpoly.js';
import { SEA, TUNNEL } from '../../world/maps/amalfi.js';

/**
 * Costiera Amalfitana surroundings: the Tyrrhenian Sea with a surf line, boats and a pier; pastel hillside villages stacked up
 * the slopes (terracotta roofs, shuttered windows with whole windows only, stone terraces); a maiolica-domed church with a bell
 * tower; cypress, umbrella pines, lemon terraces; pits, stand, garages and floodlights on the terrace straight.
 */
export function buildAmalfiScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const PIT = map.pit, C = map.corners;
  const rand = rng(1717);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const keepOut = [];
  const roadDist = (x, z) => { const info = world.trackInfo(x, z); return info.index >= 0 ? info.dist : 1e9; };
  const free = (x, z, r) => !T.some((s, i) => i % 2 === 0 && (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = { concrete: lam(0xd8d3c8, { map: view.detail }), white: lam(0xf5f3ee), grey: lam(0x8d9196), dark: lam(0x2c2f33), orange: lam(0xff7a1a), red: lam(0xc62828), roof: lam(0xe9ecef),
    iron: lam(0x2d3a45), steel: new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.75, roughness: 0.35 }), glass: new THREE.MeshStandardMaterial({ color: 0x2b4258, metalness: 0.6, roughness: 0.12 }) };
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
  const cvs = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };

  // ================================================================= road markings
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 + 2.2, t.w / 2 + 6.2];
  const i0 = idx(PIT.from), i1 = idx(PIT.to), to = i1 + (i1 < i0 ? M : 0);
  view._ribbon({ offA: (t) => band(t)[1] - 0.2, offB: (t) => band(t)[1], yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => band(t)[0], offB: (t) => band(t)[0] + 0.2, yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => t.w / 2 - 0.18, offB: (t) => t.w / 2 - 0.02, yOff: 0.02, mat: lineMat, step: 1, filter: (t) => !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.18), yOff: 0.02, mat: lineMat, step: 1 });

  // ================================================================= the sea
  const waterTex = cvs(256, 256, (g, w, h) => {
    g.fillStyle = '#1f8fb0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(${i % 4 ? 170 : 255},${i % 4 ? 225 : 255},255,${0.04 + rand() * 0.12})`; g.lineWidth = 1 + rand() * 2.4; const x = rand() * w, y = rand() * h; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y + 3, x + 34, y); g.stroke(); }
  });
  waterTex.repeat.set(world.size / 40, world.size / 40);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(world.size, world.size), new THREE.MeshStandardMaterial({ map: waterTex, color: 0xcfeaf2, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.88 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, SEA.level, 0); sea.receiveShadow = true; group.add(sea);
  view.updaters?.push(() => { const t = performance.now(); waterTex.offset.set((t * 0.000012) % 1, (t * 0.00002) % 1); });
  // surf: a white wash along the foot of the cliffs (found by scanning the ground for the waterline)
  {
    const pts = [];
    for (let x = -world.half + 10; x < world.half - 10; x += 8) {
      let zs = null; for (let z = world.half - 12; z > -world.half + 12; z -= 2) { if (world.heightAtGrid(x, z) > 0.15) { zs = z; break; } }
      if (zs !== null) pts.push([x, zs]);
    }
    const pos = [], idxs = [];
    pts.forEach(([x, z], i) => { pos.push(x, 0.06, z - 0.5, x, 0.06, z + 3.2); if (i) { const a = (i - 1) * 2; idxs.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idxs);
    const foam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    foam.renderOrder = 2; group.add(foam);
    view.updaters?.push(() => { foam.material.opacity = 0.42 + 0.2 * Math.sin(performance.now() * 0.0011); });
  }

  // ================================================================= pit lane, garages and race control (the terrace straight)
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
      [x, z] = at(depth / 2 - 0.1, 0); box(0.3, 0.45, len - 0.4, mat.orange, x, base + 3.0, z, f.yaw);
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
  // stand opposite the pits, backed by the hillside
  const seat = new THREE.MeshLambertMaterial({ map: seatTexture('#e07a1f'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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
      const r2 = box(rows * 0.9 + 1.6, 0.25, sp - 0.3, mat.orange, roof.x, rH, roof.z, f.yaw); r2.rotation.z = side * 0.06;
      for (const u of [-0.5, 0.5]) { const p = frame(d + u * sp, side * (lat0 + rows * 0.9)); box(0.25, rH - base, 0.25, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * 0.9 + 1, sp, f.yaw, rH - base);
    }
  };
  stand(PIT.from + 14, 110, -1, hw(0) + 5.5, 7, 5);
  const c1 = C['Turn 1'] ?? 200;
  stand(c1 - 22, c1 + 26, map.outside(world, c1), hw(c1) + 7, 5, 2);

  // ================================================================= sponsor boards (fictional), marshal posts, brake boards
  const WORDS = [['LIMONCELLO', '#f2c200', '#222'], ['AMALFI ENERGY', '#0b5a8a', '#fff'], ['POSITANO TYRES', '#111', '#ffc400'], ['CAPRI MOTORS', '#c62828', '#fff'], ['SORRENTO CAFFE', '#6d3b1c', '#fff'], ['TIRRENO BANK', '#0b3d7a', '#fff']];
  const ads = WORDS.map(([t, bg, fg]) => { const x = bannerTexture(t, { bg, fg, w: 512, h: 96 }); x.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: x }); });
  let ak = 0;
  for (let d = 4; d < L; d += 17) {
    const side = Math.floor(d / 130) % 2 ? 1 : -1, off = hw(d) + 3.9;
    if (side > 0 && (d > PIT.from - 15 || d < PIT.to + 15)) continue;
    const f = frame(d, side * off);
    if (!free(f.x, f.z, 2.2)) continue;
    if (map.seaward(f.x, f.z) > -18) continue;
    const info = world.trackInfo(f.x, f.z);
    if (info.index >= 0 && Math.min(Math.abs(info.index - idx(d)), M - Math.abs(info.index - idx(d))) > 30 && info.dist < 9) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.9), ads[ak++ % ads.length]);
    m.position.set(f.x, f.y + 1.5, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
  }
  for (const key of Object.keys(C)) {
    const dd = C[key], out = map.outside(world, dd), f = frame(dd + 6, out * (hw(dd) + 5.6));
    if (!free(f.x, f.z, 2.5)) continue;
    box(1.4, 2.4, 1.4, mat.orange, f.x, f.y - 0.1, f.z, f.yaw); box(1.7, 0.2, 1.7, mat.dark, f.x, f.y + 2.3, f.z, f.yaw);
  }
  for (const key of Object.keys(C)) {
    const out = map.outside(world, C[key]);
    for (const m of [100, 50]) {
      const f = frame(C[key] - m - 6, -out * (hw(C[key]) + 2.6));
      if (!free(f.x, f.z, 1.4)) continue;
      const tex = bannerTexture(String(m), { bg: '#f1f1ec', fg: '#111', w: 128, h: 96 }); tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshLambertMaterial({ map: tex })); pm.position.set(f.x, f.y + 2.1, f.z); pm.rotation.y = Math.atan2(out * f.t.rx, out * f.t.rz); group.add(pm);
      box(0.08, 2.1, 0.08, mat.steel, f.x, f.y, f.z, f.yaw);
    }
  }

  // ================================================================= the viaduct (the lap crosses over its own climb) and the headland tunnel
  {
    const X = map._X, deck = map._deck;
    keepOut.push({ x: X.x, z: X.z, r: 64 });
    const stone = lam(0xd6c9a8, { map: view.detail }), stoneD = lam(0xa99b7d, { map: view.detail });
    for (let k = 0; k + 1 < deck.length; k += 2) {
      const a = deck[k], b = deck[k + 1], len = Math.hypot(b.x - a.x, b.z - a.z) + 0.2, yaw = Math.atan2(a.tx, a.tz), cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, y = (a.y + b.y) / 2;
      box(a.w + 2.6, 1.15, len, stone, cx, y - 1.2, cz, yaw);
      for (const sd of [-1, 1]) {
        const px = cx + a.rx * sd * (a.w / 2 + 0.45), pz = cz + a.rz * sd * (a.w / 2 + 0.45);
        box(0.6, 1.1, len, stone, px, y, pz, yaw); box(0.9, 0.18, len, stoneD, px, y + 1.1, pz, yaw);
      }
    }
    // arched piers under the deck either side of the cutting, and abutments where the viaduct meets the hillside
    for (const k of [-15, 15]) {
      const s = deck[X.span + k];
      for (const sd of [-1, 1]) {
        const px = s.x + s.rx * sd * (s.w / 2 + 0.6), pz = s.z + s.rz * sd * (s.w / 2 + 0.6), g = world.heightAtGrid(px, pz);
        box(2.2, Math.max(1, s.y - 1.2 - g + 0.8), 2.6, stone, px, g - 0.8, pz, Math.atan2(s.tx, s.tz));
      }
    }
    for (const k of [-X.span, X.span]) {
      const s = deck[X.span + k], g = world.heightAtGrid(s.x, s.z);
      box(s.w + 3.2, Math.max(1.2, s.y - 1.2 - g + 1.2), 2.4, stoneD, s.x, g - 1.2, s.z, Math.atan2(s.tx, s.tz) + Math.PI / 2 * 0);
    }
    const ft = bannerTexture('VIADOTTO', { bg: '#e8e2cf', fg: '#5a4a32', w: 256, h: 64 }); ft.colorSpace = THREE.SRGBColorSpace;
    for (const k of [-30, 30]) { const s = deck[X.span + (k < 0 ? -X.span : X.span)], d2 = (k < 0 ? -1 : 1);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshLambertMaterial({ map: ft })); sg.position.set(s.x + s.rx * (s.w / 2 + 2.2), s.y + 2.2, s.z + s.rz * (s.w / 2 + 2.2)); sg.rotation.y = Math.atan2(-d2 * s.tx, -d2 * s.tz); group.add(sg); box(0.1, 2.2, 0.1, mat.steel, sg.position.x, s.y, sg.position.z); }
  }
  {
    const idxs = []; for (let i = 0; i < M; i += 1) { const s = T[i]; if (s.x >= TUNNEL.x0 && s.x <= TUNNEL.x1 && Math.abs(s.z - TUNNEL.z) < 25) idxs.push(i); }
    idxs.sort((a, b) => T[a].x - T[b].x);
    if (idxs.length > 3) {
      const Rt = 7.2, SEG = 14, pos = [], ind = [];
      idxs.forEach((i, k) => {
        const s = T[i];
        for (let a = 0; a <= SEG; a++) { const th = Math.PI * a / SEG; pos.push(s.x + s.rx * Math.cos(th) * Rt, s.y + Math.sin(th) * Rt * 0.85, s.z + s.rz * Math.cos(th) * Rt); }
        if (k > 0) for (let a = 0; a < SEG; a++) { const p = (k - 1) * (SEG + 1) + a, c = k * (SEG + 1) + a; ind.push(p, p + 1, c, p + 1, c + 1, c); }
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind); g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb9ae96, side: THREE.DoubleSide })));
      const a = T[idxs[0]], b = T[idxs[idxs.length - 1]], rockMat = new THREE.MeshLambertMaterial({ color: 0x8c7f68, side: THREE.DoubleSide });
      for (const [s, dir] of [[a, -1], [b, 1]]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(Rt - 0.1, Rt + 3.2, 20, 1, 0, Math.PI), rockMat);
        ring.position.set(s.x + s.tx * dir * 0.4, s.y, s.z + s.tz * dir * 0.4); ring.rotation.y = Math.atan2(s.tx, s.tz); group.add(ring);
        box(1.6, 1.0, Rt * 2 + 6.6, lam(0xd6c9a8), s.x + s.tx * dir * 0.4, s.y + Rt * 0.85 + 3.0, s.z + s.tz * dir * 0.4, Math.atan2(s.tx, s.tz) + Math.PI / 2);
      }
      const lampM = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe2a8, emissiveIntensity: 0.6 });
      for (let k = 1; k < idxs.length - 1; k += 4) { const s = T[idxs[k]]; box(0.5, 0.12, 2.2, lampM, s.x, s.y + Rt * 0.85 - 0.3, s.z, Math.atan2(s.tx, s.tz)); }
      view.updaters?.push(() => { lampM.emissiveIntensity = 0.7 + 3.0 * lighting.dark; });
      keepOut.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: 70 });
    }
  }

  // ================================================================= the villages: pastel houses stacked up the hillsides
  // one tile = one window bay (3.2 m) of one floor (3.1 m); whole windows only, because the bay and floor counts are integers
  const BAY = 3.2, FLOOR = 3.1;
  const facadeTex = (shutter) => cvs(128, 128, (g) => {
    g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(150,130,100,${0.03 + rand() * 0.04})`; g.fillRect(rand() * 128, rand() * 128, 2 + rand() * 6, 1 + rand() * 3); }
    const x = 44, y = 26, w = 40, h = 66;
    g.fillStyle = '#2a3b4c'; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + 14); g.quadraticCurveTo(x + w / 2, y - 8, x + w, y + 14); g.lineTo(x + w, y + h); g.fill();   // arched opening
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 4, y + 16, 12, 22);
    g.fillStyle = '#efe6d2'; g.fillRect(x - 4, y + h, w + 8, 5);                                                                                  // sill
    if (shutter) { g.fillStyle = shutter; g.fillRect(x - 17, y + 8, 14, h - 6); g.fillRect(x + w + 3, y + 8, 14, h - 6); g.fillStyle = 'rgba(0,0,0,0.18)'; for (let yy = y + 12; yy < y + h; yy += 5) { g.fillRect(x - 17, yy, 14, 1); g.fillRect(x + w + 3, yy, 14, 1); } }
    g.fillStyle = 'rgba(120,100,80,0.35)'; g.fillRect(0, 124, 128, 4);
  });
  const SHUTTERS = [null, '#3f7d57', '#2f6aa5', '#7a4b2d', '#e9d8a6'];
  const wallBuf = SHUTTERS.map(() => ({ p: [], u: [], c: [], i: [] }));
  const plain = { p: [], c: [], i: [] };
  const PASTEL = [[1, 0.93, 0.78], [0.98, 0.78, 0.55], [0.99, 0.72, 0.62], [0.95, 0.85, 0.5], [0.97, 0.62, 0.55], [0.82, 0.9, 0.78], [0.74, 0.86, 0.92], [1, 0.97, 0.9], [0.93, 0.7, 0.72], [0.98, 0.86, 0.66]];
  const ROOFC = [[0.74, 0.32, 0.2], [0.7, 0.28, 0.18], [0.8, 0.4, 0.26], [0.66, 0.3, 0.2]];
  const quadTo = (buf, a, b, c, d, col, uvs) => {
    const k = buf.p.length / 3; buf.p.push(...a, ...b, ...c, ...d); for (let q = 0; q < 4; q++) buf.c.push(...col);
    if (buf.u && uvs) buf.u.push(...uvs); buf.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const triTo = (buf, a, b, c, col) => { const k = buf.p.length / 3; buf.p.push(...a, ...b, ...c); for (let q = 0; q < 3; q++) buf.c.push(...col); buf.i.push(k, k + 1, k + 2); };
  const houses = [];
  const house = (cx, cz, w, d, yaw, y0, floors, variant, col, roofKind, roofCol, plinthTo) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw), H = floors * FLOOR;
    const P = (lx, lz, y) => [cx + lx * cs + lz * sn, y, cz - lx * sn + lz * cs];
    const c4 = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    const wb = wallBuf[variant];
    for (let s = 0; s < 4; s++) {
      const A = c4[s], B = c4[(s + 1) % 4], run = s % 2 ? d : w, bays = Math.max(1, Math.round(run / BAY));
      quadTo(wb, P(A[0], A[1], y0), P(B[0], B[1], y0), P(B[0], B[1], y0 + H), P(A[0], A[1], y0 + H), col, [0, 0, bays, 0, bays, floors, 0, floors]);
    }
    if (plinthTo < y0 - 0.05) {                                                                                                             // stone footing down to the ground
      const sc = [0.74, 0.68, 0.58];
      for (let s = 0; s < 4; s++) { const A = c4[s], B = c4[(s + 1) % 4]; quadTo(plain, P(A[0], A[1], plinthTo), P(B[0], B[1], plinthTo), P(B[0], B[1], y0 + 0.02), P(A[0], A[1], y0 + 0.02), sc); }
    }
    const top = y0 + H, ov = 0.35;
    if (roofKind === 'flat') {
      const rc = [0.93, 0.89, 0.8];
      quadTo(plain, P(-w / 2 - 0.15, -d / 2 - 0.15, top + 0.25), P(w / 2 + 0.15, -d / 2 - 0.15, top + 0.25), P(w / 2 + 0.15, d / 2 + 0.15, top + 0.25), P(-w / 2 - 0.15, d / 2 + 0.15, top + 0.25), rc);
      for (let s = 0; s < 4; s++) { const A = c4[s], B = c4[(s + 1) % 4]; quadTo(plain, P(A[0], A[1], top), P(B[0], B[1], top), P(B[0], B[1], top + 0.25), P(A[0], A[1], top + 0.25), rc); }
    } else {
      const alongX = w >= d, rh = Math.min(w, d) * 0.3;
      const hx = w / 2 + ov, hz = d / 2 + ov;
      if (alongX) {
        quadTo(plain, P(-hx, -hz, top), P(hx, -hz, top), P(hx, 0, top + rh), P(-hx, 0, top + rh), roofCol);
        quadTo(plain, P(hx, hz, top), P(-hx, hz, top), P(-hx, 0, top + rh), P(hx, 0, top + rh), roofCol);
        triTo(wb, P(-w / 2, -d / 2, top), P(-w / 2, d / 2, top), P(-w / 2, 0, top + rh * 0.92), col); triTo(wb, P(w / 2, d / 2, top), P(w / 2, -d / 2, top), P(w / 2, 0, top + rh * 0.92), col);
      } else {
        quadTo(plain, P(-hx, hz, top), P(-hx, -hz, top), P(0, -hz, top + rh), P(0, hz, top + rh), roofCol);
        quadTo(plain, P(hx, -hz, top), P(hx, hz, top), P(0, hz, top + rh), P(0, -hz, top + rh), roofCol);
        triTo(wb, P(-w / 2, -d / 2, top), P(w / 2, -d / 2, top), P(0, -d / 2, top + rh * 0.92), col); triTo(wb, P(w / 2, d / 2, top), P(-w / 2, d / 2, top), P(0, d / 2, top + rh * 0.92), col);
      }
      // wall triangles carry u,v too (outside the window tile): give them a plain wall patch
      const last = wb.p.length / 3; while (wb.u.length / 2 < last) wb.u.push(0.02, 0.02);
    }
  };
  const slopeAt = (x, z) => { const g = 5; return Math.hypot(world.heightAtGrid(x + g, z) - world.heightAtGrid(x - g, z), world.heightAtGrid(x, z + g) - world.heightAtGrid(x, z - g)) / (2 * g); };
  const S = map.trackPoints[0] ? 1.035 : 1;
  const VILLAGES = [[0, 110, 150], [-190, 150, 100], [210, -100, 110], [-30, -20, 70], [440, 80, 150], [-440, 40, 140], [-60, -340, 160], [230, -330, 150], [420, -170, 120], [-430, -200, 120]].map(([x, z, r]) => [x * S, z * S, r]);
  const dens = (x, z) => { let s = 0; for (const [vx, vz, r] of VILLAGES) s += Math.exp(-(((x - vx) ** 2 + (z - vz) ** 2) / (r * r))); return s; };
  const placed = [];
  const church = { x: -18 * S, z: 150 * S };
  const fits = (x, z, r) => placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > (p.r + r) ** 2);
  for (let tries = 0; tries < 60000 && placed.length < 430; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 40), z = (rand() * 2 - 1) * (world.half - 40);
    if (rand() > dens(x, z) * 0.5) continue;
    const gh = world.heightAtGrid(x, z); if (gh < 3.2 || gh > 150) continue;
    if (map.seaward(x, z) > -26) continue;
    const sl = slopeAt(x, z); if (sl > 0.75) continue;
    const w = 6.4 + Math.round(rand() * 3) * 1.6, d = 5.5 + Math.round(rand() * 3) * 1.6, r = Math.hypot(w, d) / 2 + 3.6;
    if (roadDist(x, z) < 14 + r || !fits(x, z, r) || keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + r) ** 2)) continue;
    if (Math.hypot(x - church.x, z - church.z) < 30) continue;
    // the contour direction: the house faces downhill
    const gx = world.heightAtGrid(x + 5, z) - world.heightAtGrid(x - 5, z), gz = world.heightAtGrid(x, z + 5) - world.heightAtGrid(x, z - 5);
    const yaw = sl > 0.08 ? Math.atan2(-gx, -gz) + (rand() - 0.5) * 0.35 : rand() * 6.28;
    // pad height: the highest of the corners, so no window is ever buried; a stone footing runs down to the lowest
    const cs = Math.cos(yaw), sn = Math.sin(yaw); let hi = -1e9, lo = 1e9;
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) { const hh = world.heightAtGrid(x + lx * cs + lz * sn, z - lx * sn + lz * cs); hi = Math.max(hi, hh); lo = Math.min(lo, hh); }
    if (hi - lo > 4.6) continue;
    const floors = 2 + Math.floor(rand() * 2) + (sl > 0.35 && rand() < 0.5 ? 1 : 0);
    const col = PASTEL[Math.floor(rand() * PASTEL.length)];
    const jit = (c) => c.map((v) => Math.min(1, v * (0.95 + rand() * 0.08)));
    house(x, z, w, d, yaw, hi, Math.min(5, floors), Math.floor(rand() * SHUTTERS.length), jit(col), rand() < 0.28 ? 'flat' : 'pitched', ROOFC[Math.floor(rand() * ROOFC.length)], lo - 0.4);
    placed.push({ x, z, r });
  }
  const mkMesh = (buf, uv, map2) => {
    if (!buf.p.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.u, 2)); g.setIndex(buf.i); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: map2 || null, side: THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  };
  wallBuf.forEach((b, i) => mkMesh(b, true, facadeTex(SHUTTERS[i])));
  mkMesh(plain, false, null);

  // ================================================================= the church: maiolica dome, bell tower
  {
    const x = church.x, z = church.z; let y = world.heightAtGrid(x, z);
    for (let k = 0; k < 12; k++) y = Math.max(y, world.heightAtGrid(x + Math.cos(k / 12 * 6.283) * 12, z + Math.sin(k / 12 * 6.283) * 12));
    const base = y, cream = lam(0xf3e6c4), tile = new THREE.MeshLambertMaterial({ map: cvs(128, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e3c73b' : '#2f8a5d'; g.fillRect(0, i * 8, w, 8); } g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; for (let xx = -h; xx < w + h; xx += 16) { g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx + h, h); g.stroke(); } }) });
    tile.map.repeat.set(4, 1);
    box(22, 2.5, 30, mat.concrete, x, base - 2.5, z, 0.25);                                          // the terrace
    box(12, 11, 20, cream, x, base, z, 0.25);                                                        // nave
    const r = box(13, 0.3, 21, lam(0xb5532f), x, base + 11, z, 0.25); r.scale.y = 0.4;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), tile); dome.position.set(x + Math.sin(0.25) * -2, base + 11.2, z + Math.cos(0.25) * -2); group.add(dome);
    const lant = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 2.4, 10), cream); lant.position.copy(dome.position).add(new THREE.Vector3(0, 5.5, 0)); group.add(lant);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 10), tile); cap.position.copy(lant.position).add(new THREE.Vector3(0, 2.2, 0)); group.add(cap);
    const tx = x + Math.cos(0.25) * 9 + Math.sin(0.25) * 6, tz = z - Math.sin(0.25) * 9 + Math.cos(0.25) * 6;
    box(5, 24, 5, cream, tx, base - 1, tz, 0.25);
    for (const [dx, dz] of [[2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]]) box(dx ? 0.2 : 2, 3, dz ? 0.2 : 2, mat.dark, tx + dx, base + 18, tz + dz, 0.25);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.6, 6, 4), tile); spire.position.set(tx, base + 23.5, tz); spire.rotation.y = Math.PI / 4 + 0.25; group.add(spire);
    keepOut.push({ x, z, r: 24 }); placed.push({ x, z, r: 24 });
  }

  // ================================================================= pier, moored and passing boats
  const boats = [];
  {
    const px = 140 * S, pz = map.seaward(px, 0) * 0 + (() => { let z = 200 * S; while (world.heightAtGrid(px, z) > 0.4 && z < world.half) z += 1; return z; })();
    const pierMat = lam(0xb9a98c);
    box(5, 0.5, 70, pierMat, px, 1.4, pz - 4, 0);
    for (let k = 0; k < 14; k++) for (const sx of [-2.2, 2.2]) box(0.4, 3.4, 0.4, mat.dark, px + sx, -2, pz - 4 + k * 5);
    const hull = (col, len, wd, x, z, yaw, sail) => {
      const grp = new THREE.Group();
      const h = new THREE.Mesh(BOX, lam(col)); h.scale.set(wd, 0.9, len); grp.add(h);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(wd / 2 * 1.02, len * 0.28, 4), lam(col)); bow.rotation.set(Math.PI / 2, Math.PI / 4, 0); bow.scale.set(1, 1, 0.55); bow.position.set(0, 0.45, len / 2 + len * 0.12); grp.add(bow);
      const cab = new THREE.Mesh(BOX, lam(0xf6f6f2)); cab.scale.set(wd * 0.7, 0.9, len * 0.3); cab.position.set(0, 0.9, -len * 0.08); grp.add(cab);
      if (sail) { const mast = new THREE.Mesh(BOX, lam(0xcfd3d6)); mast.scale.set(0.1, len * 1.1, 0.1); mast.position.set(0, 0.9, len * 0.1); grp.add(mast);
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, len * 0.08, 0, len * 1.0, len * 0.08, 0, 1.2, -len * 0.42], 3)); sg.computeVertexNormals(); grp.add(new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }))); }
      grp.position.set(x, SEA.level + 0.2, z); grp.rotation.y = yaw; grp.castShadow = true; group.add(grp); boats.push({ grp, ph: rand() * 6, y: SEA.level + 0.2 }); return grp;
    };
    const cols = [0xf4f4f0, 0x1d4f91, 0xc62828, 0xf2b705, 0xf4f4f0, 0x2f8a5d];
    for (let k = 0; k < 7; k++) hull(cols[k % cols.length], 5 + rand() * 3, 1.9 + rand() * 0.6, px + (k % 2 ? 6 : -6.5), pz + k * 6 - 12, Math.PI / 2 * 0 + (rand() - 0.5) * 0.1, k % 3 === 2);
    for (let k = 0; k < 14; k++) { const bx = (rand() * 2 - 1) * 520, bz = 330 + rand() * 330; if (world.heightAtGrid(bx, bz) < -2) hull(cols[k % cols.length], 6 + rand() * 6, 2.2 + rand() * 0.8, bx, bz, rand() * 6.28, k % 2 === 0); }
    view.updaters?.push(() => { const t = performance.now() * 0.001; for (const b of boats) { b.grp.position.y = b.y + Math.sin(t * 0.9 + b.ph) * 0.12; b.grp.rotation.z = Math.sin(t * 0.7 + b.ph) * 0.03; } });
  }

  // ================================================================= lamps and floodlights (they glow at night)
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
    for (let d = 6; d < L; d += 38) {
      alt = -alt;
      let side = alt; if (side > 0 && (d > PIT.from - 4 || d < PIT.to + 4)) side = -1;
      const f = frame(d, side * (hw(d) + 3.2));
      if (!free(f.x, f.z, 1.6) || keepOut.some((k) => (k.x - f.x) ** 2 + (k.z - f.z) ** 2 < (k.r + 0.5) ** 2)) continue;
      if (side < 0 && d > PIT.from + 8 && d < 118) continue;
      if (side > 0 && (d > PIT.from - 4 || d < PIT.to + 4)) continue;
      mk(f, side, d, hw(d), 8.2);
    }
    for (let d = PIT.from + 18; span(PIT.from, d) < span(PIT.from, 105); d += 24) { const f = frame(d, -(hw(d) + 5.5 + 7 * 0.9 + 2.2)); if (free(f.x, f.z, 1.6)) mk(f, -1, d, hw(d), 14.5, 3); }
    for (let d = PIT.from + 6; span(PIT.from, d) < span(PIT.from, PIT.to - 4); d += 24) { const f = frame(d, hw(d) + 9.2); if (free(f.x, f.z, 1.2)) mk(f, 1, d, hw(d) + 8, 9.2, 2); }
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

  // ================================================================= cypress, umbrella pines, lemon and olive terraces, boulders
  const colored = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const place = (geo, x, y, z, sx, sy, sz) => { geo.scale(sx, sy, sz); geo.translate(x, y, z); return geo; };
  const cypress = mergeGeometries([colored(place(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 5), 0, 0.6, 0, 1, 1, 1), 0x5a4332), colored(place(new THREE.ConeGeometry(1, 1, 7), 0, 4.2, 0, 1.15, 7.2, 1.15), 0x2a4a2c), colored(place(new THREE.ConeGeometry(0.7, 1, 7), 0, 7.5, 0, 0.9, 4, 0.9), 0x2f5431)].map((g) => g.toNonIndexed()));
  const pineG = mergeGeometries([colored(place(new THREE.CylinderGeometry(0.22, 0.36, 7, 6), 0, 3.5, 0, 1, 1, 1), 0x6b4a33), colored(place(new THREE.IcosahedronGeometry(1, 1), 0, 8.4, 0, 4.6, 1.7, 4.6), 0x3d6b36), colored(place(new THREE.IcosahedronGeometry(1, 0), 1.6, 7.6, 0.6, 2.6, 1.1, 2.6), 0x44763c)].map((g) => g.toNonIndexed()));
  const lemon = mergeGeometries([colored(place(new THREE.CylinderGeometry(0.1, 0.14, 1, 5), 0, 0.5, 0, 1, 1, 1), 0x5a4332), colored(place(new THREE.IcosahedronGeometry(1, 1), 0, 1.7, 0, 1.5, 1.25, 1.5), 0x4f8a3a), colored(place(new THREE.IcosahedronGeometry(0.22, 0), 0.9, 1.5, 0.5, 1, 1, 1), 0xf3d43a), colored(place(new THREE.IcosahedronGeometry(0.22, 0), -0.7, 1.9, -0.8, 1, 1, 1), 0xf3d43a), colored(place(new THREE.IcosahedronGeometry(0.22, 0), 0.2, 1.1, 1.2, 1, 1, 1), 0xf3d43a)].map((g) => g.toNonIndexed()));
  const olive = mergeGeometries([colored(place(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 5), 0, 0.8, 0, 1, 1, 1), 0x6a5a48), colored(place(new THREE.IcosahedronGeometry(1, 1), 0, 2.4, 0, 2.2, 1.5, 2.2), 0x7f9468)].map((g) => g.toNonIndexed()));
  const rock = colored(new THREE.IcosahedronGeometry(1, 1), 0xb7ad9b);
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const scatter = (geo, count, ok, scale, sink = 0.15, tries = 60000) => {
    const pts = [];
    for (let t = 0; t < tries && pts.length < count; t++) {
      const x = (rand() * 2 - 1) * (world.half - 20), z = (rand() * 2 - 1) * (world.half - 20), h = world.heightAtGrid(x, z);
      if (h < 1.5 || !ok(x, z, h)) continue; if (roadDist(x, z) < 8) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + 1.2) ** 2) || keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
      pts.push([x, z, h]);
    }
    const im = new THREE.InstancedMesh(geo, vmat, Math.max(1, pts.length));
    pts.forEach(([x, z, h], k) => { q.setFromAxisAngle(up, rand() * 6.28); const s = scale[0] + rand() * (scale[1] - scale[0]); pos.set(x, h - sink, z); sc.set(s, s * (0.9 + rand() * 0.25), s); m4.compose(pos, q, sc); im.setMatrixAt(k, m4); });
    im.count = pts.length; im.castShadow = true; im.frustumCulled = false; group.add(im); return pts;
  };
  const nearV = (x, z) => dens(x, z);
  scatter(cypress, 900, (x, z) => (nearV(x, z) > 0.25 && rand() < 0.55) || rand() < 0.06, [0.85, 1.35]);
  scatter(pineG, 420, (x, z, h) => h > 4 && fbm(x * 0.01, z * 0.01, 2) > -0.1 && rand() < 0.6, [0.8, 1.3]);
  scatter(lemon, 1500, (x, z, h) => { const sl = slopeAt(x, z); return sl > 0.1 && sl < 0.55 && h < 90 && fbm(x * 0.02 + 3, z * 0.02, 2) > -0.25 && nearV(x, z) > 0.04; }, [0.8, 1.2]);
  scatter(olive, 800, (x, z, h) => h < 120 && fbm(x * 0.015 + 9, z * 0.015, 2) > 0 && nearV(x, z) < 0.5, [0.8, 1.3]);
  // boulders at the foot of the sea cliffs
  scatter(rock, 260, (x, z, h) => h < 3.5 && h > -1.2 && map.seaward(x, z) > 0, [0.8, 3.2], 0.5, 90000);
}
