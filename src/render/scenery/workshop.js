import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Pit-garage workshop interiors: a tool-lined back wall, a bench, a roll cab, tyre stacks, a dummy car raised on axle stands (or a
 * kart on a stand) and ceiling strip lights. Every workshop of a kind is the same merged geometry, drawn with one InstancedMesh per
 * material, so a dozen of them cost about ten draw calls. The surfaces carry a constant emissive term, so they read as lit rooms by day
 * and glow against the dark at night.
 *
 * Bay frame: origin at the front-centre of the bay on the floor, +z out towards the pit lane (the bay's open face), +x across the bay,
 * +y up; the room runs back to z = -depth.
 */
const lit = (c, k = 0.4, extra = {}) => {
  const col = new THREE.Color(c);
  return new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(k), ...extra });
};

function makeMaterials() {
  return {
    floor: lit(0x5a5e63, 0.45), wall: lit(0xe6e4de, 0.5), dark: lit(0x2a2d31, 0.35), black: lit(0x111214, 0.3), steel: lit(0xa8adb3, 0.4),
    red: lit(0xc62828, 0.45), yellow: lit(0xf2b705, 0.5), blue: lit(0x1d4f91, 0.4), tyre: lit(0x161616, 0.3), glass: lit(0x203a52, 0.5),
    car: lit(0xffffff, 0.1), peg: lit(0x3a3f46, 0.4),
    light: new THREE.MeshBasicMaterial({ color: 0xfff7e0, toneMapped: false }),
  };
}

class Parts {
  constructor() { this.by = {}; }
  push(key, g) { (this.by[key] ||= []).push(g); }
  box(key, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
    g.translate(x, y, z); this.push(key, g);
  }
  cyl(key, r, h, x, y, z, axis = 'y', seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z); this.push(key, g);
  }
}

/** a Formula-style dummy car (nose towards +z) sitting on axle stands */
function dummyCar(P, cx, cz, lift) {
  const y0 = lift;
  P.box('car', 1.1, 0.42, 3.9, cx, y0 + 0.5, cz);                               // tub
  P.box('car', 0.6, 0.5, 1.5, cx - 0.82, y0 + 0.45, cz - 0.35);                 // sidepods
  P.box('car', 0.6, 0.5, 1.5, cx + 0.82, y0 + 0.45, cz - 0.35);
  P.box('car', 0.5, 0.3, 1.1, cx, y0 + 0.42, cz + 2.3, 0, -0.12);               // nose cone
  P.box('dark', 0.55, 0.32, 0.9, cx, y0 + 0.82, cz - 0.15);                     // cockpit
  P.box('black', 0.34, 0.36, 0.34, cx, y0 + 0.98, cz - 0.35);                   // helmet-less headrest block
  P.box('dark', 1.9, 0.05, 0.42, cx, y0 + 0.2, cz + 2.7);                       // front wing
  for (const s of [-1, 1]) P.box('car', 0.05, 0.22, 0.45, cx + s * 0.95, y0 + 0.3, cz + 2.7);
  P.box('dark', 1.5, 0.06, 0.42, cx, y0 + 1.15, cz - 1.95);                     // rear wing
  for (const s of [-1, 1]) P.box('car', 0.05, 0.45, 0.5, cx + s * 0.77, y0 + 1.0, cz - 1.95);
  P.box('dark', 0.1, 0.5, 0.2, cx, y0 + 0.9, cz - 1.9);
  for (const [wx, wz] of [[-0.95, cz + 1.4], [0.95, cz + 1.4], [-0.95, cz - 1.2], [0.95, cz - 1.2]]) {
    P.cyl('tyre', 0.33, 0.3, cx + wx, y0 + 0.33, wz, 'x', 14);
    P.cyl('steel', 0.17, 0.32, cx + wx, y0 + 0.33, wz, 'x', 8);
  }
  for (const [sx, sz] of [[-0.55, cz + 0.2], [0.55, cz + 0.2], [-0.55, cz - 1.9], [0.55, cz - 1.9]]) {   // axle stands under the tub
    P.box('red', 0.22, y0 + 0.28, 0.22, cx + sx, (y0 + 0.28) / 2, sz);
    P.box('dark', 0.34, 0.04, 0.34, cx + sx, 0.02, sz);
  }
}

function buildPit(P, W, D, H) {
  const hw = W / 2;
  P.box('floor', W, 0.05, D, 0, 0.025, -D / 2);
  for (const sx of [-1, 1]) P.box('yellow', 0.1, 0.01, D - 0.6, sx * (hw - 0.5), 0.055, -D / 2);          // painted bay lines
  P.box('yellow', W - 1.0, 0.01, 0.1, 0, 0.055, -0.45);
  P.box('wall', W, H - 0.1, 0.05, 0, (H - 0.1) / 2 + 0.05, -D + 0.03);                                      // back wall
  P.box('dark', W, 0.9, 0.06, 0, 0.5, -D + 0.05);                                                            // dark dado
  // pegboard of tools above the bench
  P.box('peg', 3.4, 1.4, 0.05, -2.0, 1.8, -D + 0.08);
  const cols = ['red', 'yellow', 'steel', 'blue', 'steel', 'red'];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) {
    const x = -3.5 + k * 0.36, y = 1.4 + r * 0.38, c = cols[(k + r) % cols.length];
    P.box(c, 0.07, 0.3, 0.04, x, y, -D + 0.12, 0, 0, ((k + r) % 3 - 1) * 0.08);                              // spanners, hammers, drivers
    P.box('black', 0.1, 0.06, 0.05, x, y + 0.15, -D + 0.12);
  }
  // workbench with vice and bits on top
  P.box('steel', 2.6, 0.06, 0.75, 2.3, 0.95, -D + 0.5);
  for (const lx of [1.1, 3.5]) for (const lz of [-D + 0.2, -D + 0.8]) P.box('dark', 0.07, 0.92, 0.07, lx, 0.46, lz);
  P.box('dark', 2.5, 0.05, 0.6, 2.3, 0.35, -D + 0.5);
  P.box('dark', 0.25, 0.22, 0.2, 1.4, 1.1, -D + 0.45);
  P.box('red', 0.55, 0.22, 0.3, 2.5, 1.1, -D + 0.5);
  P.box('yellow', 0.3, 0.2, 0.25, 3.1, 1.09, -D + 0.45);
  P.box('glass', 0.34, 0.02, 0.24, 2.0, 1.0, -D + 0.45);                                                      // laptop
  P.box('black', 0.34, 0.22, 0.02, 2.0, 1.12, -D + 0.33, 0, -0.25);
  // roll cab tool chest
  P.box('red', 1.1, 1.0, 0.6, -3.3, 0.55, -D + 0.45);
  for (let k = 0; k < 4; k++) P.box('black', 1.0, 0.02, 0.02, -3.3, 0.25 + k * 0.2, -D + 0.76);
  P.box('steel', 1.14, 0.05, 0.64, -3.3, 1.07, -D + 0.45);
  // tyre stacks and an oil drum
  for (const [tx, tz] of [[3.55, -D + 1.5], [3.0, -D + 1.9]]) for (let k = 0; k < 4; k++) P.cyl('tyre', 0.33, 0.28, tx, 0.19 + k * 0.28, tz, 'y', 14);
  P.cyl('blue', 0.26, 0.85, -hw + 0.45, 0.45, -D + 1.3, 'y', 10);
  P.cyl('red', 0.07, 0.45, -hw + 0.3, 0.3, -D + 2.2, 'y', 8);                                                 // extinguisher
  // ceiling strip lights and housings
  for (const lz of [-1.6, -4.1]) { P.box('dark', 4.8, 0.08, 0.34, 0, H - 0.14, lz); P.box('light', 4.6, 0.04, 0.24, 0, H - 0.2, lz); }
  // the dummy car on stands, a trolley jack beside it
  dummyCar(P, 0.3, -2.45, 0.2);
  P.box('red', 0.5, 0.18, 0.9, -1.7, 0.12, -1.4);
  P.box('dark', 0.05, 0.05, 1.3, -1.7, 0.48, -0.55, 0, 0.5);
  P.cyl('steel', 0.04, 0.4, -1.7, 0.3, -1.8, 'y', 6);
}

function buildKart(P, W, D, H) {
  const hw = W / 2;
  P.box('floor', W, 0.05, D, 0, 0.025, -D / 2);
  P.box('wall', W, H - 0.1, 0.05, 0, (H - 0.1) / 2 + 0.05, -D + 0.03);
  P.box('dark', W, 0.7, 0.06, 0, 0.4, -D + 0.05);
  P.box('peg', 2.6, 1.0, 0.05, -1.5, 1.7, -D + 0.08);
  const cols = ['red', 'yellow', 'steel', 'blue'];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 7; k++) {
    P.box(cols[(k + r) % 4], 0.06, 0.28, 0.04, -2.6 + k * 0.33, 1.5 + r * 0.38, -D + 0.12, 0, 0, ((k + r) % 3 - 1) * 0.08);
  }
  P.box('steel', 2.0, 0.06, 0.7, 1.9, 0.9, -D + 0.45);
  for (const lx of [0.95, 2.85]) for (const lz of [-D + 0.2, -D + 0.7]) P.box('dark', 0.06, 0.88, 0.06, lx, 0.44, lz);
  P.box('red', 0.5, 0.2, 0.28, 2.2, 1.03, -D + 0.45);
  P.box('yellow', 0.28, 0.18, 0.2, 1.5, 1.02, -D + 0.45);
  P.box('red', 0.9, 0.9, 0.55, -2.4, 0.5, -D + 0.4);
  for (let k = 0; k < 3; k++) P.box('black', 0.8, 0.02, 0.02, -2.4, 0.3 + k * 0.22, -D + 0.69);
  for (let k = 0; k < 4; k++) P.cyl('tyre', 0.14, 0.2, 2.8, 0.15 + k * 0.2, -D + 1.7, 'y', 12);
  P.cyl('red', 0.06, 0.4, -hw + 0.3, 0.25, -D + 1.2, 'y', 8);
  P.box('dark', 3.4, 0.07, 0.3, 0, H - 0.12, -2.0); P.box('light', 3.2, 0.04, 0.2, 0, H - 0.17, -2.0);
  P.box('dark', 3.4, 0.07, 0.3, 0, H - 0.12, -4.2); P.box('light', 3.2, 0.04, 0.2, 0, H - 0.17, -4.2);
  // a kart on a stand: chassis, seat, wheel, bumpers, engine, four small tyres
  const kx = 0.1, kz = -2.9, y0 = 0.32;
  P.box('car', 0.9, 0.08, 1.45, kx, y0 + 0.1, kz);
  P.box('car', 1.15, 0.12, 0.2, kx, y0 + 0.12, kz + 0.85);                      // front bumper
  P.box('car', 1.0, 0.1, 0.16, kx, y0 + 0.14, kz - 0.8);
  P.box('black', 0.42, 0.34, 0.36, kx, y0 + 0.3, kz - 0.15);                     // seat
  P.box('dark', 0.3, 0.24, 0.3, kx + 0.12, y0 + 0.28, kz - 0.65);                // engine
  P.box('car', 0.08, 0.5, 0.06, kx, y0 + 0.33, kz + 0.45, 0, -0.4);              // steering column
  P.box('black', 0.34, 0.04, 0.04, kx, y0 + 0.58, kz + 0.33);
  for (const [wx, wz, r] of [[-0.55, kz + 0.6, 0.13], [0.55, kz + 0.6, 0.13], [-0.58, kz - 0.65, 0.15], [0.58, kz - 0.65, 0.15]]) {
    P.cyl('tyre', r, r > 0.14 ? 0.22 : 0.15, kx + wx, y0 + r - 0.05, wz, 'x', 12);
    P.cyl('steel', r * 0.5, r > 0.14 ? 0.23 : 0.16, kx + wx, y0 + r - 0.05, wz, 'x', 8);
  }
  P.box('dark', 0.9, 0.27, 0.5, kx, 0.14, kz);                                    // the stand
  P.box('dark', 1.6, 0.04, 0.8, kx, 0.02, kz);
}

/**
 * workshops.add(kind, x, y, z, yaw, tintHex) for each bay (kind 'pit' or 'kart'), then workshops.build(parent).
 * yaw is the rotation about Y that turns bay +z onto the direction the bay faces.
 */
export class Workshops {
  constructor() { this.items = { pit: [], kart: [] }; this.mats = makeMaterials(); }
  add(kind, x, y, z, yaw, tint = 0xffffff) { this.items[kind].push({ x, y, z, yaw, tint }); }
  build(parent) {
    const dims = { pit: { fn: buildPit, W: 8.6, D: 6, H: 3.75 }, kart: { fn: buildKart, W: 6.6, D: 6, H: 3.0 } };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of Object.keys(this.items)) {
      const list = this.items[kind]; if (!list.length) continue;
      const P = new Parts(), d = dims[kind]; d.fn(P, d.W, d.D, d.H);
      for (const [key, geos] of Object.entries(P.by)) {
        const geo = mergeGeometries(geos, false); for (const g of geos) g.dispose();
        const mesh = new THREE.InstancedMesh(geo, this.mats[key], list.length);
        list.forEach((it, i) => {
          q.setFromAxisAngle(up, it.yaw); p.set(it.x, it.y, it.z); m4.compose(p, q, s); mesh.setMatrixAt(i, m4);
          if (key === 'car') mesh.setColorAt(i, new THREE.Color(it.tint));
        });
        mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
        parent.add(mesh);
      }
    }
  }
}
