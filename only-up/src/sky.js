// Altitude-aware sky dome, cloud seas, distant peaks and ambient particles.
import * as THREE from 'three';
import { THEMES, blendInfo } from './themes.js';

const glslNoise = /* glsl */`
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(17.,9.); a*=.5; } return s; }
float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
`;

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }
`;
const skyFrag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uTop, uHor, uSunDir, uSunCol, uCloud;
uniform float uSunSize, uSunInt, uStars, uCloudAmt, uAurora, uNebula, uPlanet, uTime;
${glslNoise}
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  float g = pow(smoothstep(-0.08, 0.75, h), 0.65);
  vec3 col = mix(uHor, uTop, g);
  col = mix(col, uHor*0.8, smoothstep(0.0, -0.35, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // nebula
  if (uNebula > 0.0) {
    float nb = fbm(d.xy*2.6 + d.z*1.7 + 3.0) * fbm(d.yz*3.1 + 1.3);
    vec3 nc = mix(vec3(0.45,0.10,0.75), vec3(0.08,0.55,0.65), fbm(d.zx*2.0 + 7.0));
    col += nc * pow(nb*1.9, 2.2) * uNebula * 1.5;
  }
  // stars
  if (uStars > 0.0) {
    vec3 sp = d*260.0; vec3 cell = floor(sp); float r = h3(cell);
    float star = step(0.982, r) * smoothstep(0.42, 0.0, length(fract(sp)-0.5));
    float tw = 0.6 + 0.4*sin(uTime*2.5 + r*200.0);
    col += vec3(0.85,0.92,1.0) * star * tw * uStars * 3.0 * smoothstep(-0.05, 0.25, h);
  }
  // aurora
  if (uAurora > 0.0 && h > 0.04) {
    float u = atan(d.z, d.x), t = uTime*0.04;
    float cur = 0.5 + 0.5*sin(u*5.0 + 3.0*fbm(vec2(u*1.5, t)) + t*4.0);
    float band = smoothstep(0.06, 0.28, h) * smoothstep(0.85, 0.3, h);
    float rays = fbm(vec2(u*9.0, h*2.0 + t*2.0));
    vec3 ac = mix(vec3(0.1,1.0,0.5), vec3(0.55,0.2,1.0), smoothstep(0.2,0.8,h));
    col += ac * cur * band * rays * uAurora * 2.2;
  }
  // planet with rings
  if (uPlanet > 0.0) {
    vec3 pd = normalize(vec3(-0.55, 0.36, -0.75)); float pr = 0.21;
    vec3 t1 = normalize(cross(pd, vec3(0,1,0))), t2 = cross(pd, t1);
    vec2 q = vec2(dot(d,t1), dot(d,t2)) / sin(pr);
    float facing = dot(d, pd);
    if (facing > 0.0) {
      float r2 = dot(q,q);
      float cs = cos(0.45), sn = sin(0.45);
      vec2 qr = vec2(cs*q.x - sn*q.y, sn*q.x + cs*q.y);
      float rr = length(vec2(qr.x, qr.y/0.24));
      float ring = smoothstep(1.35,1.4,rr)*smoothstep(2.15,2.05,rr)*(0.55+0.45*sin(rr*38.0));
      bool behind = (r2 < 1.0 && qr.y > 0.0);
      if (r2 < 1.0) {
        float z = sqrt(1.0 - r2);
        vec3 n = normalize(q.x*t1 + q.y*t2 + z*pd);
        float lit = max(dot(n, normalize(vec3(0.7,0.4,0.5))), 0.0) * 0.95 + 0.06;
        float bands = 0.5 + 0.5*sin(q.y*16.0 + fbm(q*3.0)*5.0);
        vec3 pc = mix(vec3(0.25,0.08,0.45), vec3(0.95,0.55,0.8), bands);
        col = mix(col, pc*lit*1.4, uPlanet);
      }
      if (!behind) col = mix(col, vec3(0.9,0.7,0.95)*1.2, ring*0.7*uPlanet);
    }
  }
  // sun
  float disc = smoothstep(cos(uSunSize), cos(uSunSize*0.9), sd);
  col += uSunCol * uSunInt * 0.16 * pow(sd, 5.0);
  col += uSunCol * uSunInt * 0.5 * pow(sd, 70.0);
  col += uSunCol * uSunInt * 3.0 * disc;
  // clouds
  if (h > -0.02 && uCloudAmt > 0.0) {
    vec2 uv = d.xz / (h + 0.22) * 1.3 + vec2(uTime*0.004, uTime*0.0015);
    float c = fbm(uv*1.1) * 0.75 + fbm(uv*3.3) * 0.3;
    float m = smoothstep(0.5, 0.82, c) * uCloudAmt * smoothstep(-0.02, 0.18, h);
    float lit = pow(sd, 3.0);
    vec3 cc = uCloud * (0.55 + 0.35*smoothstep(0.4,0.8,c)) + uSunCol * lit * 0.55;
    cc += uSunCol * pow(sd, 14.0) * 0.8;
    col = mix(col, cc, m * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const cloudVert = /* glsl */`
varying vec3 vPos;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vPos = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }
`;
const cloudFrag = /* glsl */`
precision highp float;
varying vec3 vPos;
uniform vec3 uLight, uShade, uFog;
uniform float uTime, uOpacity, uCover, uScale;
${glslNoise}
void main(){
  vec2 p = vPos.xz * uScale;
  float c = fbm(p*0.8 + vec2(uTime*0.004, 0.0)) * 0.7 + fbm(p*2.6 - vec2(0.0, uTime*0.008)) * 0.38;
  float dens = smoothstep(0.42 - uCover, 0.78 - uCover*0.5, c);
  float dist = length(vPos.xz - cameraPosition.xz);
  float far = 1.0 - smoothstep(1600.0, 3600.0, dist);
  float near = smoothstep(3.0, 45.0, abs(cameraPosition.y - vPos.y));
  vec3 col = mix(uShade, uLight, smoothstep(0.3, 0.95, c + 0.15));
  col = mix(col, uFog, smoothstep(500.0, 3200.0, dist) * 0.7);
  gl_FragColor = vec4(col, dens * uOpacity * far * near);
}
`;

const partVert = /* glsl */`
attribute vec3 seed;
uniform vec3 uPlayer, uVel; uniform float uTime, uSize, uSway, uPx;
varying float vFade; varying vec2 vDirS;
void main(){
  vec3 b = vec3(70.0, 44.0, 70.0);
  vec3 p = seed*b + uVel*uTime;
  p.x += sin(uTime*0.6 + seed.y*30.0) * uSway; p.z += cos(uTime*0.5 + seed.x*30.0) * uSway;
  p = mod(p - uPlayer + b*0.5, b) - b*0.5;
  vec4 mv = viewMatrix * vec4(uPlayer + p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.5);
  gl_PointSize = clamp(uSize * 0.02 * uPx / dist * (0.5 + seed.z), 1.0, 60.0);
  vFade = (1.0 - smoothstep(18.0, 34.0, length(p))) * smoothstep(0.6, 2.0, dist);
}
`;
const partFrag = /* glsl */`
precision highp float;
varying float vFade; uniform vec3 uCol; uniform float uOp, uStreak;
void main(){
  vec2 pc = gl_PointCoord - 0.5;
  float a;
  if (uStreak > 0.5) a = smoothstep(0.5, 0.0, abs(pc.x)*9.0) * smoothstep(0.5, 0.3, abs(pc.y));
  else a = smoothstep(0.5, 0.05, length(pc));
  gl_FragColor = vec4(uCol, a * vFade * uOp);
}
`;

const lerp = (a, b, t) => a + (b - a) * t;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    // dome
    this.skyU = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uSunSize: { value: 0.05 }, uSunInt: { value: 3 },
      uStars: { value: 0 }, uCloudAmt: { value: 0.5 }, uAurora: { value: 0 }, uNebula: { value: 0 }, uPlanet: { value: 0 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.skyU, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);

    // cloud seas
    this.layers = [];
    const mk = (y, opacity, cover, scale) => {
      const u = { uLight: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uTime: { value: 0 }, uOpacity: { value: opacity }, uCover: { value: cover }, uScale: { value: scale } };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.ShaderMaterial({ uniforms: u, vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.frustumCulled = false; m.renderOrder = -5;
      scene.add(m); this.layers.push({ m, u });
    };
    mk(-38, 1.0, 0.28, 0.0045);
    mk(-22, 0.75, 0.05, 0.007);
    mk(150, 0.6, 0.0, 0.0055);
    mk(395, 0.6, 0.0, 0.005);
    mk(660, 0.55, 0.0, 0.0048);

    // distant peaks
    this.peaks = new THREE.Group();
    const pm = new THREE.MeshStandardMaterial({ color: 0x55607a, roughness: 1, flatShading: true });
    const peakGeo = new THREE.ConeGeometry(1, 1, 7, 1);
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < 46; k++) {
      const a = (k / 46) * Math.PI * 2 + rnd() * 0.12, d = 1100 + rnd() * 900, hgt = 160 + rnd() * 380, w = 120 + rnd() * 220;
      const m = new THREE.Mesh(peakGeo, pm);
      m.scale.set(w, hgt, w); m.position.set(Math.cos(a) * d, -60 + hgt / 2, Math.sin(a) * d); m.rotation.y = rnd() * 3;
      this.peaks.add(m);
    }
    scene.add(this.peaks);

    // particles
    const N = 2200, seed = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) seed[i] = Math.random();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    this.partU = { uPlayer: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSize: { value: 2 }, uSway: { value: 1 }, uPx: { value: 700 }, uCol: { value: new THREE.Color() }, uOp: { value: 1 }, uStreak: { value: 0 } };
    this.particles = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: this.partU, vertexShader: partVert, fragmentShader: partFrag, transparent: true, depthWrite: false }));
    this.particles.frustumCulled = false; scene.add(this.particles);

    this.atmo = {
      top: new THREE.Color(), hor: new THREE.Color(), sunCol: new THREE.Color(), cloud: new THREE.Color(), hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(),
      sunDir: new THREE.Vector3(), sunInt: 1, sunSize: 0.05, stars: 0, cloudAmt: 0, fog: 0.001, hemi: 1, aurora: 0, nebula: 0, planet: 0, bloom: 0.4,
      pcol: new THREE.Color(), pvel: new THREE.Vector3(), psize: 2, pop: 1, psway: 1, level: 0,
    };
    this._v = new THREE.Vector3();
  }

  update(y, cam, t, rendererH, fov) {
    const { a, b, t: k } = blendInfo(y), A = this.atmo;
    A.top.copy(a.top).lerp(b.top, k); A.hor.copy(a.hor).lerp(b.hor, k); A.sunCol.copy(a.sunCol).lerp(b.sunCol, k);
    A.cloud.copy(a.cloud).lerp(b.cloud, k); A.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, k); A.hemiGnd.copy(a.hemiGnd).lerp(b.hemiGnd, k);
    const el = lerp(a.sunEl, b.sunEl, k) * Math.PI / 180, az = lerp(a.sunAz, b.sunAz, k) * Math.PI / 180;
    A.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    for (const key of ['sunInt', 'sunSize', 'stars', 'cloudAmt', 'fog', 'hemi', 'aurora', 'nebula', 'planet', 'bloom']) A[key] = lerp(a[key], b[key], k);
    A.pcol.copy(a.part.col).lerp(b.part.col, k);
    A.pvel.set(lerp(a.part.vel[0], b.part.vel[0], k), lerp(a.part.vel[1], b.part.vel[1], k), lerp(a.part.vel[2], b.part.vel[2], k));
    A.psize = lerp(a.part.size, b.part.size, k); A.pop = lerp(a.part.op, b.part.op, k); A.psway = lerp(a.part.sway, b.part.sway, k);
    A.level = k > 0.5 ? THEMES.indexOf(b) : THEMES.indexOf(a);

    const u = this.skyU;
    u.uTop.value.copy(A.top); u.uHor.value.copy(A.hor); u.uSunDir.value.copy(A.sunDir); u.uSunCol.value.copy(A.sunCol); u.uCloud.value.copy(A.cloud);
    u.uSunSize.value = A.sunSize; u.uSunInt.value = A.sunInt; u.uStars.value = A.stars; u.uCloudAmt.value = A.cloudAmt;
    u.uAurora.value = A.aurora; u.uNebula.value = A.nebula; u.uPlanet.value = A.planet; u.uTime.value = t;
    this.dome.position.copy(cam);

    for (const l of this.layers) {
      l.m.position.x = cam.x; l.m.position.z = cam.z;
      l.u.uTime.value = t;
      l.u.uLight.value.copy(A.cloud).lerp(A.sunCol, 0.35).multiplyScalar(1.15);
      l.u.uShade.value.copy(A.hor).lerp(A.top, 0.4).multiplyScalar(0.55);
      l.u.uFog.value.copy(A.hor);
    }
    this.peaks.position.set(cam.x, 0, cam.z);
    this.peaks.children[0].material.color.copy(A.hor).lerp(A.top, 0.35).multiplyScalar(0.6);

    const p = this.partU;
    p.uPlayer.value.copy(cam); p.uVel.value.copy(A.pvel); p.uTime.value = t; p.uSize.value = A.psize; p.uSway.value = A.psway;
    p.uCol.value.copy(A.pcol); p.uOp.value = A.pop; p.uStreak.value = Math.abs(A.pvel.y) > 5 ? 1 : 0;
    p.uPx.value = rendererH / (2 * Math.tan((fov * Math.PI / 180) / 2));
    return A;
  }
}
