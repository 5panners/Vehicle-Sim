// Headless physics regression: drives each preset through launch, braking and cornering.
import { World } from '../src/world/World.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { Vec3 } from '../src/physics/math.js';
import { PRESETS } from '../src/vehicles/presets.js';

import { SURFACES } from '../src/world/Surfaces.js';
// Infinite flat asphalt isolates vehicle behaviour from the terrain.
const flatWorld = { sample(x, z, out) { out.height = 0; out.normal.set(0, 1, 0); out.surface = SURFACES[0]; return out; }, heightAt: () => 0 };
const t0 = Date.now();
const realWorld = new World();
console.log(`world built in ${Date.now() - t0} ms, track ${realWorld.trackLength} m`);
const world = flatWorld;
const DT = 1 / 600;
const kmh = (v) => (v * 3.6).toFixed(1);

for (const cfg of PRESETS.filter((p) => !process.argv[2] || p.name === process.argv[2])) {
  const car = new Vehicle(cfg, world);
  const sp = { x: -60, z: 0 };
  car.reset(new Vec3(sp.x, world.heightAt(sp.x, sp.z) + cfg.body.cgHeight + 0.05, sp.z), Math.PI / 2);
  const run = (secs, input, every = 0, label = '') => {
    car.setInput(input);
    for (let i = 0; i < secs / DT; i++) {
      car.step(DT);
      if (every && i % Math.round(every / DT) === 0) {
        const w = car.wheels;
        console.log(`  ${label} t=${(i * DT).toFixed(1)} v=${kmh(car.speed)} rpm=${car.rpm.toFixed(0)} g=${car.gear} clutch=${car.drivetrain.clutch.toFixed(2)} Fz=${w.map((x) => x.Fz.toFixed(0)).join('/')} y=${car.body.position.y.toFixed(3)}`);
      }
      if (!Number.isFinite(car.body.position.x)) { console.log('  NaN!'); process.exit(1); }
    }
  };
  console.log(`\n== ${cfg.name}`);
  run(1.5, { throttle: 0, brake: 0, steer: 0 }, 0.5, 'settle');
  let tt = 0; car.setInput({ throttle: 1 });
  while (car.speed < 100 / 3.6 && tt < 20) { car.step(DT); tt += DT; }
  console.log(`  0-100 km/h: ${tt.toFixed(2)} s (gear ${car.gear}, rpm ${car.rpm.toFixed(0)})`);
  run(3, { throttle: 1 }, 1, 'accel');
  const v0 = car.speed; let d = 0; const ps = car.body.position.clone();
  car.setInput({ throttle: 0, brake: 1 });
  let bt = 0; while (car.speed > 0.5 && bt < 15) { car.step(DT); bt += DT; }
  d = Math.hypot(car.body.position.x - ps.x, car.body.position.z - ps.z);
  console.log(`  braking ${kmh(v0)}->0 in ${bt.toFixed(2)} s, ${d.toFixed(1)} m (${(v0 * v0 / (2 * d) / 9.81).toFixed(2)} g)`);
  // steady-state cornering on the pad
  car.reset(new Vec3(-60, cfg.body.cgHeight + 0.05, 0), Math.PI / 2);
  run(1, {});
  run(6, { throttle: 0.6, brake: 0, steer: 0 });
  run(4, { throttle: 0.35, steer: 0.5 }, 1, 'corner');
  console.log(`  latG=${car.telemetry.gLat.toFixed(2)} yaw=${car.telemetry.yawRate.toFixed(2)} slip=${(car.telemetry.slipAngle * 57.3).toFixed(1)}deg pos=(${car.body.position.x.toFixed(0)},${car.body.position.z.toFixed(0)})`);
  // stability smoke test on the real world: full-throttle laps of the jump lanes & strips
  const car2 = new Vehicle(cfg, realWorld);
  for (const [x, z, yaw] of [[-150, -150, 0], [-265, -160, 0], [123, -130, 0], [-205, -140, 0]]) {
    car2.reset(new Vec3(x, realWorld.heightAt(x, z) + cfg.body.cgHeight + 0.1, z), yaw);
    let maxY = 0, airborne = 0;
    const fwd = new Vec3();
    for (let i = 0; i < 12 / DT; i++) {
      // lane keeping (like a driver would): hold x = start lane, heading +z.
      // Right is -X, so being at x < lane means we're right of it -> steer left (negative).
      car2.body.localDir(new Vec3(0, 0, 1), fwd);
      const steer = Math.max(-0.5, Math.min(0.5, 0.08 * (car2.body.position.x - x) + 1.5 * fwd.x));
      car2.setInput({ throttle: 1, brake: 0, steer });
      car2.step(DT);
      if (!Number.isFinite(car2.body.position.y)) { console.log('  NaN on real world!'); process.exit(1); }
      maxY = Math.max(maxY, car2.body.position.y);
      if (car2.wheels.every((w) => !w.contact)) airborne += DT;
    }
    const up = car2.body.localDir(new Vec3(0, 1, 0), new Vec3()).y;
    console.log(`  run from (${x},${z}): v=${kmh(car2.speed)} maxY=${maxY.toFixed(1)} air=${airborne.toFixed(2)}s upright=${up.toFixed(2)}`);
  }
}
