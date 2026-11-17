// Circuit de Monaco (3.337 km, clockwise), Monte-Carlo / La Condamine.
//
// Geometry: centreline traced from the official 2026 F1 layout map by tools/extract-track.py, rotated to
// true north by fitting it to a GPS route over OpenStreetMap (mean mismatch ~9 m; the corner radii it
// gives match the real ones: Sainte Devote ~20 m, Fairmont hairpin ~10 m, La Rascasse ~12 m).
// Coast, harbour, parks and building footprints come from the same map's colours (tools/extract-map-masks.py).
// Elevation: a measured 10-50 m profile (41 m of climb from the harbour to Casino Square), lap-aligned.
import { smoothstep } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';
import { CENTERLINE, LENGTH } from './monaco-track.js';
import { ELEVATION } from './monaco-elevation.js';
import { decodeMask, MASK } from './monaco-mask.js';

const SP = LENGTH / CENTERLINE.length;
// corners: lap distance of each apex (snapped from curvature peaks of the traced line)
export const CORNERS = {
  'Sainte Dévote': 200, 'Beau Rivage': 485, 'Massenet': 785, 'Casino Square': 906, 'Mirabeau Haute': 1156,
  'Fairmont Hairpin': 1251, 'Mirabeau Bas': 1315, 'Portier': 1386, 'Tunnel': 1730, 'Nouvelle Chicane': 2050,
  'Tabac': 2366, 'Louis Chiron': 2450, 'Piscine': 2577, 'Piscine exit': 2717, 'La Rascasse': 2912, 'Anthony Noghes': 2992,
};
export const TUNNEL = [1590, 1860];                    // under the Fairmont hotel, between Portier and the harbour front
const wrap = (s) => ((s % LENGTH) + LENGTH) % LENGTH;
const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

function periodic(keys) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  return (s) => {
    s = wrap(s);
    for (let i = 0; i < k.length; i++) {
      const [s1, v1] = k[i], [s0, v0] = i ? k[i - 1] : [k[k.length - 1][0] - LENGTH, k[k.length - 1][1]];
      if (s <= s1) return v0 + (v1 - v0) * (s - s0) / (s1 - s0 || 1);
    }
    const [s0, v0] = k[k.length - 1], [s1, v1] = [k[0][0] + LENGTH, k[0][1]];
    return v0 + (v1 - v0) * (s - s0) / (s1 - s0);
  };
}
const smooth = (f, win) => (s) => { let a = 0, n = 0; for (let d = -win; d <= win; d += win / 6) { a += f(s + d); n++; } return a / n; };
const elevation = smooth(periodic(ELEVATION), 10);
// track width (m): wide pit straight, ~10-11 m through the town, tight at the hairpin and Rascasse
const width = smooth(periodic([[0, 13], [120, 12.5], [200, 11.5], [300, 10.5], [485, 10.5], [750, 10.5], [906, 11], [1100, 10.5], [1156, 10],
  [1251, 9.6], [1315, 10], [1386, 9.8], [1500, 10.5], [1700, 11.5], [1900, 11.5], [2050, 10.6], [2366, 11], [2550, 10.2], [2717, 10.2],
  [2912, 9.6], [2992, 11], [3080, 13], [3337, 13]]), 24);
// slight crown/camber: Casino Square is banked into the right-hander, Sainte Devote and Mirabeau fall away a touch
const BANKS = [[906, 2.0, 60], [1156, 1.5, 40], [200, 1.0, 40], [2912, 1.0, 40]];
const turnDir = (s) => {
  const n = CENTERLINE.length, i = Math.round(wrap(s) / SP), a = CENTERLINE[(i - 5 + n) % n], b = CENTERLINE[i % n], c = CENTERLINE[(i + 5) % n];
  return Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) || 1;
};
const bank = (s) => BANKS.reduce((a, [c, deg, hw]) => { const d = Math.abs(((s - c + LENGTH * 1.5) % LENGTH) - LENGTH / 2); return a + deg * turnDir(c) * smoothstep(hw, hw * 0.4, d); }, 0);

// pit lane along the start straight on the harbour side (right of travel): entry at Anthony Noghes, exit at Sainte Devote
const PIT = { from: 3090, to: 120, entry: 3035, exit: 175 };
const pitBand = (dist, hw) => {
  if (inRange(dist, PIT.from, PIT.to)) return [hw + 3.2, hw + 9.2];
  let u;
  if (inRange(dist, PIT.entry, PIT.from)) u = smoothstep(PIT.entry, PIT.from, dist);
  else if (inRange(dist, PIT.to, PIT.exit)) u = smoothstep(PIT.exit, PIT.to, dist);
  else return null;
  const c = hw - 2.0 + 8.2 * u, half = 3.0 * u + 0.8;
  return [c - half, c + half];
};

// ---- land-use grid from the layout map
const GRID = decodeMask(), MN = MASK.n, MRES = MASK.res, MHALF = MASK.size / 2;
const cls = (x, z) => { const i = Math.min(MN - 1, Math.max(0, Math.round((x + MHALF) / MRES))), j = Math.min(MN - 1, Math.max(0, Math.round((z + MHALF) / MRES))); return GRID[j * MN + i]; };
/** distance field in metres from every cell to the nearest cell of the *other* kind (water <-> land) */
function shoreDistance() {
  const D = new Float32Array(MN * MN).fill(1e6), water = (k) => GRID[k] === 1;
  for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) {                // seed: cells next to a cell of the other kind
    const k = j * MN + i; const w = water(k);
    if ((i > 0 && water(k - 1) !== w) || (i < MN - 1 && water(k + 1) !== w) || (j > 0 && water(k - MN) !== w) || (j < MN - 1 && water(k + MN) !== w)) D[k] = 0;
  }
  const r2 = Math.SQRT2;
  for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) { const k = j * MN + i; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + 1); if (j > 0) v = Math.min(v, D[k - MN] + 1);
    if (i > 0 && j > 0) v = Math.min(v, D[k - MN - 1] + r2); if (i < MN - 1 && j > 0) v = Math.min(v, D[k - MN + 1] + r2); D[k] = v; }
  for (let j = MN - 1; j >= 0; j--) for (let i = MN - 1; i >= 0; i--) { const k = j * MN + i; let v = D[k];
    if (i < MN - 1) v = Math.min(v, D[k + 1] + 1); if (j < MN - 1) v = Math.min(v, D[k + MN] + 1);
    if (i < MN - 1 && j < MN - 1) v = Math.min(v, D[k + MN + 1] + r2); if (i > 0 && j < MN - 1) v = Math.min(v, D[k + MN - 1] + r2); D[k] = v; }
  return D.map((v) => v * MRES);
}

export default {
  id: 'monaco',
  name: 'Monaco GP',
  size: 1600,
  trackWidth: 10.5,
  botMargin: 1.5,          // AI keeps this far off the barriers
  kerbs: 'corners',
  kerbCurvature: 0.011,   // red/white kerbs where the radius is under ~90 m
  runoff: 0.35,
  blend: 14,
  scenery: 'monaco',
  corners: CORNERS,
  tunnel: TUNNEL,
  pit: PIT,
  pitBand(world, sample) { return pitBand(this.dist(world, sample), sample.w / 2); },
  signedBank: true,
  seaLevel: 0,
  sky: { top: 0x4f93d8, bottom: 0xc4dcf0, fog: 0xbdd3e6, sun: 2.3, hemi: 1.3, fogNear: 450, fogFar: 3600 },
  trackPoints: CENTERLINE.map(([x, z], i) => { const s = i * SP; return [x, z, elevation(s), bank(s), width(s)]; }),
  dist(world, sample) { return sample.i * LENGTH / world.trackLength; },
  sampleAt(world, s) { return world.track[Math.round(wrap(s) * world.trackLength / LENGTH) % world.trackLength]; },
  inTunnel(s) { return inRange(wrap(s), TUNNEL[0], TUNNEL[1]); },

  // ---------------------------------------------------------------- terrain
  prepare(world) {
    const C = 16, n = Math.ceil(world.size / C) + 2, half = world.size / 2;
    const pts = world.track.filter((_, i) => i % 6 === 0);
    const hgt = new Float32Array(n * n), dist = new Float32Array(n * n), near = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * C - half, z = j * C - half;
      let wsum = 0, hsum = 0, dmin = Infinity, imin = 0;
      for (const p of pts) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2; if (d2 < dmin) { dmin = d2; imin = p.i; }
        const w = 1 / (d2 + 300); wsum += w * w; hsum += w * w * p.y;
      }
      hgt[j * n + i] = hsum / wsum; dist[j * n + i] = Math.sqrt(dmin); near[j * n + i] = imin;
    }
    this._coarse = { C, n, half, hgt, dist, near };
    this._shore = shoreDistance();
    // no kerb where the pit lane leaves and rejoins on the right
    for (const t of world.track) { const d = this.dist(world, t); t.noKerbR = inRange(d, PIT.entry - 15, PIT.from + 10) || inRange(d, PIT.to - 10, PIT.exit + 15); }
  },
  _coarseAt(x, z) {
    const { C, n, half, hgt, dist } = this._coarse;
    const fx = Math.min(n - 1.001, Math.max(0, (x + half) / C)), fz = Math.min(n - 1.001, Math.max(0, (z + half) / C));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i;
    const bl = (A) => (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + n] * (1 - u) + A[k + n + 1] * u) * v;
    return [bl(hgt), bl(dist)];
  },
  /** metres to the shoreline, + on land and - in the water (bilinear on the 2 m grid) */
  shoreAt(x, z) {
    const fx = Math.min(MN - 1.001, Math.max(0, (x + MHALF) / MRES)), fz = Math.min(MN - 1.001, Math.max(0, (z + MHALF) / MRES));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * MN + i, D = this._shore;
    const d = (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + MN] * (1 - u) + D[k + MN + 1] * u) * v;
    return GRID[(Math.round(fz)) * MN + Math.round(fx)] === 1 ? -d : d;
  },
  landUse(x, z) { return cls(x, z); },
  terrain(x, z) {
    const sd = this.shoreAt(x, z), [h, dt] = this._coarseAt(x, z);
    if (sd < 0) return -2.5 - Math.min(-sd, 90) * 0.1 + fbm(x * 0.02, z * 0.02, 2) * 0.4;           // harbour and sea floor
    // the town climbs steeply behind the harbour: rise with distance from the water, away from the track
    const hill = Math.min(240, Math.max(0, sd - 70) * 0.26) * smoothstep(30, 190, dt);
    let y = h + hill + fbm(x * 0.012, z * 0.012, 3) * (0.8 + smoothstep(50, 300, dt) * 7) + fbm(x * 0.06 + 9, z * 0.06, 2) * 0.3;
    return 1.8 + (Math.max(y, 1.8) - 1.8) * smoothstep(0, 10, sd);                             // eases down to the quay at the water's edge
  },
  nearestTrack(world, x, z) {
    const { C, n, half, near, dist } = this._coarse;
    const i = Math.round((x + half) / C), j = Math.round((z + half) / C);
    if (i < 0 || j < 0 || i >= n || j >= n) return { along: 0, d: 1e9 };
    const k = j * n + i, s = world.track[near[k]];
    return { along: this.dist(world, s), d: Math.max(dist[k], Math.hypot(s.x - x, s.z - z) - 1) };
  },

  paint(x, z) {
    const sd = this.shoreAt(x, z);
    if (sd < 0) return SURF.Sand;                                                              // seabed under the water
    const u = cls(x, z);
    if (u === 2) return SURF.Grass;                                                            // gardens
    const [, dt] = this._coarseAt(x, z);
    if (sd < 3.5) return SURF.Concrete;                                                        // quay edge
    return dt < 220 ? SURF.Concrete : SURF.Grass;                                              // paved town, then wooded hillside
  },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const dist = this.dist(world, s), pb = lat > 0 && pitBand(dist, hw);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;                                  // pit lane
      if (inRange(dist, PIT.from, PIT.to) && lat > pb[1] && lat < hw + 17) return SURF.Concrete;   // garage apron
    }
    if (s.kerb && !(lat > 0 && s.noKerbR) && d > hw + 1.2 && d <= hw + 2.4) return SURF.Concrete; // kerb run-out
    return undefined;
  },
  surfaceColor(sid) { return sid === SURF.Concrete ? [0.62, 0.60, 0.56] : sid === SURF.Sand ? [0.30, 0.42, 0.45] : sid === SURF.Grass ? [0.27, 0.40, 0.21] : null; },
  groundTint(x, z, world, sid) {
    if (sid === SURF.Concrete) { const k = fbm(x * 0.09, z * 0.09, 2); return 0.88 + k * 0.25; }
    return 1;
  },

  // ---------------------------------------------------------------- barriers
  // Armco and concrete tight to the kerb on both sides all the way round. The pit lane side has the pit wall and
  // garages instead on the start straight. Tunnel walls are solid concrete.
  walls(world) {
    const T = world.track, M = T.length;
    for (const side of [-1, 1]) {
      let run = [], runKind = null;
      const flush = () => {
        if (run.length > 2) world.addWall(run, runKind === 'concrete' ? { height: 1.25, thickness: 0.5, style: 'concrete', fence: false } : { height: 0.8, thickness: 0.3, style: 'armco', fence: runKind === 'armcofence' });
        run = [];
      };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], dist = this.dist(world, s), hw = s.w / 2;
        if (side > 0 && inRange(dist, PIT.from - 8, PIT.to + 8)) { flush(); continue; }          // the pit wall takes over here
        const tunnel = inRange(dist, TUNNEL[0] - 6, TUNNEL[1] + 6);
        const kind = tunnel || inRange(dist, 2960, 3100) ? 'concrete' : (dist > 1500 && dist < 2800) || (dist > 100 && dist < 1500) ? 'armcofence' : 'armco';
        if (run.length && kind !== runKind) { const last = run[run.length - 1]; flush(); run.push(last); }
        runKind = kind;
        const pb = side > 0 && pitBand(dist, hw);
        let off = pb ? Math.max(hw + 1.1, pb[1] + 3) : hw + (s.kerb ? 1.65 : 0.85);
        // inside of a tight corner: an offset curve can't be tighter than the corner allows (it would pile up into a blob)
        if (s.curv * side > 0) { const R = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 0.45, R - 3.2)); }
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        const info = world.trackInfo(x, z), other = T[info.index];
        if (other) {                                                                              // no barrier across another leg of the circuit
          const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap);
          if (wrapGap > 40 && info.dist < other.w / 2 + 3) { flush(); continue; }
        }
        run.push([x, z]);
      }
      flush();
    }
    // pit wall between the track and the pit lane (concrete with catch fence)
    const pw = [];
    for (let i = 0; i < M; i += 2) {
      const s = T[i], dist = this.dist(world, s), hw = s.w / 2, pb = pitBand(dist, hw);
      if (!pb || pb[0] - hw < 1.6) continue;
      const off = hw + Math.min(1.6, (pb[0] - hw) * 0.55);
      pw.push({ d: wrap(dist - PIT.entry), p: [s.x + s.rx * off, s.z + s.rz * off] });
    }
    pw.sort((a, b) => a.d - b.d);
    world.addWall(pw.map((q) => q.p), { height: 1.1, thickness: 0.5, style: 'pitwall', fence: true });
  },

  spawns(world) {
    const T = world.track;
    const on = (s, lat = 0) => { const t = this.sampleAt(world, s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat, yaw: Math.atan2(t.tx, t.tz) }; };
    return {
      'Grid (start/finish)': on(-24, -3.2),
      'Pit lane': on(3180, T[0].w / 2 + 6.4),
      'Sainte Dévote': on(CORNERS['Sainte Dévote'] - 90),
      'Casino Square': on(CORNERS['Casino Square'] - 110),
      'Fairmont Hairpin': on(CORNERS['Fairmont Hairpin'] - 80),
      'Tunnel': on(TUNNEL[0] + 20),
      'Nouvelle Chicane': on(CORNERS['Nouvelle Chicane'] - 150),
      'Tabac': on(CORNERS['Tabac'] - 130),
      'La Rascasse': on(CORNERS['La Rascasse'] - 130),
    };
  },
};
