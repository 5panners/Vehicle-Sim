// Character controller: capsule-ish cylinder vs oriented boxes / cylinders, ladders, pads, moving platforms.
import * as THREE from 'three';
import { GRAV } from './world.js';

export const R = 0.34, H = 1.75;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Player {
  constructor(world) {
    this.w = world;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.onGround = false; this.ground = null; this.slip = false;
    this.yaw = 0; this.climb = null; this.coyote = 0; this.jumpBuf = 0; this.padCD = 0;
    this.jumping = false; this.anim = 'idle'; this.speed = 0; this.list = [];
    this.events = [];
  }
  teleport(x, y, z, yaw) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.ground = null; this.onGround = false; this.climb = null;
    if (yaw !== undefined) this.yaw = yaw;
  }
  _ladderAt() {
    const p = this.pos;
    for (const l of this.w.ladders) {
      if (Math.abs(p.x - l.x) > 2 || Math.abs(p.z - l.z) > 2) continue;
      if (p.y + 0.9 < l.y - l.hy || p.y > l.y + l.hy) continue;
      const dx = p.x - l.x, dz = p.z - l.z, lx = dx * l.c + dz * l.s, lz = -dx * l.s + dz * l.c;
      if (Math.abs(lx) < l.hx + 0.2 && Math.abs(lz) < l.hz) return l;
    }
    return null;
  }

  step(dt, inp, camYaw) {
    const p = this.pos, v = this.vel;
    this.padCD = Math.max(0, this.padCD - dt);
    // ride moving platform
    const g = this.ground;
    if (g && g.moving && this.onGround) {
      const dx = p.x - g.px, dz = p.z - g.pz;
      const lx = dx * g.pc + dz * g.ps, lz = -dx * g.ps + dz * g.pc;
      p.x = g.x + lx * g.c - lz * g.s; p.z = g.z + lx * g.s + lz * g.c; p.y = Math.max(p.y, g.top);
    }
    // desired direction
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * inp.mz + rx * inp.mx, dz = fz * inp.mz + rz * inp.mx;
    const dl = Math.hypot(dx, dz); if (dl > 1) { dx /= dl; dz /= dl; }

    this.jumpBuf = inp.jumpPressed ? 0.14 : Math.max(0, this.jumpBuf - dt);

    // ---- ladder
    const lad = this._ladderAt();
    if (!this.climb && lad && inp.mz > 0.3 && v.y < 6) this.climb = lad;
    if (this.climb) {
      const l = this.climb;
      if (!lad) this.climb = null;
      else {
        v.set(0, inp.mz * 3.6, 0);
        // glide to rail centre
        const tx = l.x + (p.x - l.x) * 0, tz = l.z;
        p.x += (l.x - p.x) * Math.min(1, dt * 8) * 0.6; p.z += (l.z - p.z) * Math.min(1, dt * 8) * 0.6;
        this.yaw = Math.atan2(l.ux, l.uz);
        if (inp.jumpPressed) { v.set(-l.ux * 5, 8, -l.uz * 5); this.climb = null; this.events.push('jump'); this.jumpBuf = 0; }
        else if (p.y >= l.topY - 0.1 && inp.mz > 0) { v.set(l.ux * 4.5, 6.5, l.uz * 4.5); this.climb = null; this.events.push('jump'); }
        else if (inp.mz < 0 && this.onGround) this.climb = null;
        if (this.climb) { this.anim = 'climb'; this.speed = Math.abs(inp.mz); this._move(dt); return; }
      }
    }

    // ---- ground / air control
    const speed = inp.sprint ? 9.8 : 6.6;
    const wantX = dx * speed, wantZ = dz * speed;
    const has = dl > 0.05;
    let acc;
    if (this.onGround) acc = this.slip ? (has ? 7 : 1.6) : (has ? 62 : 48);
    else acc = has ? 17 : 0.8;
    let ex = wantX - v.x, ez = wantZ - v.z; const el = Math.hypot(ex, ez), mx = acc * dt;
    if (el > mx) { ex *= mx / el; ez *= mx / el; }
    v.x += ex; v.z += ez;

    // gravity
    v.y -= GRAV * dt * (v.y < 0 ? 1.18 : 1);
    if (v.y < -62) v.y = -62;

    // jump
    if (this.onGround) this.coyote = 0.12; else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuf > 0 && this.coyote > 0) {
      v.y = 10.9; this.onGround = false; this.coyote = 0; this.jumpBuf = 0; this.jumping = true; this.ground = null;
      this.events.push('jump');
    }
    if (this.jumping && !inp.jumpHeld && v.y > 5.2) v.y = 5.2;
    if (v.y <= 0) this.jumping = false;

    // facing
    if (has && !this.climb) {
      const target = Math.atan2(dx, dz);
      let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 14);
    }
    this._move(dt);

    // pads
    if (this.padCD <= 0) {
      for (const pd of this.w.pads) {
        if (Math.abs(p.x - pd.x) > 1.6 || Math.abs(p.z - pd.z) > 1.6) continue;
        if (Math.hypot(p.x - pd.x, p.z - pd.z) < pd.r && p.y > pd.y - 0.5 && p.y < pd.y + 0.5 && v.y < 2) {
          v.y = pd.vy; v.x += pd.ux * 2.4; v.z += pd.uz * 2.4; this.padCD = 0.45; this.onGround = false; this.ground = null; this.events.push('pad');
          break;
        }
      }
    }
    const hs = Math.hypot(v.x, v.z); this.speed = hs;
    if (!this.onGround) this.anim = v.y > 1.5 ? 'jump' : 'fall';
    else this.anim = hs > 0.6 ? 'run' : 'idle';
  }

  _move(dt) {
    const p = this.pos, v = this.vel;
    const dist = Math.hypot(v.x, v.y, v.z) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.3)), sdt = dt / n;
    const wasGround = this.onGround;
    let landed = false, gnd = null;
    const impact = v.y;
    for (let s = 0; s < n; s++) {
      const prevFeet = p.y;
      p.x += v.x * sdt; p.y += v.y * sdt; p.z += v.z * sdt;
      const r = this._collide(prevFeet, sdt, wasGround || landed);
      if (r) { landed = true; gnd = r; }
    }
    this.onGround = landed; this.ground = landed ? gnd : null;
    this.slip = !!(gnd && gnd.slip);
    if (landed && !wasGround && impact < -6) this.events.push('land:' + Math.min(1, -impact / 30).toFixed(2));
  }

  _collide(prevFeet, dt, grounded) {
    const p = this.pos, v = this.vel, list = this.w.query(p.x, p.y, p.z, this.list);
    let landedOn = null;
    const rl = grounded ? R * 1.1 : R * 0.5;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.enabled) continue;
      const feet = p.y, head = p.y + H;
      if (feet >= c.top || head <= c.bot) continue;
      let ex, ez, d2, inside = false, lx = 0, lz = 0, dxw, dzw;
      dxw = p.x - c.x; dzw = p.z - c.z;
      if (c.kind === 1) {
        const dist = Math.hypot(dxw, dzw);
        if (dist > c.r + R) continue;
        // landing
        const tol = grounded ? 0.34 : Math.max(0.08, -v.y * dt + 0.06);
        if (v.y <= 0.01 && prevFeet >= c.top - tol && dist < c.r + rl) { p.y = c.top; v.y = 0; landedOn = c; continue; }
        if (v.y > 0 && p.y + H - v.y * dt <= c.bot + 0.1 && dist < c.r + R * 0.8) { p.y = c.bot - H; v.y = 0; continue; }
        const nx = dist > 1e-5 ? dxw / dist : 1, nz = dist > 1e-5 ? dzw / dist : 0, push = c.r + R - dist;
        if (push > 0) { p.x += nx * push; p.z += nz * push; const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; } }
      } else {
        if (Math.abs(dxw) > c.br + R || Math.abs(dzw) > c.br + R) continue;
        lx = dxw * c.c + dzw * c.s; lz = -dxw * c.s + dzw * c.c;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        ex = lx - qx; ez = lz - qz; d2 = ex * ex + ez * ez;
        inside = Math.abs(lx) < c.hx && Math.abs(lz) < c.hz;
        if (!inside && d2 >= R * R) continue;
        const tol = grounded ? 0.34 : Math.max(0.08, -v.y * dt + 0.06);
        if (v.y <= 0.01 && prevFeet >= c.top - tol && (inside || d2 < rl * rl)) { p.y = c.top; v.y = 0; landedOn = c; continue; }
        if (v.y > 0 && p.y + H - v.y * dt <= c.bot + 0.1 && (inside || d2 < (R * 0.85) * (R * 0.85))) { p.y = c.bot - H; v.y = 0; continue; }
        let nx, nz, push;
        if (inside) {
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { nx = lx > 0 ? 1 : -1; nz = 0; push = px + R; } else { nx = 0; nz = lz > 0 ? 1 : -1; push = pz + R; }
        } else { const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; push = R - d; }
        const wx = nx * c.c - nz * c.s, wz = nx * c.s + nz * c.c;
        p.x += wx * push; p.z += wz * push;
        const vn = v.x * wx + v.z * wz; if (vn < 0) { v.x -= wx * vn; v.z -= wz * vn; }
      }
    }
    return landedOn;
  }
}
