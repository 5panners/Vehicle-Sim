// Geometry batcher: collects primitives per material (with world-scaled UVs + baked AO-ish vertex colours), merges them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

export class Builder {
  constructor() { this.buckets = new Map(); }

  _push(geo, mat, x, y, z, rx, ry, rz, tint, sx = 1, sy = 1, sz = 1, ao = 1.4) {
    // vertex colours: darken near the bottom of each primitive
    geo.computeBoundingBox();
    const bb = geo.boundingBox, pos = geo.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3);
    const tr = Array.isArray(tint) ? tint : [tint ?? 1, tint ?? 1, tint ?? 1];
    const h = Math.max(0.001, Math.min(ao, bb.max.y - bb.min.y));
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, (pos.getY(i) - bb.min.y) / h));
      const sh = 0.55 + 0.45 * t;
      col[i * 3] = tr[0] * sh; col[i * 3 + 1] = tr[1] * sh; col[i * 3 + 2] = tr[2] * sh;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!geo.index) { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; geo.setIndex(new THREE.BufferAttribute(idx, 1)); }
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s); geo.applyMatrix4(_m);
    let b = this.buckets.get(mat);
    if (!b) { b = []; this.buckets.set(mat, b); }
    b.push(geo);
  }

  box(mat, w, h, d, x, y, z, ry = 0, tint = 1, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const tile = mat.userData.tile || 4, uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
    this._push(g, mat, x, y, z, rx, ry, rz, tint);
  }
  // cylinder / cone: rTop,rBot ; centre at (x,y,z)
  cyl(mat, rTop, rBot, h, x, y, z, seg = 12, tint = 1, rx = 0, ry = 0, rz = 0, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    const tile = mat.userData.tile || 4, uv = g.attributes.uv;
    const circ = Math.PI * (rTop + rBot), nTorso = (seg + 1) * 2;
    const slant = Math.hypot(h, rBot - rTop);
    for (let i = 0; i < uv.count; i++) {
      if (i < nTorso) uv.setXY(i, uv.getX(i) * circ / tile, uv.getY(i) * slant / tile);
      else { const r = Math.max(rTop, rBot); uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * 2 * r / tile, 0.5 + (uv.getY(i) - 0.5) * 2 * r / tile); }
    }
    this._push(g, mat, x, y, z, rx, ry, rz, tint, 1, 1, 1, Math.min(1.4, h));
  }
  sphere(mat, r, x, y, z, sx = 1, sy = 1, sz = 1, tint = 1, seg = 10, ry = 0) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
    const tile = mat.userData.tile || 4, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r / tile, uv.getY(i) * Math.PI * r / tile);
    this._push(g, mat, x, y, z, 0, ry, 0, tint, sx, sy, sz, r * 2 * sy);
  }
  torus(mat, R, r, x, y, z, rx = 0, ry = 0, rz = 0, tint = 1, seg = 16) {
    const g = new THREE.TorusGeometry(R, r, 6, seg);
    const tile = mat.userData.tile || 4, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * R * 6.28 / tile, uv.getY(i) * r * 6.28 / tile);
    this._push(g, mat, x, y, z, rx, ry, rz, tint, 1, 1, 1, 0.3);
  }
  // diamond-ish crystal (octahedron stretched)
  crystal(mat, r, h, x, y, z, rx = 0, ry = 0, rz = 0, tint = 1) {
    const g = new THREE.OctahedronGeometry(r, 0);
    const tile = mat.userData.tile || 4, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 2 / tile, uv.getY(i) * r * 2 / tile);
    this._push(g, mat, x, y, z, rx, ry, rz, tint, 1, h / r, 1, 0.5);
  }
  // beam between two points (thin box)
  strut(mat, ax, ay, az, bx, by, bz, t = 0.15, tint = 1) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return;
    const g = new THREE.BoxGeometry(t, L, t);
    const tile = mat.userData.tile || 4, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * t / tile, uv.getY(i) * L / tile);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    this._push(g, mat, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, e.x, e.y, e.z, tint, 1, 1, 1, 0.8);
  }

  // merge each material's geometry into a mesh
  flush(parent, { cast = true, receive = true } = {}) {
    const meshes = [];
    for (const [mat, geos] of this.buckets) {
      if (!geos.length) continue;
      // split big buckets to avoid 65k index limits issues and keep culling effective
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast && !mat.isMeshBasicMaterial; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh); meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
