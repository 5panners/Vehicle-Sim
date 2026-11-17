// Test circuit + proving ground: the original sandbox, expressed as a map definition.
import { smoothstep } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

// Circuit control points: [x, z, elevation(m), bank(deg, + = banked toward the inside)]
const TRACK_POINTS = [
  [-200, -300, 0, 0], [100, -310, 0, 0], [330, -290, 0, 0], [440, -200, 1, 6], [470, -60, 3, 7],
  [455, 80, 4, 4], [400, 190, 5, 0], [320, 225, 6, 0], [250, 290, 7, 0], [310, 360, 8, 0],
  [220, 440, 9, 0], [60, 430, 12, 0], [-60, 360, 14, 0], [-170, 400, 11, 0], [-320, 420, 8, 0],
  [-450, 340, 6, 0], [-490, 190, 4, 0], [-450, 60, 3, 0], [-500, -90, 2, 0], [-430, -230, 1, 0],
];
export const TRACK_WIDTH = 14;
const FLAT_ZONES = [[-400, 320, -175, 175]];

export const STRIPS = (() => {
  const names = ['Concrete', 'WetAsphalt', 'Gravel', 'Dirt', 'Grass', 'Sand', 'Snow', 'Ice'];
  const w = 20, x0 = 112;
  return names.map((n, i) => ({ name: n, surface: SURF[n], x0: x0 + i * (w + 2), x1: x0 + i * (w + 2) + w, z0: -140, z1: 140 }));
})();
export const START_PAD = { x0: -90, x1: 100, z0: -70, z1: 70 };
export const SKIDPAD = { x: 30, z: 0, r: 30 };
export const JUMP_PARK = { x0: -390, x1: -120, z0: -165, z1: 165 };
const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

function makeProps() {
  const P = [];
  // Lane 1: tabletops (gap filled, so undershooting is safe): small, medium, large
  P.push({ type: 'table', x: -150, z: -105, yaw: 0, width: 10, up: 7, top: 10, down: 12, height: 1.0, surface: SURF.Concrete });
  P.push({ type: 'table', x: -150, z: -15, yaw: 0, width: 10, up: 10, top: 14, down: 12, height: 2.2, surface: SURF.Dirt });
  P.push({ type: 'table', x: -150, z: 85, yaw: 0, width: 12, up: 13, top: 24, down: 24, height: 3.0, surface: SURF.Concrete });
  // Lane 2: whoops / rollers then a step-up
  P.push({ type: 'rollers', x: -205, z: -80, yaw: 0, width: 10, length: 72, height: 0.55, wavelength: 8, surface: SURF.Dirt });
  P.push({ type: 'table', x: -205, z: 40, yaw: 0, width: 10, up: 9, top: 40, down: 9, height: 1.6, surface: SURF.Dirt });
  // Lane 3: mega GAP jump (needs ~85 km/h)
  P.push({ type: 'kicker', x: -265, z: -50, yaw: 0, width: 10, length: 18, height: 4.0, surface: SURF.Concrete });
  P.push({ type: 'landing', x: -265, z: 4, yaw: 0, width: 14, length: 40, height: 4.5, lead: 9, surface: SURF.Concrete });
  // Lane 4: side-slope (off-camber) and a speed bump
  P.push({ type: 'sideslope', x: -330, z: -60, yaw: 0, width: 16, length: 70, height: 3.5, surface: SURF.Grass });
  P.push({ type: 'table', x: -330, z: 80, yaw: 0, width: 16, up: 6, top: 4, down: 6, height: 0.6, surface: SURF.Concrete });
  // Start pad: speed bumps for suspension testing
  for (let i = 0; i < 3; i++) P.push({ type: 'bump', x: -60 + i * 12, z: -40, yaw: Math.PI / 2, width: 12, length: 1.6, height: 0.12, surface: SURF.Asphalt });
  return P;
}

export default {
  id: 'test',
  name: 'Test Circuit & Proving Ground',
  size: 1400,
  trackWidth: TRACK_WIDTH,
  kerbs: 'full',
  runoff: 3,            // asphalt strip beyond the kerb
  blend: 32,            // metres over which the track blends into the terrain
  trackPoints: TRACK_POINTS,
  props: makeProps,
  scenery: 'test',

  terrain(x, z) {
    let h = fbm(x * 0.004, z * 0.004, 4) * 14 + fbm(x * 0.02 + 50, z * 0.02, 3) * 2.5;
    h += Math.max(0, fbm(x * 0.008 + 7, z * 0.008 - 3, 3)) * 18 * smoothstep(150, 260, z); // hills north of the infield
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(560, 690, edge) * 80 * (0.7 + 0.3 * fbm(x * 0.01, z * 0.01, 2)); // boundary mountains
    let flat = 0;
    for (const [x0, x1, z0, z1] of FLAT_ZONES) {
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      flat = Math.max(flat, 1 - smoothstep(0, 60, Math.hypot(dx, dz)));
    }
    return h * (1 - flat);
  },

  // base (off-track) surface
  paint(x, z, h) {
    let surf = SURF.Grass;
    if (inRect(x, z, START_PAD)) surf = SURF.Asphalt;
    if (x > START_PAD.x1 - 1 && x < STRIPS[0].x0 && z > -30 && z < 30) surf = SURF.Asphalt; // apron to strips
    for (const st of STRIPS) if (x >= st.x0 && x < st.x1 && z >= st.z0 && z < st.z1) surf = st.surface;
    if (inRect(x, z, JUMP_PARK)) surf = SURF.Dirt;
    if (z > 200 && h > 9 && fbm(x * 0.02, z * 0.02, 2) > 0.1) surf = SURF.Dirt;
    if (z > 470 && h > 16) surf = SURF.Snow;
    return surf;
  },

  // gravel traps on the outside of tight corners
  gravel(s, lat, d, hw) {
    const outside = s.curv !== 0 && Math.sign(lat) === -Math.sign(s.curv);
    return Math.abs(s.curv) > 0.006 && outside && d > hw + 3 && d < hw + 28;
  },

  // street-circuit section: concrete walls hugging both sides of the twisty north part
  walls(world) {
    const T = world.track, M = T.length;
    let i0 = world.nearestSample(330, 228), i1 = world.nearestSample(-170, 400);
    if (i1 < i0) i1 += M;
    world.wallSection = { start: i0, end: i1 };
    const flare = 40;
    for (const side of [-1, 1]) {
      const pts = [];
      for (let k = i0; k <= i1; k += 2) {
        const s = T[k % M];
        const f = Math.max(smoothstep(i0 + flare, i0, k), smoothstep(i1 - flare, i1, k)); // flared ends
        const off = side * (s.w / 2 + 2.6 + f * 10);
        pts.push([s.x + s.rx * off, s.z + s.rz * off]);
      }
      world.addWall(pts, { height: 1.05, thickness: 0.6, style: 'street' });
    }
  },

  spawns(world) {
    const T = world.track, t0 = T[0];
    const ws = T[(world.wallSection.start - 60 + T.length) % T.length];
    return {
      'Start pad': { x: -60, z: 0, yaw: Math.PI / 2 },
      'Track grid': { x: t0.x, z: t0.z, yaw: Math.atan2(t0.tx, t0.tz) },
      'Surface strips': { x: (STRIPS[0].x0 + STRIPS[0].x1) / 2, z: -125, yaw: 0 },
      'Jump park': { x: -150, z: -150, yaw: 0 },
      'Mega jump': { x: -265, z: -160, yaw: 0 },
      'Skidpad': { x: SKIDPAD.x, z: SKIDPAD.z - SKIDPAD.r, yaw: Math.PI / 2 },
      'Hills': { x: 0, z: 250, yaw: 0 },
      'Walled section': { x: ws.x, z: ws.z, yaw: Math.atan2(ws.tx, ws.tz) },
    };
  },

  minimapZones: {
    pad: START_PAD, jumps: JUMP_PARK,
    strips: { x0: STRIPS[0].x0, x1: STRIPS[STRIPS.length - 1].x1, z0: STRIPS[0].z0, z1: STRIPS[0].z1 },
  },
};
