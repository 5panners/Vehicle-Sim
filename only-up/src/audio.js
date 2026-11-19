// Procedural audio: wind, generative ambient pads per theme, footsteps and one-shots (no asset files).
import { THEMES } from './themes.js';

export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.lastStep = 0; this.level = -1; this.nextNote = 0; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = C.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(C.destination);
    // reverb
    const len = C.sampleRate * 3.2, ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = C.createConvolver(); this.verb.buffer = ir;
    this.verbGain = C.createGain(); this.verbGain.gain.value = 0.55; this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.music = C.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master); this.music.connect(this.verb);
    // wind
    const nb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.wind = C.createBufferSource(); this.wind.buffer = nb; this.wind.loop = true;
    this.windF = C.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.6;
    this.windG = C.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master); this.wind.start();
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }
  note(freq, dur, vol, type = 'sine') {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain(), t = C.currentTime;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.1);
  }
  update(dt, y, fallSpeed, level) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime;
    const alt = Math.min(1, y / 700), fs = Math.min(1, Math.abs(Math.min(0, fallSpeed)) / 40);
    this.windG.gain.setTargetAtTime(0.03 + alt * 0.1 + fs * 0.35, t, 0.2);
    this.windF.frequency.setTargetAtTime(350 + alt * 500 + fs * 1800, t, 0.2);
    // generative music
    if (t > this.nextNote) {
      const th = THEMES[level], sc = th.scale, base = th.root;
      const deg = sc[(Math.random() * sc.length) | 0], oct = Math.random() < 0.3 ? 2 : 1;
      this.note(base * oct * Math.pow(2, deg / 12), 5 + Math.random() * 3, 0.18, level === 4 || level === 6 ? 'triangle' : 'sine');
      if (Math.random() < 0.5) this.note(base * 0.5 * Math.pow(2, sc[(Math.random() * sc.length) | 0] / 12), 7, 0.13, 'sine');
      this.nextNote = t + 1.6 + Math.random() * 2.4;
    }
  }
  blip(f0, f1, dur, vol, type = 'sine') {
    if (!this.ctx) return;
    const C = this.ctx, o = C.createOscillator(), g = C.createGain(), t = C.currentTime;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(dur, vol, freq) {
    if (!this.ctx) return;
    const C = this.ctx, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain(), t = C.currentTime;
    s.buffer = this.noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  footstep(sprint) { const n = performance.now(); if (n - this.lastStep < (sprint ? 230 : 320)) return; this.lastStep = n; this.burst(0.07, 0.16, 500 + Math.random() * 400); }
  jump() { this.blip(260, 520, 0.14, 0.12, 'triangle'); }
  land(k) { this.burst(0.14, 0.12 + k * 0.4, 180); }
  pad() { this.blip(180, 900, 0.45, 0.2, 'sawtooth'); this.burst(0.4, 0.15, 1400); }
  checkpoint() { [0, 4, 7, 12].forEach((s, i) => setTimeout(() => this.blip(523 * Math.pow(2, s / 12), 523 * Math.pow(2, s / 12), 0.6, 0.12), i * 90)); }
  respawn() { this.blip(600, 120, 0.5, 0.15, 'sine'); }
  chat() { this.blip(880, 1320, 0.1, 0.07, 'sine'); }
}
