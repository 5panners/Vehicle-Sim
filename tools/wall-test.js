// Headless wall-collision regression: head-on, glancing and sideways impacts for
// several cars against a straight concrete wall at z = 0 (traffic on the -z side).
import { World } from '../src/world/World.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { Vec3, Quat } from '../src/physics/math.js';
import { PRESETS } from '../src/vehicles/presets.js';
import { SURFACES } from '../src/world/Surfaces.js';

const world = Object.create(World.prototype);
Object.assign(world, { walls: [], _wallGrid: new Map(), _wallStamp: 0, heightAt: () => 0 });
world.sample = (x, z, o) => { o.height = 0; o.normal.set(0, 1, 0); o.surface = SURFACES[0]; return o; };
world.addWall([[-400, 0], [400, 0]], { height: 1.05, thickness: 0.6 });
const DT = 1 / 600, D = Math.PI / 180;
let fails = 0;

function run(name, { kmh, angle, sideways = false, secs = 3 }) {
  const cfg = PRESETS.find((p) => p.name === name);
  const car = new Vehicle(cfg, world);
  // start 25 m from the wall heading toward it at `angle` degrees off parallel
  const yaw = Math.PI / 2 - angle * D; // 0 deg = driving along +x; 90 = straight at the wall (+z)
  const travel = new Vec3(Math.cos(angle * D), 0, Math.sin(angle * D));
  // a car sliding sideways scrubs off speed fast, so start that case just 3.5 m out
  const gap = sideways ? 3.5 : Math.min(25, 4 + 25 * Math.sin(angle * D));
  const start = new Vec3(0, cfg.body.cgHeight + 0.02, -gap);
  car.reset(start, sideways ? yaw - Math.PI / 2 : Math.atan2(travel.x, travel.z));
  for (let i = 0; i < 300; i++) car.step(DT); // settle
  car.body.velocity.set(travel.x * kmh / 3.6, 0, travel.z * kmh / 3.6);
  for (const w of car.wheels) w.omega = sideways ? 0 : (kmh / 3.6) / w.radius;
  car.setInput({ throttle: 0, brake: 0, steer: 0 });
  let maxZ = -Infinity, hit = false, peakImpact = 0, nan = false;
  for (let i = 0; i < secs / DT; i++) {
    car.step(DT);
    if (!Number.isFinite(car.body.position.x)) { nan = true; break; }
    // furthest any contact point gets into/through the wall
    for (const lp of car.wallPoints) { const p = car.body.localToWorld(lp, new Vec3()); maxZ = Math.max(maxZ, p.z); }
    if (car.wallContact) { hit = true; peakImpact = Math.max(peakImpact, car.wallContact.impact); }
  }
  const up = car.body.localDir(new Vec3(0, 1, 0), new Vec3()).y;
  const through = maxZ > 0.3 + 0.05; // past the far face of the 0.6 m slab
  const ok = !nan && hit && !through && car.body.position.z < 0;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} ${String(kmh).padStart(3)} km/h ${String(angle).padStart(2)}°${sideways ? ' sideways' : '         '} -> impact ${peakImpact.toFixed(1)} m/s, deepest point z=${maxZ.toFixed(2)} (face at -0.30), end v=${(car.speed * 3.6).toFixed(0)} km/h, end z=${car.body.position.z.toFixed(2)}, upright ${up.toFixed(2)}${nan ? ' NaN!' : ''}`);
}

for (const name of ['Ginetta G55', 'Formula 1', 'KZ Shifter Kart']) {
  run(name, { kmh: 100, angle: 90 });            // head-on
  run(name, { kmh: 150, angle: 15 });            // glancing scrape
  run(name, { kmh: 220, angle: 8 });             // fast glance (tunnelling check)
  run(name, { kmh: 60, angle: 90, sideways: true }); // T-bone slide into the wall
}
console.log(fails ? `\n${fails} FAILED` : '\nall wall tests passed');
process.exit(fails ? 1 : 0);
