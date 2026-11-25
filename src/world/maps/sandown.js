// Sandown Park kart circuit (Esher, Surrey): the 900 m Grand Prix layout, clockwise.
//
// Traced from an overhead photo of the venue (sandown-track.js): the club and indy halves joined, a long straight past the
// grid boxes, a long double-apex right at the far end, then back and forth through the infield to the second straight.
// The circuit sits in the middle of the racecourse, with the turf and its white rails running along both long sides,
// the paddock and clubhouse at the west end. Flat, with only the faintest roll in the ground.
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';
import { CENTERLINE, LENGTH, CORNER_DISTANCES } from './sandown-track.js';

const SP = LENGTH / CENTERLINE.length;
const wrap = (s) => ((s % LENGTH) + LENGTH) % LENGTH;
export const CORNERS = Object.fromEntries(CORNER_DISTANCES.map((d, i) => [`Turn ${i + 1}`, d]));

// the faint roll of the ground along the lap (well under a metre)
const TAU = Math.PI * 2;
const elevation = (s) => 0.35 * Math.sin(TAU * s / LENGTH + 0.9) + 0.15 * Math.sin(TAU * 3 * s / LENGTH + 0.2);
const WIDTH = 8;

// other tarmac on the site (world x, z): the links the shorter layouts use, closed off from the Grand Prix circuit by tyres
const SPURS = [
  [[-21, -43.5], [-14.5, -41], [-11.6, -35], [-11.2, -28.5], [-12.4, -23.4], [-15.8, -19.3], [-20.5, -16.6]],   // club layout: down from the long straight
  [[25, -41.5], [19.5, -40.4], [16.2, -36.6], [14.8, -31], [14.2, -26.2], [11.4, -22.6], [8.2, -19.3]],          // indy layout: up from the back of the infield
];
// the paddock (kart pits, scales, clubhouse apron) beyond the hairpin at the west end, and the service road along the south
export const PADDOCK = { x0: -152, x1: -122, z0: -56, z1: -20 };
export const ROAD = { z0: 53, z1: 57 };
// the racecourse either side: turf between white rails
export const COURSES = [{ z0: 63, z1: 104 }, { z0: -92, z1: -60 }];

const segDist = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u);
};
const onSpur = (x, z) => {
  if (x < -26 || x > 30 || z < -46 || z > -14) return false;
  for (const p of SPURS) for (let i = 1; i < p.length; i++) if (segDist(x, z, p[i - 1], p[i]) < WIDTH / 2) return true;
  return false;
};
const inBox = (x, z, b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

export default {
  id: 'sandown',
  name: 'Sandown Park (kart)',
  length: LENGTH,
  size: 560,
  trackWidth: WIDTH,
  botMargin: 0.9,
  kerbs: 'corners',
  kerbCurvature: 0.034,    // kerbs where the radius is under ~30 m (the hairpins and tighter bends)
  runoff: 1.6,             // a narrow strip of tarmac beyond the kerb
  blend: 10,
  scenery: 'sandown',
  corners: CORNERS,
  signedBank: true,
  trackPoints: CENTERLINE.map(([x, z], i) => [x, z, elevation(i * SP), 0, WIDTH]),
  dist(world, sample) { return sample.i * LENGTH / world.trackLength; },
  sampleAt(world, s) { return world.track[Math.round(wrap(s) * world.trackLength / LENGTH) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -20; d <= 20; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },

  terrain(x, z) { return fbm(x * 0.008, z * 0.008, 3) * 1.2 + fbm(x * 0.04 + 9, z * 0.04, 2) * 0.12; },
  paint(x, z) {
    if (onSpur(x, z) || inBox(x, z, PADDOCK)) return SURF.Asphalt;
    if (z >= ROAD.z0 && z <= ROAD.z1) return SURF.Asphalt;
    return SURF.Grass;
  },
  groundTint(x, z, world, sid) {
    if (sid !== SURF.Grass) return 1;
    for (const c of COURSES) if (z > c.z0 && z < c.z1) return Math.floor(x / 9) % 2 ? 1.1 : 1.2;   // the racecourse: brighter, close-mown turf
    return Math.floor((x + z * 0.3) / 7) % 2 ? 0.94 : 1.05;                                            // mown stripes in the infield
  },
  sky: { top: 0x5a8fd6, bottom: 0xd3e2ee, fog: 0xc9dae8, sun: 2.1, hemi: 1.3, fogNear: 220, fogFar: 1500 },

  // tyre walls on both sides all the way round (the closed-off links get a wall across them too)
  walls(world) {
    const T = world.track, M = T.length;
    for (const side of [-1, 1]) {
      let run = [];
      const flush = () => { if (run.length > 2) world.addWall(run, { height: 0.9, thickness: 0.7, style: 'tyrewall' }); run = []; };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], hw = s.w / 2;
        let off = hw + 3.6;
        if (s.curv * side > 0) { const R = 1 / Math.max(1e-4, Math.abs(s.curv)); off = Math.min(off, Math.max(hw + 1.2, R - 3)); }   // the inside of a hairpin can't fold over
        const x = s.x + s.rx * off * side, z = s.z + s.rz * off * side;
        const info = world.trackInfo(x, z), other = T[info.index];
        if (other) {                                                                              // never across another leg of the circuit
          const gap = Math.abs(info.index - i), wrapGap = Math.min(gap, M - gap);
          if (wrapGap > 30 && info.dist < other.w / 2 + 2.5) { flush(); continue; }
        }
        run.push([x, z]);
      }
      flush();
    }
  },

  spawns(world) {
    const on = (s, lat = 0) => { const t = this.sampleAt(world, s); return { x: t.x + t.rx * lat, z: t.z + t.rz * lat, yaw: Math.atan2(t.tx, t.tz) }; };
    const out = { 'Grid (start/finish)': on(-14, -2) };
    CORNER_DISTANCES.forEach((d, i) => { out[`Turn ${i + 1}`] = on(d - 35); });
    return out;
  },
};
