import * as THREE from 'three';

/**
 * Cheap, good-looking terrain and sky, done in the shaders from one small tiling noise texture made at load:
 *   R fine ground grain, G large-scale patches, B cloud billows, A rock (ridged, cracked).
 * - Terrain: slopes turn to rock sampled from three directions (no stretching down cliffs), with strata and darker
 *   crevices; flatter ground gets grain and broad colour patches that hide the 2.5 m vertex colours; soft cloud shadows
 *   drift over everything. One material for every chunk, four texture reads a pixel, no extra geometry.
 * - Sky: soft, sun-lit clouds drifting overhead, drawn into the existing sky dome (no sprites or cloud meshes).
 */

// ---------------------------------------------------------------- tiling noise
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return (h >>> 0) / 4294967295; }
/** value noise that wraps every `p` lattice cells */
function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s), c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbmT(x, y, p, oct, s, ridged = false) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    let n = vnoise(x, y, p, s + o * 17);
    if (ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp; norm += amp; x *= 2; y *= 2; p *= 2; amp *= 0.5;
  }
  return sum / norm;
}

let _tex = null;
export function natureTexture() {
  if (_tex) return _tex;
  const S = 256, data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S, k = (j * S + i) * 4;
    const fine = fbmT(u * 32, v * 32, 32, 3, 1);
    const macro = fbmT(u * 6, v * 6, 6, 4, 2);
    const cloud = fbmT(u * 5, v * 5, 5, 6, 3);
    let rock = fbmT(u * 10, v * 10, 10, 5, 4, true);                 // ridged: sharp crests
    const crack = fbmT(u * 24, v * 24, 24, 2, 5);
    rock = rock * 0.75 + fine * 0.25 - Math.max(0, 0.07 - Math.abs(crack - 0.5)) * 6;   // thin dark cracks
    data[k] = fine * 255; data[k + 1] = macro * 255; data[k + 2] = cloud * 255; data[k + 3] = Math.max(0, Math.min(1, rock)) * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return (_tex = t);
}

/** shared by the sky and the terrain: time and wind for the drifting clouds and their shadows */
export const natureUniforms = {
  uNoise: { value: null }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2(3.0, 1.2) },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4) }, uCover: { value: 0.55 },
  uCloudLit: { value: new THREE.Color(1, 1, 1) }, uCloudDark: { value: new THREE.Color(0.7, 0.74, 0.8) }, uShadow: { value: 0.18 },
};

// ---------------------------------------------------------------- sky
export function skyMaterial(top, bottom, cover) {
  natureUniforms.uNoise.value = natureTexture();
  natureUniforms.uCover.value = cover;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, ...natureUniforms },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform sampler2D uNoise; uniform float uTime, uCover; uniform vec2 uWind;
      uniform vec3 uSunDir, uCloudLit, uCloudDark; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float t = clamp(d.y*1.6+0.08,0.0,1.0);
        vec3 col = mix(bottom, top, pow(t,0.7));
        if (d.y > 0.0) {
          // a cloud deck overhead: project the view ray onto a plane, so clouds shrink and crowd towards the horizon
          vec2 uv = d.xz / (d.y + 0.06) * 0.42 + uWind * uTime * 0.0009;
          float n = texture2D(uNoise, uv).b * 0.62 + texture2D(uNoise, uv * 2.3 + vec2(0.31, 0.17)).b * 0.26 + texture2D(uNoise, uv * 6.1 - vec2(0.2, 0.4)).r * 0.12;
          float edge = 1.0 - uCover;
          float c = smoothstep(edge, edge + 0.22, n) * smoothstep(0.0, 0.14, d.y);
          float dense = smoothstep(edge + 0.08, edge + 0.42, n);              // thick middles are greyer underneath
          float toward = pow(max(dot(d, normalize(uSunDir)), 0.0), 5.0);   // silver lining towards the sun
          vec3 cc = mix(uCloudLit, uCloudDark, dense * 0.75) + uCloudLit * toward * 0.35 * (1.0 - dense);
          col = mix(col, cc, c * 0.95);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- terrain
/** turn the terrain's vertex-coloured Lambert material into textured rock and ground (keeps lighting, shadows and fog) */
export function enhanceTerrain(mat, { rockSlope = [0.13, 0.36] } = {}) {
  natureUniforms.uNoise.value = natureTexture();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, natureUniforms, { uRockSlope: { value: new THREE.Vector2(...rockSlope) } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; uniform sampler2D uNoise; uniform float uTime, uShadow; uniform vec2 uWind, uRockSlope;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vWNrm);
          float slope = 1.0 - n.y;
          float macro = texture2D(uNoise, vWPos.xz * 0.004).g;
          float rockM = smoothstep(uRockSlope.x, uRockSlope.y, slope + (macro - 0.5) * 0.24);
          // rock: sampled along the two horizontal axes (cliff faces) and from above, blended by the facing
          vec3 bw = pow(abs(n), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          float r = texture2D(uNoise, vWPos.zy * 0.06).a * bw.x + texture2D(uNoise, vWPos.xz * 0.06).a * bw.y + texture2D(uNoise, vWPos.xy * 0.06).a * bw.z;
          float strata = 0.5 + 0.5 * sin(vWPos.y * 0.85 + macro * 7.0 + r * 1.5);
          vec3 base = diffuseColor.rgb;
          vec3 rockCol = mix(vec3(dot(base, vec3(0.3, 0.45, 0.25))), base, 0.72) * (0.42 + 0.8 * r) * (0.88 + 0.22 * strata);
          // ground: fine grain and broad patches
          float fine = texture2D(uNoise, vWPos.xz * 0.11).r;
          vec3 ground = base * (0.78 + 0.28 * fine) * (0.8 + 0.3 * macro);
          // mid-scale: darker scrub patches (tens of metres) and dry, earthy ground on the steeper grass
          float scrub = smoothstep(0.5, 0.72, texture2D(uNoise, vWPos.xz * 0.022 + vec2(0.37, 0.11)).b);
          ground *= 1.0 - 0.24 * scrub;
          float dry = smoothstep(0.05, 0.2, slope) * (0.35 + 0.65 * texture2D(uNoise, vWPos.xz * 0.045).g);
          ground = mix(ground, ground * vec3(1.12, 0.98, 0.78), 0.45 * dry);
          diffuseColor.rgb = mix(ground, rockCol, rockM);
          // drifting cloud shadows
          float cs = texture2D(uNoise, (vWPos.xz + uWind * uTime * 6.0) * 0.0011).b;
          diffuseColor.rgb *= 1.0 - uShadow * smoothstep(0.42, 0.7, cs);
        }`);
  };
  mat.customProgramCacheKey = () => 'terrain-nature';
  mat.needsUpdate = true;
  return mat;
}
