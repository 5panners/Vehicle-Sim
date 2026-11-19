// Per-theme dressing: platform slabs, central-tower sections and distant scenery.
const TAU = Math.PI * 2;
const L = (P, lx, ly, lz) => [P.x + lx * P.c - lz * P.s, P.y + ly, P.z + lx * P.s + lz * P.c];
const radial = (a) => Math.PI / 2 - a; // yaw so that local +z points along (cos a, sin a)
export const CORE_R = 11;

function base(ctx, P, side, top, capH = 0.18, lip = 0.04, sideTint = 1, topTint = 1) {
  const { b } = ctx;
  if (P.shape === 'disc') {
    const r = P.w / 2;
    b.cyl(side, r, r * 0.97, P.h - capH, P.x, P.y - capH - (P.h - capH) / 2, P.z, 22, sideTint);
    b.cyl(top, r + lip, r + lip, capH, P.x, P.y - capH / 2, P.z, 22, topTint);
  } else {
    b.box(side, P.w, P.h - capH, P.d, ...L(P, 0, -capH - (P.h - capH) / 2, 0), P.ry, sideTint);
    b.box(top, P.w + lip * 2, capH, P.d + lip * 2, ...L(P, 0, -capH / 2, 0), P.ry, topTint);
  }
}
function edgePos(ctx, P, m = 0.35) {
  const { rnd } = ctx;
  if (P.shape === 'disc') { const a = rnd() * TAU, r = P.w / 2 - m; return [Math.cos(a) * r, Math.sin(a) * r]; }
  const sg = rnd() < 0.5 ? -1 : 1;
  return [(rnd() - 0.5) * (P.w - 1), sg * (P.d / 2 - m)];
}
const big = (P) => !P.gate && P.w * P.d >= 20 && Math.min(P.w, P.d) >= 3.4;

function tree(ctx, x, y, z, s = 1, cherry = false) {
  const { b, M, rr } = ctx;
  const h = rr(2.6, 3.8) * s;
  b.cyl(M.bark, 0.18 * s, 0.32 * s, h, x, y + h / 2, z, 7, 1);
  const cm = cherry ? M.cherry : M.leaf;
  b.sphere(cm, 1.5 * s, x, y + h + 0.6 * s, z, 1, 0.85, 1, 1, 9);
  b.sphere(cm, 1.0 * s, x + 0.9 * s, y + h + 0.2 * s, z + 0.3 * s, 1, 0.85, 1, 0.9, 8);
  b.sphere(cm, 1.0 * s, x - 0.7 * s, y + h + 0.3 * s, z - 0.5 * s, 1, 0.85, 1, 1.05, 8);
}
function flowers(ctx, P, n, cols) {
  const { b, M, rnd, rr } = ctx;
  for (let k = 0; k < n; k++) {
    const [lx, lz] = edgePos(ctx, P, 0.25);
    const col = cols[(rnd() * cols.length) | 0];
    const p = L(P, lx, 0, lz);
    b.cyl(M.flat(0x3a7a2a, 1, 0), 0.01, 0.015, 0.28, p[0], p[1] + 0.14, p[2], 4);
    b.sphere(M.flat(col, 0.7, 0), 0.075, p[0], p[1] + 0.3, p[2], 1, 0.8, 1, 1, 6);
  }
  for (let k = 0; k < n; k++) {
    const [lx, lz] = edgePos(ctx, P, 0.2);
    const p = L(P, lx, 0, lz), hh = rr(0.25, 0.5);
    b.cyl(M.leaf, 0.0, 0.07, hh, p[0], p[1] + hh / 2, p[2], 4, rr(0.8, 1.2));
  }
}

// -------------------------------------------------------------- NATURE
const nature = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    base(ctx, P, M.moss, M.grass, 0.28, 0.08);
    const R = Math.min(P.w, P.d) * (P.shape === 'disc' ? 0.5 : 0.55), H = rr(2.5, 6);
    b.cyl(M.rock, R, 0.25, H, P.x, P.y - P.h - H / 2 + 0.05, P.z, 7, 0.9, 0, rnd() * 6);
    flowers(ctx, P, 7, [0xffffff, 0xffd84a, 0xff7aa8, 0xb48cff, 0xff9a4a]);
    if (big(P) && rnd() < 0.45) { const p = L(P, -P.w / 2 + 1, 0, (rnd() < 0.5 ? 1 : -1) * (P.d / 2 - 1)); tree(ctx, p[0], p[1], p[2], rr(0.7, 1), rnd() < 0.4); }
    for (let k = 0; k < 4; k++) {
      const [lx, lz] = edgePos(ctx, P, 0.05); const p = L(P, lx, -0.3, lz), hh = rr(1, 3);
      b.box(M.leaf, 0.05, hh, 0.05, p[0], p[1] - hh / 2, p[2], 0, 0.9);
    }
    if (rnd() < 0.18) {
      const [lx, lz] = edgePos(ctx, P, 0.5), p = L(P, lx, 0, lz);
      b.cyl(M.flat(0xe8e0d0, 0.8, 0), 0.07, 0.1, 0.35, p[0], p[1] + 0.17, p[2], 6);
      b.sphere(M.flat(0xd8322a, 0.7, 0), 0.3, p[0], p[1] + 0.4, p[2], 1, 0.55, 1, 1, 9);
    }
    if (rnd() < 0.22) { const [lx, lz] = edgePos(ctx, P, 0.5), p = L(P, lx, 0, lz); b.sphere(M.glow(0xfff0a0, 3), 0.07, p[0], p[1] + 0.9, p[2], 1, 1, 1, 1, 6); ctx.lamp(p[0], p[1] + 0.9, p[2], 0xffe9a0, 1.2, 12); }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const r = CORE_R + rr(-0.8, 0.8);
    b.cyl(M.moss, r * 0.95, r, h + 0.2, 0, y + h / 2, 0, 16, 1);
    for (let k = 0; k < 4; k++) {
      const a = rnd() * TAU, hy = y + rr(1, h - 1), rr2 = rr(2, 4);
      b.cyl(M.rock, rr2 * 0.6, rr2, rr(2, 4), Math.cos(a) * (r - 0.5), hy, Math.sin(a) * (r - 0.5), 6, 0.9, 0, rnd() * 6);
    }
    for (let k = 0; k < 6; k++) { const a = rnd() * TAU, hh = rr(4, 12); b.box(M.leaf, 0.4, hh, 0.08, Math.cos(a) * (r + 0.1), y + h - hh / 2, Math.sin(a) * (r + 0.1), radial(a), 0.9); }
    if (rnd() < 0.7) { const a = rnd() * TAU, hh = rr(14, h); b.box(M.glow(0xc4e8ff, 1.1), 1.4, hh, 0.2, Math.cos(a) * (r + 0.05), y + h - hh / 2 + 0.2, Math.sin(a) * (r + 0.05), radial(a)); }
    // leafy shelf with a tree
    b.cyl(M.grass, r + 2.5, r + 2, 0.7, 0, y + h - 0.35, 0, 18, 1);
    for (let k = 0; k < 2; k++) { const a = rnd() * TAU; tree(ctx, Math.cos(a) * (r + 1.2), y + h, Math.sin(a) * (r + 1.2), rr(1, 1.5), rnd() < 0.5); }
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 10; k++) {
      const a = rnd() * TAU, d = rr(80, 230), y = rr(y0 - 10, y1), r = rr(8, 22);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.cyl(M.rock, r, 1.5, r * 1.2, x, y - r * 0.6, z, 9, 0.9);
      b.cyl(M.grass, r + 0.4, r + 0.4, 0.6, x, y + 0.1, z, 14);
      for (let t = 0; t < 3; t++) tree(ctx, x + rr(-r * 0.5, r * 0.5), y + 0.3, z + rr(-r * 0.5, r * 0.5), rr(1.5, 3), rnd() < 0.3);
      if (rnd() < 0.5) b.box(M.glow(0xc4e8ff, 1.0), 2, r * 3, 0.2, x + r * 0.6, y - r * 1.4, z, radial(a));
    }
  },
};

// -------------------------------------------------------------- INDUSTRIAL
const industrial = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    base(ctx, P, M.steel, M.grating, 0.12, 0.03, 0.85, 1);
    if (P.shape === 'box') {
      for (const sg of [-1, 1]) b.box(M.hazard, 0.45, 0.04, P.d, ...L(P, sg * (P.w / 2 - 0.22), 0.02, 0), P.ry);
      // underslung I-beam
      b.box(M.rust, P.w * 0.92, 0.5, 0.14, ...L(P, 0, -P.h - 0.25, 0), P.ry, 0.9);
      b.box(M.rust, P.w * 0.92, 0.07, 0.5, ...L(P, 0, -P.h - 0.04, 0), P.ry, 0.9);
      b.box(M.rust, P.w * 0.92, 0.07, 0.5, ...L(P, 0, -P.h - 0.5, 0), P.ry, 0.9);
      if (P.d >= 2.6 && rnd() < 0.6) {
        const sg = rnd() < 0.5 ? -1 : 1;
        for (let x = -P.w / 2 + 0.2; x <= P.w / 2 - 0.1; x += 1.4) b.box(M.steel, 0.06, 1.0, 0.06, ...L(P, x, 0.5, sg * (P.d / 2 - 0.08)), P.ry);
        b.box(M.steel, P.w, 0.06, 0.06, ...L(P, 0, 1.0, sg * (P.d / 2 - 0.08)), P.ry);
        b.box(M.steel, P.w, 0.05, 0.05, ...L(P, 0, 0.5, sg * (P.d / 2 - 0.08)), P.ry);
      }
    } else {
      b.cyl(M.rust, P.w * 0.3, P.w * 0.1, 1.6, P.x, P.y - P.h - 0.8, P.z, 10, 0.9);
    }
    if (big(P)) {
      for (let k = 0; k < 2; k++) {
        const [lx, lz] = edgePos(ctx, P, 0.5), p = L(P, lx, 0, lz);
        if (rnd() < 0.6) b.cyl(M.rust, 0.3, 0.3, 0.9, p[0], p[1] + 0.45, p[2], 10, rr(0.8, 1.1));
        else b.box(M.wood, 0.8, 0.8, 0.8, p[0], p[1] + 0.4, p[2], rnd() * 3);
      }
    }
    if (rnd() < 0.5) { // hanging chain
      const [lx, lz] = edgePos(ctx, P, 0.1), p = L(P, lx, -P.h, lz), hh = rr(2, 5);
      b.cyl(M.steel, 0.025, 0.025, hh, p[0], p[1] - hh / 2, p[2], 4, 0.7);
      b.torus(M.steel, 0.14, 0.03, p[0], p[1] - hh - 0.1, p[2], 0, rnd() * 3, 0, 0.8, 8);
    }
    if (P.w * P.d >= 12 && rnd() < 0.4) { // work lamp
      const [lx, lz] = edgePos(ctx, P, 0.2), p = L(P, lx, 0, lz);
      b.cyl(M.steel, 0.04, 0.05, 2.4, p[0], p[1] + 1.2, p[2], 5);
      b.box(M.glow(0xffb55a, 3.5), 0.4, 0.14, 0.3, p[0], p[1] + 2.45, p[2], P.ry);
      ctx.lamp(p[0], p[1] + 2.2, p[2], 0xffa64a, 2.2, 22);
    }
    if (rnd() < 0.25) { const p = L(P, 0, -P.h - 0.6, (rnd() < .5 ? 1 : -1) * Math.min(P.d, 1.4) * 0.5); b.cyl(M.steel, 0.12, 0.12, P.w * 0.8, p[0], p[1], p[2], 8, 1, 0, P.ry, Math.PI / 2); }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const r = CORE_R + rr(-0.5, 1.2);
    const kind = (rnd() * 3) | 0;
    b.cyl(kind === 1 ? M.steel : M.rust, r, r, h, 0, y + h / 2, 0, 20, kind === 1 ? 0.9 : 1);
    for (let k = 0; k < 3; k++) b.cyl(M.steel, r + 0.35, r + 0.35, 0.5, 0, y + (h * (k + 0.5)) / 3, 0, 20, 0.9);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + y; // furnace windows
      b.box(M.glow(0xff7a22, 3), 1.3, 2, 0.12, Math.cos(a) * (r + 0.05), y + h * 0.4, Math.sin(a) * (r + 0.05), radial(a));
    }
    for (let k = 0; k < 3; k++) { const a = rnd() * TAU; b.cyl(M.steel, 0.5, 0.5, h, Math.cos(a) * (r + 0.6), y + h / 2, Math.sin(a) * (r + 0.6), 8, 1); for (let q = 0; q < 4; q++) b.cyl(M.rust, 0.7, 0.7, 0.2, Math.cos(a) * (r + 0.6), y + (h * (q + 0.5)) / 4, Math.sin(a) * (r + 0.6), 8); }
    b.cyl(M.grating, r + 2.6, r + 2.6, 0.15, 0, y + h - 0.07, 0, 24, 1);
    for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; b.box(M.steel, 0.05, 1, 0.05, Math.cos(a) * (r + 2.5), y + h + 0.5, Math.sin(a) * (r + 2.5), 0); }
    b.torus(M.steel, r + 2.5, 0.04, 0, y + h + 1, 0, Math.PI / 2, 0, 0, 1, 40);
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 9; k++) {
      const a = rnd() * TAU, d = rr(90, 240), x = Math.cos(a) * d, z = Math.sin(a) * d, hh = rr(60, 160), r = rr(3, 7), yb = y0 - 30;
      b.cyl(M.rust, r * 0.7, r, hh, x, yb + hh / 2, z, 10);
      b.cyl(M.hazard, r * 0.72, r * 0.72, 3, x, yb + hh - 4, z, 10);
      b.box(M.glow(0xff7a22, 3), 1.2, 1.2, 0.2, x, yb + hh * 0.5, z + r * 0.9, 0);
      if (rnd() < 0.5) b.cyl(M.steel, 1, 1, 80, x + 12, yb + hh * 0.6, z, 8, 1, 0, 0, Math.PI / 2);
    }
  },
};

// -------------------------------------------------------------- WAR
const war = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    base(ctx, P, M.concrete, rnd() < 0.5 ? M.wood : M.olive, 0.2, 0.03, 0.75, 0.95);
    if (P.shape === 'box') {
      b.box(M.steel, P.w * 0.9, 0.35, 0.18, ...L(P, 0, -P.h - 0.17, 0), P.ry, 0.8);
      if (P.d >= 2.4 && rnd() < 0.65) { // sandbag wall
        const sg = rnd() < 0.5 ? -1 : 1, n = Math.floor((P.w - 0.6) / 0.85);
        for (let k = 0; k < n; k++) for (let row = 0; row < 2; row++) {
          if (row === 1 && k === n - 1) continue;
          b.box(M.sandbag, 0.8, 0.3, 0.5, ...L(P, -P.w / 2 + 0.5 + k * 0.85 + row * 0.42, 0.15 + row * 0.3, sg * (P.d / 2 - 0.3)), P.ry, rr(0.85, 1.05));
        }
        b.torus(M.steel, 0.28, 0.012, ...L(P, -P.w / 2 + 1, 0.95, sg * (P.d / 2 - 0.3)), 0, P.ry + Math.PI / 2, 0, 0.5, 8);
      }
    }
    if (big(P)) {
      const r = rnd();
      if (r < 0.28) { // hedgehog
        const p = L(P, -P.w / 2 + 1, 0, (rnd() < .5 ? 1 : -1) * (P.d / 2 - 0.7));
        for (const [rx, rz] of [[0.8, 0.3], [-0.7, 0.9], [0.2, -0.9]]) b.box(M.rust, 1.4, 0.12, 0.12, p[0], p[1] + 0.5, p[2], rnd() * 3, 1, rx, rz);
      } else if (r < 0.5 && P.w >= 6) { // tank wreck
        const p = L(P, -P.w / 2 + 2.2, 0, (P.d / 2 - 1.2));
        b.box(M.olive, 3.4, 0.9, 1.7, p[0], p[1] + 0.65, p[2], P.ry, 0.8);
        b.box(M.steel, 3.5, 0.5, 0.3, p[0], p[1] + 0.3, p[2] + 0.9, P.ry, 0.5); b.box(M.steel, 3.5, 0.5, 0.3, p[0], p[1] + 0.3, p[2] - 0.9, P.ry, 0.5);
        b.cyl(M.olive, 0.75, 0.8, 0.5, p[0], p[1] + 1.35, p[2], 10, 0.75);
        const bx = L(P, -P.w / 2 + 2.2 + 1.7, 1.45, P.d / 2 - 1.2);
        b.strut(M.steel, p[0], p[1] + 1.45, p[2], bx[0], bx[1] + 0.3, bx[2], 0.16, 0.6);
      } else if (r < 0.75) { // fire barrel
        const [lx, lz] = edgePos(ctx, P, 0.6), p = L(P, lx, 0, lz);
        b.cyl(M.rust, 0.3, 0.3, 0.9, p[0], p[1] + 0.45, p[2], 10);
        b.sphere(M.flame, 0.22, p[0], p[1] + 1.0, p[2], 1, 1.4, 1, 1, 6);
        ctx.lamp(p[0], p[1] + 1.2, p[2], 0xff7a28, 3.0, 24); ctx.fires.push([p[0], p[1] + 1.1, p[2]]);
      }
    }
    if (rnd() < 0.25) { // flag
      const [lx, lz] = edgePos(ctx, P, 0.3), p = L(P, lx, 0, lz);
      b.cyl(M.steel, 0.04, 0.04, 3.5, p[0], p[1] + 1.75, p[2], 5);
      b.box(M.flat(rnd() < 0.5 ? 0x9a1c1c : 0x2c3a56, 0.9, 0), 1.1, 0.7, 0.03, p[0] + 0.6 * P.s, p[1] + 3.1, p[2] - 0.6 * P.c, P.ry + 0.3);
    }
    if (rnd() < 0.2) { // crates
      const [lx, lz] = edgePos(ctx, P, 0.6), p = L(P, lx, 0, lz);
      b.box(M.wood, 0.9, 0.9, 0.9, p[0], p[1] + 0.45, p[2], rnd() * 3); b.box(M.wood, 0.7, 0.7, 0.7, p[0], p[1] + 1.25, p[2], rnd() * 3);
    }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const r = CORE_R + 1;
    b.cyl(M.concrete, r, r + 0.4, h, 0, y + h / 2, 0, 8, 0.9);
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * TAU + Math.PI / 8 * 0;
      b.box(M.concrete, 1.6, h, 1.8, Math.cos(a) * (r + 0.3), y + h / 2, Math.sin(a) * (r + 0.3), radial(a), 0.85);
      b.box(M.flat(0x0a0a0a, 1, 0), 2.6, 0.35, 0.1, Math.cos(a + 0.2) * (r + 0.5), y + h * 0.55, Math.sin(a + 0.2) * (r + 0.5), radial(a + 0.2));
    }
    b.cyl(M.concrete, r + 2.2, r + 2.2, 0.8, 0, y + h - 0.4, 0, 8, 0.8);
    for (let k = 0; k < 3; k++) { // flak guns
      const a = rnd() * TAU, px = Math.cos(a) * (r + 1.8), pz = Math.sin(a) * (r + 1.8);
      b.cyl(M.olive, 0.9, 1, 0.7, px, y + h + 0.35, pz, 8, 0.8);
      b.strut(M.steel, px, y + h + 0.8, pz, px + Math.cos(a) * 3, y + h + 3.4, pz + Math.sin(a) * 3, 0.22, 0.6);
    }
    const a = rnd() * TAU; b.cyl(M.steel, 0.1, 0.1, 1.5, Math.cos(a) * (r + 0.6), y + h * 0.7, Math.sin(a) * (r + 0.6), 6);
    b.box(M.glow(0xfff0c8, 4), 0.8, 0.5, 0.5, Math.cos(a) * (r + 0.9), y + h * 0.7 + 0.8, Math.sin(a) * (r + 0.9), radial(a));
    ctx.lamp(Math.cos(a) * (r + 1.2), y + h * 0.7 + 0.8, Math.sin(a) * (r + 1.2), 0xfff0c8, 3, 30);
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 9; k++) {
      const a = rnd() * TAU, d = rr(80, 220), x = Math.cos(a) * d, z = Math.sin(a) * d, y = rr(y0, y1), s = rr(1.5, 3);
      b.sphere(M.olive, 14 * s, x, y, z, 1, 0.38, 0.38, 0.8, 14, rnd() * 3);
      b.box(M.rust, 2 * s, 10 * s * 0.4, 0.4, x - 12 * s, y + 3 * s, z, 0);
      b.cyl(M.rust, 0.8, 0.8, 10 * s, x + rr(-6, 6), y - 5 * s - 20, z + rr(-6, 6), 6, 0.4);
      b.sphere(M.flame, 0.8, x + 5 * s, y - 2 * s, z + 3, 1, 1, 1, 1, 6);
    }
  },
};

// -------------------------------------------------------------- APOC
const apoc = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    base(ctx, P, M.concrete, M.concrete, 0.2, 0.02, [0.8, 0.72, 0.65], [0.62, 0.6, 0.58]);
    for (let k = 0; k < 6; k++) { // rebar
      const [lx, lz] = edgePos(ctx, P, 0.05), p = L(P, lx, -0.1, lz), sg = lz > 0 ? 1 : -1;
      const q = L(P, lx + rr(-0.4, 0.4), 0.5, lz + sg * rr(0.4, 1.0));
      b.strut(M.rust, p[0], p[1], p[2], q[0], q[1], q[2], 0.045, 0.9);
    }
    for (let k = 0; k < 3; k++) { // hanging chunks
      const [lx, lz] = edgePos(ctx, P, 0.3), p = L(P, lx, -P.h, lz), s = rr(0.5, 1.4);
      b.box(M.concrete, s, s, s, p[0], p[1] - s / 2, p[2], rnd() * 3, 0.7, rnd() * 0.6, rnd() * 0.6);
    }
    if (P.shape === 'box' && rnd() < 0.5) for (let k = 0; k < 3; k++) b.box(M.flat(0xd9b43a, 0.8, 0), 1, 0.02, 0.12, ...L(P, -P.w / 2 + 1 + k * (P.w / 3), 0.01, 0), P.ry);
    if (!P.gate && P.w >= 6 && P.d >= 3.2 && rnd() < 0.5) { // wrecked car
      const col = [0x7a3a22, 0x4a5a66, 0x6a6a30, 0x5a2020][(rnd() * 4) | 0], p = L(P, -P.w / 2 + 2.2, 0, P.d / 2 - 1.05);
      b.box(M.flat(col, 0.7, 0.3), 3.6, 0.6, 1.6, p[0], p[1] + 0.55, p[2], P.ry, 0.8);
      b.box(M.flat(col, 0.7, 0.3), 1.9, 0.55, 1.4, p[0] + P.c * -0.1, p[1] + 1.1, p[2] - P.s * 0.1, P.ry, 0.75);
      b.box(M.flat(0x0b0e12, 0.3, 0.5), 1.7, 0.35, 1.45, p[0] - P.c * 0.1, p[1] + 1.12, p[2] - P.s * 0.1, P.ry);
      for (const [wx, wz] of [[1.1, 0.8], [-1.1, 0.8], [1.1, -0.8], [-1.1, -0.8]]) b.cyl(M.flat(0x111111, 0.9, 0), 0.34, 0.34, 0.22, p[0] + wx * P.c - wz * P.s, p[1] + 0.34, p[2] + wx * P.s + wz * P.c, 10, 1, Math.PI / 2, P.ry, 0);
    }
    if (rnd() < 0.3) { const [lx, lz] = edgePos(ctx, P, 0.5), p = L(P, lx, 0, lz); for (let k = 0; k < 3; k++) b.torus(M.flat(0x151515, 0.9, 0), 0.4, 0.17, p[0], p[1] + 0.17 + k * 0.32, p[2], Math.PI / 2, 0, 0, 1, 10); }
    if (rnd() < 0.3) { const [lx, lz] = edgePos(ctx, P, 0.3), p = L(P, lx, 0, lz); b.cyl(M.rust, 0.04, 0.04, 2.6, p[0], p[1] + 1.3, p[2], 5); b.box(M.rust, 0.9, 0.9, 0.04, p[0], p[1] + 2.5, p[2], P.ry + rr(-0.3, 0.3), 0.9, 0, rr(-0.3, 0.3)); }
    if (rnd() < 0.3) { // fire barrel
      const [lx, lz] = edgePos(ctx, P, 0.5), p = L(P, lx, 0, lz);
      b.cyl(M.rust, 0.3, 0.3, 0.9, p[0], p[1] + 0.45, p[2], 10);
      b.sphere(M.flame, 0.22, p[0], p[1] + 1.0, p[2], 1, 1.4, 1, 1, 6);
      ctx.lamp(p[0], p[1] + 1.2, p[2], 0xff8a30, 2.8, 22); ctx.fires.push([p[0], p[1] + 1.1, p[2]]);
    }
    if (rnd() < 0.2) { const [lx, lz] = edgePos(ctx, P, 0.1), p = L(P, lx, -0.1, lz); b.box(M.flat([0x7a5a2a, 0x3a5a4a, 0x6a2a2a][(rnd() * 3) | 0], 1, 0), 1.6, 1.4, 0.02, p[0], p[1] - 0.7, p[2], P.ry, 1, 0, rr(-0.1, 0.1)); }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const w = CORE_R * 1.85;
    const kind = rnd() < 0.3;
    b.box(M.windows, w, h, w, 0, y + h / 2, 0, 0, 0.9);
    if (kind) { b.box(M.concrete, w * 0.55, 3, w * 0.55, w * 0.38, y + h + 1.5, w * 0.2, 0, 0.7); }
    for (let k = 0; k < 3; k++) { // protruding floors
      const fy = y + rr(2, h - 1);
      b.box(M.concrete, w + rr(1, 3), 0.5, w + rr(1, 3), 0, fy, 0, 0, 0.75);
    }
    for (let k = 0; k < 5; k++) { // exposed girders
      const a = rnd() * TAU, L2 = rr(3, 7);
      b.strut(M.rust, Math.cos(a) * w * 0.5, y + rr(1, h), Math.sin(a) * w * 0.5, Math.cos(a) * (w * 0.5 + L2), y + rr(0, h) + L2 * 0.4, Math.sin(a) * (w * 0.5 + L2), 0.35, 0.9);
    }
    b.box(M.flat(0x8a8a82, 0.9, 0), w + 0.4, 0.6, w + 0.4, 0, y + h + 0.3, 0, 0, 0.7);
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 8; k++) {
      const a = rnd() * TAU, d = rr(90, 230), x = Math.cos(a) * d, z = Math.sin(a) * d, y = rr(y0 - 20, y1);
      if (rnd() < 0.5) { // skyscraper husk
        const hh = rr(70, 150), w = rr(12, 20);
        b.box(M.windows, w, hh, w, x, y - hh * 0.4, z, rnd() * 3, 0.6, 0, 0.04 * (rnd() - 0.5));
      } else { // floating highway slab
        b.box(M.concrete, rr(30, 60), 2, 10, x, y, z, rnd() * 3, 0.6, rr(-0.15, 0.15), rr(-0.15, 0.15));
        b.box(M.flat(0xd9b43a, 0.8, 0), 20, 0.05, 0.3, x, y + 1.05, z, 0);
      }
    }
  },
};

// -------------------------------------------------------------- VICTORIAN CYBERPUNK
const victorian = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    base(ctx, P, M.brass, M.wood, 0.16, 0.05, 0.85, 0.9);
    const neon = [0xff2fb0, 0x20e8ff, 0xffa020][(rnd() * 3) | 0];
    if (P.shape === 'box') {
      b.box(M.glow(neon, 3), P.w + 0.1, 0.05, 0.05, ...L(P, 0, -P.h * 0.5, P.d / 2 + 0.07), P.ry);
      b.box(M.glow(neon, 3), P.w + 0.1, 0.05, 0.05, ...L(P, 0, -P.h * 0.5, -P.d / 2 - 0.07), P.ry);
      if (P.d >= 2.4) for (const sg of [-1, 1]) {
        for (let x = -P.w / 2 + 0.15; x <= P.w / 2 - 0.05; x += 0.9) {
          b.cyl(M.brass, 0.025, 0.025, 0.9, ...L(P, x, 0.45, sg * (P.d / 2 - 0.08)), 5);
        }
        b.box(M.brass, P.w, 0.06, 0.06, ...L(P, 0, 0.92, sg * (P.d / 2 - 0.08)), P.ry);
      }
    } else b.torus(M.glow(neon, 3), P.w / 2 + 0.05, 0.03, P.x, P.y - P.h * 0.5, P.z, Math.PI / 2, 0, 0, 1, 28);
    if (P.w * P.d >= 8 && rnd() < 0.5) { // gas lamp
      const [lx, lz] = edgePos(ctx, P, 0.2), p = L(P, lx, 0, lz);
      b.cyl(M.brass, 0.04, 0.07, 2.8, p[0], p[1] + 1.4, p[2], 6, 0.7);
      b.sphere(M.glow(0xffc26a, 4), 0.2, p[0], p[1] + 2.9, p[2], 1, 1.2, 1, 1, 8);
      b.cyl(M.brass, 0.3, 0.1, 0.18, p[0], p[1] + 3.15, p[2], 6, 0.8);
      ctx.lamp(p[0], p[1] + 2.9, p[2], 0xffb860, 2.6, 24);
    }
    if (rnd() < 0.3) { // neon sign
      const [lx, lz] = edgePos(ctx, P, 0.15), p = L(P, lx, 0, lz), c = [0xff2fb0, 0x20e8ff][(rnd() * 2) | 0];
      b.box(M.glow(c, 3.5), 1.3, 0.38, 0.05, p[0], p[1] + 1.4, p[2], P.ry);
      b.cyl(M.brass, 0.03, 0.03, 1.2, p[0], p[1] + 0.6, p[2], 5);
      ctx.lamp(p[0], p[1] + 1.4, p[2], c, 2.0, 18);
    }
    if (rnd() < 0.35) { const [lx, lz] = edgePos(ctx, P, 0.1); const p = L(P, lx, -P.h * 0.5, lz); ctx.gear(p[0], p[1], p[2] + (lz > 0 ? 0.25 : -0.25) * 0, rr(0.7, 1.5), (rnd() < 0.5 ? 1 : -1) * rr(0.4, 1), P.ry); }
    if (rnd() < 0.35) b.cyl(M.brass, 0.1, 0.1, P.w * 0.85, ...L(P, 0, -P.h - 0.3, (rnd() < 0.5 ? 1 : -1) * P.d * 0.3), 8, 0.9, 0, P.ry, Math.PI / 2);
    if (rnd() < 0.3) { const [lx, lz] = edgePos(ctx, P, 0.1), p = L(P, lx, -P.h, lz), hh = rr(1.5, 3.5); b.cyl(M.brass, 0.02, 0.02, hh, p[0], p[1] - hh / 2, p[2], 4); b.sphere(M.glow(0xffc26a, 3), 0.13, p[0], p[1] - hh - 0.1, p[2], 1, 1.3, 1, 1, 6); }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const w = CORE_R * 1.8;
    b.box(M.brick, w, h, w, 0, y + h / 2, 0, 0, 0.9);
    for (let k = 0; k < 3; k++) b.box(M.brass, w + 0.5, 0.45, w + 0.5, 0, y + (h * (k + 0.5)) / 3, 0, 0, 0.9);
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * TAU, nx = Math.cos(a), nz = Math.sin(a), dd = w / 2 + 0.06;
      if (rnd() < 0.55) { // clock face
        const cy = y + h * 0.5, g = new Float32Array(0);
        b.box(M.clock, 9, 9, 0.12, nx * dd, cy, nz * dd, radial(a), 1);
        ctx.lamp(nx * (dd + 2), cy, nz * (dd + 2), 0xffe0a0, 2.0, 24);
      }
      for (let k = -1; k <= 1; k += 2) { // gothic windows
        const px = nx * dd + -nz * k * 6, pz = nz * dd + nx * k * 6;
        b.box(M.glow(0xffb350, 2.6), 1.4, 3.4, 0.1, px, y + h * 0.18 + 1.7, pz, radial(a));
        b.cyl(M.glow(0xffb350, 2.6), 0.7, 0.7, 0.1, px, y + h * 0.18 + 3.4, pz, 8, 1, Math.PI / 2, radial(a), 0);
      }
    }
    for (let q = 0; q < 4; q++) { // corner turrets
      const a = (q / 4) * TAU + Math.PI / 4, tx = Math.cos(a) * w * 0.72, tz = Math.sin(a) * w * 0.72;
      b.cyl(M.brass, 1.1, 1.3, h, tx, y + h / 2, tz, 8, 0.85);
      b.cyl(M.brass, 0.0, 1.6, 2.4, tx, y + h + 1.2, tz, 8, 1);
    }
    if (rnd() < 0.7) { const a = rnd() * TAU; ctx.gear(Math.cos(a) * (w / 2 + 3), y + h * 0.5, Math.sin(a) * (w / 2 + 3), rr(4, 6), rr(0.2, 0.4) * (rnd() < 0.5 ? 1 : -1), radial(a)); }
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 7; k++) { // distant airships (static hulls; a couple animate separately)
      const a = rnd() * TAU, d = rr(100, 240), x = Math.cos(a) * d, z = Math.sin(a) * d, y = rr(y0, y1);
      b.sphere(M.brass, 11, x, y, z, 2.6, 0.8, 0.8, 0.75, 14, a);
      b.box(M.flat(0x3a1c4a, 0.6, 0.3), 5, 1.4, 1.6, x, y - 10, z, a);
      for (let i = -3; i <= 3; i++) b.box(M.glow(0xffc26a, 2.5), 0.5, 0.5, 0.1, x + Math.cos(a) * i * 2, y - 10, z + Math.sin(a) * i * 2, a + Math.PI / 2 * 0);
      b.box(M.glow([0xff2fb0, 0x20e8ff][k % 2], 3), 0.1, 3, 3, x - Math.cos(a) * 26, y + 5, z - Math.sin(a) * 26, a);
    }
  },
};

// -------------------------------------------------------------- FROZEN
const frozen = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    P.slip = true;
    base(ctx, P, M.frost, M.snow, 0.32, 0.12, 0.95, 1);
    const n = 5 + ((rnd() * 5) | 0);
    for (let k = 0; k < n; k++) { // icicles
      const [lx, lz] = edgePos(ctx, P, 0.08), p = L(P, lx, -P.h, lz), hh = rr(0.6, 2.4);
      b.cyl(M.ice, 0.13, 0.0, hh, p[0], p[1] - hh / 2, p[2], 5, 1);
    }
    for (let k = 0; k < 3; k++) { // ice crystals
      const [lx, lz] = edgePos(ctx, P, 0.35), p = L(P, lx, 0, lz), hh = rr(0.5, 1.5);
      b.cyl(M.ice, 0.0, 0.2, hh, p[0], p[1] + hh / 2, p[2], 5, 1.1, rr(-0.2, 0.2), 0, rr(-0.2, 0.2));
    }
    const [lx, lz] = edgePos(ctx, P, 0.4), p = L(P, lx, 0, lz);
    b.sphere(M.snow, rr(0.5, 0.9), p[0], p[1], p[2], 1.3, 0.5, 1, 1, 8);
    if (P.shape === 'box') b.cyl(M.frost, 0.12, 0.12, P.w * 0.9, ...L(P, 0, -P.h - 0.3, P.d * 0.3), 8, 1, 0, P.ry, Math.PI / 2);
    if (P.w * P.d >= 9 && rnd() < 0.4) {
      const [a2, c2] = edgePos(ctx, P, 0.2), q = L(P, a2, 0, c2);
      b.cyl(M.frost, 0.04, 0.06, 2.4, q[0], q[1] + 1.2, q[2], 5);
      b.sphere(M.glow(0x7ad0ff, 4), 0.18, q[0], q[1] + 2.5, q[2], 1, 1, 1, 1, 8);
      ctx.lamp(q[0], q[1] + 2.5, q[2], 0x7ad0ff, 2.4, 22);
    }
    if (rnd() < 0.25) { const [a2, c2] = edgePos(ctx, P, 0.6), q = L(P, a2, 0, c2); b.box(M.ice, 0.9, 0.9, 0.9, q[0], q[1] + 0.4, q[2], rnd() * 3, 1, 0.1, 0.2); }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const t0 = (y / 40) % 6.28, rA = CORE_R * (1 + 0.28 * Math.cos(t0)), rB = CORE_R * (1 + 0.28 * Math.cos(t0 + (h / 40)));
    b.cyl(M.frost, rB, rA, h, 0, y + h / 2, 0, 22, 0.95);
    b.cyl(M.snow, rB + 0.6, rB + 0.6, 0.9, 0, y + h - 0.2, 0, 22);
    for (let k = 0; k < 16; k++) { // icicle fringe
      const a = (k / 16) * TAU, hh = rr(1.5, 5);
      b.cyl(M.ice, 0.3, 0.0, hh, Math.cos(a) * (rA + 0.5), y - hh / 2 + 0.3, Math.sin(a) * (rA + 0.5), 5);
    }
    for (let k = 0; k < 6; k++) { const a = rnd() * TAU; b.box(M.glow(0x7ad8ff, 2.6), 1.2, 2.2, 0.1, Math.cos(a) * (rA + 0.05), y + h * 0.5, Math.sin(a) * (rA + 0.05), radial(a)); }
    for (let k = 0; k < 3; k++) { const a = rnd() * TAU; b.cyl(M.frost, 0.5, 0.5, h, Math.cos(a) * (rA + 0.5), y + h / 2, Math.sin(a) * (rA + 0.5), 8); }
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 10; k++) {
      const a = rnd() * TAU, d = rr(80, 240), x = Math.cos(a) * d, z = Math.sin(a) * d, hh = rr(40, 140), r = rr(8, 22), yb = y0 - 40;
      b.cyl(M.ice, 0.5, r, hh, x, yb + hh / 2, z, 5, 1, rr(-0.1, 0.1), rnd() * 3, 0);
      b.cyl(M.snow, 0, r * 0.35, 10, x, yb + hh + 3, z, 5);
      if (rnd() < 0.4) b.cyl(M.frost, 3, 6, rr(50, 90), x + 20, yb + 35, z + 10, 14);
    }
  },
};

// -------------------------------------------------------------- ALIEN
const alien = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    const gc = [0x20f0ff, 0xb050ff, 0x40ffb0][(rnd() * 3) | 0];
    base(ctx, P, M.obsidian, M.obsidian, 0.12, 0.05, 1, 0.9);
    if (P.shape === 'box') {
      const G = M.glow(gc, 3.5);
      b.box(G, P.w + 0.12, 0.05, 0.07, ...L(P, 0, 0.0, P.d / 2 + 0.05), P.ry);
      b.box(G, P.w + 0.12, 0.05, 0.07, ...L(P, 0, 0.0, -P.d / 2 - 0.05), P.ry);
      b.box(G, 0.07, 0.05, P.d, ...L(P, P.w / 2 + 0.05, 0.0, 0), P.ry);
      b.box(G, 0.07, 0.05, P.d, ...L(P, -P.w / 2 - 0.05, 0.0, 0), P.ry);
    } else b.torus(M.glow(gc, 3.5), P.w / 2 + 0.06, 0.04, P.x, P.y + 0.02, P.z, Math.PI / 2, 0, 0, 1, 32);
    const R = Math.min(P.w, P.d) * 0.5, H = rr(1.5, 3);
    b.cyl(M.obsidian, R, 0.1, H, P.x, P.y - P.h - H / 2, P.z, 6, 1, 0, rnd() * 3);
    b.torus(M.glow(gc, 3), R * 1.15, 0.05, P.x, P.y - P.h - 0.8, P.z, Math.PI / 2, 0, 0, 1, 24);
    for (let k = 0; k < 2; k++) {
      const [lx, lz] = edgePos(ctx, P, 0.4), p = L(P, lx, 0, lz), hh = rr(0.5, 1.4), c2 = [0x20f0ff, 0xff50d0, 0x40ffb0][(rnd() * 3) | 0];
      b.crystal(M.glow(c2, 2.6), 0.2, hh, p[0], p[1] + hh * 0.8, p[2], rr(-0.3, 0.3), rnd() * 3, rr(-0.3, 0.3));
      if (rnd() < 0.5) ctx.lamp(p[0], p[1] + 0.8, p[2], c2, 2.0, 18);
    }
    if (rnd() < 0.45) { // bio-luminescent stalk
      const [lx, lz] = edgePos(ctx, P, 0.5), p = L(P, lx, 0, lz), hh = rr(0.8, 2);
      b.cyl(M.obsidian, 0.03, 0.06, hh, p[0], p[1] + hh / 2, p[2], 5);
      b.sphere(M.glow(0x70ffc0, 3), 0.16, p[0], p[1] + hh + 0.1, p[2], 1, 1, 1, 1, 8);
    }
    for (let k = 0; k < 2; k++) { const [lx, lz] = edgePos(ctx, P, 0.2), p = L(P, lx, 1 + rr(0, 2), lz); b.sphere(M.glow(0xb0ffee, 3), 0.045, p[0], p[1], p[2], 1, 1, 1, 1, 5); }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const r = CORE_R * rr(0.85, 1.05), twist = y * 0.03;
    b.cyl(M.obsidian, r * 0.9, r, h, 0, y + h / 2, 0, 6, 1, 0, twist);
    const gc = [0x20f0ff, 0xb050ff, 0x40ffb0][(rnd() * 3) | 0];
    b.torus(M.glow(gc, 3.5), r + 0.4, 0.14, 0, y + 0.4, 0, Math.PI / 2, 0, 0, 1, 30);
    for (let k = 0; k < 5; k++) { const a = rnd() * TAU; b.crystal(M.glow(gc, 2.8), 0.7, rr(2, 5), Math.cos(a) * (r + 0.5), y + rr(1, h - 1), Math.sin(a) * (r + 0.5), 0, 0, 0); }
    b.torus(M.glow(0x20f0ff, 2.5), r + 6, 0.08, 0, y + h * 0.55, 0, rr(0.2, 0.5), 0, rr(0.1, 0.4), 1, 48);
  },
  far(ctx, y0, y1) {
    const { b, M, rnd, rr } = ctx;
    for (let k = 0; k < 12; k++) {
      const a = rnd() * TAU, d = rr(70, 240), x = Math.cos(a) * d, z = Math.sin(a) * d, y = rr(y0 - 20, y1 + 30), s = rr(3, 14);
      const c = [0x20f0ff, 0xb050ff, 0x40ffb0, 0xff50d0][(rnd() * 4) | 0];
      if (rnd() < 0.55) b.crystal(M.glow(c, 2.2), s * 0.35, s * 2.2, x, y, z, rr(-0.5, 0.5), rnd() * 3, rr(-0.5, 0.5));
      else { b.torus(M.glow(c, 2.4), s, 0.15, x, y, z, rnd() * 3, rnd() * 3, 0, 1, 40); b.sphere(M.obsidian, s * 0.35, x, y, z, 1, 1, 1, 1, 12); }
    }
  },
};

// -------------------------------------------------------------- EDEN
const eden = {
  slab(ctx, P) {
    const { b, M, rnd, rr } = ctx;
    base(ctx, P, M.marble, M.grass, 0.28, 0.08, 1, 1);
    if (P.shape === 'box') {
      b.box(M.brass, P.w + 0.2, 0.08, P.d + 0.2, ...L(P, 0, -0.5, 0), P.ry, 1.1);
    } else b.cyl(M.brass, P.w / 2 + 0.06, P.w / 2 + 0.06, 0.08, P.x, P.y - 0.5, P.z, 22, 1.1);
    const R = Math.min(P.w, P.d) * 0.5, H = rr(2, 4);
    b.cyl(M.marble, R, 0.3, H, P.x, P.y - P.h - H / 2 + 0.05, P.z, 8, 0.95, 0, rnd() * 3);
    flowers(ctx, P, 12, [0xffffff, 0xffd84a, 0xff7aa8, 0xff9ac0, 0xb48cff]);
    if (big(P) && rnd() < 0.5) { const p = L(P, -P.w / 2 + 1, 0, P.d / 2 - 1); tree(ctx, p[0], p[1], p[2], rr(0.7, 1), true); }
    if (rnd() < 0.3) {
      const [lx, lz] = edgePos(ctx, P, 0.3), p = L(P, lx, 0, lz);
      b.cyl(M.marble, 0.06, 0.1, 1.8, p[0], p[1] + 0.9, p[2], 6);
      b.sphere(M.glow(0xffe6a0, 3.5), 0.16, p[0], p[1] + 1.9, p[2], 1, 1, 1, 1, 8);
      ctx.lamp(p[0], p[1] + 1.9, p[2], 0xffe0a0, 2.0, 18);
    }
  },
  core(ctx, y, h) {
    const { b, M, rnd, rr } = ctx;
    const r = CORE_R * 0.9;
    b.cyl(M.marble, r, r + 0.2, h, 0, y + h / 2, 0, 18, 1);
    for (let k = 0; k < 3; k++) b.cyl(M.brass, r + 0.35, r + 0.35, 0.5, 0, y + (h * (k + 0.5)) / 3, 0, 18, 1.1);
    b.cyl(M.grass, r + 3, r + 2.4, 0.8, 0, y + h - 0.4, 0, 18);
    for (let k = 0; k < 3; k++) { const a = rnd() * TAU; tree(ctx, Math.cos(a) * (r + 1.5), y + h, Math.sin(a) * (r + 1.5), rr(1.1, 1.7), true); }
    for (let k = 0; k < 6; k++) { const a = rnd() * TAU, hh = rr(5, 14); b.box(M.leaf, 0.4, hh, 0.08, Math.cos(a) * (r + 0.1), y + h - hh / 2, Math.sin(a) * (r + 0.1), radial(a), 0.9); }
  },
  far(ctx, y0, y1) { nature.far(ctx, y0 - 20, y1 + 40); },
};

export const DECOR = [nature, industrial, war, apoc, victorian, frozen, alien, eden];
export { tree, L };
