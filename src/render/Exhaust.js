import * as THREE from 'three';

/**
 * Subtle two-stroke exhaust haze from the karts' silencers: one small shared pool of soft points.
 * Level of detail: full rate close to the camera, thinning out with distance, nothing beyond FAR
 * or behind the camera, and a hard cap on puffs per frame, so a full grid costs next to nothing.
 */
const N = 480, NEAR = 18, FAR = 70, MAX_PER_FRAME = 6;
const _p = new THREE.Vector3(), _back = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class Exhaust {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4); this.life = new Float32Array(N); this.max = new Float32Array(N); this.size = new Float32Array(N);
    this.i = 0; this.live = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(size * 300.0 / -mv.z, 60.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord-0.5; float r = dot(d,d); if(r>0.25) discard; gl_FragColor = vec4(vC.rgb, vC.a*(1.0-r*4.0)); }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** views: CarViews with an `exhaust` outlet (karts); vehicles alongside for throttle and rpm */
  update(dt, camera, cars) {
    if (dt <= 0) return;
    const cam = camera.position;
    camera.getWorldDirection(_fwd);
    let budget = MAX_PER_FRAME;
    for (const { view, vehicle } of cars) {
      if (!view.exhaust || !view.group.visible) continue;
      view.group.updateMatrixWorld();
      _p.copy(view.exhaust).applyMatrix4(view.group.matrixWorld);
      const dx = _p.x - cam.x, dy = _p.y - cam.y, dz = _p.z - cam.z, d = Math.hypot(dx, dy, dz);
      if (d > FAR || (d > 6 && dx * _fwd.x + dy * _fwd.y + dz * _fwd.z < 0)) { view._exAcc = 0; continue; }   // too far, or behind the camera
      const lod = d < NEAR ? 1 : 1 - (d - NEAR) / (FAR - NEAR) * 0.8;
      const rpm = Math.min(1, vehicle.drivetrain.engine.rpm / (vehicle.drivetrain.engine.cfg?.redlineRPM || 14000));
      const th = vehicle.input?.throttle || 0;
      const rate = (5 + th * 14 + rpm * 6) * lod;                     // puffs a second
      view._exAcc = (view._exAcc || 0) + rate * dt;
      if (view._exAcc < 1) continue;
      _back.set(0, 0, -1).applyQuaternion(view.group.quaternion);
      const v = vehicle.body.velocity;
      while (view._exAcc >= 1 && budget > 0) {
        view._exAcc -= 1; budget--;
        const out = 0.8 + th * 1.4, k = this.i * 3;
        this.i = (this.i + 1) % N;
        this.pos[k] = _p.x; this.pos[k + 1] = _p.y; this.pos[k + 2] = _p.z;
        this.vel[k] = v.x * 0.55 + _back.x * out + (Math.random() - 0.5) * 0.4;
        this.vel[k + 1] = v.y * 0.3 + 0.25 + Math.random() * 0.3;
        this.vel[k + 2] = v.z * 0.55 + _back.z * out + (Math.random() - 0.5) * 0.4;
        const j = k / 3, life = 0.7 + Math.random() * 0.5 + th * 0.3;
        this.life[j] = this.max[j] = life; this.size[j] = 0.14 + Math.random() * 0.06;
        const g = 0.84 + Math.random() * 0.08;
        this.col[j * 4] = g; this.col[j * 4 + 1] = g + 0.01; this.col[j * 4 + 2] = g + 0.03;
        this.live = N;
      }
      if (view._exAcc > 3) view._exAcc = 3;
    }
    if (!this.live) return;                                           // nothing alive: skip the loop and the upload
    let alive = 0;
    const P = this.pos, V = this.vel, C = this.col, L = this.life, Z = this.size, damp = Math.exp(-2.2 * dt);
    for (let j = 0; j < N; j++) {
      if (L[j] <= 0) { C[j * 4 + 3] = 0; continue; }
      alive++;
      L[j] -= dt;
      const k = j * 3;
      V[k] *= damp; V[k + 1] = V[k + 1] * damp + 0.35 * dt; V[k + 2] *= damp;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      Z[j] += dt * 0.9;
      const t = Math.max(0, L[j] / this.max[j]);
      C[j * 4 + 3] = t * (1 - t) * 4 * 0.24;                          // fades in, then out: a soft haze, not a cloud
    }
    this.live = alive ? N : 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
  }
}
