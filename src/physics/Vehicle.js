import { Vec3, Quat, clamp, lerp, DEG, RADS_TO_RPM } from './math.js';
import { RigidBody } from './RigidBody.js';
import { Tire } from './Tire.js';
import { Drivetrain } from './Powertrain.js';

const G = 9.81;
// Body frame (right-handed, Y up): forward = +Z, driver's right = -X.
const UP = new Vec3(0, 1, 0), FWD = new Vec3(0, 0, 1), RIGHT = new Vec3(-1, 0, 0);
const _v = new Vec3(), _v2 = new Vec3(), _p = new Vec3(), _f = new Vec3(), _q = new Quat();
const _up = new Vec3(), _fwd = new Vec3(), _right = new Vec3(), _down = new Vec3();
const _long = new Vec3(), _lat = new Vec3(), _wf = new Vec3(), _app = new Vec3(), _wn = new Vec3();

/**
 * Generic 4-wheeled vehicle. Fully data driven by a config object
 * (see src/vehicles/presets.js and docs/VEHICLE_PROPERTIES.md).
 *
 * The world must provide: sample(x, z, out) -> fills out.height, out.normal (Vec3), out.surface.
 */
export class Vehicle {
  constructor(config, world) {
    this.world = world;
    this.setConfig(config);
  }

  setConfig(config) {
    this.config = config;
    const b = config.body, gm = config.geometry;
    const { width: w, height: h, length: l } = b.dimensions;
    const m = b.mass, s = b.inertiaScale;
    const inertia = new Vec3(
      (m / 12) * (h * h + l * l) * s.x,   // pitch
      (m / 12) * (w * w + l * l) * s.y,   // yaw
      (m / 12) * (w * w + h * h) * s.z);  // roll
    const old = this.body;
    this.body = new RigidBody(m, inertia);
    if (old) {
      this.body.position.copy(old.position); this.body.orientation.copy(old.orientation);
      this.body.velocity.copy(old.velocity); this.body.angularVelocity.copy(old.angularVelocity);
    }

    this.frontZ = gm.wheelbase * (1 - b.weightDistFront);
    this.rearZ = -gm.wheelbase * b.weightDistFront;

    const oldWheels = this.wheels;
    this.wheels = [];
    const defs = [
      { name: 'FL', axle: 'front', side: -1 }, { name: 'FR', axle: 'front', side: 1 },
      { name: 'RL', axle: 'rear', side: -1 }, { name: 'RR', axle: 'rear', side: 1 }];
    defs.forEach((d, i) => {
      const susp = config.suspension[d.axle], wcfg = config.wheels[d.axle];
      const track = d.axle === 'front' ? gm.trackFront : gm.trackRear;
      const share = d.axle === 'front' ? b.weightDistFront : 1 - b.weightDistFront;
      const staticLoad = (m * G * share) / 2;
      const staticComp = Math.min(staticLoad / susp.springRate, susp.travel * 0.8);
      const mountY = susp.restLength + wcfg.radius - staticComp - b.cgHeight + (susp.rideHeightOffset || 0);
      const wheel = {
        ...d, index: i, susp, wcfg,
        tire: new Tire(config.tires[d.axle]),
        radius: wcfg.radius, inertia: wcfg.inertia,
        mount: new Vec3((-d.side * track) / 2, mountY, d.axle === 'front' ? this.frontZ : this.rearZ),
        staticLoad, staticComp,
        omega: 0, omegaPred: 0, driveTorque: 0, brakeTorque: 0, rotation: 0,
        compression: 0, prevCompression: 0, compVel: 0, contact: false,
        Fz: 0, steer: 0, surface: null, absFactor: 1, tilt: 0, bottomed: false,
        contactPoint: new Vec3(), normal: new Vec3(0, 1, 0), center: new Vec3(),
        long: new Vec3(), lat: new Vec3(), vx: 0, vy: 0, suspForce: 0,
      };
      if (oldWheels) { wheel.omega = oldWheels[i].omega; wheel.rotation = oldWheels[i].rotation; }
      this.wheels.push(wheel);
    });

    // hull collision points (body space, origin = CG)
    const clear = b.groundClearance ?? 0.14;
    const y0 = -b.cgHeight + clear, y1 = y0 + h;
    const hw = w / 2, hl = l / 2;
    this.hullPoints = [];
    for (const x of [-hw, hw]) for (const z of [-hl, hl]) {
      this.hullPoints.push(new Vec3(x, y0, z), new Vec3(x * 0.8, y1, z * 0.6));
    }
    for (const x of [-hw, hw]) this.hullPoints.push(new Vec3(x, y0, 0), new Vec3(x, (y0 + y1) / 2, 0));
    this.hullPoints.push(new Vec3(0, y0, hl), new Vec3(0, y0, -hl), new Vec3(0, y1, 0), new Vec3(0, y0 + h * 0.5, hl), new Vec3(0, y0 + h * 0.5, -hl));
    this.hullBox = { y0, y1, hw, hl };

    // Wall contact points: a ring round the body at bumper and door height (every
    // ~0.5 m so a wall can't slip between points), plus each wheel's outer face so
    // open-wheelers hit with their tyres first.
    this.wallPoints = [];
    const ring = (y) => {
      const nx = Math.max(2, Math.ceil((2 * hw) / 0.5)), nz = Math.max(2, Math.ceil((2 * hl) / 0.5));
      for (let i = 0; i <= nx; i++) { const x = -hw + (2 * hw * i) / nx; this.wallPoints.push(new Vec3(x, y, hl), new Vec3(x, y, -hl)); }
      for (let i = 1; i < nz; i++) { const z = -hl + (2 * hl * i) / nz; this.wallPoints.push(new Vec3(hw, y, z), new Vec3(-hw, y, z)); }
    };
    ring(y0 + 0.08); ring(y0 + h * 0.45);
    for (const w of this.wheels) {
      const yc = w.mount.y - (w.susp.restLength - w.staticComp), xo = w.mount.x + Math.sign(w.mount.x) * w.wcfg.width / 2;
      for (const dz of [-0.75, 0, 0.75]) this.wallPoints.push(new Vec3(xo, yc, w.mount.z + dz * w.radius));
      this.wallPoints.push(new Vec3(w.mount.x, yc, w.mount.z + w.radius), new Vec3(w.mount.x, yc, w.mount.z - w.radius));
    }
    this.boundRadius = Math.hypot(Math.max(hw, ...this.wheels.map((w) => Math.abs(w.mount.x) + w.wcfg.width)), hl) + 0.5;
    this._wallList = []; this._wallN = { nx: 0, nz: 0 };
    this.wallContact = null;

    const oldDt = this.drivetrain;
    this.drivetrain = new Drivetrain(config);
    if (oldDt) {
      this.drivetrain.engine.omega = oldDt.engine.omega;
      this.drivetrain.gearbox.gear = Math.min(oldDt.gearbox.gear, this.drivetrain.gearbox.numGears);
    }

    this.input = this.input || { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0 };
    this.assists = { ...config.assists, ...(this.assists || {}) };
    this.steerAngle = this.steerAngle || 0;
    this.reverseTimer = 0;
    this.tcsCut = 0;
    this.escActive = false; this.tcsActive = false; this.absActive = false;
    this.steerRateOverride = this.steerRateOverride ?? null;
    this._ground = { height: 0, normal: new Vec3(0, 1, 0), surface: null };
    this.telemetry = { gLat: 0, gLong: 0, speed: 0, yawRate: 0, slipAngle: 0, impact: 0 };
    this._prevVel = new Vec3();
  }

  reset(position, yaw = 0) {
    const b = this.body;
    b.position.copy(position);
    b.orientation.setFromAxisAngle(UP, yaw);
    b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
    for (const w of this.wheels) {
      w.omega = 0; w.tire.reset(); w.compression = w.prevCompression = w.staticComp; w.absFactor = 1;
    }
    this.drivetrain.reset();
    this.steerAngle = 0; this.tcsCut = 0; this.shiftCooldown = 0; this.reverseTimer = 0;
    this.telemetry.impact = 0; this.telemetry.gLat = this.telemetry.gLong = 0;
    this._prevVel.set(0, 0, 0);
  }

  /** input: steer -1..1 (+right), throttle/brake/handbrake/clutch 0..1 */
  setInput(input) { Object.assign(this.input, input); }

  shiftUp() { const gb = this.drivetrain.gearbox; gb.shiftTo(gb.gear + 1); }
  shiftDown() { const gb = this.drivetrain.gearbox; gb.shiftTo(gb.gear - 1); }

  get speed() { return this.body.velocity.length(); }
  get forwardSpeed() { return this.body.localDir(FWD, _v).dot(this.body.velocity); }
  get rpm() { return this.drivetrain.engine.rpm; }
  get gear() { return this.drivetrain.gearbox.gear; }

  // ---------------------------------------------------------------------------
  step(dt) {
    const body = this.body, cfg = this.config, a = this.assists;
    body.localDir(UP, _up); body.localDir(FWD, _fwd); body.localDir(RIGHT, _right);
    _down.copy(_up).scale(-1);
    const vFwd = _fwd.dot(body.velocity);

    // ---- pedal mapping (auto-reverse swaps pedals while in reverse)
    let throttle = this.input.throttle, brake = this.input.brake;
    const gb = this.drivetrain.gearbox;
    if (a.autoGearbox) this._autoGearbox(dt, vFwd);
    if (a.autoGearbox && gb.gear === -1) { throttle = this.input.brake; brake = this.input.throttle; }

    this._updateSteering(dt, vFwd);

    // ---- pass 1: suspension geometry & contacts
    for (const w of this.wheels) this._raycastWheel(w, dt);

    // anti-roll bars
    const arbF = cfg.suspension.front.antiRollBar * (this.wheels[0].compression - this.wheels[1].compression);
    const arbR = cfg.suspension.rear.antiRollBar * (this.wheels[2].compression - this.wheels[3].compression);

    // ---- pass 2: suspension + tyre forces
    let maxSlip = 0, impact = 0;
    for (const w of this.wheels) {
      const arb = w.axle === 'front' ? arbF : arbR;
      this._wheelForces(w, dt, w.side < 0 ? arb : -arb);
      if (w.contact) maxSlip = Math.max(maxSlip, w.tire.normSlip);
      impact = Math.max(impact, w.bottomed ? 1 : 0, clamp((Math.abs(w.compVel) - 1.2) / 3, 0, 1));
    }

    // ---- driver assists
    this._assists(dt, vFwd);

    // ---- drivetrain: tyre reaction torque first, then engine/clutch/diffs
    for (const w of this.wheels) w.omegaPred = w.omega + (-w.tire.fx * w.radius * dt) / w.inertia;
    this.drivetrain.step(dt, throttle, this.input.clutch, a.autoClutch, this.input.handbrake, this.wheels, 1 - this.tcsCut);

    // ---- wheel spin integration with brakes & rolling resistance (can't reverse spin)
    const br = cfg.brakes;
    for (const w of this.wheels) {
      const front = w.axle === 'front';
      let Tb = br.maxTorque * brake * (front ? br.bias : 1 - br.bias) / 2;
      if (a.abs && w.contact) { // ABS pressure ceiling ~ what the tyre can transmit, then slip-based release
        const cap = 1.1 * w.tire.cfg.peakFrictionX * w.surface.friction * w.Fz * w.radius;
        Tb = Math.min(Tb, cap) * w.absFactor;
      }
      if (!front) Tb += br.handbrakeTorque * this.input.handbrake / 2;
      Tb += w.brakeTorque; // ESC
      if (w.contact) Tb += (w.tire.cfg.rollingResistance + w.surface.rollingDrag * 0.5) * w.Fz * w.radius;
      w.omega = w.omegaPred + (w.driveTorque * dt) / w.inertia;
      const dw = (Tb * dt) / w.inertia;
      if (Math.abs(w.omega) <= dw) w.omega = 0; else w.omega -= Math.sign(w.omega) * dw;
      w.rotation += w.omega * dt;
      w.brakeTorque = 0;
    }

    // ---- aero + gravity
    this._aero(vFwd);
    body.force.y -= body.mass * G;

    body.integrate(dt);
    this._hullCollisions(dt);
    this._wallCollisions(dt);

    // ---- telemetry
    const t = this.telemetry;
    _v.subVectors(body.velocity, this._prevVel).scale(1 / dt);
    this._prevVel.copy(body.velocity);
    t.gLat = lerp(t.gLat, _v.dot(_right) / G, 0.02);
    t.gLong = lerp(t.gLong, _v.dot(_fwd) / G, 0.02);
    t.speed = body.velocity.length();
    t.yawRate = -body.angularVelocity.dot(_up);
    t.slipAngle = t.speed > 2 ? Math.atan2(body.velocity.dot(_right), Math.abs(vFwd)) : 0;
    t.maxSlip = maxSlip;
    t.impact = Math.max(t.impact * 0.97, impact, this._wallImpact || 0);
    this._wallImpact = 0;
  }

  // ---------------------------------------------------------------------------
  _updateSteering(dt, vFwd) {
    const s = this.config.steering;
    if (this.directSteer) { // steering wheel controllers: 1:1, no filtering or assists
      this.steerAngle = clamp(this.input.steer, -1, 1) * s.maxAngle * DEG;
      this._applyWheelSteer();
      return;
    }
    // Speed-sensitive lock (pad/keyboard assist): the most useful lock at speed is the
    // geometric angle for ~max lateral g plus the tyre's peak slip angle. More than
    // that only scrubs the fronts. speedSensitivity blends full lock -> that limit.
    const v2 = Math.max(vFwd * vFwd, 1);
    const tf = this.config.tires.front;
    const useful = (this.config.geometry.wheelbase * tf.peakFrictionY * G) / v2 + tf.peakSlipAngle * DEG * 1.0;
    const lock = lerp(s.maxAngle * DEG, Math.min(s.maxAngle * DEG, useful), s.speedSensitivity);
    // steering sensitivity (Controls panel): less lock per input at speed, full lock kept for
    // tight low-speed turns, and a slower steering rack everywhere
    const sens = this.steerSensitivity ?? 1, atSpeed = clamp(Math.abs(vFwd) / 15, 0, 1);
    let target = this.input.steer * lock * lerp(1, sens, atSpeed);
    // countersteer assist: steer toward the direction of travel when the rear steps out
    if (s.countersteerAssist > 0 && vFwd > 3) {
      const beta = Math.atan2(this.body.velocity.dot(_right), vFwd);
      target += s.countersteerAssist * beta * (1 - 0.5 * Math.abs(this.input.steer));
    }
    target = clamp(target, -s.maxAngle * DEG, s.maxAngle * DEG);
    const rate = (this.steerRateOverride ?? s.steerSpeed) * s.maxAngle * DEG * Math.min(1, sens);
    const d = target - this.steerAngle;
    this.steerAngle += clamp(d, -rate * dt, rate * dt);
    this._applyWheelSteer();
  }

  // Ackermann + toe -> per-wheel steer angles
  _applyWheelSteer() {
    const s = this.config.steering;
    const th = this.steerAngle, L = this.config.geometry.wheelbase, tf = this.config.geometry.trackFront;
    let inner = th, outer = th;
    if (Math.abs(th) > 1e-4) {
      const R = L / Math.tan(Math.abs(th));
      inner = Math.sign(th) * Math.atan(L / (R - tf / 2));
      outer = Math.sign(th) * Math.atan(L / (R + tf / 2));
    }
    const ack = s.ackermann;
    for (const w of this.wheels) {
      const toe = -w.side * w.susp.toe * DEG; // toe-in points the wheel toward the centreline
      if (w.axle === 'front') {
        const isInner = (th > 0 && w.side > 0) || (th < 0 && w.side < 0);
        w.steer = lerp(th, isInner ? inner : outer, ack) + toe;
      } else w.steer = toe;
    }
  }

  _raycastWheel(w, dt) {
    const body = this.body, g = this._ground;
    body.localToWorld(w.mount, _p);
    const rayLen = w.susp.restLength + w.radius;
    w.contact = false; w.bottomed = false;
    w.prevCompression = w.compression;
    let t = rayLen;
    if (_down.y < -0.25) { // wheel ray can't hit the ground when the car is on its side/roof
      this.world.sample(_p.x, _p.z, g);
      t = (_p.y - g.height) / -_down.y;
      for (let i = 0; i < 3; i++) { // Newton refine along the ray against sloped ground
        const px = _p.x + _down.x * t, py = _p.y + _down.y * t, pz = _p.z + _down.z * t;
        this.world.sample(px, pz, g);
        const n = g.normal;
        const hx = -n.x / n.y, hz = -n.z / n.y;
        const f = py - g.height, df = _down.y - hx * _down.x - hz * _down.z;
        t -= f / df;
      }
      if (t < rayLen) {
        w.contact = true;
        w.surface = g.surface;
        w.normal.copy(g.normal);
      }
    }
    if (!w.contact) {
      w.compression = 0;
    } else {
      w.compression = rayLen - Math.max(t, -0.3);
    }
    w.compVel = clamp((w.compression - w.prevCompression) / dt, -12, 12);
    const len = rayLen - Math.min(w.compression, w.susp.travel) - w.radius;
    w.center.copy(_p).addScaled(_down, len); // wheel centre (for rendering)
    w.contactPoint.copy(_p).addScaled(_down, Math.max(t, 0));
  }

  _wheelForces(w, dt, arbForce) {
    const body = this.body, s = w.susp, tire = w.tire;
    if (!w.contact) {
      w.Fz = 0; w.suspForce = 0;
      tire.update(dt, 0, 0, 0, w.omega * w.radius, w.surface || DEFAULT_SURF, 0);
      return;
    }
    // ---- suspension
    const x = Math.min(w.compression, s.travel);
    const over = Math.max(0, w.compression - s.travel);
    w.bottomed = over > 0.005;
    let F = s.springRate * x + s.bumpStopRate * over * (1 + over * 30);
    // Steering jacking (caster/KPI geometry): steering pushes the inside front wheel
    // down and lifts the outside one. Through a stiff frame this unloads the inside
    // rear — essential for karts, whose solid rear axle otherwise fights every turn.
    if (s.steerJacking && w.axle === 'front' && this.steerAngle !== 0) {
      const inside = Math.sign(this.steerAngle) === w.side;
      F += s.springRate * s.steerJacking * Math.abs(this.steerAngle) * (inside ? 1 : -1);
    }
    const v = w.compVel;
    let damp = v > 0 ? s.bumpDamping : s.reboundDamping;
    const av = Math.abs(v);
    let Fd = damp * v;
    if (av > s.fastBumpThreshold) Fd = Math.sign(v) * damp * (s.fastBumpThreshold + (av - s.fastBumpThreshold) * s.fastBumpFactor);
    F += Fd + arbForce;
    F = clamp(F, 0, w.staticLoad * 12);
    w.suspForce = F;

    // surface micro-bumps feed load variation
    w.Fz = F;
    _f.copy(_up).scale(F);
    body.addForceAtPoint(_f, w.contactPoint);

    // ---- tyre frame
    const n = w.normal;
    _wf.set(-Math.sin(w.steer), 0, Math.cos(w.steer)); // +steer = right
    body.localDir(_wf, _long);
    _long.projectOnPlane(n).normalize();
    _lat.crossVectors(_long, n); // points to the driver's right
    w.long.copy(_long); w.lat.copy(_lat);
    body.pointVelocity(w.contactPoint, _v);
    const vx = _v.dot(_long), vy = _v.dot(_lat);
    w.vx = vx; w.vy = vy;

    // camber: static + gain with compression + body roll relative to ground
    const camber = (s.camber - s.camberGain * (w.compression - w.staticComp)) * DEG;
    w.tilt = w.side * camber + _up.dot(_lat);

    tire.update(dt, w.Fz, vx, vy, w.omega * w.radius, w.surface, w.tilt);

    // longitudinal force applied at anti-squat/dive height, lateral at roll-centre height
    const cfgS = this.config.suspension;
    let anti = 0;
    if (w.axle === 'front' && tire.fx < 0) anti = cfgS.antiDive;
    if (w.axle === 'rear' && tire.fx > 0) anti = cfgS.antiSquat;
    _app.copy(w.contactPoint).addScaled(_up, anti * this.config.body.cgHeight);
    _f.copy(_long).scale(tire.fx);
    body.addForceAtPoint(_f, _app);
    _app.copy(w.contactPoint).addScaled(_up, s.rollCenterHeight);
    _f.copy(_lat).scale(tire.fy);
    body.addForceAtPoint(_f, _app);
  }

  _assists(dt, vFwd) {
    const a = this.assists, ws = this.wheels;
    // ABS: release brake on wheels beyond peak slip
    this.absActive = false;
    for (const w of ws) {
      const peak = w.tire.cfg.peakSlipRatio * (w.surface ? w.surface.peakSlipScale : 1);
      const excess = (-Math.sign(vFwd || 1) * w.tire.slipRatio - peak * 1.05) / peak;
      if (a.abs && w.contact && Math.abs(vFwd) > 1.5 && excess > 0) {
        w.absFactor = Math.max(0.1, w.absFactor - dt * (6 + 40 * excess));
      } else w.absFactor = Math.min(1, w.absFactor + dt * 3);
      if (w.absFactor < 0.97) this.absActive = true;
    }
    // TCS: cut throttle when driven wheels spin beyond peak
    const layout = this.config.drivetrain.layout;
    let spin = 0;
    for (const w of ws) {
      const driven = layout === 'AWD' || (layout === 'FWD') === (w.axle === 'front');
      if (!driven || !w.contact) continue;
      const peak = w.tire.cfg.peakSlipRatio * w.surface.peakSlipScale;
      spin = Math.max(spin, (Math.sign(this.drivetrain.gearbox.gear || 1) * w.tire.slipRatio - peak * 1.15) / peak);
    }
    // proportional controller on engine torque (not throttle) so it doesn't fight the throttle lag
    // P + I: proportional response to the slip excess, plus a slow integrator that
    // removes the steady-state offset (holds slip right at the threshold on any surface)
    if (a.tcs && Math.abs(vFwd) > 0.5) {
      this.tcsI = clamp((this.tcsI || 0) + dt * (spin > 0 ? 3 * spin : -1.5), 0, 0.8);
      const target = clamp(spin * 2.5 + this.tcsI, 0, 0.95);
      this.tcsCut += (target - this.tcsCut) * Math.min(1, dt * (target > this.tcsCut ? 30 : 5));
    } else { this.tcsCut = 0; this.tcsI = 0; }
    this.tcsActive = this.tcsCut > 0.05;

    // ESC: brake individual wheels when yaw rate departs from the driver's intent
    this.escActive = false;
    if (a.stability && vFwd > 5) {
      const L = this.config.geometry.wheelbase;
      const muG = 1.0 * G;
      let rExp = (vFwd * Math.tan(this.steerAngle)) / L;
      rExp = clamp(rExp, -muG / vFwd, muG / vFwd);
      const r = -this.body.angularVelocity.dot(_up); // + = turning right
      const err = r - rExp;
      if (Math.abs(err) > 0.12 && Math.abs(r) > Math.abs(rExp)) { // oversteer: brake outer front
        const outer = r > 0 ? ws[0] : ws[1];
        outer.brakeTorque += clamp((Math.abs(err) - 0.12) * 6000, 0, 2500);
        this.tcsCut = Math.max(this.tcsCut, 0.4);
        this.escActive = true;
      }
    }
  }

  _autoGearbox(dt, vFwd) {
    const dtn = this.drivetrain, gb = dtn.gearbox, e = this.config.engine, tr = this.config.transmission;
    const thr = this.input.throttle, brk = this.input.brake;
    // reverse selection
    if (gb.gear >= 0 && Math.abs(vFwd) < 1.0 && brk > 0.3 && thr < 0.05) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.35) { gb.shifting || gb.shiftTo(-1); this.reverseTimer = 0; }
      return;
    }
    if (gb.gear === -1) {
      if (Math.abs(vFwd) < 1.0 && thr > 0.3 && brk < 0.05) { this.reverseTimer += dt; if (this.reverseTimer > 0.15) { gb.shiftTo(1); this.reverseTimer = 0; } }
      else this.reverseTimer = 0;
      return;
    }
    this.reverseTimer = 0;
    if (gb.gear === 0) { gb.shiftTo(1); return; }
    if (gb.shifting) return;

    this.shiftCooldown = Math.max(0, (this.shiftCooldown || 0) - dt);
    if (this.shiftCooldown > 0) return;
    // Decide from road speed (output-shaft speed of a car that isn't spinning its
    // wheels) so wheelspin doesn't trigger upshifts; wheel speed only for the limiter.
    const ws = this.wheels, layout = this.config.drivetrain.layout;
    const di = layout === 'FWD' ? [0, 1] : layout === 'RWD' ? [2, 3] : [0, 1, 2, 3];
    let wd = 0; for (const i of di) wd += ws[i].omega; wd /= di.length;
    const rr = ws[di[0]].radius;
    const roadW = Math.abs(vFwd) / rr;
    const rpmAt = (g, w = roadW) => Math.abs(w * gb.ratioOf(g) * tr.finalDrive) * RADS_TO_RPM;
    const rpm = rpmAt(gb.gear);
    const engineRPM = this.drivetrain.engine.rpm;
    const t = Math.max(thr, 0.15);
    const up = lerp(e.idleRPM + (e.redlineRPM - e.idleRPM) * 0.45, tr.autoShiftUpRPM, Math.min(1, t * 1.3));
    const down = lerp(e.idleRPM * 1.5, tr.autoShiftDownRPM, t);
    const atLimiter = engineRPM > e.limiterRPM * 0.99 && rpm > up * 0.4; // wheelspin/drift on the limiter: short-shift
    let shifted = false;
    // limiter short-shift (wheelspin) only when the next gear won't bog the engine at road speed
    if ((rpm > up || (atLimiter && rpmAt(gb.gear + 1) > down * 0.9)) && gb.gear < gb.numGears) shifted = gb.shiftTo(gb.gear + 1);
    // downshift only if the engine is slow too: during wheelspin the road speed is low but the
    // engine is screaming, and dropping a gear there just hunts 1-2-1-2
    else if (gb.gear > 1 && rpm < down && engineRPM < down * 1.15 && rpmAt(gb.gear - 1) < up * 0.9) shifted = gb.shiftTo(gb.gear - 1);
    else if (Math.abs(vFwd) < 2 && gb.gear > 2) shifted = gb.shiftTo(1); // don't bog in a tall gear when stopped
    if (shifted) this.shiftCooldown = tr.shiftTime + 0.35;
  }

  _aero(vFwd) {
    const body = this.body, a = this.config.aero, rho = a.airDensity ?? 1.225;
    const v = body.velocity, sp = v.length();
    _f.copy(v).scale(-0.5 * rho * a.dragCoefficient * a.frontalArea * sp);
    body.addForce(_f);
    const q = 0.5 * rho * a.frontalArea * vFwd * vFwd;
    _p.set(0, 0, this.frontZ); body.localToWorld(_p, _v2);
    _f.copy(_up).scale(q * a.liftCoefFront); body.addForceAtPoint(_f, _v2);
    _p.set(0, 0, this.rearZ); body.localToWorld(_p, _v2);
    _f.copy(_up).scale(q * a.liftCoefRear); body.addForceAtPoint(_f, _v2);
    _f.copy(body.angularVelocity).scale(-a.angularDrag * body.mass);
    body.addTorque(_f);
  }

  _hullCollisions(dt) {
    const body = this.body, g = this._ground, mu = this.config.body.bodyFriction;
    let hits = 0;
    for (const lp of this.hullPoints) {
      body.localToWorld(lp, _p);
      this.world.sample(_p.x, _p.z, g);
      const pen = (g.height - _p.y) * g.normal.y;
      if (pen <= 0) continue;
      hits++;
      const n = g.normal;
      body.pointVelocity(_p, _v);
      const vn = _v.dot(n);
      let jn = 0;
      if (vn < 0) {
        const e = vn < -3 ? 0.15 : 0;
        jn = (-(1 + e) * vn) / body.invMassAlong(_p, n);
        _f.copy(n).scale(jn);
        body.applyImpulse(_f, _p);
      }
      // Coulomb friction impulse
      body.pointVelocity(_p, _v);
      _v2.copy(_v).projectOnPlane(n);
      const vt = _v2.length();
      if (vt > 1e-4 && jn > 0) {
        _v2.scale(1 / vt);
        const jt = Math.min(vt / body.invMassAlong(_p, _v2), mu * jn);
        _f.copy(_v2).scale(-jt);
        body.applyImpulse(_f, _p);
      }
      // positional correction (no energy added)
      body.position.addScaled(n, Math.min(pen, 0.2) * 0.4);
    }
    this.hullContacts = hits;
  }

  /**
   * Wall collisions: each contact point is tested against nearby wall slabs and
   * resolved with a normal impulse (some restitution on hard hits), a Coulomb
   * friction impulse (scraping) and a non-energetic position correction.
   * Exposes wallContact {x, y, z, nx, nz, scrape, impact} for sparks/sound/rumble.
   */
  _wallCollisions(dt) {
    const world = this.world;
    if (!world.wallsNear) return;
    const body = this.body;
    const walls = world.wallsNear(body.position.x, body.position.z, this.boundRadius, this._wallList);
    if (!walls.length) return;
    const n = this._wallN, WP = world.constructor.wallPenetration, mu = 0.35;
    let best = null;
    for (const lp of this.wallPoints) {
      body.localToWorld(lp, _p);
      for (const w of walls) {
        const pen = WP(w, _p.x, _p.y, _p.z, n);
        if (pen <= 0) continue;
        const N = _wn.set(n.nx, 0, n.nz);
        body.pointVelocity(_p, _v);
        const vn = _v.dot(N);
        let jn = 0;
        if (vn < 0) {
          const e = vn < -4 ? 0.25 : 0.05;
          jn = (-(1 + e) * vn) / body.invMassAlong(_p, N);
          _f.copy(N).scale(jn); body.applyImpulse(_f, _p);
        }
        body.pointVelocity(_p, _v);
        _v2.copy(_v).projectOnPlane(N);
        const vt = _v2.length();
        if (vt > 1e-4 && jn > 0) {
          _v2.scale(1 / vt);
          const jt = Math.min(vt / body.invMassAlong(_p, _v2), mu * jn);
          _f.copy(_v2).scale(-jt); body.applyImpulse(_f, _p);
        }
        body.position.addScaled(N, Math.min(pen, 0.3) * 0.5);
        const impact = Math.max(0, -vn);
        if (!best || impact + vt * 0.1 > best.impact + best.scrape * 0.1) best = { x: _p.x, y: _p.y, z: _p.z, nx: n.nx, nz: n.nz, scrape: vt, impact };
      }
    }
    if (best) {
      this.wallContact = best;
      this._wallImpact = Math.max(this._wallImpact || 0, Math.min(1, best.impact / 8));
    }
  }
}

const DEFAULT_SURF = { friction: 1, peakSlipScale: 1, falloff: 0, rollingDrag: 0 };
