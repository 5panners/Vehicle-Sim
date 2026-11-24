import { Relay, BROKERS } from './Relay.js';
import { PRESETS } from '../vehicles/presets.js';
import { BOT_COLORS } from '../game/Race.js';
import { BUILD } from '../build.js';

/**
 * Online races through the relay. One player hosts: they own the lobby (track, laps, bot skill,
 * car and the grid slots), run the AI opponents and the start lights. Everyone drives their own
 * car locally and broadcasts its state 20 times a second; the host also broadcasts the bots.
 * Other cars are drawn as "remote" cars that play those updates back a moment late, interpolated (see RemoteTrack).
 *
 * Grid slots (in grid order, P1 first): 'you'/'human' (a player), 'bot' or 'empty'. A player who
 * joins takes a random bot's place (an empty slot when no bots are left), and gives it back when they
 * leave; the match is only full when every slot holds a player.
 */
export const MAX_SLOTS = 8;
export const SLOT_KINDS = [['bot', 'Bot'], ['empty', 'Empty']];
/** slot kinds saved by older builds: 'open' (a player slot) is a bot now, 'na' is empty */
export const slotKind = (k) => (k === 'na' ? 'empty' : k === 'open' ? 'bot' : k);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const HUMAN_COLORS = ['#ffd54f', '#ef5350', '#26c6da', '#ab47bc', '#66bb6a', '#ff7043', '#5c6bc0', '#ec407a'];
// Each player sends one state message per tick (the host's bots ride in the same message); the lobby / heartbeat go once a
// second. The rate is the player's choice (Net settings) but never more than the relay passes: broker.emqx.io drops anything
// over ~10 messages a second, test.mosquitto.org takes 20 Hz. Remote cars glide between updates (RemoteTrack).
const LOBBY_EVERY = 1.0, TIMEOUT = 8, PING_EVERY = 2;

/** live-tweakable online settings (Create Race > Play online, or keys while driving) */
export const NET_DEFAULTS = { relay: 'auto', rate: 20, buffer: 0, predict: 0.6 };   // buffer 0 = auto (s otherwise)
export const NET_RATES = [8, 10, 15, 20];
export function loadNetTune() { try { return { ...NET_DEFAULTS, ...JSON.parse(localStorage.getItem('vehicleSim.net') || '{}') }; } catch { return { ...NET_DEFAULTS }; } }

const r3 = (n) => Math.round(n * 1000) / 1000;
const clock = () => performance.now() / 1000;

/**
 * Smooth playback of another car's updates. The relay is a public broker on the internet, so updates arrive unevenly (late,
 * in bunches) even on a fast connection. Instead of jumping to each update, the car is drawn a short, adaptive time in the past
 * and glides along a curve through the last updates (position and velocity), so jitter in arrival times disappears. The delay
 * is the arrival jitter measured so far plus a margin; only if the data runs dry does the car extrapolate briefly.
 */
export class RemoteTrack {
  constructor(net) { this.net = net; this.snaps = []; this.off = null; this.jit = 0.015; this.gap = 0.1; this.peerRtt = 0; }

  /** ts: the sender's clock when the state was taken; recv: our clock now */
  add(ts, st, recv) {
    const o = recv - ts;
    if (this.off === null) this.off = o;
    else { this.jit += (Math.abs(o - this.off) - this.jit) * 0.04; this.off += (o - this.off) * (o < this.off ? 0.25 : 0.02); }   // a quicker update shows the true transit time: follow it fast
    const last = this.snaps[this.snaps.length - 1];
    if (last && ts <= last.ts) return;                                               // late, out of order
    if (last) this.gap += (Math.min(0.5, ts - last.ts) - this.gap) * 0.1;              // how often this sender updates
    if (st.rt !== undefined) this.peerRtt = st.rt;
    if (last && Math.hypot(st.p[0] - last.p[0], st.p[2] - last.p[2]) > 25) this.snaps.length = 0;   // a respawn: do not glide across the map
    this.snaps.push({ ts, ...st });
    if (this.snaps.length > 40) this.snaps.shift();
  }

  /** how far behind the newest update the car is drawn: Auto (from the update gap and the jitter) or the player's fixed buffer */
  get delay() { const b = this.net?.tune.buffer; return b ? b : Math.min(0.4, Math.max(0.05, 0.02 + 1.3 * this.gap + 3 * this.jit)); }
  /** one-way network time from that car's driver to us: half of each side's round trip to the host (the host's is 0) */
  get latency() { return ((this.net?.rtt || 0) + this.peerRtt) / 2; }

  /** the state to draw at our clock `now`, or null before the first update */
  sample(now) {
    const st = this._sample(now); if (!st) return null;
    // prediction: carry the car on along its path by part of the time it is behind (network + buffer), turning at the rate
    // it was turning, so it is drawn nearer to where it really is now. 0 = exact but late, 1 = on time but overshoots corners.
    const k = this.net?.tune.predict ?? 0; if (!k) return st;
    const lead = Math.min(0.6, k * (this.latency + this.delay)), w = Math.max(-2, Math.min(2, st.w || 0)), a = w * lead;
    const c = Math.cos(a / 2), s = Math.sin(a / 2), vx = st.v[0] * c + st.v[2] * s, vz = -st.v[0] * s + st.v[2] * c;   // the velocity half way round the turn
    const qy = [0, Math.sin(a / 2), 0, Math.cos(a / 2)], q = st.q;   // yaw the car by the same turn (world Y, applied first)
    const nq = [qy[3] * q[0] + qy[1] * q[2], qy[3] * q[1] + qy[1] * q[3], qy[3] * q[2] - qy[1] * q[0], qy[3] * q[3] - qy[1] * q[1]];
    return { ...st, p: [st.p[0] + vx * lead, st.p[1] + st.v[1] * lead * 0.5, st.p[2] + vz * lead], q: nq };
  }

  _sample(now) {
    const S = this.snaps, n = S.length; if (!n) return null;
    // our own playback clock: it runs at the real rate and only drifts gently towards the ideal time, so late or early
    // updates and a changing delay never make the car jump
    const ideal = now - this.off - this.delay;
    if (this.rt === undefined || Math.abs(ideal - this.rt) > 1.5) this.rt = ideal;
    else { const dtr = Math.min(0.1, now - this.lastNow), e = ideal - this.rt - dtr, g = Math.abs(e) > 0.12 ? 0.3 : 0.08; this.rt += dtr + Math.max(-g * dtr, Math.min(g * dtr, e)); }   // far off: catch up faster
    this.lastNow = now;
    const t = this.rt;
    if (t <= S[0].ts) return { ...S[0], p: S[0].p, q: S[0].q };
    const L = S[n - 1];
    if (t >= L.ts) {                                                                  // out of data: carry on at the last velocity, fading out
      const f = Math.min(0.3, t - L.ts);
      return { ...L, p: [L.p[0] + L.v[0] * f, L.p[1] + L.v[1] * f, L.p[2] + L.v[2] * f] };
    }
    let i = n - 2; while (i > 0 && S[i].ts > t) i--;
    const A = S[i], B = S[i + 1], h = B.ts - A.ts, u = (t - A.ts) / h, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const p = [0, 1, 2].map((k) => h00 * A.p[k] + h10 * h * A.v[k] + h01 * B.p[k] + h11 * h * B.v[k]);
    let [bx, by, bz, bw] = B.q; if (A.q[0] * bx + A.q[1] * by + A.q[2] * bz + A.q[3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    const q = [A.q[0] + (bx - A.q[0]) * u, A.q[1] + (by - A.q[1]) * u, A.q[2] + (bz - A.q[2]) * u, A.q[3] + (bw - A.q[3]) * u], ql = Math.hypot(...q) || 1;
    const lerp = (a, b) => a + (b - a) * u;
    let w = 0;                                                        // turn rate of the path (rad/s about +Y), for prediction
    if (Math.hypot(A.v[0], A.v[2]) > 2 && Math.hypot(B.v[0], B.v[2]) > 2) { let d = Math.atan2(B.v[0], B.v[2]) - Math.atan2(A.v[0], A.v[2]); d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; w = d / h; }
    return { p, q: q.map((x) => x / ql), w, v: [lerp(A.v[0], B.v[0]), lerp(A.v[1], B.v[1]), lerp(A.v[2], B.v[2])], s: lerp(A.s, B.s), rpm: lerp(A.rpm, B.rpm), th: lerp(A.th, B.th), br: lerp(A.br, B.br) };
  }
}

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
    this.tune = loadNetTune();   // relay, update rate, buffer, prediction
    this.rtt = 0;                // round trip to the host through the relay (s); 0 for the host
    this._echo = new Map();      // host: pings to answer in its next state message
  }

  setTune(k, v) { this.tune[k] = v; try { localStorage.setItem('vehicleSim.net', JSON.stringify(this.tune)); } catch { /* ignore */ } this.onChange?.(); }
  /** updates a second actually sent: the player's choice, capped below what the relay passes */
  get rate() { return Math.min(this.tune.rate, Math.floor((this.relay?.limit ?? 9.5) - 1.5)); }
  /** one line for the HUD and the menu */
  statsText() {
    if (!this.active) return 'Offline';
    const tr = [...this.remote.values()], d = tr.length ? tr.reduce((a, t) => a + t.delay, 0) / tr.length : 0, lat = tr.length ? tr.reduce((a, t) => a + t.latency, 0) / tr.length : this.rtt / 2;
    const ms = (x) => `${Math.round(x * 1000)} ms`;
    return `${this.relay.broker?.name ?? 'relay'} · ${this.isHost ? 'host' : `ping ${ms(this.rtt)}`} · ${this.rate} Hz · buffer ${this.tune.buffer ? ms(this.tune.buffer) : `auto ${ms(d)}`} · prediction ${Math.round(this.tune.predict * 100)}% · others ~${ms(lat + d)} behind`;
  }

  get active() { return !!this.relay?.open; }
  get isHost() { return this.role === 'host'; }
  get name() { return (this.app.playerName || 'Player').slice(0, 16); }

  _verMsg(b) { return `The host runs build ${b ?? 'older'}, you run build ${BUILD.number}: both hard refresh (Cmd+Shift+R) so you match`; }

  _setStatus(s) { this.status = s; this.onChange?.(); }

  async host(password, slots) {
    await this._connect(password, 'host');
    this.role = 'host';
    const me = { k: 'human', id: this.id, name: this.name };
    this.lobby = { host: this.id, build: BUILD.number, map: this.app.mapId, preset: this.app.presetIndex, ...this._raceBits(), slots: Array.from({ length: MAX_SLOTS }, (_, i) => (slots[i] === 'you' ? me : { k: slotKind(slots[i] ?? 'bot') })) };
    if (!this.lobby.slots.some((s) => s.id === this.id)) this.lobby.slots[0] = me;
    this._setStatus(`Hosting on ${this.relay.broker.name}${this.relayPing < Infinity ? ` (${Math.round(this.relayPing * 1000)} ms)` : ''} · share the password · ${this._count()}`);
    this.sendLobby();
  }

  async join(password) {
    await this._connect(password, 'guest');
    this.role = 'guest'; this.lobby = null;
    this._setStatus(this._cands.length > 1 ? `Looking for the host on ${this._cands.length} relays…` : `Looking for the host on ${this.relay.broker.name}…`);
    this._send('join', { name: this.name, build: BUILD.number });
  }

  /**
   * Relay 'auto' picks the best relay for this game. The host connects to every relay at once, times a few round trips
   * through each and keeps the fastest. A joining player listens on every relay at once and keeps the one the host answers
   * on, so everyone always ends up together. A fixed choice connects to that relay only.
   */
  async _connect(password, role) {
    if (!password?.trim()) throw new Error('Type a password first');
    this.leave(true);
    this.password = password; this.rtt = 0; this._echo.clear(); this.relayPing = null; this._cands = [];
    const list = this.tune.relay === 'auto' ? BROKERS : BROKERS.filter((b) => b.id === this.tune.relay);
    this._setStatus(list.length > 1 ? (role === 'host' ? 'Timing the relays…' : 'Connecting to the relays…') : `Connecting to ${list[0].name}…`);
    const make = () => {
      const rel = new Relay({ onMessage: (m) => this._fromRelay(rel, m), onClose: () => { if (rel === this.relay) { this._setStatus('Disconnected from the relay'); this.role = null; this.onChange?.(); } } });
      return rel;
    };
    const tries = await Promise.all(list.map(async (b) => { const rel = make(); try { await rel.connect(password, b.id); return rel; } catch { rel.close(); return null; } }));
    const up = tries.filter(Boolean);
    if (!up.length) throw new Error('No relay reachable: check the connection and try again');
    if (role === 'host' && up.length > 1) {
      const ping = await Promise.all(up.map((rel) => this._time(rel)));
      const best = ping.indexOf(Math.min(...ping));
      this.relay = up[best]; this.relayPing = ping[best];
      up.forEach((rel, i) => { if (i !== best) rel.close(); });
    } else if (role === 'guest' && up.length > 1) { this._cands = up; this.relay = up[0]; }
    else { this.relay = up[0]; if (role === 'host') this.relayPing = await this._time(this.relay); }
  }

  /** median round trip (s) of three probes through a relay: we hear our own messages back */
  async _time(rel) {
    const got = [], tag = 'probe' + Math.random().toString(36).slice(2, 7);
    rel._probe = (m) => { if (m.f === tag) got.push(clock() - m.d.t0); };
    for (let i = 0; i < 3; i++) { rel.send({ f: tag, t: 'probe', d: { t0: clock() } }); await new Promise((r) => setTimeout(r, 120)); }
    await new Promise((r) => setTimeout(r, 900));
    rel._probe = null;
    got.sort((a, b) => a - b);
    return got.length ? got[got.length >> 1] : Infinity;
  }

  /** every relay message comes through here: probes, then (while a guest still listens on several relays) the host's answer picks one */
  _fromRelay(rel, m) {
    if (rel._probe) { rel._probe(m); return; }
    if (this._cands.length) {
      if (!['lobby', 'ver', 'full'].includes(m?.t) || m.f === this.id) return;
      this.relay = rel;                                                    // the host is here: keep this relay, drop the others
      for (const c of this._cands) if (c !== rel) c.close();
      this._cands = [];
    } else if (rel !== this.relay) return;
    this._onMessage(m);
  }

  leave(quiet = false) {
    if (this.relay) { this._send('bye', {}); this.relay.close(); }
    for (const c of this._cands || []) c.close();
    this._cands = [];
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
    if (!s || s.k === 'human') return;                   // a player sits there
    this.lobby.slots[i] = { k: slotKind(kind) };
    this.sendLobby();
  }

  /** host: race settings or car changed in the menu */
  refreshLobby() {
    if (!this.isHost) return;
    Object.assign(this.lobby, { map: this.app.mapId, preset: this.app.presetIndex, ...this._raceBits() });
    this.sendLobby();
  }

  sendLobby() { if (this.isHost) { this._send('lobby', this.lobby); this.onChange?.(); } }

  _send(t, d) { if (this._cands?.length) for (const c of this._cands) c.send({ f: this.id, t, d }); else this.relay?.send({ f: this.id, t, d }); }

  /** host: build the grid from the slots and start everyone */
  startRace() {
    if (!this.isHost) return;
    const grid = [];
    let bot = 0;
    this.lobby.slots.forEach((s, i) => {
      if (s.k === 'human') grid.push({ kind: 'human', id: s.id, name: s.name, color: HUMAN_COLORS[i % HUMAN_COLORS.length] });
      else if (s.k === 'bot') { grid.push({ kind: 'bot', key: `bot${i}`, name: `Bot ${++bot}`, color: '#' + BOT_COLORS[(bot - 1) % BOT_COLORS.length].toString(16).padStart(6, '0') }); }
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
      : g.kind === 'bot' ? (this.isHost ? { kind: 'bot', key: g.key, name: g.name, color: g.color } : { kind: 'remote', key: g.key, name: g.name, color: g.color })
        : { kind: 'remote', key: g.id, name: g.name, color: g.color, human: true }));
    if (!lineup.some((l) => l.kind === 'me')) { this._setStatus('The host started without you (no free slot)'); return; }
    this.remote.clear();
    const mine = msg.grid.find((g) => g.kind === 'human' && g.id === this.id);
    app.setCarTint(mine?.color);                                  // your own car wears the colour everyone else sees you in
    app.createRace({ laps: msg.laps, skill: msg.skill, lineup, online: true, hold: msg.hold });
    if (app.race && mine?.color) app.race.player.color = mine.color;
    app.menu.close();
    this._setStatus(this.isHost ? `Racing · ${this._count()}` : 'Racing');
  }

  _pendingMap(map) {
    try { sessionStorage.setItem('vehicleSim.autoJoin', JSON.stringify({ password: this.password, role: this.role, slots: this.lobby?.slots?.map((s) => (s.id === this.id ? 'you' : s.k === 'human' ? s.was || 'bot' : s.k)) })); } catch { /* ignore */ }
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
        if (d.build !== BUILD.number) { this._send('ver', { to: m.f, build: BUILD.number }); return; }   // a different game version: it would not see the bots right
        let slot = this.lobby.slots.find((s) => s.id === m.f);
        if (!slot) {
          const free = (k) => this.lobby.slots.flatMap((s, j) => (s.k === k ? [j] : []));
          const bots = free('bot'), i = bots.length ? pick(bots) : free('empty').length ? pick(free('empty')) : -1;
          if (i < 0) { this._send('full', { to: m.f }); return; }       // every slot is a player
          this.lobby.slots[i] = slot = { k: 'human', id: m.f, name: String(d.name || 'Player').slice(0, 16), was: this.lobby.slots[i].k };
        }
        this._setStatus(`Hosting · ${this._count()}`);
        this.sendLobby();
      } else if (m.t === 'bye') this._drop(m.f);
      else if (m.t === 'st') { this._track(m.f).add(d.ts ?? clock(), d, clock()); if (d.pg !== undefined) this._echo.set(m.f, [d.pg, clock()]); }   // a ping to answer
      else if (m.t === 'lobby' && m.f !== this.id) this._setStatus('Another host is using this password — pick a different one');
    } else if (this.role === 'guest') {
      if (m.t === 'lobby') {
        if (d.build !== BUILD.number) { if (this.status !== this._verMsg(d.build)) this._setStatus(this._verMsg(d.build)); return; }
        const first = !this.lobby, changed = JSON.stringify(d) !== this._lobbyJson;
        this._lobbyJson = JSON.stringify(d); this.lobby = d; this.hostId = m.f;
        const mine = d.slots.find((s) => s.id === this.id);
        if (!mine) { if (this.time - (this._lastJoin || -9) > 1.5) { this._lastJoin = this.time; this._send('join', { name: this.name, build: BUILD.number }); } this._setStatus('Asking the host for a slot…'); return; }
        if (d.map !== this.app.mapId) { this._pendingMap(d.map); return; }
        if (!this.app.race && d.preset !== this.app.presetIndex) this.app.loadPreset(d.preset, { quiet: true });
        if (first || (changed && this.status !== 'Racing')) this._setStatus(`Joined · waiting for the host to start · ${this._count()}`);
        else if (changed) this.onChange?.();
      } else if (m.t === 'ver' && d.to === this.id) { if (this.status !== this._verMsg(d.build)) this._setStatus(this._verMsg(d.build)); }
      else if (m.t === 'full' && d.to === this.id) this._setStatus('That match is full: every slot has a player');
      else if (m.t === 'start') this._begin(d);
      else if (m.t === 'end') { if (this.app.race?.online) { this.app.endRace(); this.app.hud.showToast('The host ended the race', 2000); } }
      else if (m.t === 'st') {
        const now = clock();
        this._track(m.f).add(d.ts ?? now, d, now);
        const pong = d.pong?.[this.id];                                   // our ping came back: round trip minus the time the host held it
        if (pong && m.f === this.hostId) { const rtt = Math.max(0, now - pong[0] - pong[1]); this.rtt = this.rtt ? this.rtt + (rtt - this.rtt) * 0.3 : rtt; }
        if (d.bots) for (const b of d.bots) this._track(b.key).add(d.ts ?? now, b, now);   // the host's bots travel with the host's car
      } else if (m.t === 'bye' && m.f === this.hostId) { this._setStatus('The host left'); if (this.app.race?.online) this.app.endRace(); }
    }
  }

  _track(key) { let t = this.remote.get(key); if (!t) this.remote.set(key, (t = new RemoteTrack(this))); return t; }

  _drop(id) {
    if (!this.isHost) return;
    const i = this.lobby.slots.findIndex((s) => s.id === id);
    if (i >= 0) { this.lobby.slots[i] = { k: this.lobby.slots[i].was || 'bot' }; this.sendLobby(); }   // the bot comes back
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
      if (this._joinAcc > 1.2) { this._joinAcc = 0; this._send(this.lobby ? 'hb' : 'join', this.lobby ? {} : { name: this.name, build: BUILD.number }); }   // presence, or knock until the host answers
      if (this.hostId && this.time - (this.seen.get(this.hostId) ?? this.time) > TIMEOUT) { this._setStatus('Lost the host'); this.hostId = null; if (race) this.app.endRace(); }
    }
    if (!race) return;
    this._acc += dt;
    const hz = this.rate;
    if (this._acc >= 1 / hz) {
      this._acc = Math.min(this._acc - 1 / hz, 0.5 / hz);               // keep the beat even (bursts are what the relay drops)
      const now = clock(), st = { ts: r3(now), ...this._pack(this.app.vehicle) };
      if (this.isHost && race.bots.length) st.bots = race.bots.map((b) => ({ key: b.key, ...this._pack(b.vehicle) }));
      // pings ride in the state messages (no extra messages): a guest stamps one every couple of seconds and sends its round
      // trip so others can tell how far behind its car is; the host echoes each stamp with how long it held it
      if (!this.isHost) { st.rt = r3(this.rtt); if (now - (this._pingAt || 0) > PING_EVERY) { this._pingAt = now; st.pg = r3(now); } }
      else if (this._echo.size) { st.pong = {}; for (const [id, [ts, at]] of this._echo) st.pong[id] = [ts, r3(now - at)]; this._echo.clear(); }
      this.relay?.send({ f: this.id, t: 'st', d: st }, true);              // droppable: skipped rather than over the relay's limit
    }
    race.applyRemote(this.remote, clock(), dt);
  }

  _pack(v) {
    const b = v.body, p = b.position, q = b.orientation, vel = b.velocity;
    return { p: [r3(p.x), r3(p.y), r3(p.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], v: [r3(vel.x), r3(vel.y), r3(vel.z)],
      s: r3(v.wheels[0].steer), rpm: Math.round(v.drivetrain.engine.rpm), th: r3(v.input.throttle), br: r3(v.input.brake) };
  }
}

/** the car list for the Create Race slot pickers */
export const presetName = (i) => PRESETS[i]?.name ?? '';
