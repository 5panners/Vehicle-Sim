import * as THREE from 'three';
import { rng } from '../../world/noise.js';
import { broadleafTree, birchTree, pineTree, bannerTexture } from './lowpoly.js';
import { kartFloodlights } from './kart.js';
import { PADDOCK, COURSES } from '../../world/maps/sandown.js';

/**
 * Sandown Park kart circuit surroundings (low-poly): the racecourse either side (bright turf between white post-and-rail
 * fences), the racecourse grandstand across the far turf, the paddock and clubhouse at the west end, a race-control box
 * by the line, advertising on the tyre walls, marshal posts, floodlights all round and trees beyond the rails.
 */
export function buildSandownScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const C = map.corners;
  const rand = rng(1875);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const keepOut = [];
  const free = (x, z, r) => !T.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = { concrete: lam(0xd2cfc8, { map: view.detail }), white: lam(0xf4f4f0), rail: lam(0xfafafa), grey: lam(0x8d9196), dark: lam(0x2c2f33), roof: lam(0x5b6168),
    brick: lam(0x9a5a44), green: lam(0x2f5d3a), orange: lam(0xff7a1a), red: lam(0xc62828), cream: lam(0xece4d2),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.75, roughness: 0.35 }), glass: new THREE.MeshStandardMaterial({ color: 0x2b4258, metalness: 0.6, roughness: 0.12 }) };
  const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0, 0.5, 0);
  const box = (w, h, d, m, x, y, z, yaw = 0) => { const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = yaw; o.castShadow = h > 1.5; o.receiveShadow = true; group.add(o); return o; };
  const gy = (x, z) => world.heightAtGrid(x, z);
  /** a solid building the cars bump into (axis-aligned) */
  const solid = (x0, x1, z0, z1, h = 4) => {
    world.addWall([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], { height: h, thickness: 0.6, style: 'building' });
    keepOut.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 3 });
  };

  // ---- white edge lines along the circuit
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  view._ribbon({ offA: (t) => t.w / 2 - 0.18, offB: (t) => t.w / 2 - 0.02, yOff: 0.02, mat: lineMat, step: 1 });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.18), yOff: 0.02, mat: lineMat, step: 1 });

  // ---- the racecourse: white post-and-rail fences along both sides of each strip of turf
  {
    const X0 = -world.half + 10, X1 = world.half - 10, postGap = 3.2;
    const fences = [];
    for (const c of COURSES) fences.push(c.z0, c.z1);
    fences.push(COURSES[0].z0 + 5);                                    // the inner running rail on the near course
    const posts = [];
    for (const z of fences) {
      for (let x = X0; x < X1; x += 40) {                              // the rails in 40 m lengths (so they cull)
        const xm = Math.min(X1, x + 40), y = gy((x + xm) / 2, z);
        box(xm - x, 0.09, 0.09, mat.rail, (x + xm) / 2, y + 1.08, z);
        box(xm - x, 0.09, 0.09, mat.rail, (x + xm) / 2, y + 0.62, z);
      }
      for (let x = X0; x <= X1; x += postGap) posts.push([x, z]);
    }
    const pg = new THREE.BoxGeometry(0.1, 1.15, 0.1); pg.translate(0, 0.575, 0);
    const im = new THREE.InstancedMesh(pg, mat.rail, posts.length), m4 = new THREE.Matrix4();
    posts.forEach(([x, z], k) => { m4.makeTranslation(x, gy(x, z), z); im.setMatrixAt(k, m4); });
    group.add(im);
    // furlong-style distance markers on the far side of the near course
    for (let x = X0 + 30; x < X1; x += 100) { const z = COURSES[0].z1 + 1.2; box(0.35, 1.9, 0.35, mat.white, x, gy(x, z), z); box(0.6, 0.6, 0.12, mat.red, x, gy(x, z) + 1.6, z - 0.2); }
  }

  // ---- the racecourse grandstand across the far turf, with the hotel block beside it
  {
    const zf = COURSES[0].z1 + 34, x0 = -70, x1 = 95, y = gy(10, zf);
    const seat = lam(0x2a4d8f);
    for (let x = x0; x < x1; x += 33) {
      const w = Math.min(33, x1 - x), xm = x + w / 2;
      box(w, 7, 22, mat.cream, xm, y, zf + 11);                                  // the base: concourse and bars
      for (let r = 0; r < 9; r++) {                                              // terraced tiers rising away from the course, blue seats on each step
        const z = zf + 0.8 + r * 1.6, top = 7 + (r + 1) * 1.05;
        box(w, top, 1.6, mat.concrete, xm, y, z); box(w - 0.4, 0.3, 0.9, seat, xm, y + top, z + 0.2);
      }
      box(w + 0.4, 0.6, 26, mat.white, xm, y + 23, zf + 9);                     // cantilevered roof
      box(w, 7.5, 1, mat.glass, xm, y + 16, zf + 21);                           // glazed boxes at the back
    }
    for (let x = x0; x <= x1; x += 33) box(0.6, 23, 0.6, mat.steel, x, y, zf + 20);
    box(30, 18, 20, mat.white, x0 - 22, gy(x0 - 22, zf), zf + 10); box(30.6, 0.8, 20.6, mat.roof, x0 - 22, gy(x0 - 22, zf) + 18, zf + 10);   // hotel block
    box(28, 2.4, 1, mat.glass, x0 - 22, gy(x0 - 22, zf) + 9, zf - 0.1);
    box(14, 9, 12, mat.brick, x1 + 18, gy(x1 + 18, zf), zf + 8); box(14.6, 0.6, 12.6, mat.roof, x1 + 18, gy(x1 + 18, zf) + 9, zf + 8);
  }

  // ---- the paddock: clubhouse with its terrace, the open kart shelter, scales hut, tents and vans
  {
    const P = PADDOCK;
    // clubhouse: a long low building on the west side of the paddock, glass front onto the circuit
    const cx0 = P.x0 - 16, cx1 = P.x0 - 2, cz0 = -14, cz1 = 22, y = gy(cx0, 0);
    box(cx1 - cx0, 4.2, cz1 - cz0, mat.white, (cx0 + cx1) / 2, y, (cz0 + cz1) / 2);
    box(cx1 - cx0 + 1.2, 0.5, cz1 - cz0 + 1.2, mat.roof, (cx0 + cx1) / 2, y + 4.2, (cz0 + cz1) / 2);
    box(0.2, 2.6, cz1 - cz0 - 2, mat.glass, cx1 + 0.05, y + 0.9, (cz0 + cz1) / 2);
    box(4, 0.3, cz1 - cz0, mat.concrete, cx1 + 2, y, (cz0 + cz1) / 2);                    // terrace
    solid(cx0, cx1, cz0, cz1, 4.5);
    // the kart shelter: an open-sided canopy over the pit area, on posts
    const sx0 = P.x0 + 2, sx1 = P.x0 + 16, sz0 = P.z0 + 3, sz1 = P.z0 + 27, sy = gy(sx0, sz0);
    box(sx1 - sx0, 0.4, sz1 - sz0, mat.green, (sx0 + sx1) / 2, sy + 4.2, (sz0 + sz1) / 2);
    for (let x = sx0; x <= sx1; x += sx1 - sx0) for (let z = sz0; z <= sz1 + 0.01; z += 6) box(0.25, 4.2, 0.25, mat.steel, x, sy, z);
    // karts lined up under it (simple low boxes in team colours)
    const kc = [0xff6d00, 0x00b0ff, 0xffd600, 0xc62828, 0x2e7d32, 0xf3f3f0];
    for (let k = 0; k < 12; k++) { const x = sx0 + 3 + (k % 2) * 7, z = sz0 + 2 + (k >> 1) * 3.8; box(1.1, 0.35, 1.8, lam(kc[k % kc.length]), x, sy + 0.08, z); box(0.9, 0.18, 0.5, mat.dark, x, sy + 0.43, z + 0.35); }
    box(6, 2.8, 4, mat.white, P.x1 - 4, gy(P.x1 - 4, P.z1 - 4), P.z1 - 4); solid(P.x1 - 7, P.x1 - 1, P.z1 - 6, P.z1 - 2, 2.8);   // scales and race office
    const tents = [0xc62828, 0x1d4f91, 0xf2b705, 0xf3f3f0];
    for (let k = 0; k < 4; k++) { const x = P.x0 - 8 - (k % 2) * 7, z = -50 + k * 8; box(5, 2.6, 5, lam(tents[k]), x, gy(x, z), z); box(5.6, 0.3, 5.6, mat.white, x, gy(x, z) + 2.6, z); keepOut.push({ x, z, r: 5 }); }
    for (let k = 0; k < 3; k++) { const x = P.x0 - 26, z = -48 + k * 9; box(2.4, 2.7, 6.2, lam(0xe8e8e8), x, gy(x, z), z); keepOut.push({ x, z, r: 5 }); }
    keepOut.push({ x: (P.x0 + P.x1) / 2, z: (P.z0 + P.z1) / 2, r: 26 });
  }

  // ---- race control: a small two-storey box on the outside of the line, looking down the straight
  {
    const f = frame(6, -(hw(6) + 6.5));
    if (free(f.x, f.z, 4)) {
      box(5, 3, 4, mat.white, f.x, f.y, f.z, f.yaw); box(5.4, 2.4, 4.4, mat.glass, f.x, f.y + 3, f.z, f.yaw); box(5.8, 0.4, 4.8, mat.dark, f.x, f.y + 5.4, f.z, f.yaw);
      world.addWall([[f.x - 2.6, f.z - 2.6], [f.x + 2.6, f.z - 2.6], [f.x + 2.6, f.z + 2.6], [f.x - 2.6, f.z + 2.6], [f.x - 2.6, f.z - 2.6]], { height: 5.4, thickness: 0.4, style: 'building' });
      keepOut.push({ x: f.x, z: f.z, r: 6 });
    }
  }

  // ---- advertising boards on the tyre walls, marshal posts
  const WORDS = [['KART CLUB', '#0b3d7a', '#fff'], ['TWO-STROKE', '#111', '#ffc400'], ['GRID GARAGE', '#c62828', '#fff'], ['LATE APEX', '#e8e8e8', '#111'], ['TURF & TARMAC', '#1b5e20', '#fff']];
  const ads = WORDS.map(([t, bg, fg]) => { const x = bannerTexture(t, { bg, fg, w: 512, h: 96 }); x.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: x }); });
  let ak = 0;
  for (let d = 0; d < L; d += 16) {
    const side = map.outside(world, d), off = hw(d) + 4.2;
    const f = frame(d, side * off), info = world.trackInfo(f.x, f.z);
    if (!free(f.x, f.z, 2.4)) continue;
    if (info.index >= 0 && Math.min(Math.abs(info.index - idx(d)), M - Math.abs(info.index - idx(d))) > 30 && info.dist < 9) continue;   // not across another leg
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.9), ads[ak++ % ads.length]);
    m.position.set(f.x, f.y + 1.45, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
  }
  for (const key of Object.keys(C)) {
    const f = frame(C[key] + 6, map.outside(world, C[key]) * (hw(C[key]) + 5.8));
    if (!free(f.x, f.z, 3)) continue;
    box(1.4, 2.4, 1.4, mat.orange, f.x, f.y - 0.1, f.z, f.yaw); box(1.7, 0.2, 1.7, mat.dark, f.x, f.y + 2.3, f.z, f.yaw);
  }

  // ---- floodlights all round (they light the track after dusk)
  kartFloodlights(view, group, { frame, hw, free, keepOut, BOX, box, mat, every: 40, start: 10 });

  // ---- trees: beyond the racecourse rails and round the ends of the site, plus a clipped hedge along the south road
  const trees = [];
  const inCourse = (z) => COURSES.some((c) => z > c.z0 - 4 && z < c.z1 + 4);
  for (let tries = 0; tries < 30000 && trees.length < 320; tries++) {
    const x = (rand() * 2 - 1) * (world.half - 15), z = (rand() * 2 - 1) * (world.half - 15);
    if (inCourse(z) || (z > -60 && z < 63 && x > -175 && x < 150)) continue;          // the racecourse and the circuit site stay open
    if (z > COURSES[0].z1 + 4 && z < COURSES[0].z1 + 70 && x > -130 && x < 150) continue;    // the grandstand and the lawn in front of it
    if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 4) ** 2)) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 49)) continue;
    trees.push({ x, z });
  }
  const geos = [broadleafTree(5, { h: 11, crown: 4.8 }), birchTree(9, { h: 9 }), pineTree(4, { h: 13 }), broadleafTree(12, { h: 9, crown: 4, leaf: 0x5a8a3a })];
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  geos.forEach((g, v) => {
    const mine = trees.filter((_, k) => k % geos.length === v), im = new THREE.InstancedMesh(g, treeMat, Math.max(1, mine.length));
    mine.forEach((t, k) => { q.setFromAxisAngle(up, rand() * 6.28); const s = 0.85 + rand() * 0.45; pos.set(t.x, gy(t.x, t.z) - 0.2, t.z); sc.set(s, s, s); m4.compose(pos, q, sc); im.setMatrixAt(k, m4); });
    im.count = mine.length; im.castShadow = true; group.add(im);
  });
  // hedge along the south road, in 30 m lengths
  const hedge = lam(0x2d5a2a);
  for (let x = -world.half + 20; x < world.half - 20; x += 30) { const z = 59, y = gy(x + 15, z); box(29.5, 2.2, 1.6, hedge, x + 15, y, z); }
}
