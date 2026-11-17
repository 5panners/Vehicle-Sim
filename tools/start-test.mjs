// Standing start as in the race: held on the grid (handbrake, 0.45 throttle), released after the reaction delay.
//   node tools/start-test.mjs [mapId]
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps/index.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { PRESETS } from '../src/vehicles/presets.js';
import { BotDriver, BOT_SKILLS } from '../src/game/BotDriver.js';
const mapId = process.argv[2] || 'brands', world = new World(MAPS[mapId]), DT = 1 / 600;
for (const p of PRESETS) {
  const car = new Vehicle(structuredClone(p), world), bot = new BotDriver(world, car, BOT_SKILLS[2], { mapId });
  bot.placeAt(world.track.length - 40);
  const x0 = car.body.position.x, z0 = car.body.position.z; let t = 0, tMove = null, t50 = null, t100 = null;
  for (let i = 0; i < 12 / DT; i++) {
    const hold = t < 0.3;
    if (hold) { car.setInput({ steer: 0, throttle: 0.45, brake: 0, handbrake: 1, clutch: 0 }); } else bot.drive(DT, null);
    car.step(DT); if (hold) { car.body.velocity.x = 0; car.body.velocity.z = 0; car.body.angularVelocity.y = 0; }
    t += DT; const d = Math.hypot(car.body.position.x - x0, car.body.position.z - z0);
    if (tMove === null && car.speed > 1 && t > 0.3) tMove = t - 0.3; if (t50 === null && d > 50) t50 = t - 0.3; if (t100 === null && d > 100) { t100 = t - 0.3; break; }
  }
  console.log(p.name.padEnd(16), 'moving', tMove?.toFixed(2), 's  50 m', t50?.toFixed(2), ' 100 m', t100?.toFixed(2));
}
