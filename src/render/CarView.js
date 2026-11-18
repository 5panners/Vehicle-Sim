import * as THREE from 'three';
import { lighting } from './lighting.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// glTF car models, loaded once per URL and cloned per build
const modelLoads = new Map(), modelsReady = new Map();
function loadModel(url) {
  if (!modelLoads.has(url)) {
    modelLoads.set(url, new GLTFLoader().loadAsync(url).then((g) => { modelsReady.set(url, g.scene); return g.scene; }));
  }
  return modelLoads.get(url);
}

// Procedural car model built from the vehicle config, so any data-defined car
// gets a matching (placeholder) visual. Cars with `model: { url, prefix }` swap
// in a glTF once it has loaded (the procedural body is the fallback meanwhile).
export class CarView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    // soft contact shadow under every car: the real sun shadow is faint against the bright hemisphere light and dark tarmac
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    this.blob.rotation.order = 'YXZ'; this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 2; this.blob.frustumCulled = false;
    scene.add(this.blob);
    // headlight pool: one additive quad of light on the road ahead (no real lights, so it costs next to nothing)
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 12), new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, color: 0xfff0cc, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    this.pool.rotation.order = 'YXZ'; this.pool.rotation.x = -Math.PI / 2; this.pool.renderOrder = 3; this.pool.frustumCulled = false; this.pool.visible = false;
    scene.add(this.pool);
    this.headMats = [];            // the lamps' materials: they glow when the light goes
  }

  build(vehicle) {
    const cfg = vehicle.config, b = cfg.body, { width: W, height: H, length: L } = b.dimensions;
    this.group.clear();
    this.vehicle = vehicle;
    this.blob.scale.set(W * 1.3, L * 1.15, 1);
    this.pool.scale.set(14, 38, 1);
    this.headMats = [];
    const paint = new THREE.MeshStandardMaterial({ color: this.tint ?? cfg.color, metalness: 0.4, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a2633, metalness: 0.6, roughness: 0.08 });
    const y0 = vehicle.hullBox.y0;
    const body = new THREE.Group();
    const box = (w, h, l, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };
    // side profile (z, y) extruded across the car's width
    const extrude = (pts, width, mat, bevel = 0.04) => {
      const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
      g.rotateY(-Math.PI / 2); g.translate((width - bevel * 2) / 2, 0, 0);
      const m = new THREE.Mesh(g, mat); m.castShadow = true; body.add(m); return m;
    };
    const style = cfg.style;
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0.2 });
    this.steerWheel = null; this.rearAxle = null;
    if (style === 'f1') this._buildOpenWheel(vehicle, body, { paint, dark, box, extrude });
    else if (style === 'kart') this._buildKart(vehicle, body, { paint, dark, box, extrude });
    else if (style === 'cigar') this._buildCigar(vehicle, body, { paint, dark, box });
    else {
    const b0 = y0 + 0.04, lowH = (style === 'proto' ? 0.42 : style === 'truck' ? 0.55 : style === 'gt3' ? 0.47 : style === 'drift' ? 0.48 : 0.5) * H, top = y0 + H;
    const hz = L / 2;
    // lower body: rounded tail, sloped nose
    const nose = style === 'truck' ? 0.25 : style === 'proto' ? 1.1 : style === 'gt3' ? 0.85 : 0.7;
    const wide = style === 'gt3' || style === 'drift';
    const bodyW = wide ? W * 0.88 : W; // GT3: narrower shell, wide-body arches added below
    const prof = [[-hz, b0], [-hz, b0 + lowH * 0.9], [-hz + 0.25, b0 + lowH], [hz - nose, b0 + lowH], [hz - 0.08, b0 + lowH * 0.55], [hz, b0 + lowH * 0.3], [hz - 0.05, b0]];
    // wheel arches cut into the bottom edge (front first, walking toward the rear)
    for (const w of [vehicle.wheels[0], vehicle.wheels[2]]) {
      const zc = w.mount.z, yc = w.mount.y - (w.susp.restLength - w.staticComp), ra = w.radius + 0.07;
      const a0 = Math.asin(Math.max(-1, Math.min(1, (b0 - yc) / ra)));
      for (let i = 0; i <= 10; i++) { const a = a0 + (Math.PI - 2 * a0) * (i / 10); prof.push([zc + ra * Math.cos(a), yc + ra * Math.sin(a)]); }
    }
    extrude(prof, bodyW, paint);
    if (wide) { // wide-body fender flares over each wheel (arc bands at full width)
      for (const w of [vehicle.wheels[0], vehicle.wheels[2]]) {
        const zc = w.mount.z, yc = w.mount.y - (w.susp.restLength - w.staticComp), ra = w.radius + 0.07, ro = ra + 0.11;
        const a0 = Math.asin(Math.max(-1, Math.min(1, (b0 + 0.06 - yc) / ra)));
        const pts = [];
        for (let i = 0; i <= 12; i++) { const a = a0 + (Math.PI - 2 * a0) * (i / 12); pts.push([zc + ro * Math.cos(a), yc + ro * Math.sin(a)]); }
        for (let i = 12; i >= 0; i--) { const a = a0 + (Math.PI - 2 * a0) * (i / 12); pts.push([zc + ra * Math.cos(a), yc + ra * Math.sin(a)]); }
        extrude(pts, W, paint, 0.03);
      }
    }
    // cabin: glass trapezoid + painted roof
    const cab = {
      coupe: { r: -L * 0.36, f: L * 0.14, rs: 0.95, fs: 0.75, w: 0.86 },
      hatch: { r: -hz + 0.2, f: L * 0.16, rs: 0.25, fs: 0.75, w: 0.88 },
      proto: { r: -L * 0.12, f: L * 0.22, rs: 0.6, fs: 0.7, w: 0.5 },
      truck: { r: -L * 0.08, f: L * 0.2, rs: 0.1, fs: 0.45, w: 0.92 },
      gt3: { r: -L * 0.3, f: L * 0.1, rs: 1.0, fs: 0.8, w: 0.74 },
      drift: { r: -L * 0.33, f: L * 0.12, rs: 0.9, fs: 0.75, w: 0.78 },
    }[style] || { r: -L * 0.3, f: L * 0.15, rs: 0.6, fs: 0.7, w: 0.86 };
    const cb = b0 + lowH - 0.02;
    extrude([[cab.r, cb], [cab.f, cb], [cab.f - cab.fs, top], [cab.r + cab.rs, top]], W * cab.w, glass, 0.03);
    const roofMat = cfg.roofColor ? new THREE.MeshStandardMaterial({ color: cfg.roofColor, metalness: 0.3, roughness: 0.4 }) : paint; // two-tone roof
    extrude([[cab.r + cab.rs - 0.04, top - 0.07], [cab.f - cab.fs + 0.04, top - 0.07], [cab.f - cab.fs, top + 0.01], [cab.r + cab.rs, top + 0.01]], W * cab.w + 0.02, roofMat, 0.02);
    // pillars between glass panes
    for (const z of [cab.f - cab.fs * 0.5, cab.r + cab.rs * 0.5]) {
      const pil = box(W * cab.w + 0.03, (top - cb) * 0.95, 0.07, paint, 0, (cb + top) / 2, z);
      pil.rotation.x = z > 0 ? -Math.atan2(cab.fs, top - cb) : Math.atan2(cab.rs, top - cb);
    }
    // bumpers / splitter / skirts
    box(W * 0.96, 0.1, 0.3, dark, 0, b0 + 0.06, hz - 0.1);
    box(W * 0.96, 0.12, 0.25, dark, 0, b0 + 0.08, -hz + 0.08);
    box(W + 0.02, 0.08, L * 0.45, dark, 0, b0 + 0.05, 0);
    if (style === 'truck') { // pickup bed walls
      const bedL = hz + cab.r - 0.1, bz = -hz + bedL / 2 + 0.05;
      for (const s of [-1, 1]) box(0.08, 0.4, bedL, paint, s * (W / 2 - 0.05), b0 + lowH + 0.2, bz);
      box(W, 0.4, 0.08, paint, 0, b0 + lowH + 0.2, -hz + 0.05);
    }
    if (style === 'proto') { // rear wing + fins
      box(W * 0.95, 0.05, 0.45, dark, 0, top + 0.15, -hz + 0.3);
      for (const s of [-1, 1]) box(0.05, 0.45, 0.35, dark, s * W * 0.32, top - 0.05, -hz + 0.3);
    }
    if (style === 'coupe') box(W * 0.85, 0.04, 0.22, dark, 0, b0 + lowH + 0.08, -hz + 0.2); // ducktail
    if (style === 'drift') this._driftKit(vehicle, body, { paint, dark, box, b0, lowH, top, hz, W, bodyW, cab });
    if (style === 'gt3') this._gt3Aero(vehicle, body, { paint, dark, box, b0, lowH, top, hz, W, cab });
    // lights (+Z forward, -X right)
    const head = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 0.6 }); head.userData.base = 0.6; this.headMats.push(head);
    for (const s of [-1, 1]) {
      box(0.38, 0.1, 0.06, head, s * W * 0.33, b0 + lowH * 0.55, hz - 0.02);
      box(0.4, 0.1, 0.06, this.brakeMat, s * W * 0.32, b0 + lowH * 0.78, -hz - 0.02);
    }
    }
    this.group.add(body);

    // wheels
    this.wheelGroups = vehicle.wheels.map((w) => {
      const g = new THREE.Group(); g.rotation.order = 'YXZ';
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, w.wcfg.width, 24), dark);
      tire.rotation.z = Math.PI / 2; tire.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(w.radius * 0.62, w.radius * 0.62, w.wcfg.width * 1.02, 16),
        new THREE.MeshStandardMaterial({ color: style === 'f1' || style === 'gt3' ? 0x2a2a2a : style === 'kart' ? 0xd4d4d4 : style === 'drift' ? 0xb08d57 : style === 'cigar' ? 0x9a9a9a : 0xb0b0b0, metalness: 0.8, roughness: 0.3 }));
      rim.rotation.z = Math.PI / 2;
      spin.add(tire, rim);
      for (let i = 0; i < 5; i++) { // spokes make rotation visible
        const sp = new THREE.Mesh(new THREE.BoxGeometry(w.wcfg.width * 1.06, w.radius * 1.15, 0.06), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        sp.rotation.x = (i / 5) * Math.PI; spin.add(sp);
      }
      g.add(spin);
      g.userData.spin = spin;
      this.group.add(g);
      return g;
    });

    // glTF model: apply now if cached, else when it arrives (if this build is still current)
    const token = (this._buildToken = {});
    const model = cfg.model;
    if (model?.url) {
      const ready = modelsReady.get(model.url);
      if (ready) this._applyModel(vehicle, ready, body);
      else loadModel(model.url)
        .then((src) => { if (this._buildToken === token) this._applyModel(vehicle, src, body); })
        .catch((e) => console.warn(`Car model ${model.url} failed to load; keeping the procedural body.`, e));
    }
  }

  /**
   * Swap the procedural body and wheels for a glTF model. The model's own axes are
   * the game's (+Z forward, -X right, ground at y = 0) with wheel nodes named
   * `${prefix}Wheel_FL` etc. (origin at the hub) and optional `${prefix}Caliper_FL`.
   * The body is stretched to this vehicle's wheelbase/track so the arches sit on
   * the physics wheels; wheels are scaled to the physics tyre radius.
   */
  _applyModel(vehicle, src, procBody) {
    const prefix = vehicle.config.model.prefix ?? '';
    const root = src.clone(true);
    root.updateMatrixWorld(true);
    const byName = new Map();
    root.traverse((o) => { if (!byName.has(o.name)) byName.set(o.name, o); }); // first (outermost) node wins
    const wheels = vehicle.wheels.map((w) => byName.get(`${prefix}Wheel_${w.name}`));
    if (wheels.some((n) => !n)) { console.warn(`Car model is missing ${prefix}Wheel_* nodes; keeping the procedural body.`); return; }
    const calipers = vehicle.wheels.map((w) => byName.get(`${prefix}Caliper_${w.name}`));
    const hubs = wheels.map((n) => n.getWorldPosition(new THREE.Vector3()));

    // fit: model hub positions -> physics hub positions at static ride height
    const phys = vehicle.wheels.map((w) => new THREE.Vector3(w.mount.x, w.mount.y - (w.susp.restLength - w.staticComp), w.mount.z));
    const mF = (hubs[0].z + hubs[1].z) / 2, mR = (hubs[2].z + hubs[3].z) / 2;
    const pF = (phys[0].z + phys[1].z) / 2, pR = (phys[2].z + phys[3].z) / 2;
    const sz = (pF - pR) / (mF - mR);
    const sx = phys.reduce((a, p, i) => a + Math.abs(p.x) / Math.abs(hubs[i].x), 0) / 4;
    const avgY = (arr) => arr.reduce((a, p) => a + p.y, 0) / arr.length;
    root.scale.set(sx, 1, sz);
    root.position.set(0, avgY(phys) - avgY(hubs), pF - mF * sz);

    // wheels spin inside the existing wheel groups; calipers steer but don't spin
    vehicle.wheels.forEach((w, i) => {
      const g = this.wheelGroups[i], spin = g.userData.spin, s = w.radius / hubs[i].y; // model hub height = tyre radius
      spin.clear();
      for (const [node, parent] of [[wheels[i], spin], [calipers[i], g]]) {
        if (!node) continue;
        node.removeFromParent();
        node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.setScalar(s);
        parent.add(node);
      }
    });

    // brake lights: drive the model's taillight material (cloned per car)
    const brakeName = vehicle.config.model.brakeMaterial;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !o.material.transparent && !SKIP_SHADOW.test(`${o.name} ${o.parent?.name ?? ''}`); o.receiveShadow = true;   // small trim, decals, glass and the cabin cast no shadow: fewer draws in the shadow pass
      // opponent cars: recolour the model's paint (cloned so the player's car keeps its colour)
      if (this.tint !== undefined && /paint/i.test(o.material.name)) {
        if (!this._tintMat || this._tintMat.name !== o.material.name) { this._tintMat = o.material.clone(); this._tintMat.color.setHex(this.tint); }
        o.material = this._tintMat;
      }
      if (/headlight/i.test(o.material.name)) {                       // the model's lamp glass: its own copy per car, driven by the time of day
        if (!this._headMat) { this._headMat = o.material.clone(); this._headMat.userData.base = o.material.emissiveIntensity ?? 0.4; this._headMat.emissive.set(0xfff2d0); }
        o.material = this._headMat; if (!this.headMats.includes(this._headMat)) this.headMats.push(this._headMat);
      }
      if (brakeName && o.material.name === brakeName) {
        if (this.brakeMat?.name !== brakeName) this.brakeMat = o.material.clone();
        o.material = this.brakeMat;
      }
    });
    for (const n of [...wheels, ...calipers]) n?.traverse((o) => { if (o.isMesh) { o.castShadow = !/caliper/i.test(n.name); o.receiveShadow = true; } });
    // without an environment map, fully metallic PBR surfaces (rims, discs) render near-black
    if (!this.scene.environment) {
      const softened = new Map();
      for (const n of [root, ...wheels, ...calipers]) n?.traverse((o) => {
        if (!o.isMesh || o.material.metalness <= 0.5) return;
        if (!softened.has(o.material)) { const m = o.material.clone(); m.metalness = 0.45; m.roughness = Math.max(m.roughness, 0.4); softened.set(o.material, m); }
        o.material = softened.get(o.material);
      });
    }

    this.group.remove(procBody);
    this.group.add(root);
    this.steerWheel = null; this.rearAxle = null;
  }

  /**
   * 1967 cigar-bodied GP car: lathe-turned monocoque, exposed stressed-member V8
   * with intake trumpets in the vee and exhausts sweeping over the gearbox,
   * wraparound screen, roll hoop, open-face helmet, long rear radius arms,
   * yellow centre stripe and nose roundels.
   */
  _buildCigar(vehicle, body, { paint, dark, box }) {
    const cfg = vehicle.config, hz = cfg.body.dimensions.length / 2;
    const accent = new THREE.MeshStandardMaterial({ color: cfg.accent ?? 0xffd400, roughness: 0.4 });
    const alloy = new THREE.MeshStandardMaterial({ color: 0xa7a9ac, metalness: 0.8, roughness: 0.35 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d8478, metalness: 0.7, roughness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.05 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.8 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
    const b0 = vehicle.hullBox.y0 + 0.01;
    const [fl, , rl] = vehicle.wheels;
    const zF = fl.mount.z, zR = rl.mount.z;
    const restY = (w) => w.mount.y - (w.susp.restLength - w.staticComp);
    const yF = restY(fl), yR = restY(rl);
    const sy = 0.8, sx = 1.05;            // cross-section: a little wider than tall
    const cy = b0 + 0.27;                 // body axis height
    // monocoque profile [radius, z], rear bulkhead -> nose
    const prof = [[0, -0.5], [0.29, -0.49], [0.32, -0.3], [0.33, 0.1], [0.31, 0.6], [0.27, 1.0], [0.21, 1.45], [0.16, 1.8], [0.13, 1.93], [0.1, hz - 0.02], [0, hz - 0.02]];
    const rAt = (z) => { for (let i = 1; i < prof.length; i++) if (z <= prof[i][1]) { const [r0, z0] = prof[i - 1], [r1, z1] = prof[i]; return r0 + (r1 - r0) * (z - z0) / ((z1 - z0) || 1); } return 0; };
    const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 32);
    lathe.rotateX(Math.PI / 2); lathe.scale(sx, sy, 1); lathe.translate(0, cy, 0);
    const tub = new THREE.Mesh(lathe, paint); tub.castShadow = true; body.add(tub);
    const top = (z) => cy + rAt(z) * sy;
    const cyl = (r1, r2, a, c, mat) => {
      const d = new THREE.Vector3().subVectors(c, a), len = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 10), mat);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      m.castShadow = true; body.add(m); return m;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // nose intake
    cyl(0.085, 0.085, V(0, cy, hz - 0.03), V(0, cy, hz + 0.0), dark);
    // yellow centre stripe from nose to the cockpit, following the curved top
    for (let z = 0.36; z < hz - 0.06; z += 0.1) {
      const z1 = Math.min(z + 0.1, hz - 0.04), y0 = top(z) + 0.004, y1 = top(z1) + 0.004;
      const seg = box(0.075, 0.01, Math.hypot(z1 - z, y1 - y0) + 0.005, accent, 0, (y0 + y1) / 2, (z + z1) / 2);
      seg.rotation.x = Math.atan2(y0 - y1, z1 - z);
    }
    // nose roundels
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshStandardMaterial({ map: roundelTexture(cfg.raceNumber), transparent: true, roughness: 0.6 }));
      r.rotation.y = s * Math.PI / 2; r.position.set(s * (rAt(1.15) * sx + 0.006), cy + 0.02, 1.15); body.add(r);
    }
    // cockpit opening, wraparound screen, mirrors, steering wheel, roll hoop
    const ct = top(0);
    box(0.42, 0.02, 0.8, dark, 0, ct - 0.005, -0.08);
    const scr = box(0.48, 0.15, 0.008, glass, 0, ct + 0.06, 0.36); scr.rotation.x = -0.55;
    for (const s of [-1, 1]) { cyl(0.008, 0.008, V(s * 0.24, ct, 0.28), V(s * 0.33, ct + 0.08, 0.3), alloy); box(0.08, 0.05, 0.02, alloy, s * 0.35, ct + 0.09, 0.3); }
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 20), dark); sw.position.set(0, ct + 0.03, 0.18); sw.rotation.x = -0.4; body.add(sw);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 18, Math.PI), alloy); hoop.position.set(0, ct - 0.02, -0.42); body.add(hoop);
    // driver: shoulders, open-face helmet, goggles
    box(0.4, 0.12, 0.22, suit, 0, ct + 0.02, -0.2);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), helmetMat);
    helmet.position.set(0, ct + 0.12, -0.15); helmet.castShadow = true; body.add(helmet);
    box(0.17, 0.045, 0.03, dark, 0, ct + 0.13, -0.04);
    // exposed V8 (stressed member) behind the bulkhead
    const ez = -0.85, ey = cy - 0.02;
    box(0.48, 0.3, 0.62, alloy, 0, ey, ez);
    for (const s of [-1, 1]) { const cam = box(0.15, 0.08, 0.62, alloy, s * 0.13, ey + 0.19, ez); cam.rotation.z = -s * 0.45; }
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { // intake trumpets standing in the vee
      const z = ez + 0.22 - i * 0.15;
      cyl(0.028, 0.038, V(s * 0.05, ey + 0.14, z), V(s * 0.05, ey + 0.3, z), alloy);
    }
    // exhausts: four primaries a side sweep up and back into megaphones over the gearbox
    for (const s of [-1, 1]) {
      const col = V(s * 0.3, ey + 0.22, -1.32);
      for (let i = 0; i < 4; i++) {
        const port = V(s * 0.25, ey + 0.05, ez + 0.22 - i * 0.15), bend = V(s * 0.34, ey + 0.16, ez + 0.15 - i * 0.15);
        cyl(0.022, 0.022, port, bend, steel); cyl(0.022, 0.022, bend, col, steel);
      }
      cyl(0.035, 0.065, col, V(s * 0.28, ey + 0.27, -hz + 0.12), steel);
    }
    // gearbox / transaxle, oil tank
    box(0.34, 0.24, 0.4, dark, 0, cy - 0.04, zR - 0.15);
    box(0.24, 0.12, 0.16, alloy, 0, cy + 0.14, zR - 0.3);
    // suspension: front wishbones, rear radius arms + lower links
    for (const w of vehicle.wheels) {
      const s = Math.sign(w.mount.x), front = w.axle === 'front', yc = front ? yF : yR, z = w.mount.z;
      const hub = V(w.mount.x - s * (w.wcfg.width / 2 + 0.02), yc, z);
      if (front) {
        for (const dy of [-0.07, 0.07]) for (const dz of [-0.2, 0.2]) cyl(0.014, 0.014, V(s * rAt(z) * sx * 0.8, yc + dy, z + dz), hub.clone().setY(yc + dy * 0.7), dark);
      } else {
        cyl(0.016, 0.016, V(s * 0.3, cy, -0.48), hub, dark);                       // long radius arm to the bulkhead
        cyl(0.014, 0.014, V(s * 0.16, cy - 0.12, z - 0.05), hub.clone().setY(yc - 0.06), dark);
        cyl(0.014, 0.014, V(s * 0.16, cy + 0.05, z - 0.1), hub.clone().setY(yc + 0.07), dark);
      }
    }
    // (no brake/rain light: 1967 GP cars didn't have one)
  }

  /** Drift build: lip, carbon bonnet, low wing on stands, tow hooks, side-exit exhaust, livery band, banner. */
  _driftKit(vehicle, body, { paint, dark, box, b0, lowH, top, hz, W, bodyW, cab }) {
    const cfg = vehicle.config;
    const accent = new THREE.MeshStandardMaterial({ color: cfg.accent ?? 0x00e5ff, roughness: 0.4 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.5, roughness: 0.45 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.95, roughness: 0.2 });
    const red = new THREE.MeshStandardMaterial({ color: 0xff1744, roughness: 0.4 });
    const noseZ = hz - 0.7, deckY = b0 + lowH + 0.046;
    box(W * 0.94, 0.03, 0.22, carbon, 0, b0 + 0.02, hz - 0.05);                         // front lip
    box(bodyW * 0.7, 0.012, noseZ - cab.f, carbon, 0, deckY, (noseZ + cab.f) / 2);     // carbon bonnet
    for (const sx of [-1, 1]) box(0.14, 0.012, 0.3, dark, sx * 0.22, deckY + 0.008, (noseZ + cab.f) / 2 + 0.1); // bonnet vents
    // low GT wing on straight stands
    const wz = -hz + 0.3, wy = b0 + lowH + 0.3;
    box(W * 0.82, 0.03, 0.3, carbon, 0, wy, wz).rotation.x = -0.1;
    for (const sx of [-1, 1]) { box(0.02, 0.2, 0.36, carbon, sx * W * 0.41, wy, wz); box(0.04, 0.28, 0.08, carbon, sx * 0.4, wy - 0.15, wz + 0.04); }
    // tow hooks
    box(0.05, 0.12, 0.06, red, -0.45, b0 + 0.15, hz + 0.02);
    box(0.05, 0.12, 0.06, red, 0.5, b0 + 0.18, -hz - 0.02);
    // side-exit exhaust ahead of the driver's-side rear wheel (driver's right = -X)
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), chrome);
    ex.rotation.z = Math.PI / 2; ex.position.set(-(bodyW / 2 + 0.02), b0 + 0.1, vehicle.wheels[2].mount.z + 0.65); body.add(ex);
    // livery: diagonal band on each side, windscreen banner, roof vent
    for (const sx of [-1, 1]) {
      const band = box(0.012, 0.16, 1.6, accent, sx * (bodyW / 2 + 0.045), b0 + lowH * 0.55, 0.1); band.rotation.x = 0.18;
      box(0.012, 0.05, 2.2, dark, sx * (bodyW / 2 + 0.045), b0 + 0.09, 0); // side skirt
    }
    const ban = box(W * cab.w * 0.92, 0.1, 0.02, accent, 0, top - 0.06, cab.f - cab.fs + 0.05); ban.rotation.x = -Math.atan2(cab.fs, top - b0 - lowH);
    box(0.3, 0.05, 0.25, dark, 0, top + 0.035, (cab.f - cab.fs + cab.r + cab.rs) / 2);
  }

  /** GT3 race kit: splitter, canards, dive planes, swan-neck rear wing, diffuser, livery, roundels, mirrors. */
  _gt3Aero(vehicle, body, { paint, dark, box, b0, lowH, top, hz, W, cab }) {
    const cfg = vehicle.config;
    const accent = new THREE.MeshStandardMaterial({ color: cfg.accent ?? 0xffd600, roughness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.5, roughness: 0.45 });
    // front splitter + canards
    box(W * 0.98, 0.025, 0.4, carbon, 0, b0 + 0.02, hz - 0.12);
    for (const sx of [-1, 1]) for (const [dy, dz] of [[0.12, 0.02], [0.2, -0.06]]) {
      const c = box(0.22, 0.012, 0.16, carbon, sx * (W * 0.47), b0 + dy, hz - 0.12 + dz);
      c.rotation.z = sx * 0.25; c.rotation.x = 0.15;
    }
    // swan-neck rear wing: element + gurney + endplates, mounts hang from the wing's top
    const wz = -hz + 0.28, wy = top + 0.18, ww = W * 0.9;
    const plane = box(ww, 0.035, 0.38, carbon, 0, wy, wz); plane.rotation.x = -0.12;
    box(ww, 0.05, 0.015, carbon, 0, wy + 0.04, wz - 0.19);
    for (const sx of [-1, 1]) {
      box(0.02, 0.32, 0.5, carbon, sx * ww / 2, wy - 0.04, wz);
      const neck = box(0.035, 0.38, 0.1, carbon, sx * 0.32, wy + 0.0, wz + 0.15); neck.rotation.x = -0.6; // swan neck curve
      box(0.035, 0.2, 0.08, carbon, sx * 0.32, b0 + lowH + 0.08, wz + 0.32);
    }
    // diffuser fins
    const diff = box(W * 0.75, 0.025, 0.45, carbon, 0, b0 + 0.08, -hz + 0.15); diff.rotation.x = -0.22;
    for (const sx of [-0.3, 0, 0.3]) box(0.015, 0.14, 0.4, carbon, sx, b0 + 0.08, -hz + 0.17);
    // livery: twin centre stripes over bonnet, roof and deck; door roundels + numbers; mirrors
    const noseZ = hz - 0.85, deckY = b0 + lowH + 0.046; // above the 4 cm extrusion bevel; nose taper matches the body profile
    const noseLen = Math.hypot(0.77, lowH * 0.45), noseAng = Math.atan2(lowH * 0.45, 0.77);
    for (const sx of [-0.13, 0.13]) {
      box(0.12, 0.012, noseZ - cab.f, accent, sx, deckY, (noseZ + cab.f) / 2);       // flat bonnet
      const ns = box(0.12, 0.012, noseLen, accent, sx, deckY - lowH * 0.225, noseZ + 0.385); ns.rotation.x = noseAng; // sloped nose
      box(0.12, 0.012, (cab.f - cab.fs) - (cab.r + cab.rs), accent, sx, top + 0.036, ((cab.f - cab.fs) + (cab.r + cab.rs)) / 2);
      box(0.12, 0.012, cab.r + hz - 0.25, accent, sx, deckY, (cab.r - hz + 0.25) / 2);  // rear deck
    }
    for (const sx of [-1, 1]) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 24), white);
      disc.rotation.z = Math.PI / 2; disc.position.set(sx * (W * 0.44 + 0.005), b0 + lowH * 0.6, -0.15); body.add(disc);
      const num = box(0.012, 0.18, 0.14, dark, sx * (W * 0.44 + 0.012), b0 + lowH * 0.6, -0.15); void num;
      box(0.16, 0.08, 0.12, paint, sx * (W * cab.w / 2 + 0.06), b0 + lowH + 0.18, cab.f - 0.15);
      box(0.012, 0.08, 0.6, accent, sx * (W * 0.44 + 0.006), b0 + 0.12, 0); // side skirt highlight
    }
    box(0.22, 0.06, 0.3, dark, 0, top + 0.035, (cab.f - cab.fs) - 0.2); // roof scoop
  }

  /**
   * Open-wheel single-seater: exposed wheels, nose + front wing, tub, sidepods,
   * airbox/engine cover, halo, helmet, rear + beam wing, diffuser, wishbones.
   * All positions derive from the physics config so geometry changes follow.
   */
  _buildOpenWheel(vehicle, body, { paint, dark, box, extrude }) {
    const cfg = vehicle.config, { width: W, length: L } = cfg.body.dimensions;
    const accent = new THREE.MeshStandardMaterial({ color: cfg.accent ?? 0xffffff, metalness: 0.3, roughness: 0.4 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.5, roughness: 0.45 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xffd600, metalness: 0.3, roughness: 0.25 });
    const b0 = vehicle.hullBox.y0 + 0.01, hz = L / 2;
    const [fl, , rl] = vehicle.wheels;
    const zF = fl.mount.z, zR = rl.mount.z;
    const restY = (w) => w.mount.y - (w.susp.restLength - w.staticComp);
    const yF = restY(fl), yR = restY(rl);
    const add = (m, x = 0) => { m.position.x = x; return m; };

    // floor / plank
    box(W * 0.7, 0.025, zF - 0.55 - (zR + 0.15), carbon, 0, b0 + 0.012, (zF - 0.55 + zR + 0.15) / 2);
    // nose cone (narrow) and survival cell / tub
    extrude([[zF - 0.65, b0 + 0.12], [hz - 0.12, b0 + 0.1], [hz, b0 + 0.17], [hz - 0.1, b0 + 0.24], [zF - 0.3, b0 + 0.52], [zF - 0.65, b0 + 0.57]], 0.3, paint, 0.05);
    const cockF = zF - 1.25, cockR = zF - 2.0;
    extrude([[zF - 0.6, b0 + 0.05], [zF - 0.6, b0 + 0.58], [cockF, b0 + 0.66], [cockR, b0 + 0.66], [zR + 0.25, b0 + 0.42], [zR + 0.25, b0 + 0.05]], 0.72, paint, 0.06);
    // airbox + engine cover with shark fin
    extrude([[cockR + 0.05, b0 + 0.64], [cockR - 0.02, b0 + 0.98], [cockR - 0.35, b0 + 1.0], [zR - 0.05, b0 + 0.62], [zR - 0.05, b0 + 0.5]], 0.34, paint, 0.05);
    extrude([[cockR - 0.4, b0 + 0.95], [zR - 0.1, b0 + 0.72], [zR - 0.1, b0 + 0.62], [cockR - 0.4, b0 + 0.8]], 0.04, accent, 0.01);
    box(0.2, 0.16, 0.04, carbon, 0, b0 + 0.9, cockR - 0.01); // airbox intake
    // cockpit opening, driver helmet, halo
    box(0.46, 0.03, cockF - cockR, carbon, 0, b0 + 0.665, (cockF + cockR) / 2);
    const hzc = cockR + 0.3;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), helmetMat);
    helmet.position.set(0, b0 + 0.76, hzc); helmet.castShadow = true; body.add(helmet);
    box(0.2, 0.05, 0.02, carbon, 0, b0 + 0.78, hzc + 0.125); // visor
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.028, 8, 28, Math.PI), carbon);
    halo.rotation.x = Math.PI / 2; halo.position.set(0, b0 + 0.9, hzc); body.add(halo);
    for (const sx of [-0.3, 0.3]) box(0.05, 0.25, 0.05, carbon, sx, b0 + 0.78, hzc);
    const strut = box(0.05, 0.27, 0.05, carbon, 0, b0 + 0.78, hzc + 0.36); strut.rotation.x = -0.35;
    // sidepods with inlets
    for (const sx of [-1, 1]) {
      add(extrude([[zF - 1.05, b0 + 0.06], [zF - 1.05, b0 + 0.5], [zF - 1.35, b0 + 0.55], [zR + 0.55, b0 + 0.3], [zR + 0.35, b0 + 0.06]], 0.42, paint, 0.06), sx * 0.55);
      box(0.32, 0.26, 0.04, carbon, sx * 0.55, b0 + 0.36, zF - 1.03);
      box(0.06, 0.04, (zF - 1.05) - (zR + 0.4), accent, sx * 0.77, b0 + 0.42, (zF - 1.05 + zR + 0.4) / 2); // livery stripe
    }
    // front wing: main plane, flap, endplates
    const fwZ = hz - 0.24, fwW = Math.min(W * 0.98, cfg.geometry.trackFront + fl.wcfg.width);
    box(fwW, 0.025, 0.42, carbon, 0, b0 + 0.06, fwZ);
    const flap = box(fwW * 0.92, 0.02, 0.22, paint, 0, b0 + 0.13, fwZ - 0.14); flap.rotation.x = 0.35;
    for (const sx of [-1, 1]) box(0.02, 0.17, 0.5, accent, sx * fwW / 2, b0 + 0.12, fwZ);
    // rear wing: main plane + DRS flap, endplates, centre pylon, beam wing, diffuser, rain light
    const rwZ = zR - 0.6, rwY = b0 + 0.92;
    box(1.0, 0.03, 0.34, carbon, 0, rwY, rwZ);
    const drs = box(1.0, 0.025, 0.2, paint, 0, rwY + 0.09, rwZ - 0.12); drs.rotation.x = 0.4;
    for (const sx of [-1, 1]) box(0.025, 0.45, 0.6, paint, sx * 0.51, rwY - 0.08, rwZ);
    box(0.05, 0.55, 0.1, carbon, 0, rwY - 0.28, rwZ + 0.1);
    box(0.95, 0.02, 0.16, carbon, 0, b0 + 0.36, rwZ + 0.05);
    const diff = box(W * 0.6, 0.03, 0.5, carbon, 0, b0 + 0.1, zR - 0.25); diff.rotation.x = -0.25;
    box(0.14, 0.07, 0.03, this.brakeMat, 0, b0 + 0.3, rwZ - 0.05);
    // wishbones / push rods from the tub to each wheel hub (static, at ride height)
    const rod = (a, c, r = 0.018) => {
      const d = new THREE.Vector3().subVectors(c, a), len = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), carbon);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      body.add(m);
    };
    for (const w of vehicle.wheels) {
      const yc = w.axle === 'front' ? yF : yR, hubX = w.mount.x - Math.sign(w.mount.x) * (w.wcfg.width / 2 + 0.02);
      const inX = Math.sign(w.mount.x) * (w.axle === 'front' ? 0.15 : 0.3), z = w.mount.z;
      const hub = new THREE.Vector3(hubX, yc, z);
      for (const dy of [-0.09, 0.09]) for (const dz of [-0.28, 0.22]) rod(new THREE.Vector3(inX, yc + dy, z + dz), hub.clone().setY(yc + dy * 0.7));
      rod(new THREE.Vector3(inX, b0 + (w.axle === 'front' ? 0.55 : 0.4), z - 0.1), hub.clone().setY(yc - 0.06), 0.014); // push rod
    }
  }

  /**
   * Race kart: tube frame, floor tray, nose fairing, side pods, front panel,
   * rear bumper, seat, side-mounted engine with chain and exhaust, solid rear
   * axle (spins with the wheels) and a seated driver whose steering wheel turns.
   */
  _buildKart(vehicle, body, { paint, dark, box, extrude }) {
    const cfg = vehicle.config, { length: L } = cfg.body.dimensions, hz = L / 2;
    const accent = new THREE.MeshStandardMaterial({ color: cfg.accent ?? 0xff6d00, roughness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.25 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.8 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: cfg.accent ?? 0xff6d00, metalness: 0.3, roughness: 0.25 });
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, metalness: 0.7, roughness: 0.4 });
    const b0 = vehicle.hullBox.y0 + 0.01;
    const [fl, , rl, rr] = vehicle.wheels;
    const zF = fl.mount.z, zR = rl.mount.z;
    const yR = rl.mount.y - (rl.susp.restLength - rl.staticComp);
    const xF = Math.abs(fl.mount.x), xR = Math.abs(rr.mount.x);
    const rod = (a, c, r = 0.016, mat = chrome) => {
      const d = new THREE.Vector3().subVectors(c, a), len = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      m.castShadow = true; body.add(m); return m;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const fy = b0 + 0.03; // frame tube height

    // tube frame: two main rails, cross members, stub-axle carriers, rear bearing hangers
    for (const sx of [-1, 1]) {
      rod(V(sx * 0.18, fy, zF + 0.12), V(sx * 0.26, fy, zR - 0.05));
      rod(V(sx * 0.26, fy, zR - 0.05), V(sx * 0.3, fy + 0.06, zR - 0.1));
      rod(V(sx * 0.18, fy, zF), V(sx * (xF - 0.06), yR - 0.005, zF), 0.018);          // front stub axle carrier
      rod(V(sx * 0.26, fy, zR + 0.05), V(sx * 0.42, fy + 0.07, zR), 0.014);          // bearing hanger
      rod(V(sx * 0.22, fy, 0.1), V(sx * 0.48, fy + 0.02, 0.05), 0.013);             // side-pod bar
      rod(V(sx * 0.25, fy, -0.2), V(sx * 0.5, fy + 0.02, -0.15), 0.013);
    }
    rod(V(-0.18, fy, zF + 0.12), V(0.18, fy, zF + 0.12));
    rod(V(-0.2, fy, 0.15), V(0.2, fy, 0.15));
    rod(V(-0.26, fy, zR + 0.12), V(0.26, fy, zR + 0.12));
    box(0.42, 0.012, 0.75, dark, 0, b0 + 0.01, 0.12); // floor tray

    // bodywork: nose fairing, front panel, side pods, rear bumper
    extrude([[zF - 0.02, b0 + 0.02], [hz - 0.04, b0 + 0.02], [hz, b0 + 0.08], [hz - 0.06, b0 + 0.15], [zF + 0.05, b0 + 0.19], [zF - 0.02, b0 + 0.17]], 0.95, paint, 0.03);
    const panel = box(0.36, 0.26, 0.025, paint, 0, b0 + 0.27, zF - 0.05); panel.rotation.x = -0.55;
    const num = box(0.18, 0.12, 0.005, new THREE.MeshStandardMaterial({ color: 0xffeb3b }), 0, b0 + 0.29, zF - 0.06); num.rotation.x = -0.55;
    for (const sx of [-1, 1]) {
      const podZ0 = zR + rl.radius + 0.05, podZ1 = zF - fl.radius - 0.05;
      const pod = extrude([[podZ0, b0 + 0.02], [podZ1, b0 + 0.02], [podZ1 - 0.06, b0 + 0.17], [podZ0 + 0.05, b0 + 0.2]], 0.2, accent, 0.03);
      pod.position.x = sx * 0.55;
    }
    box(xR * 2 + 0.15, 0.13, 0.14, paint, 0, b0 + 0.1, -hz + 0.07);
    box(0.12, 0.045, 0.02, this.brakeMat, 0, b0 + 0.13, -hz - 0.005);

    // seat (offset slightly to the left; engine sits on the driver's right = -X)
    const seatX = 0.05;
    const seat = extrude([[0.08, b0 + 0.03], [0.08, b0 + 0.11], [-0.14, b0 + 0.1], [-0.3, b0 + 0.46], [-0.36, b0 + 0.44], [-0.24, b0 + 0.03]], 0.38, dark, 0.04);
    seat.position.x = seatX;

    // engine, carb/airbox, chain, exhaust
    const ex = -0.38, ez = zR + 0.2;
    box(0.16, 0.2, 0.22, engineMat, ex, b0 + 0.17, ez);
    for (let i = 0; i < 5; i++) box(0.2, 0.012, 0.18, engineMat, ex, b0 + 0.29 + i * 0.022, ez); // cylinder fins
    box(0.12, 0.12, 0.16, new THREE.MeshStandardMaterial({ color: 0x1565c0 }), ex + 0.02, b0 + 0.16, ez + 0.2);
    box(0.012, 0.03, Math.abs(ez - zR) + 0.12, dark, ex - 0.09, (b0 + 0.12 + yR) / 2, (ez + zR) / 2);
    rod(V(ex - 0.06, b0 + 0.2, ez - 0.05), V(ex - 0.15, b0 + 0.22, zR - 0.15), 0.035, engineMat);
    rod(V(ex - 0.15, b0 + 0.22, zR - 0.15), V(ex - 0.05, b0 + 0.24, -hz + 0.2), 0.055, chrome); // silencer

    // solid rear axle + sprocket + brake disc (spins with the rear wheels)
    const axle = new THREE.Group();
    axle.position.set(0, yR, zR);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, xR * 2 - 0.1, 10), chrome); shaft.rotation.z = Math.PI / 2;
    const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 18), dark); sprocket.rotation.z = Math.PI / 2; sprocket.position.x = ex - 0.09;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.01, 18), engineMat); disc.rotation.z = Math.PI / 2; disc.position.x = 0.22;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.02), accent); marker.position.x = 0.22; // shows rotation
    axle.add(shaft, sprocket, disc, marker);
    body.add(axle);
    this.rearAxle = axle;

    // driver
    const torso = box(0.36, 0.44, 0.22, suit, seatX, b0 + 0.36, -0.17); torso.rotation.x = -0.32;
    box(0.38, 0.05, 0.2, accent, seatX, b0 + 0.5, -0.21).rotation.x = -0.32; // suit stripe
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), helmetMat);
    helmet.position.set(seatX, b0 + 0.72, -0.26); helmet.castShadow = true; body.add(helmet);
    box(0.2, 0.06, 0.02, dark, seatX, b0 + 0.73, -0.14);
    for (const sx of [-1, 1]) { // legs to the pedals
      rod(V(seatX + sx * 0.1, b0 + 0.13, -0.02), V(seatX * 0.5 + sx * 0.09, b0 + 0.13, zF - 0.12), 0.055, suit);
      box(0.08, 0.12, 0.05, dark, seatX * 0.5 + sx * 0.09, b0 + 0.13, zF - 0.1);
    }
    // steering column + wheel (pivot tilted toward the driver, wheel spins about its own axis)
    const swY = b0 + 0.4, swZ = 0.24;
    rod(V(0, swY - 0.05, swZ + 0.05), V(0, fy + 0.02, zF - 0.02), 0.012);
    const pivot = new THREE.Group(); pivot.position.set(0, swY, swZ); pivot.rotation.x = -0.5;
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 8, 24), dark);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, metalness: 0.7 });
    wheel.add(rim);
    for (const a of [0, Math.PI * 0.66, -Math.PI * 0.66]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.01), spokeMat); sp.position.set(Math.sin(a) * -0.075, Math.cos(a) * -0.075, 0); sp.rotation.z = a; wheel.add(sp); }
    pivot.add(wheel); body.add(pivot);
    this.steerWheel = wheel;
    // arms from shoulders to the rim at ~9 and 3 o'clock (static)
    for (const sx of [-1, 1]) {
      const grip = V(sx * 0.14, swY + 0.01, swZ - 0.04);
      rod(V(seatX + sx * 0.19, b0 + 0.55, -0.13), grip, 0.04, suit);
    }
  }

  update(vehicle, brake) {
    const b = vehicle.body;
    this.group.position.set(b.position.x, b.position.y, b.position.z);
    this.group.quaternion.set(b.orientation.x, b.orientation.y, b.orientation.z, b.orientation.w);
    {
      const f = _fwd.set(0, 0, 1).applyQuaternion(this.group.quaternion);
      this.blob.rotation.y = Math.atan2(f.x, f.z);
      const g = vehicle.world.heightAt(b.position.x, b.position.z, false);
      this.blob.position.set(b.position.x, g + 0.03, b.position.z);
      const air = Math.max(0, b.position.y - g - vehicle.config.body.cgHeight);
      this.blob.material.opacity = Math.max(0.15, 0.9 - air * 0.15);
      // headlights: lamps glow and a pool of light lies on the road ahead, once the light starts to go
      const dark = lighting.dark;
      for (const m of this.headMats) m.emissiveIntensity = m.userData.base + 3.2 * dark;
      this.pool.visible = dark > 0.02 && this.group.visible;
      if (this.pool.visible) {
        const L = vehicle.config.body.dimensions.length, ahead = L / 2 + 19;
        const px = b.position.x + f.x * ahead, pz = b.position.z + f.z * ahead;
        this.pool.position.set(px, vehicle.world.heightAt(px, pz, false) + 0.05, pz);
        this.pool.rotation.y = this.blob.rotation.y;
        this.pool.material.opacity = 0.62 * dark;
        // lie on the road: lift or drop each row of the strip to the ground under it, so crests and dips don't bury the light
        this.pool.updateMatrixWorld(true);
        const pg = this.pool.geometry.attributes.position, py = this.pool.position.y;
        for (let i = 0; i < pg.count; i++) {
          _v.set(pg.getX(i), pg.getY(i), 0).applyMatrix4(this.pool.matrixWorld);
          pg.setZ(i, vehicle.world.heightAt(_v.x, _v.z, false) + 0.05 - py);
        }
        pg.needsUpdate = true;
      }
    }
    vehicle.wheels.forEach((w, i) => {
      const g = this.wheelGroups[i];
      const len = w.susp.restLength - Math.min(w.compression, w.susp.travel);
      g.position.set(w.mount.x, w.mount.y - len, w.mount.z);
      g.rotation.y = -w.steer;           // + steer = right = -yaw about +Y
      // visual camber (static + gain with compression); negative camber tilts the top inward
      const cam = (w.susp.camber - w.susp.camberGain * (w.compression - w.staticComp)) * Math.PI / 180;
      g.rotation.z = -cam * Math.sign(w.mount.x);
      g.userData.spin.rotation.x = w.rotation;
    });
    this.brakeMat.emissiveIntensity = brake > 0.05 ? 2.5 : 0.25;
    if (this.steerWheel) this.steerWheel.rotation.z = vehicle.steerAngle * 2.2; // + = clockwise for the driver
    if (this.rearAxle) this.rearAxle.rotation.x = vehicle.wheels[2].rotation;
  }
}

const _fwd = new THREE.Vector3(), _v = new THREE.Vector3();
const SKIP_SHADOW = /interior|glass|details|livery|trim|caliper/i;
/**
 * light on the road from two lamps: two cones that start at the lamps and spread out with distance, each fading
 * (and thinning) as it goes. The quad is 14 m wide and 38 m long; the car end is the top row of the texture (the quad's rear edge).
 */
function poolTexture() {
  const W = 256, H = 512, WORLD_W = 14, WORLD_L = 38, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let j = 0; j < H; j++) {
    const s = j / (H - 1);                                                // 0 at the car (the top row sits at the rear edge of the quad), 1 at the far end of the beam
    const dist = s * WORLD_L;
    const fade = Math.pow(1 - s, 1.25) * smooth(0, 0.035, s);              // nothing right under the bumper, then fading with distance
    const hw = 0.55 + 0.19 * dist;                                        // cone half-width (m): ~7.7 m at 38 m, a spread of about 10 degrees
    const thin = 1 / (1 + 0.045 * dist);                                  // the light spreads over more road, so it gets dimmer
    for (let i = 0; i < W; i++) {
      const x = (i / (W - 1) - 0.5) * WORLD_W;
      let v = 0;
      for (const side of [-1, 1]) {
        const cx = side * (0.62 + 0.035 * dist);                          // each cone drifts a little outward from its lamp
        const u = (x - cx) / hw;
        v += Math.exp(-u * u * 1.7) * (1 - 0.55 * Math.min(1, Math.abs(u)));   // soft edge, brighter along the axis
      }
      v = Math.min(1, v * 0.78 * fade * thin * 1.6);
      const k = (j * W + i) * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(255 * v);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.7)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- livery textures
function roundelTexture(num = '1') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111'; g.font = 'bold 72px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
