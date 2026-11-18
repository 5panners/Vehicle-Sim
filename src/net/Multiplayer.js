import { Relay } from './Relay.js';
import { PRESETS } from '../vehicles/presets.js';

/**
 * Online races through the relay. One player hosts: they own the lobby (track, laps, bot skill,
 * car and the grid slots), run the AI opponents and the start lights. Everyone drives their own
 * car locally and broadcasts its state ~15 times a second; the host also broadcasts the bots.
 * Other cars are drawn as "remote" cars that follow those updates (dead reckoning + smoothing).
 *
 * Grid slots (in grid order, P1 first): 'you'/'human' (a player), 'bot', 'open' (waiting for a
 * player to join), 'na' (empty). Players who join take the first open slot.
 */
export const MAX_SLOTS = 8;
export const SLOT_KINDS = [['bot', 'Bot'], ['open', 'Player'], ['na', 'NA']];
export const HUMAN_COLORS = ['#ffd54f', '#ef5350', '#26c6da', '#ab47bc', '#66bb6a', '#ff7043', '#5c6bc0', '#ec407a'];
const STATE_HZ = 15, LOBBY_EVERY = 1.0, TIMEOUT = 8;

const r3 = (n) => Math.round(n * 1000) / 1000;

export class Multiplayer {
  constructor(app) {
    this.app = app;
    this.id = Math.random().toString(36).slice(2, 10);
    this.role = null;            // 'host' | 'guest' | null
    this.status = 'Offline';
    this.relay = null;
    this.lobby = null;           // host's authoritative lobby, mirrored by guests
    this.seen = new Map();       // id -> last time heard (s)
    this.remote = new Map();     // id/key -> latest state for remote cars
    this.time = 0; this._acc = 0; this._lobbyAcc = 0; this._joinAcc = 0;
    this.onChange = null;        // menu refresh
  }

  get active() { return !!this.relay?.open; }
  get isHost() { return this.role === 'host'; }
  get name() { return (this.app.playerName || 'Player').slice(0, 16); }

  _setStatus(s) { this.status = s; this.onChange?.(); }

  async host(password, slots) {
    await this._connect(password);
    this.role = 'host';
    const me = { k: 'human', id: this.id, name: this.name };
    this.lobby = { host: this.id, map: this.app.mapId, preset: this.app.presetIndex, ...this._raceBits(), slots: slots.map((k) => (k === 'you' ? me : { k })) };
    if (!this.lobby.slots.some((s) => s.id === this.id)) this.lobby.slots[0] = me;
    this._setStatus(`Hosting · share the password · ${this._count()}`);
    this.sendLobby();
  }

  async join(password) {
    await this._connect(password);
    this.role = 'guest'; this.lobby = null;
    this._setStatus('Looking for the host…');
    this._send('join', { name: this.name });
  }

  async _connect(password) {
    if (!password?.trim()) throw new Error('Type a password first');
    this.leave(true);
    this._setStatus('Connecting to the relay…');
    this.password = password;
    this.relay = new Relay({ onMessage: (m) => this._onMessage(m), onClose: () => { this._setStatus('Disconnected from the relay'); this.role = null; this.onChange?.(); } });
    await this.relay.connect(password);
  }

  leave(quiet = false) {
    if (this.relay) { this._send('bye', {}); this.relay.close(); }
    if (this.app.race?.online) this.app.endRace();
    this.relay = null; this.role = null; this.lobby = null; this.seen.clear(); this.remote.clear();
    if (!quiet) this._setStatus('Offline');
  }

  _raceBits() { const s = this.app.raceSettings; return { laps: s.laps, skill: s.skill }; }
  _count() { const n = this.lobby?.slots.filter((s) => s.k === 'human').length ?? 0; return `${n} player${n === 1 ? '' : 's'}`; }

  /** host: change a grid slot (from the menu) */
  setSlot(i, kind) {
    if (!this.isHost) return;
    const s = this.lobby.slots[i];
    if (s.id === this.id) return;
    if (s.k === 'human' && kind === 'open') return;      // already a player there
    this.lobby.slots[i] = { k: kind };
    this.sendLobby();
  }

  /** host: race settings or car changed in the menu */
  refreshLobby() {
    if (!this.isHost) return;
    Object.assign(this.lobby, { map: this.app.mapId, preset: this.app.presetIndex, ...this._raceBits() });
    this.sendLobby();
  }

  sendLobby() { if (this.isHost) { this._send('lobby', this.lobby); this.onChange?.(); } }

  _send(t, d) { this.relay?.send({ f: this.id, t, d }); }

  /** host: build the grid from the slots and start everyone */
  startRace() {
    if (!this.isHost) return;
    const grid = [];
    let bot = 0;
    this.lobby.slots.forEach((s, i) => {
      if (s.k === 'human') grid.push({ kind: 'human', id: s.id, name: s.name, color: HUMAN_COLORS[i % HUMAN_COLORS.length] });
      else if (s.k === 'bot') grid.push({ kind: 'bot', key: `bot${i}`, name: `Bot ${++bot}`, color: null });
    });
    const cfg = this.app.vehicle.config;
    const msg = { map: this.app.mapId, laps: this.lobby.laps, skill: this.lobby.skill, preset: this.app.presetIndex, cfg, hold: 0.2 + Math.random() * 2.8, grid, seq: Date.now() };
    this._send('start', msg);
    this._begin(msg);
  }

  endRaceAll() { if (this.isHost) this._send('end', {}); }

  _begin(msg) {
    const app = this.app;
    if (msg.map !== app.mapId) { this._pendingMap(msg.map); return; }
    if (app.presetIndex !== msg.preset) app.loadPreset(msg.preset, { quiet: true });
    app.applyConfig(structuredClone(msg.cfg));
    const lineup = msg.grid.map((g) => (g.kind === 'human' && g.id === this.id ? { kind: 'me', name: 'You' }
      : g.kind === 'bot' ? (this.isHost ? { kind: 'bot', key: g.key, name: g.name } : { kind: 'remote', key: g.key, name: g.name })
        : { kind: 'remote', key: g.id, name: g.name, color: g.color }));
    if (!lineup.some((l) => l.kind === 'me')) { this._setStatus('The host started without you (no free slot)'); return; }
    this.remote.clear();
    app.createRace({ laps: msg.laps, skill: msg.skill, lineup, online: true, hold: msg.hold });
    app.menu.close();
    this._setStatus(this.isHost ? `Racing · ${this._count()}` : 'Racing');
  }

  _pendingMap(map) {
    try { sessionStorage.setItem('vehicleSim.autoJoin', JSON.stringify({ password: this.password, role: this.role, slots: this.lobby?.slots?.map((s) => (s.id === this.id ? 'you' : s.k === 'human' ? 'open' : s.k)) })); } catch { /* ignore */ }
    this._setStatus('Switching to the host\'s track…');
    this.relay?.close();
    this.app.switchMap(map);
  }

  // ---------------------------------------------------------------- messages
  _onMessage(m) {
    if (!m || m.f === this.id || !m.t) return;
    this.seen.set(m.f, this.time);
    const d = m.d || {};
    if (this.isHost) {
      if (m.t === 'join') {
        let slot = this.lobby.slots.find((s) => s.id === m.f);
        if (!slot) {
          const i = this.lobby.slots.findIndex((s) => s.k === 'open');
          if (i < 0) { this._send('full', { to: m.f }); return; }
          this.lobby.slots[i] = slot = { k: 'human', id: m.f, name: String(d.name || 'Player').slice(0, 16) };
        }
        this._setStatus(`Hosting · ${this._count()}`);
        this.sendLobby();
      } else if (m.t === 'bye') this._drop(m.f);
      else if (m.t === 'st') this.remote.set(m.f, { ...d, at: this.time });
      else if (m.t === 'lobby' && m.f !== this.id) this._setStatus('Another host is using this password — pick a different one');
    } else if (this.role === 'guest') {
      if (m.t === 'lobby') {
        const first = !this.lobby, changed = JSON.stringify(d) !== this._lobbyJson;
        this._lobbyJson = JSON.stringify(d); this.lobby = d; this.hostId = m.f;
        const mine = d.slots.find((s) => s.id === this.id);
        if (!mine) { if (this.time - (this._lastJoin || -9) > 1.5) { this._lastJoin = this.time; this._send('join', { name: this.name }); } this._setStatus('Asking the host for a slot…'); return; }
        if (d.map !== this.app.mapId) { this._pendingMap(d.map); return; }
        if (!this.app.race && d.preset !== this.app.presetIndex) this.app.loadPreset(d.preset, { quiet: true });
        if (first || (changed && this.status !== 'Racing')) this._setStatus(`Joined · waiting for the host to start · ${this._count()}`);
        else if (changed) this.onChange?.();
      } else if (m.t === 'full' && d.to === this.id) this._setStatus('That match is full');
      else if (m.t === 'start') this._begin(d);
      else if (m.t === 'end') { if (this.app.race?.online) { this.app.endRace(); this.app.hud.showToast('The host ended the race', 2000); } }
      else if (m.t === 'st' || m.t === 'bots') {
        if (m.t === 'st') this.remote.set(m.f, { ...d, at: this.time });
        else for (const b of d.list) this.remote.set(b.key, { ...b, at: this.time });
      } else if (m.t === 'bye' && m.f === this.hostId) { this._setStatus('The host left'); if (this.app.race?.online) this.app.endRace(); }
    }
  }

  _drop(id) {
    if (!this.isHost) return;
    const i = this.lobby.slots.findIndex((s) => s.id === id);
    if (i >= 0) { this.lobby.slots[i] = { k: 'open' }; this.sendLobby(); }
    this.remote.delete(id); this.seen.delete(id);
    this.app.race?.dropRemote(id);
    this._setStatus(`Hosting · ${this._count()}`);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const race = this.app.race?.online ? this.app.race : null;
    if (this.isHost) {
      this._lobbyAcc += dt;
      if (this._lobbyAcc > LOBBY_EVERY) { this._lobbyAcc = 0; this._send('lobby', this.lobby); }   // keep-alive: no menu redraw
      for (const [id, t] of this.seen) if (this.time - t > TIMEOUT && this.lobby.slots.some((s) => s.id === id)) this._drop(id);
    } else if (this.role === 'guest') {
      this._joinAcc += dt;
      if (this._joinAcc > 1.2) { this._joinAcc = 0; this._send(this.lobby ? 'hb' : 'join', this.lobby ? {} : { name: this.name }); }   // presence, or knock until the host answers
      if (this.hostId && this.time - (this.seen.get(this.hostId) ?? this.time) > TIMEOUT) { this._setStatus('Lost the host'); this.hostId = null; if (race) this.app.endRace(); }
    }
    if (!race) return;
    this._acc += dt;
    if (this._acc >= 1 / STATE_HZ) {
      this._acc = 0;
      this._send('st', this._pack(this.app.vehicle));
      if (this.isHost && race.bots.length) this._send('bots', { list: race.bots.map((b) => ({ key: b.key, ...this._pack(b.vehicle) })) });
    }
    race.applyRemote(this.remote, this.time, dt);
  }

  _pack(v) {
    const b = v.body, p = b.position, q = b.orientation, vel = b.velocity;
    return { p: [r3(p.x), r3(p.y), r3(p.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], v: [r3(vel.x), r3(vel.y), r3(vel.z)],
      s: r3(v.wheels[0].steer), rpm: Math.round(v.drivetrain.engine.rpm), th: r3(v.input.throttle), br: r3(v.input.brake) };
  }
}

/** the car list for the Create Race slot pickers */
export const presetName = (i) => PRESETS[i]?.name ?? '';
