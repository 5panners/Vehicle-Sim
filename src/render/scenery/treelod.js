import * as THREE from 'three';

/**
 * Tree level of detail without the pop.
 *
 * The old scheme swapped a whole 240 m tile between the full tree model and a cheap stand-in at one distance, so
 * hundreds of trees changed at once. Here every tree fades between the two models by its own distance from the
 * camera, using a screen-door (dithered) cross-fade: no blending cost, no sorting, and where the two meshes
 * overlap they look like one. Tiles only draw the detailed trees while they could be near, and the stand-ins only
 * while they could be far, so a tile is almost always drawn once (just the tiles on the fade band draw both).
 *
 *   near trees: opaque inside d0, dither out between d0 and d1, collapsed (no fragments) beyond d1
 *   far trees:  collapsed inside d0, dither in between d0 and d1, opaque beyond
 */
const BAYER = `
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  const float M[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (M[q.x + q.y * 4] + 0.5) / 16.0;
}`;

export function fadeMaterial(isNear, d0, d1) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 treeOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #else
          vec4 treeOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #endif
        float treeDist = distance(treeOrigin.xyz, cameraPosition);
        float fadeIn = smoothstep(${d0.toFixed(1)}, ${d1.toFixed(1)}, treeDist);
        vFade = ${isNear ? '1.0 - fadeIn' : 'fadeIn'};
        if (vFade <= 0.003) transformed = vec3(0.0);   // collapse trees that are not wanted: no triangles reach the rasteriser`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vFade;\n${BAYER}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (vFade < bayer4(gl_FragCoord.xy)) discard;');
  };
  m.customProgramCacheKey = () => `treefade-${isNear ? 'n' : 'f'}-${d0}-${d1}`;
  return m;
}

/** one set of tiles: add(centre, size, nearGroup, farGroup), then update(camera) every frame */
export class TreeTiles {
  constructor(scene, d0, d1) {
    this.scene = scene; this.d0 = d0; this.d1 = d1; this.tiles = [];
    this.near = fadeMaterial(true, d0, d1); this.far = fadeMaterial(false, d0, d1);
  }

  add(cx, cz, size, nearGroup, farGroup) {
    const root = new THREE.Group(); root.position.set(cx, 0, cz); root.add(nearGroup, farGroup);
    this.scene.add(root);
    this.tiles.push({ cx, cz, r: size * 0.7072, nearGroup, farGroup });
  }

  update(camera) {
    const { x, z } = camera.position;
    for (const t of this.tiles) {
      const d = Math.hypot(x - t.cx, z - t.cz);
      t.nearGroup.visible = d - t.r < this.d1;      // some tree of this tile could still be inside the fade
      t.farGroup.visible = d + t.r > this.d0;       // some tree of this tile could already be beyond it
    }
  }
}
