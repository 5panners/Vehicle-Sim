import * as THREE from 'three';
import { rng } from '../../world/noise.js';
import { broadleafTree, pineTree, farTree, garageFacade, seatTexture, bannerTexture } from './lowpoly.js';

/**
 * Spa-Francorchamps surroundings (low-poly, modelled on reference photos):
 *  - Eau Rouge / Raidillon: the painted red and yellow tarmac run-off and the teal strip opposite
 *  - the pit complex: two-storey garages on the right of the pit straight, the pit building and its control tower
 *  - covered stands opposite the pits and above Raidillon, scaffold stands at La Source, Les Combes and the Bus Stop
 *  - the Ardennes: dense spruce and pine forest with beech (from the map's woodland mask), pastures with farmhouses
 *  - advertising boards, marshal posts, brake boards, floodlights
 * Everything is placed by lap distance + lateral offset (+ = right of travel).
 */
export function buildSpaScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = 7004;
  const C = map.corners, PIT = map.pit;
  const rand = rng(1921);                                       // the first Belgian GP at Spa-Francorchamps
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => {
    const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat;
    return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t };
  };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);
  const keepOut = [];
  // a grandstand bay is only built where its whole footprint is clear of every part of the circuit
  const clearOf = (pts, r) => pts.every(([x, z]) => !T.some((s, i) => i % 2 === 0 && (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2));
  const group = new THREE.Group(); scene.add(group);

  // ---- materials
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const poly = { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  const mat = {
    concrete: lam(0xd2cfc8, { map: view.detail }), white: lam(0xf3f3f0), grey: lam(0x8d9196), dark: lam(0x2c2f33), blue: lam(0x1d4f91),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.75, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2b4258, metalness: 0.6, roughness: 0.12 }),
    red: lam(0xc62828), roof: lam(0xe9ecef), orange: lam(0xff7a1a),
    // the painted run-off
    paintRed: lam(0xb3262b, poly), paintYellow: lam(0xe8b923, poly), paintTeal: lam(0x1f9d8a, poly), paintWhite: lam(0xefefea, poly), paintBlue: lam(0x2a5db0, poly),
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
  const box = (w, h, d, m, x, y, z, yaw = 0, parent = group) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = yaw;
    o.castShadow = h > 1.5; o.receiveShadow = true; parent.add(o); return o;
  };
  const panel = (w, h, m, x, y, z, faceYaw, uRepeat = 1) => {
    const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uRepeat);
    const o = new THREE.Mesh(g, m); o.position.set(x, y + h / 2, z); o.rotation.y = faceYaw; group.add(o); return o;
  };
  const solid = (x, z, w, d, yaw, h = 4) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (u, v) => [x + v * c + u * s, z - v * s + u * c];
    world.addWall([P(-d / 2, -w / 2), P(-d / 2, w / 2), P(d / 2, w / 2), P(d / 2, -w / 2), P(-d / 2, -w / 2)], { height: h, thickness: 0.6, style: 'building' });
    keepOut.push({ x, z, r: Math.hypot(w, d) / 2 + 4 });
  };
  const groundUnder = (d0, d1, lat0, lat1) => {
    let y = Infinity;
    for (const d of [d0, (d0 + d1) / 2, d1]) for (const lat of [lat0, (lat0 + lat1) / 2, lat1]) y = Math.min(y, frame(d, lat).y);
    return y - 0.25;
  };
  const along = (d0, d1, lat0, lat1, h, m, { y0 = 0, segLen = 18, collide = false, bases } = {}) => {
    if (d1 < d0) d1 += L;
    const n = Math.max(1, Math.round((d1 - d0) / segLen)), len = (d1 - d0) / n, segs = [];
    for (let k = 0; k < n; k++) {
      const da = d0 + k * len, f = frame(da + len / 2, (lat0 + lat1) / 2);
      const base = bases ? bases[k] : groundUnder(da, da + len, lat0, lat1);
      box(Math.abs(lat1 - lat0), h, len + 0.6, m, f.x, base + y0, f.z, f.yaw);
      if (collide) solid(f.x, f.z, Math.abs(lat1 - lat0), len + 0.6, f.yaw, y0 + h);
      segs.push({ ...f, len, base });
    }
    return { bases: segs.map((s) => s.base), segs };
  };

  // ============================================================ tarmac run-off beside every corner (the physics ground is asphalt there)
  {
    const tarmac = lam(0x4f5155, { map: view.detail, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const side of [-1, 1]) {
      const depth = (t) => map.tarmacDepth(world, t, side);
      // ribbons need offA < offB (or they are wound backwards): on the left the outer edge comes first
      view._ribbon({ offA: (t) => (side < 0 ? -(t.w / 2 + depth(t)) : t.w / 2 + 1.2), offB: (t) => (side < 0 ? -(t.w / 2 + 1.2) : t.w / 2 + depth(t)),
        yOff: 0.045, mat: tarmac, cols: 6, step: 2, uvScale: 18, filter: (t) => depth(t) > 2.2 });
    }
  }

  // ============================================================ painted run-off at Eau Rouge and Raidillon
  // Left of the track (outside of the compression): yellow and red lanes; right: a teal lane; both edged in white.
  {
    const a = C['Eau Rouge'] - 150, b = C['Raidillon'] + 190, from = idx(a), to = idx(b) + (b < a ? M : 0);
    const dep = (side) => (t) => map.tarmacDepth(world, t, side);
    // ribbons need offA < offB or they are wound backwards (culled): on the left (negative offsets) the outer edge comes first
    const edge = (side, f, t) => side * (t.w / 2 + 1.3 + f * Math.max(0, dep(side)(t) - 1.3));
    const band = (side, f0, f1, m, extra = 0) => view._ribbon({ offA: (t) => (side < 0 ? edge(side, f1, t) : edge(side, f0, t)), offB: (t) => (side < 0 ? edge(side, f0, t) : edge(side, f1, t)), yOff: 0.075 + extra, mat: m, from, to, step: 1, cols: 1, filter: (t) => dep(side)(t) > 2.5 });
    // left side: alternating lanes (yellow 0-.17, red .17-.42, yellow .42-.6, red .6-.9)
    for (const [f0, f1, m] of [[0, 0.17, mat.paintYellow], [0.17, 0.42, mat.paintRed], [0.42, 0.6, mat.paintYellow], [0.6, 0.9, mat.paintRed]]) band(-1, f0, f1, m);
    band(-1, 0.168, 0.176, mat.paintWhite, 0.005); band(-1, 0.6, 0.608, mat.paintWhite, 0.005);
    // right side: teal run-off with a white edge line
    band(1, 0, 0.95, mat.paintTeal); band(1, 0.0, 0.03, mat.paintWhite, 0.005);
  }

  // ============================================================ the pit lane, its entry and exit
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 - 7, t.w / 2];
  view._ribbon({ offA: (t) => Math.max(band(t)[0], t.w / 2 - 0.05), offB: (t) => Math.max(band(t)[1], t.w / 2), yOff: 0.06, mat: view.asphaltMaterial(), uvScale: 14, from: idx(PIT.entry), to: idx(PIT.exit) + M, cols: 6, step: 1 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const [a, b] of [[PIT.entry, PIT.from + 10], [PIT.to - 10, PIT.exit]]) {
    view._ribbon({ offA: (t) => band(t)[1] - 0.25, offB: (t) => band(t)[1], yOff: 0.07, mat: lineMat, from: idx(a), to: idx(b) + (b < a ? M : 0), step: 1 });
    view._ribbon({ offA: (t) => Math.max(band(t)[0], t.w / 2), offB: (t) => Math.max(band(t)[0] + 0.25, t.w / 2), yOff: 0.07, mat: lineMat, from: idx(a), to: idx(b) + (b < a ? M : 0), step: 1 });
  }
  const apron = lam(0x9c9a94, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  view._ribbon({ offA: (t) => t.w / 2 + 14.5, offB: (t) => t.w / 2 + 19, yOff: 0.06, cols: 2, mat: apron, from: idx(PIT.from), to: idx(PIT.to) + M });
  // grid slots are drawn by WorldView; edge lines along the circuit
  view._ribbon({ offA: (t) => t.w / 2 - 0.22, offB: (t) => t.w / 2 - 0.02, yOff: 0.05, mat: lineMat, step: 1, filter: (t) => !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.22), yOff: 0.05, mat: lineMat, step: 1 });

  // ============================================================ pit garages and the pit building
  const h0 = hw(0), gFrom = PIT.from + 25, gTo = PIT.to - 20, glat0 = h0 + 19.5, glat1 = h0 + 33;
  const gar = along(gFrom, gTo, glat0, glat1, 7.2, mat.concrete, { collide: true });
  const onGar = { bases: gar.bases };
  along(gFrom, gTo, glat0, glat1 + 0.3, 0.35, mat.grey, { y0: 7.2, ...onGar });                // flat roof
  along(gFrom, gTo, glat0 - 0.6, glat0 + 0.2, 1.0, mat.blue, { y0: 6.8, ...onGar });            // blue fascia band over the doors
  // the pit building: a white/grey three-storey block above the garages with a glazed upper floor and a tall control tower
  const upper = along(gFrom, gTo, glat0 + 4, glat1 - 1, 5.6, mat.white, { y0: 7.55, segLen: 22, ...onGar });
  along(gFrom, gTo, glat0 + 3.7, glat1 - 0.7, 0.35, mat.dark, { y0: 13.1, segLen: 22, bases: upper.bases.map((b, i) => gar.bases[Math.min(gar.bases.length - 1, Math.floor(i * gar.bases.length / upper.bases.length))]) });
  for (const s of upper.segs) {                                                                  // glazing strip on the track face
    const fx = s.x - s.t.rx * ((glat1 - glat0 - 5) / 2 + 0.1), fz = s.z - s.t.rz * ((glat1 - glat0 - 5) / 2 + 0.1);
    panel(s.len + 0.2, 3.4, mat.glass, fx, s.base + 8.7, fz, Math.atan2(-s.t.rx, -s.t.rz));
  }
  const facade = new THREE.MeshLambertMaterial({ map: garageFacade(1), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const s of gar.segs) {                                                                    // garage fronts: one bay per ~9 m
    const fx = s.x - s.t.rx * ((glat1 - glat0) / 2 + 0.1), fz = s.z - s.t.rz * ((glat1 - glat0) / 2 + 0.1);
    panel(s.len + 0.6, 7.2, facade, fx, s.base, fz, Math.atan2(-s.t.rx, -s.t.rz), (s.len + 0.6) / 9);
  }
  {                                                                                             // control tower near the start line
    const f = frame(40, glat0 + 6), y = groundUnder(30, 50, glat0 + 3, glat0 + 9);
    box(8, 26, 8, mat.concrete, f.x, y, f.z, f.yaw);
    box(9.6, 4.2, 9.6, mat.glass, f.x, y + 26, f.z, f.yaw); box(10, 0.8, 10, mat.dark, f.x, y + 30.2, f.z, f.yaw);
    box(0.2, 7, 0.2, mat.white, f.x, y + 31, f.z); solid(f.x, f.z, 9, 9, f.yaw, 30);
  }
  // team trucks on the paddock road behind the garages
  view._ribbon({ offA: (t) => t.w / 2 + 34, offB: (t) => t.w / 2 + 41, yOff: 0.06, cols: 2, mat: lam(0x6f7174, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), from: idx(gFrom), to: idx(gTo) + M });
  const teamCols = [0xc62828, 0x1565c0, 0xf9a825, 0x2e7d32, 0x212121, 0xffffff, 0x6a1b9a, 0x00897b];
  for (let d = gFrom + 22, k = 0; span(gFrom, d) < span(gFrom, gTo) - 20; d += 23, k++) {
    if (k % 4 === 3) continue;
    const f = frame(d, h0 + 37.5), y = groundUnder(d - 9, d + 9, h0 + 36, h0 + 39);
    box(2.6, 3.2, 13.6, lam(teamCols[k % teamCols.length]), f.x, y + 0.9, f.z, f.yaw);
    box(2.5, 3.0, 2.4, mat.white, f.x + f.t.tx * 8.2, y, f.z + f.t.tz * 8.2, f.yaw);
    box(2.4, 0.9, 13.6, mat.dark, f.x, y, f.z, f.yaw);
    solid(f.x + f.t.tx * 1.5, f.z + f.t.tz * 1.5, 2.6, 17, f.yaw);
  }

  // ============================================================ grandstands
  const seatM = (c) => new THREE.MeshLambertMaterial({ map: seatTexture(c), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const seatMats = { red: seatM('#c2185b'), blue: seatM('#1f4e9a'), yellow: seatM('#e0a800') };
  const bannerMat = new THREE.MeshLambertMaterial({ map: bannerTexture('SPA-FRANCORCHAMPS') });
  const scaffoldStand = (d0, d1, side, latFront, { rows = 9, riser = 0.55, depth = 0.95, lift = 1.8, seats = seatMats.red } = {}) => {
    const s = side, segLen = 14, n = Math.max(1, Math.round(span(d0, d1) / segLen)), len = span(d0, d1) / n;
    for (let k = 0; k < n; k++) {
      const mid = latFront + (rows * depth) / 2, f = frame(d0 + (k + 0.5) * len, s * mid);
      const corners = [[0, latFront], [0, latFront + rows * depth], [1, latFront], [1, latFront + rows * depth], [0.5, latFront]].map(([u, l]) => { const q = frame(d0 + (k + u) * len, s * l); return [q.x, q.z]; });
      if (!clearOf(corners, 4)) continue;
      const base = groundUnder(d0 + k * len, d0 + (k + 1) * len, s * latFront, s * (latFront + rows * depth));
      const yaw = f.yaw, faceYaw = Math.atan2(-s * f.t.rx, -s * f.t.rz);
      for (let r = 0; r < rows; r++) {
        const g = frame(d0 + (k + 0.5) * len, s * (latFront + (r + 0.5) * depth));
        const stepTop = base + lift + (r + 1) * riser;
        box(depth, 0.12, len, mat.dark, g.x, stepTop - 0.12, g.z, yaw);
        panel(len, riser, seats, g.x - s * g.t.rx * (depth * 0.5 + 0.06), stepTop - riser, g.z - s * g.t.rz * (depth * 0.5 + 0.06), faceYaw, len / 6);
      }
      for (let r = 0; r <= rows; r += 3) for (const u of [-0.5, 0, 0.5]) {
        const g = frame(d0 + (k + 0.5 + u * 0.98) * len, s * (latFront + r * depth));
        box(0.12, lift + r * riser + 0.1, 0.12, mat.steel, g.x, base - 0.3, g.z, yaw);
      }
      const back = frame(d0 + (k + 0.5) * len, s * (latFront + rows * depth + 0.1));
      box(0.08, 1.2, len, mat.steel, back.x, base + lift + rows * riser, back.z, yaw);
      const fr = frame(d0 + (k + 0.5) * len, s * (latFront - 0.05));
      panel(len, lift, bannerMat, fr.x - s * fr.t.rx * 0.08, base, fr.z - s * fr.t.rz * 0.08, faceYaw, 1);
      solid(f.x, f.z, rows * depth + 1, len, yaw, lift + rows * riser);
    }
  };
  const coveredStand = (d0, d1, side, latFront, { rows = 12, riser = 0.5, depth = 0.9, seats = seatMats.blue, bays = 4 } = {}) => {
    const s = side, n = bays, len = span(d0, d1) / n;
    for (let k = 0; k < n; k++) {
      const mid = latFront + (rows * depth) / 2, f = frame(d0 + (k + 0.5) * len, s * mid);
      const corners = [[0, latFront - 1.5], [0, latFront + rows * depth + 1], [1, latFront - 1.5], [1, latFront + rows * depth + 1], [0.5, latFront - 1.5]].map(([u, l]) => { const q = frame(d0 + (k + u) * len, s * l); return [q.x, q.z]; });
      if (!clearOf(corners, 6)) continue;                          // the roof overhangs the front row: keep it well back from any track
      const base = groundUnder(d0 + k * len, d0 + (k + 1) * len, s * latFront, s * (latFront + rows * depth));
      const faceYaw = Math.atan2(-s * f.t.rx, -s * f.t.rz);
      for (let r = 0; r < rows; r++) {
        const g = frame(d0 + (k + 0.5) * len, s * (latFront + (r + 0.5) * depth));
        const top = base + 1.2 + (r + 1) * riser;
        box(depth, top - base, len - 0.8, mat.concrete, g.x, base, g.z, f.yaw);
        panel(len - 0.8, riser, seats, g.x - s * g.t.rx * (depth * 0.5 + 0.06), top - riser, g.z - s * g.t.rz * (depth * 0.5 + 0.06), faceYaw, len / 6);
      }
      const rH = base + 1.2 + rows * riser + 3.5, roof = frame(d0 + (k + 0.5) * len, s * (latFront + rows * depth * 0.45));
      const r = box(rows * depth + 2.5, 0.35, len - 0.4, mat.roof, roof.x, rH, roof.z, f.yaw); r.rotation.z = s * 0.08;
      const bk = frame(d0 + (k + 0.5) * len, s * (latFront + rows * depth + 0.4));
      box(0.5, rH - base, len - 0.4, mat.grey, bk.x, base, bk.z, f.yaw);
      for (const u of [-0.5, 0.5]) { const p = frame(d0 + (k + 0.5 + u) * len, s * (latFront + rows * depth)); box(0.4, rH - base, 0.4, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * depth + 1, len, f.yaw, rH - base);
    }
  };
  const outer = (c, side, base = 0) => hw(c) + Math.max(map.tarmacDepth(world, T[idx(c)], side), 6.5) + 7 + base;
  coveredStand(6960, 170, -1, h0 + 15, { rows: 14, bays: 6 });                                  // main grandstand opposite the pits
  coveredStand(C['Raidillon'] - 90, C['Raidillon'] + 70, -1, outer(C['Raidillon'] - 10, -1, 3), { rows: 14, bays: 6, seats: seatMats.red });   // above Raidillon
  scaffoldStand(C['La Source'] - 60, C['La Source'] + 50, -1, outer(C['La Source'], -1), { rows: 10 });                  // La Source (outside)
  scaffoldStand(C['Les Combes'] - 80, C['Les Combes'] + 30, -1, outer(C['Les Combes'], -1), { rows: 9, seats: seatMats.yellow });
  coveredStand(C['Bus Stop'] - 55, C['Bus Stop'] + 35, -1, outer(C['Bus Stop'], -1), { rows: 10, bays: 3, seats: seatMats.yellow });   // facing the chicane itself
  for (const [d0, d1, side, lat] of [[6960, 170, -1, h0 + 15], [C['Raidillon'] - 90, C['Raidillon'] + 70, -1, outer(C['Raidillon'] - 10, -1, 3)],
    [C['La Source'] - 60, C['La Source'] + 50, -1, outer(C['La Source'], -1)], [C['Les Combes'] - 80, C['Les Combes'] + 30, -1, outer(C['Les Combes'], -1)],
    [C['Bus Stop'] - 55, C['Bus Stop'] + 35, -1, outer(C['Bus Stop'], -1)]]) keepOut.push({ ...frame((d0 + d1 + (d1 < d0 ? L : 0)) / 2, side * (lat + 10)), r: span(d0, d1) / 2 + 24 });

  // ============================================================ advertising boards, marshal posts, brake boards, lights
  const WORDS = [['SPA-FRANCORCHAMPS', '#111', '#fff'], ['ARDENNES', '#0b3d7a', '#fff'], ['BELGIQUE', '#c62828', '#fff'], ['LIÈGE', '#e8e8e8', '#0b3d7a'], ['STAVELOT', '#1b5e20', '#fff'], ['FRANCORCHAMPS', '#7a1020', '#fff']];
  const ads = WORDS.map(([t, bg, fg]) => { const x = bannerTexture(t, { bg, fg, w: 512, h: 96 }); x.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: x }); });
  let ak = 0;
  for (const [a, b, side] of [[6980, 380, -1], [C['La Source'] + 80, C['La Source'] + 420, -1], [C['Eau Rouge'] - 100, C['Raidillon'] + 80, 1], [1500, 2350, -1], [C['Bus Stop'] - 120, C['Bus Stop'] + 60, 1], [6300, 6700, -1]]) {
    for (let d = a; span(a, d) < span(a, b); d += 8) {
      const dd = ((d % L) + L) % L, off = hw(dd) + (T[idx(dd)].kerb ? 1.95 : 0.9) + Math.max(0, map.barrierOffset(world, T[idx(dd)], side) - 1.0), f = frame(dd, side * off);
      if (frame(dd, side * (off + 4)).y < -40 || (side > 0 && inRange(dd, PIT.from - 10, PIT.to + 10))) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.1), ads[ak++ % ads.length]);
      m.position.set(f.x, f.y + 1.55, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
    }
  }
  for (const [d, side] of [[C['La Source'] + 70, -1], [C['Eau Rouge'] + 40, -1], [C['Les Combes'] + 70, -1], [C['Rivage'] - 20, -1], [C['Pouhon'] + 30, -1], [C['Fagnes'] - 40, 1], [C['Stavelot'] + 40, 1], [C['Blanchimont'] - 60, 1], [C['Bus Stop'] - 70, -1]]) {
    const f = frame(d, side * (hw(d) + map.barrierOffset(world, T[idx(d)], side) + 2.5));
    box(1.6, 2.6, 1.6, mat.orange, f.x, f.y - 0.1, f.z, f.yaw); box(1.9, 0.25, 1.9, mat.dark, f.x, f.y + 2.5, f.z, f.yaw);       // marshal post
  }
  for (const [c, side] of [[C['La Source'], -1], [C['Les Combes'], -1], [C['Bus Stop'], -1]]) {                                  // 150 / 100 / 50 brake boards
    for (const [k, m] of [[3, 150], [2, 100], [1, 50]]) {
      const f = frame(c - m - 12, side * (hw(c - m) + 3.4));
      const tex = bannerTexture(String(m), { bg: '#f1f1ec', fg: '#111', w: 128, h: 96 }); tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshLambertMaterial({ map: tex })); pm.position.set(f.x, f.y + 2.4, f.z); pm.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(pm);
      box(0.1, 2.4, 0.1, mat.steel, f.x, f.y, f.z, f.yaw);
    }
  }
  for (let d = 7010; span(7010, d) < span(7010, 300); d += 48) {                                    // floodlight masts on the pit straight
    const f = frame(d, -(hw(d) + 13)); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 17, 7), mat.steel); m.position.set(f.x, f.y + 8.4, f.z); m.castShadow = true; group.add(m);
    box(3.2, 0.7, 0.9, mat.dark, f.x, f.y + 17, f.z, f.yaw + Math.PI / 2);
  }

  // ============================================================ farmhouses on the pastures
  const houses = [];
  for (let tries = 0; tries < 60000 && houses.length < 26; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 90), z = (rand() * 2 - 1) * (world.half - 90);
    if (map.forest(world, x, z) > 0.25 || map.nearestTrack(world, x, z).d < 140) continue;
    if (houses.some((h) => (h.x - x) ** 2 + (h.z - z) ** 2 < 70 * 70) || keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 30) ** 2)) continue;
    const g0 = world.heightAtGrid(x, z); if (Math.abs(world.heightAtGrid(x + 12, z) - g0) > 2 || Math.abs(world.heightAtGrid(x, z + 12) - g0) > 2) continue;
    houses.push({ x, z, yaw: rand() * Math.PI });
  }
  const wallCols = [0xe8dcc4, 0xd9c7a6, 0xf0e8d8, 0xcdbb9a], roofTile = lam(0x6c3b2f), slate = lam(0x4e545b);
  for (const h of houses) {
    const y = world.heightAtGrid(h.x, h.z), w = 11 + rand() * 6, d = 8 + rand() * 3, wm = lam(wallCols[(rand() * wallCols.length) | 0]);
    box(w, 5.2, d, wm, h.x, y - 0.2, h.z, h.yaw);
    for (const sgn of [-1, 1]) {                                                                    // gabled roof: two sloped slabs
      const r = box(d / 2 + 0.7, 0.28, w + 1.1, rand() < 0.5 ? roofTile : slate, h.x + Math.cos(h.yaw) * sgn * d * 0.2, y + 5.0 + d * 0.13, h.z - Math.sin(h.yaw) * sgn * d * 0.2, h.yaw);
      r.rotation.set(0, h.yaw, sgn * 0.72, 'YXZ'); r.rotation.order = 'YZX';
    }
    box(1.1, 3.4, 1.1, mat.grey, h.x + Math.sin(h.yaw) * 3, y + 6, h.z + Math.cos(h.yaw) * 3, h.yaw);
    keepOut.push({ x: h.x, z: h.z, r: 16 });
  }

  // ============================================================ woodland (tiled LOD instancing so it culls)
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const spruce = (seed, h, crown, col) => ({ geo: pineTree(seed, { h }), far: farTree(seed, { h, crown, leaf: col, bark: 0x5a3f2b }) });
  const VARIANTS = [
    { ...spruce(3, 20, 2.8, 0x23472b), w: 26 }, { ...spruce(8, 24, 3.0, 0x1e4026), w: 24 }, { ...spruce(15, 17, 2.6, 0x2a5232), w: 20 }, { ...spruce(21, 28, 3.2, 0x1b3a25), w: 14 },
    { geo: broadleafTree(23, { h: 17, crown: 5.0, leaf: 0x5a8a3a }), far: farTree(23, { h: 17, crown: 5.0, leaf: 0x5a8a3a }), w: 12 },        // beech
    { geo: broadleafTree(37, { h: 13, crown: 4.2, leaf: 0x3f6f30 }), far: farTree(37, { h: 13, crown: 4.2, leaf: 0x3f6f30 }), w: 7 },
  ];
  const LOD_FAR = 300, TILE = 240, wsum = VARIANTS.reduce((a, v) => a + v.w, 0);
  const pick = () => { let r = rand() * wsum; for (let i = 0; i < VARIANTS.length; i++) { r -= VARIANTS[i].w; if (r <= 0) return i; } return 0; };
  const tiles = new Map(); let placed = 0;
  for (let tries = 0; tries < 330000 && placed < 15000; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 12), z = (rand() * 2 - 1) * (world.half - 12);
    const dens = map.forest(world, x, z);
    if (dens <= 0 || rand() > dens * 0.9) continue;
    if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, VARIANTS.map(() => []));
    tiles.get(key)[pick()].push([x, z, 0.72 + rand() * 0.6, rand() * 6.28]);
    placed++;
  }
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), tint = new THREE.Color();
  for (const [key, lists] of tiles) {
    const [tx, tz] = key.split(',').map(Number);
    const lod = new THREE.LOD(); lod.position.set((tx + 0.5) * TILE, 0, (tz + 0.5) * TILE);
    const near = new THREE.Group(), far = new THREE.Group();
    lists.forEach((list, vi) => {
      if (!list.length) return;
      const hi = new THREE.InstancedMesh(VARIANTS[vi].geo, treeMat, list.length), lo = new THREE.InstancedMesh(VARIANTS[vi].far, treeMat, list.length);
      list.forEach(([x, z, s, r], i) => {
        q.setFromAxisAngle(up, r);
        m4.compose(V.set(x - lod.position.x, world.heightAtGrid(x, z) - 0.15, z - lod.position.z), q, S.set(s, s * (0.9 + rand() * 0.25), s));
        hi.setMatrixAt(i, m4); lo.setMatrixAt(i, m4);
        const c = tint.setHSL(0, 0, 0.86 + rand() * 0.26); hi.setColorAt(i, c); lo.setColorAt(i, c);
      });
      hi.computeBoundingSphere(); lo.computeBoundingSphere(); hi.castShadow = true; hi.receiveShadow = true;
      near.add(hi); far.add(lo);
    });
    lod.addLevel(near, 0); lod.addLevel(far, LOD_FAR); group.add(lod);
  }
  return { trees: placed, houses: houses.length, tiles: tiles.size };
}
