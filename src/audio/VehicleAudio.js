// Procedural WebAudio sound: engine (firing-frequency oscillators + filtered
// noise), tyre squeal, loose-surface rumble, wind and landing thumps.
export class VehicleAudio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };

    // engine
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'triangle';
    const g1 = ctx.createGain(); g1.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.25; const g3 = ctx.createGain(); g3.gain.value = 0.6;
    this.osc1.connect(g1).connect(shaper); this.osc2.connect(g2).connect(shaper); this.osc3.connect(g3).connect(shaper);
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.osc1.start(); this.osc2.start(); this.osc3.start();
    // intake / combustion noise
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    this.intakeFilter = ctx.createBiquadFilter(); this.intakeFilter.type = 'bandpass'; this.intakeFilter.Q.value = 1.5;
    noise().connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
    // tyre squeal
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    this.squealFilter = ctx.createBiquadFilter(); this.squealFilter.type = 'bandpass'; this.squealFilter.Q.value = 12; this.squealFilter.frequency.value = 950;
    noise().connect(this.squealFilter).connect(this.squealGain).connect(this.master);
    // gravel / loose surface rumble
    this.looseGain = ctx.createGain(); this.looseGain.gain.value = 0;
    const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 500;
    noise().connect(lf).connect(this.looseGain).connect(this.master);
    // metal/concrete scrape (driven by wall contact)
    this.scrapeGain = ctx.createGain(); this.scrapeGain.gain.value = 0;
    this.scrapeFilter = ctx.createBiquadFilter(); this.scrapeFilter.type = 'bandpass'; this.scrapeFilter.Q.value = 3; this.scrapeFilter.frequency.value = 2200;
    noise().connect(this.scrapeFilter).connect(this.scrapeGain).connect(this.master);
    // wind
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'highpass'; wf.frequency.value = 400;
    noise().connect(wf).connect(this.windGain).connect(this.master);
  }

  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; }

  thump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(90, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(Math.min(0.8, strength), ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g).connect(this.master); o.start(); o.stop(ctx.currentTime + 0.35);
  }

  update(vehicle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.05;
    const e = vehicle.drivetrain.engine, cyl = vehicle.config.engine.cylinders || 4;
    const rpm = e.rpm, thr = e.effectiveThrottle ?? 0;
    const fire = (rpm / 60) * (cyl / 2);
    this.osc1.frequency.setTargetAtTime(fire, t, k);
    this.osc2.frequency.setTargetAtTime(fire * 0.5, t, k);
    this.osc3.frequency.setTargetAtTime(fire * 0.25, t, k);
    const load = Math.max(0, thr);
    this.engFilter.frequency.setTargetAtTime(250 + rpm * 0.25 + load * 1800, t, k);
    this.engGain.gain.setTargetAtTime(0.10 + load * 0.16, t, k);
    this.intakeFilter.frequency.setTargetAtTime(400 + rpm * 0.4, t, k);
    this.intakeGain.gain.setTargetAtTime(load * 0.05 * (rpm / vehicle.config.engine.redlineRPM), t, k);

    let squeal = 0, loose = 0;
    for (const w of vehicle.wheels) {
      if (!w.contact || !w.surface) continue;
      if (w.surface.smoke) squeal = Math.max(squeal, Math.min(1, Math.max(0, w.tire.normSlip - 0.9) * 0.8) * Math.min(1, w.Fz / 3000));
      if (w.surface.dust) loose = Math.max(loose, Math.min(1, Math.abs(w.vx) / 25));
    }
    this.squealGain.gain.setTargetAtTime(squeal * 0.18, t, 0.03);
    this.squealFilter.frequency.setTargetAtTime(800 + squeal * 400, t, 0.05);
    this.looseGain.gain.setTargetAtTime(loose * 0.25, t, 0.05);
    const sc = this.scrape || 0; this.scrape = 0;
    this.scrapeGain.gain.setTargetAtTime(Math.min(0.35, sc * 0.02), t, 0.03);
    this.scrapeFilter.frequency.setTargetAtTime(1600 + sc * 60, t, 0.05);
    const sp = vehicle.speed;
    this.windGain.gain.setTargetAtTime(Math.min(0.12, sp * sp * 0.000025), t, 0.1);
  }
}
