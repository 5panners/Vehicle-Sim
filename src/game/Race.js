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
  constructor(app, { opponents = 1, skill = 2, laps = 0, slot = 2, lineup = null, online = false, hold = null } = {}) {
    this.app = app; this.world = app.world;
    this.settings = { opponents, skill, laps, slot };
    this.laps = laps; this.M = this.world.track.length; this.online = online; this.hold = hold;
    const cfg = app.vehicle.config;
    // the grid, P1 first: 'me', 'bot' (AI run here) and 'remote' (another player's car, or the host's bots, drawn from network updates)
    if (!lineup) {
      const n = Math.min(opponents, MAX_OPPONENTS) + 1, mine = Math.max(1, Math.min(n, slot)) - 1;
      lineup = Array.from({ length: n }, (_, i) => (i === mine ? { kind: 'me' } : { kind: 'bot' }));
    }
    this.lineup = lineup;
    this.bots = []; this.remotes = [];
    let k = 0;
    for (const [g, l] of lineup.entries()) {
      if (l.kind === 'me') { this.myGrid = g; continue; }
      const c = k++ % BOT_COLORS.length, color = l.color ?? hex(BOT_COLORS[c]);
      const vehicle = new Vehicle(structuredClone(cfg), this.world);
      const view = new CarView(app.scene); view.tint = parseInt(color.slice(1), 16); view.build(vehicle);
      const entry = { name: l.name ?? BOT_NAMES[c], color, vehicle, view, lap: new LapTimer(this.world), grid: g, key: l.key ?? `bot${g}` };
      if (l.kind === 'bot') {
        vehicle.assists = { ...vehicle.assists, abs: app.vehicle.assists.abs, tcs: app.vehicle.assists.tcs, stability: app.vehicle.assists.stability };
        entry.driver = new BotDriver(this.world, vehicle, BOT_SKILLS[skill], { mapId: app.mapId }); entry.goAt = Infinity;
        this.bots.push(entry);
      } else {
        // a remote car is moved by its owner only: here it is immovable, so contacts push the local car (or bot) the whole way
        entry.remote = true; entry.seen = false; view.group.visible = view.blob.visible = false;
        vehicle.body.invMass = 0; vehicle.body.invInertia.set(0, 0, 0);
        this.remotes.push(entry);
      }
    }
    this.player = { name: 'You', color: '#ffd54f', isPlayer: true, lap: app.lapTimer };
    // any driver gives us track lookups (an online guest has no AI of its own: use a parked one)
    this.ref = this.bots[0]?.driver ?? new BotDriver(this.world, new Vehicle(structuredClone(cfg), this.world), BOT_SKILLS[skill], { mapId: app.mapId, learn: false });
  }

  get skill() { return BOT_SKILLS[this.settings.skill]; }
  get cars() { return [this.player, ...this.bots, ...this.remotes]; }
  /** every car but yours: AI and remote */
  get others() { return [...this.bots, ...this.remotes]; }
  vehicleOf(c) { return c.isPlayer ? this.app.vehicle : c.vehicle; }

  /** opponents always have the player's exact spec: tuning-panel changes, torque scale and assist toggles are copied across */
  syncSpec() {
    const pv = this.app.vehicle, a = pv.assists;
    for (const b of this.bots) {
      const v = b.vehicle, d = b.driver, keep = { ...v.assists };
      const grip = d.carGrip / d.peak;                          // keep what the bot has learned, as a share of the tyre peak
      v.setConfig(structuredClone(pv.config));
      v.assists = { ...keep, abs: a.abs, tcs: a.tcs, stability: a.stability };
      v.directSteer = true;
      d.peak = Math.min(v.config.tires.front.peakFrictionY, v.config.tires.rear.peakFrictionY);
      d.carGrip = grip * d.peak; d._corners();
    }
  }

  setSkill(i) { this.settings.skill = i; for (const b of this.bots) b.driver.setSkill(BOT_SKILLS[i]); }

  /** after the Bot AI tab changes a level's numbers: replan corner speeds and braking */
  refreshSkills() { for (const b of this.bots) b.driver._corners(); }

  /** mistakes the opponents have made so far, by name */
  mistakeSummary() { return this.bots.map((b) => ({ name: b.name, color: b.color, log: b.driver.mistakeLog })); }

  /** everyone to the grid (player in the chosen slot, opponents filling the rest) and run the lights */
  start() {
    const slots = gridSlots(this.world, this.lineup.length);
    for (const b of this.bots) { const s = slots[b.grid]; b.driver.placeAtLateral(s.index, s.lat); b.lap.reset(); b.goAt = Infinity; b.driver._oIdx = null; }
    for (const r of this.remotes) { const s = slots[r.grid]; r.vehicle.reset({ x: s.x, y: this.world.heightAt(s.x, s.z) + r.vehicle.config.body.cgHeight, z: s.z }, s.yaw); r.lap.reset(); }
    const ps = slots[this.myGrid];
    this.app.placeCar(ps.x, ps.z, ps.yaw);                // also resets the player's lap timer
    this.clock = 0; this.startTime = null; this.finished = []; this.over = false;
    for (const c of this.cars) { c.idx = undefined; c.progress = null; c.finishTime = null; c.bestLap = null; }
    this.app.lights.begin(this.hold ?? undefined);
  }

  /** network states -> remote cars: dead reckoning from the last update, eased so corrections don't snap */
  applyRemote(states, now, dt) {
    const k = 1 - Math.exp(-14 * dt);
    for (const r of this.remotes) {
      const s = states.get(r.key); if (!s) continue;
      const b = r.vehicle.body, age = Math.min(0.3, now - s.at);
      const tx = s.p[0] + s.v[0] * age, ty = s.p[1] + s.v[1] * age, tz = s.p[2] + s.v[2] * age;
      if (!r.seen || (b.position.x - tx) ** 2 + (b.position.z - tz) ** 2 > 400) { b.position.x = tx; b.position.y = ty; b.position.z = tz; Object.assign(b.orientation, { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }); r.seen = true; r.view.group.visible = r.view.blob.visible = true; }
      else {
        b.position.x += (tx - b.position.x) * k; b.position.y += (ty - b.position.y) * k; b.position.z += (tz - b.position.z) * k;
        const o = b.orientation; let [qx, qy, qz, qw] = s.q;
        if (o.x * qx + o.y * qy + o.z * qz + o.w * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
        o.x += (qx - o.x) * k; o.y += (qy - o.y) * k; o.z += (qz - o.z) * k; o.w += (qw - o.w) * k;
        const l = Math.hypot(o.x, o.y, o.z, o.w) || 1; o.x /= l; o.y /= l; o.z /= l; o.w /= l;
      }
      b.velocity.x = s.v[0]; b.velocity.y = s.v[1]; b.velocity.z = s.v[2];
      const v = r.vehicle, sp = Math.hypot(s.v[0], s.v[2]);
      v.drivetrain.engine.omega = s.rpm * Math.PI / 30; v.input.throttle = s.th; v.input.brake = s.br;
      for (const w of v.wheels) { if (w.axle === 'front') w.steer = s.s; w.rotation += (sp / w.radius) * dt; w.compression = w.staticComp; }
    }
  }

  /** a player left the online race: their car goes */
  dropRemote(key) {
    const i = this.remotes.findIndex((r) => r.key === key); if (i < 0) return;
    const r = this.remotes[i]; r.view.group.removeFromParent(); r.view.blob.removeFromParent(); this.app.audio?.dropVoice(r);
    this.remotes.splice(i, 1); this.finished = this.finished.filter((c) => c !== r);
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
    const pv = this.app.vehicle, all = [pv, ...this.bots.map((b) => b.vehicle), ...this.remotes.filter((r) => r.seen).map((r) => r.vehicle)];
    const nLocal = 1 + this.bots.length;
    for (const b of this.bots) {
      const waiting = this.clock < b.goAt;
      if (waiting) b.vehicle.setInput({ steer: 0, throttle: 0.45, brake: 0, handbrake: 1, clutch: 0 });   // revving on the grid
      else b.driver.drive(DT, all.filter((v) => v !== b.vehicle));
      b.vehicle.step(DT);
      const wc = b.vehicle.wallContact;                                    // keep what the sound model needs before it is consumed
      if (wc) { b.vehicle.audioScrape = Math.max(b.vehicle.audioScrape || 0, wc.scrape); b.vehicle.audioHit = Math.max(b.vehicle.audioHit || 0, Math.min(1, wc.impact / 9)); }
      b.vehicle.wallContact = null;
      if (waiting) { const bv = b.vehicle.body; bv.velocity.x = 0; bv.velocity.z = 0; bv.angularVelocity.y = 0; }
    }
    let bump = 0;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (i >= nLocal && j >= nLocal) continue;                        // two remote cars sort themselves out on their own machines
      const h = collideCars(all[i], all[j]);
      if (h > 1) for (const v of [all[i], all[j]]) v.audioHit = Math.max(v.audioHit || 0, Math.min(1, h / 12));   // every car in the clash is heard
      if (i === 0) bump = Math.max(bump, h);
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

  mapDots() { return this.others.filter((b) => !b.remote || b.seen).map((b) => ({ x: b.vehicle.body.position.x, z: b.vehicle.body.position.z, color: b.color })); }

  dispose() { for (const b of this.others) { b.view.group.removeFromParent(); b.view.blob.removeFromParent(); this.app.audio?.dropVoice(b); } this.bots = []; this.remotes = []; }
}
