// Circuit de Spa-Francorchamps (7.004 km, clockwise), Stavelot, Belgium.
//
// Geometry: the real GPS route of the circuit, traced from a map screenshot by tools/trace-gps-route.py
// (the map is north-up and its distance markers give the scale). About 0.4 km of it was cropped off the
// picture at Malmedy / Rivage and is a bridged curve (tools/build-spa-track.py), sized so the lap is exactly
// the official 7,004 m. Elevation: a measured 364-466 m profile (102 m of relief) lap-aligned to the circuit.
// Woodland and open ground come from the same map's colours (tools/extract-basemap-forest.py).
import { smoothstep } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';
import { CENTERLINE, LENGTH, BRIDGE } from './spa-track.js';
import { ELEVATION } from './spa-elevation.js';
import { decodeForest, FOREST } from './spa-forest.js';

const SP = LENGTH / CENTERLINE.length;
// lap distance of each corner's apex (snapped from the traced line's curvature)
export const CORNERS = {
  'La Source': 420, 'Eau Rouge': 1044, 'Raidillon': 1190, 'Les Combes': 2431, 'Malmedy': 2653, 'Rivage': 3139,
  'Pouhon': 4100, 'Fagnes': 4700, 'Campus': 5059, 'Stavelot': 5276, 'Paul Frère': 5450, 'Blanchimont': 6090, 'Bus Stop': 6866,
};
const C = CORNERS;
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

export const ELEVATION_BASE = 364;                    // world y = metres above the valley floor at Stavelot
const elevation = smooth(periodic(ELEVATION), 12);
const elevAt = (s) => elevation(s) - ELEVATION_BASE + 2;
// camber (deg, + = banked toward the inside): Eau Rouge / Raidillon compression, Pouhon, Stavelot, Paul Frère, Blanchimont are all banked
const BANKS = [[C['La Source'], 4, 45], [1050, 4, 70], [1200, 3, 80], [C['Les Combes'], 2, 50], [C['Rivage'], 4, 45], [4020, 4, 70], [4190, 3, 60], [C['Fagnes'], 2, 40],
  [C['Campus'], 3, 40], [C['Stavelot'], 4, 60], [C['Paul Frère'], 3, 90], [6030, 2, 90], [6150, 2, 90]];
const turnDir = (s) => {
  const n = CENTERLINE.length, i = Math.round(wrap(s) / SP), a = CENTERLINE[(i - 5 + n) % n], b = CENTERLINE[i % n], c = CENTERLINE[(i + 5) % n];
  return Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) || 1;
};
const bank = (s) => BANKS.reduce((a, [c, deg, hw]) => { const d = Math.abs(((s - c + LENGTH * 1.5) % LENGTH) - LENGTH / 2); return a + deg * turnDir(c) * smoothstep(hw, hw * 0.4, d); }, 0);
// track width (m): 15 m pit straight and La Source exit, ~14 m through the valley, 12.5 m at Pouhon and Fagnes
const width = smooth(periodic([[0, 15], [300, 15], [C['La Source'], 14], [560, 15.5], [900, 14], [1100, 13.5], [1500, 14], [2300, 14], [C['Les Combes'], 13.5],
  [C['Rivage'], 14], [3400, 13.5], [C['Pouhon'], 12.5], [C['Fagnes'], 12.5], [C['Stavelot'], 13], [5600, 14], [C['Blanchimont'], 14], [6500, 14], [C['Bus Stop'], 12.5], [6940, 15], [LENGTH, 15]]), 25);

// pit lane along the start straight (right of travel), from after the Bus Stop chicane to La Source's apex
const PIT = { from: 6950, to: 330, entry: 6770, exit: 405 };
const pitBand = (dist, hw) => {
  if (inRange(dist, PIT.from, PIT.to)) return [hw + 3.5, hw + 14.5];
  let u;
  if (inRange(dist, PIT.entry, PIT.from)) u = smoothstep(PIT.entry, PIT.from, dist);
  else if (inRange(dist, PIT.to, PIT.exit)) u = smoothstep(PIT.exit, PIT.to, dist);
  else return null;
  const c = hw - 3.5 + 12 * u, half = 3.5 + 2.5 * u;
  return [c - half, c + half];
};
/** where a zone begins/ends relative to its centre; ramps taper the zone at both ends so barriers ease in and out */
const RAMP = 30;
const zoneDepth = (zones, s, side) => {
  s = wrap(s); let best = 0;
  for (const [c, a, b, depth, zs] of zones) {
    if (zs !== side) continue;
    const into = wrap(s - (c + a)), len = b - a;
    if (into > len) continue;
    best = Math.max(best, depth * smoothstep(0, RAMP, into) * smoothstep(0, RAMP, len - into));
  }
  return best;
};
// tarmac run-off on the outside of corners (Spa has very little gravel left): [centre, from, to, depth, side]; side fixed in prepare() from the corner direction unless given
const TARMAC = [
  [C['La Source'], -50, 130, 34], [C['Eau Rouge'] + 80, -130, 190, 22, -1], [C['Eau Rouge'] + 80, -130, 190, 16, 1], [C['Les Combes'], -90, 70, 30],
  [C['Malmedy'], -30, 60, 18], [C['Rivage'], -80, 100, 34], [3445, -40, 50, 18], [C['Pouhon'], -90, 150, 26], [C['Fagnes'], -60, 60, 16],
  [C['Campus'], -40, 50, 16], [C['Stavelot'], -60, 100, 30], [C['Paul Frère'], -70, 90, 20], [C['Blanchimont'], -140, 170, 28], [C['Bus Stop'], -70, 70, 24],
];
// level terraces cut into the hillside under the grandstands (the scenery builds them at track level): [centre, from, to, depth beyond the edge, side]
const STAND_TERRACES = [[0, -70, 195, 40, -1], [C['Raidillon'], -110, 90, 52, -1], [C['La Source'], -80, 70, 58, -1], [C['Les Combes'], -100, 50, 52, -1], [C['Bus Stop'], -75, 60, 32, -1]];
const GRAVEL = [[C['Les Combes'], 30, 90, 14], [C['Pouhon'] + 30, -20, 90, 16], [C['Stavelot'], 50, 130, 16]];   // the odd gravel bed beyond the tarmac
const baseVerge = (s) => 9 + 2 * smoothstep(1300, 2300, s) * smoothstep(2430, 2330, s);   // barriers well back from the edge (a little more on the Kemmel straight)

// ---- woodland / open-ground grid from the map
const FGRID = decodeForest(), FN = FOREST.n, FRES = FOREST.res, FHALF = FOREST.size / 2;
const woodAt = (x, z) => FGRID[Math.min(FN - 1, Math.max(0, Math.round((z + FHALF) / FRES))) * FN + Math.min(FN - 1, Math.max(0, Math.round((x + FHALF) / FRES)))];

export default {
  id: 'spa',
  name: 'Spa-Francorchamps',
  size: 2400,
  trackWidth: 14,
  botMargin: 1.4,
  kerbs: 'corners',
  kerbCurvature: 0.0072,   // kerbs where the radius is under ~140 m
  runoff: 0.6,
  blend: 26,
  scenery: 'spa',
  corners: CORNERS,
  pit: PIT,
  bridge: BRIDGE,
  pitBand(world, sample) { return pitBand(this.dist(world, sample), sample.w / 2); },
  signedBank: true,
  tracksideRibbons: true,
  flatReach: 40,
  flatWidth(s, lat, world) {
    const dist = this.dist(world, s), side = Math.sign(lat), pb = side > 0 && pitBand(dist, s.w / 2);
    // the pit lane, garage apron and the paddock beyond them sit on flat ground
    return Math.max(zoneDepth(TARMAC, dist, side), zoneDepth(GRAVEL, dist, side) * 0.6, pb ? pb[1] + 4 - s.w / 2 : 0, side > 0 && inRange(dist, PIT.from, PIT.to) ? 38 : 0, zoneDepth(STAND_TERRACES, dist, side));
  },
  outside(world, s) { let c = 0; for (let d = -40; d <= 40; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },
  barrierOffset(world, sample, side) {
    const dist = this.dist(world, sample);
    return Math.max(baseVerge(dist), Math.max(zoneDepth(GRAVEL, dist, side), zoneDepth(TARMAC, dist, side)) + 3.5);
  },
  tarmacDepth(world, sample, side) { return zoneDepth(TARMAC, this.dist(world, sample), side); },
  trackPoints: CENTERLINE.map(([x, z], i) => { const s = i * SP; return [x, z, elevAt(s), bank(s), width(s)]; }),
  dist(world, sample) { return sample.i * LENGTH / world.trackLength; },
  sampleAt(world, s) { return world.track[Math.round(wrap(s) * world.trackLength / LENGTH) % world.trackLength]; },

  // ---------------------------------------------------------------- terrain
  prepare(world) {
    const Cc = 16, n = Math.ceil(world.size / Cc) + 2, half = world.size / 2;
    const pts = world.track.filter((_, i) => i % 8 === 0);
    const hgt = new Float32Array(n * n), dist = new Float32Array(n * n), near = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * Cc - half, z = j * Cc - half;
      let wsum = 0, hsum = 0, dmin = Infinity, imin = 0;
      for (const p of pts) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2; if (d2 < dmin) { dmin = d2; imin = p.i; }
        const w = 1 / (d2 + 600); wsum += w * w; hsum += w * w * p.y;
      }
      hgt[j * n + i] = hsum / wsum; dist[j * n + i] = Math.sqrt(dmin); near[j * n + i] = imin;
    }
    this._coarse = { C: Cc, n, half, hgt, dist, near };
    for (const t of world.track) { const d = this.dist(world, t); t.noKerbR = inRange(d, PIT.entry - 15, PIT.from + 10) || inRange(d, PIT.to - 10, PIT.exit + 15); }
    const outsideOf = (s) => this.outside(world, s);
    for (const z of [...GRAVEL, ...TARMAC]) z[4] ??= outsideOf(z[0]);
  },
  _coarseAt(x, z) {
    const { C: Cc, n, half, hgt, dist } = this._coarse;
    const fx = Math.min(n - 1.001, Math.max(0, (x + half) / Cc)), fz = Math.min(n - 1.001, Math.max(0, (z + half) / Cc));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i;
    const bl = (A) => (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + n] * (1 - u) + A[k + n + 1] * u) * v;
    return [bl(hgt), bl(dist)];
  },
  terrain(x, z) {
    const [h, d] = this._coarseAt(x, z);
    // the circuit sits in a valley: the hills rise away from it, steeper and higher where the track is low (Eau Rouge, Stavelot)
    const valley = Math.max(0, 104 - h), cap = 22 + 1.15 * valley, rise = Math.min(cap, 0.2 * Math.max(0, d - 28)) * (0.65 + 0.7 * fbm(x * 0.0035 + 11, z * 0.0035 - 5, 3));
    return h + rise + fbm(x * 0.011, z * 0.011, 3) * (0.5 + smoothstep(40, 300, d) * 7) + fbm(x * 0.05 + 9, z * 0.05, 2) * 0.45;
  },
  nearestTrack(world, x, z) {
    const { C: Cc, n, half, near, dist } = this._coarse;
    const i = Math.round((x + half) / Cc), j = Math.round((z + half) / Cc);
    if (i < 0 || j < 0 || i >= n || j >= n) return { along: 0, d: 1e9 };
    const k = j * n + i, s = world.track[near[k]];
    return { along: this.dist(world, s), d: Math.max(dist[k], Math.hypot(s.x - x, s.z - z) - 1) };
  },
  /** woodland density 0..1 (conifers and beech); the map's open ground (fields, paddock) stays clear */
  forest(world, x, z) {
    if (Math.abs(x) > world.half - 10 || Math.abs(z) > world.half - 10) return 0;
    const { along, d } = this.nearestTrack(world, x, z);
    const ro = Math.max(zoneDepth(TARMAC, along, -1), zoneDepth(TARMAC, along, 1), zoneDepth(GRAVEL, along, -1), zoneDepth(GRAVEL, along, 1));
    if (d < 21 + ro) return 0;                                        // verge, run-off and barriers
    if (inRange(along, PIT.entry - 40, PIT.exit + 40) && d < 120) return 0;   // paddock, pits and the media centre
    const wood = woodAt(x, z), clump = 0.6 + 0.4 * fbm(x * 0.013 + 3, z * 0.013 - 7, 3) * 1.5;
    return Math.min(1, (wood ? 1.0 : 0.05) * clump * (d < 60 ? 0.55 + 0.45 * smoothstep(20, 60, d) : 1));
  },
  groundTint(x, z, world, sid) {
    if (sid !== SURF.Grass) return 1;
    const wood = woodAt(x, z), { along, d } = this.nearestTrack(world, x, z);
    if (wood && d > 40) return 0.7;                                   // dark forest floor
    if (d < 90) return Math.floor(along / 8) % 2 ? 0.94 : 1.06;      // mown verges
    return wood ? 0.85 : 1.08;                                        // pasture
  },
  surfaceColor(sid) { return sid === SURF.Gravel ? [0.62, 0.58, 0.5] : sid === SURF.Grass ? [0.2, 0.37, 0.15] : null; },
  sky: { top: 0x5b8fcf, bottom: 0xd2dfe9, fog: 0xc9d6df, sun: 2.0, hemi: 1.25, fogNear: 300, fogFar: 2600 },

  paint() { return SURF.Grass; },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const dist = this.dist(world, s), pb = lat > 0 && pitBand(dist, hw);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;                                    // pit lane, entry, exit
      if (inRange(dist, PIT.from, PIT.to) && lat > pb[1] && lat < hw + 19.2) return SURF.Concrete;   // garage apron
    }
    const t = zoneDepth(TARMAC, dist, Math.sign(lat));
    if (t > 0 && d < hw + t) return SURF.Asphalt;
    return undefined;
  },
  gravel(s, lat, d, hw, world) {
    const g = zoneDepth(GRAVEL, this.dist(world, s), Math.sign(lat));
    return g > 2.5 && d > hw + 2.5 + zoneDepth(TARMAC, this.dist(world, s), Math.sign(lat)) && d < hw + g + zoneDepth(TARMAC, this.dist(world, s), Math.sign(lat));
  },

  // Armco on both sides, tyre walls at the slow corners (La Source, Rivage, Bus Stop), concrete pit wall with catch fence
  walls(world) {
    const T = world.track, M = T.length;
    const runoff = (dist, side) => Math.max(zoneDepth(GRAVEL, dist, side), zoneDepth(TARMAC, dist, side));
    const verge = (s, side) => this.barrierOffset(world, s, side);
    const tyres = (dist) => inRange(dist, C['La Source'] - 10, C['La Source'] + 80) || inRange(dist, C['Rivage'] - 40, C['Rivage'] + 60) || inRange(dist, C['Bus Stop'] - 50, C['Bus Stop'] + 40);
    const kindAt = (s, side) => (runoff(this.dist(world, s), side) > 0.5 && tyres(this.dist(world, s)) ? 'tyrewall' : 'armco');
    const fenced = (dist) => inRange(dist, 6600, 480) || inRange(dist, C['Eau Rouge'] - 160, C['Raidillon'] + 130) || inRange(dist, C['Les Combes'] - 60, C['Les Combes'] + 60);
    for (const side of [-1, 1]) {
      let run = [], runKind = null, runFence = false;
      const flush = () => {
        if (run.length > 2) world.addWall(run, runKind === 'tyrewall' ? { height: 0.9, thickness: 0.7, style: 'tyrewall', fence: runFence } : { height: 0.75, thickness: 0.3, style: 'armco', fence: runFence });
        run = [];
      };
      for (let i = 0; i < M; i += 3) {
        const s = T[i], dist = this.dist(world, s), hw = s.w / 2;
        if (side > 0 && inRange(dist, PIT.from - 10, PIT.to + 10)) { flush(); continue; }       // the pit wall takes over
        const kind = kindAt(s, side), fence = fenced(dist);
        const pb = side > 0 && pitBand(dist, hw);
        if (run.length && (kind !== runKind || fence !== runFence)) { const last = run[run.length - 1]; flush(); run.push(last); }
        runKind = kind; runFence = fence;
        let off = pb ? Math.max(hw + verge(s, side), pb[1] + 4) : hw + verge(s, side);
        // the inside of a hairpin: an offset curve can't be tighter than the corner (it would fold over and cross the track)
        if (s.curv * side > 0) { const Rr = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 1.2, Rr - 3.5)); }
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        const info = world.trackInfo(x, z), other = T[info.index];
        if (other) {                                                                              // never across another leg of the circuit
          const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap);
          if (wrapGap > 40 && info.dist < other.w / 2 + 6) { flush(); continue; }
        }
        if (Math.abs(x) > world.half - 5 || Math.abs(z) > world.half - 5) { flush(); continue; }
        run.push([x, z]);
      }
      flush();
    }
    const pw = [];
    for (let i = 0; i < M; i += 3) {
      const s = T[i], dist = this.dist(world, s), hw = s.w / 2, pb = pitBand(dist, hw);
      if (!pb || pb[0] - hw < 3) continue;
      const off = hw + Math.min(2.4, (pb[0] - hw) * 0.65);
      pw.push({ d: wrap(dist - PIT.entry), p: [s.x + s.rx * off, s.z + s.rz * off] });
    }
    pw.sort((a, b) => a.d - b.d);
    world.addWall(pw.map((q) => q.p), { height: 1.1, thickness: 0.5, style: 'pitwall', fence: true });
  },

  spawns(world) {
    const T = world.track;
    const on = (s, lat = 0) => { const t = this.sampleAt(world, s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat, yaw: Math.atan2(t.tx, t.tz) }; };
    return {
      'Grid (start/finish)': on(-28, -3.6),
      'Pit lane': on(6990, T[0].w / 2 + 9),
      'La Source': on(C['La Source'] - 200),
      'Eau Rouge': on(C['Eau Rouge'] - 150),
      'Les Combes': on(C['Les Combes'] - 400),
      'Pouhon': on(C['Pouhon'] - 250),
      'Fagnes': on(C['Fagnes'] - 200),
      'Stavelot': on(C['Stavelot'] - 180),
      'Blanchimont': on(C['Blanchimont'] - 320),
      'Bus Stop': on(C['Bus Stop'] - 220),
    };
  },
};
