// Apex Ring: a 723 m karting circuit (8 m wide, 10 m on the pit straight, clockwise).
//
// Geometry comes from the design sheet (docs/circuits/kart-circuit-design.png), exported by
// tools/design-kart-circuit.py: a fast right-hander at the end of the 150 m straight, a kink and
// a hairpin down the right side, an S-bend into the technical infield, and a long left-hander
// back to the line. Small undulations (about 3 m in total) keep it from being a flat parking lot.
import { smoothstep } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';
import { CENTERLINE, LENGTH, CORNER_DISTANCES } from './kart-track.js';

const SP = LENGTH / CENTERLINE.length;
const wrap = (s) => ((s % LENGTH) + LENGTH) % LENGTH;
const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);
export const CORNERS = Object.fromEntries(CORNER_DISTANCES.map((d, i) => [`Turn ${i + 1}`, d]));

// ---- profiles (lap distance m -> value)
const TAU = Math.PI * 2;
const elevation = (s) => 1.0 * Math.sin(TAU * s / LENGTH + 0.4) + 0.55 * Math.sin(TAU * 2 * s / LENGTH + 1.7) + 0.25 * Math.sin(TAU * 3 * s / LENGTH);
const PIT = { from: LENGTH - 60, to: 105 };                              // pit lane beside the main straight (right of travel)
const width = (s) => { const sd = wrap(s + 110) - 110; return 8 + 2 * smoothstep(-110, -70, sd) * (1 - smoothstep(130, 170, sd)); };   // 10 m on the pit straight
const pitBand = (dist, hw) => (inRange(dist, PIT.from, PIT.to) ? [hw + 2.2, hw + 6.2] : null);

export default {
  id: 'kart',
  name: 'Apex Ring (kart)',
  length: LENGTH,
  size: 520,
  trackWidth: 8,
  botMargin: 0.9,
  kerbs: 'corners',
  kerbCurvature: 0.012,   // kerbs where the radius is under ~85 m
  runoff: 2.6,            // a strip of tarmac run-off beyond the kerb
  blend: 12,
  scenery: 'kart',
  corners: CORNERS,
  pit: PIT,
  defaultCar: 'KZ Shifter Kart',                     // the circuit opens with a kart (the player can pick any other car afterwards)
  pitBand(world, sample) { return pitBand(this.dist(world, sample), sample.w / 2); },
  signedBank: true,
  flatReach: 10,
  flatWidth(s, lat, world) {
    const pb = lat > 0 && pitBand(this.dist(world, s), s.w / 2);
    return pb ? pb[1] + 14 - s.w / 2 : 0;           // the pit lane, garages and paddock beyond sit on flat ground
  },
  trackPoints: CENTERLINE.map(([x, z], i) => { const s = i * SP; return [x, z, elevation(s), 0, width(s)]; }),
  dist(world, sample) { return sample.i * LENGTH / world.trackLength; },
  sampleAt(world, s) { return world.track[Math.round(wrap(s) * world.trackLength / LENGTH) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  prepare(world) {
    for (const t of world.track) { const d = this.dist(world, t); t.noKerbR = inRange(d, PIT.from - 10, PIT.to + 10); }
  },

  terrain(x, z, world) { return fbm(x * 0.012, z * 0.012, 3) * 2.2 + fbm(x * 0.05 + 9, z * 0.05, 2) * 0.25; },
  paint() { return SURF.Grass; },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const pb = lat > 0 && pitBand(this.dist(world, s), hw);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;            // pit lane
      if (lat > pb[1] && lat < pb[1] + 5) return SURF.Concrete;         // garage apron
    }
    return undefined;
  },
  groundTint(x, z, world, sid) {
    if (sid !== SURF.Grass) return 1;
    return Math.floor((x + z * 0.35) / 6) % 2 ? 0.94 : 1.06;            // mown stripes
  },
  sky: { top: 0x4f86d4, bottom: 0xcfe0ee, fog: 0xc6d8e6, sun: 2.1, hemi: 1.3, fogNear: 200, fogFar: 1400 },

  // tyre walls on both sides all the way round, a low pit wall between the track and the pit lane
  walls(world) {
    const T = world.track, M = T.length, hwOf = (s) => s.w / 2;
    for (const side of [-1, 1]) {
      let run = [], kind = null;
      const flush = () => { if (run.length > 2) world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall', fence: false } : { height: 0.9, thickness: 0.7, style: 'tyrewall' }); run = []; };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], dist = this.dist(world, s), hw = hwOf(s), pb = side > 0 && pitBand(dist, hw);
        const k = pb ? 'pit' : 'tyres';
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); run.push(last); }
        kind = k;
        let off = pb ? hw + 1.3 : hw + 4.2;
        if (s.curv * side > 0) { const R = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 1.2, R - 3)); }   // the inside of a hairpin can't fold over
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        const info = world.trackInfo(x, z), other = T[info.index];
        if (other) {                                                                              // never across another leg of the circuit
          const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap);
          if (wrapGap > 40 && info.dist < other.w / 2 + 3) { flush(); continue; }
        }
        run.push([x, z]);
      }
      flush();
    }
  },

  spawns(world) {
    const on = (s, lat = 0) => { const t = this.sampleAt(world, s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat, yaw: Math.atan2(t.tx, t.tz) }; };
    const out = { 'Grid (start/finish)': on(-12, -2), 'Pit lane': on(LENGTH - 20, 8) };
    CORNER_DISTANCES.forEach((d, i) => { out[`Turn ${i + 1}`] = on(d - 40); });
    return out;
  },
};
