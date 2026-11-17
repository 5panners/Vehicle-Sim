// Headless check of the practice bot: lap times per skill, wall hits, resets, and a pass on a slow car.
//   node tools/bot-test.mjs [mapId] [car name] [laps]
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps/index.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { Vec3 } from '../src/physics/math.js';
import { PRESETS } from '../src/vehicles/presets.js';
import { LapTimer } from '../src/game/LapTimer.js';
import { BotDriver, BOT_SKILLS, collideCars } from '../src/game/BotDriver.js';

const mapId = process.argv[2] || 'brands', carName = process.argv[3] || 'GT3', LAPS = +(process.argv[4] || 2);
const world = new World(MAPS[mapId]), DT = 1 / 600;
const cfg = () => structuredClone(PRESETS.find((p) => p.name === carName));
const start = world.track.length - 40;

for (const skill of BOT_SKILLS) {
  const car = new Vehicle(cfg(), world), bot = new BotDriver(world, car, skill, { mapId }), lt = new LapTimer(world);
  bot.placeAt(start);
  const laps = []; let walls = 0;
  for (let i = 0; i < 400 / DT && laps.length < LAPS; i++) {
    bot.drive(DT, null); car.step(DT);
    if (car.wallContact) { walls++; car.wallContact = null; }
    if (lt.update(DT, car.body.position.x, car.body.position.z) === 'lap') laps.push(LapTimer.fmt(lt.last.time) + (lt.last.valid ? '' : '✗'));
  }
  console.log(`${skill.name.padEnd(6)} ${carName} @ ${mapId}: laps ${laps.join(', ')}  wall steps ${walls}  resets ${bot.resets || 0}  moments ${bot.moments || 0}`);
}

// traffic: a slow "player" car ahead on the line; the bot should pass it without a big hit
const slow = new Vehicle(cfg(), world), sb = new BotDriver(world, slow, BOT_SKILLS[0], { mapId });
const car = new Vehicle(cfg(), world), bot = new BotDriver(world, car, BOT_SKILLS[2], { mapId });
sb.placeAt(start + 120); bot.placeAt(start);
let maxHit = 0, passedAt = null, t = 0;
for (let i = 0; i < 60 / DT; i++) {
  sb.drive(DT, null); slow.setInput({ throttle: Math.min(slow.input.throttle, 0.25) });   // dawdling player
  bot.drive(DT, slow); slow.step(DT); car.step(DT); t += DT;
  maxHit = Math.max(maxHit, collideCars(slow, car));
  let ahead = (bot.idx - sb.idx + bot.M) % bot.M; if (ahead > bot.M / 2) ahead -= bot.M;
  if (passedAt === null && ahead > 10) passedAt = t;
}
console.log(`traffic: bot passed the slow car after ${passedAt === null ? 'never' : passedAt.toFixed(1) + ' s'}, biggest contact ${maxHit.toFixed(2)} m/s, bot resets ${bot.resets || 0}`);
