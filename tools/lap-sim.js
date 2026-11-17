// Headless AI lap: pure-pursuit steering + curvature-based speed plan. Validates that a
// circuit is drivable (no barrier hits, stays on track) and gives a reference lap time.
//   node tools/lap-sim.js [mapId] [car name] [grip factor]
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps/index.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { Vec3 } from '../src/physics/math.js';
import { PRESETS } from '../src/vehicles/presets.js';
import { LapTimer } from '../src/game/LapTimer.js';

const mapId = process.argv[2] || 'brands', carName = process.argv[3] || 'GT3';
const world = new World(MAPS[mapId]);
const T = world.track, M = T.length, DT = 1 / 600, G = 9.81;
const cfg = PRESETS.find((p) => p.name === carName);
// planning grip: 85% of the weaker axle's tyre peak (a conservative, consistent driver) unless given
const mu = +(process.argv[4] || 0.85 * Math.min(cfg.tires.front.peakFrictionY, cfg.tires.rear.peakFrictionY));
const car = new Vehicle(cfg, world); car.directSteer = true;

// speed plan: corner limit from curvature (with a little downforce credit), then a
// backward pass for braking zones and a forward pass for acceleration
const aero = -(cfg.aero.liftCoefFront + cfg.aero.liftCoefRear) * 0.5 * 1.225 * cfg.aero.frontalArea / cfg.body.mass;
const curvAbs = T.map((_, i) => { let m = 0; for (let k = -4; k <= 4; k++) m = Math.max(m, Math.abs(T[(i + k + M) % M].curv)); return m; });
const vmax = curvAbs.map((c) => Math.min(95, Math.sqrt((mu * G) / Math.max(1e-4, c - mu * aero))));
const brake = mu * G * 0.8, accel = 6;
const plan = vmax.slice();
for (let it = 0; it < 2; it++) for (let i = 2 * M - 1; i >= 0; i--) { const a = i % M, b = (i + 1) % M; plan[a] = Math.min(plan[a], Math.sqrt(plan[b] ** 2 + 2 * brake * 1.02)); }
for (let it = 0; it < 2; it++) for (let i = 0; i < 2 * M; i++) { const a = (i + 1) % M, b = i % M; plan[a] = Math.min(plan[a], Math.sqrt(plan[b] ** 2 + 2 * accel * 1.02)); }

const g0 = T[M - 40];
car.reset(new Vec3(g0.x, world.heightAt(g0.x, g0.z) + cfg.body.cgHeight + 0.2, g0.z), Math.atan2(g0.tx, g0.tz));
const lt = new LapTimer(world);
let idx = M - 40, wallSteps = 0, maxOff = 0, offSteps = 0, laps = [], t = 0, iErr = 0, lastSec = '';
const fwd = new Vec3();
for (let step = 0; step < 300 / DT && laps.length < 2; step++) {
  const p = car.body.position;
  for (let k = 0; k < 30; k++) { const n = (idx + 1) % M; if ((T[n].x - p.x) ** 2 + (T[n].z - p.z) ** 2 < (T[idx].x - p.x) ** 2 + (T[idx].z - p.z) ** 2) idx = n; else break; }
  const v = car.speed, ld = 7 + 0.45 * v, tgt = T[(idx + Math.round(ld)) % M];
  car.body.localDir(new Vec3(0, 0, 1), fwd);
  const dx = tgt.x - p.x, dz = tgt.z - p.z;
  const alpha = Math.atan2(-(dx * fwd.z - dz * fwd.x), dx * fwd.x + dz * fwd.z); // + = target to the right
  const steerAng = Math.atan((2 * cfg.geometry.wheelbase * Math.sin(alpha)) / ld);
  // look ahead ~0.6 s: start braking early enough for the plan, firm pedal when over it
  const want = Math.min(plan[idx], plan[(idx + Math.round(v * 0.6)) % M]), e = want - v;
  iErr = Math.max(-0.5, Math.min(0.5, iErr + e * DT * 0.3));
  // like a driver: feed the throttle in against the slide (body slip angle)
  const slipDeg = Math.abs(car.telemetry.slipAngle) * 57.3;
  const traction = Math.max(0, Math.min(1, 1 - (slipDeg - 3) / 5));
  const throttle = e > -0.5 ? Math.max(0, Math.min(1, 0.35 + e * 0.5 + iErr)) * traction : 0;
  const brakeIn = e < -0.5 ? Math.max(0, Math.min(1, -e * 0.7)) : 0;
  car.setInput({ steer: Math.max(-1, Math.min(1, steerAng / (cfg.steering.maxAngle * Math.PI / 180))), throttle, brake: brakeIn });
  car.step(DT); t += DT;
  if (car.wallContact) { wallSteps++; car.wallContact = null; }
  const s = T[idx], off = Math.hypot(p.x - s.x, p.z - s.z) - s.w / 2;
  if (off > 0.5) offSteps++; maxOff = Math.max(maxOff, off);
  const ev = lt.update(DT, p.x, p.z);
  if (ev === 'sector') lastSec = `${lastSec}${lt.sectors[lt.sector - 1].toFixed(2)} / `;
  if (ev === 'lap') { laps.push(lt.last.time); console.log(`lap ${laps.length}: ${LapTimer.fmt(lt.last.time)}  (sectors ${lastSec}${(lt.last.time - lastSec.split(' / ').filter(Boolean).reduce((a, b) => a + +b, 0)).toFixed(2)})  ${lt.last.valid ? 'valid' : 'INVALID'}`); lastSec = ''; }
  if (!Number.isFinite(p.x)) { console.log('NaN!'); break; }
}
const up = car.body.localDir(new Vec3(0, 1, 0), new Vec3()).y;
console.log(`${carName} @ ${MAPS[mapId].name} (planning grip ${mu.toFixed(2)}): wall contact steps ${wallSteps}, off-track ${(offSteps * DT).toFixed(1)} s (max ${maxOff.toFixed(1)} m past the edge), upright ${up.toFixed(2)}, top planned ${(Math.max(...plan) * 3.6).toFixed(0)} km/h`);
