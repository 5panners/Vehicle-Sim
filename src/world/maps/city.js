// Harbour Street Circuit: a 2 km city karting circuit (9 m wide, 11 m on the pit straight, clockwise).
//
// A straight canal runs north-south through the middle of the site. The lap crosses it twice: over a stone arch bridge on the
// north side and, on the way home, by flying the gap in the road (a kicker on the east bank, a lower landing on the west bank).
// The ground climbs and falls about 3 m round the lap, with soft rollers, a dip and a speed hump on the straights.
// The canal, the quay walls, the jump and the bumps are all carved into the height field by `adjust()`, so the physics and
// the rendered terrain agree.
import { smoothstep, clamp } from '../../physics/math.js';
import { SURF } from '../Surfaces.js';
import { fbm } from '../noise.js';

const SC = 0.95;
// [x, z, height, bank, width]  (x east, z south; the lap runs clockwise from the start line on the west side, heading north)
const RAW = [
  [-320, 130, 7.0], [-320, 60, 6.6], [-320, -20, 6.0], [-316, -80, 5.2], [-296, -125, 4.4], [-255, -153, 3.8], [-205, -168, 3.4], [-155, -158, 3.2],
  [-110, -176, 3.2], [-60, -168, 3.5], [-25, -172, 4.0], [0, -172, 4.4], [25, -172, 4.0], [60, -176, 3.6], [110, -170, 3.4], [160, -155, 3.6],
  [205, -130, 4.2], [225, -90, 5.0], [210, -55, 6.0], [170, -50, 6.6], [125, -35, 7.2], [100, 0, 7.4], [115, 45, 7.0], [155, 70, 6.2],
  [205, 80, 5.2], [250, 110, 4.2], [255, 160, 3.4], [215, 200, 2.8], [160, 205, 2.6], [105, 195, 2.8], [65, 218, 2.6], [30, 215, 2.5],
  [8, 215, 2.4], [-8, 215, 1.9], [-35, 215, 1.9], [-80, 212, 2.3], [-130, 205, 2.9], [-180, 215, 3.4], [-235, 232, 4.2], [-285, 222, 5.4],
  [-313, 190, 6.4],
];
const ground = (y) => 1.8 + (y - 1.9) * 0.6;                          // keep the climbs gentle: about 3 m between the lowest and highest point
const width = (i, n) => { const f = i / n; return (f > 0.955 || f < 0.1) ? 11 : 9; };
export const WATER = 0;                                             // water level; the canal bed is 1.6 m below it
export const CANAL = { x: 0, bed: 4.5, wall: 6.0, depth: -1.6 };
const TRACK = RAW.map(([x, z, y], i) => [x * SC, z * SC, ground(y), 0, width(i, RAW.length)]);

const inRange = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

export default {
  id: 'city',
  name: 'Harbour Street (city kart)',
  length: 2000,
  size: 1000,
  meshStep: 1.5,
  trackWidth: 9,
  botMargin: 0.9,
  kerbs: 'corners',
  kerbCurvature: 0.011,
  runoff: 1.6,
  blend: 12,
  scenery: 'city',
  corners: {},
  pit: { from: 0, to: 0 },
  defaultCar: 'KZ Shifter Kart',
  signedBank: true,
  flatReach: 10,
  trackPoints: TRACK,
  bumps: [                                                             // [lap fraction, count, wavelength m, height m]
    [0.30, 5, 14, 0.055],                                               // soft rollers after the bridge
    [0.585, 4, 12, 0.05],                                               // rollers in the infield
    [0.84, 1, 20, 0.08],                                               // a speed hump on the run to the line
  ],
  dist(world, sample) { return sample.i * world.map.length / world.trackLength; },
  sampleAt(world, s) { const L = this.length; return world.track[Math.round((((s % L) + L) % L) * world.trackLength / L) % world.trackLength]; },
  outside(world, s) { let c = 0; for (let d = -25; d <= 25; d += 4) c += this.sampleAt(world, s + d).curv; return -Math.sign(c || 1); },
  noRibbon(t) { return this._gap ? Math.abs(t.x) < CANAL.wall + 0.2 && Math.abs(t.z - this._gap.z) < 30 : false; },   // no tarmac across the jump

  prepare(world) {
    const T = world.track, M = T.length;
    this.length = M;
    // where the lap crosses the canal: the first crossing heading east is the bridge (north), the one heading west is the jump (south)
    this._cross = [];
    for (let i = 0; i < M; i++) { const a = T[i], b = T[(i + 1) % M]; if (a.x * b.x <= 0 && a.x !== b.x) this._cross.push({ i, x: 0, z: a.z + (b.z - a.z) * (a.x / (a.x - b.x)), y: a.y, east: b.x > a.x }); }
    this._bridge = this._cross.find((c) => c.z < 0 && c.east) || this._cross[0];
    this._gap = this._cross.find((c) => c.z > 0 && !c.east) || this._cross[this._cross.length - 1];
    this._pitFrom = M - 70; this._pitTo = 150;
    this.pit = { from: this._pitFrom, to: this._pitTo };
    // corners: local peaks of curvature, named in lap order
    const peaks = [];
    for (let i = 0; i < M; i++) {
      const c = Math.abs(T[i].curv); if (c < 0.016) continue;
      let top = true; for (let k = -30; k <= 30; k += 3) if (Math.abs(T[(i + k + M) % M].curv) > c + 1e-9) { top = false; break; }
      if (top && (!peaks.length || i - peaks[peaks.length - 1] > 40)) peaks.push(i);
    }
    this.corners = Object.fromEntries(peaks.map((p, k) => [`Turn ${k + 1}`, p]));
    for (const t of T) { const d = this.dist(world, t); t.noKerbR = inRange(d, this._pitFrom - 10, this._pitTo + 10); }
  },

  pitBand(world, sample) { const d = this.dist(world, sample); return inRange(d, this._pitFrom, this._pitTo) ? [sample.w / 2 + 2.2, sample.w / 2 + 6.2] : null; },
  flatWidth(s, lat, world) { const pb = lat > 0 && this.pitBand(world, s); return pb ? pb[1] + 16 - s.w / 2 : 0; },

  terrain(x, z) { return Math.max(1.6, 3.0 + fbm(x * 0.005 + 3, z * 0.005, 3) * 4.0 + fbm(x * 0.05 + 9, z * 0.05, 2) * 0.12); },
  paint(x, z) { return fbm(x * 0.012 + 40, z * 0.012 - 7, 2) > 0.12 ? SURF.Grass : SURF.Concrete; },
  paintTrackside(x, z, s, lat, d, hw, world) {
    const pb = lat > 0 && this.pitBand(world, s);
    if (pb) {
      if (lat >= pb[0] && lat <= pb[1]) return SURF.Asphalt;
      if (lat > pb[1] && lat < pb[1] + 14) return SURF.Concrete;
    }
    return undefined;
  },
  sky: { top: 0x4a82d0, bottom: 0xd6e2ee, fog: 0xcbd9e6, sun: 2.1, hemi: 1.3, fogNear: 260, fogFar: 1500 },

  /** canal, jump and bumps, written into the finished height field */
  adjust(x, z, A, world, info) {
    const dc = Math.abs(x - CANAL.x);
    const near = info.d < 1e8 ? world.track[info.idx] : null, hw = near ? near.w / 2 : 0;
    // the bridge deck stays solid: the cells under the road between the two banks are not carved
    const B = this._bridge;
    const onDeck = B && info.d <= hw + 1.6 && Math.abs(z - B.z) < 18 && dc < CANAL.wall + 6;
    if (dc < CANAL.wall + 1.5 && !onDeck) {
      const f = 1 - smoothstep(CANAL.bed, CANAL.wall, dc);
      if (f > 0) { A.h += (CANAL.depth - A.h) * f; if (f > 0.5) A.surf = SURF.Dirt; }
    }
    if (dc >= CANAL.wall - 0.3 && dc < CANAL.wall + 3.5 && !(info.d <= hw + 0.4) && !onDeck) A.surf = SURF.Concrete;   // the quay
    if (!near) return;
    const edge = 1 - smoothstep(hw - 1.2, hw + 0.3, info.d);              // 1 on the road, easing to 0 at the kerb
    // the jump: a kicker rising to the lip of the east bank (the lap crosses heading west here)
    const J = this._gap;
    if (J && edge > 0 && x > CANAL.wall && x < CANAL.wall + 9 && Math.abs(z - J.z) < 14) {
      const u = (x - CANAL.wall) / 9;
      A.h += 0.75 * Math.pow(1 - u, 1.8) * edge;
    }
    // soft bumps along the road
    const lap = info.idx / world.trackLength;
    for (const [f0, n, wl, ht] of this.bumps) {
      const s = (lap - f0) * world.trackLength;
      if (s < 0 || s > n * wl) continue;
      A.h += ht * 0.5 * (1 - Math.cos(2 * Math.PI * s / wl)) * edge;
    }
  },

  // concrete barriers round the lap (tyres through the corners); parapets over the bridge; nothing across the jump
  walls(world) {
    const T = world.track, M = T.length, J = this._gap, B = this._bridge;
    for (const side of [-1, 1]) {
      let run = [], kind = null;
      const flush = () => { if (run.length > 2) world.addWall(run, kind === 'pit' ? { height: 1.0, thickness: 0.4, style: 'pitwall', fence: false } : kind === 'bridge' ? { height: 1.15, thickness: 0.5, style: 'concrete' } : kind === 'tyres' ? { height: 0.9, thickness: 0.7, style: 'tyrewall' } : { height: 1.0, thickness: 0.5, style: 'concrete' }); run = []; };
      for (let i = 0; i < M; i += 2) {
        const s = T[i], d = this.dist(world, s), hw = s.w / 2, pb = side > 0 && this.pitBand(world, s);
        const onBridge = B && Math.abs(s.x) < CANAL.wall + 3 && Math.abs(s.z - B.z) < 14;
        const inGap = J && Math.abs(s.x) < CANAL.wall + 5 && Math.abs(s.z - J.z) < 12;
        if (inGap) { flush(); continue; }
        const k = pb ? 'pit' : onBridge ? 'bridge' : Math.abs(s.curv) > 0.012 ? 'tyres' : 'concrete';
        if (run.length && k !== kind) { const last = run[run.length - 1]; flush(); run.push(last); }
        kind = k;
        let off = pb ? hw + 1.3 : onBridge ? hw + 0.9 : hw + 3.6;
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
    const L = this.length;
    const out = { 'Grid (start/finish)': on(-12, -2), 'Pit lane': on(L - 20, 8) };
    Object.entries(this.corners).forEach(([k, i]) => { out[k] = on(i - 40); });
    if (this._bridge) out['Bridge'] = on(this._bridge.i - 60);
    if (this._gap) out['Jump'] = on(this._gap.i - 70);
    return out;
  },
};
