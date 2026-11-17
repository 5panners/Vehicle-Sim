// Mistake check: each skill level laps a few times; reports mistakes made (by type), lap-time spread,
// wall hits and self-resets. node tools/bot-mistakes-test.mjs [mapId] [car name] [laps]
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps/index.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { PRESETS } from '../src/vehicles/presets.js';
import { LapTimer } from '../src/game/LapTimer.js';
import { BotDriver, BOT_SKILLS, MISTAKE_TYPES } from '../src/game/BotDriver.js';

const mapId = process.argv[2] || 'brands', carName = process.argv[3] || 'GT3', LAPS = +(process.argv[4] || 4), DT = 1 / 600;
const world = new World(MAPS[mapId]);
for (const skill of BOT_SKILLS) {
  const car = new Vehicle(structuredClone(PRESETS.find((p) => p.name === carName)), world);
  const bot = new BotDriver(world, car, skill, { mapId, learn: false });
  bot.placeAt(world.track.length - 40);
  const lt = new LapTimer(world), laps = []; let walls = 0;
  for (let i = 0; i < (LAPS * 200) / DT && laps.length < LAPS; i++) {
    bot.drive(DT, null); car.step(DT); if (car.wallContact) { walls++; car.wallContact = null; }
    if (lt.update(DT, car.body.position.x, car.body.position.z) === 'lap') laps.push(lt.last.time);
  }
  const by = Object.fromEntries(MISTAKE_TYPES.map((t) => [t, bot.mistakeLog.filter((m) => m === t).length]));
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length, sd = Math.sqrt(laps.reduce((a, b) => a + (b - mean) ** 2, 0) / laps.length);
  console.log(`${skill.name.padEnd(6)} laps ${laps.map((l) => l.toFixed(1)).join(' ')}  spread ±${sd.toFixed(1)}s  mistakes ${bot.mistakeLog.length} ${JSON.stringify(by)}  walls ${walls}  resets ${bot.resets || 0}  corners ${bot.apexes.length}`);
}
