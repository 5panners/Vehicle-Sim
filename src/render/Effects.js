import * as THREE from 'three';

/** Tyre smoke / dust particles and skid marks, driven from per-wheel physics state. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    // ---- particles
    const N = this.N = 3000;
    this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 4); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N);
    this.pSize = new Float32Array(N);
    this.pi = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(size * 300.0 / -mv.z, 90.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord-0.5; float r = dot(d,d); if(r>0.25) discard; gl_FragColor = vec4(vC.rgb, vC.a*(1.0-r*4.0)); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // ---- skid marks (ring buffer of quads)
    const S = this.S = 6000;
    this.sPos = new Float32Array(S * 4 * 3); this.sCol = new Float32Array(S * 4 * 4);
    const idx = new Uint32Array(S * 6);
    for (let i = 0; i < S; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 4));
    sg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.skidGeo = sg;
    this.skids = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    this.skids.frustumCulled = false;
    scene.add(this.skids);
    this.si = 0;
    this.last = [null, null, null, null];

    // ---- sparks (additive, gravity, short-lived) for wall/hull scraping
    const K = this.K = 600;
    this.kPos = new Float32Array(K * 3); this.kVel = new Float32Array(K * 3); this.kLife = new Float32Array(K); this.kCol = new Float32Array(K * 4);
    this.ki = 0;
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.BufferAttribute(this.kPos, 3));
    kg.setAttribute('color', new THREE.BufferAttribute(this.kCol, 4));
    this.sparks = new THREE.Points(kg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 color; varying vec4 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(60.0 / -mv.z, 8.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; gl_FragColor = vec4(vC.rgb*vC.a, vC.a); }`,
    }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
  }

  spark(c, n) {
    for (let k = 0; k < n; k++) {
      const i = this.ki; this.ki = (this.ki + 1) % this.K;
      const sp = 2 + Math.random() * 6;
      this.kPos.set([c.x, c.y, c.z], i * 3);
      // spray off the wall and along the direction of travel
      this.kVel.set([c.nx * sp * 0.6 + (Math.random() - 0.5) * 3 + c.vx * 0.6, 1 + Math.random() * 3, c.nz * sp * 0.6 + (Math.random() - 0.5) * 3 + c.vz * 0.6], i * 3);
      this.kLife[i] = 0.25 + Math.random() * 0.35;
    }
  }

  emit(x, y, z, vx, vy, vz, rgb, alpha, size, life) {
    const i = this.pi; this.pi = (this.pi + 1) % this.N;
    this.pPos.set([x, y, z], i * 3); this.pVel.set([vx, vy, vz], i * 3);
    this.pCol.set([rgb[0], rgb[1], rgb[2], alpha], i * 4);
    this.pLife[i] = life; this.pMax[i] = life; this.pSize[i] = size;
  }

  addSkid(wi, p, lat, width, rgb, alpha) {
    const last = this.last[wi];
    const hx = lat.x * width / 2, hz = lat.z * width / 2;
    const cur = { l: [p.x - hx, p.y + 0.02, p.z - hz], r: [p.x + hx, p.y + 0.02, p.z + hz] };
    if (last && Math.hypot(p.x - last.p.x, p.z - last.p.z) < 4) {
      const i = this.si; this.si = (this.si + 1) % this.S;
      this.sPos.set([...last.l, ...last.r, ...cur.l, ...cur.r], i * 12);
      for (let k = 0; k < 4; k++) this.sCol.set([rgb[0], rgb[1], rgb[2], alpha], i * 16 + k * 4);
      this._skidDirty = true;
    }
    this.last[wi] = { p: { x: p.x, z: p.z }, ...cur };
  }

  update(dt, vehicle) {
    const sp = vehicle.speed;
    vehicle.wheels.forEach((w, i) => {
      const t = w.tire;
      if (!w.contact || !w.surface) { this.last[i] = null; return; }
      const s = w.surface;
      const slipLong = Math.abs(w.omega * w.radius - w.vx), slipLat = Math.abs(w.vy);
      const slipV = Math.hypot(slipLong, slipLat);
      const sliding = t.normSlip > 1.3 && slipV > 3.5;
      const p = w.contactPoint;
      // skid marks
      if (sliding && s.smoke) this.addSkid(i, p, w.lat, w.wcfg.width, [0.05, 0.05, 0.05], Math.min(0.7, (t.normSlip - 1) * 0.6));
      else if (s.dust && sp > 2) this.addSkid(i, p, w.lat, w.wcfg.width, s.color.map((c) => c * 0.6), 0.25 + Math.min(0.3, slipV * 0.05));
      else this.last[i] = null;
      // particles
      if (s.smoke && sliding) {
        const n = Math.min(2, slipV * 0.08) * (Math.random() < 0.6 ? 1 : 0);
        for (let k = 0; k < n; k++) this.emit(p.x, p.y + 0.25, p.z, (Math.random() - 0.5) * 1.2 + vehicle.body.velocity.x * 0.3, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2 + vehicle.body.velocity.z * 0.3, [0.88, 0.88, 0.9], 0.25, 0.5 + Math.random() * 0.5, 1.8);
      } else if (s.dust && (sp > 4 || slipV > 3)) {
        const n = Math.min(3, sp * 0.05 + slipV * 0.2);
        for (let k = 0; k < n; k++) if (Math.random() < 0.7) this.emit(p.x, p.y + 0.15, p.z, (Math.random() - 0.5) * 2, 0.4 + Math.random() * 1.5, (Math.random() - 0.5) * 2, s.dust, 0.3, 0.9 + Math.random() * 1.2, 1.8);
      }
    });
    // integrate particles
    const P = this.pPos, V = this.pVel, C = this.pCol, L = this.pLife, Z = this.pSize;
    for (let i = 0; i < this.N; i++) {
      if (L[i] <= 0) { if (C[i * 4 + 3] !== 0) C[i * 4 + 3] = 0; continue; }
      L[i] -= dt;
      const k = i * 3;
      V[k] *= 0.97; V[k + 1] = V[k + 1] * 0.97 + 0.3 * dt; V[k + 2] *= 0.97;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      Z[i] += dt * 1.1;
      C[i * 4 + 3] = Math.max(0, L[i] / this.pMax[i]) * 0.22;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
    // wall scrape sparks
    const wc = vehicle.wallContact;
    if (wc && (wc.scrape > 2 || wc.impact > 2)) {
      const v = vehicle.body.velocity;
      this.spark({ ...wc, vx: v.x, vz: v.z }, Math.min(30, Math.round(wc.scrape * 0.6 + wc.impact * 2)));
    }
    const KP = this.kPos, KV = this.kVel, KL = this.kLife, KC = this.kCol;
    for (let i = 0; i < this.K; i++) {
      if (KL[i] <= 0) { KC[i * 4 + 3] = 0; continue; }
      KL[i] -= dt; const k = i * 3;
      KV[k + 1] -= 9.81 * dt;
      KP[k] += KV[k] * dt; KP[k + 1] += KV[k + 1] * dt; KP[k + 2] += KV[k + 2] * dt;
      const a = Math.max(0, Math.min(1, KL[i] * 3));
      KC.set([1, 0.55 + a * 0.35, 0.15 + a * 0.3, a], i * 4);
    }
    this.sparks.geometry.attributes.position.needsUpdate = this.sparks.geometry.attributes.color.needsUpdate = true;
    if (this._skidDirty) { this.skidGeo.attributes.position.needsUpdate = this.skidGeo.attributes.color.needsUpdate = true; this._skidDirty = false; }
  }

  clearSkids() { this.sCol.fill(0); this.skidGeo.attributes.color.needsUpdate = true; this.last = [null, null, null, null]; }
}
