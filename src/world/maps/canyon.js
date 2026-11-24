// Canyon Chaos kart circuit ("Red Rock Overpass"): a ~2.5 km figure-of-eight through red-rock mesas (10 m wide, 12 m on the
// start/finish straight). The lap runs over three levels:
//
//  1. Sandstone straight and Canyon Plunge: the grid sits on a high plateau (45 m). After a long left-hander the road crests blind
//     and drops about 42 m down a steep gully to the ravine floor, passing UNDER the timber bridge at the bottom.
//  2. The Serpent's Bowl: twin 180-degree hairpins on the ravine floor, banked about 22 degrees, then a sweep out to the west.
//  3. Mesa Ascent: three legs of switchbacks climbing about 70 m up the face of a red-rock spire with no barrier at the cliff edge,
//     with rockslides dropping boulders onto the inside line, to the summit at 74 m.
//  4. The Crossfire Jump: along the mesa top the road dives into a sharp entry chicane down to the timber trestle bridge across the
//     ravine. Straight ahead a short runway runs to a kicker ramp lined up with the bridge: with enough speed you fly over the
//     chicane and most of the bridge, while the lap below passes under the trestle.
//  5. Devil's Spine: off the bridge, a downhill right flick onto a banked, tightening left carousel that feeds the start straight;
//     its low inside line is rough gravel, the high line is clean.
//
// The bridge deck is a separate layer (`deckAt`), as on the Amalfi viaduct. The land is generated from the road: each spot takes
// the height of the nearest road (sharply weighted, so levels meet in cliffs) and rises in stepped red-rock strata away from it.
import { smoothstep, clamp } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

// the bridge axis: through the crossing at (0, 0), heading east-south-east; (u along, v to the right) -> world (x, z)
export const AXIS = { tx: 0.8, tz: 0.6 };
const A = (u, v = 0) => [AXIS.tx * u - AXIS.tz * v, AXIS.tz * u + AXIS.tx * v];
const toAxis = (x, z) => [x * AXIS.tx + z * AXIS.tz, -x * AXIS.tz + z * AXIS.tx];
// the plunge runs down a line through the crossing at right angles to the bridge
const D = (t) => [-AXIS.tz * t, AXIS.tx * t];

// [x, z, height, bank deg, width]  planned with x east and z south; the lap starts on the east straight heading north
const RAW = [
  [254, 10, 45, 0, 12], [254, -50, 45, 0, 12], [251, -100, 45, 0, 12],
  [249, -136, 45, 2], [240, -168.5, 45.1, 5], [216.5, -192.3, 45.3, 6], [184, -201, 45.4, 6], [151.5, -192.3, 45.2, 2], // turn 1, sweeping onto the crest
  [...D(-220), 44.8, 0], [...D(-185), 42.5, 0], [...D(-150), 36.5, 0], [...D(-112), 28, 0], [...D(-74), 18.5, 0], [...D(-38), 9.5, 0], // the Canyon Plunge
  [...D(0), 3.2, 0], [...D(32), 2.6, 0], [...D(62), 2.2, 0],                                              // under the bridge
  [-48, 82, 2, 0],                                                                                       // the Serpent's Bowl
  [-52, 105, 2, 14, 12], [-58, 122, 2.2, 22, 12], [-75, 129, 2.4, 22, 12], [-92, 122, 2.4, 22, 12], [-99, 105, 2.4, 0],
  [-100, 72, 2.6, 12, 12], [-107, 54, 2.8, 22, 12], [-124, 46, 3, 22, 12], [-141, 54, 3, 22, 12], [-148, 72, 3, 0],
  [-150, 110, 3.2, 0], [-156, 150, 3.5, 6], [-178, 182, 3.8, 8], [-212, 195, 4, 6], [-252, 192, 4.3, 6],
  [-283, 172, 4.6, 8], [-295, 140, 5.5, 4],                                                               // Mesa Ascent
  [-296, 100, 10, 0], [-296, 55, 15.5, 0], [-296, 12, 21, 0],
  [-295, -14, 23.5, 10], [-288, -31, 24.5, 10], [-271, -38, 25, 10], [-254, -31, 25.5, 10], [-247, -14, 26, 6],
  [-247, 25, 30, 0], [-247, 65, 35, 0],
  [-247, 95, 38.5, 8], [-240, 114, 39.5, 10], [-223, 121, 40, 10], [-206, 114, 40.5, 10], [-199, 97, 41.5, 6],
  [-199, 55, 47, 0], [-199, 10, 53, 0], [-199, -35, 59, 0], [-198, -75, 64, 4],
  [-193, -108, 68.5, 8], [-176, -127, 72, 8],                                                             // the summit
  [...A(-190), 74, 0], [...A(-150), 71.5, 0], [...A(-110), 68.5, 0],                                      // mesa top, runway branches off
  [...A(-84, 6), 67.3, 0], [...A(-64, 19), 65.6, 0], [...A(-47, 16), 63.6, 0], [...A(-34, 6), 62.2, 0],   // the entry chicane
  [...A(-22), 61, 0], [...A(0), 59.3, 0], [...A(22), 57.6, 0], [...A(44), 54.6, 0],                       // the trestle bridge
  [58, 45, 52, 0], [84, 72, 50.3, 0], [100, 104, 49.2, 0],                                                // Devil's Spine
  [110, 145, 48.4, 12], [140, 175, 47.8, 16], [185, 178, 47, 18], [222, 158, 46.2, 18], [245, 118, 45.6, 12], [253, 65, 45.2, 0, 12],
];
const TRACK = RAW.map(([x, z, y, b, w]) => [x, z, y, b, w ?? 10]);

// the jump: a runway straight on along the bridge axis from where the chicane leaves it, ending in a kicker
export const JUMP = { u0: -108, u1: -46, half: 4.5, y0: 68.5, slope: -0.04, kick: 1.3, kickLen: 9 };
const runwayY = (u) => JUMP.y0 + JUMP.slope * (u + 110);
// rockslides on the switchbacks: [raw point index the slide sits beside, lap offset in m]
export const SLIDES = [[36, 0], [51, 0]];

const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

export default {
  id: 'canyon',
  name: 'Canyon Chaos (kart)',
  length: 2500,
  size: 1100,
  meshStep: 2.5,
  trackWidth: 10,
  botMargin: 0.9,
  kerbs: 'corners',
  kerbCurvature: 0.012,
  runoff: 1.6,
  blend: 12,
  scenery: 'canyon',
  corners: {},
  pit: { from: 0, to: 0 },
  defaultCar: 'KZ Shifter Kart',
  flatReach: 8,
  bankFade: [0.004, 0.016],
  trackPoints: TRACK,
  AXIS, JUMP, toAxis, A,
  dist(world, sample) { return sample.i * world.map.length / world.trackLength; },
  sampleAt(world, s) { const L = this.length; return world.track[Math.round((((s % L) + L) % L) * world.trackLength / L) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  props() {
    const [x, z] = A(JUMP.u1 - JUMP.kickLen / 2);
    return [{ type: 'kicker', x, z, yaw: Math.atan2(AXIS.tx, AXIS.tz), width: JUMP.half * 2 - 0.4, length: JUMP.kickLen, height: JUMP.kick, surface: SURF.Concrete }];
  },

  prepare(world) {
    const T = world.track, M = T.length;
    this.length = M; this._world = world;
    // which sample each planned point became
    this._ri = []; { let from = 0; for (const p of RAW) { let bi = from, bd = 1e12; for (let k = 0; k < 400; k++) { const i = (from + k) % M, d = (T[i].x - p[0]) ** 2 + (T[i].z - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } } this._ri.push(bi); from = bi; } }
    this._pitFrom = M - 70; this._pitTo = 110;
    this.pit = { from: this._pitFrom, to: this._pitTo };
    // the crossing: the two samples closest in plan but far apart along the lap; the higher one is the bridge
    let bi = 0, bj = 0, bd = 1e12;
    for (let i = 0; i < M; i += 2) for (let j = i + 150; j < M - 150; j += 2) { const d = (T[i].x - T[j].x) ** 2 + (T[i].z - T[j].z) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } }
    const up = T[bi].y > T[bj].y ? bi : bj, lo = up === bi ? bj : bi, SPAN = 27;
    this._X = { iU: up, iL: lo, x: T[up].x, z: T[up].z, yU: T[up].y, yL: T[lo].y, span: SPAN };
    this._deck = [];
    for (let k = -SPAN; k <= SPAN; k++) { const s = T[(up + k + M) % M]; s.overpass = true; this._deck.push(s); }
    const ri = this._ri;
    this._sec = {
      plunge: [ri[8], ri[14]], bowl: [ri[15], ri[28]], climb: [ri[34], ri[56]], chicane: [ri[58], ri[63]],
      spine: [ri[66], ri[75]], carousel: [ri[69], ri[75]], runway: [ri[57], ri[62]],
    };
    const peaks = [];
    for (let i = 0; i < M; i++) {
      const c = Math.abs(T[i].curv); if (c < 0.014) continue;
      let top = true; for (let k = -24; k <= 24; k += 3) if (Math.abs(T[(i + k + M) % M].curv) > c + 1e-9) { top = false; break; }
      if (top && (!peaks.length || i - peaks[peaks.length - 1] > 30)) peaks.push(i);
    }
    this.corners = Object.fromEntries(peaks.map((p, k) => [`Turn ${k + 1}`, p]));
    for (const t of T) { const d = this.dist(world, t); t.noKerbR = inRange(d, this._pitFrom - 10, this._pitTo + 10); }
    // the land: a coarse grid of "height of the nearest road" (sharply weighted, so road levels meet in cliffs) and distance to it
    const CELL = 10, n = Math.round(world.size / CELL) + 1, half = world.half;
    const sub = []; for (let i = 0; i < M; i += 3) if (!T[i].overpass) sub.push(T[i]);
    const idw = new Float32Array(n * n), dst = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * CELL - half, z = j * CELL - half;
      let sw = 0, sy = 0, dm = 1e9;
      for (const s of sub) {
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2, w = 1 / (d2 + 80) ** 2;
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
  inSec(name, i) { const [a, b] = this._sec[name]; return inRange(i, a, b); },

  /** the bridge deck height under (x, z) for a wheel that is up on it, else -Infinity */
  deckAt(x, z) {
    const X = this._X; if (!X) return -1e9;
    if (Math.abs(x - X.x) > 50 || Math.abs(z - X.z) > 50) return -1e9;
    let best = null, bd = 1e12;
    for (const s of this._deck) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    const dx = x - best.x, dz = z - best.z, along = dx * best.tx + dz * best.tz, lat = dx * best.rx + dz * best.rz;
    if (Math.abs(lat) > best.w / 2 + 1.0 || Math.abs(along) > 2.6) return -1e9;
    return best.y + best.dy * along;
  },

  pitBand(world, sample) { const d = this.dist(world, sample); return inRange(d, this._pitFrom, this._pitTo) ? [sample.w / 2 + 2.2, sample.w / 2 + 6.2] : null; },
  flatWidth(s, lat, world) { const pb = lat > 0 && this.pitBand(world, s); return pb ? pb[1] + 30 - s.w / 2 : 0; },

  /** red-rock land: the nearest road's level, rising away from the road in stepped strata to mesas and canyon walls */
  terrain(x, z) {
    const base = this._bilerp(this._land.idw, x, z), d0 = this._bilerp(this._land.dst, x, z);
    // mesas and buttes: a plateau field in tall tiers with sheer walls, independent of the road
    const m = clamp(0.5 + fbm(x * 0.0045 + 11, z * 0.0045 - 4, 4) * 1.25, 0, 1) * 175 + 25, Q = 34, r = m / Q, f = r - Math.floor(r);
    const mesa = (Math.floor(r) + smoothstep(0.86, 0.98, f)) * Q;
    // ...held back from the road: steep canyon walls, never closer than ~20 m
    const d = d0 + fbm(x * 0.02 + 3, z * 0.02 - 7, 2) * 8 * Math.min(1, d0 / 25);
    const c = 1.7 * Math.max(0, d - 20) / Q, cf = c - Math.floor(c), cap = (Math.floor(c) + smoothstep(0.55, 0.9, cf)) * Q;   // flat-topped tiers, not cones
    const rise = Math.min(cap, mesa);
    const detail = (fbm(x * 0.04, z * 0.04, 3) * 1.4 + fbm(x * 0.15 + 5, z * 0.15, 2) * 0.35) * Math.min(1, d0 / 40);
    return base + rise + detail;
  },
  paint() { return SURF.Dirt; },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const pb = lat > 0 && this.pitBand(world, s);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;
      if (lat > pb[1] && lat < pb[1] + 30) return SURF.Concrete;
    }
    return undefined;
  },
  sky: { top: 0x3b8fe6, bottom: 0xffe4c2, fog: 0xf3cfa4, sun: 2.2, hemi: 1.15, fogNear: 450, fogFar: 2400 },

  adjust(x, z, A2, world, info) {
    const near = info.d < 1e8 ? world.track[info.idx] : null, hw = near ? near.w / 2 : 5;
    const onRoad = near && info.d <= hw + 1.4;
    const [u, v] = toAxis(x, z), J = JUMP;
    // the jump runway along the bridge axis, and a ditch between its lip and the chicane so the ramp stands proud
    if (!onRoad && u > J.u0 - 4 && u < J.u1 + 0.5 && Math.abs(v) < J.half + 3) {
      const e = 1 - smoothstep(J.half, J.half + 3, Math.abs(v));
      A2.h += (runwayY(u) - A2.h) * e;
      if (Math.abs(v) < J.half) A2.surf = SURF.Concrete;
    } else if (!onRoad && u >= J.u1 + 0.5 && u < -24 && Math.abs(v) < J.half + 1.5) {
      A2.h = Math.min(A2.h, runwayY(J.u1) - 6);
    }
    if (!near) return;
    // Devil's Spine: rough gravel along the low inside line of the carousel
    if (info.d <= hw && this.inSec('carousel', info.idx)) {
      const inside = Math.sign(near.curv || 1) * info.lat;                            // + = towards the inside of the bend
      if (inside > hw - 3.4 && Math.abs(near.curv) > 0.012 && fbm(x * 0.3, z * 0.3, 2) > -0.25) A2.surf = SURF.Gravel;
    }
  },

  /** red sandstone in strata, pale sand on the ravine floor, darker desert varnish on the steepest faces */
  colorAt(x, z, sid, y, world) {
    if (sid === SURF.Asphalt || sid === SURF.Concrete || sid === SURF.Kerb) return null;
    const g = 2, sl = Math.max(Math.abs(world.heightAtGrid(x + g, z) - world.heightAtGrid(x - g, z)), Math.abs(world.heightAtGrid(x, z + g) - world.heightAtGrid(x, z - g))) / (2 * g);
    const n = fbm(x * 0.05, z * 0.05, 3), n2 = fbm(x * 0.21, z * 0.21, 2);
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const BANDS = [[0.42, 0.08, 0.03], [0.52, 0.13, 0.045], [0.33, 0.06, 0.025], [0.62, 0.25, 0.1], [0.46, 0.1, 0.035], [0.28, 0.05, 0.02], [0.7, 0.36, 0.17]];
    const yb = y * 0.3 + n * 1.6, b0 = Math.floor(yb), bt = smoothstep(0.75, 1, yb - b0);
    const band = mix(BANDS[((b0 % 7) + 7) % 7], BANDS[(((b0 + 1) % 7) + 7) % 7], bt);
    const sand = mix([0.6, 0.24, 0.09], [0.5, 0.17, 0.06], clamp(0.5 + n2, 0, 1));
    let c = mix(sand, band, clamp((sl - 0.45) * 2.2, 0, 1));
    c = mix(c, [c[0] * 0.78, c[1] * 0.72, c[2] * 0.72], clamp((sl - 1.6) * 0.6, 0, 0.5) * (0.5 + 0.5 * n2));
    if (sid === SURF.Gravel) c = mix(c, [0.45, 0.33, 0.24], 0.6);
    return c;
  },

  /** off the edge of a mesa or short of the jump: well below the road you were on */
  fellOff(p) {
    const w = this._world; if (!w) return false;
    const T = w.track, M = T.length;
    let bi = -1, bd = 1e12;
    if (this._fi !== undefined) for (let k = -70; k <= 70; k++) { const i = (this._fi + k + M) % M, d = (T[i].x - p.x) ** 2 + (T[i].z - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (bi < 0 || bd > 35 * 35) {                                                     // lost: the nearest sample in 3D
      bd = 1e12; for (let i = 0; i < M; i += 2) { const d = (T[i].x - p.x) ** 2 + (T[i].z - p.z) ** 2 + (T[i].y - p.y) ** 2; if (d < bd) { bd = d; bi = i; } }
    }
    this._fi = bi;
    if (p.y > T[bi].y - 9) return false;
    this._fellAt = bi; this._fi = undefined; return true;
  },
  fellMessage: 'Off the edge! Back on the road',
  splashSpawn(world) {
    const T = world.track, M = T.length, J = this._sec.runway;
    let i = this._fellAt ?? 0;
    if (inRange(i, J[0], (this._X.iU + this._X.span) % M)) i = J[0] - 20;                // missed the jump or the chicane: back before the runway
    const t = T[(i - 30 + M) % M]; return { x: t.x, z: t.z, yaw: Math.atan2(t.tx, t.tz) };
  },

  // armco and tyre walls; none along the switchback legs (open cliff edges); the runway side of the chicane stays open;
  // timber parapets on the bridge (drawn by the scenery); pit wall on the start straight
  walls(world) {
    const T = world.track, M = T.length;
    for (const side of [-1, 1]) {
      let run = [], kind = null;
      const flush = () => {
        if (run.length > 2 && kind !== 'none') {
          const list = world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall' } : kind === 'deck' ? { height: 1.2, thickness: 0.4, style: 'building' } : kind === 'tyres' ? { height: 0.9, thickness: 0.7, style: 'tyrewall' } : { height: 0.8, thickness: 0.3, style: 'armco' });
          if (kind === 'deck') for (const w of list) { const y = this.deckAt((w.ax + w.bx) / 2, (w.az + w.bz) / 2); if (y > -1e8) { w.base = y; w.top = y + w.height; } }
        }
        run = [];
      };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], hw = s.w / 2, pb = side > 0 && this.pitBand(world, s), c = Math.abs(s.curv);
        const [u] = toAxis(s.x, s.z);
        let k = pb ? 'pit' : s.overpass ? 'deck' : c > 0.02 ? 'tyres' : 'armco';
        if (this.inSec('climb', i) && c < 0.02) k = 'none';                                  // open cliff edges on the switchback legs
        if (this.inSec('bowl', i) && s.curv * side > 0.02) k = 'none';                       // nothing on the inside of the bowl hairpins
        if (this.inSec('chicane', i) && side < 0 && u < JUMP.u1 + 2) k = 'none';             // the runway branches off on the left
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); if (k !== 'none') run.push(last); }
        kind = k;
        if (k === 'none') continue;
        let off = pb ? hw + 1.3 : k === 'deck' ? hw + 0.6 : hw + 3.0;
        if (s.curv * side > 0) { const R = 1 / Math.max(1e-4, c); off = Math.min(off, Math.max(hw + 1.2, R - 3)); }
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        if (!s.overpass) {
          const info = world.trackInfo(x, z), other = T[info.index];
          if (other) { const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap); if (wrapGap > 40 && info.dist < other.w / 2 + 3 && Math.abs(other.y - s.y) < 6) { flush(); continue; } }
        }
        run.push([x, z]);
      }
      flush();
    }
  },

  spawns(world) {
    const T = world.track, M = T.length;
    const at = (i, lat = 0) => { const t = T[((i % M) + M) % M]; return { x: t.x + t.rx * lat, z: t.z + t.rz * lat, yaw: Math.atan2(t.tx, t.tz) }; };
    const ri = this._ri, X = this._X;
    const out = { 'Grid (start/finish)': at(-12, -2), 'Pit lane': at(M - 20, 8) };
    out['Canyon Plunge'] = at(ri[6]);
    out["Serpent's Bowl"] = at(ri[15]);
    out['Mesa Ascent'] = at(ri[33]);
    out['Summit / jump run'] = at(ri[56]);
    out['Under the bridge'] = at(X.iL - 60);
    out["Devil's Spine"] = at(ri[66]);
    Object.entries(this.corners).forEach(([k, i]) => { out[k] = at(i - 40); });
    return out;
  },
};
