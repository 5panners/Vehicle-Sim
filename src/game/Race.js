import { Vehicle } from '../physics/Vehicle.js';
import { CarView } from '../render/CarView.js';
import { BotDriver, BOT_SKILLS, collideCars } from './BotDriver.js';
import { gridSlots } from './RaceStart.js';
import { LapTimer } from './LapTimer.js';

export const BOT_COLORS = [0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0xfdd835, 0x00acc1, 0xe91e63];
export const BOT_NAMES = ['Blue', 'Green', 'Orange', 'Purple', 'Yellow', 'Teal', 'Pink'];
export const MAX_OPPONENTS = BOT_COLORS.length;

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

/**
 * A race against AI opponents: grid placement, the start, positions by distance covered,
 * laps and the finish. laps = 0 means an open practice session with no finish.
 * Every opponent drives the same car as the player.
 */
export class Race {
  constructor(app, { opponents = 1, skill = 2, laps = 0, slot = 2 } = {}) {
    this.app = app; this.world = app.world;
    this.settings = { opponents, skill, laps, slot };
    this.laps = laps; this.M = this.world.track.length;
    const cfg = app.vehicle.config;
    this.bots = [];
    for (let k = 0; k < Math.min(opponents, MAX_OPPONENTS); k++) {
      const vehicle = new Vehicle(structuredClone(cfg), this.world);
      const driver = new BotDriver(this.world, vehicle, BOT_SKILLS[skill], { mapId: app.mapId });
      const view = new CarView(app.scene); view.tint = BOT_COLORS[k]; view.build(vehicle);
      this.bots.push({ name: BOT_NAMES[k], color: hex(BOT_COLORS[k]), vehicle, driver, view, lap: new LapTimer(this.world), goAt: Infinity });
    }
    this.player = { name: 'You', color: '#ffd54f', isPlayer: true, lap: app.lapTimer };
    this.ref = this.bots[0].driver;                       // any driver gives us track lookups
  }

  get skill() { return BOT_SKILLS[this.settings.skill]; }
  get cars() { return [this.player, ...this.bots]; }
  vehicleOf(c) { return c.isPlayer ? this.app.vehicle : c.vehicle; }

  setSkill(i) { this.settings.skill = i; for (const b of this.bots) b.driver.setSkill(BOT_SKILLS[i]); }

  /** everyone to the grid (player in the chosen slot, opponents filling the rest) and run the lights */
  start() {
    const n = this.bots.length + 1, slots = gridSlots(this.world, n);
    const mine = Math.max(1, Math.min(n, this.settings.slot)) - 1;
    const order = slots.filter((_, i) => i !== mine);
    this.bots.forEach((b, k) => { const s = order[k]; b.driver.placeAtLateral(s.index, s.lat); b.lap.reset(); b.goAt = Infinity; b.driver._oIdx = null; });
    const ps = slots[mine];
    this.app.placeCar(ps.x, ps.z, ps.yaw);                // also resets the player's lap timer
    this.clock = 0; this.startTime = null; this.finished = []; this.over = false;
    for (const c of this.cars) { c.idx = undefined; c.progress = null; c.finishTime = null; c.bestLap = null; }
    this.app.lights.begin();
  }

  /** opponents back to the grid, driving off at once (you spawned somewhere else) */
  botsToGrid() {
    const slots = gridSlots(this.world, this.bots.length);
    this.bots.forEach((b, k) => { b.driver.placeAtLateral(slots[k].index, slots[k].lat); b.lap.reset(); b.goAt = 0; b.idx = undefined; b.progress = null; });
    this.app.lights.phase = 'idle';
  }

  /** physics step for the opponents (the player's car is stepped by the app). Returns the hardest contact. */
  step(DT) {
    this.clock += DT;
    const pv = this.app.vehicle, all = [pv, ...this.bots.map((b) => b.vehicle)];
    for (const b of this.bots) {
      const waiting = this.clock < b.goAt;
      if (waiting) b.vehicle.setInput({ steer: 0, throttle: 0.45, brake: 0, handbrake: 1, clutch: 0 });   // revving on the grid
      else b.driver.drive(DT, all.filter((v) => v !== b.vehicle));
      b.vehicle.step(DT); b.vehicle.wallContact = null;
      if (waiting) { const bv = b.vehicle.body; bv.velocity.x = 0; bv.velocity.z = 0; bv.angularVelocity.y = 0; }
    }
    let bump = 0;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const h = collideCars(all[i], all[j]);
      if (i === 0) bump = Math.max(bump, h);              // only the player's knocks make a sound
    }
    return bump;
  }

  /** per frame: lights, lap timers, distance covered, finishes. Returns events for the HUD. */
  update(dt, lightsEvent) {
    const ev = [];
    if (lightsEvent === 'out') { this.startTime = this.clock; for (const b of this.bots) b.goAt = this.clock + b.driver.skill.react + Math.random() * 0.1; }
    const d = this.ref, M = this.M;
    for (const c of this.cars) {
      const p = this.vehicleOf(c).body.position;
      if (!c.isPlayer && c.lap.update(dt, p.x, p.z) === 'lap' && c.lap.last.best) c.bestLap = c.lap.best;
      if (c.isPlayer) c.bestLap = c.lap.best;
      // distance covered in track samples, negative while behind the line on the grid
      const i = c.idx === undefined || (p.x - d.T[c.idx].x) ** 2 + (p.z - d.T[c.idx].z) ** 2 > 900 ? d.nearestIndex(p.x, p.z) : d._track(p, c.idx);
      if (c.progress === null) c.progress = i > M / 2 ? i - M : i;
      else { let delta = i - c.idx; if (delta > M / 2) delta -= M; else if (delta < -M / 2) delta += M; c.progress += delta; }
      c.idx = i;
      if (this.laps && c.finishTime === null && this.startTime !== null && c.progress >= this.laps * M) {
        c.finishTime = this.clock - this.startTime; this.finished.push(c);
        ev.push({ type: 'finish', car: c, place: this.finished.length });
        if (c.isPlayer) { this.over = true; ev.push({ type: 'over' }); }
      }
    }
    return ev;
  }

  /** standings: finishers in order, then by distance covered */
  standings() {
    const running = this.cars.filter((c) => c.finishTime === null).sort((a, b) => (b.progress ?? -1e9) - (a.progress ?? -1e9));
    return [...this.finished, ...running];
  }

  lapOf(c) { return this.laps ? Math.max(1, Math.min(this.laps, Math.floor((c.progress ?? 0) / this.M) + 1)) : Math.max(1, Math.floor((c.progress ?? 0) / this.M) + 1); }

  /** gap in seconds between two cars, from the distance between them and their speeds */
  gap(a, b) {
    const metres = Math.abs((a.progress ?? 0) - (b.progress ?? 0)) * this.ref.step;
    const v = (this.vehicleOf(a).speed + this.vehicleOf(b).speed) / 2;
    return metres / Math.max(8, v);
  }

  /** the line under the lap timer */
  hudHtml() {
    const st = this.standings(), me = st.indexOf(this.player), n = st.length;
    const pos = `<b>P${me + 1}</b>/${n}`, lap = this.laps ? `Lap ${this.lapOf(this.player)}/${this.laps}` : `Practice · lap ${this.lapOf(this.player)}`;
    let rel = '';
    if (me > 0) rel = `<span class="ahead">${this.gap(st[me - 1], this.player).toFixed(1)} s to ${st[me - 1].name}</span>`;
    else if (n > 1) rel = `<span class="behind">${this.gap(this.player, st[1]).toFixed(1)} s ahead of ${st[1].name}</span>`;
    return `<b class="racepos">${pos}</b> · ${lap} · ${this.skill.name}<br>${rel}`;
  }

  /** finishing order, total times and best laps */
  resultsHtml() {
    const f = LapTimer.fmt, st = this.standings(), winner = st[0];
    const rows = st.map((c, i) => {
      const time = c.finishTime !== null ? (i === 0 ? f(c.finishTime) : `+${(c.finishTime - winner.finishTime).toFixed(3)}`) : `running (lap ${this.lapOf(c)})`;
      return `<tr class="${c.isPlayer ? 'me' : ''}"><td>P${i + 1}</td><td><i style="background:${c.color}"></i>${c.name}</td><td>${time}</td><td>${f(c.bestLap)}</td></tr>`;
    }).join('');
    const me = st.indexOf(this.player) + 1;
    return `<h2>${me === 1 ? 'Winner!' : `Finished P${me}`}</h2><table><tr><th></th><th>Driver</th><th>Time</th><th>Best lap</th></tr>${rows}</table>`;
  }

  mapDots() { return this.bots.map((b) => ({ x: b.vehicle.body.position.x, z: b.vehicle.body.position.z, color: b.color })); }

  dispose() { for (const b of this.bots) b.view.group.removeFromParent(); this.bots = []; }
}
