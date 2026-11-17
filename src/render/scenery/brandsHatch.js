import * as THREE from 'three';
import { rng } from '../../world/noise.js';
import { labelSprite } from '../WorldView.js';
import { broadleafTree, birchTree, bareTree, pineTree, farTree, garageFacade, officeFacade, seatTexture, bannerTexture } from './lowpoly.js';

/**
 * Brands Hatch surroundings (low-poly, modelled on reference photos):
 *  - pit lane, two-storey garages (glazed upper floor, red fascia, roller doors), paddock
 *  - race control tower with the red drum top, white multi-storey hospitality/media block
 *  - scaffold grandstands with red seats + banners (Brabham Straight, Paddock Hill, Druids),
 *    covered blue-seat stand at Clark Curve, red hospitality barns in the infield
 *  - advertising bridge over Hailwood Hill, footbridges, floodlight masts, ad boards,
 *    marshal posts, 3/2/1 brake boards, green-painted run-off strips
 *  - broadleaf woodland (oak/beech/ash, silver birch, bare spring trees, a few pines) in
 *    culling-friendly tiles; West Kingsdown housing; the M20; a grass car park.
 * Everything is placed by distance along the lap + lateral offset (+ = right of travel).
 */
export function buildBrandsScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = 3908;
  const C = map.corners, PIT = map.pit;
  const rand = rng(1967);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => {
    const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat;
    return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t };
  };
  const hw = (d) => T[idx(d)].w / 2;
  const keepOut = [];
  const free = (x, z, r) => !keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + r) ** 2) && map.nearestTrack(world, x, z).d > r + 14;
  const group = new THREE.Group(); scene.add(group);

  // ---- materials
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = {
    concrete: lam(0xd2cfc8, { map: view.detail }), white: lam(0xf3f3f0), grey: lam(0x8d9196), dark: lam(0x2c2f33),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.75, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2b4258, metalness: 0.6, roughness: 0.12 }),
    red: lam(0xc62828), roof: lam(0xe9ecef), orange: lam(0xff7a1a), brick: lam(0x9c5a3c), barn: lam(0xa3261f),
    green: lam(0x3f9a78, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
  const box = (w, h, d, m, x, y, z, yaw = 0, parent = group) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = yaw;
    o.castShadow = h > 1.5; o.receiveShadow = true; parent.add(o); return o;
  };
  // a textured face (PlaneGeometry) facing direction `face` (yaw of its normal)
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
  /** lowest ground under a footprint (d0..d1 along, lat0..lat1 across), sunk a little so nothing floats */
  const groundUnder = (d0, d1, lat0, lat1) => {
    let y = Infinity;
    for (const d of [d0, (d0 + d1) / 2, d1]) for (const lat of [lat0, (lat0 + lat1) / 2, lat1]) y = Math.min(y, frame(d, lat).y);
    return y - 0.25;
  };
  /** structure following the track between d0..d1 at lateral lat0..lat1 (bends with the circuit);
   *  each segment sits on its own ground (stepping with the slope); pass `bases` to stack on another */
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
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;

  // ============================================================ surfaces painted on the track side
  // pit lane with its entry and exit lanes (they grow out of the track edge)
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 - 7, t.w / 2];   // zero width just outside the lanes
  view._ribbon({ offA: (t) => Math.max(band(t)[0], t.w / 2 - 0.05), offB: (t) => Math.max(band(t)[1], t.w / 2), yOff: 0.06, mat: view.asphaltMaterial(), uvScale: 14, from: idx(PIT.entry), to: idx(PIT.exit) + M, cols: 6, step: 1 });
  // white line along the pit-lane edges of the entry/exit lanes
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const [a, b] of [[PIT.entry, PIT.from + 10], [PIT.to - 10, PIT.exit]]) {
    view._ribbon({ offA: (t) => band(t)[1] - 0.25, offB: (t) => band(t)[1], yOff: 0.07, mat: lineMat, from: idx(a), to: idx(b) + (b < a ? M : 0), step: 1 });
    view._ribbon({ offA: (t) => Math.max(band(t)[0], t.w / 2), offB: (t) => Math.max(band(t)[0] + 0.25, t.w / 2), yOff: 0.07, mat: lineMat, from: idx(a), to: idx(b) + (b < a ? M : 0), step: 1 });
  }
  view._ribbon({ offA: (t) => t.w / 2 + 15.5, offB: (t) => t.w / 2 + 21, yOff: 0.06, cols: 3, mat: lam(0x9c9a94, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), from: idx(PIT.from), to: idx(PIT.to) + M });
  const tarmac = lam(0x55575a, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  view._ribbon({ offA: (t) => -(t.w / 2 + Math.max(1.3, map.tarmacDepth(world, t, -1))), offB: (t) => -(t.w / 2 + 1.25), yOff: 0.09, cols: 12, step: 1, mat: tarmac, from: idx(C.Clearways - 60), to: idx(C.Clearways + 90) });
  // green-painted run-off beside the kerbs (as in the photos)
  const kerb = (t) => t.kerb;
  view._ribbon({ offA: (t) => t.w / 2 + 1.2, offB: (t) => t.w / 2 + 3.4, yOff: 0.045, mat: mat.green, filter: (t) => t.kerb && !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 + 3.4), offB: (t) => -(t.w / 2 + 1.2), yOff: 0.045, mat: mat.green, filter: kerb });
  // grid boxes behind the start line
  for (let k = 1; k <= 12; k++) {
    const f = frame(-8 * k, (k % 2 ? -1 : 1) * 3.2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), mat.white); m.rotation.x = -Math.PI / 2; m.rotation.z = f.yaw;
    m.position.set(f.x, f.y + 0.06, f.z); group.add(m);
  }

  // ============================================================ pit garages
  const h0 = hw(0), gFrom = PIT.from + 30, gTo = PIT.to - 45;
  const gar = along(gFrom, gTo, h0 + 21, h0 + 36, 7.8, mat.concrete, { collide: true });
  const onGar = { bases: gar.bases };
  along(gFrom, gTo, h0 + 21, h0 + 36.3, 0.35, mat.grey, { y0: 7.8, ...onGar });             // flat grey roof
  along(gFrom, gTo, h0 + 20.4, h0 + 21.2, 1.1, mat.red, { y0: 7.4, ...onGar });              // red fascia band on the pit-lane edge
  along(gFrom, gTo, h0 + 26, h0 + 33, 1.6, mat.grey, { y0: 8.15, ...onGar });                // roof plant
  const facadeMat = new THREE.MeshLambertMaterial({ map: garageFacade(1) });
  for (const s of gar.segs) { // façade on the pit-lane face, one garage bay per ~9 m
    const fx = s.x - s.t.rx * 7.52, fz = s.z - s.t.rz * 7.52;
    panel(s.len + 0.6, 7.8, facadeMat, fx, s.base, fz, Math.atan2(-s.t.rx, -s.t.rz), (s.len + 0.6) / 9);
  }
  // race control tower (red drum top) near the pit exit
  {
    const f = frame(PIT.to - 25, h0 + 31), y = f.y;
    box(7, 17, 7, mat.concrete, f.x, y, f.z, f.yaw);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3.4, 20), mat.glass); drum.position.set(f.x, y + 18.7, f.z); group.add(drum);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.4, 2.6, 20), mat.red); cap.position.set(f.x, y + 21.7, f.z); cap.castShadow = true; group.add(cap);
    box(0.15, 6, 0.15, mat.white, f.x, y + 23, f.z); solid(f.x, f.z, 9, 9, f.yaw, 20);
  }
  // paddock service road behind the garages (on the shelf), with team trucks parked along it;
  // beyond it the ground falls away to Cooper Straight, which stays clear
  view._ribbon({ offA: (t) => t.w / 2 + 36.3, offB: (t) => t.w / 2 + 44, yOff: 0.06, cols: 3, mat: lam(0x6f7174, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), from: idx(gFrom), to: idx(gTo) + M });
  const teamCols = [0xc62828, 0x1565c0, 0xf9a825, 0x2e7d32, 0x212121, 0xffffff, 0x6a1b9a];
  for (let d = gFrom + 20, k = 0; span(gFrom, d) < span(gFrom, gTo) - 20; d += 21, k++) {
    if (k % 4 === 3) continue;                                    // gaps between the rigs
    const f = frame(d, h0 + 39.6), y = groundUnder(d - 9, d + 9, h0 + 38, h0 + 41);
    box(2.6, 3.2, 13.6, lam(teamCols[k % teamCols.length]), f.x, y + 0.9, f.z, f.yaw);       // trailer
    box(2.5, 3.0, 2.4, mat.white, f.x + f.t.tx * 8.2, y, f.z + f.t.tz * 8.2, f.yaw);        // cab
    box(2.4, 0.9, 13.6, mat.dark, f.x, y, f.z, f.yaw);                                        // chassis / wheels
    solid(f.x + f.t.tx * 1.5, f.z + f.t.tz * 1.5, 2.6, 17, f.yaw);
  }

  // ============================================================ white hospitality / media centre
  {
    const officeMat = new THREE.MeshLambertMaterial({ map: officeFacade(3, 12, { band: '#c62828' }) });
    for (const [d0, d1] of [[3825, 3905], [3912, 3990]]) { // two linked blocks behind the main stand
      const b = along(d0, d1, -(h0 + 66), -(h0 + 82), 11, mat.white, { collide: true, segLen: 40 });
      along(d0 + 6, d1 - 6, -(h0 + 69), -(h0 + 80), 3.4, mat.glass, { y0: 11, bases: b.bases, segLen: 40 }); // glazed top floor
      along(d0 + 4, d1 - 4, -(h0 + 68), -(h0 + 81), 0.4, mat.white, { y0: 14.4, bases: b.bases, segLen: 40 });
      for (const s of b.segs) panel(s.len + 0.6, 11, officeMat, s.x + s.t.rx * 8.02, s.base, s.z + s.t.rz * 8.02, Math.atan2(s.t.rx, s.t.rz), (s.len + 0.6) / 24);
    }
  }

  // ============================================================ grandstands
  const seatMats = { red: new THREE.MeshLambertMaterial({ map: seatTexture('#c2185b') }), blue: new THREE.MeshLambertMaterial({ map: seatTexture('#1f4e9a') }) };
  const bannerMat = new THREE.MeshLambertMaterial({ map: bannerTexture('BRANDS HATCH  ·  MOTOR RACING CIRCUIT') });
  /** scaffold grandstand: steel legs, raked seating rows (seat texture), banner on the front, rear fence */
  const scaffoldStand = (d0, d1, side, latFront, { rows = 9, riser = 0.55, depth = 0.95, lift = 1.8, seats = seatMats.red } = {}) => {
    const s = side, segLen = 14, n = Math.max(1, Math.round(span(d0, d1) / segLen)), len = span(d0, d1) / n;
    let base;
    for (let k = 0; k < n; k++) {
      const mid = latFront + (rows * depth) / 2, f = frame(d0 + (k + 0.5) * len, s * mid);
      base = groundUnder(d0 + k * len, d0 + (k + 1) * len, s * latFront, s * (latFront + rows * depth));
      const yaw = f.yaw, faceYaw = Math.atan2(-s * f.t.rx, -s * f.t.rz); // seats face the track
      for (let r = 0; r < rows; r++) {
        const g = frame(d0 + (k + 0.5) * len, s * (latFront + (r + 0.5) * depth));
        const stepTop = base + lift + (r + 1) * riser;
        box(depth, 0.12, len, mat.dark, g.x, stepTop - 0.12, g.z, yaw);                                   // tread
        panel(len, riser, seats, g.x - s * g.t.rx * depth * 0.5, stepTop - riser, g.z - s * g.t.rz * depth * 0.5, faceYaw, len / 6); // seat row
      }
      // scaffold legs
      for (let r = 0; r <= rows; r += 3) for (const u of [-0.5, 0, 0.5]) {
        const g = frame(d0 + (k + 0.5 + u * 0.98) * len, s * (latFront + r * depth));
        box(0.12, lift + r * riser + 0.1, 0.12, mat.steel, g.x, base - 0.3, g.z, yaw);
      }
      const back = frame(d0 + (k + 0.5) * len, s * (latFront + rows * depth + 0.1));
      box(0.08, 1.2, len, mat.steel, back.x, base + lift + rows * riser, back.z, yaw);                 // rear rail
      const fr = frame(d0 + (k + 0.5) * len, s * (latFront - 0.05));
      panel(len, lift, bannerMat, fr.x, base, fr.z, faceYaw, 1);                                     // front banner
      solid(f.x, f.z, rows * depth + 1, len, yaw, lift + rows * riser);
    }
  };
  /** covered stand: concrete base, seats under a cantilever roof split into bays */
  const coveredStand = (d0, d1, side, latFront, { rows = 12, riser = 0.5, depth = 0.9, seats = seatMats.blue, bays = 4 } = {}) => {
    const s = side, n = bays, len = span(d0, d1) / n;
    let base;
    for (let k = 0; k < n; k++) {
      const mid = latFront + (rows * depth) / 2, f = frame(d0 + (k + 0.5) * len, s * mid);
      base = groundUnder(d0 + k * len, d0 + (k + 1) * len, s * latFront, s * (latFront + rows * depth));
      const faceYaw = Math.atan2(-s * f.t.rx, -s * f.t.rz);
      for (let r = 0; r < rows; r++) {
        const g = frame(d0 + (k + 0.5) * len, s * (latFront + (r + 0.5) * depth));
        const top = base + 1.2 + (r + 1) * riser;
        box(depth, top - base, len - 0.8, mat.concrete, g.x, base, g.z, f.yaw);
        panel(len - 0.8, riser, seats, g.x - s * g.t.rx * depth * 0.5, top - riser, g.z - s * g.t.rz * depth * 0.5, faceYaw, len / 6);
      }
      const rH = base + 1.2 + rows * riser + 3.5;
      const roof = frame(d0 + (k + 0.5) * len, s * (latFront + rows * depth * 0.45));
      const r = box(rows * depth + 2.5, 0.35, len - 0.4, mat.roof, roof.x, rH, roof.z, f.yaw); r.rotation.z = s * 0.08;
      const bk = frame(d0 + (k + 0.5) * len, s * (latFront + rows * depth + 0.4));
      box(0.5, rH - base, len - 0.4, mat.grey, bk.x, base, bk.z, f.yaw);
      for (const u of [-0.5, 0.5]) { const p = frame(d0 + (k + 0.5 + u) * len, s * (latFront + rows * depth)); box(0.4, rH - base, 0.4, mat.steel, p.x, base, p.z, f.yaw); }
      solid(f.x, f.z, rows * depth + 1, len, f.yaw, rH - base);
    }
  };
  scaffoldStand(3700, 3895, -1, h0 + 11, { rows: 12 });                                                            // Brabham Straight
  scaffoldStand(C['Paddock Hill Bend'] - 70, C['Paddock Hill Bend'] + 15, -1, hw(C['Paddock Hill Bend']) + 44, { rows: 10 }); // Paddock Hill (outside)
  scaffoldStand(C.Druids - 45, C.Druids + 35, -1, hw(C.Druids) + 33, { rows: 8 });                                // Druids
  coveredStand(C['Clark Curve'] - 60, C['Clark Curve'] + 100, -1, hw(C['Clark Curve']) + 26, { bays: 5 });          // Clark Curve
  for (const [d0, d1, lat] of [[3700, 3895, h0 + 11], [C['Clark Curve'] - 60, C['Clark Curve'] + 100, hw(C['Clark Curve']) + 26]]) keepOut.push({ ...frame((d0 + d1 + (d1 < d0 ? L : 0)) / 2, -(lat + 10)), r: span(d0, d1) / 2 + 20 });

  // ============================================================ Hailwoods, Kentagon, red barns
  {
    const f = frame(C['Paddock Hill Bend'] + 260, -(hw(C['Paddock Hill Bend']) + 62));
    box(26, 7, 16, mat.brick, f.x, f.y, f.z, f.yaw + 0.3); box(28, 1, 18, mat.dark, f.x, f.y + 7, f.z, f.yaw + 0.3); solid(f.x, f.z, 26, 16, f.yaw + 0.3, 8);
    const s = labelSprite('HAILWOODS', { scale: 1.6 }); s.position.set(f.x, f.y + 9.5, f.z); group.add(s);
  }
  {
    const f = frame(95, -(h0 + 46));
    const k = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 8, 8), mat.concrete); k.position.set(f.x, f.y + 4, f.z); k.castShadow = true; group.add(k);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 14.5, 1, 8), mat.dark); r.position.set(f.x, f.y + 8.5, f.z); group.add(r); solid(f.x, f.z, 24, 24, 0, 9);
  }
  // red hospitality barns (gabled) in the infield off Cooper Straight
  const gable = new THREE.CylinderGeometry(1, 1, 1, 3); gable.rotateZ(Math.PI / 2); gable.rotateX(Math.PI / 2); gable.translate(0, 0.25, 0);
  let barns = 0;
  for (let d = C['Graham Hill Bend'] + 60; d < C.Surtees - 40 && barns < 4; d += 45) {
    const f = frame(d, hw(d) + 34 + (barns % 2) * 6);
    if (!free(f.x, f.z, 14)) continue;
    box(11, 4.5, 20, mat.barn, f.x, f.y, f.z, f.yaw + 0.15);
    const g = new THREE.Mesh(gable, mat.white); g.scale.set(7.4, 3, 21); g.position.set(f.x, f.y + 4.5, f.z); g.rotation.y = f.yaw + 0.15; g.castShadow = true; group.add(g);
    solid(f.x, f.z, 11, 20, f.yaw + 0.15, 6); barns++;
  }

  // ============================================================ bridges
  const bridge = (d, { banner = null } = {}) => {
    const f = frame(d), w = f.t.w / 2 + 11, yaw = f.yaw, ty = f.y + 5.8;
    box(2 * w, 0.7, 3, mat.concrete, f.x, ty, f.z, yaw).castShadow = true;
    for (const s of [-1, 1]) {
      box(2 * w, 1.1, 0.1, mat.steel, f.x + f.t.tx * s * 1.45, ty + 0.7, f.z + f.t.tz * s * 1.45, yaw);
      const p = frame(d, s * (w - 1.5)); box(3.2, ty - p.y + 0.7, 3.2, mat.concrete, p.x, p.y, p.z, yaw); solid(p.x, p.z, 3.2, 3.2, yaw, 7);
    }
    if (banner) { // advertising panels on both faces, hung below the deck
      const tex = new THREE.MeshLambertMaterial({ map: bannerTexture(banner, { bg: '#f5f5f5', fg: '#173f8f', w: 1024, h: 96 }), side: THREE.DoubleSide });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2 * w - 4, 2.2), tex); p.position.set(f.x - f.t.tx * 1.6, ty - 0.4, f.z - f.t.tz * 1.6); p.rotation.y = yaw + Math.PI; group.add(p);
    }
  };
  bridge(C.Druids - 75, { banner: 'BRANDS HATCH  ·  KENT' });     // the advertising bridge at the top of Hailwood Hill
  bridge(C["Pilgrim's Drop"] - 150);
  bridge(C["Sheene's"] + 110);

  // ============================================================ floodlights, ad boards, marshal posts, brake boards
  const lampHead = lam(0xf5f3e6, { emissive: 0x333322 });
  for (let d = 3600; d < 3906 + 200; d += 70) for (const s of [-1, 1]) {
    const f = frame(d, s * (hw(d) + (s > 0 ? 40 : 10)));
    if (!free(f.x, f.z, 1)) continue;
    box(0.35, 22, 0.35, mat.steel, f.x, f.y, f.z, f.yaw); box(2.4, 1.2, 0.5, lampHead, f.x, f.y + 22, f.z, f.yaw);
  }
  const ads = ['MOTORSPORT TV', 'RACE DAY', 'RADIO BRANDS 87.7', 'BRANDS HATCH', 'THE MOST POWERFUL LAP IN KENT'];
  const adMats = ads.map((t) => new THREE.MeshLambertMaterial({ map: bannerTexture(t) }));
  const boardTex = {};
  const board = (n) => boardTex[n] || (boardTex[n] = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 80; const g = c.getContext('2d');
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, 64, 80); g.fillStyle = '#fff'; g.fillRect(6, 6, 52, 68);
    g.fillStyle = '#111'; g.font = 'bold 54px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 42);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: t });
  })());
  const PLANE = new THREE.PlaneGeometry(1, 1);
  let adI = 0;
  for (const [name, d] of Object.entries(C)) {
    // marshal post and ad boards stand just behind the barrier on the outside of the corner
    const outside = map.outside(world, d);
    const behind = (dd, extra) => { const s = T[idx(dd)]; return outside * (s.w / 2 + map.barrierOffset(world, s, outside) + extra); };
    const mp = frame(d + 25, behind(d + 25, 3));
    if (free(mp.x, mp.z, 2)) { box(2.4, 2.4, 2.4, mat.white, mp.x, mp.y, mp.z, mp.yaw); box(2.8, 0.25, 2.8, mat.orange, mp.x, mp.y + 2.4, mp.z, mp.yaw); }
    for (let k = -1; k <= 1; k++) { // ad boards facing the track at the corner exit
      const a = frame(d + 40 + k * 8, behind(d + 40 + k * 8, 1.2));
      const m = new THREE.Mesh(PLANE, adMats[adI++ % adMats.length]); m.scale.set(7, 1.3, 1); m.position.set(a.x, a.y + 1.3, a.z); m.rotation.y = Math.atan2(-outside * a.t.rx, -outside * a.t.rz); group.add(m);
      box(7, 0.05, 0.05, mat.dark, a.x, a.y + 0.6, a.z, a.yaw + Math.PI / 2);
    }
    if (['Paddock Hill Bend', 'Druids', 'Hawthorn Bend', 'Westfield Bend', 'Clearways', 'Surtees'].includes(name)) {
      for (const n of [3, 2, 1]) {
        const b = frame(d - 70 - n * 30, outside * (frame(d - 70 - n * 30).t.w / 2 + 3.6));
        box(0.1, 1.2, 0.1, mat.dark, b.x, b.y, b.z, b.yaw);
        const p = new THREE.Mesh(PLANE, board(n)); p.scale.set(1.1, 1.4, 1); p.position.set(b.x, b.y + 1.9, b.z); p.rotation.y = b.yaw + Math.PI; group.add(p);
      }
    }
  }

  // ============================================================ M20, car park, housing
  const mw = map.motorway;
  if (mw) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#4a4c50'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#eee';
    for (const u of [4, 41, 62, 66, 87, 124]) g.fillRect(u - 1, 0, 2, u === 62 || u === 66 || u === 4 || u === 124 ? 64 : 30);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const segs = 120, pos = [], uv = [], ind = [];
    for (let k = 0; k <= segs; k++) {
      const a = -mw.len + (2 * mw.len * k) / segs, cx = mw.ox + mw.dx * a, cz = mw.oz + mw.dz * a;
      for (const s of [-1, 1]) { const x = cx + mw.dz * s * mw.half, z = cz - mw.dx * s * mw.half; pos.push(x, world.heightAtGrid(x, z) + 0.06, z); uv.push(s < 0 ? 0 : 1, a / 12); }
      if (k) { const b = (k - 1) * 2; ind.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ind); geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 })); road.receiveShadow = true; group.add(road);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S = new THREE.Vector3();
  const cars = [], CAR_COLS = [0xffffff, 0x111111, 0x9e9e9e, 0xc62828, 0x1565c0, 0x455a64, 0xf5f5f5, 0x2e7d32];
  if (mw) for (let k = 0; k < 40; k++) { const a = -mw.len + rand() * 2 * mw.len, lane = (rand() < 0.5 ? -1 : 1) * (3 + Math.floor(rand() * 3) * 3.6); cars.push([mw.ox + mw.dx * a + mw.dz * lane, mw.oz + mw.dz * a - mw.dx * lane, Math.atan2(mw.dx, mw.dz) + (lane > 0 ? Math.PI : 0)]); }
  for (let d = 3560; d < 3700; d += 7) for (let row = 0; row < 6; row++) { // grass car park off Clark Curve
    if (rand() < 0.25) continue;
    const f = frame(d, -(hw(d) + 50 + row * 9));
    if (free(f.x, f.z, 1)) cars.push([f.x, f.z, f.yaw + Math.PI / 2]);
  }
  const carMesh = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial(), cars.length);
  cars.forEach(([x, z, yaw], i) => { q.setFromAxisAngle(up, yaw); m4.compose(V.set(x, world.heightAtGrid(x, z), z), q, S.set(1.8, 1.4, 4.4)); carMesh.setMatrixAt(i, m4); carMesh.setColorAt(i, new THREE.Color(CAR_COLS[Math.floor(rand() * CAR_COLS.length)])); });
  carMesh.castShadow = true; group.add(carMesh);
  keepOut.push({ ...frame(3630, -(hw(3630) + 75)), r: 90 });

  const hz = map.houses, houses = [];
  for (let x = hz.x0 + 20; x < hz.x1 - 10; x += 64) for (let z = hz.z0 + 10; z < hz.z1 - 10; z += 15) for (const s of [-1, 1]) {
    const hx = x + s * 13 + (rand() - 0.5) * 2, hzz = z + (rand() - 0.5) * 3;
    if (map.nearestTrack(world, hx, hzz).d < 70 || rand() < 0.12) continue;
    houses.push([hx, hzz, s < 0 ? -Math.PI / 2 : Math.PI / 2]);
  }
  const wallsH = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial(), houses.length);
  const roofsH = new THREE.InstancedMesh(gable, new THREE.MeshLambertMaterial(), houses.length);
  const chim = new THREE.InstancedMesh(BOX, lam(0x8a4a34), houses.length);
  const HOUSE = [0xb46a4a, 0xe8dcc4, 0xa45a3a, 0xd9cbb0, 0xc08060, 0xf0ece2], ROOF = [0x5b4a42, 0x3f3f44, 0x6d4c41, 0x7a3b2e];
  houses.forEach(([x, z, yaw], i) => {
    const y = world.heightAtGrid(x, z), w = 7 + rand() * 2, d = 8 + rand() * 3;
    q.setFromAxisAngle(up, yaw);
    m4.compose(V.set(x, y, z), q, S.set(w, 5.2, d)); wallsH.setMatrixAt(i, m4); wallsH.setColorAt(i, new THREE.Color(HOUSE[i % HOUSE.length]));
    m4.compose(V.set(x, y + 5.2, z), q, S.set(w * 0.62, 2.6, d * 1.05)); roofsH.setMatrixAt(i, m4); roofsH.setColorAt(i, new THREE.Color(ROOF[i % ROOF.length]));
    m4.compose(V.set(x + Math.cos(yaw) * w * 0.3, y + 5.5, z - Math.sin(yaw) * w * 0.3), q, S.set(0.7, 3, 0.7)); chim.setMatrixAt(i, m4);
  });
  wallsH.castShadow = roofsH.castShadow = true; group.add(wallsH, roofsH, chim);
  for (let x = hz.x0 + 20; x < hz.x1 - 10; x += 64) {
    const z0 = hz.z0 + 5, z1 = hz.z1 - 5, n = 40, pos = [], ind = [];
    for (let k = 0; k <= n; k++) { const z = z0 + (z1 - z0) * k / n; for (const s of [-1, 1]) { const px = x + s * 3.5; pos.push(px, world.heightAtGrid(px, z) + 0.05, z); } if (k) { const b = (k - 1) * 2; ind.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, tarmac));
  }

  // ============================================================ woodland (tiled instancing so it culls)
  // each variant: full model up close, a ~45-triangle stand-in beyond LOD_FAR metres
  const VARIANTS = [
    { geo: broadleafTree(11, { h: 13, crown: 5.5 }), far: farTree(11, { h: 13, crown: 5.5 }), w: 26 },                                   // oak
    { geo: broadleafTree(23, { h: 15, crown: 4.6, leaf: 0x5a8a3a }), far: farTree(23, { h: 15, crown: 4.6, leaf: 0x5a8a3a }), w: 20 },   // beech / ash
    { geo: broadleafTree(37, { h: 10, crown: 4.2, leaf: 0x3f6f30 }), far: farTree(37, { h: 10, crown: 4.2, leaf: 0x3f6f30 }), w: 18 },   // younger oak
    { geo: birchTree(5, { h: 12 }), far: farTree(5, { h: 12, crown: 2.6, leaf: 0x7aa44a, bark: 0xe6e2da }), w: 10 },                     // silver birch
    { geo: bareTree(41, { h: 13 }), far: farTree(41, { h: 13, crown: 4.5, bare: true, bark: 0x5a4a3c }), w: 13 },                        // bare (spring)
    { geo: bareTree(77, { h: 10 }), far: farTree(77, { h: 10, crown: 3.6, bare: true, bark: 0x5a4a3c }), w: 8 },
    { geo: pineTree(3, { h: 16 }), far: farTree(3, { h: 16, crown: 2.6, leaf: 0x2f5530, bark: 0x6b4a33 }), w: 5 },                        // Scots pine
  ];
  const LOD_FAR = 260;
  const wsum = VARIANTS.reduce((a, v) => a + v.w, 0);
  const pick = () => { let r = rand() * wsum; for (let i = 0; i < VARIANTS.length; i++) { r -= VARIANTS[i].w; if (r <= 0) return i; } return 0; };
  const TILE = 220, tiles = new Map();
  let placed = 0;
  for (let tries = 0; tries < 140000 && placed < 7500; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 12), z = (rand() * 2 - 1) * (world.half - 12);
    const dens = map.forest(world, x, z);
    if (dens <= 0 || rand() > dens * 0.85) continue;
    if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, VARIANTS.map(() => []));
    tiles.get(key)[pick()].push([x, z, 0.75 + rand() * 0.55, rand() * 6.28]);
    placed++;
  }
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const tint = new THREE.Color();
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
        const c = tint.setHSL(0, 0, 0.88 + rand() * 0.24); hi.setColorAt(i, c); lo.setColorAt(i, c);
      });
      hi.computeBoundingSphere(); lo.computeBoundingSphere();
      hi.castShadow = true; hi.receiveShadow = true;   // distant stand-ins don't need shadows
      near.add(hi); far.add(lo);
    });
    lod.addLevel(near, 0); lod.addLevel(far, LOD_FAR);
    group.add(lod);
  }

  return { trees: placed, houses: houses.length, cars: cars.length, tiles: tiles.size };
}
