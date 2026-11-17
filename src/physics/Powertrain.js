import { clamp, interpTable, RPM_TO_RADS, RADS_TO_RPM } from './math.js';

export class Engine {
  constructor(cfg) { this.cfg = cfg; this.reset(); }
  reset() {
    this.omega = this.cfg.idleRPM * RPM_TO_RADS;
    this.throttle = 0; this.boost = 0; this.limiterTimer = 0; this.torque = 0;
  }
  get rpm() { return this.omega * RADS_TO_RPM; }

  /** Net engine torque (Nm) at the crank for a throttle demand 0..1 */
  computeTorque(demand, dt) {
    const c = this.cfg, rpm = this.rpm;
    // throttle-body lag
    this.throttle += (demand - this.throttle) * Math.min(1, c.throttleResponse * dt);
    let t = this.throttle;
    // idle controller
    if (rpm < c.idleRPM) t = Math.max(t, clamp((c.idleRPM - rpm) / 300, 0, 0.4));
    // rev limiter (fuel cut)
    if (rpm > c.limiterRPM) this.limiterTimer = c.limiterCutTime;
    if (this.limiterTimer > 0) { this.limiterTimer -= dt; t = 0; }
    // turbo
    if (c.turbo && c.turbo.maxBoost > 0) {
      const target = t * c.turbo.maxBoost * clamp(rpm / (c.redlineRPM * 0.6), 0, 1);
      this.boost += (target - this.boost) * Math.min(1, c.turbo.spoolRate * dt);
    }
    const full = interpTable(c.torqueCurve, rpm) * (1 + this.boost);
    const friction = c.engineBrakingTorque * (0.25 + 0.75 * rpm / c.redlineRPM);
    this.torque = t * full - (1 - t) * friction;
    this.effectiveThrottle = t;
    return this.torque;
  }
}

export class Gearbox {
  constructor(cfg) { this.cfg = cfg; this.reset(); }
  reset() { this.gear = 1; this.shiftTimer = 0; this.lastShiftUp = true; }
  get numGears() { return this.cfg.gearRatios.length; }
  ratioOf(g) {
    if (g === 0) return 0;
    if (g < 0) return this.cfg.reverseRatio;
    return this.cfg.gearRatios[g - 1];
  }
  get ratio() { return this.ratioOf(this.gear) * this.cfg.finalDrive; }
  get shifting() { return this.shiftTimer > 0; }
  shiftTo(g) {
    g = clamp(g, -1, this.numGears);
    if (g === this.gear || this.shifting) return false;
    this.lastShiftUp = g > this.gear;
    this.gear = g;
    this.shiftTimer = this.cfg.shiftTime;
    return true;
  }
  update(dt) { if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt); }
}

/**
 * Splits torque Tin between two outputs (a, b). Starts from the static split,
 * then the diff's locking torque moves torque from the faster to the slower
 * side, limited by type: open (0), locked (unlimited), lsd (preload + ramp).
 * Solved at velocity level using predicted speeds so it is stable even when locked.
 */
export function diffSplit(Tin, wa, wb, Ia, Ib, diff, dt, split = 0.5, out = [0, 0]) {
  let Ta = Tin * split, Tb = Tin * (1 - split);
  if (diff.type !== 'open') {
    const wa1 = wa + (Ta * dt) / Ia, wb1 = wb + (Tb * dt) / Ib;
    const need = (wa1 - wb1) / (dt * (1 / Ia + 1 / Ib));
    let lim = Infinity;
    if (diff.type === 'lsd') lim = diff.preload + (Tin >= 0 ? diff.powerLock : diff.coastLock) * Math.abs(Tin);
    const Tl = clamp(need, -lim, lim);
    Ta -= Tl; Tb += Tl;
  }
  out[0] = Ta; out[1] = Tb;
  return out;
}

const _split = [0, 0], _center = [0, 0];

/**
 * Engine -> clutch -> gearbox -> (center diff) -> axle diffs -> wheels.
 * Wheels must expose: omegaPred (speed after tyre torque this step), inertia, driveTorque.
 * Wheel order: 0 FL, 1 FR, 2 RL, 3 RR.
 */
export class Drivetrain {
  constructor(cfg) {
    this.engine = new Engine(cfg.engine);
    this.gearbox = new Gearbox(cfg.transmission);
    this.cfg = cfg;
    this.clutch = 1;            // engagement 0..1
    this.clutchSlipping = false;
    this.clutchTorque = 0;
  }
  reset() { this.engine.reset(); this.gearbox.reset(); this.clutch = 1; }

  /** angular speed of the gearbox output side as seen from the wheels */
  wheelSideOmega(w) {
    const d = this.cfg.drivetrain;
    const f = (w[0].omegaPred + w[1].omegaPred) / 2, r = (w[2].omegaPred + w[3].omegaPred) / 2;
    if (d.layout === 'FWD') return f;
    if (d.layout === 'RWD') return r;
    const s = d.centerSplitFront; return s * f + (1 - s) * r;
  }
  drivenInertia(w) {
    const d = this.cfg.drivetrain;
    if (d.layout === 'FWD') return w[0].inertia + w[1].inertia;
    if (d.layout === 'RWD') return w[2].inertia + w[3].inertia;
    return w[0].inertia + w[1].inertia + w[2].inertia + w[3].inertia;
  }

  /** automatic clutch engagement: slips on launch, locks once moving */
  autoClutch(handbrake) {
    const e = this.cfg.engine, gb = this.gearbox;
    if (gb.gear === 0) return 0;
    // signed: wheels turning against the selected gear must not count as "moving"
    const driveRPM = this._wd * gb.ratio * RADS_TO_RPM;
    // engagement window: defaults suit a road car; a high bite point models a
    // centrifugal clutch (karts) that keeps a peaky engine in its power band
    const tr = this.cfg.transmission;
    const bite = tr.clutchEngageRPM ?? e.idleRPM + 150, full = tr.clutchFullRPM ?? bite + 1400;
    const launch = clamp((this.engine.rpm - bite) / (full - bite), 0, 1);
    const lock = clamp((driveRPM - (tr.clutchEngageRPM ?? e.idleRPM * 0.9)) / 500, 0, 1);
    let c = Math.max(launch, lock);
    if (handbrake > 0.5) c = 0; // handbrake pulls the clutch, like most arcade/sim racers
    return c;
  }

  step(dt, throttle, clutchPedal, autoClutch, handbrake, wheels, torqueScale = 1) {
    const eng = this.engine, gb = this.gearbox, cfg = this.cfg;
    gb.update(dt);
    this._wd = this.wheelSideOmega(wheels);

    // shifting: ignition cut on upshift, throttle blip on downshift, clutch open
    let demand = throttle;
    let shiftClutch = 1;
    if (gb.shifting) {
      const p = gb.shiftTimer / cfg.transmission.shiftTime; // 1 -> 0
      shiftClutch = p > 0.35 ? 0 : 1 - p / 0.35;
      // upshift: ignition cut. downshift: blip to rev-match the new gear
      const target = Math.abs(this._wd * gb.ratio);
      demand = gb.lastShiftUp ? 0 : (eng.omega < target ? 1 : 0);
    }
    // the pedal always works (clutch kicks), auto clutch just adds launch/stop control
    let c = autoClutch ? Math.min(this.autoClutch(handbrake), 1 - clutchPedal) : 1 - clutchPedal;
    c = Math.min(c, shiftClutch);
    this.clutch = c;

    let Te = eng.computeTorque(demand, dt);
    if (Te > 0) Te *= torqueScale; // traction control
    const Ie = cfg.engine.inertia;
    const G = gb.ratio;
    let Tcl = 0;
    this.clutchSlipping = false;
    if (G !== 0 && c > 0) {
      const Iw = this.drivenInertia(wheels);
      const wePred = eng.omega + (Te * dt) / Ie;
      const wdPred = G * this._wd;
      const need = (wePred - wdPred) / (dt * (1 / Ie + (G * G) / Iw));
      const cap = c * cfg.transmission.clutchMaxTorque;
      Tcl = clamp(need, -cap, cap);
      this.clutchSlipping = Math.abs(need) > cap;
    }
    this.clutchTorque = Tcl;
    eng.omega += ((Te - Tcl) * dt) / Ie;
    const minOmega = cfg.engine.idleRPM * 0.5 * RPM_TO_RADS;
    if (eng.omega < minOmega) eng.omega = minOmega; // anti-stall

    for (const w of wheels) w.driveTorque = 0;
    if (G === 0) return;
    const Tw = Tcl * G * cfg.transmission.efficiency;
    const d = cfg.drivetrain;
    if (d.layout === 'FWD') this._axle(Tw, wheels[0], wheels[1], d.frontDiff, dt);
    else if (d.layout === 'RWD') this._axle(Tw, wheels[2], wheels[3], d.rearDiff, dt);
    else {
      const wf = (wheels[0].omegaPred + wheels[1].omegaPred) / 2;
      const wr = (wheels[2].omegaPred + wheels[3].omegaPred) / 2;
      const If = wheels[0].inertia + wheels[1].inertia, Ir = wheels[2].inertia + wheels[3].inertia;
      diffSplit(Tw, wf, wr, If, Ir, d.centerDiff, dt, d.centerSplitFront, _center);
      const Tf = _center[0], Tr = _center[1];
      this._axle(Tf, wheels[0], wheels[1], d.frontDiff, dt);
      this._axle(Tr, wheels[2], wheels[3], d.rearDiff, dt);
    }
  }

  _axle(T, a, b, diff, dt) {
    diffSplit(T, a.omegaPred, b.omegaPred, a.inertia, b.inertia, diff, dt, 0.5, _split);
    a.driveTorque = _split[0]; b.driveTorque = _split[1];
  }
}
