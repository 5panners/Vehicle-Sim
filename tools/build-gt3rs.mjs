// Procedural low-poly 992 GT3 RS-style race car -> assets/models/gt3rs-proc.glb
// No dependencies, no Blender:  node tools/build-gt3rs.mjs
//
// Output axes are the game's: +Z forward, +X = car's left, +Y up, ground at y = 0,
// origin midway between the axles. Wheels/calipers are separate nodes at the hubs.
import { dirname, join } from 'node:path';
import { add, sub, mul, dot, cross, unit, clamp01, smooth, rad, B, rotX, rotY, Mesh, pchip, writeGLB, mergePrims } from './lib/carmesh.mjs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- dimensions (real car)
const AXLE_F = 1.230, AXLE_R = -1.227;                         // wheelbase 2.457
const TRACK_F = 0.815, TRACK_R = 0.792;                        // half tracks
const WF = { R: 0.350, W: 0.275, RIM: 0.254 }, WR = { R: 0.367, W: 0.335, RIM: 0.267 };
const ARCHES = [{ sc: AXLE_F, hub: WF.R, ra: 0.392 }, { sc: AXLE_R, hub: WR.R, ra: 0.408 }];
const ROCKER_Z = 0.17, WELL_X = 0.56;

// Body cross-sections. Each: [design y (rearward), 12 half-profile points (x, height)]
// r0 floor centre, r1 floor edge, r2 rocker, r3 lower side, r4 mid side, r5 shoulder,
// r6 fender crown, r7 belt, r8 window sill / hood edge, r9 roof edge (A-pillar),
// r10 roof / hood inner, r11 top centre
const BASE = [
  [-2.286, [[0, .24], [.46, .24], [.52, .27], [.55, .36], [.545, .46], [.52, .52], [.46, .545], [.37, .55], [.28, .552], [.19, .553], [.10, .554], [0, .555]]],
  [-2.220, [[0, .15], [.62, .15], [.70, .20], [.745, .36], [.735, .52], [.70, .61], [.63, .655], [.50, .63], [.41, .625], [.29, .628], [.14, .632], [0, .633]]],
  [-2.100, [[0, .13], [.74, .13], [.82, .18], [.86, .36], [.855, .56], [.835, .69], [.75, .77], [.60, .705], [.50, .69], [.35, .692], [.18, .696], [0, .70]]],
  [-1.900, [[0, .12], [.79, .12], [.88, .17], [.915, .36], [.91, .58], [.89, .75], [.78, .835], [.62, .76], [.54, .745], [.38, .748], [.19, .752], [0, .755]]],
  [-1.600, [[0, .12], [.82, .12], [.91, .17], [.94, .40], [.935, .62], [.905, .79], [.79, .855], [.65, .80], [.58, .79], [.41, .795], [.21, .80], [0, .805]]],
  [-1.230, [[0, .12], [.83, .12], [.925, .17], [.95, .42], [.945, .64], [.915, .81], [.80, .87], [.68, .84], [.62, .835], [.44, .842], [.22, .848], [0, .852]]],
  [-0.900, [[0, .12], [.82, .12], [.91, .17], [.935, .42], [.93, .64], [.90, .80], [.82, .885], [.74, .915], [.70, .925], [.66, .93], [.33, .935], [0, .94]]],
  [-0.550, [[0, .12], [.80, .12], [.885, .17], [.91, .42], [.905, .64], [.88, .79], [.83, .88], [.79, .93], [.775, .95], [.62, 1.08], [.32, 1.115], [0, 1.125]]],
  [-0.220, [[0, .12], [.79, .12], [.875, .17], [.90, .42], [.895, .64], [.87, .79], [.825, .88], [.79, .935], [.775, .955], [.575, 1.245], [.30, 1.285], [0, 1.295]]],
  [0.150, [[0, .12], [.79, .12], [.875, .17], [.90, .42], [.895, .64], [.87, .79], [.825, .88], [.795, .94], [.78, .96], [.565, 1.27], [.29, 1.31], [0, 1.32]]],
  [0.500, [[0, .12], [.80, .12], [.89, .17], [.915, .42], [.91, .65], [.885, .80], [.84, .89], [.805, .945], [.79, .965], [.57, 1.24], [.29, 1.285], [0, 1.295]]],
  [0.850, [[0, .12], [.83, .12], [.92, .17], [.945, .43], [.94, .67], [.915, .83], [.87, .92], [.83, .96], [.80, .985], [.59, 1.155], [.30, 1.195], [0, 1.20]]],
  [1.227, [[0, .12], [.85, .12], [.935, .17], [.96, .44], [.955, .69], [.93, .86], [.875, .985], [.75, .975], [.68, 1.02], [.58, 1.05], [.30, 1.075], [0, 1.08]]],
  [1.600, [[0, .12], [.84, .12], [.93, .17], [.955, .45], [.95, .70], [.925, .86], [.865, .965], [.74, .95], [.66, .965], [.55, .975], [.29, .985], [0, .99]]],
  [1.900, [[0, .14], [.80, .14], [.90, .19], [.93, .46], [.925, .70], [.895, .85], [.835, .94], [.72, .935], [.64, .95], [.50, .958], [.26, .962], [0, .965]]],
  [2.100, [[0, .20], [.74, .20], [.85, .24], [.885, .46], [.88, .68], [.855, .82], [.785, .91], [.69, .935], [.60, .942], [.46, .946], [.24, .95], [0, .95]]],
  [2.220, [[0, .24], [.69, .24], [.785, .27], [.82, .46], [.815, .66], [.79, .79], [.73, .865], [.64, .90], [.55, .912], [.42, .917], [.22, .92], [0, .92]]],
  [2.286, [[0, .28], [.60, .28], [.69, .30], [.72, .46], [.715, .64], [.69, .76], [.63, .83], [.54, .86], [.47, .87], [.36, .875], [.18, .88], [0, .88]]],
].map(([y, p]) => [-y, p]).sort((a, b) => a[0] - b[0]);       // -> s (forward), ascending
const S_MIN = BASE[0][0], S_MAX = BASE[BASE.length - 1][0];

const SX = BASE.map((b) => b[0]);
const FX = Array.from({ length: 12 }, (_, r) => pchip(SX, BASE.map((b) => b[1][r][0])));
const FZ = Array.from({ length: 12 }, (_, r) => pchip(SX, BASE.map((b) => b[1][r][1])));
const base12 = (s) => { s = Math.max(S_MIN, Math.min(S_MAX, s)); return FX.map((f, r) => [r === 0 || r === 11 ? 0 : f(s), FZ[r](s)]); };
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// glazing layout (s = forward position)
const WIN = { front: 0.80, rear: -1.12 };                      // side window
const WS = { base: 0.88, top: 0.26 }, RW = { top: -0.60, base: -1.12 }, ROOF_FRONT = 0.22;
const winF = (s) => (s >= WIN.front || s <= WIN.rear ? 0 : 0.84 * Math.min(smooth((WIN.front - s) / 0.22), smooth((s - WIN.rear) / 0.4)));
const pilF = (s) => 0.14 + 0.16 * smooth((-0.5 - s) / 0.3);
const archH = (s) => { for (const a of ARCHES) { const d = s - a.sc; if (Math.abs(d) < a.ra) return a.hub + Math.sqrt(a.ra * a.ra - d * d); } return 0; };

// 14-row section: r0..r8 as BASE, r9 window top, r10 roof edge, r11 glass edge, r12 inner, r13 centre.
// Inside a wheel arch the lower side rows are lifted onto the arch opening.
function profile(s) {
  const o = base12(s);
  const P = [o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], lerp2(o[8], o[9], winF(s)), o[9], lerp2(o[9], o[10], pilF(s)), o[10], o[11]];
  const a = archH(s);
  P.arch = a > o[2][1] + 1e-4;
  if (P.arch) {
    const poly = [o[2], o[3], o[4], o[5]], z2 = o[2][1], z5 = o[5][1];
    const xAt = (z) => { for (let i = 0; i < 3; i++) if (z <= poly[i + 1][1]) return lerp2(poly[i], poly[i + 1], (z - poly[i][1]) / (poly[i + 1][1] - poly[i][1]))[0]; return poly[3][0]; };
    for (const k of [2, 3, 4]) { const z = a + (o[k][1] - z2) * (z5 - a) / (z5 - z2); P[k] = [xAt(z), z]; }
    P[1] = P[2];
  }
  P.floorX = P.arch ? WELL_X : o[1][0];
  return P;
}

function stations() {
  const keep = [];
  const addIf = (s, tol) => { if (keep.every((k) => Math.abs(k - s) >= tol)) keep.push(s); };
  for (const s of [S_MIN, S_MAX, WS.base, WIN.front, WS.top, ROOF_FRONT, RW.top, RW.base, -1.22, -1.62, 2.08, -1.95, 0.95]) addIf(s, 1e-6);
  for (const a of ARCHES) {
    const t0 = Math.asin((ROCKER_Z - a.hub) / a.ra), n = 10;
    for (let i = 0; i <= n; i++) addIf(a.sc + a.ra * Math.cos(t0 + (Math.PI - 2 * t0) * i / n), 0.02);
  }
  const n = Math.ceil((S_MAX - S_MIN) / 0.11);
  for (let i = 1; i < n; i++) addIf(S_MIN + (S_MAX - S_MIN) * i / n, 0.065);
  return keep.sort((a, b) => a - b);
}

function zone(k, s) {
  if (k === 1) return 'trim';
  if (k <= 3) { if (s > 2.08) return 'grille'; if (s < -1.95 && k === 2) return 'trim'; return 'paint'; }
  if (k === 8) return 'glass';
  if (k >= 11) {
    if (s > WS.top && s < WS.base) return 'glass';
    if (s > RW.top && s <= WS.top) return 'carbon';
    if (s > RW.base && s <= RW.top) return 'glass';
    if (s > 0.95 && s < 2.08) return 'carbon';
    if (k === 12 && s > -1.62 && s < -1.22) return 'grille';
  }
  return 'paint';
}

// ---------------------------------------------------------------- body shell
function buildBody() {
  const m = new Mesh(), S = stations(), rings = S.map(profile);
  const pt = (P, k, side, s) => [side * P[k][0], P[k][1], s];
  for (let i = 0; i < S.length - 1; i++) {
    const s0 = S[i], s1 = S[i + 1], sm = (s0 + s1) / 2, P0 = rings[i], P1 = rings[i + 1];
    for (const side of [1, -1]) {
      for (let k = 1; k < 13; k++) m.quad(pt(P0, k, side, s0), pt(P0, k + 1, side, s0), pt(P1, k + 1, side, s1), pt(P1, k, side, s1), zone(k, sm), { away: [0, 0.5, sm] });
      const arch = ARCHES.find((a) => Math.abs(sm - a.sc) < a.ra);
      if (arch && (P0.arch || P1.arch)) { // wheel well: tunnel roof + inner wall
        const hub = [side * 0.8, arch.hub, arch.sc], e0 = pt(P0, 2, side, s0), e1 = pt(P1, 2, side, s1);
        const i0 = [side * WELL_X, e0[1], s0], i1 = [side * WELL_X, e1[1], s1];
        m.quad(e0, e1, i1, i0, 'well', { toward: hub });
        m.quad(i0, i1, [side * WELL_X, P1[0][1], s1], [side * WELL_X, P0[0][1], s0], 'well', { toward: hub });
      }
    }
    m.quad([-P0.floorX, P0[0][1], s0], [P0.floorX, P0[0][1], s0], [P1.floorX, P1[0][1], s1], [-P1.floorX, P1[0][1], s1], 'well', { dir: [0, -1, 0] });
  }
  // nose and tail caps, banded by row so they can carry intakes / the light bar
  for (const [P, s, dir, zm] of [[rings[rings.length - 1], S_MAX, 1, (k) => (k === 1 ? 'trim' : k <= 3 ? 'grille' : 'paint')],
    [rings[0], S_MIN, -1, (k) => (k <= 2 ? 'trim' : k === 5 ? 'tail' : 'paint')]]) {
    for (let k = 1; k < 13; k++) m.quad(pt(P, k, -1, s), pt(P, k, 1, s), pt(P, k + 1, 1, s), pt(P, k + 1, -1, s), zm(k), { dir: [0, 0, dir] });
  }
  return m;
}

// ---------------------------------------------------------------- surface details
const surf = (s, u, side) => { const P = profile(s), k = Math.max(0, Math.min(12, Math.floor(u))), a = P[k], b = P[k + 1], t = u - k; return [side * (a[0] + (b[0] - a[0]) * t), a[1] + (b[1] - a[1]) * t, s]; };
function surfOff(s, u, side, off) {
  const e = 0.02, ds = sub(surf(Math.min(s + e, S_MAX), u, side), surf(Math.max(s - e, S_MIN), u, side)), du = sub(surf(s, Math.min(u + 0.2, 12.99), side), surf(s, Math.max(u - 0.2, 0), side));
  let n = unit(cross(ds, du)); const p = surf(s, u, side);
  if (dot(n, sub(p, [0, 0.45, s])) < 0) n = mul(n, -1);
  return add(p, mul(n, off));
}
// grid: rows of [s, u, extraOffset?] laid onto the body surface, both sides
function decal(m, grid, mat, off = 0.004) {
  for (const side of [1, -1]) {
    const G = grid.map((row) => row.map(([s, u, x = 0]) => surfOff(s, u, side, off + x)));
    for (let i = 0; i < G.length - 1; i++) for (let j = 0; j < G[i].length - 1; j++) {
      const c = grid[i][j];
      m.quad(G[i][j], G[i][j + 1], G[i + 1][j + 1], G[i + 1][j], mat, { away: [0, 0.45, c[0]] });
    }
  }
}
const patch = (s0, s1, u0, u1, ns = 2, nu = 2) => Array.from({ length: nu + 1 }, (_, i) => Array.from({ length: ns + 1 }, (_, j) => [s0 + (s1 - s0) * j / ns, u0 + (u1 - u0) * i / nu]));
const oval = (sc, uc, rs, ru, n = 16, rings = 3, dome = 0) => Array.from({ length: rings + 1 }, (_, r) => Array.from({ length: n + 1 }, (_, i) => { const a = 2 * Math.PI * i / n, f = r / rings; return [sc + rs * f * Math.cos(a), uc + ru * f * Math.sin(a), dome * (1 - f * f)]; }));

function buildDetails() {
  const m = new Mesh();
  decal(m, oval(2.03, 6.0, 0.165, 1.2, 16, 3, 0.03), 'lamp');                       // headlights
  decal(m, patch(1.52, 1.93, 11.35, 12.75, 3, 3), 'grille', 0.005);                  // hood nostrils
  for (let i = 0; i < 4; i++) decal(m, patch(1.55, 1.92, 11.55 + i * 0.32, 11.63 + i * 0.32, 3, 1), 'carbon', 0.012); // nostril vanes
  for (let i = 0; i < 6; i++) decal(m, patch(1.08 + i * 0.075, 1.12 + i * 0.075, 5.35, 6.75, 1, 3), 'grille', 0.005);  // fender louvres
  decal(m, oval(-0.80, 5.0, 0.065, 0.62, 12, 2), 'grille');                          // rear-fender intakes
  decal(m, patch(-0.36, -0.20, 6.15, 6.42, 1, 1), 'trim', 0.012);                    // door handles
  decal(m, patch(S_MIN, -1.93, 5.4, 5.95, 3, 1), 'tail', 0.004);                     // light bar wrap-around
  decal(m, patch(2.10, 2.26, 4.15, 4.4, 2, 1), 'lamp', 0.004);                       // front DRL strips
  return m;
}

// ---------------------------------------------------------------- aero, mirrors, exhaust (design coords)
function airfoil(chord, le, aoa) {
  const cs = [0, .05, .2, .4, .65, .85, 1], lo = [0, -.03, -.055, -.06, -.045, -.022, 0], up = [0, .012, .014, .012, .008, .004, 0];
  const c = Math.cos(rad(aoa)), s = Math.sin(rad(aoa));
  const P = (u, v) => [le[0] + (u * c - v * s) * chord, le[1] + (u * s + v * c) * chord];
  return [cs.map((u, i) => P(u, lo[i])), cs.map((u, i) => P(u, up[i]))];
}
function buildAero() {
  const m = new Mesh(), side3 = (w, p) => [w, p[0], p[1]];   // (y, z) outline extruded along x
  const span = 0.86;
  let [lo, up] = airfoil(0.34, [1.86, 1.175], 10); m.stripPrism(up, lo, side3, -span, span, 'carbon');
  [lo, up] = airfoil(0.17, [2.13, 1.235], 32); m.stripPrism(up, lo, side3, -span + 0.01, span - 0.01, 'carbon');
  const ep = [[1.82, 1.10], [2.30, 1.16], [2.33, 1.40], [2.12, 1.39], [1.86, 1.24]];
  const cl = [[1.66, 0.96], [1.72, 1.08], [1.80, 1.21], [1.90, 1.28], [1.99, 1.28], [2.04, 1.24], [2.05, 1.20]], w = 0.028;
  const nA = [], nB = [];
  cl.forEach((p, i) => { const a = cl[Math.max(i - 1, 0)], b = cl[Math.min(i + 1, cl.length - 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; nA.push([p[0] + n[0] * w, p[1] + n[1] * w]); nB.push([p[0] - n[0] * w, p[1] - n[1] * w]); });
  for (const s of [1, -1]) {
    m.polyPrism(ep, side3, s * span, s * (span + 0.012), 'carbon');
    m.stripPrism(nA, nB, side3, s * 0.30 - 0.01, s * 0.30 + 0.01, 'trim');       // swan-neck uprights
    m.box([s * 0.875, -0.10, 0.14], [0.05, 1.62, 0.045], 'carbon');              // side skirts
    m.box([s * 0.80, -2.10, 0.30], [0.16, 0.10, 0.012], 'carbon');               // dive planes
    m.ellipsoid([s * 1.01, -0.50, 1.02], [0.11, 0.07, 0.055], 'carbon');         // mirror pods
    m.box([s * 0.88, -0.52, 0.985], [0.20, 0.035, 0.025], 'carbon', (p) => rotY(p, s * 8));
  }
  // front splitter (plan outline)
  const xs = [-.88, -.86, -.76, -.58, -.30, 0, .30, .58, .76, .86, .88], yf = [-1.92, -2.05, -2.18, -2.27, -2.32, -2.335, -2.32, -2.27, -2.18, -2.05, -1.92];
  m.stripPrism(xs.map((x, i) => [x, yf[i]]), xs.map((x) => [x, -1.90]), (wz, p) => [p[0], p[1], wz], 0.095, 0.115, 'carbon');
  for (const x of [-0.48, -0.24, 0, 0.24, 0.48]) m.box([x, 2.10, 0.165], [0.012, 0.40, 0.09], 'carbon'); // diffuser strakes
  for (const x of [-0.075, 0.075]) {                                               // twin centre exhausts
    m.tube([[x, 2.18, 0.33], [x, 2.34, 0.33]], 0.055, 'metal', 12);
    for (let k = 0; k < 12; k++) { const a0 = 2 * Math.PI * k / 12, a1 = 2 * Math.PI * (k + 1) / 12, P = (a) => [x + 0.055 * Math.cos(a), 2.30, 0.33 + 0.055 * Math.sin(a)]; m.tri([x, 2.30, 0.33], P(a0), P(a1), 'grille', { dir: [0, 1, 0] }); }
  }
  return new Mesh().addFrom(m, B);
}

// ---------------------------------------------------------------- interior (design coords)
function buildInterior() {
  const m = new Mesh();
  const inset = (p, d) => p.map((q, i) => { const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, p.length - 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [i === 0 || i === p.length - 1 ? 0 : Math.max(0, q[0] - (b[1] - a[1]) / l * d), q[1] + (b[0] - a[0]) / l * d]; });
  const strip = (ys, ring, tgtZ) => {
    const R = ys.map((y) => ring(y).map(([x, z]) => [x, y, z]));
    for (let j = 0; j < ys.length - 1; j++) for (let k = 0; k < R[j].length - 1; k++) for (const s of [1, -1]) {
      const f = (p) => [s * p[0], p[1], p[2]];
      m.quad(f(R[j][k]), f(R[j][k + 1]), f(R[j + 1][k + 1]), f(R[j + 1][k]), 'int', { toward: [0, (ys[j] + ys[j + 1]) / 2, tgtZ] });
    }
  };
  // tub (floor, sills, door cards up to the window sill) and headliner
  strip(Array.from({ length: 9 }, (_, i) => -0.80 + 1.6 * i / 8), (y) => { const p = base12(-y), ip = inset(p, 0.035); return [...ip.slice(0, 9), [p[8][0] - 0.004, p[8][1] - 0.003]]; }, 0.75);
  strip(Array.from({ length: 6 }, (_, i) => -0.24 + 0.84 * i / 5), (y) => { const p = base12(-y), ip = inset(p, 0.03); return [[p[9][0] - 0.004, p[9][1] - 0.004], ip[9], ip[10], ip[11]]; }, 0.6);
  m.quad([-0.72, -0.80, 0.15], [0.72, -0.80, 0.15], [0.70, -0.80, 0.88], [-0.70, -0.80, 0.88], 'int', { dir: [0, 1, 0] });   // firewall
  m.quad([-0.76, 0.80, 0.15], [0.76, 0.80, 0.15], [0.76, 0.80, 0.97], [-0.76, 0.80, 0.97], 'int', { dir: [0, -1, 0] });  // rear bulkhead
  m.quad([-0.74, 0.80, 0.97], [0.74, 0.80, 0.97], [0.62, 1.32, 0.99], [-0.62, 1.32, 0.99], 'int', { dir: [0, 0, 1] });   // parcel shelf
  const side3 = (w, p) => [w, p[0], p[1]];
  m.polyPrism([[-0.93, 0.40], [-0.93, 0.86], [-0.88, 0.905], [-0.62, 0.975], [-0.52, 0.965], [-0.47, 0.90], [-0.48, 0.74], [-0.56, 0.55], [-0.66, 0.40]], side3, -0.70, 0.70, 'int'); // dashboard
  m.polyPrism([[-0.66, 0.97], [-0.62, 1.035], [-0.52, 1.03], [-0.48, 0.97]], side3, 0.20, 0.52, 'int');                 // gauge binnacle
  m.box([0, -0.20, 0.30], [0.20, 0.70, 0.28], 'int'); m.box([0, -0.08, 0.50], [0.025, 0.025, 0.14], 'metal');          // console + shifter
  const rb = (p) => rotX(p, -18);
  for (const x of [0.37, -0.37]) {                                                                                    // bucket seats + harnesses
    m.box([x, 0.05, 0.25], [0.48, 0.50, 0.12], 'int'); m.box([x, 0.36, 0.66], [0.50, 0.09, 0.82], 'int', rb);
    for (const s of [-1, 1]) {
      m.box([x + s * 0.22, 0.30, 0.62], [0.07, 0.20, 0.70], 'int', rb); m.box([x + s * 0.21, 0.05, 0.32], [0.07, 0.45, 0.12], 'int');
      m.box([x + s * 0.09, 0.305, 0.72], [0.045, 0.012, 0.62], 'intred', rb);
    }
  }
  // steering wheel (left-hand drive) + column
  const sw = new Mesh(), segs = 14, rs = 4, T = (i, k) => { const a = 2 * Math.PI * i / segs, b = 2 * Math.PI * k / rs, r = 0.175 + 0.018 * Math.cos(b); return [r * Math.cos(a), 0.018 * Math.sin(b), r * Math.sin(a)]; };
  for (let i = 0; i < segs; i++) for (let k = 0; k < rs; k++) { const a = 2 * Math.PI * (i + 0.5) / segs; sw.quad(T(i, k), T(i + 1, k), T(i + 1, k + 1), T(i, k + 1), 'int', { away: [0.175 * Math.cos(a), 0, 0.175 * Math.sin(a)] }); }
  sw.box([0, 0, -0.02], [0.30, 0.03, 0.06], 'int'); sw.box([0, 0, -0.10], [0.05, 0.03, 0.16], 'int'); sw.box([0, -0.012, 0.175], [0.022, 0.012, 0.03], 'intred');
  m.addFrom(sw, (p) => add(rotX(p, -22), [0.37, -0.40, 0.85]));
  m.tube([[0.37, -0.42, 0.84], [0.37, -0.62, 0.93]], 0.025, 'int');
  // roll cage
  const yh = 0.66;
  m.tube([[-0.70, yh, 0.16], [-0.70, yh, 0.90], [-0.56, yh, 1.13], [0, yh, 1.18], [0.56, yh, 1.13], [0.70, yh, 0.90], [0.70, yh, 0.16]], 0.02, 'intred');
  m.tube([[-0.68, yh, 0.30], [0.60, yh, 1.10]], 0.018, 'intred');
  for (const s of [1, -1]) { m.tube([[s * 0.66, yh, 0.62], [s * 0.70, -0.35, 0.60], [s * 0.68, -0.70, 0.75]], 0.018, 'intred'); m.tube([[s * 0.64, yh, 1.00], [s * 0.60, 1.20, 0.98]], 0.018, 'intred'); }
  return new Mesh().addFrom(m, B);
}

// ---------------------------------------------------------------- wheels (local: axle = X, outboard = +X)
function buildWheel({ R, W, RIM }) {
  const m = new Mesh(), h = W / 2, rm = (R + RIM) / 2;
  m.revolveX([[-h * .88, RIM + .012], [-h, R - .055], [-h * .97, R - .018], [-h * .82, R], [h * .82, R], [h * .97, R - .018], [h, R - .055], [h * .88, RIM + .012]], 20, 'tire',
    (c) => { const k = rm / Math.hypot(c[1], c[2]); return { away: [0, c[1] * k, c[2] * k] }; });
  m.revolveX([[h * .88, RIM + .012], [h * .93, RIM + .004], [h * .90, RIM - .012], [h * .55, RIM - .018], [-h * .8, RIM - .018]], 20, 'rim', (c) => ({ toward: [c[0] + 0.1, 0, 0] }));
  for (let k = 0; k < 10; k++) {                                   // spokes, dished toward the hub
    const a = 2 * Math.PI * (k + 0.5) / 10, t = [0, Math.cos(a), Math.sin(a)], n = [0, -Math.sin(a), Math.cos(a)], v = [];
    for (const [r, w, ax] of [[0.07, 0.030, h * .80], [RIM - 0.016, 0.020, h * .60]]) for (const sg of [-1, 1]) for (const th of [0, -0.024]) v.push(add([ax + th, 0, 0], add(mul(t, r), mul(n, w * sg))));
    const c = mul(v.reduce(add), 1 / 8);
    for (const f of [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [4, 5, 7, 6]]) m.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], 'rim', { away: c });
  }
  m.revolveX([[h * .80, 0.012], [h * .80, .05], [h * .72, .085], [h * .5, .09]], 8, 'rim', { away: [0, 0, 0] });
  const dr = RIM - 0.05;
  m.revolveX([[-h * .25, .12], [-h * .25, dr], [-h * .05, dr], [-h * .05, .12]], 16, 'disc', (c) => { const k = (dr + .12) / 2 / Math.hypot(c[1], c[2]); return { away: [-h * .15, c[1] * k, c[2] * k] }; });
  return m;
}
function buildCaliper({ W, RIM }, zsign) {
  const m = new Mesh(), h = W / 2, dr = RIM - 0.05, segs = 5, v = [];
  for (let i = 0; i <= segs; i++) { const a = rad(-25 + 70 * i / segs); for (const r of [dr - 0.07, dr + 0.012]) for (const ax of [-h * .36, 0.02]) v.push([ax, r * Math.sin(a), zsign * r * Math.cos(a)]); }
  const c = mul(v.reduce(add), 1 / v.length), q = (a, b, cc, d) => m.quad(v[a], v[b], v[cc], v[d], 'caliper', { away: c });
  for (let i = 0; i < segs; i++) { const b0 = i * 4, b1 = b0 + 4; q(b0, b0 + 1, b1 + 1, b1); q(b0 + 2, b1 + 2, b1 + 3, b0 + 3); q(b0, b1, b1 + 2, b0 + 2); q(b0 + 1, b0 + 3, b1 + 3, b1 + 1); }
  q(0, 2, 3, 1); q(segs * 4, segs * 4 + 1, segs * 4 + 3, segs * 4 + 2);
  return m;
}

// ---------------------------------------------------------------- materials (linear colours)
const MATS = {
  paint: { name: 'GT3_Paint', c: [0.80, 0.81, 0.82], r: 0.3, mt: 0.1, ds: true },
  carbon: { name: 'GT3_Carbon', c: [0.02, 0.02, 0.022], r: 0.4 },
  trim: { name: 'GT3_TrimBlack', c: [0.012, 0.012, 0.013], r: 0.55 },
  grille: { name: 'GT3_Grille', c: [0.004, 0.004, 0.004], r: 0.8 },
  glass: { name: 'GT3_Glass', c: [0.05, 0.06, 0.07], r: 0.05, a: 0.35, ds: true },
  lamp: { name: 'GT3_Headlight', c: [0.10, 0.11, 0.12], r: 0.08, mt: 0.3, e: [0.25, 0.27, 0.3] },
  tail: { name: 'GT3_Taillight', c: [0.35, 0, 0], r: 0.2, e: [1, 0.02, 0.01] },
  tire: { name: 'GT3_Tire', c: [0.022, 0.022, 0.022], r: 0.85 },
  rim: { name: 'GT3_Rim', c: [0.10, 0.10, 0.11], r: 0.4, mt: 0.4, ds: true },
  disc: { name: 'GT3_BrakeDisc', c: [0.30, 0.30, 0.30], r: 0.45, mt: 0.4 },
  caliper: { name: 'GT3_Caliper', c: [0.75, 0.03, 0.02], r: 0.3 },
  well: { name: 'GT3_WheelWell', c: [0.01, 0.01, 0.01], r: 0.9, ds: true },
  int: { name: 'GT3_Interior', c: [0.03, 0.03, 0.032], r: 0.8, ds: true },
  intred: { name: 'GT3_InteriorRed', c: [0.6, 0.02, 0.02], r: 0.6 },
  metal: { name: 'GT3_Metal', c: [0.55, 0.55, 0.57], r: 0.3, mt: 0.4, ds: true },
};

const parts = { body: [buildBody(), 40], details: [buildDetails(), 45], aero: [buildAero(), 30], interior: [buildInterior(), 35] };
const count = (m) => m.tris.length;
const nodes = [{ name: 'GT3RS_Body', prims: mergePrims(Object.values(parts).map(([m, crease]) => m.build(crease))) }];
const stats = Object.fromEntries(Object.entries(parts).map(([k, [m]]) => [k, count(m)]));
for (const [name, dim, x, z, front] of [['FL', WF, TRACK_F, AXLE_F, true], ['FR', WF, -TRACK_F, AXLE_F, true], ['RL', WR, TRACK_R, AXLE_R, false], ['RR', WR, -TRACK_R, AXLE_R, false]]) {
  let w = buildWheel(dim), c = buildCaliper(dim, front ? -1 : 1);
  if (x < 0) { w = w.mirroredX(); c = c.mirroredX(); }
  nodes.push({ name: `GT3RS_Wheel_${name}`, at: [x, dim.R, z], prims: w.build(40) }, { name: `GT3RS_Caliper_${name}`, at: [x, dim.R, z], prims: c.build(30) });
  stats[`wheel_${name}`] = count(w) + count(c);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'gt3rs-proc.glb');
const total = writeGLB(out, nodes, MATS);
console.log(stats, `\nTOTAL ${total} triangles -> ${out}`);
if (total >= 10000) { console.error('Over the 10k triangle budget'); process.exitCode = 1; }
