import * as THREE from 'three';
import { rng, fbm } from '../../world/noise.js';
import { SURF } from '../../world/Surfaces.js';
import { lighting } from '../lighting.js';
import { Workshops } from './workshop.js';
import { mergeParts, broadleafTree, farTree, garageFacade, seatTexture, bannerTexture } from './lowpoly.js';
import { TreeTiles } from './treelod.js';
import { RAVINE, LAKE, TUNNEL } from '../../world/maps/rocky.js';

/**
 * Rocky Mountain surroundings (low-poly): Silver Bow Lake, the Grand Prix paddock with kart-style garages, tower and stand,
 * the Cliffhanger Tunnel (a lined gallery under a rock mass), the red steel truss bridge over the ravine with Eagle's Nest Falls
 * and its plunge pool, sign boards naming each section, boulders, and tiled spruce forest on the lower slopes.
 */
export function buildRockyScenery(view) {
  const { world, scene } = view, map = world.map, T = world.track, M = T.length, L = map.length;
  const PIT = map.pit, C = map.corners;
  const rand = rng(31337);
  const idx = (d) => Math.round((((d % L) + L) % L) * M / L) % M;
  const frame = (d, lat = 0) => { const t = T[idx(d)], x = t.x + t.rx * lat, z = t.z + t.rz * lat; return { x, z, y: world.heightAtGrid(x, z), yaw: Math.atan2(t.tx, t.tz), t }; };
  const hw = (d) => T[idx(d)].w / 2;
  const span = (d0, d1) => (d1 < d0 ? d1 + L : d1) - d0;
  const nearestIdx = (x, z) => { let bi = 0, bd = 1e12; for (let i = 0; i < M; i += 2) { const d = (T[i].x - x) ** 2 + (T[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const keepOut = [];
  const free = (x, z, r) => !T.some((s, i) => i % 2 === 0 && (s.x - x) ** 2 + (s.z - z) ** 2 < (s.w / 2 + r) ** 2);
  const group = new THREE.Group(); scene.add(group);
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const mat = { concrete: lam(0xd2cfc8, { map: view.detail }), white: lam(0xf3f3f0), grey: lam(0x8d9196), dark: lam(0x2c2f33), orange: lam(0xff7a1a), red: lam(0xc62828), roof: lam(0xe9ecef),
    rock: lam(0x978d7e, { flatShading: true }), rockRed: lam(0x9c4a30, { flatShading: true }), rockDark: lam(0x5f5a52, { flatShading: true }), steelRed: lam(0x8b3a26), iron: lam(0x2d3a45),
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
  const tex = (t) => { t.colorSpace = THREE.SRGBColorSpace; return t; };

  // ================================================================= road markings
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const band = (t) => map.pitBand(world, t) ?? [t.w / 2 + 2.4, t.w / 2 + 6.6];
  const i0 = idx(PIT.from), i1 = idx(PIT.to), to = i1 + (i1 < i0 ? M : 0);
  view._ribbon({ offA: (t) => band(t)[1] - 0.2, offB: (t) => band(t)[1], yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => band(t)[0], offB: (t) => band(t)[0] + 0.2, yOff: 0.025, mat: lineMat, from: i0, to, step: 1 });
  view._ribbon({ offA: (t) => t.w / 2 - 0.18, offB: (t) => t.w / 2 - 0.02, yOff: 0.02, mat: lineMat, step: 1, filter: (t) => !t.noKerbR });
  view._ribbon({ offA: (t) => -(t.w / 2 - 0.02), offB: (t) => -(t.w / 2 - 0.18), yOff: 0.02, mat: lineMat, step: 1 });

  // ================================================================= water: Silver Bow Lake, the stream, the falls and the plunge pool
  const wc = document.createElement('canvas'); wc.width = wc.height = 128;
  { const g = wc.getContext('2d'); g.fillStyle = '#2b7390'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 80; i++) { g.strokeStyle = `rgba(${i % 3 ? 190 : 255},${i % 3 ? 225 : 255},255,${0.05 + rand() * 0.1})`; g.lineWidth = 1 + rand() * 2; const x = rand() * 128, y = rand() * 128; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y + 2, x + 22, y); g.stroke(); } }
  const lakeTex = tex(new THREE.CanvasTexture(wc)); lakeTex.wrapS = lakeTex.wrapT = THREE.RepeatWrapping; lakeTex.repeat.set(40, 20);
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(LAKE.a * 2.6, LAKE.b * 2.8), new THREE.MeshStandardMaterial({ map: lakeTex, color: 0xd8ecf6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.92 }));
  lake.rotation.x = -Math.PI / 2; lake.position.set(LAKE.x, LAKE.level, LAKE.z); lake.receiveShadow = true; group.add(lake);
  view.updaters?.push(() => { lakeTex.offset.x = (performance.now() * 0.000006) % 1; });

  const R = RAVINE;
  // white streaks for the falling water
  const fc = document.createElement('canvas'); fc.width = 64; fc.height = 256;
  { const g = fc.getContext('2d'); g.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.6})`; const x = rand() * 64, w = 1 + rand() * 4, y = rand() * 256, h = 30 + rand() * 120; g.fillRect(x, y, w, h); }
    g.fillStyle = 'rgba(235,246,255,0.62)'; g.fillRect(0, 0, 64, 256); }
  const fallTex = tex(new THREE.CanvasTexture(fc)); fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
  { // the sheet of water follows the cliff face from the lip to the pool
    const segs = 28, z0 = R.zLip - 6, z1 = R.zLip + 46, pos = [], uv = [], ind = [];
    for (let k = 0; k <= segs; k++) {
      const z = z0 + (z1 - z0) * k / segs, y = map.ravineFloor(z) + 1.1;
      for (const sx of [-1, 1]) { pos.push(R.x + sx * 9, y, z); uv.push(sx > 0 ? 1 : 0, k / segs * 3); }
    }
    for (let k = 0; k < segs; k++) { const a = k * 2; ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); g.computeVertexNormals();
    const falls = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true })); falls.renderOrder = 3; group.add(falls);
    view.updaters?.push(() => { fallTex.offset.y = -(performance.now() * 0.0009) % 1; });
  }
  { // foam where the falls hit the pool
    const fm = document.createElement('canvas'); fm.width = fm.height = 64; const g = fm.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(235,248,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(24, 22), new THREE.MeshBasicMaterial({ map: tex(new THREE.CanvasTexture(fm)), transparent: true, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(R.x, R.pool + 1.15, R.zLip + 50); foam.renderOrder = 4; group.add(foam);
  }
  const streamMat = new THREE.MeshStandardMaterial({ map: lakeTex, color: 0xd8ecf6, roughness: 0.1, transparent: true, opacity: 0.9 });
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(17, R.zLip - 4 - (R.zNorth + 60)), streamMat); stream.rotation.x = -Math.PI / 2; stream.position.set(R.x, R.floor + 0.75, (R.zNorth + 60 + R.zLip - 4) / 2); group.add(stream);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(26, 100), streamMat); pool.rotation.x = -Math.PI / 2; pool.position.set(R.x, R.pool + 1.0, R.zLip + 92); group.add(pool);
  { // mist rising from the base of the falls
    const mc = document.createElement('canvas'); mc.width = mc.height = 64; const g = mc.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const mm = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), transparent: true, depthWrite: false, opacity: 0.22 });
    for (let k = 0; k < 7; k++) { const s = new THREE.Sprite(mm); s.scale.set(16 + rand() * 10, 12 + rand() * 8, 1); s.position.set(R.x + (rand() - 0.5) * 10, R.pool + 4 + rand() * 8, R.zLip + 50 + rand() * 12); group.add(s); }
  }

  // ================================================================= the truss bridge over the ravine
  {
    const bi = nearestIdx(R.x, R.deckZ), bt = T[bi], deck = bt.y, hwB = bt.w / 2;
    const x0 = R.x - 54, x1 = R.x + 54, zc = bt.z, yaw = 0;
    const beams = [];
    const beam = (a, b, t) => beams.push([new THREE.Vector3(...a), new THREE.Vector3(...b), t]);
    const W = hwB + 1.4, H = 9.5, N = 12, pw = (x1 - x0) / N;
    for (const sd of [-1, 1]) {
      const z = zc + sd * W;
      beam([x0, deck - 0.4, z], [x1, deck - 0.4, z], 0.7);                                           // lower chord
      beam([x0, deck + H, z], [x1, deck + H, z], 0.6);                                               // upper chord
      for (let k = 0; k <= N; k++) {
        const x = x0 + k * pw;
        beam([x, deck - 0.4, z], [x, deck + H, z], 0.45);                                            // posts
        if (k < N) { const up = k % 2 === 0; beam([x, up ? deck - 0.4 : deck + H, z], [x + pw, up ? deck + H : deck - 0.4, z], 0.4); }   // diagonals
      }
    }
    for (let k = 0; k <= N; k++) { const x = x0 + k * pw; beam([x, deck + H, zc - W], [x, deck + H, zc + W], 0.4); beam([x, deck - 0.5, zc - W], [x, deck - 0.5, zc + W], 0.55); }   // cross beams
    const im = new THREE.InstancedMesh(BOX, mat.steelRed, beams.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    beams.forEach(([a, b, t], k) => { const d = new THREE.Vector3().subVectors(b, a), len = d.length(); q.setFromUnitVectors(up, d.normalize()); pos.copy(a); sc.set(t, len, t); m4.compose(pos, q, sc); im.setMatrixAt(k, m4); });
    im.castShadow = true; group.add(im);
    box(x1 - x0, 0.9, W * 2 + 1.2, mat.concrete, (x0 + x1) / 2, deck - 1.3, zc, yaw);                  // the deck slab
    for (const sd of [-1, 1]) box(x1 - x0, 1.1, 0.4, mat.steelRed, (x0 + x1) / 2, deck, zc + sd * (hwB + 0.5), yaw);   // the guard rail beside the road
    for (const x of [x0 - 3, x1 + 3]) box(7, 34.5, W * 2 + 3, mat.rockDark, x, deck - 36, zc, yaw);       // abutments set into the cliff
    keepOut.push({ x: R.x, z: zc, r: 70 });
  }

  // ================================================================= the Cliffhanger Tunnel
  {
    const idxs = []; for (let i = 0; i < M; i += 2) { const s = T[i]; if (s.x >= TUNNEL.x0 && s.x <= TUNNEL.x1 && Math.abs(s.z - TUNNEL.z) < 25) idxs.push(i); }
    idxs.sort((a, b) => T[a].x - T[b].x);
    if (idxs.length > 3) {
      const Rt = 8.8, SEG = 14, pos = [], ind = [];
      idxs.forEach((i, k) => {
        const s = T[i];
        for (let a = 0; a <= SEG; a++) { const th = Math.PI * a / SEG; pos.push(s.x + s.rx * Math.cos(th) * Rt, s.y + Math.sin(th) * Rt * 0.9, s.z + s.rz * Math.cos(th) * Rt); }
        if (k > 0) for (let a = 0; a < SEG; a++) { const p = (k - 1) * (SEG + 1) + a, c = k * (SEG + 1) + a; ind.push(p, p + 1, c, p + 1, c + 1, c); }
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind); g.computeVertexNormals();
      const liner = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x9a968e, side: THREE.DoubleSide })); group.add(liner);
      // portals, lamps along the crown, and the rock mass above
      const a = T[idxs[0]], b = T[idxs[idxs.length - 1]];
      for (const [s, dir] of [[a, -1], [b, 1]]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(Rt - 0.1, Rt + 4.5, 20, 1, 0, Math.PI), mat.rockDark); ring.material = new THREE.MeshLambertMaterial({ color: 0x6b655b, side: THREE.DoubleSide });
        ring.position.set(s.x + s.tx * dir * 0.5, s.y, s.z + s.tz * dir * 0.5); ring.rotation.y = Math.atan2(s.rx, s.rz) + Math.PI / 2 * 0; ring.rotation.y = Math.atan2(s.tx, s.tz); group.add(ring);
        box(2, 1.3, Rt * 2 + 9, mat.rockDark, s.x + s.tx * dir * 0.5, s.y + Rt * 0.9 + 4.0, s.z + s.tz * dir * 0.5, Math.atan2(s.tx, s.tz) + Math.PI / 2);
      }
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe2a8, emissiveIntensity: 0.6 });
      for (let k = 1; k < idxs.length - 1; k += 3) { const s = T[idxs[k]]; box(0.5, 0.12, 2.4, lampMat, s.x, s.y + Rt * 0.9 - 0.3, s.z, Math.atan2(s.tx, s.tz)); }
      view.updaters?.push(() => { lampMat.emissiveIntensity = 0.7 + 3.0 * lighting.dark; });
      const cx = (TUNNEL.x0 + TUNNEL.x1) / 2, cy = (a.y + b.y) / 2, cz = (a.z + b.z) / 2;
      const dome = new THREE.IcosahedronGeometry(1, 3), pa = dome.attributes.position;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), n = 1 + fbm(x * 2.2 + 3, z * 2.2 + y, 2) * 0.22; pa.setXYZ(i, x * n, y * n, z * n); }
      dome.computeVertexNormals();
      const mound = new THREE.Mesh(dome, mat.rock); mound.scale.set((TUNNEL.x1 - TUNNEL.x0) / 2 - 14, 24, 40); mound.position.set(cx, cy + 1, cz); mound.castShadow = true; mound.receiveShadow = true; group.add(mound);
      keepOut.push({ x: cx, z: cz, r: 100 });
    }
  }

  // ================================================================= paddock: garages, tower, stand
  const g0 = PIT.from + 12, g1 = PIT.to - 14, glat0 = hw(0) + 12, glat1 = glat0 + 6;
  const n = Math.round(span(g0, g1) / 7), len = span(g0, g1) / n;
  const facade = new THREE.MeshLambertMaterial({ map: garageFacade(1), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shops = new Workshops();
  for (let k = 0; k < n; k++) {
    const d = g0 + (k + 0.5) * len, f = frame(d, (glat0 + glat1) / 2), base = Math.min(frame(d, glat0).y, frame(d, glat1).y) - 0.2;
    if (!free(f.x, f.z, 6)) continue;
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
      shops.add('pit', bx, base + floorY, bz, Math.atan2(-f.t.rx, -f.t.rz), [0xff6d00, 0x00b0ff, 0xffd600, 0xc62828][(k / 2 | 0) % 4]);
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
    const f = frame(30, glat1 + 8);
    if (free(f.x, f.z, 8)) {
      box(10, 11, 7, mat.white, f.x, f.y, f.z, f.yaw); box(10.6, 3.4, 7.6, mat.glass, f.x, f.y + 11, f.z, f.yaw); box(11, 0.5, 8.2, mat.dark, f.x, f.y + 14.4, f.z, f.yaw);
      box(0.15, 6, 0.15, mat.steel, f.x, f.y + 14.9, f.z); solid(f.x, f.z, 10, 7, f.yaw, 14);
    }
  }
  // paddock behind the garages: team trucks, tents and a hospitality block
  const tentCols = [0xc62828, 0x1d4f91, 0xf2b705, 0x2e7d32, 0xf3f3f0];
  for (let k = 0; k < 14; k++) {
    const d = PIT.from + 30 + k * 26, f = frame(d, glat1 + 16 + (k % 3) * 9), c = tentCols[k % tentCols.length];
    if (!free(f.x, f.z, 8)) continue;
    if (k % 3 === 0) { box(2.6, 3.6, 12, lam(0xe8e8e8), f.x, f.y, f.z, f.yaw); box(2.7, 0.6, 12.1, lam(c), f.x, f.y + 2.4, f.z, f.yaw); }
    else { box(6, 2.8, 8, lam(c), f.x, f.y, f.z, f.yaw); box(6.6, 0.3, 8.6, mat.roof, f.x, f.y + 2.8, f.z, f.yaw); }
    keepOut.push({ x: f.x, z: f.z, r: 9 });
  }
  {
    const f = frame(PIT.from + 140, glat1 + 44);
    if (free(f.x, f.z, 12)) { box(26, 7, 14, mat.white, f.x, f.y, f.z, f.yaw); box(26.6, 0.5, 14.6, mat.dark, f.x, f.y + 7, f.z, f.yaw); panel(26, 3.2, mat.glass, f.x - f.t.rx * 7.1, f.y + 1.6, f.z - f.t.rz * 7.1, Math.atan2(-f.t.rx, -f.t.rz)); solid(f.x, f.z, 26, 14, f.yaw, 7); }
  }
  // covered stand opposite the pits, looking out over the lake
  const seat = new THREE.MeshLambertMaterial({ map: seatTexture('#c2185b'), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  {
    const rows = 8, bays = 6, d0 = PIT.from + 24, d1 = PIT.from + 24 + 6 * 22, lat0 = hw(0) + 6, side = -1, sp = span(d0, d1) / bays;
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
  }

  // ================================================================= sign boards naming each section, brake boards, marshal posts
  const sign = (text, x, z, faceYaw, { bg = '#102a43', fg = '#fff', w = 12, h = 2.4, lift = 0, post = true } = {}) => {
    const t = tex(bannerTexture(text, { bg, fg, w: 1024, h: Math.round(1024 * h / w) }));
    const y = world.heightAtGrid(x, z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide })); m.position.set(x, y + 3.2 + lift + h / 2, z); m.rotation.y = faceYaw; group.add(m);
    if (post) for (const sx of [-1, 1]) box(0.25, 3.4 + lift, 0.25, mat.steel, x + Math.cos(faceYaw) * sx * (w / 2 - 0.5), y, z - Math.sin(faceYaw) * sx * (w / 2 - 0.5));
  };
  const signAt = (text, ix, side, off, opts) => {
    const s = T[ix], x = s.x + s.rx * side * (s.w / 2 + off), z = s.z + s.rz * side * (s.w / 2 + off);
    sign(text, x, z, Math.atan2(-side * s.rx, -side * s.rz), opts);
  };
  signAt('GRAND PRIX PADDOCK', idx(PIT.from + 40), -1, 8, { bg: '#7a0f2b' });
  signAt('SILVER BOW LAKE', idx(40), -1, 14, { bg: '#0b5c7a' });
  signAt('THE SERPENTINE CLIMB', nearestIdx(-480 - 128, 505 - 119), 1, 7);
  signAt('CLIFFHANGER TUNNEL', nearestIdx(TUNNEL.x0 - 30, TUNNEL.z), 1, 6, { bg: '#4a3b2a' });
  signAt("RAVINE CROSSING & WATERFALL BRIDGE", nearestIdx(R.x - 100, R.deckZ), -1, 6, { bg: '#8b3a26', w: 16 });
  signAt("EAGLE'S NEST FALLS", nearestIdx(R.x + 85, R.deckZ), 1, 6, { bg: '#0b5c7a' });
  signAt('ALPINE PEAK LOOP', nearestIdx(430 - 128, -345 - 119), -1, 8, { bg: '#1c3d5a' });
  signAt('ALPINE DESCENT', nearestIdx(815 - 128, -260 - 119), 1, 7, { bg: '#1c3d5a' });
  const WORDS = [['ROCKY MTN ENDURANCE', '#102a43', '#fff'], ['SILVER BOW', '#0b5c7a', '#fff'], ['TIMBERLINE', '#2e5d34', '#fff'], ['GRIP', '#c62828', '#fff'], ['ALPINE FUEL', '#111', '#ffc400']];
  const ads = WORDS.map(([t, bg, fg]) => new THREE.MeshLambertMaterial({ map: tex(bannerTexture(t, { bg, fg, w: 512, h: 96 })) }));
  let ak = 0;
  for (let d = 10; d < L; d += 60) {
    const side = Math.floor(d / 300) % 2 ? 1 : -1, f = frame(d, side * (hw(d) + 4.2));
    if (side > 0 && (d > PIT.from - 15 || d < PIT.to + 15)) continue;
    if (!free(f.x, f.z, 2.2)) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.9), ads[ak++ % ads.length]); m.position.set(f.x, f.y + 1.3, f.z); m.rotation.y = Math.atan2(-side * f.t.rx, -side * f.t.rz); group.add(m);
  }
  for (const key of Object.keys(C)) {
    const dd = C[key], out = map.outside(world, dd), f = frame(dd + 6, out * (hw(dd) + 6));
    if (!free(f.x, f.z, 3)) continue;
    box(1.4, 2.4, 1.4, mat.orange, f.x, f.y - 0.1, f.z, f.yaw); box(1.7, 0.2, 1.7, mat.dark, f.x, f.y + 2.3, f.z, f.yaw);
  }

  // ================================================================= pit-straight floodlights (glow at night, the nearest really light the road)
  {
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff0c0, emissiveIntensity: 0.15 });
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const pg = pc.getContext('2d'), gr = pg.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,240,200,0.85)'); gr.addColorStop(0.45, 'rgba(255,230,170,0.35)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); pg.fillStyle = gr; pg.fillRect(0, 0, 128, 128);
    const poolMat = new THREE.MeshBasicMaterial({ map: tex(new THREE.CanvasTexture(pc)), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pools = [], masts = [];
    const mk = (f, side, d, w, ph, bars) => {
      const here = frame(d), face = Math.atan2(-side * f.t.rx, -side * f.t.rz);
      box(0.2, ph, 0.2, mat.iron, f.x, f.y, f.z);
      box(0.14, 0.14, 2.4, mat.iron, f.x - side * f.t.rx * 1.1, f.y + ph, f.z - side * f.t.rz * 1.1, face);
      const bx = f.x - side * f.t.rx * 2.2, bz = f.z - side * f.t.rz * 2.2;
      for (let k = 0; k < bars; k++) { const along = (k - (bars - 1) / 2) * 1.1, bar = new THREE.Mesh(BOX, lampMat); bar.scale.set(0.5, 0.14, 0.9); bar.position.set(bx + f.t.tx * along, f.y + ph - 0.05, bz + f.t.tz * along); bar.rotation.y = face; group.add(bar); }
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), poolMat), pc2 = frame(d, side * (w * 0.1));
      pool.position.set(pc2.x, here.y + 0.06, pc2.z); pool.rotation.x = -Math.PI / 2; pool.renderOrder = 4; group.add(pool); pools.push(pool);
      masts.push({ x: bx, y: f.y + ph - 0.15, z: bz, tx: pc2.x, ty: here.y, tz: pc2.z });
    };
    for (let d = PIT.from + 6; span(PIT.from, d) < span(PIT.from, PIT.to - 6); d += 30) { const f = frame(d, hw(d) + 9.4); if (free(f.x, f.z, 1.2)) mk(f, 1, d, hw(d) + 8, 9.4, 2); }
    for (let d = PIT.from + 20; span(PIT.from, d) < span(PIT.from, PIT.to - 30); d += 28) { const f = frame(d, -(hw(d) + 6 + 8 * 0.9 + 2.4)); if (free(f.x, f.z, 1.6)) mk(f, -1, d, hw(d), 15, 3); }
    const K = Math.min(6, masts.length), spots = [];
    for (let k = 0; k < K; k++) {
      const sp = new THREE.SpotLight(0xfff0d0, 0, 200, 1.2, 0.9, 2);
      sp.castShadow = k < 3; sp.shadow.mapSize.set(1024, 1024); sp.shadow.camera.near = 3; sp.shadow.camera.far = 200;
      sp.shadow.bias = -0.0004; sp.shadow.normalBias = 0.04; sp.shadow.radius = 3; scene.add(sp, sp.target); spots.push({ sp, mast: -1 });
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
        s.sp.intensity = 1800 * dk * sm(170, 80, dist); s.sp.shadow.autoUpdate = true;
      }
    });
  }

  // ================================================================= boulders on the rock, then the forest
  {
    const rocks = [], rg = new THREE.IcosahedronGeometry(1, 0), rm = new THREE.InstancedMesh(rg, mat.rock, 2600);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3();
    for (let tries = 0; tries < 60000 && rocks.length < 2600; tries++) {
      const x = (rand() * 2 - 1) * (world.half - 20), z = (rand() * 2 - 1) * (world.half - 20), sid = world.surfaceAt(x, z);
      if (sid !== SURF.Gravel && sid !== SURF.Dirt && !(sid === SURF.Grass && rand() < 0.06)) continue;
      const ti = world.trackInfo(x, z); if (ti.index >= 0 && ti.dist < 10) continue;
      if (ti.index >= 0 && ti.dist < 90 && T[ti.index].noKerbR) continue;
      if (world.heightAtGrid(x, z) < LAKE.level + 2) continue;
      if (Math.abs(x - R.x) < R.hTop + 30 && z > R.zNorth - 20 && z < R.zLip + 210) continue;       // the gorge has its own red boulders
      rocks.push([x, z, 0.8 + rand() * rand() * 5]);
    }
    rocks.forEach(([x, z, s], k) => { q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3)); m4.compose(V.set(x, world.heightAtGrid(x, z) + s * 0.3, z), q, S.set(s * (0.9 + rand() * 0.6), s * (0.6 + rand() * 0.5), s * (0.9 + rand() * 0.6))); rm.setMatrixAt(k, m4); });
    rm.count = rocks.length; rm.castShadow = true; rm.receiveShadow = true; group.add(rm);
  }
  {
    const reds = [], rg = new THREE.IcosahedronGeometry(1, 0), rm = new THREE.InstancedMesh(rg, mat.rockRed, 320);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3();
    for (let tries = 0; tries < 30000 && reds.length < 320; tries++) {
      const x = R.x + (rand() * 2 - 1) * (R.hFloor + 12), z = R.zNorth + 80 + rand() * (R.zLip - 20 - R.zNorth - 80);
      const y = world.heightAtGrid(x, z); if (y > world.terrainHeight(x, z) - 3) continue;
      reds.push([x, z, 0.8 + rand() * rand() * 4.5]);
    }
    reds.forEach(([x, z, s], k) => { q.setFromEuler(e.set(rand() * 3, rand() * 6, rand() * 3)); m4.compose(V.set(x, world.heightAtGrid(x, z) - s * 0.35, z), q, S.set(s * (0.9 + rand() * 0.6), s * (0.6 + rand() * 0.6), s * (0.9 + rand() * 0.6))); rm.setMatrixAt(k, m4); });
    rm.count = reds.length; rm.castShadow = true; rm.receiveShadow = true; group.add(rm);
  }
  const forest = (x, z) => {
    const h = world.heightAtGrid(x, z), sid = world.surfaceAt(x, z);
    if (sid !== SURF.Grass && !(sid === SURF.Dirt && h < 120)) return 0;
    if (h < LAKE.level + 1.5 || h > 205 + fbm(x * 0.01, z * 0.01, 2) * 40) return 0;
    if (Math.abs(x - R.x) < 70 && z > R.zNorth && z < R.zLip + 200) return 0;
    const slope = Math.max(Math.abs(world.heightAtGrid(x + 6, z) - h), Math.abs(world.heightAtGrid(x, z + 6) - h));
    if (slope > 6.5) return 0;
    return Math.max(0, 0.45 + fbm(x * 0.006 + 20, z * 0.006, 3) * 1.2) * (h > 150 ? 1 - (h - 150) / 80 : 1);
  };
  {
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3();
    // alpine spruce: a slim trunk and four tiers of cones that reach almost to the ground; the far version is two cones
    const conifer = (h, rad, col) => {
      const parts = [{ geo: new THREE.CylinderGeometry(0.16, 0.3, h * 0.35, 5).translate(0, h * 0.17, 0), color: 0x5a3f2b }];
      for (let i = 0; i < 4; i++) parts.push({ geo: new THREE.ConeGeometry(rad * (1 - i * 0.2), h * 0.4, 7).translate(0, h * (0.2 + i * 0.2) + h * 0.2, 0), color: col });
      const far = mergeParts([{ geo: new THREE.ConeGeometry(rad * 0.95, h * 0.62, 6).translate(0, h * 0.4, 0), color: col }, { geo: new THREE.ConeGeometry(rad * 0.6, h * 0.5, 6).translate(0, h * 0.72, 0), color: col }]);
      return { geo: mergeParts(parts), far };
    };
    const VARIANTS = [{ ...conifer(12, 2.9, 0x23472b), w: 30 }, { ...conifer(15, 3.3, 0x1e4026), w: 26 }, { ...conifer(9.5, 2.4, 0x2a5232), w: 22 }, { ...conifer(18, 3.6, 0x1b3a25), w: 12 },
      { geo: broadleafTree(37, { h: 8, crown: 3.2, leaf: 0x8aa63a }), far: farTree(37, { h: 8, crown: 3.2, leaf: 0x8aa63a }), w: 5 }];
    const TILE = 240, wsum = VARIANTS.reduce((a, v) => a + v.w, 0);
    const pick = () => { let r = rand() * wsum; for (let i = 0; i < VARIANTS.length; i++) { r -= VARIANTS[i].w; if (r <= 0) return i; } return 0; };
    const tiles = new Map(); let placed = 0;
    for (let tries = 0; tries < 420000 && placed < 14000; tries++) {
      const x = (rand() * 2 - 1) * (world.half - 12), z = (rand() * 2 - 1) * (world.half - 12);
      const dens = forest(x, z);
      if (dens <= 0 || rand() > dens) continue;
      const ti = world.trackInfo(x, z); if (ti.index >= 0 && ti.dist < 13) continue;
      if (ti.index >= 0 && ti.dist < 90 && T[ti.index].noKerbR) continue;                          // the paddock and stand stay clear of woodland
      if (keepOut.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < k.r * k.r)) continue;
      const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      if (!tiles.has(key)) tiles.set(key, VARIANTS.map(() => []));
      tiles.get(key)[pick()].push([x, z, 0.8 + rand() * 0.55, rand() * 6.28]); placed++;
    }
    const trees = new TreeTiles(group, 260, 380), tint = new THREE.Color();
    view.updaters.push((camera) => trees.update(camera));
    for (const [key, lists] of tiles) {
      const [tx, tz] = key.split(',').map(Number), lod = { position: new THREE.Vector3((tx + 0.5) * TILE, 0, (tz + 0.5) * TILE) };
      const near = new THREE.Group(), far = new THREE.Group();
      lists.forEach((list, vi) => {
        if (!list.length) return;
        const hi = new THREE.InstancedMesh(VARIANTS[vi].geo, trees.near, list.length), lo = new THREE.InstancedMesh(VARIANTS[vi].far, trees.far, list.length);
        list.forEach(([x, z, s, r], i) => {
          q.setFromAxisAngle(up, r); m4.compose(V.set(x - lod.position.x, world.heightAtGrid(x, z) - 0.15, z - lod.position.z), q, S.set(s, s * (0.9 + rand() * 0.25), s));
          hi.setMatrixAt(i, m4); lo.setMatrixAt(i, m4); const c = tint.setHSL(0, 0, 0.82 + rand() * 0.3); hi.setColorAt(i, c); lo.setColorAt(i, c);
        });
        hi.computeBoundingSphere(); lo.computeBoundingSphere(); hi.castShadow = true; hi.receiveShadow = true; near.add(hi); far.add(lo);
      });
      trees.add(lod.position.x, lod.position.z, TILE, near, far);
    }
  }
}
