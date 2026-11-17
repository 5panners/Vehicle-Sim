// Procedural low-poly 1960s Mini Cooper S-style car -> assets/models/mini.glb
// No dependencies, no Blender:  node tools/build-mini.mjs
//
// Game axes: +Z forward, +X = car's left, +Y up, ground at y = 0, origin midway
// between the axles. Wheels are separate nodes at the hubs (MINI_Wheel_FL ...).
// Body points are written as [x, height, s] with s = forward position.
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { add, sub, mul, unit, cross, dot, len, smooth, rad, Mesh, pchip, writeGLB, mergePrims } from './lib/carmesh.mjs';

// ---------------------------------------------------------------- dimensions
// Measured from the reference renders (tools/reference/mini): side view scaled by the
// 2.036 m wheelbase, front view by the 1.41 m body width, top view by the 3.05 m length.
const AXLE = 1.018;                                    // wheelbase 2.036
const TRACK_F = 0.620, TRACK_R = 0.600;                // half tracks (1.24 / 1.20)
const WH = { R: 0.263, W: 0.145, RIM: 0.140 };         // 145-10 on 10" rims (rim lip to ~0.15)
const ARCH_R = 0.297, WELL_X = 0.50;                   // arch circle centred just below the hub
const ARCHES = [{ sc: AXLE, hub: WH.R, cz: 0.235 }, { sc: -AXLE, hub: WH.R, cz: 0.235 }];
const RACE_NUMBER = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? '37';  // node tools/build-mini.mjs 52
// --kit: write the un-glazed body shell + window/boot outlines for tools/blender/build_mini.py instead
const KIT = process.argv.includes('--kit');
const KIT_DATA = { windows: [], boot: null };
const WSEG = KIT ? 24 : 30;                                // wheel segments
const S_F = 1.46, S_R = -1.51;                         // painted body ends (bumpers stick out further)
const BELT = 0.818;                                    // top of the body side / window sill
const GLASS_TOP = 1.195;                               // top edge of the side glass

// ---------------------------------------------------------------- body definition
// centre-line top (side silhouette): low bonnet front, raked windscreen, 1.345 m roof, raked rear window
// flowing over a rounded shoulder into the inclined boot lid
const TOP = pchip(
  [S_R, -1.495, -1.475, -1.45, -1.42, -1.39, -1.36, -1.33, -1.30, -1.27, -1.24, -1.18, -1.10, -1.04, -1.00, -0.95, -0.88, -0.75, 0.0, 0.25, 0.31, 0.35, 0.385, 0.45, 0.55, 0.69, 0.76, 0.85, 1.03, 1.21, 1.36, 1.42, S_F],
  [0.43, 0.51, 0.585, 0.655, 0.725, 0.772, 0.808, 0.836, 0.86, 0.882, 0.92, 1.005, 1.118, 1.203, 1.25, 1.29, 1.318, 1.335, 1.345, 1.34, 1.33, 1.315, 1.29, 1.203, 1.07, 0.88, 0.86, 0.84, 0.815, 0.76, 0.70, 0.675, 0.655]);
// front wing top line: the wings stand above the bonnet's front edge around the headlights
const WT = pchip([0.30, 0.70, 0.95, 1.20, 1.36, S_F], [0.865, 0.86, 0.818, 0.787, 0.768, 0.75]);
const roundEnd = (t, a) => a * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
const W = (s) => 0.705 - 0.015 * (s / 1.2) ** 2           // half width (top view): bowed sides, tapered nose, square tail
  - 0.015 * smooth((s - 0.95) / 0.4)
  - (s > 1.25 ? roundEnd((s - 1.25) / (S_F - 1.25), 0.06) : 0)
  - (s < -1.10 ? roundEnd((-1.10 - s) / (-1.10 - S_R), 0.08) : 0);
const ZB = (s) => 0.17 + 0.075 * smooth((s - 1.25) / 0.2) + 0.12 * smooth((-1.30 - s) / 0.18);
const TUMBLE = (s) => 0.11 - 0.07 * smooth((s - 0.7) / 0.5); // side lean-in from widest point to the belt
const DECK_R = 0.06, DECK_C = 0.02;                      // rounded edge + crown of the boot / rear deck
const zBelt = (s) => (s > 0.3 ? Math.min(BELT, WT(s) - 0.045) : Math.min(BELT, TOP(s) - DECK_C - DECK_R));
const gHouse = (s) => (s < 0 ? smooth((TOP(s) - 0.85) / 0.32) : 1 - smooth((s - 0.69) / 0.12)); // 0 = bonnet/boot, 1 = glasshouse
const archH = (s) => { for (const a of ARCHES) { const d = s - a.sc; if (Math.abs(d) < ARCH_R) return a.cz + Math.sqrt(ARCH_R * ARCH_R - d * d); } return 0; };
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// glazing (measured from the side view): each window is a rounded outline cut into a block of the
// body loft. Side windows live in (s, z) over rows 6..11, the screens in (x, s) over rows 11..14.
const B0 = BELT + 0.017;                                  // side glass bottom edge
const DOOR_FRONT = (z) => 0.585 - (z - B0) / 1.34;        // door glass front edge parallel to the windscreen: slim A-pillar
const WINDOWS = [
  { name: 'door', kind: 'side', block: [-0.29, 0.62],
    pts: [[-0.274, B0, 0.02], [DOOR_FRONT(B0), B0, 0.02], [DOOR_FRONT(GLASS_TOP), GLASS_TOP, 0.05], [-0.274, GLASS_TOP, 0.035]] },
  { name: 'quarter', kind: 'side', block: [-0.985, -0.29],
    pts: [[-0.955, B0, 0.04], [-0.325, B0, 0.025], [-0.325, GLASS_TOP, 0.03], [-0.765, GLASS_TOP, 0.10]] },
  { name: 'screen', kind: 'top', block: [0.375, 0.70], k: 1.67,
    pts: [[-0.488, 0.395, 0.065], [-0.488, 0.675, 0.05], [0.488, 0.675, 0.05], [0.488, 0.395, 0.065]] },
  { name: 'rear', kind: 'top', block: [-1.29, -0.985], k: 1.74,
    pts: [[-0.42, -1.255, 0.06], [-0.42, -1.02, 0.07], [0.42, -1.02, 0.07], [0.42, -1.255, 0.06]] },
];
const ROOF = [-0.985, 0.375];                             // white roof between the screen blocks

// 15-row half profile: r0 floor centre, r1 floor edge, r2 sill, r3-r5 side, r6 belt,
// r7-r9 glass plane (r9 = glass top), r10 frame, r11 gutter, r12 roof edge, r13 mid-roof, r14 centre
function profile(s) {
  const w = W(s), zb = ZB(s), zt = TOP(s), belt = zBelt(s), g = gHouse(s), tb = TUMBLE(s), xb = w - tb;
  const P = [[0, zb], [w - 0.11, zb], [w - 0.05, zb + 0.035], [w - 0.008, zb + 0.25 * (belt - zb)],
    [w, zb + 0.51 * (belt - zb)], [w - tb * 0.5, zb + 0.82 * (belt - zb)], [xb, belt]];
  // glasshouse rows evenly spread from the belt to the gutter on one smooth section: a leaning glass
  // plane that rolls in to the gutter under the roof, a single clean curve on the low A/C-pillars
  const z11 = Math.max(belt + 0.01, zt - 0.05), H = z11 - belt, aLin = 0.84 + 0.16 * (1 - smooth((H - 0.1) / 0.3));
  const xs = (t) => 0.588 - 0.083 * (aLin * t + (1 - aLin) * t ** 8);
  const cab = [1, 2, 3, 4].map((k) => [xs(k / 5), belt + H * k / 5]);
  // domed roof: the edge rolls down 36 mm from the crown, with a mid row so the dome reads round
  cab.push([0.505, z11], [0.45, Math.max(z11 + 0.002, zt - 0.036)], [0.27, Math.max(z11 + 0.004, zt - 0.012)], [0, zt]);
  let pan;
  if (s > 0.3) {
    // bonnet: narrower domed panel with a shut line either side; wings rise outboard around the headlights
    const xbon = 0.46 - 0.06 * smooth((s - 0.69) / 0.6), stp = smooth((s - 0.77) / 0.1), cb = 0.02 + 0.01 * smooth((s - 0.7) / 0.3), wt = WT(s);
    const bz = (x) => zt - cb * (x / xbon) ** 2;
    pan = [[xb - 0.012, wt - 0.016], [Math.max(xbon + 0.05, xb - 0.055), wt - 0.002], [xbon + 0.014, bz(xbon) - 0.009 * stp], [xbon - 0.004, bz(xbon) + 0.004 * stp],
      [xbon * 0.66, bz(xbon * 0.66)], [xbon * 0.38, bz(xbon * 0.38)], [xbon * 0.17, bz(xbon * 0.17)], [0, zt]];
  } else {
    // boot / rear deck: a radiused edge rolls from the body side onto a gently crowned deck, so the
    // rear window base and the boot lid blend round the corners (rows 11-12 keep the cabin widths)
    const xe = Math.min(xb, 0.60), xd = xe - DECK_R, deck = (x) => zt - DECK_C * (x / xd) ** 2;
    const corner = (a) => [xd + DECK_R * Math.cos(rad(a)), zt - DECK_C - DECK_R + DECK_R * Math.sin(rad(a))];
    pan = [corner(25), corner(50), corner(72), [xd, deck(xd)], [Math.min(0.505, xd - 0.025), deck(Math.min(0.505, xd - 0.025))],
      [Math.min(0.45, xd - 0.09), deck(Math.min(0.45, xd - 0.09))], [Math.min(0.27, xd - 0.25), deck(Math.min(0.27, xd - 0.25))], [0, zt]];
  }
  for (let i = 0; i < 8; i++) P.push(lerp2(pan[i], cab[i], g));
  P.g = g;
  // inside a wheel arch, lift the lower side rows onto the arch opening
  const a = archH(s);
  P.arch = a > P[2][1] + 1e-4;
  if (P.arch) {
    const poly = [P[2], P[3], P[4], P[5]].map((p) => [...p]), z2 = poly[0][1], z5 = poly[3][1];
    const xAt = (z) => { for (let i = 0; i < 3; i++) if (z <= poly[i + 1][1]) return lerp2(poly[i], poly[i + 1], (z - poly[i][1]) / (poly[i + 1][1] - poly[i][1]))[0]; return poly[3][0]; };
    for (const k of [2, 3, 4]) { const z = a + (poly[k - 2][1] - z2) * (z5 - a) / (z5 - z2); P[k] = [xAt(z), z]; }
    P[1] = P[2];
  }
  P.floorX = P.arch ? WELL_X : P[1][0];
  return P;
}

const inR = (s, r) => s > r[0] && s < r[1];

function zone(k, s, g) {
  if (k === 0) return 'under';
  if (k === 9 && g < 0.25 && s > 0.70 && s < S_F - 0.01) return 'seam';      // bonnet shut line
  if (k >= 11 && inR(s, ROOF)) return 'roof';                                 // pillars and cant rail stay body colour
  return 'paint';
}

function stations() {
  const keep = [];
  const addIf = (s, tol) => { if (keep.every((k) => Math.abs(k - s) >= tol)) keep.push(s); };
  for (const s of [S_F, S_R, ...WINDOWS.flatMap((w) => w.block)]) addIf(s, 1e-6);
  for (const s of [0.69, 0.76, 0.85, 1.03, 1.21, 1.36, 1.42, -1.27, -1.30, -1.33, -1.36, -1.39, -1.42, -1.45, -1.475, -1.495]) addIf(s, 0.008);
  for (const a of ARCHES) {
    const t0 = Math.asin((0.20 - a.cz) / ARCH_R), n = 16;
    for (let i = 0; i <= n; i++) addIf(a.sc + ARCH_R * Math.cos(t0 + (Math.PI - 2 * t0) * i / n), 0.015);
  }
  const n = Math.ceil((S_F - S_R) / (KIT ? 0.05 : 0.04));   // the Blender pass adds window geometry: coarser loft
  for (let i = 1; i < n; i++) addIf(S_R + (S_F - S_R) * i / n, 0.022);
  return keep.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- window inserts
// Fillet a polygon [[a, b, radius]...] in a metric-ish space (b scaled by k), return a dense outline.
function roundPoly(pts, k = 1, step = 0.03) {
  const P = pts.map(([a, b, r]) => [a, b * k, r]), out = [];
  const n = P.length;
  const fil = P.map((p, i) => {
    const a = P[(i + n - 1) % n], c = P[(i + 1) % n];
    const u1 = unit2([a[0] - p[0], a[1] - p[1]]), u2 = unit2([c[0] - p[0], c[1] - p[1]]);
    const half = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2, d = p[2] / Math.tan(half);
    const t1 = [p[0] + u1[0] * d, p[1] + u1[1] * d], t2 = [p[0] + u2[0] * d, p[1] + u2[1] * d];
    const bis = unit2([u1[0] + u2[0], u1[1] + u2[1]]), cd = p[2] / Math.sin(half), ctr = [p[0] + bis[0] * cd, p[1] + bis[1] * cd];
    return { t1, t2, ctr, r: p[2] };
  });
  for (let i = 0; i < n; i++) {
    const f = fil[i], a0 = Math.atan2(f.t1[1] - f.ctr[1], f.t1[0] - f.ctr[0]);
    let a1 = Math.atan2(f.t2[1] - f.ctr[1], f.t2[0] - f.ctr[0]);
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    const seg = Math.max(3, Math.ceil(Math.abs(a1 - a0) * f.r / (step * 0.4)));
    for (let j = 0; j <= seg; j++) { const a = a0 + (a1 - a0) * j / seg; out.push([f.ctr[0] + f.r * Math.cos(a), f.ctr[1] + f.r * Math.sin(a)]); }
    const g = fil[(i + 1) % n], L = Math.hypot(g.t1[0] - f.t2[0], g.t1[1] - f.t2[1]), m = Math.max(1, Math.round(L / step));
    for (let j = 1; j < m; j++) out.push([f.t2[0] + (g.t1[0] - f.t2[0]) * j / m, f.t2[1] + (g.t1[1] - f.t2[1]) * j / m]);
  }
  if (area2(out) < 0) out.reverse();
  return out.map(([a, b]) => [a, b / k]);
}
const unit2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const area2 = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;
// inward offset of a CCW outline (b scaled by k for the offset)
function inset(poly, d, k = 1) {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i + n - 1) % n], c = poly[(i + 1) % n], t = unit2([c[0] - a[0], (c[1] - a[1]) * k]);
    return [p[0] - t[1] * d, p[1] + t[0] * d / k];
  });
}
// body surface point inside a window block. side: (s, z) -> rows 6..11; top: (x, s) -> rows 11..14
function surfPt(win, side, a, b) {
  if (win.kind === 'side') {
    const P = profile(a);
    for (let k = 6; k < 11; k++) if (b <= P[k + 1][1] || k === 10) { const t = Math.max(0, Math.min(1, (b - P[k][1]) / (P[k + 1][1] - P[k][1]))); return [side * (P[k][0] + (P[k + 1][0] - P[k][0]) * t), b, a]; }
  }
  const P = profile(b), x = Math.abs(a);
  for (let k = 11; k < 14; k++) if (x >= P[k + 1][0] || k === 13) { const t = Math.max(0, Math.min(1, (P[k][0] - x) / (P[k][0] - P[k + 1][0]))); return [a, P[k][1] + (P[k + 1][1] - P[k][1]) * t, b]; }
}
function surfN(win, side, a, b) {
  const e = 0.004, p = surfPt(win, side, a, b), pa = surfPt(win, side, a + e, b), pb = surfPt(win, side, a, b + e);
  let n = unit(cross(sub(pa, p), sub(pb, p)));
  if (dot(n, sub(p, [0, 0.6, p[2]])) < 0) n = mul(n, -1);
  return n;
}
// zip two open polylines (3D) into a triangle strip by normalised arc length
function zip(m, A, B, mat, o) {
  const tl = (L) => { const t = [0]; for (let i = 1; i < L.length; i++) t.push(t[i - 1] + len(sub(L[i], L[i - 1]))); return t.map((v) => v / (t[t.length - 1] || 1)); };
  const ta = tl(A), tb = tl(B);
  let i = 0, j = 0;
  while (i < A.length - 1 || j < B.length - 1) {
    if (j === B.length - 1 || (i < A.length - 1 && ta[i + 1] <= tb[j + 1])) { m.tri(A[i], A[i + 1], B[j], typeof mat === 'function' ? mat(A[i], A[i + 1], B[j]) : mat, o); i++; }
    else { m.tri(A[i], B[j + 1], B[j], typeof mat === 'function' ? mat(A[i], B[j + 1], B[j]) : mat, o); j++; }
  }
}
// Fill a window block: body-colour bridge from the block edge to the outline, fine chrome bead,
// dark rubber seal, recessed glass. loop = block boundary [{p2, p3}] (CCW in param space, 4 corners given).
function windowInsert(m, win, side, loop, corners) {
  const k = win.kind === 'top' ? win.k : 1;
  let outline = roundPoly(win.pts, k, win.kind === 'top' ? 0.05 : 0.045);
  const P = (q, lift) => { const p = surfPt(win, side, q[0], q[1]); return add(p, mul(surfN(win, side, q[0], q[1]), lift)); };
  const ctr = outline.reduce((a, q) => [a[0] + q[0] / outline.length, a[1] + q[1] / outline.length], [0, 0]);
  // split the outline at the points nearest the block corners
  const split = corners.map((ci) => { const c = loop[ci].p2; let best = 0, bd = Infinity; outline.forEach((q, i) => { const d = Math.hypot(q[0] - c[0], (q[1] - c[1]) * k); if (d < bd) { bd = d; best = i; } }); return best; });
  const ring = (q) => P(q, 0.0015);
  const o = (c) => ({ away: [0, 0.6, c[2]] });
  const bridgeMat = (...t) => { const c = mul(add(add(t[0], t[1]), t[2]), 1 / 3); return inR(c[2], ROOF) && win.kind === 'top' ? 'roof' : 'paint'; };
  for (let e = 0; e < 4; e++) {
    const A = []; for (let i = corners[e]; ; i = (i + 1) % loop.length) { A.push(loop[i].p3); if (i === corners[(e + 1) % 4]) break; }
    const B = []; for (let i = split[e]; ; i = (i + 1) % outline.length) { B.push(ring(outline[i])); if (i === split[(e + 1) % 4]) break; }
    zip(m, A, B, bridgeMat, o);
  }
  // chrome bead (raised), rubber seal, recessed glass
  const W1 = inset(outline, 0.003, k), W3 = inset(outline, 0.006, k);
  const R = [outline.map(ring), W1.map((q) => P(q, 0.003)), W3.map((q) => P(q, -0.004))];
  const mats = ['chrome', 'chrome'];
  for (let r = 0; r < 2; r++) for (let i = 0; i < outline.length; i++) { const j = (i + 1) % outline.length; m.quad(R[r][i], R[r][j], R[r + 1][j], R[r + 1][i], mats[r], o(R[r][i])); }
  // glass: the panels are near-planar (the screens are linear across x), so a fan follows them closely
  const G = R[2], tip = P(ctr, -0.004);
  G.forEach((q, i) => m.tri(tip, q, G[(i + 1) % G.length], 'glass', o(q)));
  if (KIT) KIT_DATA.windows.push({ name: win.name, side, outline: outline.map((q) => P(q, 0)), normals: outline.map((q) => surfN(win, side, q[0], q[1])),
    glass: W3.map((q) => P(q, -0.004)), tip: P(ctr, -0.004) });
  return { P, outline, W3 };
}

// end caps: the end section's outline, domed outward. cap.at(x, z) gives the surface point,
// so lamps, grille and boot details can sit on the curved panel.
const CAP_FS = [1, 0.82, 0.64, 0.46, 0.28];
function makeCap(s, dir, bulge, extra = () => 0) {
  const P = profile(s);
  const ring = [...P.slice(0, 15), ...P.slice(1, 14).reverse().map((p) => [-p[0], p[1]])];
  const c = [0, ring.reduce((a, p) => a + p[1], 0) / ring.length];
  // radial fraction f of (x, z) between the centre (0) and the outline (1)
  const frac = (x, z) => {
    const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1];
      const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - c[0]) * ez - (a[1] - c[1]) * ex) / den, u = ((a[0] - c[0]) * dz - (a[1] - c[1]) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return Math.min(1, 1 / best);
  };
  // piecewise-linear in f between the mesh rings, matching the generated triangles
  const H = (f) => { const ks = [...CAP_FS, 0], hs = ks.map((k) => bulge * (1 - k * k)); for (let i = 0; i < ks.length - 1; i++) if (f <= ks[i] && f >= ks[i + 1]) return hs[i] + (hs[i + 1] - hs[i]) * (ks[i] - f) / (ks[i] - ks[i + 1]); return bulge; };
  const off = (x, z) => { const f = frac(x, z); return H(f) + extra(x, z) * smooth((1 - f) / 0.3); };   // extra fades out at the outline: no crack
  return { s, dir, ring, c, off, frac, at: (x, z) => [x, z, s + dir * off(x, z)] };
}
// wing fronts bulge forward around the headlights; the grille panel between them sits back
const ear = (x, z) => 0.064 * smooth((Math.abs(x) - 0.38) / 0.09) * Math.exp(-(((Math.abs(x) - 0.51) / 0.13) ** 2 + ((z - 0.655) / 0.16) ** 2) / 2);
const CAP_F = makeCap(S_F, 1, 0.045, ear), CAP_R = makeCap(S_R, -1, 0.025);

// ---------------------------------------------------------------- body shell
function buildBody() {
  const m = new Mesh(), S = stations(), rings = S.map(profile);
  const pt = (P, k, side, s) => [side * P[k][0], P[k][1], s];
  const cut = (k, sm) => !KIT && WINDOWS.some((w) => inR(sm, w.block) && (w.kind === 'side' ? k >= 6 && k <= 10 : k >= 11));
  for (let i = 0; i < S.length - 1; i++) {
    const s0 = S[i], s1 = S[i + 1], sm = (s0 + s1) / 2, P0 = rings[i], P1 = rings[i + 1], g = (P0.g + P1.g) / 2;
    for (const side of [1, -1]) {
      for (let k = 1; k < 14; k++) if (!cut(k, sm)) m.quad(pt(P0, k, side, s0), pt(P0, k + 1, side, s0), pt(P1, k + 1, side, s1), pt(P1, k, side, s1), zone(k, sm, g), { away: [0, 0.6, sm] });
      const arch = ARCHES.find((a) => Math.abs(sm - a.sc) < ARCH_R);
      if (arch && (P0.arch || P1.arch)) { // wheel well: tunnel roof + inner wall
        const hub = [side * 0.6, arch.hub, arch.sc], e0 = pt(P0, 2, side, s0), e1 = pt(P1, 2, side, s1);
        const i0 = [side * WELL_X, e0[1], s0], i1 = [side * WELL_X, e1[1], s1];
        m.quad(e0, e1, i1, i0, 'well', { toward: hub });
        m.quad(i0, i1, [side * WELL_X, P1[0][1], s1], [side * WELL_X, P0[0][1], s0], 'well', { toward: hub });
      }
    }
    m.quad([-P0.floorX, P0[0][1], s0], [P0.floorX, P0[0][1], s0], [P1.floorX, P1[0][1], s1], [-P1.floorX, P1[0][1], s1], 'under', { dir: [0, -1, 0] });
  }
  // domed nose (grille panel) and tail (boot panel)
  for (const cap of [CAP_F, CAP_R]) {
    const R = CAP_FS.map((f) => cap.ring.map(([x, z]) => cap.at(cap.c[0] + (x - cap.c[0]) * f, cap.c[1] + (z - cap.c[1]) * f)));
    const tip = cap.at(cap.c[0], cap.c[1]), away = [0, cap.c[1], cap.s - cap.dir];
    for (let j = 0; j < R.length - 1; j++) R[j].forEach((p, i) => { const n = (i + 1) % R[j].length; m.quad(p, R[j][n], R[j + 1][n], R[j + 1][i], 'paint', { away }); });
    const last = R[R.length - 1];
    last.forEach((p, i) => m.tri(tip, p, last[(i + 1) % last.length], 'paint', { away }));
  }
  // windows: block boundary loops built from the loft's own vertices, so the inserts are watertight
  const glazing = [];
  for (const win of WINDOWS) {
    const ia = S.findIndex((s) => Math.abs(s - win.block[0]) < 1e-9), ib = S.findIndex((s) => Math.abs(s - win.block[1]) < 1e-9);
    const sides = win.kind === 'side' ? [1, -1] : [1];
    for (const side of sides) {
      const loop = [], corners = [];
      const V = (i, k, sg = side) => { const P = rings[i]; const p3 = [sg * P[k][0], P[k][1], S[i]]; loop.push({ p3, p2: win.kind === 'side' ? [S[i], P[k][1]] : [sg * P[k][0], S[i]] }); };
      if (win.kind === 'side') {
        corners.push(0); for (let i = ia; i <= ib; i++) V(i, 6);
        for (let k = 7; k <= 11; k++) { if (k === 11) corners.push(loop.length); V(ib, k); }
        for (let i = ib - 1; i >= ia; i--) { if (i === ia) corners.push(loop.length); V(i, 11); }
        for (let k = 10; k >= 7; k--) V(ia, k);
        corners.splice(1, 0, ib - ia);                  // CCW in (s, z): bottom edge runs +s
      } else {
        corners.push(0); for (let i = ia; i <= ib; i++) V(i, 11, 1);
        V(ib, 12, 1); V(ib, 13, 1); V(ib, 14, 1); V(ib, 13, -1); V(ib, 12, -1);
        corners.push(ib - ia, loop.length); for (let i = ib; i >= ia; i--) V(i, 11, -1);
        corners.push(loop.length - 1);
        V(ia, 12, -1); V(ia, 13, -1); V(ia, 14, 1); V(ia, 13, 1); V(ia, 12, 1);
      }
      glazing.push({ win, side, ...windowInsert(KIT ? new Mesh() : m, win, side, loop, corners) });   // kit: Blender cuts the openings
    }
  }
  m.glazing = glazing;
  return m;
}

// x on the body side at height z (rows 2..6), for trim that hugs the panels
function sideX(s, z) {
  const P = profile(s);
  for (let k = 2; k < 6; k++) if (z <= P[k + 1][1]) { const t = (z - P[k][1]) / (P[k + 1][1] - P[k][1]); return P[k][0] + (P[k + 1][0] - P[k][0]) * Math.max(0, Math.min(1, t)); }
  return P[6][0];
}
// thin ribbon along a side-view polyline [(s, z)], laid on the panel (seam lines)
function seam(m, pts, side, mat, w = 0.006, off = 0.003) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [s0, z0] = pts[i], [s1, z1] = pts[i + 1], l = Math.hypot(s1 - s0, z1 - z0), n = [-(z1 - z0) / l * w, (s1 - s0) / l * w];
    const P = (s, z) => [side * (sideX(s, z) + off), z, s];
    m.quad(P(s0 + n[0], z0 + n[1]), P(s1 + n[0], z1 + n[1]), P(s1 - n[0], z1 - n[1]), P(s0 - n[0], z0 - n[1]), mat, { dir: [side, 0, 0] });
  }
}
// Race roundel: white disc with seven-segment style digits. map(u, v, lift) -> 3D point,
// u = reading direction (right), v = up, lift = height above the panel.
const SEGS = { a: [[0, 1], [1, 1]], b: [[1, 1], [1, 0.5]], c: [[1, 0.5], [1, 0]], d: [[0, 0], [1, 0]], e: [[0, 0], [0, 0.5]], f: [[0, 0.5], [0, 1]], g: [[0, 0.5], [1, 0.5]] };
const DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function roundel(m, num, R, map, out) {
  const n = 20, rings = 3, o = { dir: out };     // ringed disc so it follows curved panels
  const P = (k, i) => { const r = R * k / rings, a = 2 * Math.PI * i / n; return map(r * Math.cos(a), r * Math.sin(a), 0.004); };
  for (let i = 0; i < n; i++) {
    m.tri(P(0, 0), P(1, i), P(1, i + 1), 'roundel', o);
    for (let k = 1; k < rings; k++) m.quad(P(k, i), P(k, i + 1), P(k + 1, i + 1), P(k + 1, i), 'roundel', o);
  }
  const dh = R * 0.95, dw = R * 0.46, gap = R * 0.16, t = R * 0.13, digits = String(num).split('');
  const total = digits.length * dw + (digits.length - 1) * gap;
  digits.forEach((d, k) => {
    const u0 = -total / 2 + k * (dw + gap);
    for (const sg of DIGITS[d] ?? '') {
      let [[x0, y0], [x1, y1]] = SEGS[sg];
      const p0 = [u0 + x0 * dw, -dh / 2 + y0 * dh], p1 = [u0 + x1 * dw, -dh / 2 + y1 * dh];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), ux = dx / l * t / 2, uy = dy / l * t / 2;
      const A = [p0[0] - ux, p0[1] - uy], Bp = [p1[0] + ux, p1[1] + uy], pieces = 3;
      for (let j = 0; j < pieces; j++) {
        const L = (t) => [A[0] + (Bp[0] - A[0]) * t, A[1] + (Bp[1] - A[1]) * t], q0 = L(j / pieces), q1 = L((j + 1) / pieces);
        m.quad(map(q0[0] - uy, q0[1] + ux, 0.009), map(q1[0] - uy, q1[1] + ux, 0.009), map(q1[0] + uy, q1[1] - ux, 0.009), map(q0[0] + uy, q0[1] - ux, 0.009), 'number', o);
      }
    }
  });
}

// local frame helper: build along +X, then point that axis forward/back (+/-Z)
const axisZ = (p, c, dir = 1) => add(c, [dir * p[1], p[2], dir * p[0]]);

// ---------------------------------------------------------------- exterior details
function buildDetails(body) {
  const m = new Mesh();
  // --- grille: dark backing, chrome surround, horizontal bars. Flat top with rounded shoulders
  // falling into near-vertical sides (a superellipse), as in the close-up front reference
  const GA = 0.40, GB = 0.205, GC = 0.385, GN = 5;   // ~7% smaller than the first fit
  const gz = (x) => GC + GB * Math.max(0, 1 - Math.abs(x / GA) ** GN) ** (1 / GN);
  const flare = (z) => 1 + 0.05 * Math.max(0, Math.min(1, (GC + GB - z) / GB));
  const gHalf = (z) => flare(z) * (z <= GC ? GA : GA * Math.max(0, 1 - ((z - GC) / GB) ** GN) ** (1 / GN));
  const top = Array.from({ length: 25 }, (_, i) => { const t = Math.PI * (1 - i / 24), c = Math.cos(t), s = Math.sin(t); const z = GC + GB * Math.abs(s) ** (2 / GN); return [flare(z) * Math.sign(c) * GA * Math.abs(c) ** (2 / GN), z]; });
  const outline = [[-GA * flare(0.33) - 0.003, 0.33], ...top, [GA * flare(0.33) + 0.003, 0.33]];
  const fs = (x, z, e = 0) => S_F + CAP_F.off(x, z) + e;          // forward position on the domed nose
  const gp = (x, z, e) => [x, z, fs(x, z, e)], gc = gp(0, 0.45, 0.004);
  const loop = [...outline, outline[0]];
  const g2 = (p, f) => [gc[0] + (p[0] - gc[0]) * f, gc[1] + (p[1] - gc[1]) * f];        // ringed so it follows the dome
  for (let i = 0; i < loop.length - 1; i++) {
    const fs3 = [0, 1 / 3, 2 / 3, 1].map((f) => [g2(loop[i], f), g2(loop[i + 1], f)]);
    m.tri(gp(...fs3[0][0], 0.009), gp(...fs3[1][0], 0.009), gp(...fs3[1][1], 0.009), 'grille', { dir: [0, 0, 1] });
    for (let k = 1; k < 3; k++) m.quad(gp(...fs3[k][0], 0.009), gp(...fs3[k + 1][0], 0.009), gp(...fs3[k + 1][1], 0.009), gp(...fs3[k][1], 0.009), 'grille', { dir: [0, 0, 1] });
  }
  m.tube(outline.map(([x, z]) => gp(x, z, 0.02)), 0.013, 'chrome', 5);
  for (let z = 0.36; z < 0.585; z += 0.0235) {
    const half = gHalf(z) - 0.014;
    m.tube([-1, -0.5, 0, 0.5, 1].map((t) => gp(t * half, z, 0.012)), 0.0045, 'chrome', 4);
  }
  for (const x of [-0.16, 0.16]) m.tube([gp(x, 0.36, 0.016), gp(x, 0.50, 0.016), gp(x, gz(x) - 0.012, 0.016)], 0.005, 'chrome', 4);
  // --- headlights: chrome rim round a recessed lens on the wing bulge; indicators beneath
  for (const x of [0.50, -0.50]) {
    // pod: a band that leaves the wing surface tangentially (ease t^2) and rises to the chrome rim,
    // so the lamp grows out of the panel instead of being stuck on it. The rim sits just proud of
    // everything around it, so the pod always climbs towards it.
    const NS = 24, rIn = 0.106, Z0 = 0.655, T = [0, 0.3, 0.55, 0.8, 1];
    const rays = Array.from({ length: NS }, (_, i) => {
      const a = 2 * Math.PI * i / NS, ca = Math.cos(a), sa = Math.sin(a);
      let rOut = 0.165; while (rOut > 0.12 && CAP_F.frac(x + rOut * ca, Z0 + rOut * sa) > 0.95) rOut -= 0.005;   // stay on the nose
      return { ca, sa, rOut, surf: (r) => fs(x + r * ca, Z0 + r * sa, 0) };
    });
    const sRim = Math.max(fs(x, Z0, 0) + 0.016, ...rays.flatMap((q) => [q.surf(q.rOut) + 0.012, q.surf(rIn) + 0.018]));
    const c = [x, Z0, sRim - 0.016];
    const podRings = rays.map(({ ca, sa, rOut, surf }) => {
      const lift = sRim - surf(rIn);
      return T.map((t) => { const r = rOut + (rIn - rOut) * t; return [x + r * ca, Z0 + r * sa, surf(r) - 0.002 * (1 - t) + lift * t * t]; });
    });
    for (let i = 0; i < NS; i++) { const j = (i + 1) % NS; for (let k = 0; k < T.length - 1; k++) m.quad(podRings[i][k], podRings[j][k], podRings[j][k + 1], podRings[i][k + 1], 'paint', { away: [x, Z0, c[2] - 0.25] }); }
    const rim = new Mesh(); rim.revolveX([[0.016, 0.106], [0.030, 0.103], [0.038, 0.094], [0.036, 0.085], [0.030, 0.082]], 24, 'chrome', { away: [-0.2, 0, 0] });
    const lens = new Mesh(); lens.revolveX([[0.030, 0.082], [0.0385, 0.064], [0.045, 0.044], [0.0495, 0.022], [0.051, 0]], 24, 'lamp', { away: [-0.2, 0, 0] });   // domed lens
    for (const part of [rim, lens]) m.addFrom(part, (p) => axisZ(p, c));
    const ip = fs(x, 0.445);
    m.tube([[x, 0.445, ip - 0.02], [x, 0.445, ip + 0.012]], 0.042, 'chrome', 14);
    m.ellipsoid([x, 0.445, ip + 0.012], [0.036, 0.036, 0.03], 'indicator', 14, 6);
    // apron crease under the headlight, and the bonnet's front lip above the grille
    m.tube([0.43, 0.48, 0.53, 0.57].map((xx) => [Math.sign(x) * xx, 0.53, fs(Math.sign(x) * xx, 0.53, 0.004)]), 0.0045, 'seam', 4);
  }
  m.tube([-0.40, -0.36, -0.3, -0.15, 0, 0.15, 0.3, 0.36, 0.40].map((xx) => [xx, gz(xx) + 0.04, fs(xx, gz(xx) + 0.04, 0.004)]), 0.0045, 'seam', 4);
  // --- chrome bumpers with overriders
  const bumper = (cap, zc, ox) => {
    const { s, dir } = cap, surf = (x) => s + dir * cap.off(Math.max(-0.55, Math.min(0.55, x)), zc);
    const pts = [];
    for (let i = 0; i <= 10; i++) { const x = -0.70 + 1.40 * i / 10, t = Math.abs(x) / 0.70; pts.push([x, zc, surf(x) + dir * (0.045 - 0.10 * t ** 4)]); }
    m.tube(pts, 0.026, 'chrome', 8);
    for (const x of [-ox, ox]) {
      const zz = [zc - 0.07, zc + 0.115], y = surf(x) + dir * 0.07;
      m.tube([[x, zz[0], y], [x, zz[1], y]], 0.028, 'chrome', 8);
      for (const z of zz) m.ellipsoid([x, z, y], [0.028, 0.02, 0.028], 'chrome', 8, 3);
    }
    for (const x of [-0.30, 0.30]) m.box([x, zc, surf(x) + dir * 0.015], [0.04, 0.03, 0.06], 'under');
  };
  bumper(CAP_F, 0.34, 0.375);
  bumper(CAP_R, 0.34, 0.53);
  // --- rear: everything is projected onto the built body shell by casting rays forward (+s)
  const tailTris = body.tris.filter((t) => t.p.some((p) => p[2] < -1.15)).map((t) => t.p);
  const rayS = (x, z) => {
    let best = Infinity;
    for (const [a, b, c] of tailTris) {               // 2D point-in-triangle in (x, z), then interpolate s
      const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]); if (Math.abs(d) < 1e-12) continue;
      const u = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (z - a[1])) / d, v = ((b[0] - a[0]) * (z - a[1]) - (x - a[0]) * (b[1] - a[1])) / d;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      best = Math.min(best, a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]));
    }
    return best;
  };
  const rearPt = (x, z, e = 0) => [x, z, rayS(x, z) - e];
  const rearN = (x, z) => { const p = rearPt(x, z), px = rearPt(x + 0.005, z), pz = rearPt(x, z + 0.005); let n = unit(cross(sub(px, p), sub(pz, p))); if (n[2] > 0) n = mul(n, -1); return n; };
  // a raised rounded-rectangle unit on the tail (lamps, plate box): walls + ringed face that follows the panel
  const tailUnit = (cx, cz, hw, hh, r, e, faceMat, wallMat) => {
    const ol = roundPoly([[cx - hw, cz - hh, r], [cx + hw, cz - hh, r], [cx + hw, cz + hh, r], [cx - hw, cz + hh, r]], 1, 0.028);
    const out = (q, lift) => add(rearPt(q[0], q[1]), mul(rearN(q[0], q[1]), lift));
    const base = ol.map((q) => out(q, -0.004)), lip = ol.map((q) => out(q, e));
    const o = { dir: [0, 0, -1] };
    ol.forEach((_, i) => { const j = (i + 1) % ol.length; m.quad(base[i], base[j], lip[j], lip[i], wallMat, { away: [cx, cz, rayS(cx, cz) + 0.1] }); });
    const F = [1, 0.5].map((f) => ol.map((q) => out([cx + (q[0] - cx) * f, cz + (q[1] - cz) * f], e)));
    ol.forEach((_, i) => { const j = (i + 1) % ol.length; m.quad(F[0][i], F[0][j], F[1][j], F[1][i], faceMat, o); m.tri(out([cx, cz], e), F[1][i], F[1][j], faceMat, o); });
  };
  for (const sg of [1, -1]) {                                              // tall corner lamps: amber over red, chrome surround
    const x = sg * 0.548;
    tailUnit(x, 0.49, 0.046, 0.108, 0.035, 0.008, 'chrome', 'chrome');
    tailUnit(x, 0.555, 0.037, 0.034, 0.024, 0.024, 'indicator', 'indicator');
    tailUnit(x, 0.455, 0.037, 0.064, 0.026, 0.024, 'tail', 'tail');
  }
  tailUnit(0, 0.515, 0.28, 0.058, 0.02, 0.012, 'grille', 'grille');          // number-plate box
  tailUnit(0, 0.442, 0.085, 0.014, 0.012, 0.02, 'chrome', 'chrome');         // plate-lamp hood under the plate
  // boot lid aperture: a smaller rounded rectangle (big top radii) inboard of the lamps, sitting on the bumper
  // lid top sits 7 cm below the rear window glass, measured down the centre-line surface
  let sb = WINDOWS.find((w) => w.name === 'rear').pts[0][1], arc = 0;
  while (arc < 0.07) { const s2 = sb - 0.001; arc += Math.hypot(0.001, TOP(s2) - TOP(sb)); sb = s2; }
  const BX = 0.415, BZ0 = 0.385, BZ1 = TOP(sb);
  const bootLine = roundPoly([[-BX, BZ0, 0.05], [BX, BZ0, 0.05], [BX, BZ1, 0.13], [-BX, BZ1, 0.13]], 1, 0.03);
  tailUnit(0, BZ1 - 0.035, 0.05, 0.009, 0.008, 0.012, 'chrome', 'chrome');    // boot handle just under the lid top
  if (KIT) console.log('boot lid top z', BZ1.toFixed(3), 'at s', sb.toFixed(3));
  if (KIT) KIT_DATA.boot = { pts: bootLine.map(([x, z]) => rearPt(x, z)), normals: bootLine.map(([x, z]) => rearN(x, z)) };
  else m.tube([...bootLine, bootLine[0]].map(([x, z]) => add(rearPt(x, z), mul(rearN(x, z), 0.002))), 0.0045, 'seam', 4);
  m.tube([[0.36, 0.15, -1.15], [0.36, 0.15, -1.50], [0.38, 0.14, -1.60]], 0.024, 'metal', 10);   // exhaust exits on the left (ref rear view)
  // --- sides: arch lips, sill trim, seams, doors, handles, hinges, fuel caps
  for (const side of [1, -1]) {
    for (const a of ARCHES) {
      const t0 = Math.asin((0.20 - a.cz) / ARCH_R), pts = [];
      for (let i = 0; i <= 15; i++) { const t = t0 + (Math.PI - 2 * t0) * i / 15, s = a.sc + (ARCH_R + 0.004) * Math.cos(t), z = a.cz + (ARCH_R + 0.004) * Math.sin(t); pts.push([side * (sideX(s, z) + 0.004), z, s]); }
      m.tube(pts, 0.011, 'chrome', 5);
    }
    const sill = []; for (let i = 0; i <= 10; i++) { const s = -0.72 + 1.44 * i / 10; sill.push([side * (sideX(s, 0.215) + 0.006), 0.215, s]); }
    m.tube(sill, 0.010, 'chrome', 4);
    // signature external seams: wing/A-panel and rear quarter
    m.tube([0.27, 0.40, 0.55, 0.70, 0.81].map((z) => [side * (sideX(0.69 - 0.03 * (z - 0.27), z) + 0.004), z, 0.69 - 0.03 * (z - 0.27)]), 0.007, 'paint', 6);
    { const zt = profile(-1.36)[6][1]; m.tube([0.32, 0.45, 0.58, zt - 0.005].map((z) => [side * (sideX(-1.36, z) + 0.004), z, -1.36]), 0.007, 'paint', 6); }
    // door shut lines
    seam(m, [[0.625, 0.81], [0.64, 0.66], [0.635, 0.45], [0.61, 0.28], [0.57, 0.235], [-0.26, 0.235], [-0.30, 0.27], [-0.30, 0.81]], side, 'seam');
    m.box([side * (sideX(-0.16, 0.75) + 0.012), 0.75, -0.16], [0.016, 0.022, 0.11], 'chrome');          // door handle
    for (const z of [0.34, 0.68]) m.box([side * (sideX(0.61, z) + 0.008), z, 0.62], [0.014, 0.022, 0.10], 'paint'); // external hinges
    const fc = [side * (sideX(-1.25, 0.76) + 0.005), 0.76, -1.25];
    m.tube([fc, add(fc, [side * 0.03, 0, 0])], 0.042, 'chrome', 14);                                   // twin fuel caps
    // drip rail along the roof edge
    const rail = []; for (let i = 0; i <= 16; i++) { const s = -1.0 + 1.39 * i / 16, P = profile(s); rail.push([side * (P[11][0] + 0.006), P[11][1] - 0.004, s]); }
    m.tube(rail, 0.008, 'roof', 4);
  }
  // sliding door glass: thin vertical chrome divider and catch; quarter-light catch
  for (const gl of body.glazing.filter((g) => g.win.name === 'door')) {
    const pts = [B0 + 0.004, (B0 + GLASS_TOP) / 2, GLASS_TOP - 0.004].map((z) => gl.P([0.085, z], 0.003));
    m.tube(pts, 0.0055, 'chrome', 4);
    m.tube([gl.P([0.06, B0 + 0.05], 0.004), gl.P([0.11, B0 + 0.05], 0.004)], 0.006, 'chrome', 4);
  }
  // race roundels: both doors and the bonnet (reading from the side / from the front)
  for (const side of [1, -1]) roundel(m, RACE_NUMBER, 0.15, (u, v, lift) => { const s = 0.17 - side * u, z = 0.52 + v; return [side * (sideX(s, z) + lift), z, s]; }, [side, 0, 0]);
  const bonnetY = (x, s) => TOP(s) - 0.03 * (x / (0.46 - 0.06 * smooth((s - 0.69) / 0.6))) ** 2;
  roundel(m, RACE_NUMBER, 0.14, (u, v, lift) => { const s = 1.03 - v; return [u, bonnetY(u, s) + lift, s]; }, [0, 1, 0]);
  // bonnet centre crease, wipers lying on the screen base
  m.tube([1.33, 1.21].map((s) => [0, TOP(s) + 0.002, s]), 0.006, 'paint', 4);
  m.tube([0.85, 0.77].map((s) => [0, TOP(s) + 0.002, s]), 0.006, 'paint', 4);
  const ws = body.glazing.find((g) => g.win.name === 'screen');
  for (const [x0, x1] of [[0.30, -0.02], [-0.06, -0.38]]) {
    m.tube([x0, (x0 + x1) / 2, x1].map((x, i) => ws.P([x, 0.665 - 0.03 * i / 2 * Math.sign(x0 - x1) * 0.4], 0.012)), 0.006, 'chrome', 4);
    m.tube([ws.P([x0, 0.672], 0.004), ws.P([x0, 0.69], 0.02)], 0.008, 'chrome', 4);
  }
  return m;
}

// ---------------------------------------------------------------- interior
function buildInterior() {
  const m = new Mesh();
  const inset = (p, d) => p.map((q, i) => { const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, p.length - 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [i === 0 || i === p.length - 1 ? 0 : Math.max(0, q[0] - (b[1] - a[1]) / l * d), q[1] + (b[0] - a[0]) / l * d]; });
  const strip = (ss, ring, tgt) => {
    const R = ss.map((s) => ring(s).map(([x, z]) => [x, z, s]));
    for (let j = 0; j < ss.length - 1; j++) for (let k = 0; k < R[j].length - 1; k++) for (const side of [1, -1]) {
      const f = (p) => [side * p[0], p[1], p[2]];
      m.quad(f(R[j][k]), f(R[j][k + 1]), f(R[j + 1][k + 1]), f(R[j + 1][k]), 'int', { toward: [0, tgt, (ss[j] + ss[j + 1]) / 2] });
    }
  };
  // tub: floor + door cards up to the sill (pulled inboard over the rear arches); headliner
  strip(Array.from({ length: 10 }, (_, i) => 0.60 - 1.62 * i / 9), (s) => {
    const p = profile(s), ip = inset(p.slice(0, 15), 0.03), a = archH(s);
    return [...ip.slice(0, 7).map(([x, z], k) => [k > 0 && z < a + 0.03 ? Math.min(x, WELL_X - 0.02) : x, Math.max(z, 0.19)]), [p[6][0] - 0.012, B0 - 0.004]];
  }, 0.95);
  strip(Array.from({ length: 6 }, (_, i) => 0.36 - 1.33 * i / 5), (s) => { const p = profile(s), ip = inset(p.slice(0, 15), 0.025); return [[p[9][0] - 0.02, GLASS_TOP + 0.006], ip[11], ip[12], ip[13], ip[14]]; }, 0.6);
  m.quad([-0.56, 0.19, 0.60], [0.56, 0.19, 0.60], [0.54, 0.82, 0.60], [-0.54, 0.82, 0.60], 'int', { dir: [0, 0, -1] });      // firewall
  m.quad([-0.54, 0.82, 0.60], [0.54, 0.82, 0.60], [0.50, 0.84, 0.68], [-0.50, 0.84, 0.68], 'int', { dir: [0, 1, 0] });       // scuttle top
  m.quad([-0.55, 0.19, -1.02], [0.55, 0.19, -1.02], [0.55, 0.84, -1.02], [-0.55, 0.84, -1.02], 'int', { dir: [0, 0, 1] });   // rear bulkhead
  m.quad([-0.55, 0.84, -1.02], [0.55, 0.84, -1.02], [0.52, 0.86, -1.20], [-0.52, 0.86, -1.20], 'int', { dir: [0, 1, 0] });   // parcel shelf
  // full-width parcel-shelf dash with the centre instrument nacelle
  m.box([0, 0.72, 0.52], [1.18, 0.05, 0.16], 'int');
  m.box([0, 0.66, 0.46], [1.18, 0.10, 0.03], 'int');
  m.tube([[0, 0.72, 0.49], [0, 0.72, 0.43]], 0.07, 'int', 10);
  m.tube([[0, 0.72, 0.425], [0, 0.72, 0.42]], 0.06, 'gauge', 10);
  // seats: two front buckets, rear bench between the arches
  for (const x of [0.29, -0.29]) {
    m.box([x, 0.33, 0.02], [0.44, 0.10, 0.44], 'seat');
    m.box([x, 0.66, -0.24], [0.44, 0.58, 0.08], 'seat', (p) => [p[0], p[1] * Math.cos(rad(14)) - p[2] * Math.sin(rad(14)), p[1] * Math.sin(rad(14)) + p[2] * Math.cos(rad(14))]);
    m.box([x, 0.24, 0.02], [0.30, 0.08, 0.30], 'int');
  }
  m.box([0, 0.34, -0.80], [0.94, 0.12, 0.40], 'seat');
  m.box([0, 0.64, -0.98], [0.94, 0.50, 0.08], 'seat', (p) => [p[0], p[1] * Math.cos(rad(12)) - p[2] * Math.sin(rad(12)), p[1] * Math.sin(rad(12)) + p[2] * Math.cos(rad(12))]);
  // big thin "bus" steering wheel (left-hand drive), column, gear lever, mirror
  const sw = new Mesh(), segs = 16, rs = 4, T = (i, k) => { const a = 2 * Math.PI * i / segs, b = 2 * Math.PI * k / rs, r = 0.19 + 0.012 * Math.cos(b); return [r * Math.cos(a), 0.012 * Math.sin(b), r * Math.sin(a)]; };
  for (let i = 0; i < segs; i++) for (let k = 0; k < rs; k++) { const a = 2 * Math.PI * (i + 0.5) / segs; sw.quad(T(i, k), T(i + 1, k), T(i + 1, k + 1), T(i, k + 1), 'int', { away: [0.19 * Math.cos(a), 0, 0.19 * Math.sin(a)] }); }
  sw.box([0, 0, 0], [0.38, 0.012, 0.025], 'int'); sw.box([0, 0, -0.09], [0.025, 0.012, 0.18], 'int');
  const tilt = (p) => { const c = Math.cos(rad(-50)), s = Math.sin(rad(-50)); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
  m.addFrom(sw, (p) => { const q = tilt(p); return [q[0] + 0.30, q[2] + 0.84, -q[1] + 0.30]; });
  m.tube([[0.30, 0.82, 0.32], [0.30, 0.62, 0.58]], 0.02, 'int', 6);
  m.tube([[0, 0.20, 0.25], [0, 0.48, 0.18]], 0.008, 'metal', 4); m.ellipsoid([0, 0.49, 0.18], [0.02, 0.02, 0.02], 'int', 6, 4);
  m.box([0, 1.20, 0.42], [0.18, 0.05, 0.012], 'int');
  return m;
}

// ---------------------------------------------------------------- wheels (local: axle = X, outboard = +X)
function buildWheel({ R, W: TW, RIM }) {
  const m = new Mesh(), h = TW / 2, rm = (R + RIM) / 2;
  m.revolveX([[-h * .85, RIM + .01], [-h, R - .07], [-h * .96, R - .022], [-h * .80, R], [-h * .42, R], [-h * .38, R - .005], [-h * .30, R - .005], [-h * .26, R],
    [h * .26, R], [h * .30, R - .005], [h * .38, R - .005], [h * .42, R], [h * .80, R], [h * .96, R - .022], [h, R - .07], [h * .85, RIM + .01]], WSEG, 'tire',
    (c) => { const k = rm / Math.hypot(c[1], c[2]); return { away: [0, c[1] * k, c[2] * k] }; });
  // silver dished wheel: lip, dish, hub boss
  m.revolveX([[h * .85, RIM + .01], [h * .92, RIM + .002], [h * .80, RIM - .012], [h * .35, .11], [h * .30, .055], [h * .55, .03], [h * .60, .008]], WSEG, 'rim', (c) => ({ toward: [c[0] + 0.2, 0, 0] }));
  m.revolveX([[h * .80, RIM - .012], [-h * .85, RIM - .012]], WSEG, 'rim', { toward: [0, 0, 0] });
  // 8 oval vent holes in the dish
  for (let k = 0; k < 8; k++) {
    const a = 2 * Math.PI * (k + 0.5) / 8, ca = Math.cos(a), sa = Math.sin(a), rc = 0.086, ax = h * 0.32 + 0.003;
    const c = [ax, rc * ca, rc * sa], pts = [];
    for (let i = 0; i < 12; i++) { const t = 2 * Math.PI * i / 12, u = 0.029 * Math.cos(t), v = 0.018 * Math.sin(t); pts.push([ax, (rc + u) * ca - v * sa, (rc + u) * sa + v * ca]); }
    pts.forEach((p, i) => m.tri(c, p, pts[(i + 1) % 12], 'hole', { dir: [1, 0, 0] }));
  }
  // centre cap + four studs, brake drum behind
  m.revolveX([[h * .60, .03], [h * .78, .022], [h * .82, .0]], 8, 'metal', { away: [0, 0, 0] });
  for (let k = 0; k < 4; k++) { const a = 2 * Math.PI * k / 4; m.box([h * 0.62, 0.042 * Math.cos(a), 0.042 * Math.sin(a)], [0.014, 0.012, 0.012], 'metal'); }
  m.revolveX([[-h * .7, .06], [-h * .7, RIM - .02], [h * .2, RIM - .02]], 12, 'disc', (c) => ({ away: [h, 0, 0] }));
  return m;
}

// ---------------------------------------------------------------- materials (linear colours)
const MATS = {
  paint: { name: 'MINI_Paint', c: [0.45, 0.006, 0.011], r: 0.3, mt: 0.05, ds: true },   // Tartan Red (#b3121b)
  roof: { name: 'MINI_Roof', c: [0.90, 0.88, 0.80], r: 0.32, ds: true },             // Old English White
  roundel: { name: 'MINI_Roundel', c: [0.86, 0.86, 0.84], r: 0.4 },
  number: { name: 'MINI_Number', c: [0.015, 0.015, 0.015], r: 0.5 },
  chrome: { name: 'MINI_Chrome', c: [0.80, 0.80, 0.82], r: 0.18, mt: 0.45 },
  glass: { name: 'MINI_Glass', c: [0.35, 0.45, 0.45], r: 0.05, a: 0.3, ds: true },
  grille: { name: 'MINI_Grille', c: [0.01, 0.01, 0.01], r: 0.8, ds: true },
  seal: { name: 'MINI_Seal', c: [0.012, 0.012, 0.012], r: 0.6 },
  seam: { name: 'MINI_Seam', c: [0.04, 0.05, 0.04], r: 0.8 },
  lamp: { name: 'MINI_Headlight', c: [0.30, 0.31, 0.32], r: 0.04, mt: 0.6, e: [0.02, 0.02, 0.018] },
  indicator: { name: 'MINI_Indicator', c: [0.85, 0.22, 0.01], r: 0.2, e: [0.35, 0.07, 0.0] },
  tail: { name: 'MINI_Taillight', c: [0.5, 0.02, 0.01], r: 0.2, e: [1, 0.02, 0.01] },
  tire: { name: 'MINI_Tire', c: [0.025, 0.025, 0.025], r: 0.85 },
  rim: { name: 'MINI_Rim', c: [0.55, 0.56, 0.58], r: 0.35, mt: 0.45, ds: true },
  hole: { name: 'MINI_RimHole', c: [0.01, 0.01, 0.01], r: 0.9 },
  disc: { name: 'MINI_BrakeDrum', c: [0.10, 0.10, 0.10], r: 0.7 },
  metal: { name: 'MINI_Metal', c: [0.6, 0.6, 0.62], r: 0.3, mt: 0.45, ds: true },
  well: { name: 'MINI_WheelWell', c: [0.01, 0.01, 0.01], r: 0.9, ds: true },
  under: { name: 'MINI_Under', c: [0.02, 0.02, 0.02], r: 0.9, ds: true },
  int: { name: 'MINI_Interior', c: [0.03, 0.03, 0.032], r: 0.8, ds: true },
  seat: { name: 'MINI_Seat', c: [0.05, 0.05, 0.055], r: 0.55 },
  gauge: { name: 'MINI_Gauge', c: [0.6, 0.6, 0.55], r: 0.3 },
};

// ---------------------------------------------------------------- assemble + write
const body = buildBody();
const parts = { body: [body, 40], details: [buildDetails(body), 50], interior: [buildInterior(), 35] };
const nodes = KIT
  ? [{ name: 'MINI_Shell', prims: body.build(40) }, { name: 'MINI_Body', prims: mergePrims([parts.details, parts.interior].map(([m, c]) => m.build(c))) }]
  : [{ name: 'MINI_Body', prims: mergePrims(Object.values(parts).map(([m, crease]) => m.build(crease))) }];
const stats = Object.fromEntries(Object.entries(parts).map(([k, [m]]) => [k, m.tris.length]));
for (const [name, x, z] of [['FL', TRACK_F, AXLE], ['FR', -TRACK_F, AXLE], ['RL', TRACK_R, -AXLE], ['RR', -TRACK_R, -AXLE]]) {
  let w = buildWheel(WH);
  if (x < 0) w = w.mirroredX();
  nodes.push({ name: `MINI_Wheel_${name}`, at: [x, WH.R, z], prims: w.build(40) });
  stats[`wheel_${name}`] = w.tris.length;
}
const here = dirname(fileURLToPath(import.meta.url));
const out = KIT ? join(here, 'blender', 'mini_kit.glb') : join(here, '..', 'assets', 'models', 'mini.glb');
if (KIT) writeFileSync(join(here, 'blender', 'mini_kit.json'), JSON.stringify(KIT_DATA));
const total = writeGLB(out, nodes, MATS);
console.log(stats, `\nTOTAL ${total} triangles -> ${out}`);
if (total >= 20000) { console.error('Over the 20k triangle budget'); process.exitCode = 1; }
