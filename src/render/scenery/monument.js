import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../../world/noise.js';
import { SURF } from '../../world/Surfaces.js';
import { lighting } from '../lighting.js';
import { Workshops } from './workshop.js';
import { garageFacade, seatTexture, bannerTexture } from './lowpoly.js';
import { WASH } from '../../world/maps/monument.js';

/**
 * Monument Valley surroundings in a bright, rounded cartoon look: smooth cacti (saguaro, barrel, prickly pear), dry shrubs and boulders
 * on the red-rock desert, puffy clouds that drift across a vivid sky, hot-air balloons, a wooden trestle bridge over the canyon, jump
 * signage, and the pit complex (garages, tower, stand, striped team tents) on the start straight. Everything uses toon shading (a few
 * clean light steps) with saturated colours; the terrain itself is coloured in strata by the map.
 */
export function buildMonumentScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const PIT = map.pit, C = map.corners;
  const rand = rng(4242);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const keepOut = [];
  const free = (x, z, r) => !T.some((s, i) => i % 2 === 0 && (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);
  const J = map._gap, B = map._bridge;

  // ---- toon shading: four clean light steps
  const steps = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 135, 135, 135, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
  steps.minFilter = steps.magFilter = THREE.NearestFilter; steps.needsUpdate = true;
  const toon = (c, extra = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: steps, ...extra });
  const mat = { white: toon(0xfff8ee), concrete: toon(0xe8dcc8), grey: toon(0x8d9196), dark: toon(0x2d3036), red: toon(0xe0452d), roof: toon(0xfff3e0), wood: toon(0xb8743a), woodDark: toon(0x7a4a26), glass: toon(0x3d86c6), yellow: toon(0xffc107), iron: toon(0x30343b), steel: new THREE.MeshStandardMaterial({ color: 0xc4cad0, metalness: 0.7, roughness: 0.35 }) };
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
  const tex = (t) => { t.colorSpace = THREE.SRGBColorSpace; return t; };

  // ================================================================= road markings
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xfff6e8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 + 2.2, t.w / 2 + 6.2];
  const i0 = idx(PIT.from), i1 = idx(PIT.to), to = i1 + (i1 < i0 ? M : 0);
  view._ribbon({ offA: (t) => band(t)[1] - 0.2, offB: (t) => band(t)[1], yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => band(t)[0], offB: (t) => band(t)[0] + 0.2, yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => t.w / 2 - 0.18, offB: (t) => t.w / 2 - 0.02, yOff: 0.02, mat: lineMat, step: 1, filter: (t) => !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.18), yOff: 0.02, mat: lineMat, step: 1 });

  // ================================================================= sky: puffy clouds that drift
  {
    const puff = new THREE.SphereGeometry(1, 28, 18);
    const clouds = [], N = 20, PUFFS = 9;
    for (let c = 0; c < N; c++) {
      const cx = (rand() * 2 - 1) * 900, cz = (rand() * 2 - 1) * 900, cy = 170 + rand() * 150, sc = 26 + rand() * 30, parts = [];
      for (let k = 0; k < PUFFS; k++) { const a = rand() * 6.28, rr = rand() * sc * 1.1; parts.push({ x: Math.cos(a) * rr, y: rand() * sc * 0.28 + (k === 0 ? sc * 0.2 : 0), z: Math.sin(a) * rr * 0.55, s: sc * (0.42 + rand() * 0.42 - (k === 0 ? 0 : 0.0)), sq: 0.62 + rand() * 0.15 }); }
      clouds.push({ cx, cy, cz, parts, speed: 1.2 + rand() * 1.6 });
    }
    const cm = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: steps, emissive: 0xbcd0ec, emissiveIntensity: 0.55, fog: false });
    const im = new THREE.InstancedMesh(puff, cm, N * PUFFS); im.frustumCulled = false; group.add(im);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const place = (time) => {
      clouds.forEach((c, ci) => {
        const x = ((c.cx + time * c.speed + 1000) % 2000) - 1000;
        c.parts.forEach((pt, k) => { p.set(x + pt.x, c.cy + pt.y, c.cz + pt.z); s.set(pt.s, pt.s * pt.sq, pt.s * 0.8); m4.compose(p, q, s); im.setMatrixAt(ci * PUFFS + k, m4); });
      });
      im.instanceMatrix.needsUpdate = true;
    };
    place(0);
    view.updaters?.push(() => { place(performance.now() * 0.001); cm.emissiveIntensity = 0.12 + 0.43 * (1 - lighting.dark); });
  }

  // ================================================================= hot-air balloons
  {
    const stripe = (cols) => { const g = new THREE.SphereGeometry(1, 32, 22), pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); c.set(cols[Math.floor(((a + Math.PI) / (Math.PI * 2)) * cols.length * 2) % cols.length]); const y = pos.getY(i); if (y < -0.75) { const k = (y + 1) / 0.25; pos.setXYZ(i, pos.getX(i) * (0.3 + 0.7 * k), y, pos.getZ(i) * (0.3 + 0.7 * k)); } col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g; };
    const balloons = [{ x: -150, z: -120, y: 120, s: 15, cols: [0xe53935, 0xffffff, 0xffc107, 0xffffff] }, { x: 160, z: -330, y: 150, s: 17, cols: [0x1e88e5, 0xffffff, 0xe53935, 0xffffff] }, { x: 200, z: 200, y: 105, s: 13, cols: [0x43a047, 0xffeb3b, 0x43a047, 0xffffff] }];
    const bm = toon(0xffffff, { vertexColors: true }), basket = toon(0x9a6a3a);
    const list = balloons.map((b) => {
      const g = new THREE.Group(), env = new THREE.Mesh(stripe(b.cols), bm); env.scale.set(b.s, b.s * 1.15, b.s); env.position.y = b.s * 1.2; env.castShadow = true;
      const bk = new THREE.Mesh(new THREE.BoxGeometry(b.s * 0.16, b.s * 0.11, b.s * 0.16), basket); bk.position.y = -b.s * 0.1;
      g.add(env, bk);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, b.s * 0.95, 4), mat.dark); r.position.set(sx * b.s * 0.07, b.s * 0.38, sz * b.s * 0.07); g.add(r); }
      g.position.set(b.x, b.y, b.z); group.add(g); return { g, b };
    });
    view.updaters?.push(() => { const t = performance.now() * 0.001; list.forEach(({ g, b }, i) => { g.position.y = b.y + Math.sin(t * 0.4 + i * 2) * 3; g.rotation.y = t * 0.05 + i; }); });
  }

  // ================================================================= the wooden trestle bridge over the canyon
  {
    const bt = T[B.i], deck = bt.y, hwB = bt.w / 2, wB = hwB + 0.9, zc = WASH.z, len = (WASH.half + WASH.wall) * 2 + 6, x = bt.x;
    const wc = document.createElement('canvas'); wc.width = 128; wc.height = 256; { const g = wc.getContext('2d'); g.fillStyle = '#b87a3e'; g.fillRect(0, 0, 128, 256); for (let y = 0; y < 256; y += 32) { g.fillStyle = y % 64 ? '#a96b34' : '#c58a4c'; g.fillRect(0, y, 128, 30); g.fillStyle = '#6d4220'; g.fillRect(0, y + 30, 128, 2); } }
    const planks = tex(new THREE.CanvasTexture(wc)); planks.wrapS = planks.wrapT = THREE.RepeatWrapping; planks.repeat.set(1, len / 4);
    const dk = new THREE.Mesh(new THREE.BoxGeometry(wB * 2, 0.4, len), toon(0xffffff, { map: planks })); dk.position.set(x, deck - 0.25, zc); dk.receiveShadow = true; dk.castShadow = true; group.add(dk);
    for (const sd of [-1, 1]) {
      const px = x + sd * (wB - 0.1);
      box(0.22, 0.3, len, mat.woodDark, px, deck - 0.1, zc);                                                 // kerb log
      for (let z = zc - len / 2 + 1; z <= zc + len / 2 - 1; z += 3.2) { box(0.28, 1.25, 0.28, mat.wood, px, deck, z); }
      box(0.16, 0.16, len, mat.wood, px, deck + 1.0, zc); box(0.12, 0.12, len, mat.wood, px, deck + 0.55, zc);   // top and mid rail
    }
    // trestle bents: two legs each, an X brace and a cap beam, down to the canyon floor
    for (let z = zc - len / 2 + 3; z <= zc + len / 2 - 2.9; z += 7) {
      const top = deck - 0.45, bed = WASH.bed;
      for (const sd of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, top - bed, 10), mat.wood); leg.position.set(x + sd * (wB - 1.0), (top + bed) / 2, z); leg.castShadow = true; group.add(leg); }
      box(wB * 2 - 0.4, 0.4, 0.5, mat.woodDark, x, top - 0.4, z);
      for (const k of [-1, 1]) { const d = Math.hypot(wB * 2 - 2, (top - bed) * 0.5), br = new THREE.Mesh(new THREE.BoxGeometry(0.16, d, 0.16), mat.woodDark); br.position.set(x, (top + bed) / 2 + (top - bed) * 0.25, z); br.rotation.z = k * Math.atan2(wB * 2 - 2, (top - bed) * 0.5); group.add(br); }
    }
    keepOut.push({ x, z: zc, r: 22 });
  }

  // ================================================================= jump signage and the canyon lip
  {
    const lipZ = WASH.z - WASH.half, tx = J.x;
    const chev = document.createElement('canvas'); chev.width = 256; chev.height = 128;
    { const g = chev.getContext('2d'); g.fillStyle = '#ffc107'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#1b1b1b'; g.lineWidth = 26; g.lineJoin = 'miter'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(40 + k * 70, 14); g.lineTo(100 + k * 70, 64); g.lineTo(40 + k * 70, 114); g.stroke(); } }
    const chevTex = tex(new THREE.CanvasTexture(chev));
    for (const d of [-26, -13]) {                                                                                       // arrow boards on both sides of the approach
      for (const sd of [-1, 1]) {
        const x = tx + sd * (T[J.i].w / 2 + 2.6), z = lipZ + d, y = world.heightAtGrid(x, z);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: chevTex, side: THREE.DoubleSide })); m.position.set(x, y + 1.5, z); m.rotation.y = Math.PI / 2 * (sd > 0 ? 1 : -1) + Math.PI; group.add(m); box(0.12, 1.4, 0.12, mat.iron, x, y, z);
      }
    }
    const jt = tex(bannerTexture('JUMP', { bg: '#e53935', fg: '#fff', w: 256, h: 96 }));
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: jt, side: THREE.DoubleSide })); const sy = world.heightAtGrid(tx + T[J.i].w / 2 + 4, lipZ - 48);
    sg.position.set(tx + T[J.i].w / 2 + 4, sy + 3.4, lipZ - 48); sg.rotation.y = Math.PI; group.add(sg); box(0.15, 3.4, 0.15, mat.iron, tx + T[J.i].w / 2 + 4, sy, lipZ - 48);
    keepOut.push({ x: tx, z: WASH.z, r: 26 });
  }

  // ================================================================= pit complex
  const g0 = PIT.from + 8, g1 = PIT.to - 8, glat0 = hw(0) + 12, glat1 = glat0 + 6;
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
      box(depth + 0.8, 0.3, len, mat.roof, f.x, base + 3.4, f.z, f.yaw);
      [x, z] = at(depth / 2 - 0.1, 0); box(0.3, 0.45, len - 0.4, mat.red, x, base + 3.0, z, f.yaw);
      let gmax = base;
      for (const lx of [-depth / 2, 0, depth / 2]) for (const lz of [-len / 2, 0, len / 2]) { const [qx, qz] = at(lx, lz); gmax = Math.max(gmax, world.heightAtGrid(qx, qz)); }
      floorY = Math.min(0.45, Math.max(0.2, gmax - base + 0.04));
      [x, z] = at(0, 0); box(depth, floorY, len - 0.4, mat.dark, x, base, z, f.yaw);
      const [bx, bz] = at(depth / 2, 0);
      shops.add('kart', bx, base + floorY, bz, Math.atan2(-f.t.rx, -f.t.rz), [0xff6d00, 0x00b0ff, 0xffd600, 0xc62828][(k / 2 | 0) % 4]);
    } else {
      box(depth, 3.4, len - 0.4, mat.concrete, f.x, base, f.z, f.yaw);
      box(depth + 0.8, 0.3, len, mat.roof, f.x, base + 3.4, f.z, f.yaw);
      const fx = f.x - f.t.rx * (depth / 2 + 0.05), fz = f.z - f.t.rz * (depth / 2 + 0.05);
      panel(len - 0.4, 3.2, facade, fx, base, fz, Math.atan2(-f.t.rx, -f.t.rz), (len - 0.4) / 9);
    }
    solid(f.x, f.z, depth, len, f.yaw, 3.4);
  }
  shops.build(group);
  {
    const f = frame(26, glat1 + 6);
    if (free(f.x, f.z, 8)) {
      box(8, 10, 6, mat.white, f.x, f.y, f.z, f.yaw); box(8.6, 3.2, 6.6, mat.glass, f.x, f.y + 10, f.z, f.yaw); box(9, 0.5, 7.2, mat.red, f.x, f.y + 13.2, f.z, f.yaw);
      box(0.15, 5, 0.15, mat.steel, f.x, f.y + 13.7, f.z); solid(f.x, f.z, 8, 6, f.yaw, 13);
    }
  }
  // paddock: striped team tents in bold colours
  {
    const stripeTex = (c) => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 8); g.fillStyle = c; for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 8); const t = tex(new THREE.CanvasTexture(cv)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t; };
    const cols = ['#e53935', '#1e88e5', '#fb8c00', '#43a047', '#8e24aa'];
    for (let k = 0; k < 9; k++) {
      const d = PIT.from + 12 + k * 20, f = frame(d, glat1 + 12 + (k % 2) * 9);
      if (!free(f.x, f.z, 8)) continue;
      const m = toon(0xffffff, { map: stripeTex(cols[k % cols.length]) });
      box(5.5, 2.4, 6.5, mat.white, f.x, f.y, f.z, f.yaw); const roof = new THREE.Mesh(new THREE.ConeGeometry(4.9, 1.8, 4), m); roof.position.set(f.x, f.y + 3.3, f.z); roof.rotation.y = f.yaw + Math.PI / 4; roof.scale.set(1, 1, 1.15); roof.castShadow = true; group.add(roof);
      keepOut.push({ x: f.x, z: f.z, r: 8 });
    }
  }
  // stand opposite the pits
  const seat = new THREE.MeshLambertMaterial({ map: seatTexture('#f4511e'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  {
    const rows = 6, bays = 4, d0 = PIT.from + 20, d1 = d0 + bays * 20, lat0 = hw(0) + 5.5, side = -1, sp = span(d0, d1) / bays;
    for (let k = 0; k < bays; k++) {
      const d = d0 + (k + 0.5) * sp, f = frame(d, side * (lat0 + rows * 0.45)), base = frame(d, side * lat0).y - 0.2;
      if (!free(f.x, f.z, rows * 0.45 + 3.5)) continue;
      for (let r = 0; r < rows; r++) {
        const g = frame(d, side * (lat0 + (r + 0.5) * 0.9)), top = base + 0.5 + (r + 1) * 0.45;
        box(0.9, top - base, sp - 0.6, mat.concrete, g.x, base, g.z, f.yaw);
        panel(sp - 0.6, 0.45, seat, g.x - side * g.t.rx * 0.51, top - 0.45, g.z - side * g.t.rz * 0.51, Math.atan2(-side * f.t.rx, -side * f.t.rz), (sp - 0.6) / 5);
      }
      const rH = base + 0.5 + rows * 0.45 + 2.5, roof = frame(d, side * (lat0 + rows * 0.45));
      const r2 = box(rows * 0.9 + 1.6, 0.3, sp - 0.3, mat.red, roof.x, rH, roof.z, f.yaw); r2.rotation.z = side * 0.06;
      for (const u of [-0.5, 0.5]) { const p = frame(d + u * sp, side * (lat0 + rows * 0.9)); box(0.25, rH - base, 0.25, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * 0.9 + 1, sp, f.yaw, rH - base);
    }
  }
  // sponsor boards (fictional)
  const WORDS = [['DUSTY BOOT', '#8e2c12', '#ffe0a8'], ['CACTUS COLA', '#1b8a3a', '#fff'], ['MESA MOTORS', '#1565c0', '#fff'], ['SUNSET RACING', '#f4511e', '#fff'], ['RED ROCK TYRES', '#111', '#ffc107']];
  const ads = WORDS.map(([t, bg, fg]) => new THREE.MeshLambertMaterial({ map: tex(bannerTexture(t, { bg, fg, w: 512, h: 96 })) }));
  let ak = 0;
  for (let d = 6; d < L; d += 18) {
    const side = Math.floor(d / 150) % 2 ? 1 : -1, f = frame(d, side * (hw(d) + 3.9));
    if (side > 0 && (d > PIT.from - 15 || d < PIT.to + 15)) continue;
    if (!free(f.x, f.z, 2.2) || Math.abs(f.z - WASH.z) < 24) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.9), ads[ak++ % ads.length]); m.position.set(f.x, f.y + 1.35, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
  }

  // ================================================================= pit-straight lights (they glow at dusk)
  {
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c0, emissiveIntensity: 0.15 });
    const pools = [], pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const pg = pc.getContext('2d'), gr = pg.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,240,200,0.85)'); gr.addColorStop(0.45, 'rgba(255,230,170,0.35)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); pg.fillStyle = gr; pg.fillRect(0, 0, 128, 128);
    const poolMat = new THREE.MeshBasicMaterial({ map: tex(new THREE.CanvasTexture(pc)), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (let d = PIT.from + 4; span(PIT.from, d) < span(PIT.from, PIT.to - 4); d += 26) {
      const f = frame(d, hw(d) + 9.2); if (!free(f.x, f.z, 1.2)) continue;
      const face = Math.atan2(-f.t.rx, -f.t.rz);
      box(0.2, 9, 0.2, mat.iron, f.x, f.y, f.z); box(0.14, 0.14, 2.4, mat.iron, f.x - f.t.rx * 1.1, f.y + 9, f.z - f.t.rz * 1.1, face);
      for (const a of [-0.5, 0.5]) { const bar = new THREE.Mesh(BOX, lampMat); bar.scale.set(0.5, 0.14, 0.9); bar.position.set(f.x - f.t.rx * 2.2 + f.t.tx * a, f.y + 8.95, f.z - f.t.rz * 2.2 + f.t.tz * a); bar.rotation.y = face; group.add(bar); }
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), poolMat), pc2 = frame(d, hw(d) * 0.1); pool.position.set(pc2.x, pc2.y + 0.06, pc2.z); pool.rotation.x = -Math.PI / 2; pool.renderOrder = 4; group.add(pool); pools.push(pool);
    }
    view.updaters?.push(() => { const dk = lighting.dark; lampMat.emissiveIntensity = 0.15 + 3.5 * dk; poolMat.opacity = 0.35 * dk; for (const p of pools) p.visible = dk > 0.02; });
  }

  // ================================================================= cacti, shrubs and boulders (smooth, rounded, toon shaded)
  const withColor = (g, fn) => { const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(); for (let i = 0; i < pos.count; i++) { fn(c, pos.getX(i), pos.getY(i), pos.getZ(i)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
  /** an icosphere with shared vertices, so it shades smoothly once displaced */
  const ico = (detail) => { let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
  const cap = (r, h) => new THREE.CapsuleGeometry(r, h, 8, 22);
  const green = (c, y, hMax) => c.setRGB(0.1 + 0.08 * (y / hMax), 0.46 + 0.16 * (y / hMax), 0.16 + 0.04 * (y / hMax));
  const saguaro = (arms, tall) => {
    const parts = [], H = tall, trunk = cap(0.55, H); trunk.translate(0, H / 2 + 0.55, 0); parts.push(withColor(trunk, (c, x, y) => green(c, y, H + 1.2)));
    for (const [side, h0, reach, up] of arms) {
      const a = cap(0.36, reach); a.rotateZ(Math.PI / 2); a.translate(side * (reach / 2 + 0.3), h0, 0); parts.push(withColor(a, (c, x, y) => green(c, y, H)));
      const v = cap(0.34, up); v.translate(side * (reach + 0.55), h0 + up / 2 + 0.2, 0); parts.push(withColor(v, (c, x, y) => green(c, y, H)));
    }
    for (const [fx, fy, fz] of [[0.0, H + 1.05, 0.0]]) { const fl = new THREE.SphereGeometry(0.22, 12, 8); fl.translate(fx, fy, fz); parts.push(withColor(fl, (c) => c.setRGB(0.98, 0.45, 0.62))); }
    return mergeGeometries(parts);
  };
  const barrel = () => { const g = new THREE.SphereGeometry(1, 28, 20), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + 0.07 * Math.cos(a * 11); p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.95 + 0.9, p.getZ(i) * k); } g.computeVertexNormals();
    const fl = new THREE.SphereGeometry(0.28, 10, 8); fl.translate(0, 1.95, 0); const a = withColor(g, (c, x, y) => c.setRGB(0.22 + 0.06 * y, 0.52 + 0.1 * y, 0.3)), b = withColor(fl, (c) => c.setRGB(1.0, 0.76, 0.18));
    return mergeGeometries([a, b]); };
  const pear = () => { const parts = [], pads = [[0, 0.7, 0, 1.0, 0], [-0.7, 1.7, 0.1, 0.8, -0.6], [0.8, 1.6, -0.1, 0.85, 0.5], [0.2, 2.5, 0.15, 0.7, 0.1], [-0.9, 2.5, -0.1, 0.55, -0.7]];
    for (const [x, y, z, s, rot] of pads) { const g = new THREE.SphereGeometry(1, 20, 14); g.scale(0.85 * s, 1.0 * s, 0.2 * s); g.rotateZ(rot); g.translate(x, y, z); parts.push(withColor(g, (c, px, py) => c.setRGB(0.2 + 0.05 * py, 0.58 + 0.04 * py, 0.4))); }
    for (const [x, y] of [[-0.1, 3.1], [-1.1, 3.0], [0.8, 2.4]]) { const f = new THREE.SphereGeometry(0.2, 10, 8); f.translate(x, y, 0.2); parts.push(withColor(f, (c) => c.setRGB(0.9, 0.2, 0.35))); }
    return mergeGeometries(parts); };
  const shrub = () => { const parts = []; for (let k = 0; k < 5; k++) { const g = ico(2), p = g.attributes.position; g.scale(0.5 + (k % 2) * 0.2, 0.5 + (k % 2) * 0.2, 0.5 + (k % 2) * 0.2); for (let i = 0; i < p.count; i++) { const n = 1 + 0.18 * fbm(p.getX(i) * 3 + k, p.getZ(i) * 3, 2); p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.8, p.getZ(i) * n); } g.computeVertexNormals(); g.translate(Math.cos(k * 1.9) * 0.55, 0.35 + (k % 3) * 0.1, Math.sin(k * 1.9) * 0.55); parts.push(withColor(g, (c, x, y) => c.setRGB(0.62 + 0.08 * y, 0.55 + 0.1 * y, 0.22))); } return mergeGeometries(parts); };
  const boulder = (seed) => { const g = ico(4), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.32 * fbm(x * 1.6 + seed * 9, z * 1.6 + y * 1.6, 3); p.setXYZ(i, x * n, y * n * 0.78, z * n); } g.computeVertexNormals(); return withColor(g, (c, x, y) => c.setRGB(0.66 + 0.1 * y, 0.28 + 0.07 * y, 0.17 + 0.04 * y)); };
  const SPEC = [
    { geo: saguaro([[1, 3.2, 1.3, 2.4]], 6.2), n: 70, s: [0.85, 1.35], sand: true },
    { geo: saguaro([[1, 2.8, 1.2, 2.2], [-1, 4.2, 1.1, 1.7]], 7.4), n: 70, s: [0.85, 1.35], sand: true },
    { geo: saguaro([[-1, 2.2, 1.0, 1.6]], 4.6), n: 55, s: [0.8, 1.3], sand: true },
    { geo: barrel(), n: 190, s: [0.5, 1.2], sand: true }, { geo: pear(), n: 130, s: [0.7, 1.3], sand: true }, { geo: shrub(), n: 340, s: [0.7, 1.5], sand: true },
    { geo: boulder(1), n: 90, s: [0.8, 3.4], rock: true }, { geo: boulder(2), n: 90, s: [0.8, 3.0], rock: true }, { geo: boulder(3), n: 70, s: [1.0, 4.2], rock: true },
  ];
  const plantMat = toon(0xa6a6a6, { vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S = new THREE.Vector3();
  const spots = [];
  for (const sp of SPEC) {
    const pts = [];
    for (let tries = 0; tries < 12000 && pts.length < sp.n; tries++) {
      const x = (rand() * 2 - 1) * (world.half - 14), z = (rand() * 2 - 1) * (world.half - 14);
      const ti = world.trackInfo(x, z); if (ti.index >= 0 && ti.dist < (sp.rock ? 8 : 9)) continue;
      if (Math.abs(z - WASH.z) < WASH.half + 6) continue;                                                              // not in or on the lip of the canyon
      const y = world.heightAtGrid(x, z), sl = Math.max(Math.abs(world.heightAtGrid(x + 3, z) - y), Math.abs(world.heightAtGrid(x, z + 3) - y));
      if (sl > (sp.rock ? 2.4 : 0.9)) continue;
      if (!sp.rock && (y > 12 || world.surfaceAt(x, z) === SURF.Gravel)) continue;
      if (fbm(x * 0.012 + 20, z * 0.012, 2) < (sp.rock ? -0.2 : -0.12) && rand() < 0.8) continue;                      // plants grow in drifts
      if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 2) ** 2)) continue;
      pts.push([x, z]); spots.push([x, z]);
    }
    const im = new THREE.InstancedMesh(sp.geo, plantMat, Math.max(1, pts.length));
    pts.forEach(([x, z], i) => { q.setFromAxisAngle(up, rand() * 6.28); const s = sp.s[0] + rand() * (sp.s[1] - sp.s[0]); m4.compose(V.set(x, world.heightAtGrid(x, z) - (sp.rock ? s * 0.25 : 0.05), z), q, S.set(s, s * (0.9 + rand() * 0.25), s)); im.setMatrixAt(i, m4); });
    im.count = pts.length; im.castShadow = true; im.receiveShadow = true; group.add(im);
  }
  void C;
}
