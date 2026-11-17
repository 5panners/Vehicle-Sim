import { clamp, DEG } from './math.js';

/**
 * Builds a normalised Pacejka "Magic Formula" curve f(s) where s is slip
 * divided by peak slip. f(0)=0, f(1)=1 (peak), and the fall-off after the peak
 * is controlled by C (shape) and E (curvature).
 */
function makeCurve(C, E) {
  const mf = (x) => Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
  // locate the peak numerically so that f(1) is exactly the peak
  let best = 0, bestX = 1;
  for (let x = 0.01; x < 30; x += 0.01) { const v = mf(x); if (v > best) { best = v; bestX = x; } }
  const slope0 = (mf(bestX * 1e-3) / best) / 1e-3; // df/ds at 0 (for linear region)
  const f = (s) => mf(s * bestX) / best;
  f.slope0 = slope0;
  return f;
}

export const AMBIENT_TEMP = 20;

/**
 * Per-wheel tyre with:
 *  - normalised combined-slip Magic Formula (friction-ellipse via slip similarity)
 *  - load sensitivity
 *  - transient slip (relaxation length) for stable low speed behaviour & carcass feel
 *  - camber thrust
 *  - simple thermal model affecting grip
 *  - surface interaction (friction, peak slip scaling, post-peak fall-off, rolling drag)
 */
export class Tire {
  constructor(cfg) {
    this.cfg = cfg;
    this.curveX = makeCurve(cfg.shapeX.C, cfg.shapeX.E);
    this.curveY = makeCurve(cfg.shapeY.C, cfg.shapeY.E);
    this.reset();
  }

  reset() {
    this.kappa = 0;      // transient longitudinal slip ratio
    this.beta = 0;       // transient lateral slip (tan of slip angle)
    this.temp = this.cfg.optimalTemp - 15;
    this.slipRatio = 0; this.slipAngle = 0; this.normSlip = 0;
    this.fx = 0; this.fy = 0; this.gripFactor = 1;
  }

  _shape(curve, s, falloff) {
    const v = curve(s);
    return s > 1 ? v + (1 - v) * falloff : v; // loose surfaces hold grip past the peak
  }

  /**
   * @param dt     timestep
   * @param Fz     normal load (N)
   * @param vx     contact patch velocity along wheel heading (m/s)
   * @param vy     contact patch velocity along wheel lateral (+right)
   * @param wr     wheel angular velocity * radius (m/s)
   * @param surf   surface definition
   * @param tilt   wheel inclination relative to ground (+ = top leaning right), rad
   */
  update(dt, Fz, vx, vy, wr, surf, tilt) {
    const c = this.cfg;
    const absVx = Math.abs(vx);
    const sx = wr - vx; // longitudinal slip velocity

    // Transient slip states, integrated implicitly (unconditionally stable).
    // Steady state: kappa = sx/|vx|, beta = vy/|vx|. At standstill these act like
    // a stiff spring+damper so a parked car holds on a slope.
    this.kappa = (this.kappa + (dt / c.relaxationLengthX) * sx) / (1 + (dt * absVx) / c.relaxationLengthX);
    this.beta = (this.beta + (dt / c.relaxationLengthY) * vy) / (1 + (dt * absVx) / c.relaxationLengthY);
    this.kappa = clamp(this.kappa, -3, 3);
    this.beta = clamp(this.beta, -8, 8);

    if (Fz <= 0) { this.fx = this.fy = 0; this.slipRatio = this.kappa; this.slipAngle = Math.atan(this.beta); return; }

    const alpha = Math.atan(this.beta);
    const ps = surf.peakSlipScale;
    const sxN = this.kappa / (c.peakSlipRatio * ps);
    const syN = alpha / (c.peakSlipAngle * DEG * ps);
    const s = Math.hypot(sxN, syN);

    // grip modifiers
    const loadMu = Math.max(0.55, 1 - c.loadSensitivity * (Fz / c.nominalLoad - 1));
    const dT = (this.temp - c.optimalTemp) / c.tempWindow;
    const tempMu = 1 - 0.12 * Math.min(1, dT * dT);
    const mu = surf.friction * loadMu * tempMu;
    this.gripFactor = loadMu * tempMu;

    let fxShape, fyShape;
    if (s < 1e-6) { fxShape = this.curveX.slope0 * sxN; fyShape = this.curveY.slope0 * syN; }
    else {
      fxShape = this._shape(this.curveX, s, surf.falloff) * sxN / s;
      fyShape = this._shape(this.curveY, s, surf.falloff) * syN / s;
    }
    let fx = c.peakFrictionX * mu * Fz * fxShape;
    let fy = -c.peakFrictionY * mu * Fz * fyShape;

    // camber thrust: a leaning tyre pushes toward the side it leans (saturates with slip)
    fy += c.camberStiffness * tilt * Fz * mu * Math.max(0, 1 - Math.min(1, s));

    // low-speed damping (removes "spring" oscillation of the relaxation model at rest)
    const low = clamp(1 - Math.hypot(vx, vy) / 2.5, 0, 1);
    if (low > 0) {
      const cd = Fz * 1.5 * low;
      fx += cd * clamp(sx, -1, 1);  // oppose longitudinal slip velocity
      fy -= cd * clamp(vy, -1, 1);  // oppose lateral sliding
    }

    // never exceed the friction ellipse
    const maxX = c.peakFrictionX * mu * Fz * 1.02, maxY = c.peakFrictionY * mu * Fz * 1.02;
    const e = Math.hypot(fx / maxX, fy / maxY);
    if (e > 1) { fx /= e; fy /= e; }

    // thermal model: slip power heats the tyre, airflow cools it
    const slipPower = Math.abs(sx * fx) + Math.abs(vy * fy);
    this.temp += (slipPower * c.heatRate * 1e-4 + absVx * Fz * 2e-7
      - (this.temp - AMBIENT_TEMP) * c.coolRate * (1 + absVx * 0.03)) * dt;

    this.fx = fx; this.fy = fy;
    this.slipRatio = this.kappa; this.slipAngle = alpha; this.normSlip = s;
  }
}
