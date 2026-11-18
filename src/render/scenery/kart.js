import * as THREE from 'three';
import { rng } from '../../world/noise.js';
import { broadleafTree, birchTree, pineTree, garageFacade, seatTexture, bannerTexture } from './lowpoly.js';

/**
 * Apex Ring surroundings (low-poly): a row of kart garages and a small race-control building on the
 * pit straight, a covered stand opposite, advertising boards on the tyre walls, marshal posts, brake
 * boards, floodlights, paddock tents and tree lines. Placed by lap distance + lateral offset (+ = right).
 */
export function buildKartScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const C = map.corners, PIT = map.pit;
  const rand = rng(2024);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const keepOut = [];
  // nothing is placed where it would sit on the circuit: r metres clear of the track edge, on every part of the lap
  const free = (x, z, r) => !T.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = { concrete: lam(0xd2cfc8, { map: view.detail }), white: lam(0xf3f3f0), grey: lam(0x8d9196), dark: lam(0x2c2f33), orange: lam(0xff7a1a), red: lam(0xc62828), yellow: lam(0xf2b705), roof: lam(0xe9ecef), blue: lam(0x1d4f91),
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

  // ---- pit lane markings
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 + 2.2, t.w / 2 + 6.2];
  const i0 = idx(PIT.from), i1 = idx(PIT.to);
  const to = i1 + (i1 < i0 ? M : 0);
  view._ribbon({ offA: (t) => band(t)[1] - 0.2, offB: (t) => band(t)[1], yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => band(t)[0], offB: (t) => band(t)[0] + 0.2, yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  // edge lines along the circuit
  view._ribbon({ offA: (t) => t.w / 2 - 0.18, offB: (t) => t.w / 2 - 0.02, yOff: 0.02, mat: lineMat, step: 1, filter: (t) => !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.18), yOff: 0.02, mat: lineMat, step: 1 });

  // ---- kart garages and race control
  const g0 = PIT.from + 8, g1 = PIT.to - 8, glat0 = hw(0) + 12.5, glat1 = glat0 + 6;
  const n = Math.round(span(g0, g1) / 7), len = span(g0, g1) / n;
  const facade = new THREE.MeshLambertMaterial({ map: garageFacade(1), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (let k = 0; k < n; k++) {
    const d = g0 + 3 + (k + 0.5) * len, f = frame(d, (glat0 + glat1) / 2), base = Math.min(frame(d, glat0).y, frame(d, glat1).y) - 0.2;
    if (!free(f.x, f.z, 6) || !free(frame(d, glat0).x, frame(d, glat0).z, 3)) continue;
    box(glat1 - glat0, 3.4, len - 0.4, mat.concrete, f.x, base, f.z, f.yaw);
    box(glat1 - glat0 + 0.8, 0.3, len, mat.grey, f.x, base + 3.4, f.z, f.yaw);
    const fx = f.x - f.t.rx * ((glat1 - glat0) / 2 + 0.05), fz = f.z - f.t.rz * ((glat1 - glat0) / 2 + 0.05);
    panel(len - 0.4, 3.2, facade, fx, base, fz, Math.atan2(-f.t.rx, -f.t.rz), (len - 0.4) / 9);
    solid(f.x, f.z, glat1 - glat0, len, f.yaw, 3.4);
  }
  {                                                                                      // race control tower at the start line
    const f = frame(18, glat1 + 5), y = frame(18, glat1 + 5).y;
    if (free(f.x, f.z, 8)) {
    box(7, 9, 6, mat.white, f.x, y, f.z, f.yaw); box(7.6, 3, 6.6, mat.glass, f.x, y + 9, f.z, f.yaw); box(8, 0.5, 7, mat.dark, f.x, y + 12, f.z, f.yaw);
    box(0.15, 5, 0.15, mat.steel, f.x, y + 12.5, f.z); solid(f.x, f.z, 7, 6, f.yaw, 12); }
  }

  // ---- covered stand opposite the pits, a smaller one on the outside of the hairpin
  const seat = new THREE.MeshLambertMaterial({ map: seatTexture('#1f4e9a'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stand = (d0, d1, side, lat0, rows = 7, bays = 3) => {
    const len = span(d0, d1) / bays;
    for (let k = 0; k < bays; k++) {
      const d = d0 + (k + 0.5) * len, f = frame(d, side * (lat0 + rows * 0.45)), base = frame(d, side * lat0).y - 0.2;
      if (!free(f.x, f.z, rows * 0.45 + 3.5) || !free(frame(d, side * lat0).x, frame(d, side * lat0).z, 2.5) || !free(frame(d, side * (lat0 + rows * 0.9 + 1)).x, frame(d, side * (lat0 + rows * 0.9 + 1)).z, 2.5)) continue;
      for (let r = 0; r < rows; r++) {
        const g = frame(d, side * (lat0 + (r + 0.5) * 0.9)), top = base + 0.5 + (r + 1) * 0.45;
        box(0.9, top - base, len - 0.6, mat.concrete, g.x, base, g.z, f.yaw);
        panel(len - 0.6, 0.45, seat, g.x - side * g.t.rx * 0.51, top - 0.45, g.z - side * g.t.rz * 0.51, Math.atan2(-side * f.t.rx, -side * f.t.rz), (len - 0.6) / 5);
      }
      const rH = base + 0.5 + rows * 0.45 + 2.6, roof = frame(d, side * (lat0 + rows * 0.45));
      const r2 = box(rows * 0.9 + 1.6, 0.25, len - 0.3, mat.roof, roof.x, rH, roof.z, f.yaw); r2.rotation.z = side * 0.06;
      for (const u of [-0.5, 0.5]) { const p = frame(d + u * len, side * (lat0 + rows * 0.9)); box(0.25, rH - base, 0.25, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * 0.9 + 1, len, f.yaw, rH - base);
    }
  };
  stand(PIT.from + 10, 75, -1, hw(0) + 5.5, 7, 4);
  stand(C['Turn 4'] - 25, C['Turn 4'] + 25, map.outside(world, C['Turn 4']), hw(C['Turn 4']) + 7.5, 5, 2);

  // ---- advertising boards on the tyre walls, marshal posts, brake boards, floodlights
  const WORDS = [['APEX RING', '#111', '#ffc400'], ['KARTING', '#c62828', '#fff'], ['RACE · DRIFT · REPEAT', '#0b3d7a', '#fff'], ['PIT STOP', '#e8e8e8', '#111'], ['GRIP', '#1b5e20', '#fff']];
  const ads = WORDS.map(([t, bg, fg]) => { const x = bannerTexture(t, { bg, fg, w: 512, h: 96 }); x.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: x }); });
  let ak = 0;
  for (let d = 0; d < L; d += 14) {
    const side = Math.floor(d / 120) % 2 ? 1 : -1, off = hw(d) + 4.8;
    if (side > 0 && (d > PIT.from - 15 || d < PIT.to + 15)) continue;
    const f = frame(d, side * off), info = world.trackInfo(f.x, f.z);
    if (!free(f.x, f.z, 2.4)) continue;
    if (info.index >= 0 && Math.min(Math.abs(info.index - idx(d)), M - Math.abs(info.index - idx(d))) > 30 && info.dist < 9) continue;   // not across another leg
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.9), ads[ak++ % ads.length]);
    m.position.set(f.x, f.y + 1.45, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
  }
  for (const key of Object.keys(C)) {
    const f = frame(C[key] + 6, map.outside(world, C[key]) * (hw(C[key]) + 6.6));
    if (!free(f.x, f.z, 3)) continue;
    box(1.4, 2.4, 1.4, mat.orange, f.x, f.y - 0.1, f.z, f.yaw); box(1.7, 0.2, 1.7, mat.dark, f.x, f.y + 2.3, f.z, f.yaw);   // marshal post
  }
  for (const key of ['Turn 1', 'Turn 3', 'Turn 6']) {                                    // 100 / 50 brake boards
    const out = map.outside(world, C[key]);
    for (const m of [100, 50]) {
      const f = frame(C[key] - m - 6, -out * (hw(C[key]) + 2.6));
      if (!free(f.x, f.z, 1.4)) continue;
      const tex = bannerTexture(String(m), { bg: '#f1f1ec', fg: '#111', w: 128, h: 96 }); tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshLambertMaterial({ map: tex })); pm.position.set(f.x, f.y + 2.1, f.z); pm.rotation.y = Math.atan2(out * f.t.rx, out * f.t.rz); group.add(pm);
      box(0.08, 2.1, 0.08, mat.steel, f.x, f.y, f.z, f.yaw);
    }
  }
  for (let d = PIT.from; span(PIT.from, d) < span(PIT.from, 90); d += 38) {             // floodlight masts behind the stand side
    const f = frame(d, -(hw(d) + 4.4)); if (!free(f.x, f.z, 2)) continue; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 11, 7), mat.steel); m.position.set(f.x, f.y + 5.5, f.z); m.castShadow = true; group.add(m);
    box(2.4, 0.5, 0.7, mat.dark, f.x, f.y + 11, f.z, f.yaw + Math.PI / 2);
  }

  // ---- paddock: tents and a few parked vans behind the garages
  const tentCols = [0xc62828, 0x1d4f91, 0xf2b705, 0x2e7d32, 0xf3f3f0];
  for (let k = 0; k < 7; k++) {
    const d = PIT.from + 18 + k * 17, f = frame(d, glat1 + 14 + (k % 2) * 8), c = tentCols[k % tentCols.length];
    if (!free(f.x, f.z, 7)) continue;
    box(5, 2.6, 6, lam(c), f.x, f.y, f.z, f.yaw); box(5.6, 0.3, 6.6, mat.roof, f.x, f.y + 2.6, f.z, f.yaw); keepOut.push({ x: f.x, z: f.z, r: 6 });
    if (k % 2 === 0) { const v = frame(d + 8, glat1 + 26); if (!free(v.x, v.z, 6)) continue; box(2.4, 2.6, 6.4, lam(0xe8e8e8), v.x, v.y, v.z, v.yaw); keepOut.push({ x: v.x, z: v.z, r: 5 }); }
  }

  // ---- trees: a belt of woodland around the site, clear of the circuit and the paddock
  const trees = [];
  const tooClose = (x, z, r) => { const info = world.trackInfo(x, z); return info.index >= 0 && info.dist < r; };
  for (let tries = 0; tries < 20000 && trees.length < 260; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 20), z = (rand() * 2 - 1) * (world.half - 20);
    if (tooClose(x, z, 19) || keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 4) ** 2)) continue;
    const info = world.trackInfo(x, z), nearPit = info.index >= 0 && info.lat > 0 && (() => { const dd = map.dist(world, T[info.index]); return (dd > PIT.from - 20 || dd < PIT.to + 20) && info.dist < 60; })();
    if (nearPit) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 36)) continue;
    trees.push({ x, z });
  }
  const geos = [broadleafTree(5, { h: 10, crown: 4.4 }), birchTree(9, { h: 9 }), pineTree(4, { h: 12 }), broadleafTree(12, { h: 8, crown: 3.6, leaf: 0x5a8a3a })];
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  geos.forEach((g, v) => {
    const mine = trees.filter((_, k) => k % geos.length === v), im = new THREE.InstancedMesh(g, treeMat, Math.max(1, mine.length));
    mine.forEach((t, k) => { q.setFromAxisAngle(up, rand() * 6.28); const s = 0.85 + rand() * 0.45; pos.set(t.x, world.heightAtGrid(t.x, t.z) - 0.2, t.z); sc.set(s, s, s); m4.compose(pos, q, sc); im.setMatrixAt(k, m4); });
    im.count = mine.length; im.castShadow = true; group.add(im);
  });
}
