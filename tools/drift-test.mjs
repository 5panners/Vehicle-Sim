// Can the car be drifted? Flat asphalt: build speed, then flick in with steering + a handbrake tap (or brake) and try to hold a
// 20 degree slip angle with throttle + counter-steer. Reports how much of 4 s it stayed in a drift, and what it needed.
//   node tools/drift-test.mjs "KZ Shifter Kart" [json overrides, e.g. '{"tires":{"rear":{"peakFrictionY":1.3}}}']
import { Vehicle } from '../src/physics/Vehicle.js';
import { Vec3 } from '../src/physics/math.js';
import { PRESETS, deepMerge } from '../src/vehicles/presets.js';
import { SURFACES } from '../src/world/Surfaces.js';
const world = { sample(x, z, out) { out.height = 0; out.normal.set(0, 1, 0); out.surface = SURFACES[0]; return out; }, heightAt: () => 0 };
const DT = 1 / 600, name = process.argv[2] || 'KZ Shifter Kart', over = process.argv[3] ? JSON.parse(process.argv[3]) : null;
const base = PRESETS.find((p) => p.name === name);
const cfg = over ? deepMerge(base, over) : structuredClone(base);
const entries = { 'handbrake tap': { hb: 0.35 }, 'brake + steer': { brk: 0.35 }, 'power-over (no tap)': {} };
for (const [label, e] of Object.entries(entries)) for (const dir of [1]) {
  const car = new Vehicle(structuredClone(cfg), world);
  car.reset(new Vec3(-200, cfg.body.cgHeight + 0.05, 0), Math.PI / 2);
  car.setInput({ throttle: 1, steer: 0, brake: 0, handbrake: 0, clutch: 0 });
  const vTarget = Math.max(13, Math.min(24, car.config?.body?.mass < 300 ? 18 : 22));
  for (let i = 0; i < 25 / DT && car.speed < vTarget; i++) car.step(DT);
  const v0 = car.speed; let held = 0, sumSteer = 0, maxSlip = 0, minV = 1e9, spun = false, t = 0;
  // entry flick
  const flick = 0.45;
  for (let i = 0; i < flick / DT; i++) { car.setInput({ throttle: e.brk ? 0 : 1, steer: 0.7 * dir, brake: e.brk || 0, handbrake: e.hb || 0 }); car.step(DT); }
  const N = 4 / DT; let nSteer = 0;
  for (let i = 0; i < N; i++) {
    const beta = car.telemetry.slipAngle * 57.3 * -dir;                       // + when the tail is out (nose pointing into the turn)
    // hold ~20 degrees: steer into the turn when the slip is below target, counter-steer when above
    const err = beta - 20, steer = Math.max(-1, Math.min(1, (0.7 - err * 0.045) * dir));
    car.setInput({ throttle: 1, steer, brake: 0, handbrake: 0 }); car.step(DT); t += DT;
    const b = Math.abs(car.telemetry.slipAngle * 57.3); maxSlip = Math.max(maxSlip, b);
    if (b > 14 && car.speed > 5) held += DT; sumSteer += Math.abs(steer); nSteer++; minV = Math.min(minV, car.speed);
    if (b > 100) spun = true;
  }
  console.log(`${name.padEnd(16)} ${label.padEnd(20)} v0 ${v0.toFixed(1)} m/s  held>14deg ${held.toFixed(2)} s of 4  max slip ${maxSlip.toFixed(0)}deg  avg |steer| ${(sumSteer / nSteer).toFixed(2)}  min v ${minV.toFixed(1)}${spun ? '  SPUN' : ''}`);
}
