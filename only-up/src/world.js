// World generation: the tower, the spiralling route, colliders, ladders, launch pads, movers, checkpoints.
import * as THREE from 'three';
import { Builder } from './builder.js';
import { makeMaterials, THEMES, LEVEL_H, levelY0, levelY1, TOP_Y } from './themes.js';
import { DECOR, CORE_R, L, tree } from './decor.js';
import { mulberry32 } from './noise.js';

export const GRAV = 28;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const CELL = 8;
const ACCENT = [0x9dff7a, 0xffa030, 0xff5a3a, 0xffb050, 0xff30c0, 0x70d8ff, 0x40ffc0, 0xffe080];
const PILLAR = ['rock', 'steel', 'concrete', 'rust', 'brass', 'frost', 'obsidian', 'marble'];
const RUNG = ['wood', 'steel', 'wood', 'rust', 'brass', 'frost', 'obsidian', 'brass'];

function signTexture(title, sub, color) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 280;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 280);
  g.textAlign = 'center';
  g.shadowColor = color; g.shadowBlur = 28;
  g.fillStyle = '#ffffff'; g.font = '800 120px "Trebuchet MS", Verdana, sans-serif';
  g.fillText(title.toUpperCase(), 512, 138);
  g.shadowBlur = 12; g.fillStyle = color; g.font = '500 46px "Trebuchet MS", Verdana, sans-serif';
  g.fillText(sub, 512, 220);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.grid = new Map(); this.bigs = []; this.movers = [];
    this.ladders = []; this.pads = []; this.checkpoints = []; this.lamps = [];
    this.spinners = []; this.fires = []; this.levels = [];
    this.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
    this.summit = null; this.platformCount = 0; this.route = [];
  }

  // ---------------- colliders ----------------
  addCollider(c) {
    c.enabled = true; c.top = c.y + c.hy; c.bot = c.y - c.hy;
    if (c.kind === 0 && c.c === undefined) { c.c = 1; c.s = 0; }
    c.br = c.kind === 0 ? Math.hypot(c.hx, c.hz) : c.r;
    if (c.moving) { c.px = c.x; c.pz = c.z; c.pc = c.c; c.ps = c.s; this.movers.push(c); return c; }
    const x0 = Math.floor((c.x - c.br) / CELL), x1 = Math.floor((c.x + c.br) / CELL);
    const y0 = Math.floor(c.bot / CELL), y1 = Math.floor(c.top / CELL);
    const z0 = Math.floor((c.z - c.br) / CELL), z1 = Math.floor((c.z + c.br) / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) * (y1 - y0 + 1) > 60) { this.bigs.push(c); return c; }
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const k = ix * 73856093 ^ iy * 19349663 ^ iz * 83492791;
      let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
      a.push(c);
    }
    return c;
  }
  query(x, y, z, out) {
    out.length = 0;
    const x0 = Math.floor((x - 1.2) / CELL), x1 = Math.floor((x + 1.2) / CELL);
    const y0 = Math.floor((y - 0.5) / CELL), y1 = Math.floor((y + 2.5) / CELL);
    const z0 = Math.floor((z - 1.2) / CELL), z1 = Math.floor((z + 1.2) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.grid.get(ix * 73856093 ^ iy * 19349663 ^ iz * 83492791);
      if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
    }
    for (const c of this.bigs) out.push(c);
    for (const c of this.movers) if (c.enabled) out.push(c);
    return out;
  }
  solidAt(x, y, z) { // for camera
    const tmp = this._tmp || (this._tmp = []);
    this.query(x, y - 0.3, z, tmp);
    for (const c of tmp) {
      if (!c.enabled || y > c.top || y < c.bot) continue;
      if (c.kind === 1) { if (Math.hypot(x - c.x, z - c.z) < c.r) return true; }
      else { const dx = x - c.x, dz = z - c.z, lx = dx * c.c + dz * c.s, lz = -dx * c.s + dz * c.c; if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) return true; }
    }
    return false;
  }

  // ---------------- runtime update ----------------
  update(t) {
    for (const m of this.movers) { m.px = m.x; m.pz = m.z; m.pc = m.c; m.ps = m.s; }
    for (const m of this.mv) m.fn(m, t);
    for (const s of this.spinners) s.obj.rotation.z = s.speed * t;
  }
  flicker(t) {
    const k = 3.2 + Math.sin(t * 17) * 0.5 + Math.sin(t * 31.7) * 0.4;
    this.M.flame.color.setRGB(1.0 * k, 0.45 * k, 0.12 * k);
  }

  // ---------------- generation ----------------
  async generate(scene, onProgress) {
    const M = (this.M = makeMaterials());
    this.mv = [];
    const rnd = mulberry32(90210), rr = (a, b) => a + rnd() * (b - a);
    const self = this;
    const lamp = (x, y, z, col, int, dist) => { if (self.lamps.length < 400) self.lamps.push({ x, y, z, col, int, dist }); };

    let S = null;
    for (let i = 0; i < 8; i++) {
      const T = THEMES[i], dec = DECOR[i];
      const group = new THREE.Group(); group.userData.level = i;
      scene.add(group); this.levels.push(group);
      const b = new Builder();
      const ctx = { b, M, rnd, rr, world: this, i, lamp, fires: this.fires, gear: (x, y, z, r, sp, ry) => this._gear(group, x, y, z, r, sp, ry) };
      const y0 = levelY0(i), y1 = levelY1(i), dif = i / 7;
      const accent = ACCENT[i];

      // --- central tower sections
      for (let y = y0; y < y1 - 0.5; ) {
        const h = Math.min(rr(10, 16), y1 - y); dec.core(ctx, y, h); y += h;
      }
      this.addCollider({ kind: 1, x: 0, y: (y0 + y1) / 2, z: 0, r: CORE_R * 0.92, hy: (y1 - y0) / 2 + 0.5 });
      // --- far scenery
      const fb = new Builder(); const fctx = { ...ctx, b: fb, lamp: () => {}, gear: () => {} };
      dec.far(fctx, y0, y1); fb.flush(group, { cast: false, receive: false });

      // ---- helpers bound to this level
      const staticP = (P) => {
        P.c = Math.cos(P.psi); P.s = Math.sin(P.psi); P.ry = -P.psi; this.platformCount++;
        dec.slab(ctx, P);
        if (P.shape === 'disc') this.addCollider({ kind: 1, x: P.x, y: P.y - P.h / 2, z: P.z, r: P.w / 2, hy: P.h / 2, slip: P.slip });
        else this.addCollider({ kind: 0, x: P.x, y: P.y - P.h / 2, z: P.z, hx: P.w / 2, hy: P.h / 2, hz: P.d / 2, c: P.c, s: P.s, slip: P.slip });
        // tether struts to the tower for the "industrial" feeling
        if ((i === 1 || i === 2 || i === 3 || i === 4) && rnd() < 0.3) {
          const a = Math.atan2(P.z, P.x), r0 = CORE_R * 0.9;
          b.strut(i === 4 ? M.brass : M.steel, P.x, P.y - P.h * 0.6, P.z, Math.cos(a) * r0, P.y - P.h * 0.6 - 1.5, Math.sin(a) * r0, 0.22, 0.8);
        }
      };
      const ext = (P, dir) => { // support extent of platform along direction dir
        if (P.shape === 'disc') return P.w / 2;
        const d = dir - P.psi; return Math.abs(Math.cos(d)) * P.w / 2 + Math.abs(Math.sin(d)) * P.d / 2;
      };
      const dirFrom = (P) => {
        const R = Math.hypot(P.x, P.z), th = Math.atan2(P.z, P.x), Rt = 27 + 2.5 * Math.sin(P.y * 0.05);
        const steer = clamp((Rt - R) * 0.07, -0.8, 0.8);
        return th + Math.PI / 2 - steer + rr(-0.28, 0.28);
      };
      const mkSize = (force) => {
        let w = lerp(5.0, 2.5, dif) * rr(0.85, 1.3), d = lerp(4, 2.3, dif) * rr(0.85, 1.3), shape = 'box';
        const r = rnd();
        if (force) { w = rr(5, 6); d = rr(4, 5); }
        else if (r < 0.2) { shape = 'disc'; w = d = lerp(4.2, 2.7, dif) * rr(0.9, 1.2); }
        else if (r < 0.3 && i >= 1) { w = rr(6, 9); d = rr(1.4, 1.9); }
        return { w, d, shape, h: 0.8 };
      };
      const place = (S, dir, gap, dy, size) => {
        const P = { ...size, psi: dir };
        const dist = ext(S, dir) + gap + P.w / (P.shape === 'disc' ? 2 : 2);
        P.x = S.x + Math.cos(dir) * dist; P.z = S.z + Math.sin(dir) * dist; P.y = S.y + dy;
        return P;
      };

      // ---- level gate (rest platform)
      if (i === 0) {
        this._island(ctx, group, rr, rnd);
        const R0 = 33, a0 = 0.0;
        S = { x: Math.cos(a0) * R0, z: Math.sin(a0) * R0, y: 0, psi: a0 + Math.PI / 2, w: 4, d: 4, shape: 'disc', h: 0.8, virtual: true };
        const sp = { x: Math.cos(a0 - 0.5) * 30, z: Math.sin(a0 - 0.5) * 30 };
        this.spawn = { x: sp.x, y: 0.05, z: sp.z, yaw: Math.atan2(S.x - sp.x, S.z - sp.z) };
        this._arch(ctx, group, sp.x, 0, sp.z, Math.atan2(S.z - sp.z, S.x - sp.x), i, accent);
        this._checkpoint(ctx, i, 0, sp.x, 0, sp.z, accent, true);
      } else {
        const dir = dirFrom(S), size = { w: 10, d: 10, shape: 'disc', h: 1.0, gate: true };
        const P = place(S, dir, 2.0, y0 - S.y, size); P.y = y0;
        staticP(P);
        this._arch(ctx, group, P.x, P.y, P.z, dir, i, accent);
        this._checkpoint(ctx, i, 0, P.x, P.y, P.z, accent, false);
        S = P; this.route.push({ kind: 'gate', P, i });
      }

      // ---- route
      let n = 0, sinceCP = 0, last = 'gate';
      const finalY = y1 - 1.45;
      while (S.y < finalY) {
        const remain = y1 - S.y, r = rnd();
        let kind = 'hop';
        if (n >= 2 && last === 'hop' || last === 'gate' && false) {
          const wl = i === 0 ? 0.08 : 0.13, wp = 0.1, wm = i === 0 ? 0 : 0.1, ws = i < 2 ? 0 : 0.07, wb = (i === 4 || i === 6) ? 0.2 : (i === 5 ? 0.05 : 0.08);
          let acc = 0;
          if (remain > 15 && (r < (acc += wl))) kind = 'ladder';
          else if (remain > 16 && r < (acc += wp)) kind = 'pad';
          else if (r < (acc += wm)) kind = 'mover';
          else if (r < (acc += ws)) kind = 'spinner';
          else if (r < (acc += wb)) kind = 'blink';
        }
        const needCP = sinceCP >= 14;
        const dir = dirFrom(S);
        let dy = rnd() < 0.12 ? -rr(0.2, 0.8) : rr(0.25, 0.85 + 0.55 * Math.min(1, dif + 0.3));
        dy = Math.min(dy, remain - 0.02);

        if (kind === 'hop' || needCP) {
          const size = mkSize(needCP);
          const gapMax = (5.4 - 2.2 * Math.max(0, dy)) * 0.9;
          const gi = Math.min(i, 6), gap = Math.min(rr(1.3 + 0.22 * gi, 2.4 + 0.4 * gi), gapMax);
          const P = place(S, dir, gap, dy, size);
          staticP(P);
          if (needCP) { this._checkpoint(ctx, i, ++this._cpi, P.x, P.y, P.z, accent, false, P); sinceCP = 0; }
          S = P; last = 'hop'; sinceCP++; n++; this.route.push({ kind: 'hop', P, i });
        } else if (kind === 'ladder') {
          const H = Math.min(rr(7, 13), remain - 1.5);
          const size = { w: 4.2, d: 3.6, shape: 'box', h: 0.8 };
          // pillar occupies the back of the next platform; ladder volume in front of it
          const gapA = 1.15; // ladder depth
          const P = place(S, dir, gapA, H, size);
          P.y = S.y + H;
          staticP(P);
          const px = S.x + Math.cos(dir) * (ext(S, dir) + gapA * 0.5), pz = S.z + Math.sin(dir) * (ext(S, dir) + gapA * 0.5);
          // pillar under the platform's back portion
          const pc = Math.cos(dir), ps = Math.sin(dir), pw = 1.6, pdepth = 1.3;
          const pcx = S.x + pc * (ext(S, dir) + gapA + pdepth / 2), pcz = S.z + ps * (ext(S, dir) + gapA + pdepth / 2);
          this.addCollider({ kind: 0, x: pcx, y: S.y + H / 2 - 0.4, z: pcz, hx: pdepth / 2, hy: H / 2, hz: pw / 2, c: pc, s: ps });
          const pm = M[PILLAR[i]], rm = M[RUNG[i]];
          b.box(pm, pdepth, H, pw, pcx, S.y + H / 2 - 0.4, pcz, -dir, 0.9);
          const fx = pcx - pc * (pdepth / 2 + 0.06), fz = pcz - ps * (pdepth / 2 + 0.06);
          for (const sg of [-1, 1]) b.box(rm, 0.07, H + 0.8, 0.07, fx - ps * sg * 0.35, S.y + H / 2 + 0.2, fz + pc * sg * 0.35, 0, 0.8);
          for (let y = S.y + 0.4; y < S.y + H + 0.3; y += 0.38) b.box(i === 6 ? M.glow(0x20f0ff, 3) : rm, 0.07, 0.07, 0.8, fx, y, fz, -dir, 0.9);
          if (i === 6) lamp(fx, S.y + H * 0.5, fz, 0x20f0ff, 1.5, 12);
          this.ladders.push({ x: fx - pc * 0.25, z: fz - ps * 0.25, y: S.y + H / 2 + 0.1, hx: 0.55, hz: 0.65, hy: H / 2 + 0.3, c: pc, s: ps, topY: S.y + H, ux: pc, uz: ps });
          S = P; last = 'ladder'; sinceCP++; n++; this.route.push({ kind: 'ladder', P, i, lad: this.ladders[this.ladders.length - 1] });
        } else if (kind === 'pad') {
          const A = S;
          if (A.w < 3.4 || A.d < 3 || A.shape === 'disc' && A.w < 4) { last = 'hop'; continue; }
          const dyP = Math.min(rr(8.5, 13), remain - 1.2);
          const pc = Math.cos(dir), ps = Math.sin(dir);
          const off = A.shape === 'disc' ? A.w * 0.25 : Math.max(0, A.w / 2 - 1.5);
          const padX = A.x + pc * off, padZ = A.z + ps * off, padTop = A.y + 0.25;
          this._pad(ctx, padX, A.y, padZ, dir, i);
          const vy = Math.sqrt(2 * GRAV * (dyP + 2.2));
          this.pads.push({ x: padX, y: padTop, z: padZ, r: 1.25, vy, ux: pc, uz: ps });
          const size = { w: 4.4, d: 4.0, shape: 'box', h: 0.8 };
          const distH = rr(3.4, 4.8) + size.w / 2;
          const P = { ...size, psi: dir, x: padX + pc * distH, z: padZ + ps * distH, y: A.y + dyP };
          staticP(P);
          if (i === 4 || i === 6) lamp(padX, A.y + 1, padZ, i === 4 ? 0xff30c0 : 0x40ffc0, 2, 14);
          S = P; last = 'pad'; sinceCP++; n++; this.route.push({ kind: 'pad', P, i, pad: this.pads[this.pads.length - 1] });
        } else if (kind === 'mover') {
          const A = S, L0 = rr(8.5, 12.5), dyM = rr(0, 0.7), size = { w: 4.4, d: 4.0, shape: 'box', h: 0.8 };
          const B = { ...size, psi: dir, y: A.y + dyM };
          const dist = ext(A, dir) + L0 + size.w / 2;
          B.x = A.x + Math.cos(dir) * dist; B.z = A.z + Math.sin(dir) * dist;
          staticP(B);
          const mw = 3.4, s0 = ext(A, dir) + 0.9 + mw / 2, s1 = ext(A, dir) + L0 - 0.9 - mw / 2;
          const mP = { x: 0, y: 0, z: 0, psi: 0, c: 1, s: 0, ry: 0, w: mw, d: mw, shape: 'box', h: 0.7 };
          const grp = this._moverGroup(ctx, mP, i);
          group.add(grp);
          const col = this.addCollider({ kind: 0, x: A.x, y: A.y + dyM * 0.5 - 0.35, z: A.z, hx: mw / 2, hy: 0.35, hz: mw / 2, c: Math.cos(dir), s: Math.sin(dir), moving: true });
          const T0 = rr(6, 8.5), ph = rnd(), ay = A.y + dyM * 0.5, ax = A.x, az = A.z, ca = Math.cos(dir), sa = Math.sin(dir);
          grp.rotation.y = -dir;
          this.mv.push({ col, fn: (m, t) => {
            const u = 0.5 - 0.5 * Math.cos(TAU * (t / T0 + ph)), s = s0 + (s1 - s0) * u;
            col.x = ax + ca * s; col.z = az + sa * s; col.y = ay - 0.35; col.top = ay; col.bot = ay - 0.7;
            grp.position.set(col.x, ay, col.z);
          } });
          // rail visual
          b.box(M.steel, s1 - s0 + 3.4, 0.12, 0.12, ax + ca * ((s0 + s1) / 2), ay - 0.9, az + sa * ((s0 + s1) / 2), -dir, 0.7);
          S = B; last = 'mover'; sinceCP++; n++; this.route.push({ kind: 'tele', P: B, i });
        } else if (kind === 'spinner') {
          const A = S, La = 4.6, g1 = 1.9, dyS = rr(0, 0.5), size = { w: 4.2, d: 3.8, shape: 'box', h: 0.8 };
          const B = { ...size, psi: dir, y: A.y + dyS };
          const distB = ext(A, dir) + g1 + 2 * La + g1 + size.w / 2;
          B.x = A.x + Math.cos(dir) * distB; B.z = A.z + Math.sin(dir) * distB;
          staticP(B);
          const pd = ext(A, dir) + g1 + La, cx = A.x + Math.cos(dir) * pd, cz = A.z + Math.sin(dir) * pd, cy = A.y + dyS * 0.5;
          const mP = { x: 0, y: 0, z: 0, psi: 0, c: 1, s: 0, ry: 0, w: 2 * La, d: 1.7, shape: 'box', h: 0.5 };
          const grp = this._moverGroup(ctx, mP, i); group.add(grp);
          const col = this.addCollider({ kind: 0, x: cx, y: cy - 0.25, z: cz, hx: La, hy: 0.25, hz: 0.85, c: 1, s: 0, moving: true });
          const w = (rnd() < 0.5 ? -1 : 1) * rr(0.38, 0.55), ph = rnd() * TAU;
          this.mv.push({ col, fn: (m, t) => {
            const psi = dir + w * t + ph;
            col.c = Math.cos(psi); col.s = Math.sin(psi); col.x = cx; col.z = cz; col.y = cy - 0.25; col.top = cy; col.bot = cy - 0.5;
            grp.position.set(cx, cy, cz); grp.rotation.y = -psi;
          } });
          b.cyl(M[PILLAR[i]], 0.9, 1.2, 14, cx, cy - 7.3, cz, 10, 0.85);
          b.cyl(M.brass, 0.7, 0.7, 0.3, cx, cy + 0.05, cz, 14);
          S = B; last = 'spinner'; sinceCP++; n++; this.route.push({ kind: 'tele', P: B, i });
        } else if (kind === 'blink') {
          const cnt = 3 + ((rnd() * 3) | 0), period = 6.0, on = 3.6, warn = 0.9;
          let A = S;
          for (let k = 0; k < cnt && A.y < y1 - 2; k++) {
            const d2 = dirFrom(A), dyB = rr(0.2, 0.7), size = { w: rr(3, 4), d: rr(2.6, 3.4), shape: 'box', h: 0.7 };
            const gap = rr(1.2, 2.3);
            const P = place(A, d2, gap, dyB, size);
            P.c = Math.cos(P.psi); P.s = Math.sin(P.psi); P.ry = -P.psi;
            const mP = { x: 0, y: 0, z: 0, psi: 0, c: 1, s: 0, ry: 0, w: P.w, d: P.d, shape: 'box', h: P.h };
            const grp = this._moverGroup(ctx, mP, i, true); grp.position.set(P.x, P.y, P.z); grp.rotation.y = -P.psi; group.add(grp);
            const col = this.addCollider({ kind: 0, x: P.x, y: P.y - P.h / 2, z: P.z, hx: P.w / 2, hy: P.h / 2, hz: P.d / 2, c: P.c, s: P.s, moving: true });
            col.px = P.x; col.pz = P.z;
            const ph = -(k * 1.1) + (i * 0.37);
            this.mv.push({ col, fn: (m, t) => {
              const u = (((t + ph) % period) + period) % period;
              col.enabled = u < on + warn;
              grp.visible = col.enabled && (u < on || Math.sin(t * 26) > 0);
            } });
            this.platformCount++;
            A = P;
          }
          S = A; last = 'blink'; sinceCP += cnt; n += cnt; this.route.push({ kind: 'tele', P: A, i });
        }
      }
      if (i === 7) this._summit(ctx, group, S, rr, rnd);
      b.flush(group);
      onProgress && (await onProgress(i + 1, 8));
    }
    this.M.T = null;
  }

  _island(ctx, group, rr, rnd) {
    const { b, M } = ctx;
    b.cyl(M.grass, 82, 82, 0.8, 0, -0.4, 0, 56, 1);
    b.cyl(M.moss, 82, 40, 26, 0, -13.8, 0, 40, 0.95);
    b.cyl(M.rock, 40, 6, 60, 0, -56, 0, 14, 0.9);
    b.cyl(M.rock, 6, 0, 50, 0, -111, 0, 8, 0.8);
    this.addCollider({ kind: 1, x: 0, y: -1.0, z: 0, r: 82, hy: 1.0 });
    for (let k = 0; k < 90; k++) {
      const a = rnd() * TAU, r = rr(15, 78), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - 30 * Math.cos(-0.5), z - 30 * Math.sin(-0.5)) < 9 || Math.hypot(x - 33, z) < 9) continue;
      if (k % 9 === 0) { b.cyl(M.rock, rr(0.8, 2.2), rr(1.4, 3.2), rr(1.5, 4), x, 1, z, 6, 0.9, 0, rnd() * 6); continue; }
      tree(ctx, x, -0.1, z, rr(1.2, 2.4), rnd() < 0.25);
    }
    for (let k = 0; k < 500; k++) {
      const a = rnd() * TAU, r = rr(12, 80), x = Math.cos(a) * r, z = Math.sin(a) * r;
      const col = [0xffffff, 0xffd84a, 0xff7aa8, 0xb48cff, 0xff9a4a][(rnd() * 5) | 0];
      b.cyl(M.flat(0x3a7a2a, 1, 0), 0.01, 0.015, 0.3, x, 0.15, z, 3);
      b.sphere(M.flat(col, 0.7, 0), 0.08, x, 0.32, z, 1, 0.8, 1, 1, 5);
      if (k % 2) b.cyl(M.leaf, 0, 0.08, 0.4, x + 0.2, 0.2, z, 4);
    }
    for (let k = 0; k < 14; k++) { const a = rnd() * TAU, r = rr(14, 70); this.lamp(Math.cos(a) * r, 1.6, Math.sin(a) * r, 0xfff0a0, 1.2, 14, b, M); }
    // base flare of the tower
    b.cyl(M.rock, CORE_R + 4, CORE_R + 9, 5, 0, 2.5, 0, 16, 0.9);
    // water pool
    b.cyl(M.flat(0x3aa0d8, 0.05, 0.1), 9, 9, 0.12, -38, 0.02, -24, 28);
  }
  lamp(x, y, z, col, int, dist, b, M) { // firefly orb
    b.sphere(M.glow(col, 3.5), 0.09, x, y, z, 1, 1, 1, 1, 6);
    if (this.lamps.length < 400 && Math.random() < 0.5) this.lamps.push({ x, y, z, col, int, dist });
  }

  _arch(ctx, group, x, y, z, dir, i, accent) {
    const { b, M } = ctx;
    const c = Math.cos(dir), s = Math.sin(dir), nx = -s, nz = c, wd = 5.6;
    const pm = M[PILLAR[i]];
    for (const sg of [-1, 1]) {
      b.box(pm, 1.1, 9, 1.1, x + nx * sg * wd, y + 4.5, z + nz * sg * wd, -dir, 0.9);
      b.box(M.glow(accent, 3), 0.18, 8, 0.18, x + nx * sg * (wd - 0.62) + c * 0.2, y + 4.2, z + nz * sg * (wd - 0.62) + s * 0.2, -dir);
    }
    b.box(pm, 1.2, 1.1, wd * 2 + 1.1, x, y + 9.5, z, -dir, 0.95);
    b.box(M.glow(accent, 3), 0.2, 0.2, wd * 2, x - c * 0.7, y + 8.9, z - s * 0.7, -dir);
    const tex = signTexture(THEMES[i].name, THEMES[i].sub, '#' + new THREE.Color(accent).getHexString());
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 2.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, fog: false, color: new THREE.Color(1.5, 1.5, 1.5) }));
    sign.position.set(x, y + 12.2, z); sign.rotation.y = -dir + Math.PI / 2 * 0; sign.rotation.y = Math.atan2(-s, c) + Math.PI / 2 * 0;
    // plane normal is +z; we want it to face along the path direction (c,s): rotation.y = atan2(c, s)
    sign.rotation.y = Math.atan2(-c, -s);
    group.add(sign);
    this.lamps.push({ x: x, y: y + 6, z: z, col: accent, int: 2.5, dist: 28 });
  }

  _checkpoint(ctx, lvl, idx, x, y, z, accent, isSpawn, P) {
    const { b, M } = ctx;
    this._cpi = idx;
    let bx = x, bz = z;
    if (P) { const p = L(P, -P.w / 2 + 0.5, 0, P.d / 2 - 0.5); bx = p[0]; bz = p[2]; }
    else if (!isSpawn) { bx = x + 3.2; bz = z + 3.2; }
    b.cyl(M.steel, 0.05, 0.07, 3.6, bx, y + 1.8, bz, 6, 0.8);
    b.sphere(M.glow(accent, 3), 0.12, bx, y + 3.65, bz, 1, 1, 1, 1, 8);
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(0.35), side: THREE.DoubleSide, toneMapped: true });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), fm);
    flag.position.set(bx + 0.8, y + 3.05, bz);
    this.levels[this.levels.length - 1].add(flag);
    const ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(0.0), transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.0, 40), ringM);
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.04, z);
    this.levels[this.levels.length - 1].add(ring);
    const cp = { x, y: y + 0.05, z, r: 3.4, lvl, idx, flag, fm, ringM, accent, active: false, yaw: 0 };
    this.checkpoints.push(cp);
  }
  activateCheckpoint(cp, on) {
    cp.active = on;
    cp.fm.color.set(cp.accent).multiplyScalar(on ? 1.7 : 0.35);
    cp.ringM.color.set(cp.accent).multiplyScalar(on ? 1.2 : 0); cp.ringM.opacity = on ? 0.75 : 0;
  }

  _pad(ctx, x, y, z, dir, i) {
    const { b, M } = ctx;
    if (i === 0 || i === 7) {
      b.cyl(M.flat(0xe8e0d0, 0.8, 0), 0.4, 0.55, 0.3, x, y + 0.15, z, 10);
      b.sphere(M.flat(i === 0 ? 0xd8322a : 0xff7aa8, 0.6, 0), 1.45, x, y - 0.2, z, 1, 0.18, 1, 1, 14);
      for (let k = 0; k < 6; k++) { const a = k * 1.05; b.sphere(M.flat(0xffffff, 0.7, 0), 0.17, x + Math.cos(a) * 0.8, y + 0.1, z + Math.sin(a) * 0.8, 1, 0.4, 1, 1, 6); }
    } else {
      const acc = ACCENT[i];
      b.cyl(M[PILLAR[i]], 1.3, 1.45, 0.25, x, y + 0.125, z, 16, 0.9);
      b.cyl(M.glow(acc, 3), 0.95, 0.95, 0.04, x, y + 0.26, z, 16);
      for (let k = 0; k < 3; k++) b.box(M.glow(0xffffff, 2.5), 0.5, 0.03, 0.14, x, y + 0.29, z, -dir + k * 2.094, 1, 0, 0);
      this.lamps.push({ x, y: y + 1, z, col: acc, int: 2, dist: 12 });
    }
    this.addCollider({ kind: 1, x, y: y + 0.125, z, r: 1.25, hy: 0.125 });
  }

  _moverGroup(ctx, mP, i, blink = false) {
    const g = new THREE.Group();
    const b2 = new Builder();
    const c2 = { ...ctx, b: b2, lamp: () => {}, gear: () => {}, fires: [] };
    DECOR[i].slab(c2, mP);
    if (blink) { b2.box(ctx.M.glow(0xff5a8a, 2.4), mP.w + 0.15, 0.06, mP.d + 0.15, 0, -mP.h - 0.04, 0, 0); }
    else b2.box(ctx.M.glow(ACCENT[i], 2.2), mP.w + 0.12, 0.05, 0.05, 0, -0.1, mP.d / 2 + 0.07, 0);
    b2.flush(g);
    return g;
  }

  _gear(parent, x, y, z, r, speed, ry) {
    const M = this.M, b = new Builder(), T = Math.max(8, Math.round(r * 7));
    b.cyl(M.brass, r, r, 0.18, 0, 0, 0, T * 2, 0.9, Math.PI / 2);
    for (let k = 0; k < T; k++) { const a = (k / T) * TAU; b.box(M.brass, 0.2, r * 0.3, 0.2, Math.cos(a) * (r + 0.06), Math.sin(a) * (r + 0.06), 0, 0, 0.9, 0, a - Math.PI / 2); }
    for (let k = 0; k < 4; k++) b.box(M.brass, r * 1.7, 0.1, 0.24, 0, 0, 0.0, 0, 1.1, 0, (k * Math.PI) / 4);
    b.cyl(M.brass, r * 0.22, r * 0.22, 0.32, 0, 0, 0, 10, 1.1, Math.PI / 2);
    const inner = new THREE.Group(); b.flush(inner);
    const outer = new THREE.Group(); outer.add(inner); outer.position.set(x, y, z); outer.rotation.y = ry;
    parent.add(outer); this.spinners.push({ obj: inner, speed });
  }

  _summit(ctx, group, S, rr, rnd) {
    const { b, M } = ctx;
    const dir = Math.atan2(S.z, S.x) + Math.PI / 2;
    const P = { x: S.x + Math.cos(dir) * (ext0(S) + 2.0 + 10), z: S.z + Math.sin(dir) * (ext0(S) + 2.0 + 10), y: TOP_Y, psi: dir, w: 20, d: 20, shape: 'disc', h: 1.4 };
    function ext0(s) { return s.shape === 'disc' ? s.w / 2 : Math.max(s.w, s.d) / 2; }
    P.c = Math.cos(dir); P.s = Math.sin(dir); P.ry = -dir;
    this.addCollider({ kind: 1, x: P.x, y: P.y - 0.7, z: P.z, r: 10, hy: 0.7 });
    DECOR[7].slab(ctx, P);
    // the great blossom tree + light beam
    const x = P.x, z = P.z, y = P.y;
    b.cyl(M.bark, 0.7, 1.4, 8, x, y + 4, z, 10, 1);
    for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, r = 2.6; b.sphere(M.cherry, 3.0, x + Math.cos(a) * r, y + 8.5 + (k % 2), z + Math.sin(a) * r, 1, 0.8, 1, rr(0.9, 1.2), 10); }
    b.sphere(M.cherry, 3.8, x, y + 10.5, z, 1, 0.8, 1, 1.1, 12);
    b.sphere(M.glow(0xffe9a8, 3.5), 0.9, x, y + 13.7, z, 1, 1, 1, 1, 12);
    b.cyl(M.glow(0xffe9a8, 1.1), 0.5, 0.5, 120, x, y + 70, z, 8, 0.5);
    this.lamps.push({ x, y: y + 6, z, col: 0xffe0a0, int: 4, dist: 40 });
    // flower ring
    for (let k = 0; k < 160; k++) {
      const a = rnd() * TAU, r = rr(2.5, 9.5);
      const col = [0xffffff, 0xffd84a, 0xff7aa8, 0xff9ac0, 0xb48cff][(rnd() * 5) | 0];
      b.sphere(M.flat(col, 0.7, 0), 0.09, x + Math.cos(a) * r, y + 0.32, z + Math.sin(a) * r, 1, 0.8, 1, 1, 5);
    }
    this.summit = { x, y: y + 0.2, z, r: 9 };
  }
}
