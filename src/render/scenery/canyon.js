import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm } from '../../world/noise.js';
import { SURF } from '../../world/Surfaces.js';
import { lighting } from '../lighting.js';
import { Workshops } from './workshop.js';
import { garageFacade, seatTexture, bannerTexture } from './lowpoly.js';

/**
 * Canyon Chaos surroundings, in a bright toon-shaded cartoon look: the multi-tier timber trestle across the ravine, the jump runway
 * and its kicker, a sandstone arch over the summit, hoodoo rock pillars on the mesas, rockslides on the switchbacks (boulders that
 * really block the inside line for a few seconds), a cable car across the canyon, chevron boards at the hairpins, the pit complex,
 * paddock tents and stands, sponsor boards, drifting clouds and the desert plants. The terrain itself is coloured in strata by the map.
 */
export function buildCanyonScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const PIT = map.pit, X = map._X, J = map.JUMP;
  const rand = rng(5150);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const nearest = (x, z) => { let bi = 0, bd = 1e12; for (let i = 0; i < M; i++) { const d = (T[i].x - x) ** 2 + (T[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const keepOut = [];
  const free = (x, z, r) => !T.some((s, i) => i % 2 === 0 && (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);

  // ---- toon shading: four clean light steps
  const steps = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 135, 135, 135, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
  steps.minFilter = steps.magFilter = THREE.NearestFilter; steps.needsUpdate = true;
  const toon = (c, extra = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: steps, ...extra });
  const mat = { white: toon(0xfff8ee), concrete: toon(0xe8dcc8), grey: toon(0x8d9196), dark: toon(0x2d3036), red: toon(0xe0452d), roof: toon(0xfff3e0), wood: toon(0xb8743a), woodDark: toon(0x7a4a26), glass: toon(0x3d86c6), yellow: toon(0xffc107), iron: toon(0x30343b), stone: toon(0xa8573a), steel: new THREE.MeshStandardMaterial({ color: 0xc4cad0, metalness: 0.7, roughness: 0.35 }) };
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
  // beams between two points, gathered per material into one instanced mesh
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const beams = new Map();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), Y = new THREE.Vector3(0, 1, 0);
  const beam = (m, ax, ay, az, bx, by, bz, t = 0.3) => {
    _a.set(ax, ay, az); _b.set(bx, by, bz); _d.subVectors(_b, _a); const len = _d.length(); if (len < 1e-3) return;
    _q.setFromUnitVectors(Y, _d.normalize()); _s.set(t, len, t); _m.compose(_a.add(_b).multiplyScalar(0.5), _q, _s);
    if (!beams.has(m)) beams.set(m, []); beams.get(m).push(_m.clone());
  };
  const flushBeams = () => {
    for (const [m, list] of beams) { const im = new THREE.InstancedMesh(UNIT, m, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); im.castShadow = true; im.receiveShadow = true; group.add(im); }
    beams.clear();
  };

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
    const puff = new THREE.SphereGeometry(1, 24, 16);
    const clouds = [], N = 18, PUFFS = 9;
    for (let c = 0; c < N; c++) {
      const cx = (rand() * 2 - 1) * 900, cz = (rand() * 2 - 1) * 900, cy = 220 + rand() * 150, sc = 26 + rand() * 30, parts = [];
      for (let k = 0; k < PUFFS; k++) { const a = rand() * 6.28, rr = rand() * sc * 1.1; parts.push({ x: Math.cos(a) * rr, y: rand() * sc * 0.28 + (k === 0 ? sc * 0.2 : 0), z: Math.sin(a) * rr * 0.55, s: sc * (0.42 + rand() * 0.42), sq: 0.62 + rand() * 0.15 }); }
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

  // ================================================================= the timber trestle bridge across the ravine
  const plankTex = (() => {
    const wc = document.createElement('canvas'); wc.width = 128; wc.height = 256; const g = wc.getContext('2d'); g.fillStyle = '#b87a3e'; g.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 256; y += 32) { g.fillStyle = y % 64 ? '#a96b34' : '#c58a4c'; g.fillRect(0, y, 128, 30); g.fillStyle = '#6d4220'; g.fillRect(0, y + 30, 128, 2); }
    const t = tex(new THREE.CanvasTexture(wc)); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  {
    const D = map._deck, n = D.length, hwB = D[0].w / 2, edge = hwB + 0.9;
    // deck slab under the road, plank faced
    const parts = [];
    for (let k = 0; k < n - 1; k++) {
      const a = D[k], b = D[k + 1], len = Math.hypot(b.x - a.x, b.z - a.z) + 0.05, g = new THREE.BoxGeometry(edge * 2, 0.6, len);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 4);
      g.rotateX(-Math.atan2(b.y - a.y, len)); g.rotateY(Math.atan2(b.x - a.x, b.z - a.z)); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.32, (a.z + b.z) / 2);
      parts.push(g);
    }
    const slab = new THREE.Mesh(mergeGeometries(parts), toon(0xffffff, { map: plankTex })); slab.castShadow = slab.receiveShadow = true; group.add(slab);
    // railings: posts, top and mid rails, kick boards
    for (const sd of [-1, 1]) {
      for (let k = 0; k < n; k += 2) {
        const s = D[k], x = s.x + s.rx * sd * (hwB + 0.6), z = s.z + s.rz * sd * (hwB + 0.6);
        beam(mat.wood, x, s.y - 0.4, z, x, s.y + 1.25, z, 0.26);
        if (k + 2 < n) {
          const e = D[k + 2], ex = e.x + e.rx * sd * (hwB + 0.6), ez = e.z + e.rz * sd * (hwB + 0.6);
          beam(mat.wood, x, s.y + 1.15, z, ex, e.y + 1.15, ez, 0.2); beam(mat.wood, x, s.y + 0.6, z, ex, e.y + 0.6, ez, 0.14); beam(mat.woodDark, x, s.y + 0.12, z, ex, e.y + 0.12, ez, 0.3);
        }
      }
    }
    // the bents: splayed legs down to the ravine floor, girts and X bracing every 7 m, sway braces between bents. The middle span over
    // the road below is carried by a deep timber truss instead.
    const bentAt = [];
    for (let k = 4; k < n - 3; k += 6) { const off = k - (n - 1) / 2; if (Math.abs(off) < 9) continue; bentAt.push(k); }
    const levels = (top, bot) => { const out = []; for (let y = top; y > bot + 2; y -= 7) out.push(y); out.push(bot); return out; };
    const bents = bentAt.map((k) => {
      const s = D[k], top = s.y - 0.65, legs = [];
      for (const sd of [-1, 1]) {
        const tx = s.x + s.rx * sd * (hwB - 0.2), tz = s.z + s.rz * sd * (hwB - 0.2);
        let bot = world.heightAtGrid(tx, tz); const h = top - bot, spl = 0.12 * h;
        const bx = s.x + s.rx * sd * (hwB - 0.2 + spl), bz = s.z + s.rz * sd * (hwB - 0.2 + spl); bot = world.heightAtGrid(bx, bz) - 0.5;
        beam(mat.wood, tx, top, tz, bx, bot, bz, 0.55);
        legs.push({ tx, tz, bx, bz, top, bot });
      }
      const at = (lg, y) => { const f = (lg.top - y) / Math.max(0.1, lg.top - lg.bot); return [lg.tx + (lg.bx - lg.tx) * f, lg.tz + (lg.bz - lg.tz) * f]; };
      const lv = levels(top, Math.max(legs[0].bot, legs[1].bot));
      beam(mat.woodDark, ...[legs[0].tx, top, legs[0].tz], ...[legs[1].tx, top, legs[1].tz], 0.7);          // cap beam
      for (let i = 0; i < lv.length; i++) {
        const y = lv[i], [ax, az] = at(legs[0], y), [bx, bz] = at(legs[1], y);
        if (i > 0) beam(mat.woodDark, ax, y, az, bx, y, bz, 0.32);
        if (i + 1 < lv.length) { const y2 = lv[i + 1], [cx, cz] = at(legs[0], y2), [dx, dz] = at(legs[1], y2); beam(mat.woodDark, ax, y, az, dx, y2, dz, 0.22); beam(mat.woodDark, bx, y, bz, cx, y2, cz, 0.22); }
      }
      return { k, legs, lv, at };
    });
    for (let b = 0; b + 1 < bents.length; b++) {                                             // sway bracing between neighbouring bents
      const A = bents[b], B = bents[b + 1]; if (Math.sign(A.k - (n - 1) / 2) !== Math.sign(B.k - (n - 1) / 2)) continue;
      for (const li of [0, 1]) for (const y of A.lv) { if (y < B.legs[li].bot + 1) continue; const [ax, az] = A.at(A.legs[li], y), [bx, bz] = B.at(B.legs[li], y); beam(mat.woodDark, ax, y, az, bx, y, bz, 0.22); }
    }
    // the truss over the road: two deep timber girders with diagonal web members
    {
      const k0 = bentAt.filter((k) => k < (n - 1) / 2).pop(), k1 = bentAt.find((k) => k > (n - 1) / 2);
      if (k0 !== undefined && k1 !== undefined) for (const sd of [-1, 1]) {
        let prev = null;
        for (let k = k0; k <= k1; k += 2) {
          const s = D[k], x = s.x + s.rx * sd * (hwB - 0.2), z = s.z + s.rz * sd * (hwB - 0.2), yt = s.y - 0.65, yb = s.y - 3.2;
          if (prev) { beam(mat.woodDark, prev.x, prev.yt, prev.z, x, yt, z, 0.5); beam(mat.woodDark, prev.x, prev.yb, prev.z, x, yb, z, 0.5); beam(mat.wood, prev.x, ((k - k0) / 2) % 2 ? prev.yb : prev.yt, prev.z, x, ((k - k0) / 2) % 2 ? yt : yb, z, 0.3); }
          beam(mat.wood, x, yt, z, x, yb, z, 0.3);
          prev = { x, z, yt, yb };
        }
      }
    }
    // stone abutments at either end
    for (const k of [0, n - 1]) { const s = D[k], gy = world.heightAtGrid(s.x, s.z); box(edge * 2 + 1.4, Math.max(1, s.y - 0.6 - (gy - 8)), 4, mat.stone, s.x, gy - 8, s.z, Math.atan2(s.tx, s.tz)); }
    // "DESERT PASSAGE" gantry over the bridge entry
    {
      const s = D[2], yaw = Math.atan2(s.tx, s.tz), face = yaw + Math.PI;
      for (const sd of [-1, 1]) beam(mat.woodDark, s.x + s.rx * sd * (hwB + 1.2), s.y - 0.5, s.z + s.rz * sd * (hwB + 1.2), s.x + s.rx * sd * (hwB + 1.2), s.y + 5.8, s.z + s.rz * sd * (hwB + 1.2), 0.45);
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(hwB * 2 + 2.4, 1.4), new THREE.MeshLambertMaterial({ map: tex(bannerTexture('DESERT PASSAGE', { bg: '#7a3b14', fg: '#ffd27a', w: 768, h: 96 })), side: THREE.DoubleSide }));
      bm.position.set(s.x, s.y + 4.9, s.z); bm.rotation.y = face; group.add(bm);
      beam(mat.woodDark, s.x - s.rx * (hwB + 1.4), s.y + 5.7, s.z - s.rz * (hwB + 1.4), s.x + s.rx * (hwB + 1.4), s.y + 5.7, s.z + s.rz * (hwB + 1.4), 0.35);
    }
    keepOut.push({ x: X.x, z: X.z, r: 40 });
  }

  // ================================================================= the Crossfire Jump: runway paint, kicker trim, boards
  {
    const yaw = Math.atan2(map.AXIS.tx, map.AXIS.tz), face = yaw + Math.PI;
    const chev = document.createElement('canvas'); chev.width = 256; chev.height = 128;
    { const g = chev.getContext('2d'); g.fillStyle = '#ffc107'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#1b1b1b'; g.lineWidth = 26; g.lineJoin = 'miter'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(40 + k * 70, 14); g.lineTo(100 + k * 70, 64); g.lineTo(40 + k * 70, 114); g.stroke(); } }
    const chevMat = new THREE.MeshBasicMaterial({ map: tex(new THREE.CanvasTexture(chev)), side: THREE.DoubleSide });
    // painted arrows on the runway
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const arrow = new THREE.Shape(); arrow.moveTo(-1.6, -1.2); arrow.lineTo(0, 0.6); arrow.lineTo(1.6, -1.2); arrow.lineTo(1.6, -0.2); arrow.lineTo(0, 1.6); arrow.lineTo(-1.6, -0.2); arrow.closePath();
    const ag = new THREE.ShapeGeometry(arrow); ag.rotateX(-Math.PI / 2);
    for (let u = -74; u < J.u1 - J.kickLen - 2; u += 6) { const [x, z] = map.A(u, 0), m = new THREE.Mesh(ag, arrowMat); m.position.set(x, world.heightAt(x, z) + 0.04, z); m.rotation.y = yaw + Math.PI; group.add(m); }
    // red/white edge stripes along the runway
    const kmat = toon(0xffffff, { vertexColors: true });
    const kg = []; for (let u = -78; u < J.u1 - 0.5; u += 2) for (const sd of [-1, 1]) {
      const [x, z] = map.A(u + 1, sd * (J.half - 0.4)), g = new THREE.BoxGeometry(0.8, 0.08, 2); g.rotateY(yaw); g.translate(x, world.heightAt(x, z) + 0.02, z);
      const c = new THREE.Color(Math.floor(u / 2) % 2 ? 0xd32f2f : 0xffffff), col = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); kg.push(g);
    }
    if (kg.length) group.add(new THREE.Mesh(mergeGeometries(kg), kmat));
    // timber trim on the kicker sides and a yellow lip
    const [kx, kz] = map.A(J.u1 - 0.15, 0); box(J.half * 2 - 0.4, 0.12, 0.3, mat.yellow, kx, world.heightAt(kx, kz) - 0.1, kz, yaw);
    for (const sd of [-1, 1]) for (let u = J.u1 - J.kickLen; u < J.u1; u += 1) { const [x, z] = map.A(u + 0.5, sd * (J.half - 0.1)); const h = world.heightAt(x - map.AXIS.tz * sd * 0.3, z + map.AXIS.tx * sd * 0.3); box(0.25, Math.max(0.1, h - world.heightAtGrid(x, z) + 0.15), 1.02, mat.woodDark, x, world.heightAtGrid(x, z) - 0.1, z, yaw); }
    // chevron boards and a big banner
    for (const u of [J.u1 - 14, J.u1 - 6]) for (const sd of [-1, 1]) {
      const [x, z] = map.A(u, sd * (J.half + 2)), y = world.heightAtGrid(x, z);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), chevMat); m.position.set(x, y + 1.6, z); m.rotation.y = yaw + Math.PI / 2 * sd; group.add(m); box(0.12, 1.5, 0.12, mat.iron, x, y, z);
    }
    {
      const [x, z] = map.A(-70, 0), y = world.heightAtGrid(x, z);
      for (const sd of [-1, 1]) { const [px, pz] = map.A(-70, sd * (J.half + 1.4)); beam(mat.woodDark, px, world.heightAtGrid(px, pz) - 0.3, pz, px, y + 6.2, pz, 0.4); }
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(J.half * 2 + 2.4, 1.4), new THREE.MeshLambertMaterial({ map: tex(bannerTexture('CROSSFIRE JUMP', { bg: '#e53935', fg: '#fff', w: 768, h: 96 })), side: THREE.DoubleSide }));
      bm.position.set(x, y + 5.3, z); bm.rotation.y = face; group.add(bm);
    }
    keepOut.push({ x: map.A(-80)[0], z: map.A(-80)[1], r: 34 });
  }

  // ================================================================= sandstone arch over the summit
  {
    const i = nearest(-176, -127), s = T[i], yaw = Math.atan2(s.tx, s.tz), R = s.w / 2 + 6.5, y0 = s.y - 2;
    const g = new THREE.TorusGeometry(R, 3.4, 18, 40, Math.PI), p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), nn = 1 + 0.22 * fbm(x * 0.25, y * 0.25 + z * 0.3, 3); p.setXYZ(k, x * (1 + 0.04 * nn), y * 1.15 + (nn - 1) * 2.5, z * nn * 1.4); }
    g.computeVertexNormals();
    const col = new Float32Array(p.count * 3); for (let k = 0; k < p.count; k++) { const yb = p.getY(k) * 0.5 + fbm(p.getX(k) * 0.3, p.getZ(k) * 0.3, 2) * 1.5, b = ((Math.floor(yb) % 3) + 3) % 3; const c = [[0.46, 0.1, 0.035], [0.6, 0.22, 0.08], [0.36, 0.07, 0.03]][b]; col.set(c, k * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const arch = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true })); arch.position.set(s.x, y0, s.z); arch.rotation.y = yaw + Math.PI / 2; arch.castShadow = arch.receiveShadow = true; group.add(arch);
    for (const sd of [-1, 1]) {                                                              // the feet: rock pillars down into the ground
      const x = s.x + s.rx * sd * R, z = s.z + s.rz * sd * R, gy = world.heightAtGrid(x, z), foot = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, Math.max(2, y0 - gy + 6), 12), toon(0x9a3c1c));
      foot.position.set(x, (y0 + gy - 6) / 2 + 0.5, z); foot.castShadow = true; group.add(foot);
      world.addWall([[x - s.tx * 3, z - s.tz * 3], [x + s.tx * 3, z + s.tz * 3]], { height: 12, thickness: 6, style: 'building' });
    }
    keepOut.push({ x: s.x, z: s.z, r: R + 8 });
  }

  // ================================================================= rockslides: boulders tumble onto the inside line of the switchbacks
  {
    const rockGeo = (() => { let g = new THREE.IcosahedronGeometry(1, 3); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.3 * fbm(x * 1.7 + 3, z * 1.7 + y * 1.7, 3); p.setXYZ(i, x * n, y * n * 0.85, z * n); } g.computeVertexNormals(); return g; })();
    const rockMat = toon(0xa9512e), dustMat = new THREE.MeshBasicMaterial({ color: 0xe8b88a, transparent: true, opacity: 0, depthWrite: false });
    const sites = [[-296, 62, 1, 0], [-247, 40, -1, 5.5]].map(([x0, z0, side, phase]) => {
      const i = nearest(x0, z0), s = T[i], lat = side * (s.w / 2 - 2.4), x = s.x + s.rx * lat, z = s.z + s.rz * lat, y = world.heightAtGrid(x, z);
      const sx = s.x + s.rx * side * (s.w / 2 + 16), sz = s.z + s.rz * side * (s.w / 2 + 16), sy = Math.max(world.heightAtGrid(sx, sz), y + 10) + 2;
      const rock = new THREE.Mesh(rockGeo, rockMat); rock.scale.setScalar(1.05); rock.castShadow = true; rock.visible = false; group.add(rock);
      const dust = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), dustMat.clone()); dust.visible = false; group.add(dust);
      const wl = world.addWall([[x - s.tx * 0.3, z - s.tz * 0.3], [x + s.tx * 0.3, z + s.tz * 0.3]], { height: 1.8, thickness: 2.0, style: 'building' });
      for (const w of wl) { w.base = -1e4; w.top = -1e4 + 1; }
      // a warning board a little before it
      const wb = frame(i - 45, -side * (s.w / 2 + 2.2)), board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), new THREE.MeshBasicMaterial({ map: tex(bannerTexture('ROCKFALL', { bg: '#ffc107', fg: '#1b1b1b', w: 256, h: 180 })), side: THREE.DoubleSide }));
      board.position.set(wb.x, wb.y + 2.2, wb.z); board.rotation.y = wb.yaw + Math.PI; group.add(board); box(0.12, 1.5, 0.12, mat.iron, wb.x, wb.y, wb.z);
      keepOut.push({ x: sx, z: sz, r: 8 });
      return { x, y, z, sx, sy, sz, rock, dust, wl, phase };
    });
    const CYCLE = 11;
    view.updaters?.push(() => {
      const t = performance.now() * 0.001;
      for (const S of sites) {
        const c = (t + S.phase) % CYCLE;                                                     // 0-1.1 s falling, then resting, sinking away at 6-7 s
        let on = true, px, py, pz, base;
        if (c < 1.1) { const f = c / 1.1; px = S.sx + (S.x - S.sx) * f; pz = S.sz + (S.z - S.sz) * f; py = S.sy + (S.y + 0.9 - S.sy) * f * f + Math.sin(f * Math.PI * 3) * 0.6 * (1 - f); base = py - 0.9; }
        else if (c < 6) { px = S.x; pz = S.z; py = S.y + 0.9; base = S.y; }
        else if (c < 7) { const f = c - 6; px = S.x; pz = S.z; py = S.y + 0.9 - 2.2 * f; base = S.y - 2.2 * f; }
        else on = false;
        S.rock.visible = on;
        if (on) { S.rock.position.set(px, py, pz); S.rock.rotation.set(c * 2.3, c * 1.7, 0); }
        for (const w of S.wl) { if (on && c > 0.7) { w.base = base; w.top = base + 1.8; } else { w.base = -1e4; w.top = -1e4 + 1; } }
        const d = c - 1.1, dv = d > 0 && d < 1.4;                                            // a puff of dust as it lands
        S.dust.visible = dv; if (dv) { S.dust.position.set(S.x, S.y + 0.6 + d, S.z); S.dust.scale.setScalar(1.5 + d * 3); S.dust.material.opacity = 0.5 * (1 - d / 1.4); }
      }
    });
  }

  // ================================================================= cable car across the canyon
  {
    const A0 = [-150, 18], B0 = [95, -40];
    const ta = (x, z) => { const y = world.heightAtGrid(x, z); box(1.4, 22, 1.4, mat.iron, x, y, z); box(5, 0.6, 1.2, mat.iron, x, y + 22, z, Math.atan2(B0[0] - A0[0], B0[1] - A0[1]) + Math.PI / 2); keepOut.push({ x, z, r: 6 }); return y + 22; };
    const ya = ta(...A0), yb = ta(...B0);
    const cable = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(A0[0], ya, A0[1]), new THREE.Vector3(B0[0], yb, B0[1])]);
    group.add(new THREE.Line(cable, new THREE.LineBasicMaterial({ color: 0x222222 })));
    const cab = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.6), toon(0xe53935)); body.position.y = -3.4; const win = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.9, 2.7), mat.glass); win.position.y = -3.0;
    const roofc = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.3, 2.9), mat.white); roofc.position.y = -2.1; const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, 0.15), mat.iron); arm.position.y = -1;
    cab.add(body, win, roofc, arm); cab.rotation.y = Math.atan2(B0[0] - A0[0], B0[1] - A0[1]); group.add(cab);
    view.updaters?.push(() => { const t = performance.now() * 0.001, f = 0.5 - 0.5 * Math.cos(t * 0.09); cab.position.set(A0[0] + (B0[0] - A0[0]) * f, ya + (yb - ya) * f - 0.2 - Math.sin(f * Math.PI) * 4, A0[1] + (B0[1] - A0[1]) * f); });
  }

  // ================================================================= chevron boards at the hairpins
  {
    const chev = document.createElement('canvas'); chev.width = 256; chev.height = 128;
    { const g = chev.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#d32f2f'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(30 + k * 75, 10); g.lineTo(80 + k * 75, 64); g.lineTo(30 + k * 75, 118); g.lineTo(58 + k * 75, 118); g.lineTo(108 + k * 75, 64); g.lineTo(58 + k * 75, 10); g.closePath(); g.fill(); } }
    const cm = new THREE.MeshBasicMaterial({ map: tex(new THREE.CanvasTexture(chev)), side: THREE.DoubleSide });
    for (const i of Object.values(map.corners)) {
      const s = T[i]; if (Math.abs(s.curv) < 0.025) continue;
      const out = -Math.sign(s.curv), R = s.w / 2 + 4.2;
      for (const k of [-10, 0, 10]) {
        const f = frame(i + k, out * R); if (!free(f.x, f.z, 3)) continue;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), cm); m.position.set(f.x, f.y + 1.4, f.z); m.rotation.y = f.yaw + (out > 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI; m.scale.x = out > 0 ? 1 : -1; group.add(m);
        beam(mat.woodDark, f.x, f.y - 0.2, f.z, f.x, f.y + 1.0, f.z, 0.14);
      }
    }
  }

  // ================================================================= pit complex on the start straight (east side)
  const g0 = PIT.from + 8, g1 = PIT.to - 8, glat0 = hw(0) + 12, glat1 = glat0 + 6;
  const ng = Math.round(span(g0, g1) / 7), glen = span(g0, g1) / ng;
  const facade = new THREE.MeshLambertMaterial({ map: garageFacade(1), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shops = new Workshops();
  for (let k = 0; k < ng; k++) {
    const d = g0 + (k + 0.5) * glen, f = frame(d, (glat0 + glat1) / 2), base = Math.min(frame(d, glat0).y, frame(d, glat1).y) - 0.2;
    if (!free(f.x, f.z, 6) || !free(frame(d, glat0).x, frame(d, glat0).z, 3)) continue;
    const depth = glat1 - glat0;
    if (k % 2 === 0) {
      const at = (lx, lz) => [f.x - f.t.rx * lx + f.t.tx * lz, f.z - f.t.rz * lx + f.t.tz * lz];
      let [x, z] = at(-depth / 2 - 0.15, 0); box(0.3, 3.4, glen - 0.4, mat.concrete, x, base, z, f.yaw);
      for (const sd of [-1, 1]) { [x, z] = at(0, sd * (glen / 2 - 0.35)); box(depth, 3.4, 0.3, mat.concrete, x, base, z, f.yaw); }
      box(depth + 0.8, 0.3, glen, mat.roof, f.x, base + 3.4, f.z, f.yaw);
      [x, z] = at(depth / 2 - 0.1, 0); box(0.3, 0.45, glen - 0.4, mat.red, x, base + 3.0, z, f.yaw);
      let gmax = base;
      for (const lx of [-depth / 2, 0, depth / 2]) for (const lz of [-glen / 2, 0, glen / 2]) { const [qx, qz] = at(lx, lz); gmax = Math.max(gmax, world.heightAtGrid(qx, qz)); }
      const floorY = Math.min(0.45, Math.max(0.2, gmax - base + 0.04));
      [x, z] = at(0, 0); box(depth, floorY, glen - 0.4, mat.dark, x, base, z, f.yaw);
      const [bx, bz] = at(depth / 2, 0);
      shops.add('kart', bx, base + floorY, bz, Math.atan2(-f.t.rx, -f.t.rz), [0xff6d00, 0x00b0ff, 0xffd600, 0xc62828][(k / 2 | 0) % 4]);
    } else {
      box(depth, 3.4, glen - 0.4, mat.concrete, f.x, base, f.z, f.yaw);
      box(depth + 0.8, 0.3, glen, mat.roof, f.x, base + 3.4, f.z, f.yaw);
      const fx = f.x - f.t.rx * (depth / 2 + 0.05), fz = f.z - f.t.rz * (depth / 2 + 0.05);
      panel(glen - 0.4, 3.2, facade, fx, base, fz, Math.atan2(-f.t.rx, -f.t.rz), (glen - 0.4) / 9);
    }
    solid(f.x, f.z, depth, glen, f.yaw, 3.4);
  }
  shops.build(group);
  {
    const f = frame(30, glat1 + 6);
    if (free(f.x, f.z, 8)) {
      box(8, 10, 6, mat.white, f.x, f.y, f.z, f.yaw); box(8.6, 3.2, 6.6, mat.glass, f.x, f.y + 10, f.z, f.yaw); box(9, 0.5, 7.2, mat.red, f.x, f.y + 13.2, f.z, f.yaw);
      box(0.15, 5, 0.15, mat.steel, f.x, f.y + 13.7, f.z); solid(f.x, f.z, 8, 6, f.yaw, 13);
    }
  }
  // paddock: striped team tents in bold colours
  {
    const stripeTex = (c) => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 8); g.fillStyle = c; for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 8); const t = tex(new THREE.CanvasTexture(cv)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; return t; };
    const cols = ['#e53935', '#1e88e5', '#fb8c00', '#43a047', '#8e24aa'];
    for (let k = 0; k < 10; k++) {
      const d = PIT.from + 12 + k * 17, f = frame(d, glat1 + 13 + (k % 2) * 9);
      if (!free(f.x, f.z, 8)) continue;
      const m = toon(0xffffff, { map: stripeTex(cols[k % cols.length]) });
      box(5.5, 2.4, 6.5, mat.white, f.x, f.y, f.z, f.yaw); const roof = new THREE.Mesh(new THREE.ConeGeometry(4.9, 1.8, 4), m); roof.position.set(f.x, f.y + 3.3, f.z); roof.rotation.y = f.yaw + Math.PI / 4; roof.scale.set(1, 1, 1.15); roof.castShadow = true; group.add(roof);
      keepOut.push({ x: f.x, z: f.z, r: 8 });
    }
  }
  // stands: opposite the pits, and around the Serpent's Bowl
  const seat = new THREE.MeshLambertMaterial({ map: seatTexture('#f4511e'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const crowd = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#5a4a40'; g.fillRect(0, 0, 256, 32); const cs = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fff', '#fb8c00', '#8e24aa']; for (let x = 2; x < 256; x += 7) { g.fillStyle = cs[(x * 7) % cs.length]; g.fillRect(x, 10 + ((x * 13) % 6), 5, 14); g.fillStyle = '#f1c27d'; g.beginPath(); g.arc(x + 2.5, 8 + ((x * 13) % 6), 2.6, 0, 6.3); g.fill(); } const t = tex(new THREE.CanvasTexture(c)); t.wrapS = THREE.RepeatWrapping; return t; })();
  const crowdMat = new THREE.MeshLambertMaterial({ map: crowd, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const stand = (d0, bays, side, lat0, rows = 6, roofCol = mat.red) => {
    const sp = 18;
    for (let k = 0; k < bays; k++) {
      const d = d0 + (k + 0.5) * sp, f = frame(d, side * (lat0 + rows * 0.45)), base = frame(d, side * lat0).y - 0.2;
      if (!free(f.x, f.z, rows * 0.45 + 3.5)) continue;
      for (let r = 0; r < rows; r++) {
        const g = frame(d, side * (lat0 + (r + 0.5) * 0.9)), top = base + 0.5 + (r + 1) * 0.45, fy = Math.atan2(-side * f.t.rx, -side * f.t.rz);
        box(0.9, top - base, sp - 0.6, mat.concrete, g.x, base, g.z, f.yaw);
        panel(sp - 0.6, 0.45, r % 3 === 1 ? seat : crowdMat, g.x - side * g.t.rx * 0.51, top - 0.45, g.z - side * g.t.rz * 0.51, fy, (sp - 0.6) / 5);
      }
      const rH = base + 0.5 + rows * 0.45 + 2.5, roof = frame(d, side * (lat0 + rows * 0.45));
      const r2 = box(rows * 0.9 + 1.6, 0.3, sp - 0.3, roofCol, roof.x, rH, roof.z, f.yaw); r2.rotation.z = side * 0.06;
      for (const u of [-0.5, 0.5]) { const p = frame(d + u * sp, side * (lat0 + rows * 0.9)); box(0.25, rH - base, 0.25, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * 0.9 + 1, sp, f.yaw, rH - base);
    }
  };
  stand(PIT.from + 10, 6, -1, hw(0) + 5.5);
  { const ri = map._ri; stand(ri[20] - 27, 3, -1, 13, 7, toon(0x1e88e5)); stand(ri[25] - 18, 2, 1, 13, 7, toon(0xfdd835)); }

  // sponsor boards (fictional)
  const WORDS = [['CANYON RUSH', '#c62828', '#ffe082'], ['BLAZE KART', '#111', '#ff7043'], ['DESERT PASSAGE', '#6d3b17', '#ffd27a'], ['CANYON CURL', '#1565c0', '#fff'], ['RED ROCK TYRES', '#111', '#ffc107'], ['CACTUS COLA', '#1b8a3a', '#fff'], ['MESA MOTORS', '#f4511e', '#fff']];
  const ads = WORDS.map(([t, bg, fg]) => new THREE.MeshLambertMaterial({ map: tex(bannerTexture(t, { bg, fg, w: 512, h: 96 })) }));
  let ak = 0;
  for (let d = 6; d < L; d += 16) {
    const s = T[idx(d)], side = Math.abs(s.curv) > 0.012 ? -Math.sign(s.curv) : (Math.floor(d / 140) % 2 ? 1 : -1), f = frame(d, side * (hw(d) + 3.7));
    if (side > 0 && (d > PIT.from - 15 || d < PIT.to + 15)) continue;
    if (s.overpass || map.inSec('climb', idx(d)) || map.inSec('chicane', idx(d))) continue;
    if (!free(f.x, f.z, 2.2) || keepOut.some((k) => (k.x - f.x) ** 2 + (k.z - f.z) ** 2 < k.r * k.r * 0.5)) continue;
    if (Math.abs(world.heightAtGrid(f.x, f.z) - s.y) > 2) continue;
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
  flushBeams();

  // ================================================================= hoodoos, cacti, shrubs and boulders (smooth, rounded, toon shaded)
  const withColor = (g, fn) => { const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(); for (let i = 0; i < pos.count; i++) { fn(c, pos.getX(i), pos.getY(i), pos.getZ(i)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
  const ico = (detail) => { let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
  const cap = (r, h) => new THREE.CapsuleGeometry(r, h, 8, 18);
  const green = (c, y, hMax) => c.setRGB(0.1 + 0.08 * (y / hMax), 0.46 + 0.16 * (y / hMax), 0.16 + 0.04 * (y / hMax));
  const saguaro = (arms, tall) => {
    const parts = [], H = tall, trunk = cap(0.55, H); trunk.translate(0, H / 2 + 0.55, 0); parts.push(withColor(trunk, (c, x, y) => green(c, y, H + 1.2)));
    for (const [side, h0, reach, up] of arms) {
      const a = cap(0.36, reach); a.rotateZ(Math.PI / 2); a.translate(side * (reach / 2 + 0.3), h0, 0); parts.push(withColor(a, (c, x, y) => green(c, y, H)));
      const v = cap(0.34, up); v.translate(side * (reach + 0.55), h0 + up / 2 + 0.2, 0); parts.push(withColor(v, (c, x, y) => green(c, y, H)));
    }
    return mergeGeometries(parts);
  };
  const barrel = () => { const g = new THREE.SphereGeometry(1, 22, 16), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + 0.07 * Math.cos(a * 11); p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.95 + 0.9, p.getZ(i) * k); } g.computeVertexNormals();
    const fl = new THREE.SphereGeometry(0.28, 10, 8); fl.translate(0, 1.95, 0); return mergeGeometries([withColor(g, (c, x, y) => c.setRGB(0.22 + 0.06 * y, 0.52 + 0.1 * y, 0.3)), withColor(fl, (c) => c.setRGB(1.0, 0.76, 0.18))]); };
  const shrub = () => { const parts = []; for (let k = 0; k < 5; k++) { const g = ico(2), p = g.attributes.position; g.scale(0.5 + (k % 2) * 0.2, 0.5 + (k % 2) * 0.2, 0.5 + (k % 2) * 0.2); for (let i = 0; i < p.count; i++) { const n = 1 + 0.18 * fbm(p.getX(i) * 3 + k, p.getZ(i) * 3, 2); p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.8, p.getZ(i) * n); } g.computeVertexNormals(); g.translate(Math.cos(k * 1.9) * 0.55, 0.35 + (k % 3) * 0.1, Math.sin(k * 1.9) * 0.55); parts.push(withColor(g, (c, x, y) => c.setRGB(0.62 + 0.08 * y, 0.55 + 0.1 * y, 0.22))); } return mergeGeometries(parts); };
  const boulder = (seed) => { const g = ico(3), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + 0.32 * fbm(x * 1.6 + seed * 9, z * 1.6 + y * 1.6, 3); p.setXYZ(i, x * n, y * n * 0.78, z * n); } g.computeVertexNormals(); return withColor(g, (c, x, y) => c.setRGB(0.42 + 0.08 * y, 0.12 + 0.04 * y, 0.05 + 0.02 * y)); };
  /** a hoodoo / rock spire: a stack of eroded drums in red and cream strata with a harder cap stone */
  const hoodoo = (seed, H) => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 18, 28, false), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + 0.5, z = p.getZ(i), a = Math.atan2(z, x);
      const pinch = 1 - 0.28 * Math.sin(y * Math.PI * 3 + seed) ** 2 - 0.25 * y, n = 1 + 0.12 * fbm(Math.cos(a) * 2 + seed, y * 6, 2);
      p.setXYZ(i, x * pinch * n, y * H, z * pinch * n);
    }
    g.computeVertexNormals();
    const c0 = withColor(g, (c, x, y) => { const b = Math.floor(y / H * 9 + seed) % 3; c.setRGB(...[[0.46, 0.1, 0.035], [0.66, 0.3, 0.12], [0.36, 0.07, 0.03]][b]); });
    const capg = boulder(seed + 1); capg.scale(1.4, 0.9, 1.4); capg.translate(0, H + 0.3, 0);
    return mergeGeometries([c0, capg]);
  };
  const SPEC = [
    { geo: hoodoo(1, 14), n: 26, s: [2.2, 4.2], hoodoo: true }, { geo: hoodoo(2, 20), n: 22, s: [2.6, 4.6], hoodoo: true }, { geo: hoodoo(3, 9), n: 30, s: [1.6, 3.2], hoodoo: true },
    { geo: saguaro([[1, 3.2, 1.3, 2.4]], 6.2), n: 70, s: [0.85, 1.35] },
    { geo: saguaro([[1, 2.8, 1.2, 2.2], [-1, 4.2, 1.1, 1.7]], 7.4), n: 70, s: [0.85, 1.35] },
    { geo: barrel(), n: 160, s: [0.5, 1.2] }, { geo: shrub(), n: 320, s: [0.7, 1.5] },
    { geo: boulder(1), n: 110, s: [0.8, 3.4], rock: true }, { geo: boulder(2), n: 110, s: [0.8, 3.0], rock: true }, { geo: boulder(3), n: 80, s: [1.0, 4.2], rock: true },
  ];
  const plantMat = toon(0xa6a6a6, { vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S = new THREE.Vector3();
  for (const sp of SPEC) {
    const pts = [];
    for (let tries = 0; tries < 14000 && pts.length < sp.n; tries++) {
      const x = (rand() * 2 - 1) * 520, z = (rand() * 2 - 1) * 520;
      const ti = world.trackInfo(x, z); if (ti.index >= 0 && ti.dist < (sp.hoodoo ? 22 : sp.rock ? 8 : 9)) continue;
      const y = world.heightAtGrid(x, z), sl = Math.max(Math.abs(world.heightAtGrid(x + 3, z) - y), Math.abs(world.heightAtGrid(x, z + 3) - y));
      if (sl > (sp.rock ? 2.4 : sp.hoodoo ? 1.4 : 0.9)) continue;
      if (fbm(x * 0.012 + 20, z * 0.012, 2) < (sp.rock || sp.hoodoo ? -0.2 : -0.12) && rand() < 0.8) continue;
      if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 2) ** 2)) continue;
      pts.push([x, z]);
    }
    const im = new THREE.InstancedMesh(sp.geo, plantMat, Math.max(1, pts.length));
    pts.forEach(([x, z], i) => { q.setFromAxisAngle(up, rand() * 6.28); const s = sp.s[0] + rand() * (sp.s[1] - sp.s[0]); m4.compose(V.set(x, world.heightAtGrid(x, z) - (sp.rock ? s * 0.25 : sp.hoodoo ? 0.6 : 0.05), z), q, S.set(s, sp.hoodoo ? 1 : s * (0.9 + rand() * 0.25), s)); im.setMatrixAt(i, m4); });
    im.count = pts.length; im.castShadow = true; im.receiveShadow = true; group.add(im);
  }
  void SURF;
}
