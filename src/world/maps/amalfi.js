// Costiera Amalfitana Kart Circuit: a ~3 km hillside and clifftop karting circuit (10 m wide, 12 m on the pit straight, clockwise).
//
// A figure-of-eight over a steep hillside. The lap starts on a terrace high above the Tyrrhenian Sea, sweeps round the east end and
// runs west across the hill, crossing OVER its own later climb on a stone viaduct, then drops through a wide hairpin to the sea,
// runs east along the cliffs through a short headland tunnel, hairpins at the east end and climbs back west, passing UNDER the
// viaduct in a cutting, up the western slope to the terrace. About 27 m separate the lowest and highest points of the road.
//
// The hills are generated from the road itself. The viaduct is a separate layer: its samples are left out of the ground height field
// (so the ground under it is the lower road) and `deckAt()` gives the physics a deck for any wheel that is up on it.
import { smoothstep, clamp } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

// [x, z, height]  planned on a sheet with x east and z south (north is up); the lap runs clockwise from the north straight, heading east
const RAW = [
  [-60, -218, 31], [20, -220, 32.6], [100, -219, 30.4], [180, -212, 32.4], [240, -195, 31.5], [282, -160, 30.6], [298, -115, 29.6], [292, -72, 28.8],
  [258, -52, 28.2], [200, -64, 25.8], [140, -80, 28.4], [80, -72, 26.2], [35, -50, 26.3], [10, -12, 25.8], [0, 30, 25.3], [-15, 70, 24.4],
  [-55, 105, 23], [-110, 128, 21.4], [-165, 133, 19.5], [-203, 158, 17], [-212, 198, 14], [-188, 234, 10.8], [-140, 254, 7.5], [-90, 252, 5.2],
  [-35, 240, 6.8], [20, 246, 5.3], [60, 250, 5], [100, 252, 5.2], [155, 249, 5], [210, 235, 8.5], [265, 218, 6.3], [322, 200, 9],
  [354, 163, 11], [335, 120, 12.5], [290, 98, 14.4], [235, 102, 13.4], [185, 88, 16.6], [130, 76, 14.6], [80, 60, 15.5], [40, 46, 15.5],
  [0, 30, 15.4], [-45, 18, 16], [-95, 10, 17.9], [-150, -5, 19], [-200, -30, 21.6], [-250, -55, 22.8], [-262, -100, 24.5], [-258, -150, 27],
  [-240, -190, 29.2], [-210, -208, 30.5], [-160, -217, 31], [-110, -218, 31],
];
const SC = 1.02;
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
export const TUNNEL = { x0: 22 * SC, x1: 98 * SC, z: 249 * SC, h: 8.2 };      // the headland tunnel on the cliff road

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
  signedBank: true,
  flatReach: 10,
  trackPoints: TRACK,
  // [lap fraction, count, wavelength m, height m]: long, gentle undulations on the straighter parts
  bumps: [[0.03, 2, 36, 0.22], [0.2, 1, 40, 0.2], [0.8, 2, 40, 0.22]],
  dist(world, sample) { return sample.i * world.map.length / world.trackLength; },
  sampleAt(world, s) { const L = this.length; return world.track[Math.round((((s % L) + L) % L) * world.trackLength / L) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  prepare(world) {
    const T = world.track, M = T.length;
    this.length = M;
    this._pitFrom = M - 70; this._pitTo = 150;
    this.pit = { from: this._pitFrom, to: this._pitTo };
    // the crossing: the two samples of the lap that are closest in plan but far apart along the lap; the higher one is the viaduct
    let bi = 0, bj = 0, bd = 1e12;
    for (let i = 0; i < M; i += 2) for (let j = i + 150; j < M - 150 + 0; j += 2) { const d = (T[i].x - T[j].x) ** 2 + (T[i].z - T[j].z) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } }
    const up = T[bi].y > T[bj].y ? bi : bj, lo = up === bi ? bj : bi, SPAN = 24;
    this._X = { iU: up, iL: lo, x: T[up].x, z: T[up].z, yU: T[up].y, yL: T[lo].y, span: SPAN };
    this._deck = [];
    for (let k = -SPAN; k <= SPAN; k++) { const s = T[(up + k + M) % M]; s.overpass = true; this._deck.push(s); }
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

  /** the viaduct: deck height under (x, z) for a wheel that is up on it, else -Infinity */
  deckAt(x, z) {
    const X = this._X; if (!X) return -1e9;
    if (Math.abs(x - X.x) > 48 || Math.abs(z - X.z) > 48) return -1e9;
    let best = null, bd = 1e12;
    for (const s of this._deck) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    const dx = x - best.x, dz = z - best.z, along = dx * best.tx + dz * best.tz, lat = dx * best.rx + dz * best.rz;
    if (Math.abs(lat) > best.w / 2 + 1.0 || Math.abs(along) > 2.6) return -1e9;
    return best.y + best.dy * along;
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
    // the rock of the headland over the tunnel: the road stays at road height, the ground beside and over it rises
    const Tn = TUNNEL;
    if (x > Tn.x0 - 22 && x < Tn.x1 + 22 && Math.abs(z - Tn.z) < 42 && z < coastZ(x) - 6) {
      const lat = Math.abs(z - Tn.z) / 42, lon = Math.max(0, Math.abs(x - (Tn.x0 + Tn.x1) / 2) - (Tn.x1 - Tn.x0) / 2) / 22;
      const m = (1 - lat * lat) * (1 - smoothstep(0, 1, lon)), road = info.d < 1e8 ? info.d <= world.track[info.idx].w / 2 + 2.2 : false;
      if (m > 0 && !road) A.h = Math.max(A.h, 5.2 + 20 * m + fbm(x * 0.08, z * 0.08, 2) * 2 * m);
    }
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

  // armco on both sides, tyre walls through the hairpins, concrete in the tunnel and on the viaduct, pit wall on the pit straight
  walls(world) {
    this._world = world;
    const T = world.track, M = T.length, Tn = TUNNEL;
    for (const side of [-1, 1]) {
      let run = [], kind = null, decks = [];
      const flush = () => {
        if (run.length > 2) {
          const list = world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall' } : kind === 'solid' ? { height: 1.2, thickness: 0.6, style: 'concrete' } : kind === 'deck' ? { height: 1.1, thickness: 0.4, style: 'concrete' } : kind === 'tyres' ? { height: 0.9, thickness: 0.7, style: 'tyrewall' } : { height: 0.8, thickness: 0.3, style: 'armco' });
          if (kind === 'deck') for (const w of list) { const y = this.deckAt((w.ax + w.bx) / 2, (w.az + w.bz) / 2); if (y > -1e8) { w.base = y; w.top = y + w.height; } }
        }
        run = [];
      };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], hw = s.w / 2, pb = side > 0 && this.pitBand(world, s);
        const inTunnel = s.x > Tn.x0 - 4 && s.x < Tn.x1 + 4 && Math.abs(s.z - Tn.z) < 14;
        const k = pb ? 'pit' : s.overpass ? 'deck' : inTunnel ? 'solid' : Math.abs(s.curv) > 0.014 ? 'tyres' : 'armco';
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); run.push(last); }
        kind = k;
        let off = pb ? hw + 1.3 : k === 'deck' ? hw + 0.4 : k === 'solid' ? hw + 0.7 : hw + 3.4;
        if (s.curv * side > 0) { const R = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 1.2, R - 3)); }
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        if (!s.overpass) {
          const info = world.trackInfo(x, z), other = T[info.index];
          if (other) { const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap); if (wrapGap > 40 && info.dist < other.w / 2 + 3) { flush(); continue; } }
        }
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
    const X = this._X;
    out['Viaduct (over)'] = on(X.iU - 60 - 0, 0) && (() => { const t = T[(X.iU - 70 + T.length) % T.length]; return { x: t.x, z: t.z, yaw: Math.atan2(t.tx, t.tz) }; })();
    out['Underpass'] = (() => { const t = T[(X.iL - 70 + T.length) % T.length]; return { x: t.x, z: t.z, yaw: Math.atan2(t.tx, t.tz) }; })();
    out['Headland tunnel'] = on(nearest(TUNNEL.x0 - 45, TUNNEL.z) );
    out['Sea hairpin'] = on(nearest(-203, 158) - 25);
    out['Eastern hairpin'] = on(nearest(354, 163) - 25);
    Object.entries(this.corners).forEach(([k, i]) => { out[k] = on(i - 40); });
    return out;
  },
};
