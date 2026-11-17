/**
 * Lap timing against the world's track spline. Progress is tracked as signed movement
 * along the centreline, so a lap only counts if you actually drove (most of) it,
 * forwards. Three equal sectors. Leaving the circuit by > maxOff metres invalidates
 * the lap in progress (cuts).
 */
export class LapTimer {
  constructor(world, { maxOff = 45 } = {}) {
    this.world = world; this.M = world.trackLength; this.maxOff = maxOff;
    this.best = null; this.bestSectors = [null, null, null];
    this.reset();
  }

  reset() {
    this.idx = -1; this.progress = 0; this.lapTime = 0; this.running = false; this.valid = true;
    this.sector = 0; this.sectorStart = 0; this.sectors = [null, null, null]; this.last = null; this.lap = 0;
    this.lastSectorDelta = null;
  }

  _nearest(x, z) {
    const T = this.world.track, M = this.M;
    const scan = (from, n, step) => {
      let bi = -1, bd = Infinity;
      for (let k = 0; k < n; k += step) { const i = (from + k + M) % M, s = T[i], d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
      return [bi, Math.sqrt(bd)];
    };
    if (this.idx >= 0) { const [i, d] = scan(this.idx - 60, 121, 1); if (d < 30) return [i, d]; }
    const [g] = scan(0, M, 4); return scan(g - 6, 13, 1); // global relocate
  }

  /** returns an event string when something notable happens ('lap', 'sector', 'start', 'invalid') */
  update(dt, x, z) {
    const M = this.M, [i, off] = this._nearest(x, z);
    let event = null;
    if (this.running) this.lapTime += dt;
    if (this.idx < 0) { this.idx = i; return null; }
    let delta = i - this.idx;
    const crossed = delta < -M / 2;                // wrapped forwards past index 0 (the line)
    if (delta > M / 2) delta -= M; else if (delta < -M / 2) delta += M;
    this.idx = i;
    this.progress += delta;
    if (off > this.maxOff && this.running && this.valid) { this.valid = false; event = 'invalid'; }

    if (crossed) {
      if (this.running && this.progress > 0.9 * M) {
        this._sectorDone(2);
        this.last = { time: this.lapTime, valid: this.valid };
        if (this.valid && (this.best === null || this.lapTime < this.best)) { this.best = this.lapTime; this.last.best = true; }
        event = 'lap';
      } else if (!this.running) event = 'start';
      this.running = true; this.lapTime = 0; this.progress = 0; this.valid = true;
      this.sector = 0; this.sectorStart = 0; this.sectors = [null, null, null]; this.lap++;
    } else if (this.running && this.sector < 2 && this.progress > ((this.sector + 1) * M) / 3) {
      this._sectorDone(this.sector); this.sector++; event = event || 'sector';
    }
    return event;
  }

  _sectorDone(k) {
    const t = this.lapTime - this.sectorStart;
    this.sectors[k] = t; this.sectorStart = this.lapTime;
    const b = this.bestSectors[k];
    this.lastSectorDelta = b === null ? null : t - b;
    if (this.valid && (b === null || t < b)) this.bestSectors[k] = t;
  }

  static fmt(t) {
    if (t === null || t === undefined) return '--:--.---';
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  }
}
