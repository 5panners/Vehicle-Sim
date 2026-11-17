// Refines a car's bot calibration: an Alien bot with learning off laps at a few grip levels
// (fractions of the tyre peak) and the fastest clean level wins. Prints one JSON line.
//   node tools/bot-grip-search.mjs <mapId> <car name> <start ratio>
const { World } = await import('../src/world/World.js');
const { MAPS } = await import('../src/world/maps/index.js');
const { Vehicle } = await import('../src/physics/Vehicle.js');
const { PRESETS } = await import('../src/vehicles/presets.js');
const { LapTimer } = await import('../src/game/LapTimer.js');
const { BotDriver, BOT_SKILLS } = await import('../src/game/BotDriver.js');
const [mapId, carName, r0] = [process.argv[2], process.argv[3], +process.argv[4]], DT = 1 / 600;
const world = new World(MAPS[mapId]), results = [];
for (const f of [1.0, 0.94, 0.88, 0.82, 0.76]) {
  const ratio = +(r0 * f).toFixed(3);
  const car = new Vehicle(structuredClone(PRESETS.find((p) => p.name === carName)), world);
  const bot = new BotDriver(world, car, BOT_SKILLS[BOT_SKILLS.length - 1], { learn: false, grip: ratio });
  bot.placeAt(world.track.length - 40);
  const lt = new LapTimer(world); let walls = 0; const laps = [];
  for (let i = 0; i < 520 / DT && laps.length < 2; i++) {
    bot.drive(DT, null); car.step(DT); if (car.wallContact) { walls++; car.wallContact = null; }
    if (lt.update(DT, car.body.position.x, car.body.position.z) === 'lap') laps.push(lt.last.time);
  }
  const lap2 = laps[1] ?? Infinity, penalty = (bot.resets || 0) * 20 + (walls > 0 ? 2 : 0);
  results.push({ ratio, lap2: +lap2.toFixed(2), moments: bot.moments || 0, walls, resets: bot.resets || 0, score: lap2 + penalty });
}
const best = results.reduce((a, b) => (b.score < a.score ? b : a));
console.log(JSON.stringify({ map: mapId, car: carName, ratio: best.ratio, tried: results }));
