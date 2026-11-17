import { Vec3 } from '../physics/math.js';
import { BOT_CALIBRATION } from './botCalibration.js';

const G = 9.81;
const _f = new Vec3(), _up = new Vec3();

/** Practice opponent skill levels: fraction of the car's tyre grip the bot plans its speeds with. */
export const BOT_SKILLS = [
  { name: 'Rookie', grip: 0.70, brake: 0.70, react: 0.38 },   // react = start reaction time (s)
  { name: 'Club', grip: 0.80, brake: 0.78, react: 0.30 },
  { name: 'Pro', grip: 0.88, brake: 0.85, react: 0.24 },
  { name: 'Alien', grip: 0.95, brake: 0.92, react: 0.18 },
];

/**
 * AI driver for a practice opponent. It precomputes a racing line that uses the
 * track width (curvature-smoothed inside the kerbs), a speed plan from that line's
 * curvature, then drives it with pure-pursuit steering and a throttle/brake
 * controller. It also looks for the player's car ahead, moves over to pass and
 * backs off when there's no room, and resets itself onto the line when stuck.
 */
export class BotDriver {
  constructor(world, vehicle, skill = BOT_SKILLS[2], { calibrated = true, mapId = null, learn = true, grip = null } = {}) {
    this.world = world; this.car = vehicle; this.learning = learn;
    // start from the offline calibration for this car and circuit if there is one
    const ratio = calibrated && mapId ? BOT_CALIBRATION[mapId]?.[vehicle.config.name] : null;
    this.car.directSteer = true;                         // the bot outputs a wheel angle directly
    this.T = world.track; this.M = this.T.length;
    this.idx = 0; this.iErr = 0; this.stuck = 0; this.lat = 0; this.latTarget = 0;
    this._buildLine();
    const pk = Math.min(vehicle.config.tires.front.peakFrictionY, vehicle.config.tires.rear.peakFrictionY);
    this.carGrip = (grip ?? ratio ?? 0.95) * pk;
    this.setSkill(skill);
  }

  // ---------------------------------------------------------------- racing line
  _buildLine() {
    const T = this.T, M = this.M, half = this.car.config.body.dimensions.width / 2;
    let step = 0; for (let i = 0; i < M; i++) { const a = T[i], b = T[(i + 1) % M]; step += Math.hypot(b.x - a.x, b.z - a.z); }
    step /= M;
    // lateral offset d along the right-normal (rx, rz), kept inside the kerbs with a margin
    const lim = T.map((t) => Math.max(0, t.w / 2 - half - 0.9));
    const d = new Float64Array(M);
    const px = (i) => T[i].x + T[i].rx * d[i], pz = (i) => T[i].z + T[i].rz * d[i];
    // minimum-curvature line: gradient steps on the summed squared curvature. With L the window
    // Laplacian (window average minus the point), curvature ~ L·p, and its gradient is L(L·p), so
    // each point moves by -L(L·p) along its normal, clamped to the track. (Plain Laplacian smoothing
    // would find the *shortest* path, which hugs the inside and tightens the corners.)
    const lap = (vx, vz, k, ox, oz) => {                    // ox/oz = window average minus value, over ±k samples
      const pre = new Float64Array(3 * M + 1), prz = new Float64Array(3 * M + 1);
      for (let j = 0; j < 3 * M; j++) { pre[j + 1] = pre[j] + vx[j % M]; prz[j + 1] = prz[j] + vz[j % M]; }
      for (let i = 0; i < M; i++) {
        const a = i - k + M, b = i + k + M + 1;
        ox[i] = (pre[b] - pre[a] - vx[i]) / (2 * k) - vx[i]; oz[i] = (prz[b] - prz[a] - vz[i]) / (2 * k) - vz[i];
      }
    };
    const X = new Float64Array(M), Z = new Float64Array(M), LX = new Float64Array(M), LZ = new Float64Array(M), L2X = new Float64Array(M), L2Z = new Float64Array(M);
    for (const [metres, iters] of [[30, 600], [12, 300]]) {
      const k = Math.max(2, Math.round(metres / step));
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < M; i++) { X[i] = px(i); Z[i] = pz(i); }
        lap(X, Z, k, LX, LZ); lap(LX, LZ, k, L2X, L2Z);
        for (let i = 0; i < M; i++) d[i] = Math.max(-lim[i], Math.min(lim[i], d[i] - 0.22 * (L2X[i] * T[i].rx + L2Z[i] * T[i].rz)));
      }
    }
    this.d = d; this.lim = lim;
    this.line = T.map((t, i) => ({ x: px(i), z: pz(i) }));
    // signed curvature of the line from 3-point circles over ±s metres
    const s = Math.max(2, Math.round(6 / step));
    this.curv = this.line.map((_, i) => {
      const A = this.line[(i - s + M) % M], B = this.line[i], C = this.line[(i + s) % M];
      const ab = Math.hypot(B.x - A.x, B.z - A.z), bc = Math.hypot(C.x - B.x, C.z - B.z), ca = Math.hypot(A.x - C.x, A.z - C.z);
      const cross = (B.x - A.x) * (C.z - A.z) - (B.z - A.z) * (C.x - A.x);
      return (2 * cross) / Math.max(1e-6, ab * bc * ca);
    });
    // the traced centreline is slightly noisy: average curvature over ±10 m as the world does
    const r = Math.max(2, Math.round(10 / step)), raw = this.curv;
    this.curv = raw.map((_, i) => { let sum = 0; for (let j = -r; j <= r; j++) sum += raw[(i + j + M) % M]; return sum / (2 * r + 1); });
    this.tan = this.line.map((_, i) => { const a = this.line[(i - 1 + M) % M], b = this.line[(i + 1) % M], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; });
    this.step = step;
  }

  setSkill(skill) {
    this.skill = skill;
    const cfg = this.car.config, M = this.M;
    this.peak = Math.min(cfg.tires.front.peakFrictionY, cfg.tires.rear.peakFrictionY);
    this.carGrip = this.carGrip ?? 0.95 * this.peak;     // learned: what this car really holds (Alien drives at it)
    this.learn = new Float64Array(M).fill(1);              // per-sample speed scale, lowered where the bot has moments
    this._corners();
  }

  /** corner speeds from the line's curvature at this skill's share of the learned car grip */
  _corners() {
    const cfg = this.car.config, M = this.M, skill = this.skill;
    const mu = (skill.grip / 0.95) * this.carGrip;
    const aero = -(cfg.aero.liftCoefFront + cfg.aero.liftCoefRear) * 0.5 * 1.225 * cfg.aero.frontalArea / cfg.body.mass;
    if (!this._cmax) this._cmax = this.curv.map((_, i) => { let m = 0; for (let j = -4; j <= 4; j++) m = Math.max(m, Math.abs(this.curv[(i + j + M) % M])); return m; });
    this.vCorner = this._cmax.map((k) => Math.min(95, Math.sqrt((mu * G) / Math.max(1e-4, k - mu * aero))));
    this.brakeDecel = mu * G * skill.brake;
    this._replan();
  }

  _replan() {
    const M = this.M, step = this.step, accel = 6, brake = this.brakeDecel;
    const plan = this.vCorner.map((v, i) => v * this.learn[i]);
    for (let it = 0; it < 2; it++) for (let i = 2 * M - 1; i >= 0; i--) { const a = i % M, b = (i + 1) % M; plan[a] = Math.min(plan[a], Math.sqrt(plan[b] ** 2 + 2 * brake * step)); }
    for (let it = 0; it < 2; it++) for (let i = 0; i < 2 * M; i++) { const a = (i + 1) % M, b = i % M; plan[a] = Math.min(plan[a], Math.sqrt(plan[b] ** 2 + 2 * accel * step)); }
    this.plan = plan;
  }

  /** a moment (big slide / ran wide) at sample i: take the approach and the corner a little slower next time */
  _learnFrom(i) {
    const M = this.M, back = Math.round(120 / this.step), fwd = Math.round(30 / this.step);
    for (let j = -back; j <= fwd; j++) { const k = (i + j + M) % M; this.learn[k] = Math.max(0.75, this.learn[k] * 0.98); }
    this.carGrip = Math.max(0.5 * this.peak, this.carGrip * 0.99);   // and trust the car a little less everywhere
    this._corners();
  }

  // ---------------------------------------------------------------- helpers
  /** nearest track sample, searching forward from the last known one */
  _track(p, from) {
    const T = this.T, M = this.M;
    let i = from;
    // forwards uses <= so it steps over duplicated samples (some circuits repeat the start point at the end)
    for (let n = 0; n < 60; n++) { const j = (i + 1) % M; if ((T[j].x - p.x) ** 2 + (T[j].z - p.z) ** 2 <= (T[i].x - p.x) ** 2 + (T[i].z - p.z) ** 2) i = j; else break; }
    for (let n = 0; n < 60; n++) { const j = (i - 1 + M) % M; if ((T[j].x - p.x) ** 2 + (T[j].z - p.z) ** 2 < (T[i].x - p.x) ** 2 + (T[i].z - p.z) ** 2) i = j; else break; }
    return i;
  }
  nearestIndex(x, z) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < this.M; i += 4) { const d = (this.T[i].x - x) ** 2 + (this.T[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return this._track({ x, z }, bi);
  }
  lateral(p, i) { const t = this.T[i]; return (p.x - t.x) * t.rx + (p.z - t.z) * t.rz; }

  /** put the car at sample i at an exact lateral offset from the centreline (grid slots) */
  placeAtLateral(i, lat) { const ii = (i + this.M) % this.M; this.placeAt(ii, lat - this.d[ii], true); }

  /** put the car on the racing line at sample i (optionally shifted sideways), pointing along the track */
  placeAt(i, side = 0, exact = false) {
    const T = this.T, M = this.M, t = T[(i + M) % M], ii = (i + M) % M;
    const off = exact ? this.d[ii] + side : Math.max(-this.lim[ii], Math.min(this.lim[ii], this.d[ii] + side));
    const x = t.x + t.rx * off, z = t.z + t.rz * off, cfg = this.car.config;
    let h = -Infinity;
    for (const dx of [-2, 0, 2]) for (const dz of [-2.5, 0, 2.5]) h = Math.max(h, this.world.heightAt(x + dx, z + dz));
    this.car.reset(new Vec3(x, h + cfg.body.cgHeight + 0.25, z), Math.atan2(t.tx, t.tz));
    this.idx = ii; this.iErr = 0; this.stuck = 0; this.lat = 0; this.latTarget = 0; this.thr = 0;
  }

  // ---------------------------------------------------------------- driving
  /** call once per physics step before car.step(dt). other = the player's vehicle (or null). */
  drive(dt, other) {
    const car = this.car, cfg = car.config, T = this.T, M = this.M, p = car.body.position;
    this.idx = this._track(p, this.idx);
    const idx = this.idx, v = car.speed;

    // recovery: rolled, far off the line, or stuck against something
    car.body.localDir(_up.set(0, 1, 0), _up);
    const offLine = Math.hypot(p.x - this.line[idx].x, p.z - this.line[idx].z);
    this.stuck = v < 2 ? this.stuck + dt : Math.max(0, this.stuck - dt * 2);
    if (_up.y < 0.3 || offLine > 25 || this.stuck > 3) { this.resets = (this.resets || 0) + 1; this.placeAt(idx + Math.round(8 / this.step)); return; }

    // traffic: the player's car close ahead on our line -> move over to pass, or back off if there's no room
    let cap = Infinity; this.latTarget = 0;
    if (other) {
      const op = other.body.position;
      if (this._otherIdx === undefined || (op.x - T[this._otherIdx].x) ** 2 + (op.z - T[this._otherIdx].z) ** 2 > 900) this._otherIdx = this.nearestIndex(op.x, op.z);
      const oi = this._otherIdx = this._track(op, this._otherIdx);
      let ahead = (oi - idx + M) % M; if (ahead > M / 2) ahead -= M;
      const gap = ahead * this.step, len = (cfg.body.dimensions.length + other.config.body.dimensions.length) / 2;
      const closing = Math.max(0, v - other.speed), look = Math.max(30, 15 + closing * 3);
      if (gap > -(len + 2) && gap < look) {                 // ahead of us, or alongside while we pass
        const myLat = this.d[oi] + this.lat, theirLat = this.lateral(op, oi), w = cfg.body.dimensions.width;
        if (Math.abs(theirLat - (this.d[oi] + this.latTarget)) < w + 1.0 || Math.abs(theirLat - myLat) < w + 1.0) {
          // pass on whichever side has more room
          const roomL = this.lim[oi] + theirLat, roomR = this.lim[oi] - theirLat, need = w + 1.3;
          const side = roomR >= roomL ? 1 : -1, room = side > 0 ? roomR : roomL;
          if (room > need * 0.8) this.latTarget = theirLat + side * need - this.d[oi];
          // brake if we can't get clear before reaching them, or there's no room to pass
          const ttc = closing > 0.1 ? (gap - len - 1) / closing : Infinity;
          const tMove = Math.abs(this.latTarget - this.lat) / 4 + 0.3;
          if (gap > 0 && (room <= need * 0.8 || ttc < tMove)) cap = Math.max(0, other.speed - 1 + Math.max(0, gap - len - 4) * 0.5);
        }
      }
    }
    this.lat += Math.max(-dt * 4, Math.min(dt * 4, this.latTarget - this.lat));       // move sideways at up to 4 m/s

    // path tracking (Stanley-style): curvature feed-forward + heading error + cross-track error,
    // all measured a little ahead to cover the steering and tyre lag. lat shifts the line sideways
    // when passing.
    car.body.localDir(_f.set(0, 0, 1), _f);
    const ai = (idx + Math.round((4 + v * 0.12) / this.step)) % M, ta = this.tan[ai], tr = T[ai];
    const off = Math.max(-this.lim[ai], Math.min(this.lim[ai], this.d[ai] + this.lat));
    const lx = tr.x + tr.rx * off, lz = tr.z + tr.rz * off;
    const fx = p.x + _f.x * (4 + v * 0.12), fz = p.z + _f.z * (4 + v * 0.12);   // where the nose will be
    const heading = Math.atan2(-(ta.x * _f.z - ta.z * _f.x), ta.x * _f.x + ta.z * _f.z);   // + = line turns right of us
    const cross = (fx - lx) * (-ta.z) + (fz - lz) * ta.x;                                // + = we are right of the line
    const devNow = Math.abs((p.x - this.line[idx].x) * (-this.tan[idx].z) + (p.z - this.line[idx].z) * this.tan[idx].x - this.lat);
    // a moment: big slide or well off the line -> learn (at most once per 60 m of track)
    const moment = (Math.abs(car.telemetry.slipAngle || 0) > 0.26 && v > 8) || (devNow > 3 && this.latTarget === 0);
    this._clean = moment ? 0 : (this._clean || 0) + v * dt;
    if (this._clean > 400) { this._clean = 0; if (this.carGrip < 0.95 * this.peak) { this.carGrip = Math.min(0.95 * this.peak, this.carGrip * 1.005); this._corners(); } }
    if (moment && (this._lastLearn === undefined || ((idx - this._lastLearn + M) % M) * this.step > 60)) { if (this.learning) this._learnFrom(idx); this._lastLearn = idx; this.moments = (this.moments || 0) + 1; }
    const ff = Math.atan(cfg.geometry.wheelbase * this.curv[ai]);
    // catch slides: countersteer with the body slip angle once the rear steps out
    const beta = car.telemetry.slipAngle || 0, slide = Math.max(0, Math.abs(beta) - 0.05);
    const steerAng = ff + 0.9 * heading - Math.atan((1.4 * cross) / (v + 3)) + Math.sign(beta) * slide * 0.9;

    // speed: look ~0.6 s ahead on the plan, PI throttle, brake when over it
    const want = Math.min(cap, this.plan[idx], this.plan[(idx + Math.round((v * 0.6) / this.step)) % M]) * (devNow > 1.5 ? Math.max(0.6, 1 - (devNow - 1.5) * 0.08) : 1), e = want - v;
    this.iErr = Math.max(-0.5, Math.min(0.5, this.iErr + e * dt * 0.3));
    const slipDeg = Math.abs(car.telemetry.slipAngle) * 57.3;
    const traction = Math.max(0, Math.min(1, 1 - (slipDeg - 3) / 5));
    const throttle = e > -0.5 ? Math.max(0, Math.min(1, 0.35 + e * 0.5 + this.iErr)) * traction : 0;
    // brake in proportion to the overspeed, and ease off (rather than lock up and spin) when sliding
    const calm = Math.max(0.25, Math.min(1, 1 - (slipDeg - 2.5) / 6));
    const brake = e < -0.5 ? Math.max(0, Math.min(0.85, -e * 0.35)) * calm : 0;
    // ease off the throttle rather than snapping shut (sudden lifts unsettle lift-off-oversteer cars),
    // and in a front-driver catch a slide with some power, as a driver would
    let thr = throttle, brk = brake;
    if (cfg.drivetrain.layout === 'FWD' && slipDeg > 6) { thr = Math.max(thr, 0.5); brk = 0; }
    this.thr = (this.thr ?? 0) + Math.max(-2.5 * dt, Math.min(6 * dt, thr - (this.thr ?? 0)));
    car.setInput({ steer: Math.max(-1, Math.min(1, steerAng / (cfg.steering.maxAngle * Math.PI / 180))), throttle: brk > 0 ? Math.min(this.thr, 0.1) : this.thr, brake: brk, handbrake: 0, clutch: 0 });
  }
}

/**
 * Car-to-car contact: each car is three circles along its length in the ground plane.
 * Overlaps get a separating push plus an inelastic impulse at the contact point.
 */
const _n = new Vec3(), _cp = new Vec3(), _va = new Vec3(), _vb = new Vec3(), _j = new Vec3(), _fa = new Vec3(), _fb = new Vec3();
export function collideCars(a, b) {
  const pa = a.body.position, pb = b.body.position;
  const La = a.config.body.dimensions.length, Lb = b.config.body.dimensions.length;
  if ((pa.x - pb.x) ** 2 + (pa.z - pb.z) ** 2 > ((La + Lb) / 2 + 1) ** 2) return 0;
  a.body.localDir(_fa.set(0, 0, 1), _fa); b.body.localDir(_fb.set(0, 0, 1), _fb);
  const ra = a.config.body.dimensions.width / 2, rb = b.config.body.dimensions.width / 2;
  const sa = [-1, 0, 1].map((k) => k * (La / 2 - ra)), sb = [-1, 0, 1].map((k) => k * (Lb / 2 - rb));
  let hit = 0;
  for (const ka of sa) for (const kb of sb) {
    const ax = pa.x + _fa.x * ka, az = pa.z + _fa.z * ka, bx = pb.x + _fb.x * kb, bz = pb.z + _fb.z * kb;
    const dx = bx - ax, dz = bz - az, dist = Math.hypot(dx, dz), depth = ra + rb - dist;
    if (depth <= 0 || dist < 1e-6) continue;
    _n.set(dx / dist, 0, dz / dist);
    const y = (pa.y + pb.y) / 2;
    _cp.set(ax + _n.x * ra, y, az + _n.z * ra);
    // positional correction split by mass
    const wa = a.body.invMass / (a.body.invMass + b.body.invMass), push = Math.min(depth, 0.05) * 0.5;
    pa.x -= _n.x * push * wa; pa.z -= _n.z * push * wa;
    pb.x += _n.x * push * (1 - wa); pb.z += _n.z * push * (1 - wa);
    // impulse
    a.body.pointVelocity(_cp, _va); b.body.pointVelocity(_cp, _vb);
    const vrel = (_vb.x - _va.x) * _n.x + (_vb.z - _va.z) * _n.z;
    if (vrel < 0) {
      const k = a.body.invMassAlong(_cp, _n) + b.body.invMassAlong(_cp, _n);
      const jn = (-(1 + 0.2) * vrel) / k;
      _j.set(_n.x * jn, 0, _n.z * jn);
      b.body.applyImpulse(_j, _cp);
      _j.set(-_j.x, 0, -_j.z);
      a.body.applyImpulse(_j, _cp);
      hit = Math.max(hit, -vrel);
    }
  }
  return hit;
}
