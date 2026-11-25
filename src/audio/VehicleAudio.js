// Procedural WebAudio. A shared mixer (volumes saved in the browser) plus a complete sound model per car:
//   engine (firing-frequency oscillators + intake noise, turbo whine), tyre squeal, loose-surface rumble,
//   kerb rumble, wall scrape, wind (own car only), and one-shot impacts (landings, bumps, wall and car hits).
// The player's car plays straight to the speakers; every opponent is its own voice, placed in space:
// volume falls with distance, stereo pan follows its bearing, high frequencies roll off, and the pitch
// shifts with the closing speed (Doppler).

export const AUDIO_DEFAULTS = {
  master: 0.5, engine: 1, tyres: 1, impacts: 1, wind: 1, opponents: 1,
  spatial: true, doppler: true, muted: false,
};
const KEY = 'vehicleSim.audio';
const SPEED_OF_SOUND = 343;

export class VehicleAudio {
  constructor() {
    this.ctx = null; this.paused = false; this.voices = new Map();
    this.settings = { ...AUDIO_DEFAULTS };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
    this.player = null;
  }
  get muted() { return this.settings.muted; }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ } }
  /** change a setting (volume 0..1.5 or a boolean) and apply it at once */
  set(key, value) { this.settings[key] = value; this.save(); this._applyMaster(); }
  resetSettings() { Object.assign(this.settings, AUDIO_DEFAULTS); this.save(); this._applyMaster(); }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.carBus = ctx.createGain(); this.carBus.connect(this.master);                  // everything the cars make (muted while paused)
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.shaperCurve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; this.shaperCurve[i] = Math.tanh(x * 2.5); }
    this._applyMaster();
    this.player = new CarVoice(this, null, { spatial: false });
  }

  _applyMaster() {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.03);
  }
  toggleMute() { this.set('muted', !this.settings.muted); return this.settings.muted; }
  /** the game is paused (menu open): the cars fall silent, previews still play */
  setPaused(p) {
    if (!this.ctx || p === this.paused) return; this.paused = p;
    this.carBus.gain.setTargetAtTime(p ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  noise(voiceOut) {                                                                      // a looping noise source at a random offset
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(0, Math.random() * 1.8); return s;
  }

  // ---- the player's car (the API main.js already uses)
  get scrape() { return this.player?.scrape || 0; }
  set scrape(v) { if (this.player) this.player.scrape = v; }
  thump(strength) { this.player?.hit(strength); }
  /** the close-up voice: your car, or (foreign) the car the Follow camera watches, whose hits come from the physics step */
  update(vehicle, foreign = false) {
    if (!this.player) return;
    if (this.player.foreign !== foreign || this.player.vehicle !== vehicle) { this.player.scrape = 0; this.player.prevImpact = vehicle.telemetry?.impact ?? 0; }
    this.player.foreign = foreign; this.player.vehicle = vehicle;
    this.player.update(vehicle, null);
  }

  /** an opponent's voice (created on first use, once the audio context exists) */
  voiceFor(key, vehicle, index = 0) {
    if (!this.ctx) return null;
    let v = this.voices.get(key);
    if (!v) { v = new CarVoice(this, vehicle, { spatial: true, index }); this.voices.set(key, v); }
    return v;
  }
  dropVoice(key) { const v = this.voices.get(key); if (v) { v.dispose(); this.voices.delete(key); } }
  dropAll() { for (const v of this.voices.values()) v.dispose(); this.voices.clear(); }

  /**
   * Update every opponent voice. listener = the player's vehicle; entries = [{ key, vehicle, index }].
   * Hits recorded on vehicle.audioHit by the physics step are played here.
   */
  updateOthers(listener, entries) {
    if (!this.ctx) return;
    const lp = listener.body.position, lv = listener.body.velocity;
    const fwd = listener.body.localDir({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }), rx = fwd.z, rz = -fwd.x;   // listener's right-hand direction
    const live = new Set();
    for (const { key, vehicle, index } of entries) {
      const v = this.voiceFor(key, vehicle, index); if (!v) continue;
      live.add(key);
      const dx = vehicle.body.position.x - lp.x, dy = vehicle.body.position.y - lp.y, dz = vehicle.body.position.z - lp.z;
      const dist = Math.hypot(dx, dy, dz) || 0.01, nx = dx / dist, ny = dy / dist, nz = dz / dist;
      const vel = vehicle.body.velocity, radial = (vel.x - lv.x) * nx + (vel.y - lv.y) * ny + (vel.z - lv.z) * nz;   // + = moving apart
      const s = this.settings;
      v.update(vehicle, {
        dist,
        gain: s.spatial ? 1 / (1 + Math.pow(dist / 11, 1.45)) : 0.5,
        pan: s.spatial ? Math.max(-1, Math.min(1, (nx * rx + nz * rz) * 1.15)) : 0,
        lowpass: s.spatial ? Math.max(1800, 17000 / (1 + dist / 28)) : 17000,
        doppler: s.doppler && s.spatial ? SPEED_OF_SOUND / (SPEED_OF_SOUND + Math.max(-90, Math.min(90, radial))) : 1,
      });
    }
    // a car left out this frame (the one now heard up close, or your own car once the camera is back on it) falls silent
    for (const [key, v] of this.voices) if (!live.has(key) && v.out.gain.value > 0.0005) v.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
  }

  /** one-shot preview of a sound for the Audio tab */
  preview(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = this.settings, out = this.master;
    if (kind === 'impact') this.player?.hit(0.9, true);
    else if (kind === 'squeal') {
      const n = this.noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.Q.value = 12; f.frequency.value = 1000;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 * s.tyres, t + 0.08); g.gain.linearRampToValueAtTime(0.0001, t + 0.9);
      n.connect(f).connect(g).connect(out); n.stop(t + 1);
    } else if (kind === 'engine') {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), sh = ctx.createWaveShaper();
      sh.curve = this.shaperCurve; o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.Q.value = 2;
      o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(380, t + 1.4); o2.frequency.setValueAtTime(35, t); o2.frequency.exponentialRampToValueAtTime(190, t + 1.4);
      f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(2800, t + 1.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2 * s.engine, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 1.6);
      o.connect(sh); o2.connect(sh); sh.connect(f).connect(g).connect(out); o.start(t); o2.start(t); o.stop(t + 1.7); o2.stop(t + 1.7);
    }
  }
}

/** one car's complete sound model */
class CarVoice {
  constructor(mixer, vehicle, { spatial = false, index = 0 } = {}) {
    this.m = mixer; this.spatial = spatial; this.scrape = 0; this.prevImpact = 0; this.prevHit = 0;
    this.detune = spatial ? 1 + ((index % 7) - 3) * 0.012 : 1;                              // each opponent a touch different in pitch
    const ctx = mixer.ctx; this.noises = [];
    const noise = () => { const n = mixer.noise(); this.noises.push(n); return n; };
    this.out = ctx.createGain(); this.out.gain.value = spatial ? 0 : 1;
    this.lp = null; this.pan = null; let node = this.out;
    if (spatial) {
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 17000;
      this.pan = ctx.createStereoPanner(); node.connect(this.lp).connect(this.pan).connect(mixer.carBus);
    } else node.connect(mixer.carBus);
    const make = (gain = 0) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(this.out); return g; };

    // engine
    this.engGain = make(); this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper(); shaper.curve = mixer.shaperCurve;
    this.osc = ['sawtooth', 'square', 'triangle'].map((type) => { const o = ctx.createOscillator(); o.type = type; return o; });
    [0.5, 0.25, 0.6].forEach((gv, i) => { const g = ctx.createGain(); g.gain.value = gv; this.osc[i].connect(g).connect(shaper); this.osc[i].start(); });
    shaper.connect(this.engFilter).connect(this.engGain);
    this.intakeGain = make(); this.intakeFilter = ctx.createBiquadFilter(); this.intakeFilter.type = 'bandpass'; this.intakeFilter.Q.value = 1.5;
    noise().connect(this.intakeFilter).connect(this.intakeGain);
    // turbo whistle (only for boosted cars)
    this.turbo = (vehicle?.config.engine.turbo?.maxBoost || 0) > 0;
    if (this.turbo) { this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whineGain = make(); this.whine.connect(this.whineGain); this.whine.start(); }
    // tyres: squeal, loose surface; kerb rumble (a low rumble pulsed at the rate the kerb blocks go by)
    this.squealGain = make(); this.squealFilter = ctx.createBiquadFilter(); this.squealFilter.type = 'bandpass'; this.squealFilter.Q.value = 12; this.squealFilter.frequency.value = 950;
    noise().connect(this.squealFilter).connect(this.squealGain);
    this.looseGain = make(); const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 500; noise().connect(lf).connect(this.looseGain);
    this.kerbGain = make(); const kf = ctx.createBiquadFilter(); kf.type = 'lowpass'; kf.frequency.value = 260;
    const kmod = ctx.createGain(); kmod.gain.value = 0.5; this.kerbLfo = ctx.createOscillator(); this.kerbLfo.type = 'square'; this.kerbLfo.frequency.value = 12;
    const kd = ctx.createGain(); kd.gain.value = 0.5; this.kerbLfo.connect(kd).connect(kmod.gain); this.kerbLfo.start();
    noise().connect(kf).connect(kmod).connect(this.kerbGain);
    // metal / concrete scrape and wind
    this.scrapeGain = make(); this.scrapeFilter = ctx.createBiquadFilter(); this.scrapeFilter.type = 'bandpass'; this.scrapeFilter.Q.value = 3; this.scrapeFilter.frequency.value = 2200;
    noise().connect(this.scrapeFilter).connect(this.scrapeGain);
    if (!spatial) { this.windGain = make(); const wf = ctx.createBiquadFilter(); wf.type = 'highpass'; wf.frequency.value = 400; noise().connect(wf).connect(this.windGain); }
    this.fx = make(1);                                                                        // one-shot sounds go through here
  }

  /** a one-shot impact: a low thump, plus a metallic crunch when it is a hard hit */
  hit(strength, force = false) {
    const m = this.m, ctx = m.ctx; if (!ctx || (m.settings.muted && !force)) return;
    const vol = m.settings.impacts * (this.spatial ? m.settings.opponents : 1), t = ctx.currentTime, st = Math.min(1, strength);
    const dest = force && !this.spatial ? m.master : this.fx;
    // a heavy body thump: a low sine and its octave (so it is heard on laptop speakers too) falling in pitch
    const amp = Math.max(0.0001, Math.min(0.8, st) * vol);
    for (const [f0, f1, a, len] of [[78, 38, 1, 0.42], [150, 70, 0.55, 0.3]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp * a, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(dest); o.start(t); o.stop(t + len + 0.05);
    }
    // the 'whump' of panels: low-passed noise, darker the softer the hit
    const n = m.noise(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.8; lp.frequency.setValueAtTime(500 + 700 * st, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.25);
    ng.gain.setValueAtTime(Math.min(0.6, st * 0.7) * vol, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(lp).connect(ng).connect(dest); n.stop(t + 0.34);
    if (st > 0.35) {                                                                          // a little crunch on big hits, kept low-mid (no tin)
      const c = m.noise(), f = ctx.createBiquadFilter(), cg = ctx.createGain(); f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(320, t + 0.18);
      cg.gain.setValueAtTime(Math.min(0.25, (st - 0.35) * 0.4) * vol, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      c.connect(f).connect(cg).connect(dest); c.stop(t + 0.24);
    }
  }

  /** sp = spatial info for an opponent ({ gain, pan, lowpass, doppler }), null for the player's own car */
  update(vehicle, sp) {
    const m = this.m, ctx = m.ctx; if (!ctx) return;
    const t = ctx.currentTime, k = 0.05, S = m.settings;
    const vol = sp ? S.opponents * sp.gain : 1;
    if (sp) {
      this.out.gain.setTargetAtTime(vol, t, 0.05); this.pan.pan.setTargetAtTime(sp.pan, t, 0.05); this.lp.frequency.setTargetAtTime(sp.lowpass, t, 0.08);
      if (vol < 0.004) { this._silent = true; this._drainHits(vehicle); return; }                  // too far to hear: skip the details
    }
    this._silent = false;
    const dop = (sp ? sp.doppler : 1) * this.detune;
    const e = vehicle.drivetrain.engine, cyl = vehicle.config.engine.cylinders || 4, rpm = e.rpm, load = Math.max(0, e.effectiveThrottle ?? 0);
    const fire = (rpm / 60) * (cyl / 2) * dop, red = vehicle.config.engine.redlineRPM;
    this.osc[0].frequency.setTargetAtTime(fire, t, k); this.osc[1].frequency.setTargetAtTime(fire * 0.5, t, k); this.osc[2].frequency.setTargetAtTime(fire * 0.25, t, k);
    this.engFilter.frequency.setTargetAtTime(250 + rpm * 0.25 + load * 1800, t, k);
    this.engGain.gain.setTargetAtTime((0.10 + load * 0.16) * S.engine * (sp ? 0.85 : 1), t, k);
    this.intakeFilter.frequency.setTargetAtTime((400 + rpm * 0.4) * dop, t, k);
    this.intakeGain.gain.setTargetAtTime(load * 0.05 * (rpm / red) * S.engine, t, k);
    if (this.turbo) { this.whine.frequency.setTargetAtTime((1400 + rpm * 0.95) * dop, t, k); this.whineGain.gain.setTargetAtTime(load * 0.014 * Math.min(1, rpm / (red * 0.6)) * S.engine, t, 0.08); }

    // tyres and surfaces
    let squeal = 0, loose = 0, kerb = 0;
    for (const w of vehicle.wheels) {
      if (!w.contact || !w.surface) continue;
      if (w.surface.smoke) squeal = Math.max(squeal, Math.min(1, Math.max(0, w.tire.normSlip - 0.85) * 1.2) * Math.min(1, w.Fz / Math.max(300, w.staticLoad * 0.9)));   // loaded relative to the car's own weight, so a kart squeals like a coupe
      if (w.surface.dust) loose = Math.max(loose, Math.min(1, Math.abs(w.vx) / 25));
      if (w.surface.name === 'Kerb') kerb = 1;
    }
    this.squealGain.gain.setTargetAtTime(squeal * 0.6 * S.tyres, t, 0.03);
    this.squealFilter.frequency.setTargetAtTime((800 + squeal * 400) * dop, t, 0.05);
    this.looseGain.gain.setTargetAtTime(loose * 0.25 * S.tyres, t, 0.05);
    const sp2 = vehicle.speed;
    this.kerbGain.gain.setTargetAtTime(kerb * Math.min(1, sp2 / 25) * 0.55 * S.tyres, t, 0.03);
    this.kerbLfo.frequency.setTargetAtTime(Math.max(5, Math.min(48, sp2 * 1.5)), t, 0.1);

    // walls: continuous scrape and the hit itself
    let sc = this.scrape || 0; this.scrape = 0;
    if (sp || this.foreign) { sc = Math.max(sc, vehicle.audioScrape || 0); vehicle.audioScrape = 0; }
    this.scrapeGain.gain.setTargetAtTime(Math.min(0.35, sc * 0.02) * S.impacts, t, 0.03);
    this.scrapeFilter.frequency.setTargetAtTime((1600 + sc * 60) * dop, t, 0.05);
    if (this.windGain) this.windGain.gain.setTargetAtTime(Math.min(0.12, sp2 * sp2 * 0.000025) * S.wind, t, 0.1);
    this._drainHits(vehicle);
    // landings and big bumps
    const imp = vehicle.telemetry.impact;
    if (imp > 0.4 && this.prevImpact <= 0.4) this.hit(imp * 0.6);
    this.prevImpact = imp;
  }

  /** hits queued by the physics step (wall and car-to-car contacts) */
  _drainHits(vehicle) {
    if (!this.spatial && !this.foreign) return;                 // your own car's hits are played by main.js (thump)
    const h = vehicle.audioHit || 0; vehicle.audioHit = 0;
    if (h > 0.25) this.hit(h);
  }

  dispose() {
    const stop = (n) => { try { n.stop?.(); } catch { /* already stopped */ } };
    this.osc.forEach(stop); this.noises.forEach(stop); stop(this.kerbLfo); if (this.whine) stop(this.whine);
    try { this.out.disconnect(); } catch { /* ignore */ }
  }
}
