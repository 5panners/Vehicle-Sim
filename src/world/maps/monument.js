// Monument Valley Kart Circuit: a bright, stylised red-rock desert track (10 m wide, 12 m on the pit straight, clockwise, ~1.8 km).
//
// Towering mesas and slim buttes rise out of a pale desert floor. A dry canyon cuts east-west across the middle of the site and the lap
// crosses it twice: on the east side the road ends at the canyon lip and you fly the gap off a kicker, on the west side a wooden trestle
// bridge carries it across. In between there are whoops, rollers, a tabletop jump and a speed hump, plus the pit lane, grid and paddock
// on the top straight.
//
// Like the other maps, the canyon, jumps and bumps are written into the height field by `adjust()`, so the physics and the drawn terrain agree.
// The mesas come from the terrain function; they are faded out near the road so no cliff ever crowds the circuit.
import { smoothstep, clamp } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

const SC = 0.85;
// [x, z, height]  planned on a sheet with x east and z south; the lap runs clockwise from the start line on the north straight, heading east
const RAW = [
  [-100, -300, 1], [30, -300, 1.2], [150, -292, 1.6], [235, -262, 2.2], [290, -205, 2.8], [312, -135, 3], [308, -70, 3], [300, -10, 2.8],
  [296, 35, 2.6], [294, 78, 1.9], [288, 130, 1.8], [268, 195, 1.4], [225, 252, 1], [160, 292, 0.6],
  [95, 320, 0.3], [45, 331, 0.3], [0, 311, 0.2], [-45, 331, 0.3], [-95, 320, 0.4], [-160, 290, 0.7],
  [-235, 250, 1], [-285, 190, 1.5], [-305, 120, 2.4], [-308, 80, 3.4], [-308, 60, 3.4], [-306, 40, 3.4], [-302, 0, 3],
  [-295, -50, 2.6], [-272, -118, 2.2], [-222, -168, 1.8], [-250, -225, 1.4], [-236, -278, 1],
];
const P = ([x, z, y], i, n) => [x * SC, z * SC, y, 0, (i > n - 4 || i < 3) ? 12 : 10];
const TRACK = RAW.map((p, i) => P(p, i, RAW.length));

export const WASH = { z: 60 * SC, bed: -8, half: 8, wall: 3.2 };               // the dry canyon
export const MESAS = [                                                          // [x, z, rx, rz, height, seed]
  [-18, -130, 90, 70, 74, 1], [18, 150, 80, 62, 58, 2], [-480, -110, 120, 90, 98, 3], [450, 110, 100, 120, 110, 4], [40, -500, 160, 80, 118, 5],
  [-430, 400, 110, 90, 82, 6], [470, -380, 100, 90, 92, 7], [-90, 480, 120, 70, 70, 8], [-60, 420, 24, 24, 90, 9], [180, -470, 28, 28, 112, 10],
  [410, 310, 22, 22, 84, 11], [-390, -390, 30, 30, 104, 12], [-250, -8, 20, 20, 62, 13], [250, 60, 24, 24, 70, 14], [-530, 150, 26, 26, 96, 15], [520, 480, 70, 60, 84, 16],
];

const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);
const sgn = (x) => (x < 0 ? -1 : 1);

export default {
  id: 'monument',
  name: 'Monument Valley (kart)',
  length: 1800,
  size: 1100,
  meshStep: 2,
  trackWidth: 10,
  botMargin: 0.9,
  kerbs: 'corners',
  kerbCurvature: 0.011,
  runoff: 1.8,
  blend: 14,
  scenery: 'monument',
  corners: {},
  pit: { from: 0, to: 0 },
  defaultCar: 'KZ Shifter Kart',
  signedBank: true,
  flatReach: 10,
  trackPoints: TRACK,
  // [lap fraction, count, wavelength m, height m]: whoops on the east straight, rollers on the bottom straight
  bumps: [[0.24, 6, 18, 0.1], [0.447, 5, 14, 0.08]],
  // tabletop on the bottom straight: [lap fraction, ramp up m, flat m, ramp down m, height m]
  table: [0.59, 8, 7, 9, 0.38],
  dist(world, sample) { return sample.i * world.map.length / world.trackLength; },
  sampleAt(world, s) { const L = this.length; return world.track[Math.round((((s % L) + L) % L) * world.trackLength / L) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  prepare(world) {
    const T = world.track, M = T.length;
    this.length = M;
    // the two crossings of the canyon: heading south on the east side is the jump, heading north on the west side is the bridge
    this._cross = [];
    for (let i = 0; i < M; i++) { const a = T[i], b = T[(i + 1) % M]; if ((a.z - WASH.z) * (b.z - WASH.z) <= 0 && a.z !== b.z) this._cross.push({ i, x: a.x, z: WASH.z, y: a.y, south: b.z > a.z }); }
    this._gap = this._cross.find((c) => c.south) || this._cross[0];
    this._bridge = this._cross.find((c) => !c.south) || this._cross[this._cross.length - 1];
    this._pitFrom = M - 70; this._pitTo = 150;
    this.pit = { from: this._pitFrom, to: this._pitTo };
    const peaks = [];
    for (let i = 0; i < M; i++) {
      const c = Math.abs(T[i].curv); if (c < 0.008) continue;
      let top = true; for (let k = -30; k <= 30; k += 3) if (Math.abs(T[(i + k + M) % M].curv) > c + 1e-9) { top = false; break; }
      if (top && (!peaks.length || i - peaks[peaks.length - 1] > 40)) peaks.push(i);
    }
    this.corners = Object.fromEntries(peaks.map((p, k) => [`Turn ${k + 1}`, p]));
    for (const t of T) { const d = this.dist(world, t); t.noKerbR = inRange(d, this._pitFrom - 10, this._pitTo + 10); }
    // distance to the road on a coarse grid, so the mesas can keep away from it
    const CELL = 20, n = Math.round(world.size / CELL) + 1, half = world.half, sub = []; for (let i = 0; i < M; i += 5) sub.push(T[i]);
    const dst = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * CELL - half, z = j * CELL - half; let m = 1e12;
      for (const s of sub) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < m) m = d; }
      dst[j * n + i] = Math.sqrt(m);
    }
    this._land = { n, CELL, half, dst };
  },
  _road(x, z) {
    const L = this._land, n = L.n, fx = clamp((x + L.half) / L.CELL, 0, n - 1.001), fz = clamp((z + L.half) / L.CELL, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i, a = L.dst;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + n] * (1 - u) + a[k + n + 1] * u) * v;
  },

  pitBand(world, sample) { const d = this.dist(world, sample); return inRange(d, this._pitFrom, this._pitTo) ? [sample.w / 2 + 2.2, sample.w / 2 + 6.2] : null; },
  flatWidth(s, lat, world) { const pb = lat > 0 && this.pitBand(world, s); return pb ? pb[1] + 16 - s.w / 2 : 0; },

  /** the desert floor with soft dunes, and the mesas and buttes, kept away from the road */
  terrain(x, z) {
    const dunes = fbm(x * 0.008 + 5, z * 0.008 - 3, 3) * 3.2 + fbm(x * 0.05, z * 0.05, 2) * 0.35;
    const mask = smoothstep(30, 75, this._road(x, z));
    let h = 0;
    for (const [cx, cz, rx, rz, H, seed] of MESAS) {
      const dx = (x - cx) / rx, dz = (z - cz) / rz;
      const warp = 1 + fbm(x * 0.03 + seed * 7, z * 0.03 - seed * 3, 3) * 0.28;          // rugged outline
      const r = Math.sqrt(dx * dx + dz * dz) * warp;
      if (r > 1.9) continue;
      const wall = smoothstep(1.0, 0.84, r);                                                // near-vertical cliffs
      const talus = smoothstep(1.9, 1.0, r) * 0.22;                                         // a skirt of rubble at the foot
      const terr = 0.5 + 0.5 * Math.sin((wall * H) * 0.34 + fbm(x * 0.05, z * 0.05, 2) * 2);   // faint terraces
      h = Math.max(h, (wall * H * (0.97 + 0.03 * terr) + talus * H * (1 - wall)) * (1 + (1 - smoothstep(0.0, 0.7, r)) * 0.05));
    }
    return dunes + h * mask;
  },
  paint(x, z, h) { return h > 8 ? SURF.Gravel : SURF.Dirt; },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const pb = lat > 0 && this.pitBand(world, s);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;
      if (lat > pb[1] && lat < pb[1] + 16) return SURF.Concrete;
    }
    return undefined;
  },
  sky: { top: 0x2f8cf0, bottom: 0xffe6c4, fog: 0xf6d9b8, sun: 1.9, hemi: 1.15, fogNear: 300, fogFar: 1900 },

  /** the canyon floor and walls applied to a ground height */
  canyon(x, z, h) {
    const dz = Math.abs(z - WASH.z);
    if (dz > WASH.half + WASH.wall + 0.5) return h;
    const f = 1 - smoothstep(WASH.half, WASH.half + WASH.wall, dz);
    const wob = fbm(x * 0.05, z * 0.1, 2) * 0.5;
    return h + (WASH.bed + wob - h) * f;
  },

  adjust(x, z, A, world, info) {
    const near = info.d < 1e8 ? world.track[info.idx] : null, hw = near ? near.w / 2 : 0;
    const onRoad = near && info.d <= hw + 2.0;
    const B = this._bridge, J = this._gap;
    // the bridge deck keeps its solid ground for the physics (it is drawn lower by visualHeight)
    const onDeck = B && onRoad && Math.abs(x - B.x) < 14 && Math.abs(z - WASH.z) < WASH.half + WASH.wall + 4;
    if (!onDeck) A.h = this.canyon(x, z, A.h);
    if (Math.abs(z - WASH.z) < WASH.half + 1 && A.h < WASH.bed + 3) A.surf = SURF.Sand;
    if (!near) return;
    const edge = 1 - smoothstep(hw - 1.2, hw + 0.3, info.d);
    // the jump: a kicker on the north bank, the road ending at the canyon lip, the landing on the south bank a touch lower
    if (J && edge > 0 && Math.abs(x - J.x) < 16) {
      const lip = WASH.z - WASH.half, u = (lip - z) / 10;
      if (u > 0 && u < 1) A.h += 0.8 * Math.pow(1 - u, 1.8) * edge;
    }
    // soft bumps and the tabletop, by lap distance
    const lap = info.idx / world.trackLength;
    for (const [f0, n, wl, ht] of this.bumps) {
      const s = (lap - f0) * world.trackLength;
      if (s < 0 || s > n * wl) continue;
      A.h += ht * 0.5 * (1 - Math.cos(2 * Math.PI * s / wl)) * edge;
    }
    const [tf, up, flat, down, th] = this.table, s = (lap - tf) * world.trackLength;
    if (s > 0 && s < up + flat + down) A.h += th * (s < up ? smoothstep(0, up, s) : s < up + flat ? 1 : 1 - smoothstep(up + flat, up + flat + down, s)) * edge;
  },

  /** the ground under the bridge deck, drawn down in the canyon */
  visualHeight(x, z, y, world) {
    const B = this._bridge;
    if (B && Math.abs(x - B.x) < 16 && Math.abs(z - WASH.z) < WASH.half + WASH.wall + 5) {
      const ti = world.trackInfo(x, z), s = ti.index >= 0 ? world.track[ti.index] : null;
      if (s && ti.dist <= s.w / 2 + 3.2) return Math.min(y, this.canyon(x, z, world.terrainHeight(x, z)));
    }
    return y;
  },

  /** red and orange rock with layered bands, pale sand on the floor */
  colorAt(x, z, sid, y, world) {
    if (sid === SURF.Asphalt || sid === SURF.Concrete || sid === SURF.Kerb) return null;
    const n = fbm(x * 0.04, z * 0.04, 3), g = 2;
    const sl = Math.max(Math.abs(world.heightAtGrid(x + g, z) - world.heightAtGrid(x - g, z)), Math.abs(world.heightAtGrid(x, z + g) - world.heightAtGrid(x, z - g))) / (2 * g);
    const band = 0.5 + 0.5 * Math.sin(y * 0.55 + n * 3.2), band2 = 0.5 + 0.5 * Math.sin(y * 1.7 + n * 5);
    const rockness = clamp((sl - 0.35) * 2.2, 0, 1) + clamp((y - 6) / 30, 0, 0.7);
    const rock = Math.min(1, rockness);
    // floor: warm sand with gentle ripples; rock: banded reds, oranges and creams, darker on the steep faces
    const sand = [0.86 + n * 0.03, 0.56 + n * 0.05, 0.3 + n * 0.04];
    const red = [0.74 + 0.1 * band, 0.24 + 0.12 * band + 0.06 * band2, 0.13 + 0.06 * band];
    const cream = [0.92, 0.66 + 0.05 * band, 0.42];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    let c = mix(sand, mix(red, cream, band2 > 0.8 ? 0.55 : 0), rock);
    if (y > 60) c = mix(c, [0.62, 0.22, 0.14], clamp((y - 60) / 60, 0, 0.6));          // dark caps on the tallest mesas
    if (Math.abs(z - WASH.z) < WASH.half + 3 && y < 0) c = mix(c, [0.86, 0.45, 0.24], 0.7);   // the canyon floor and walls, redder
    return c;
  },

  fellOff(p) { return Math.abs(p.z - WASH.z) < WASH.half + 1 && p.y < WASH.bed + 3.5; },
  fellMessage: 'Into the canyon! Back on the road',
  splashSpawn(world) { const t = world.track[(this._gap.i - 40 + world.trackLength) % world.trackLength]; return { x: t.x, z: t.z, yaw: Math.atan2(t.tx, t.tz) }; },

  // armco on both sides, tyre walls through the tight corners; nothing across the jump; solid parapets on the bridge
  walls(world) {
    const T = world.track, M = T.length, J = this._gap, B = this._bridge;
    for (const side of [-1, 1]) {
      let run = [], kind = null;
      const flush = () => { if (run.length > 2) world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall' } : kind === 'tyres' ? { height: 0.9, thickness: 0.7, style: 'tyrewall' } : { height: 0.8, thickness: 0.3, style: 'armco' }); run = []; };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], hw = s.w / 2, pb = side > 0 && this.pitBand(world, s);
        const inGap = J && Math.abs(s.x - J.x) < 14 && Math.abs(s.z - WASH.z) < 22;
        if (inGap) { flush(); continue; }
        const onBridge = B && Math.abs(s.x - B.x) < 12 && Math.abs(s.z - WASH.z) < 16;
        const k = pb ? 'pit' : Math.abs(s.curv) > 0.014 && !onBridge ? 'tyres' : 'armco';
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); run.push(last); }
        kind = k;
        let off = pb ? hw + 1.3 : onBridge ? hw + 0.8 : hw + 3.4;
        if (s.curv * side > 0) { const R = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 1.2, R - 3)); }
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        const info = world.trackInfo(x, z), other = T[info.index];
        if (other) { const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap); if (wrapGap > 40 && info.dist < other.w / 2 + 3) { flush(); continue; } }
        run.push([x, z]);
      }
      flush();
    }
  },

  spawns(world) {
    const on = (s, lat = 0) => { const t = this.sampleAt(world, s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat, yaw: Math.atan2(t.tx, t.tz) }; };
    const L = this.length;
    const out = { 'Grid (start/finish)': on(-12, -2), 'Pit lane': on(L - 20, 8) };
    Object.entries(this.corners).forEach(([k, i]) => { out[k] = on(i - 40); });
    if (this._gap) out['Canyon jump'] = on(this._gap.i - 70);
    if (this._bridge) out['Wooden bridge'] = on(this._bridge.i - 60);
    return out;
  },
};
