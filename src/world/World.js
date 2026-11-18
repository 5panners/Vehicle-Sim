import { Vec3, clamp, smoothstep, lerp } from '../physics/math.js';
import { SURFACES, SURF } from './Surfaces.js';
import { valueNoise, fbm } from './noise.js';
import TEST_MAP from './maps/test.js';

// Back-compat re-exports (the test map's layout constants used to live here)
export { fbm };
export { STRIPS, START_PAD, SKIDPAD, JUMP_PARK, TRACK_WIDTH } from './maps/test.js';

// derived geometry for an analytic prop (orientation, extents, bounding radius)
function prepProp(p) {
  p.cos = Math.cos(p.yaw); p.sin = Math.sin(p.yaw);
  const len = p.type === 'table' ? p.up + p.top + p.down : p.length;
  p.halfLen = len / 2; p.halfW = p.width / 2;
  p.radius = Math.hypot(p.halfLen, p.halfW) + 1;
}

// height of a prop at local (u along, w across); returns -Infinity when outside
function propHeight(p, u, w) {
  if (Math.abs(u) > p.halfLen || Math.abs(w) > p.halfW) return -Infinity;
  const t = (u + p.halfLen) / (p.halfLen * 2); // 0..1 along
  // soften the side edges so wheel rays climbing a side don't snap
  const side = smoothstep(p.halfW, p.halfW - 0.6, Math.abs(w));
  switch (p.type) {
    case 'kicker': return p.height * Math.pow(t, 1.6) * side;           // curved lip
    case 'landing': { // short steep lead-in (so undershooting isn't a wall), then long descending landing
      const d = u + p.halfLen, lead = p.lead ?? Math.max(3, p.height * 2), tt = clamp((d - lead) / (p.halfLen * 2 - lead), 0, 1);
      return p.height * (d < lead ? smoothstep(0, lead, d) : Math.pow(1 - tt, 1.25)) * side;
    }
    case 'bump': return p.height * Math.sin(t * Math.PI) * side;
    case 'rollers': return p.height * 0.5 * (1 - Math.cos((u + p.halfLen) / p.wavelength * Math.PI * 2)) * side;
    case 'sideslope': return p.height * ((w + p.halfW) / p.width) * smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t);
    case 'table': {
      const d = u + p.halfLen;
      let h;
      if (d < p.up) h = smoothstep(0, 1, d / p.up) * p.height;
      else if (d < p.up + p.top) h = p.height;
      else h = smoothstep(1, 0, (d - p.up - p.top) / p.down) * p.height;
      return h * side;
    }
  }
  return -Infinity;
}

// ---------------------------------------------------------------- world
/**
 * Generic world: a closed circuit spline, a 1 m heightfield + surface grid, analytic
 * props (ramps), and wall slabs. Everything specific to a location comes from a map
 * definition (see src/world/maps/test.js for the full set of hooks).
 */
export class World {
  constructor(map = TEST_MAP) {
    this.map = map;
    this.size = map.size ?? 1400;   // metres, centred on origin
    this.res = 1.0;                 // metres per cell
    this.n = Math.round(this.size / this.res) + 1;
    this.half = this.size / 2;
    this.trackWidth = map.trackWidth ?? 12;
    this.props = map.props ? map.props(this) : [];
    for (const p of this.props) prepProp(p);
    this._buildTrack();
    map.prepare?.(this);            // e.g. precompute terrain that follows the track
    this._buildGrid();
    this.walls = [];
    this._wallGrid = new Map();
    this._wallStamp = 0;
    map.walls?.(this);
  }

  nearestSample(x, z) {
    let bi = 0, bd = Infinity;
    this.track.forEach((s, i) => { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  // ---------------------------------------------------------------- walls
  /**
   * Add a wall along a polyline [[x, z], ...]. Walls are vertical slabs whose base
   * follows the terrain. side: which side faces traffic (+1 = left of a->b, -1 = right,
   * 0 = both); only used for rendering details.
   */
  addWall(points, { height = 1.0, thickness = 0.6, style = 'concrete', fence = false } = {}) {
    const list = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const base = Math.min(this.heightAt(ax, az, false), this.heightAt(bx, bz, false));
      const w = { ax, az, bx, bz, dx, dz, len, base, top: base + height, height, t: thickness, style, fence, id: this.walls.length };
      this.walls.push(w); list.push(w);
      // insert into the spatial grid
      const C = 10, pad = thickness + 0.5;
      const x0 = Math.floor((Math.min(ax, bx) - pad) / C), x1 = Math.floor((Math.max(ax, bx) + pad) / C);
      const z0 = Math.floor((Math.min(az, bz) - pad) / C), z1 = Math.floor((Math.max(az, bz) + pad) / C);
      for (let i2 = x0; i2 <= x1; i2++) for (let j = z0; j <= z1; j++) {
        const k = i2 * 100003 + j; let cell = this._wallGrid.get(k);
        if (!cell) this._wallGrid.set(k, (cell = []));
        cell.push(w);
      }
    }
    return list;
  }

  /** Walls whose slab may lie within r of (x, z). Fills and returns `out`. */
  wallsNear(x, z, r, out = []) {
    out.length = 0;
    if (!this.walls.length) return out;
    const C = 10, stamp = ++this._wallStamp;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cell = this._wallGrid.get(i * 100003 + j); if (!cell) continue;
      for (const w of cell) if (w._stamp !== stamp) { w._stamp = stamp; out.push(w); }
    }
    return out;
  }

  /**
   * Point vs wall slab. Returns penetration depth (> 0 when inside) and fills
   * out.nx/out.nz with the horizontal push-out normal.
   */
  static wallPenetration(w, x, y, z, out) {
    if (y > w.top || y < w.base - 0.5) return 0;
    let t = ((x - w.ax) * w.dx + (z - w.az) * w.dz) / (w.len * w.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = w.ax + w.dx * t, cz = w.az + w.dz * t;
    let ex = x - cx, ez = z - cz;
    const d = Math.hypot(ex, ez), half = w.t / 2;
    if (d >= half) return 0;
    if (d < 1e-6) { ex = -w.dz; ez = w.dx; } // on the centre line: use the segment normal
    const l = Math.hypot(ex, ez); out.nx = ex / l; out.nz = ez / l;
    return half - d;
  }

  // ---------- track spline (closed centripetal-ish Catmull-Rom)
  _buildTrack() {
    const pts = this.map.trackPoints, N = pts.length, W0 = this.trackWidth;
    const cr = (p0, p1, p2, p3, t) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    const dense = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N], b = pts[i], c = pts[(i + 1) % N], d = pts[(i + 2) % N];
      for (let s = 0; s < 200; s++) {
        const t = s / 200;
        dense.push([cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t), cr(a[2], b[2], c[2], d[2], t), cr(a[3], b[3], c[3], d[3], t),
          cr(a[4] ?? W0, b[4] ?? W0, c[4] ?? W0, d[4] ?? W0, t)]);
      }
    }
    // resample to ~1 m spacing
    const samples = [];
    let acc = 0;
    samples.push(dense[0]);
    for (let i = 1; i <= dense.length; i++) {
      const p = dense[i % dense.length], q = dense[i - 1];
      acc += Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (acc >= 1) { samples.push(p); acc = 0; }
    }
    const M = samples.length;
    this.track = samples.map((s, i) => {
      const nx = samples[(i + 1) % M], pv = samples[(i - 1 + M) % M];
      let tx = nx[0] - pv[0], tz = nx[1] - pv[1];
      const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      return { x: s[0], z: s[1], y: s[2], bank: s[3] * Math.PI / 180, w: s[4], tx, tz, rx: -tz, rz: tx, curv: 0, kerb: true, i };
    });
    // signed curvature (+ = turning right)
    for (let i = 0; i < M; i++) {
      const a = this.track[(i - 6 + M) % M], b = this.track[(i + 6) % M];
      const cross = a.tx * b.tz - a.tz * b.tx;
      this.track[i].curv = cross / 12;
    }
    this.trackLength = M;
    // smooth curvature
    const c2 = this.track.map((_, i) => { let s = 0; for (let k = -10; k <= 10; k++) s += this.track[(i + k + M) % M].curv; return s / 21; });
    this.track.forEach((t, i) => (t.curv = c2[i]));
    // longitudinal gradient (dy per metre along) so the heightfield can interpolate along the
    // slope between samples instead of stepping (matters on hilly circuits)
    this.track.forEach((t, i) => {
      const a = this.track[(i - 1 + M) % M], b = this.track[(i + 1) % M];
      t.dy = (b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
    });
    this.maxHalfWidth = Math.max(...this.track.map((t) => t.w)) / 2;
    // kerbs: everywhere ('full') or only through corners, extended a little either side
    if (this.map.kerbs === 'corners') {
      const thr = this.map.kerbCurvature ?? 0.0045, ext = 12;
      const inCorner = this.track.map((t) => Math.abs(t.curv) > thr);
      this.track.forEach((t, i) => { let k = false; for (let d = -ext; d <= ext && !k; d += 3) k = inCorner[(i + d + M) % M]; t.kerb = k; });
    }
  }

  /** base (natural) terrain height before track/zone blending */
  terrainHeight(x, z) { return this.map.terrain ? this.map.terrain(x, z, this) : 0; }

  _buildGrid() {
    const n = this.n, res = this.res, half = this.half;
    this.height = new Float32Array(n * n);
    this.surface = new Uint8Array(n * n).fill(SURF.Grass);
    const trackDist = new Float32Array(n * n).fill(1e9);
    const trackH = new Float32Array(n * n);
    const trackIdx = new Int32Array(n * n).fill(-1);   // nearest track sample per cell
    const trackLat = new Float32Array(n * n);          // signed lateral offset from it (+ = right)
    const map = this.map, blend = map.blend ?? 32, runoff = map.runoff ?? 3;

    // stamp track: nearest-sample distance & banked height
    const reach = this.maxHalfWidth + Math.max(33, blend + 1) + (map.flatReach ?? 0);
    const gravel = new Uint8Array(n * n);
    const seen = new Int32Array(n * n).fill(-1);          // which sample last visited a cell (each cell is tested once per sample)
    const r = Math.ceil(reach / res), lateralMax = Math.SQRT2 * r * res + 1;
    for (const s of this.track) {
      const ci = Math.round((s.x + half) / res), cj = Math.round((s.z + half) / res);
      // only cells within 1.2 m of the cross-section line through the sample matter (|along| <= 1.2), so walk that thin strip
      // instead of the whole square around the sample: same cells, a fraction of the work
      for (let lt = -lateralMax; lt <= lateralMax; lt += 0.5) for (let u = -1.5; u <= 1.5; u += 0.5) {
        const px = s.x + s.rx * lt + s.tx * u, pz = s.z + s.rz * lt + s.tz * u;
        const i = Math.round((px + half) / res), j = Math.round((pz + half) / res);
        if (i < 0 || j < 0 || i >= n || j >= n || Math.abs(i - ci) > r || Math.abs(j - cj) > r) continue;
        const kk = j * n + i;
        if (seen[kk] === s.i) continue;
        seen[kk] = s.i;
        {
          {
            const x = i * res - half, z = j * res - half;
          const dx = x - s.x, dz = z - s.z;
          const along = dx * s.tx + dz * s.tz;
          if (Math.abs(along) > 1.2) continue;
          const lat = dx * s.rx + dz * s.rz;       // + = right of travel
          const d = Math.abs(lat);
          const k = j * n + i;
          if (d < trackDist[k]) {
            trackDist[k] = d; trackIdx[k] = s.i; trackLat[k] = lat;
            // banking: inside of the corner lower
            // (maps with signedBank give + = right side lower, so the direction can't flicker on straights)
            const bankLat = this.map.signedBank ? lat : Math.sign(s.curv || 1) * lat;
            trackH[k] = s.y + s.dy * along - Math.sin(s.bank) * clamp(bankLat, -s.w, s.w);
            gravel[k] = map.gravel?.(s, lat, d, s.w / 2, this) ? 1 : 0;
          }
        }
      }
      }
    }

    const flatArr = map.flatWidth ? new Float32Array(n * n) : null;
    const fwCache = new Float32Array(this.track.length * 2).fill(NaN);   // per cell: how far the ground is held flat beside the track
    for (let j = 0; j < n; j++) {
      const z = j * res - half;
      for (let i = 0; i < n; i++) {
        const x = i * res - half, k = j * n + i;
        let h = this.terrainHeight(x, z);
        let surf = map.paint ? map.paint(x, z, h, this) : SURF.Grass;
        // track blend
        const d = trackDist[k];
        if (d < 1e8) {
          const s = this.track[trackIdx[k]], hw = s.w / 2;
          // maps can keep the ground flat further out on one side (tarmac run-off, gravel traps)
          let fw = 0;
          if (map.flatWidth) {                                   // depends only on the sample and which side of it the cell is on: compute once per sample
            const fk = s.i * 2 + (trackLat[k] > 0 ? 1 : 0);
            fw = fwCache[fk];
            if (fw !== fw) fw = fwCache[fk] = map.flatWidth(s, trackLat[k], this);   // NaN = not yet computed
          }
          if (flatArr) flatArr[k] = fw;
          const t = smoothstep(hw + 1.5 + fw, hw + blend + fw, d);
          h = lerp(trackH[k], h, t);
          if (d <= hw) surf = SURF.Asphalt;
          else if (d <= hw + 1.2 && s.kerb && !(trackLat[k] > 0 && s.noKerbR)) surf = SURF.Kerb;
          else if (d <= hw + runoff) surf = SURF.Asphalt; // run-off strip
          else if (gravel[k]) surf = SURF.Gravel;
          const o = map.paintTrackside?.(x, z, s, trackLat[k], d, hw, this);
          if (o !== undefined && d > hw + (s.kerb ? 1.2 : 0.3)) surf = o;
        }
        this.height[k] = h;
        this.surface[k] = surf;
      }
    }
    // the nearest-sample lookup flips between neighbouring track samples on the outside of tight bends, which leaves
    // small steps in the flat run-off ground: even those out (kerb edge and anything beyond the flat zone are untouched)
    if (flatArr) {
      const cells = [];
      for (let k = 0; k < n * n; k++) {
        if (flatArr[k] > 3 && trackIdx[k] >= 0) { const hw = this.track[trackIdx[k]].w / 2; if (trackDist[k] > hw + 2 && trackDist[k] < hw + flatArr[k] - 1) cells.push(k); }
      }
      const R = 4;
      for (let pass = 0; pass < 4; pass++) {
        const out = new Float32Array(cells.length);
        cells.forEach((k, c) => {
          const i = k % n, j = (k / n) | 0; let sum = 0, cnt = 0;
          for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; sum += this.height[jj * n + ii]; cnt++; }
          out[c] = sum / cnt;
        });
        cells.forEach((k, c) => { this.height[k] = out[c]; });
      }
    }
    this.trackDist = trackDist;
    this.trackIdx = trackIdx;
    this.trackLat = trackLat;
  }

  // ---------- queries
  heightAtGrid(x, z) {
    const n = this.n, fx = clamp((x + this.half) / this.res, 0, n - 1.001), fz = clamp((z + this.half) / this.res, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * n + i, H = this.height;
    return lerp(lerp(H[k], H[k + 1], u), lerp(H[k + n], H[k + n + 1], u), v);
  }
  surfaceAt(x, z) {
    const n = this.n, i = clamp(Math.round((x + this.half) / this.res), 0, n - 1), j = clamp(Math.round((z + this.half) / this.res), 0, n - 1);
    return this.surface[j * n + i];
  }

  // raw height including props, without micro bumps (for rendering/spawning)
  heightAt(x, z, withProps = true) {
    let h = this.heightAtGrid(x, z);
    if (withProps) {
      for (const p of this.props) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz > p.radius * p.radius) continue;
        const u = dx * p.sin + dz * p.cos, w = dx * p.cos - dz * p.sin;
        const ph = propHeight(p, u, w);
        if (ph > -Infinity) { const base = this.heightAtGrid(p.x, p.z); h = Math.max(h, base + ph); }
      }
    }
    return h;
  }

  _fullHeight(x, z, out) {
    let h = this.heightAtGrid(x, z), surf = this.surfaceAt(x, z);
    for (const p of this.props) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > p.radius * p.radius) continue;
      const u = dx * p.sin + dz * p.cos, w = dx * p.cos - dz * p.sin;
      const ph = propHeight(p, u, w);
      if (ph > 0.001) {
        const hh = this.heightAtGrid(p.x, p.z) + ph;
        if (hh > h) { h = hh; surf = p.surface; }
      }
    }
    const S = SURFACES[surf];
    if (surf === SURF.Kerb) {
      // modern kerb: low (1.5 cm) with a gentle rumble ripple, not random rubble
      h += 0.015 + 0.006 * Math.sin((x + z) * 4.2);
    } else if (S.bump > 0) h += S.bump * (valueNoise(x * 1.7, z * 1.7) + 0.5 * valueNoise(x * 4.1 + 3, z * 4.1));
    if (out) out.s = surf;
    return h;
  }

  /** Physics ground query: fills out.height, out.normal (Vec3) and out.surface */
  sample(x, z, out) {
    const e = 0.25;
    const tmp = this._tmp || (this._tmp = { s: 0 });
    const h = this._fullHeight(x, z, tmp);
    const surf = tmp.s;
    const hx = (this._fullHeight(x + e, z) - this._fullHeight(x - e, z)) / (2 * e);
    const hz = (this._fullHeight(x, z + e) - this._fullHeight(x, z - e)) / (2 * e);
    out.height = h;
    out.normal.set(-hx, 1, -hz).normalize();
    out.surface = SURFACES[surf];
    return out;
  }

  // ---------- spawn points
  spawnPoints() { return this.map.spawns ? this.map.spawns(this) : { Start: { x: this.track[0].x, z: this.track[0].z, yaw: Math.atan2(this.track[0].tx, this.track[0].tz) } }; }

  /** Signed lateral offset / nearest track sample for any position (from the grid). */
  trackInfo(x, z) {
    const n = this.n, i = clamp(Math.round((x + this.half) / this.res), 0, n - 1), j = clamp(Math.round((z + this.half) / this.res), 0, n - 1), k = j * n + i;
    return { index: this.trackIdx[k], lat: this.trackLat[k], dist: this.trackDist[k] };
  }
}

