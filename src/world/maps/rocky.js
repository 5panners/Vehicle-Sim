// Rocky Mountain Endurance Circuit: a ~5 km mountain road course (12 m wide, 14 m on the pit straight, clockwise).
//
// From the start/finish straight beside Silver Bow Lake the lap climbs the Serpentine (five hairpins up the western slope),
// follows the ridge into the Cliffhanger Tunnel, crosses the ravine on a steel truss bridge above Eagle's Nest Falls, winds up
// and round the Alpine Peak loop and then drops down the eastern side back to the lake.
//
// The mountains are generated from the road itself: the ground follows the height of the nearest stretch of road and rises into
// walls and peaks with distance from it, so the road always sits on a believable slope. The ravine, the plunge pool, the lake
// and the tunnel mound are written into the height field by `adjust()`. The ground under the bridge deck stays solid for the
// physics; `visualHeight()` drops the *drawn* ground there so the bridge really spans the gorge.
import { smoothstep, clamp } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

// [x, z, height]  planned on a sheet with x east and z south (north is up); shifted below to centre the lap in the world
const RAW = [
  // start/finish straight beside the lake, heading west
  [150, 640, 14], [0, 640, 14.4], [-150, 640, 15], [-290, 635, 15.6], [-390, 615, 16.4], [-460, 585, 18], [-500, 540, 22],
  // the Serpentine: five hairpins up the western slope
  [-480, 505, 27], [-400, 495, 31], [-320, 488, 35], [-270, 470, 39], [-262, 435, 43], [-300, 415, 47],
  [-380, 408, 52], [-470, 402, 57], [-530, 395, 61], [-565, 370, 65], [-560, 335, 69], [-520, 318, 73],
  [-440, 312, 77], [-360, 306, 82], [-300, 300, 86], [-258, 282, 90], [-252, 248, 94], [-292, 230, 98],
  [-370, 222, 102], [-460, 216, 106], [-520, 208, 110], [-556, 184, 114], [-550, 150, 118], [-510, 134, 122],
  [-430, 128, 127], [-350, 122, 132], [-290, 116, 136], [-250, 95, 141],
  // the ridge, the Cliffhanger Tunnel and the truss bridge over the ravine
  [-232, 40, 146], [-202, -30, 152], [-152, -110, 158], [-90, -190, 165], [-20, -235, 171],
  [0, -243, 172], [80, -250, 174], [160, -252, 175], [190, -252, 175], [270, -252, 174], [350, -250, 173],
  // Alpine Peak loop: three legs climbing round the summit
  [430, -240, 176], [520, -225, 181], [600, -215, 184], [660, -215, 186], [700, -240, 188], [705, -280, 190], [670, -300, 191],
  [600, -305, 192], [520, -312, 194], [470, -318, 195], [430, -345, 196], [440, -385, 197], [490, -400, 198],
  [570, -405, 199], [650, -410, 198], [720, -412, 196],
  // the eastern descent: an S-bend, four hairpins and a long sweep back to the lake (constant gradient)
  [780, -390, 193], [810, -330, 187.3], [815, -260, 181.4], [800, -180, 174.5], [790, -100, 167.7], [740, -30, 160.4],
  [780, 40, 153.6], [815, 100, 147.7], [808, 160, 142.6], [780, 205, 138.1], [730, 225, 133.5], [660, 228, 127.6],
  [600, 232, 122.5], [560, 255, 118.6], [556, 290, 115.6], [590, 315, 112], [650, 325, 106.9], [720, 332, 100.9],
  [765, 355, 96.6], [760, 395, 93.2], [715, 410, 89.2], [650, 418, 83.7], [590, 425, 78.6], [550, 450, 74.6],
  [552, 485, 71.6], [590, 510, 67.7], [640, 520, 63.4], [690, 535, 59], [720, 560, 55.7], [715, 600, 52.3],
  [670, 635, 47.5], [600, 650, 41.4], [520, 648, 34.6], [400, 646, 24.5], [280, 643, 14.3],
];
const SHIFT = [-128, -119];
const P = ([x, z, y], i, n) => [x + SHIFT[0], z + SHIFT[1], y, 0, (i > n - 12 || i < 7) ? 14 : 12];
const TRACK = RAW.map((p, i) => P(p, i, RAW.length));

export const LAKE = { x: -400, z: 740, a: 480, b: 200, level: 2, bed: -5 };
export const RAVINE = { x: 142, hTop: 48, hFloor: 9, floor: 96, zNorth: -560, zLip: -286, pool: 8, deckZ: -371, slope: 2.4 };
export const TUNNEL = { x0: -128, x1: 32, z: -371, h: 8.5 };
export const BRIDGE = { x0: RAVINE.x - 54, x1: RAVINE.x + 54, z: RAVINE.deckZ };

const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

export default {
  id: 'rocky',
  name: 'Rocky Mountain Endurance Circuit',
  length: 5000,
  size: 2200,
  meshStep: 3,
  trackWidth: 12,
  botMargin: 1.0,
  kerbs: 'corners',
  kerbCurvature: 0.009,
  runoff: 2.4,
  blend: 18,
  scenery: 'rocky',
  corners: {},
  pit: { from: 0, to: 0 },
  signedBank: true,
  flatReach: 14,
  trackPoints: TRACK,
  dist(world, sample) { return sample.i * world.map.length / world.trackLength; },
  sampleAt(world, s) { const L = this.length; return world.track[Math.round((((s % L) + L) % L) * world.trackLength / L) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  prepare(world) {
    const T = world.track, M = T.length;
    this.length = M;
    this._pitFrom = M - 110; this._pitTo = 330;
    this.pit = { from: this._pitFrom, to: this._pitTo };
    // corners: local peaks of curvature
    const peaks = [];
    for (let i = 0; i < M; i++) {
      const c = Math.abs(T[i].curv); if (c < 0.012) continue;
      let top = true; for (let k = -30; k <= 30; k += 3) if (Math.abs(T[(i + k + M) % M].curv) > c + 1e-9) { top = false; break; }
      if (top && (!peaks.length || i - peaks[peaks.length - 1] > 40)) peaks.push(i);
    }
    this.corners = Object.fromEntries(peaks.map((p, k) => [`Turn ${k + 1}`, p]));
    for (const t of T) { const d = this.dist(world, t); t.noKerbR = inRange(d, this._pitFrom - 10, this._pitTo + 10); }
    // the landscape: a coarse grid of "height of the nearest road" (inverse-distance weighted) and "distance to the road"
    const CELL = 25, n = Math.round(world.size / CELL) + 1, half = world.half, every = 6;
    const sub = []; for (let i = 0; i < M; i += every) sub.push(T[i]);
    const idw = new Float32Array(n * n), dst = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * CELL - half, z = j * CELL - half;
      let sw = 0, sy = 0, dm = 1e9;
      for (const s of sub) {
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2, w = 1 / (d2 + 900) ** 1.25;
        sw += w; sy += w * s.y; if (d2 < dm) dm = d2;
      }
      idw[j * n + i] = sy / sw; dst[j * n + i] = Math.sqrt(dm);
    }
    this._land = { n, CELL, half, idw, dst };
  },

  _bilerp(arr, x, z) {
    const L = this._land, n = L.n, fx = clamp((x + L.half) / L.CELL, 0, n - 1.001), fz = clamp((z + L.half) / L.CELL, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + n] * (1 - u) + arr[k + n + 1] * u) * v;
  },

  pitBand(world, sample) { const d = this.dist(world, sample); return inRange(d, this._pitFrom, this._pitTo) ? [sample.w / 2 + 2.4, sample.w / 2 + 6.6] : null; },
  flatWidth(s, lat, world) { const pb = lat > 0 && this.pitBand(world, s); return pb ? pb[1] + 24 - s.w / 2 : 0; },

  terrain(x, z) {
    const base = this._bilerp(this._land.idw, x, z), d = this._bilerp(this._land.dst, x, z);
    const ridged = 1 - Math.abs(fbm(x * 0.0035 + 11, z * 0.0035 - 4, 3) * 2);                 // ridges and crests
    const lu = ((x - LAKE.x) / LAKE.a) ** 2 + ((z - LAKE.z) / LAKE.b) ** 2;
    const rise = Math.min(300, 0.46 * Math.max(0, d - 38)) * (0.7 + 0.55 * ridged) * (1 - 0.88 * (1 - smoothstep(0.9, 3.4, lu)));   // low shores round the lake
    const detail = (fbm(x * 0.02, z * 0.02, 3) * 9 + fbm(x * 0.08 + 5, z * 0.08, 2) * 1.5) * Math.min(1, d / 90);
    return base + rise + detail;
  },
  paint(x, z, h) {
    const rock = fbm(x * 0.03 + 3, z * 0.03, 3);
    if (h > 255 + rock * 40) return SURF.Snow;
    if (h > 175 + rock * 60) return rock > -0.05 ? SURF.Gravel : SURF.Dirt;
    return rock > 0.35 ? SURF.Dirt : SURF.Grass;
  },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const pb = lat > 0 && this.pitBand(world, s);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;
      if (lat > pb[1] && lat < pb[1] + 24) return SURF.Concrete;
    }
    return undefined;
  },
  sky: { top: 0x3f78c6, bottom: 0xcfe0f0, fog: 0xbfd2e4, sun: 2.15, hemi: 1.25, fogNear: 600, fogFar: 4200 },

  /** floor of the gorge at z (the water drops over the lip into the plunge pool) */
  ravineFloor(z) { const R = RAVINE; return R.floor + (R.pool - R.floor) * smoothstep(R.zLip, R.zLip + 38, z); },
  /** the gorge: ground cut down to a floor with steep walls (applied to a given ground height) */
  ravine(x, z, h) {
    const R = RAVINE; if (z < R.zNorth || z > R.zLip + 190) return h;
    const u = Math.abs(x - R.x);
    if (u > R.hTop + 30) return h;
    const fl = this.ravineFloor(z), wall = fl + Math.max(0, u - R.hFloor) * R.slope;
    const g = smoothstep(R.zNorth, R.zNorth + 60, z) * (1 - smoothstep(R.zLip + 110, R.zLip + 190, z));   // fades in from the north and out beyond the pool
    return h + (Math.min(h, wall) - h) * g;
  },

  /** ravine, lake, tunnel mound, written into the finished ground */
  adjust(x, z, A, world, info) {
    const near = info.d < 1e8 ? world.track[info.idx] : null, hw = near ? near.w / 2 : 0;
    const onRoad = near && info.d <= hw + 2.0;
    const R = RAVINE;
    // the bridge deck keeps its solid ground for the physics (drawn lower by visualHeight)
    const onDeck = onRoad && Math.abs(x - R.x) < R.hTop + 6 && Math.abs(z - R.deckZ) < 12;
    if (!onDeck) A.h = this.ravine(x, z, A.h);
    if (A.h < 1e8 && Math.abs(x - R.x) < R.hFloor + 4 && z > R.zNorth + 30 && z < R.zLip + 130 && A.h <= this.ravineFloor(z) + 0.6) A.surf = SURF.Dirt;
    // Silver Bow Lake
    const L = LAKE, lu = ((x - L.x) / L.a) ** 2 + ((z - L.z) / L.b) ** 2;
    if (lu < 1.6 && !(near && info.d < hw + 6)) {
      const f = 1 - smoothstep(0.45, 1.6, lu);
      A.h += (L.bed - A.h) * f;
      if (f > 0.55) A.surf = SURF.Dirt; else if (f > 0.1) A.surf = SURF.Sand;
    }
    // the rock mass over the tunnel (not on the road itself, which stays at road height)
    const T = TUNNEL;
    if (!onRoad && x > T.x0 - 20 && x < T.x1 + 20 && Math.abs(z - T.z) < 40) {
      const lat = Math.abs(z - T.z) / 40, lon = Math.max(0, Math.abs(x - (T.x0 + T.x1) / 2) - (T.x1 - T.x0) / 2) / 20;
      const m = (1 - lat * lat) * (1 - smoothstep(0, 1, lon));
      if (m > 0) A.h = Math.max(A.h, (near ? near.y : 172) + 17 * m);
    }
  },

  /** red rock in the gorge and below the falls, with bands of strata */
  colorAt(x, z, sid, y, world) {
    const R = RAVINE;
    if (z < R.zNorth || z > R.zLip + 200 || Math.abs(x - R.x) > R.hTop + 40) return null;
    const rim = world.terrainHeight(x, z);
    if (y > rim - 3) return null;
    const band = 0.5 + 0.5 * Math.sin(y * 0.55 + fbm(x * 0.05, z * 0.05, 2) * 4);
    const k = 0.82 + 0.3 * band;
    return [0.62 * k, 0.26 * k, 0.15 * k];
  },

  /** the drawn ground under the bridge deck: down in the gorge, not at deck level */
  visualHeight(x, z, y, world) {
    const R = RAVINE;
    if (Math.abs(x - R.x) < R.hTop + 8 && Math.abs(z - R.deckZ) < 14) {
      const ti = world.trackInfo(x, z), s = ti.index >= 0 ? world.track[ti.index] : null;
      if (s && ti.dist <= s.w / 2 + 3.2) return Math.min(y, this.ravine(x, z, world.terrainHeight(x, z)));
    }
    return y;
  },

  // Armco on both sides all the way round, concrete in the tunnel and on the bridge
  walls(world) {
    const T = world.track, M = T.length, R = RAVINE;
    for (const side of [-1, 1]) {
      let run = [], kind = null;
      const flush = () => { if (run.length > 2) world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall' } : kind === 'solid' ? { height: 1.2, thickness: 0.6, style: 'concrete' } : kind === 'tyres' ? { height: 0.9, thickness: 0.7, style: 'tyrewall' } : { height: 0.8, thickness: 0.3, style: 'armco' }); run = []; };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], hw = s.w / 2, pb = side > 0 && this.pitBand(world, s);
        const inTunnel = s.x > TUNNEL.x0 - 6 && s.x < TUNNEL.x1 + 6 && Math.abs(s.z - TUNNEL.z) < 20;
        const onBridge = Math.abs(s.x - R.x) < R.hTop + 12 && Math.abs(s.z - R.deckZ) < 16;
        const k = pb ? 'pit' : inTunnel ? 'solid' : Math.abs(s.curv) > 0.02 ? 'tyres' : 'armco';
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); run.push(last); }
        kind = k;
        let off = pb ? hw + 1.4 : inTunnel ? hw + 0.7 : onBridge ? hw + 0.9 : hw + 3.2;
        if (s.curv * side > 0) { const Rr = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 1.2, Rr - 3)); }
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
    const L = this.length, T = world.track;
    const nearest = (x, z) => { let bi = 0, bd = 1e12; T.forEach((s, i) => { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
    const out = { 'Grid (start/finish)': on(-12, -3), 'Pit lane': on(L - 20, 9) };
    out['Serpentine'] = on(nearest(-400 + SHIFT[0], 495 + SHIFT[1]) - 20);
    out['Cliffhanger Tunnel'] = on(nearest(TUNNEL.x0, TUNNEL.z) - 30);
    out['Truss bridge'] = on(nearest(RAVINE.x - 60, RAVINE.deckZ) - 20);
    out['Alpine Peak'] = on(nearest(600 + SHIFT[0], -305 + SHIFT[1]) - 20);
    out['Eastern descent'] = on(nearest(740 + SHIFT[0], -30 + SHIFT[1]) - 20);
    Object.entries(this.corners).forEach(([k, i]) => { out[k] = on(i - 45); });
    return out;
  },
};
