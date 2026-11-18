/**
 * Race start: the starting grid behind the start/finish line and the F1-style light sequence.
 *
 * Grid: slots alternate sides of the track, 8 m apart (16 m between cars on the same side), the
 * pole slot on the inside of the first corner. Each slot's painted bar is where the car's nose
 * stops; `x, z` is where the car's centre goes.
 *
 * Lights: five red lights come on one per second, then after a random hold of 0.2-3 s they all
 * go out together, and that's the start.
 */
export const GRID_SPACING = 8, POLE_BACK = 6, CAR_BEHIND_BAR = 2.4;

/** track sample index `metres` behind the start line (sample 0) */
function indexBehind(T, metres) {
  const M = T.length;
  let i = 0, d = 0;
  while (d < metres) { const j = (i - 1 + M) % M; d += Math.hypot(T[i].x - T[j].x, T[i].z - T[j].z) || 0; i = j; if (i === 1) break; }
  return i;
}

export function gridSlots(world, n = 12) {
  const T = world.track; if (!T) return [];
  const M = T.length;
  // pole goes on the inside of the first corner (sum of curvature over the first ~400 m; + = right)
  let turn = 0; for (let i = 0; i < Math.min(M, 400); i++) turn += T[i].curv;
  const poleSide = turn >= 0 ? 1 : -1;
  const slots = [];
  for (let p = 0; p < n; p++) {
    const barBack = POLE_BACK + GRID_SPACING * p, side = p % 2 === 0 ? poleSide : -poleSide;
    const bi = indexBehind(T, barBack), ci = indexBehind(T, barBack + CAR_BEHIND_BAR);
    const b = T[bi], c = T[ci], lat = side * Math.min(3.6, b.w / 4 + 0.3);
    slots.push({
      pos: p + 1, side, lat,
      bar: { x: b.x + b.rx * lat, z: b.z + b.rz * lat, yaw: Math.atan2(b.tx, b.tz), i: bi },
      index: ci, x: c.x + c.rx * lat, z: c.z + c.rz * lat, yaw: Math.atan2(c.tx, c.tz),
    });
  }
  return slots;
}

export class StartLights {
  constructor() { this.phase = 'idle'; this.t = 0; this.lit = 0; }

  /** start the sequence: a 1 s pause, five lights at 1 s intervals, then a random hold */
  begin(hold) { this.phase = 'lights'; this.t = 0; this.lit = 0; this.hold = hold ?? 0.2 + Math.random() * 2.8; }   // online: the host picks the hold so every screen goes out together

  /** cars must stay on the grid until the lights go out */
  get held() { return this.phase === 'lights'; }
  get active() { return this.phase !== 'idle'; }

  /** returns 'light' when a light comes on, 'out' at lights out, else null */
  update(dt) {
    if (this.phase === 'idle') return null;
    this.t += dt;
    if (this.phase === 'lights') {
      const n = Math.max(0, Math.min(5, Math.floor(this.t - 1) + 1));
      if (n > this.lit) { this.lit = n; return 'light'; }
      if (this.lit === 5 && this.t >= 5 + this.hold) { this.phase = 'go'; this.t = 0; this.lit = 0; return 'out'; }
    } else if (this.phase === 'go' && this.t > 2.5) this.phase = 'idle';
    return null;
  }
}
