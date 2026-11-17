// Brands Hatch GP circuit (3.908 km, clockwise), Kent, UK.
//
// Geometry: centreline extracted from a scaled layout diagram by tools/extract-track.py
// (validated: the Indy loop measures 1,947 m vs the real 1,929 m), rotated to true north
// using satellite imagery. Corner names follow the current layout.
// Elevation: the Indy sections (start -> Surtees, Clark Curve -> line) use a measured profile
// (176.7-195.3 m ASL). The GP-only loop is shaped to the circuit's character within that
// envelope. Camber is estimated (incl. off-camber Stirling's).
import { smoothstep } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';
import { CENTERLINE, ANCHORS, LENGTH } from './brands-hatch-track.js';
import { INDY_ELEVATION } from './brands-hatch-elevation.js';

const SP = LENGTH / CENTERLINE.length;           // control-point spacing (~8 m)
const at = (name) => ANCHORS[name] * SP;          // distance of a named corner from the line
const P = at('Paddock Hill Bend'), D = at('Druids'), G = at('Graham Hill Bend'), U = at('Surtees');
const PD = at("Pilgrim's Drop"), H = at('Hawthorn Bend'), DM = at('Derek Minter Straight'), W = at('Westfield Bend');
const DD = at('Dingle Dell'), SH = at("Sheene's"), ST = at("Stirling's"), C = at('Clearways'), K = at('Clark Curve');
export const CORNERS = { 'Paddock Hill Bend': P, 'Druids': D, 'Graham Hill Bend': G, 'Surtees': U, "Pilgrim's Drop": PD, 'Hawthorn Bend': H, 'Westfield Bend': W, 'Dingle Dell': DD, "Sheene's": SH, "Stirling's": ST, 'Clearways': C, 'Clark Curve': K };

// ---------------------------------------------------------------- profiles (distance m -> value)
const wrap = (s) => ((s % LENGTH) + LENGTH) % LENGTH;
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

// ---- elevation (m, relative to 185 m ASL)
// Shared Indy sections use the measured profile; the Indy loop is 1,929 m and leaves the
// GP at Surtees ('Indy split') and rejoins at Clark Curve ('Indy rejoin').
const SPLIT = ANCHORS['Indy split'] * SP, REJOIN = ANCHORS['Indy rejoin'] * SP;
const INDY_LEN = 1929, LINK = INDY_LEN - SPLIT - (LENGTH - REJOIN);
const indyAt = (d) => {
  const i = Math.max(0, Math.min(INDY_ELEVATION.length - 2, Math.floor(d / 25))), f = (d - i * 25) / 25;
  return INDY_ELEVATION[i][1] + (INDY_ELEVATION[i + 1][1] - INDY_ELEVATION[i][1]) * Math.max(0, Math.min(1, f));
};
// GP-only loop (Surtees -> Pilgrim's Drop -> Hawthorn -> Westfield -> Dingle Dell -> Stirling's ->
// Clearways -> Clark): no survey data, so shaped from the circuit's character and kept inside the
// measured 176.7-195.3 m envelope; ends match the measured values at both junctions.
const gpLoop = periodic([
  [SPLIT, indyAt(SPLIT)], [SPLIT + 90, 184.0], [SPLIT + 240, 183.0], [PD, 180.0], [H - 40, 177.6], [H, 178.0],
  [DM, 180.5], [W, 181.0], [DD - 70, 177.8], [DD, 178.5], [SH, 181.5], [ST, 185.0], [C, 189.0], [REJOIN, indyAt(SPLIT + LINK)],
]);
const elevationAbs = (s) => {
  s = wrap(s);
  if (s <= SPLIT) return indyAt(s);
  if (s >= REJOIN) return indyAt(SPLIT + LINK + (s - REJOIN));
  return gpLoop(s);
};
export const ELEVATION_BASE = 185;
const elevation = smooth((s) => elevationAbs(s) - ELEVATION_BASE, 15);
// camber (deg, + = banked toward the inside; Stirling's is famously off-camber)
const BANKS = [[P, 3, 70], [D, 5, 50], [G, 2, 60], [U, 2, 60], [H, 2, 80], [W, 3, 80], [DD, 1, 60], [ST, -2.5, 60], [C, 3, 90], [K, 2, 70]];
// signed per corner from the centreline itself (+1 = right-hander), so a near-straight
// section (Clearways) can't flip the camber from side to side
const turnDir = (s) => {
  const n = CENTERLINE.length, i = Math.round(wrap(s) / SP), a = CENTERLINE[(i - 5 + n) % n], b = CENTERLINE[i % n], c = CENTERLINE[(i + 5) % n];
  return Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) || 1;
};
const bank = (s) => BANKS.reduce((a, [c, deg, hw]) => { const d = Math.abs(((s - c + LENGTH * 1.5) % LENGTH) - LENGTH / 2); return a + deg * turnDir(c) * smoothstep(hw, hw * 0.4, d); }, 0);
// track width (m): wide pit straight, Indy loop ~12.5 m, GP loop ~11 m
const width = smooth(periodic([[0, 15], [140, 14], [P, 13], [D, 12.5], [G, 12], [U, 12], [U + 150, 11], [H, 11], [W, 11], [DD, 11], [ST, 11.5], [C, 12], [K, 12.5], [3560, 15]]), 30);

// pit lane along Brabham Straight (inside = right of travel)
const PIT = { from: 3570, to: 115, entry: 3480, exit: 205 };
/** pit lane band [inner, outer] metres right of the centreline (hw = track half width), or null.
 *  Full lane hw+3.5..hw+15.5; the entry/exit lanes peel off the track edge with a growing grass
 *  island (the 'gore') between them and the circuit. */
const pitBand = (dist, hw) => {
  if (inRange(dist, PIT.from, PIT.to)) return [hw + 3.5, hw + 15.5];
  let u;
  if (inRange(dist, PIT.entry, PIT.from)) u = smoothstep(PIT.entry, PIT.from, dist);
  else if (inRange(dist, PIT.to, PIT.exit)) u = smoothstep(PIT.exit, PIT.to, dist);
  else return null;
  const c = hw - 3.5 + 13 * u, half = 3.5 + 2.5 * u;
  return [c - half, c + half];
};
const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);
// gravel traps on the outside of corners: [centre, from, to, depth beyond the edge, side]
// side (-1 = left of travel, +1 = right) is fixed per zone - taken from the corner's direction
// in prepare() unless given - so near-straight sections can't flip a trap from side to side.
const GRAVEL = [[P, -40, 130, 38], [D, -50, 45, 24], [G, -30, 50, 14], [U, -30, 60, 20], [H, -40, 70, 26], [W, -40, 80, 24], [ST, -40, 50, 20], [K, -40, 60, 14]];
// tarmac run-off on the outside (left) of Clearways
const TARMAC = [[C, -60, 90, 18, -1]];
const RAMP = 25;  // zones taper in/out over this many metres (traps and barriers ease, not step)
/** depth of the zones on one side at a lap distance, tapered at both ends (0 = none) */
const zoneDepth = (zones, s, side) => {
  s = wrap(s);
  let best = 0;
  for (const [c, a, b, depth, zs] of zones) {
    if (zs !== side) continue;
    const into = wrap(s - (c + a)), len = b - a;
    if (into > len) continue;
    best = Math.max(best, depth * smoothstep(0, RAMP, into) * smoothstep(0, RAMP, len - into));
  }
  return best;
};
// verge width to the barrier where there's no trap: the wooded GP loop is tighter
const baseVerge = (s) => 8 - 2 * smoothstep(U - 40, U + 40, s) * smoothstep(ST + 40, ST - 40, s);

// pit-straight shelf: the pit lane, garage apron and garages sit on flat ground that follows
// the straight's own gradient (the paddock beyond falls away to Cooper Straight)
const SHELF = { from: 3575, to: 125, right: 45, left: 24, fall: 14, ramp: 45 };

export default {
  id: 'brands',
  name: 'Brands Hatch GP',
  size: 1600,
  trackWidth: 12,
  kerbs: 'corners',
  kerbCurvature: 0.0085,   // kerbs where the radius is under ~120 m
  runoff: 0.6,       // just past the white line before grass
  blend: 24,
  scenery: 'brands',
  corners: CORNERS,
  pit: PIT,
  pitBand(world, sample) { return pitBand(this.dist(world, sample), sample.w / 2); },
  shelf: SHELF,
  signedBank: true,       // bank(): + = right side lower
  tracksideRibbons: true,  // pit lane, apron, run-off are drawn as ribbons by the scenery
  // run-off areas lie flat (no terrain noise under the tarmac / gravel)
  flatReach: 20,
  flatWidth(s, lat, world) {
    const dist = this.dist(world, s), side = Math.sign(lat), pb = side > 0 && pitBand(dist, s.w / 2);
    return Math.max(zoneDepth(TARMAC, dist, side), zoneDepth(GRAVEL, dist, side) * 0.6, pb ? pb[1] + 2 - s.w / 2 : 0);
  },
  /** outside of the corner at lap distance s (-1 left / +1 right), judged over +/-40 m */
  outside(world, s) { let c = 0; for (let d = -40; d <= 40; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },
  /** metres beyond the track edge to the barrier on one side */
  barrierOffset(world, sample, side) {
    const dist = this.dist(world, sample);
    return Math.max(baseVerge(dist), Math.max(zoneDepth(GRAVEL, dist, side), zoneDepth(TARMAC, dist, side)) + 3);
  },
  /** tarmac run-off depth beyond the track edge on one side (for the scenery ribbon) */
  tarmacDepth(world, sample, side) { return zoneDepth(TARMAC, this.dist(world, sample), side); },
  trackPoints: CENTERLINE.map(([x, z], i) => { const s = i * SP; return [x, z, elevation(s), bank(s), width(s)]; }),

  /** distance along the lap for a track sample */
  dist(world, sample) { return sample.i * LENGTH / world.trackLength; },
  sampleAt(world, s) { return world.track[Math.round(wrap(s) * world.trackLength / LENGTH) % world.trackLength]; },

  // terrain follows the circuit (it sits in a natural bowl): inverse-distance blend of
  // nearby track heights on a coarse grid, plus noise that grows away from the track
  prepare(world) {
    const C = 16, n = Math.ceil(world.size / C) + 2, half = world.size / 2;
    const pts = world.track.filter((_, i) => i % 10 === 0);
    const hgt = new Float32Array(n * n), dist = new Float32Array(n * n), near = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * C - half, z = j * C - half;
      let wsum = 0, hsum = 0, dmin = Infinity, imin = 0;
      for (const p of pts) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2; if (d2 < dmin) { dmin = d2; imin = p.i; }
        const w = 1 / (d2 + 400); wsum += w * w; hsum += w * w * p.y;
      }
      hgt[j * n + i] = hsum / wsum; dist[j * n + i] = Math.sqrt(dmin); near[j * n + i] = imin;
    }
    this._coarse = { C, n, half, hgt, dist, near };
    // M20 motorway: runs NNW-SSE east of the Paddock/Druids area (east = -X in world space)
    const d0 = this.sampleAt(world, D), b = 340 * Math.PI / 180;
    const rx = -Math.sin(b), rz = Math.cos(b), ox = d0.x - 300, oz = d0.z;
    this.motorway = { ox, oz, dx: rx, dz: rz, half: 15, len: 900 };
    this._road = (x, z) => { const px = x - ox, pz = z - oz; return Math.abs(px * rz - pz * rx) < 15 && Math.abs(px * rx + pz * rz) < 900; };
    // no kerb on the pit side where the entry/exit lanes leave and rejoin
    for (const t of world.track) { const d = this.dist(world, t); t.noKerbR = inRange(d, PIT.entry - 15, PIT.from + 10) || inRange(d, PIT.to - 10, PIT.exit + 15); }
    // which side each run-off zone is on: the outside of its corner, judged over +/-40 m
    const outsideOf = (s) => this.outside(world, s);
    for (const z of [...GRAVEL, ...TARMAC]) z[4] ??= outsideOf(z[0]);
    // spectator banks (raised ground) outside Paddock Hill, Druids and Clearways
    this._banks = [[P, outsideOf(P)], [D, outsideOf(D)], [C, -1]].map(([s, side]) => { const t = this.sampleAt(world, s); return { x: t.x + t.rx * side * 55, z: t.z + t.rz * side * 55, r: 70, h: 5 }; });

    // pit-straight shelf on a 4 m grid: weight (1 = flat) and height
    const pit = world.track.filter((t) => inRange(this.dist(world, t), SHELF.from - 60, SHELF.to + 60) && t.i % 2 === 0);
    const xs = pit.map((t) => t.x), zs = pit.map((t) => t.z), pad = SHELF.right + SHELF.fall + 20;
    const S = 4, x0 = Math.min(...xs) - pad, z0 = Math.min(...zs) - pad;
    const nx = Math.ceil((Math.max(...xs) + pad - x0) / S) + 1, nz = Math.ceil((Math.max(...zs) + pad - z0) / S) + 1;
    const sw = new Float32Array(nx * nz), sh = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * S, z = z0 + j * S;
      let best = null, bd = Infinity;
      for (const t of pit) { const d2 = (t.x - x) ** 2 + (t.z - z) ** 2; if (d2 < bd) { bd = d2; best = t; } }
      const dx = x - best.x, dz = z - best.z, along = dx * best.tx + dz * best.tz, lat = dx * best.rx + dz * best.rz;
      const hw = best.w / 2, dist = this.dist(world, best);
      const flat = lat >= 0 ? hw + SHELF.right : hw + SHELF.left;
      let w = smoothstep(flat + SHELF.fall, flat, Math.abs(lat));
      let e = wrap(dist + along - SHELF.from); if (e > LENGTH / 2) e -= LENGTH;            // metres into the shelf
      const len = wrap(SHELF.to - SHELF.from);
      w *= smoothstep(-SHELF.ramp, 0, e) * smoothstep(-SHELF.ramp, 0, len - e);           // taper at the ends
      sw[j * nx + i] = w; sh[j * nx + i] = best.y + best.dy * along;
    }
    this._shelf = { S, x0, z0, nx, nz, sw, sh };
  },
  _shelfAt(x, z) {
    const { S, x0, z0, nx, nz, sw, sh } = this._shelf;
    const fx = (x - x0) / S, fz = (z - z0) / S;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return [0, 0];
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nx + i;
    const bl = (A) => (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + nx] * (1 - u) + A[k + nx + 1] * u) * v;
    const w = bl(sw);
    return [w, w > 0 ? bl(sh) : 0];
  },
  _coarseAt(x, z) {
    const { C, n, half, hgt, dist } = this._coarse;
    const fx = Math.min(n - 1.001, Math.max(0, (x + half) / C)), fz = Math.min(n - 1.001, Math.max(0, (z + half) / C));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i;
    const bl = (A) => (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + n] * (1 - u) + A[k + n + 1] * u) * v;
    return [bl(hgt), bl(dist)];
  },
  terrain(x, z) {
    const [h, d] = this._coarseAt(x, z);
    let y = h + fbm(x * 0.01, z * 0.01, 3) * (1 + smoothstep(40, 300, d) * 9) + fbm(x * 0.05 + 9, z * 0.05, 2) * 0.6;
    for (const b of this._banks) y += b.h * smoothstep(b.r, b.r * 0.3, Math.hypot(x - b.x, z - b.z));
    const [w, sh] = this._shelfAt(x, z);
    return w > 0 ? y + (sh - y) * w : y;
  },

  // West Kingsdown housing (south-west of Clearways / west of Dingle Dell)
  houses: { x0: 160, x1: 640, z0: -700, z1: -140 },

  /** nearest part of the circuit for any point: { dist along lap, metres from centreline } */
  nearestTrack(world, x, z) {
    const { C, n, half, near, dist } = this._coarse;
    const i = Math.round((x + half) / C), j = Math.round((z + half) / C);
    if (i < 0 || j < 0 || i >= n || j >= n) return { along: 0, d: 1e9 };
    const k = j * n + i, s = world.track[near[k]];
    return { along: this.dist(world, s), d: Math.max(dist[k], Math.hypot(s.x - x, s.z - z) - 1) };
  },

  /** woodland density 0..1: thick woods through the GP loop, open around the Indy loop */
  forest(world, x, z) {
    if (Math.abs(x) > world.half - 10 || Math.abs(z) > world.half - 10) return 0;
    const m = this.motorway; if (m) { const px = x - m.ox, pz = z - m.oz; if (Math.abs(px * m.dz - pz * m.dx) < 28) return 0; }
    const hz = this.houses; if (x > hz.x0 && x < hz.x1 && z > hz.z0 && z < hz.z1) return 0.08;
    const { along, d } = this.nearestTrack(world, x, z);
    const ro = Math.max(zoneDepth(TARMAC, along, -1), zoneDepth(TARMAC, along, 1), zoneDepth(GRAVEL, along, -1), zoneDepth(GRAVEL, along, 1));
    if (d < 22 + ro) return 0;                                    // verge, run-off + barrier
    const clump = 0.55 + 0.45 * fbm(x * 0.012 + 3, z * 0.012 - 7, 3) * 1.6;
    if (d > 160) return Math.max(0, 0.55 * clump);                // surrounding Kent countryside
    if (along > U + 60 && along < C - 80) return Math.min(1, 1.05 * clump);   // the woods of the GP loop
    if (along >= C - 80 && along < K) return 0.25 * clump;        // Clearways banks
    return 0.1 * clump;                                           // Indy loop: open spectator areas
  },
  groundTint(x, z, world, sid) {
    if (sid !== SURF.Grass) return 1;
    if (this.forest(world, x, z) > 0.6) return 0.72;              // woodland floor
    const { along, d } = this.nearestTrack(world, x, z);
    if (d < 90) return Math.floor(along / 9) % 2 ? 0.93 : 1.05;  // mowed stripes on the banks
    return 1;
  },
  surfaceColor(sid) { return sid === SURF.Gravel ? [0.80, 0.68, 0.50] : null; }, // Brands' sandy traps
  sky: { top: 0x6d93c2, bottom: 0xe3e9ee, fog: 0xdfe5ea, sun: 2.0, hemi: 1.35 },

  paint(x, z) {
    // M20 motorway east of the circuit
    if (this._road && this._road(x, z)) return SURF.Asphalt;
    return SURF.Grass;
  },

  paintTrackside(x, z, s, lat, d, hw, world) {
    const dist = this.dist(world, s);
    const pb = lat > 0 && pitBand(dist, hw);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;         // pit lane, entry, exit
      if (inRange(dist, PIT.from, PIT.to) && lat > pb[1] && lat < hw + 21) return SURF.Concrete; // garage apron
    }
    const t = zoneDepth(TARMAC, dist, Math.sign(lat));
    if (t > 0 && d < hw + t) return SURF.Asphalt;
    if (s.kerb && !(lat > 0 && s.noKerbR) && d > hw + 1.2 && d <= hw + 3.4) return SURF.Asphalt; // green-painted run-off strip
    return undefined;
  },

  gravel(s, lat, d, hw, world) {
    const g = zoneDepth(GRAVEL, this.dist(world, s), Math.sign(lat));
    return g > 2.5 && d > hw + 2.5 && d < hw + g;
  },

  // Armco both sides (behind gravel traps where present), concrete pit wall
  walls(world) {
    const T = world.track, M = T.length;
    // barrier offset eases out around a trap and back in again (no steps / zigzags)
    const runoff = (dist, side) => Math.max(zoneDepth(GRAVEL, dist, side), zoneDepth(TARMAC, dist, side));
    const verge = (s, side) => this.barrierOffset(world, s, side);
    // black tyre walls behind gravel / run-off (outside of corners), silver Armco elsewhere;
    // catch fencing where spectators stand (Brabham Straight, Paddock, Druids, Clearways-Clark)
    const kindAt = (s, side) => (runoff(this.dist(world, s), side) + 3 > baseVerge(this.dist(world, s)) + 2 ? 'tyrewall' : 'armco');
    const fenced = (dist) => inRange(dist, C - 120, P + 140) || inRange(dist, D - 90, D + 60);
    for (const side of [-1, 1]) {
      let run = [], runKind = null, runFence = false;
      const flush = () => {
        if (run.length > 2) world.addWall(run, runKind === 'tyrewall' ? { height: 0.9, thickness: 0.7, style: 'tyrewall', fence: runFence } : { height: 0.75, thickness: 0.3, style: 'armco', fence: runFence });
        run = [];
      };
      for (let i = 0; i < M; i += 3) {
        const s = T[i], dist = this.dist(world, s), hw = s.w / 2;
        if (side > 0 && inRange(dist, PIT.from - 10, PIT.to + 10)) { flush(); continue; } // garages: pit wall instead
        const kind = kindAt(s, side), fence = fenced(dist);
        const pb = side > 0 && pitBand(dist, hw);
        if (run.length && (kind !== runKind || fence !== runFence)) { const last = run[run.length - 1]; flush(); run.push(last); }
        runKind = kind; runFence = fence;
        const off = pb ? Math.max(hw + verge(s, side), pb[1] + 4) : hw + verge(s, side);
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        // don't build a barrier across another part of the circuit
        const info = world.trackInfo(x, z), other = T[info.index];
        if (other) {
          const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap);
          if (wrapGap > 40 && info.dist < other.w / 2 + 6) { flush(); continue; }
        }
        if (Math.abs(x) > world.half - 5 || Math.abs(z) > world.half - 5) { flush(); continue; }
        run.push([x, z]);
      }
      flush();
    }
    // pit wall: on the island between the circuit and the pit lane, starting once the island is
    // ~3 m wide at the entry and running until it narrows again at the exit
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
      'Grid (start/finish)': on(-25, -3),
      'Pit lane': on(3720, T[0].w / 2 + 9),
      'Paddock Hill Bend': on(P - 220),
      'Druids': on(D - 180),
      "Pilgrim's Drop": on(U + 120),
      'Hawthorn Bend': on(H - 260),
      'Westfield Bend': on(W - 200),
      'Dingle Dell': on(DD - 160),
      'Clearways': on(C - 220),
    };
  },
};
