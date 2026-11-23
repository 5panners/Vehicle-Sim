// Costiera Amalfitana Kart Circuit: a ~3 km hillside and clifftop karting circuit (10 m wide, 12 m on the pit straight, clockwise).
//
// The start/finish straight runs along a terrace high above the Tyrrhenian Sea. From there the lap tumbles down the eastern
// hillside in a string of hairpins, a blind crest and a dip, runs west along the sea cliffs at the bottom of the site (with a
// blind crest and a drop on the way), then climbs back up the western slope through three more hairpins to the terrace.
// About 26 m separate the lowest and highest points of the road.
//
// The hills are generated from the road itself (the ground follows the height of the nearest road and rises into mountains
// with distance), the sea and its cliff are written into the ground by terrain(), and soft undulations by adjust().
import { smoothstep, clamp } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

// [x, z, height]  planned on a sheet with x east and z south (north is up); the lap runs clockwise from the north straight, heading east
const RAW = [
  [-90, -219, 31], [-10, -221, 31.3], [70, -221, 31.6], [150, -216, 31.8], [215, -200, 31.5], [262, -168, 30.5], [290, -125, 29],
  [303, -80, 27.4], [327, -40, 25.5], [356, -8, 24], [350, 28, 22.8], [310, 50, 21.8], [260, 48, 21], [215, 30, 23.2], [170, 22, 21.2],
  [140, 45, 19.2], [140, 90, 17.5], [175, 115, 16.2], [235, 118, 15.2], [295, 108, 12.6], [340, 125, 13.4], [352, 165, 11.5],
  [322, 200, 8.8], [270, 215, 7], [215, 232, 6.2], [160, 248, 5.5], [95, 252, 5], [35, 240, 9], [-20, 235, 7.5], [-85, 248, 4.8],
  [-145, 255, 5.8], [-205, 243, 8], [-255, 215, 10.5], [-285, 170, 13.5], [-295, 120, 15.5], [-298, 70, 17.5], [-285, 30, 19.5],
  [-240, 5, 21], [-190, 5, 23], [-140, 20, 24], [-105, 5, 25], [-100, -35, 26.2], [-135, -65, 27.4], [-195, -70, 28.4], [-250, -65, 29.2],
  [-290, -92, 29.8], [-290, -140, 30.2], [-262, -185, 30.6], [-222, -208, 30.9], [-165, -217, 31],
];
const SC = 1.035;
const P = ([x, z, y], i, n) => [x * SC, z * SC, y, 0, (i > n - 5 || i < 4) ? 12 : 10];
const TRACK = RAW.map((p, i) => P(p, i, RAW.length));

// the coast line (z of the cliff edge) as a function of x: the south run of the road plus a 24 m shelf
const COAST = [[-330, 192], [-285, 192], [-255, 239], [-205, 267], [-145, 279], [-85, 272], [-20, 259], [35, 264], [95, 276], [160, 272], [215, 256], [270, 239], [330, 224], [400, 224], [520, 224]];
const coastZ = (x) => {
  x /= SC;
  if (x <= COAST[0][0]) return COAST[0][1] * SC;
  for (let i = 1; i < COAST.length; i++) if (x <= COAST[i][0]) { const a = COAST[i - 1], b = COAST[i], u = (x - a[0]) / (b[0] - a[0]); return (a[1] + (b[1] - a[1]) * u) * SC; }
  return COAST[COAST.length - 1][1] * SC;
};
export const SEA = { level: 0, bed: -7 };

const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

export default {
  id: 'amalfi',
  name: 'Costiera Amalfitana (kart)',
  length: 3000,
  size: 1500,
  meshStep: 2.5,
  trackWidth: 10,
  botMargin: 0.9,
  kerbs: 'corners',
  kerbCurvature: 0.01,
  runoff: 1.8,
  blend: 14,
  scenery: 'amalfi',
  corners: {},
  pit: { from: 0, to: 0 },
  defaultCar: 'KZ Shifter Kart',
  signedBank: true,
  flatReach: 10,
  trackPoints: TRACK,
  // [lap fraction, count, wavelength m, height m]: long, gentle undulations on the straighter parts
  bumps: [[0.04, 2, 36, 0.22], [0.58, 2, 44, 0.24], [0.76, 1, 40, 0.2]],
  dist(world, sample) { return sample.i * world.map.length / world.trackLength; },
  sampleAt(world, s) { const L = this.length; return world.track[Math.round((((s % L) + L) % L) * world.trackLength / L) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  prepare(world) {
    const T = world.track, M = T.length;
    this.length = M;
    this._pitFrom = M - 70; this._pitTo = 150;
    this.pit = { from: this._pitFrom, to: this._pitTo };
    const peaks = [];
    for (let i = 0; i < M; i++) {
      const c = Math.abs(T[i].curv); if (c < 0.014) continue;
      let top = true; for (let k = -30; k <= 30; k += 3) if (Math.abs(T[(i + k + M) % M].curv) > c + 1e-9) { top = false; break; }
      if (top && (!peaks.length || i - peaks[peaks.length - 1] > 40)) peaks.push(i);
    }
    this.corners = Object.fromEntries(peaks.map((p, k) => [`Turn ${k + 1}`, p]));
    for (const t of T) { const d = this.dist(world, t); t.noKerbR = inRange(d, this._pitFrom - 10, this._pitTo + 10); }
    // the landscape: a coarse grid of "height of the nearest road" (inverse-distance weighted) and "distance to the road"
    const CELL = 20, n = Math.round(world.size / CELL) + 1, half = world.half, every = 4;
    const sub = []; for (let i = 0; i < M; i += every) sub.push(T[i]);
    const idw = new Float32Array(n * n), dst = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * CELL - half, z = j * CELL - half;
      let sw = 0, sy = 0, dm = 1e9;
      for (const s of sub) {
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2, w = 1 / (d2 + 625) ** 1.2;
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

  pitBand(world, sample) { const d = this.dist(world, sample); return inRange(d, this._pitFrom, this._pitTo) ? [sample.w / 2 + 2.2, sample.w / 2 + 6.2] : null; },
  flatWidth(s, lat, world) { const pb = lat > 0 && this.pitBand(world, s); return pb ? pb[1] + 18 - s.w / 2 : 0; },

  /** distance past the cliff edge (positive over the sea) */
  seaward(x, z) { return z - coastZ(x); },

  /** hills that follow the road, mountains inland, a cliff and the sea to the south */
  terrain(x, z) {
    const base = this._bilerp(this._land.idw, x, z), d = this._bilerp(this._land.dst, x, z);
    const ridged = 1 - Math.abs(fbm(x * 0.004 + 11, z * 0.004 - 4, 3) * 2);
    const sd = z - coastZ(x), sea = smoothstep(0, 20, sd);
    const rise = Math.min(260, 0.5 * Math.max(0, d - 55)) * (0.65 + 0.55 * ridged) * (1 - sea);
    const detail = (fbm(x * 0.03, z * 0.03, 3) * 5 + fbm(x * 0.12 + 5, z * 0.12, 2) * 0.8) * Math.min(1, d / 70);
    const land = base + rise + detail;
    const bedZ = SEA.bed - 0.02 * Math.max(0, sd - 20) + fbm(x * 0.02, z * 0.02, 2) * 1.2;
    return land + (bedZ - land) * sea;
  },
  paint(x, z, h) { return h < 0.4 ? SURF.Sand : h > 55 + fbm(x * 0.02, z * 0.02, 2) * 25 ? SURF.Gravel : SURF.Grass; },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const pb = lat > 0 && this.pitBand(world, s);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;
      if (lat > pb[1] && lat < pb[1] + 18) return SURF.Concrete;
    }
    return undefined;
  },
  sky: { top: 0x3b95e8, bottom: 0xe3f3ff, fog: 0xd2e8f6, sun: 2.1, hemi: 1.2, fogNear: 500, fogFar: 3200 },

  adjust(x, z, A, world, info) {
    const near = info.d < 1e8 ? world.track[info.idx] : null; if (!near) return;
    const hw = near.w / 2, edge = 1 - smoothstep(hw - 1.2, hw + 0.3, info.d);
    const lap = info.idx / world.trackLength;
    for (const [f0, n, wl, ht] of this.bumps) {
      const s = (lap - f0) * world.trackLength;
      if (s < 0 || s > n * wl) continue;
      A.h += ht * 0.5 * (1 - Math.cos(2 * Math.PI * s / wl)) * edge;
    }
  },

  /** limestone cliffs, olive-green hillsides, pale sand under the sea */
  colorAt(x, z, sid, y, world) {
    if (sid === SURF.Asphalt || sid === SURF.Concrete || sid === SURF.Kerb) return null;
    const g = 2, sl = Math.max(Math.abs(world.heightAtGrid(x + g, z) - world.heightAtGrid(x - g, z)), Math.abs(world.heightAtGrid(x, z + g) - world.heightAtGrid(x, z - g))) / (2 * g);
    const n = fbm(x * 0.05, z * 0.05, 3), n2 = fbm(x * 0.2, z * 0.2, 2);
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    if (y < 0.2) return mix([0.86, 0.8, 0.62], [0.35, 0.62, 0.62], clamp(-y / 5, 0, 1));
    const green = mix([0.27 + n * 0.05, 0.4 + n * 0.06, 0.15], [0.4 + n2 * 0.05, 0.5, 0.2], clamp(0.5 + n * 2, 0, 1));
    const rock = mix([0.78, 0.72, 0.6], [0.66 + n2 * 0.06, 0.6, 0.5], clamp(n + 0.5, 0, 1));
    const r = clamp((sl - 0.6) * 2.2, 0, 1) + clamp((y - 130) / 120, 0, 0.7);
    let c = mix(green, rock, Math.min(1, r));
    if (y < 1.6) c = mix(c, [0.86, 0.8, 0.62], 0.7);                      // the shingle at the foot of the cliff
    if (sid === SURF.Dirt) c = mix(c, [0.7, 0.58, 0.4], 0.6);
    return c;
  },

  fellOff(p) {
    if (p.y > SEA.level - 1.0) return false;
    const T = this._world ? this._world.track : null; if (!T) return true;
    let bi = 0, bd = 1e12; for (let i = 0; i < T.length; i += 3) { const d = (T[i].x - p.x) ** 2 + (T[i].z - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    this._fellAt = bi; return true;
  },
  fellMessage: 'Over the cliff! Back on the road',
  splashSpawn(world) { const T = world.track, t = T[((this._fellAt ?? 0) - 40 + T.length) % T.length]; return { x: t.x, z: t.z, yaw: Math.atan2(t.tx, t.tz) }; },

  // armco on both sides, tyre walls through the hairpins, pit wall on the pit straight
  walls(world) {
    this._world = world;
    const T = world.track, M = T.length;
    for (const side of [-1, 1]) {
      let run = [], kind = null;
      const flush = () => { if (run.length > 2) world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall' } : kind === 'tyres' ? { height: 0.9, thickness: 0.7, style: 'tyrewall' } : { height: 0.8, thickness: 0.3, style: 'armco' }); run = []; };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], hw = s.w / 2, pb = side > 0 && this.pitBand(world, s);
        const k = pb ? 'pit' : Math.abs(s.curv) > 0.014 ? 'tyres' : 'armco';
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); run.push(last); }
        kind = k;
        let off = pb ? hw + 1.3 : hw + 3.4;
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
    const L = this.length, T = world.track;
    const nearest = (x, z) => { let bi = 0, bd = 1e12; T.forEach((s, i) => { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
    const out = { 'Grid (start/finish)': on(-12, -2), 'Pit lane': on(L - 20, 8) };
    out['Eastern hairpins'] = on(nearest(327 * SC, -40 * SC) - 30);
    out['Blind crest'] = on(nearest(95 * SC, 252 * SC) - 20);
    out['Cliff road'] = on(nearest(-145 * SC, 255 * SC) - 30);
    out['Western climb'] = on(nearest(-298 * SC, 70 * SC) - 30);
    Object.entries(this.corners).forEach(([k, i]) => { out[k] = on(i - 40); });
    return out;
  },
};
