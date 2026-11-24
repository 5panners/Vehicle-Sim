import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static batching: many small meshes that look the same become one mesh, so they cost one draw call (and one in the
 * shadow pass) instead of one each. Each group's direct mesh children are merged by look (material properties, shadow
 * flags) and, when `cell` is set, by which cell of a world grid they sit in, so far-away parts are still culled.
 * Moving parts stay safe: merging never crosses a group, so a group that is moved or hidden keeps its pivot.
 * Skipped: transparent or additive materials, material arrays, instanced/skinned meshes, meshes with children,
 * anything under an object with userData.noBatch, and materials in `keep` (animated ones are matched by identity).
 */
export function batchStatic(root, { keep = new Set(), cell = 0, minCount = 2 } = {}) {
  const groups = [];
  const walk = (o) => {
    if (o !== root && o.userData?.noBatch) return;                     // noBatch keeps an object out of a batch run over its parents
    if (!o.isMesh) { groups.push(o); for (const c of o.children) walk(c); }
  };
  walk(root);
  let before = 0, after = 0;
  const _p = new THREE.Vector3();
  for (const g of groups) {
    const buckets = new Map();
    for (const m of g.children) {
      if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.userData?.noBatch || Array.isArray(m.material) || m.children.length) continue;
      const mat = m.material;
      if (!m.geometry?.attributes?.position || m.morphTargetInfluences || mat.transparent || mat.blending !== THREE.NormalBlending || !m.visible) continue;
      let key = lookKey(mat, keep) + '|' + m.castShadow + '|' + m.receiveShadow + '|' + m.renderOrder;
      if (cell) {                                                            // by where the mesh really is (strips built at the origin too)
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        m.updateWorldMatrix(true, false); _p.copy(m.geometry.boundingSphere.center).applyMatrix4(m.matrixWorld);
        key += '|' + Math.floor(_p.x / cell) + ',' + Math.floor(_p.z / cell);
      }
      let b = buckets.get(key); if (!b) buckets.set(key, (b = []));
      b.push(m);
    }
    for (const list of buckets.values()) {
      if (list.length < minCount) continue;
      const attrs = list.some((m) => m.geometry.attributes.color) ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
      const geos = list.map((m) => {
        m.updateMatrix();
        const ge = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(ge.attributes)) if (!attrs.includes(k)) ge.deleteAttribute(k);
        const n = ge.attributes.position.count;
        if (!ge.attributes.uv) ge.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        if (!ge.attributes.normal) ge.computeVertexNormals();
        if (attrs.includes('color') && !ge.attributes.color) ge.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        for (const k of attrs) { const a = ge.attributes[k]; if (a.isInterleavedBufferAttribute || a.itemSize !== { position: 3, normal: 3, uv: 2, color: 3 }[k]) return null; }
        ge.clearGroups(); ge.morphAttributes = {};
        return ge.applyMatrix4(m.matrix);
      });
      if (geos.some((x) => !x)) continue;
      const merged = mergeGeometries(geos, false);
      for (const ge of geos) ge.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const first = list[0], mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
      for (const m of list) g.remove(m);                                   // geometries may be shared with other meshes: leave them
      g.add(mesh);
      before += list.length; after += 1;
    }
  }
  return { before, after };
}

/** materials that look the same share one key (those in `keep` are animated and only match themselves) */
function lookKey(m, keep) {
  // animated ones only match themselves; so do lamps and other glowing or unlit materials, which scenery may relight
  if (keep.has(m) || m.isMeshBasicMaterial || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0)) return m.uuid;
  const c = (x) => (x ? x.getHexString() : '-');
  return [m.type, c(m.color), c(m.emissive), m.emissiveIntensity, m.metalness, m.roughness, m.map?.uuid, m.normalMap?.uuid, m.alphaTest,
    m.side, m.name, m.flatShading, m.vertexColors, m.polygonOffset, m.polygonOffsetFactor, m.depthWrite, m.fog, m.toneMapped, m.wireframe,
    m.onBeforeCompile ? m.uuid : ''].join('|');
}

/**
 * Split big instanced sets (trees, bushes, posts spread over the whole map) into map tiles. One set over the whole map can
 * never be culled, so every instance was drawn every frame, and again into the shadow map that only covers the area
 * around the car. Tiles each get a tight bounding sphere, so the ones off screen (and outside the shadow area) are skipped.
 */
export function tileInstanced(root, { cell = 200, minSpread = 250 } = {}) {
  const list = [];
  const walk = (o) => { if (o.userData?.noBatch) return; if (o.isInstancedMesh) list.push(o); else for (const c of o.children) walk(c); };
  walk(root);
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
  let before = 0, after = 0;
  for (const im of list) {
    if (im.count < 16 || !im.parent) continue;
    im.updateWorldMatrix(true, false);
    const cells = new Map();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m4); p.setFromMatrixPosition(m4).applyMatrix4(im.matrixWorld);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      const key = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell);
      let a = cells.get(key); if (!a) cells.set(key, (a = [])); a.push(i);
    }
    if (Math.max(maxX - minX, maxZ - minZ) < minSpread || cells.size < 2) continue;
    for (const idx of cells.values()) {
      const t = new THREE.InstancedMesh(im.geometry, im.material, idx.length);
      idx.forEach((i, k) => { im.getMatrixAt(i, m4); t.setMatrixAt(k, m4); if (im.instanceColor) { im.getColorAt(i, c); t.setColorAt(k, c); } });
      t.position.copy(im.position); t.quaternion.copy(im.quaternion); t.scale.copy(im.scale);
      t.castShadow = im.castShadow; t.receiveShadow = im.receiveShadow; t.renderOrder = im.renderOrder; t.frustumCulled = true;
      t.computeBoundingSphere();
      im.parent.add(t);
    }
    im.parent.remove(im); im.dispose?.();
    before += 1; after += cells.size;
  }
  return { before, after };
}
