import * as THREE from 'three';

const MODES = ['Chase', 'Chase far', 'Hood', 'Bumper', 'Orbit', 'Trackside', 'Follow'];   // Follow: a far chase camera on whichever car you pick (V)

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera; this.mode = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.orbit = { yaw: 0.6, pitch: 0.35, dist: 9 };
    this.trackside = null;
    let drag = false, lx = 0, ly = 0;
    dom.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
    addEventListener('mouseup', () => (drag = false));
    addEventListener('mousemove', (e) => {
      if (!drag || MODES[this.mode] !== 'Orbit') return;
      this.orbit.yaw -= (e.clientX - lx) * 0.006; this.orbit.pitch = Math.max(-0.1, Math.min(1.4, this.orbit.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    dom.addEventListener('wheel', (e) => { if (MODES[this.mode] === 'Orbit') this.orbit.dist = Math.max(3, Math.min(40, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
  }
  get modeName() { return MODES[this.mode]; }
  setMode(name) { const i = MODES.indexOf(name); if (i >= 0) { this.mode = i; this.snap = true; this.trackside = null; } }
  next() { this.mode = (this.mode + 1) % MODES.length; this.snap = true; this.trackside = null; }

  /** Keep the chase camera on the car's side of any wall between them (unless it's above the wall). */
  _avoidWalls(car) {
    const world = this.world; if (!world?.wallsNear) return;
    const dx = this.pos.x - car.x, dz = this.pos.z - car.z;
    let tMin = 1;
    for (const w of world.wallsNear(car.x, car.z, Math.hypot(dx, dz) + 2, this._wl || (this._wl = []))) {
      if (this.pos.y > w.top + 0.4) continue;
      // 2D segment intersection: car->camera vs wall centreline, offset by half thickness
      const den = dx * w.dz - dz * w.dx; if (Math.abs(den) < 1e-9) continue;
      const ax = w.ax - car.x, az = w.az - car.z;
      const t = (ax * w.dz - az * w.dx) / den, u = (ax * dz - az * dx) / den;
      if (t > 0 && t < tMin && u >= 0 && u <= 1) tMin = t;
    }
    if (tMin < 1) {
      const len = Math.hypot(dx, dz), k = Math.max(0.15, tMin - 0.6 / Math.max(len, 1e-3));
      this.pos.x = car.x + dx * k; this.pos.z = car.z + dz * k;
      this.pos.y += (1 - k) * 1.2; // rise a little so the view looks over the car, not into the wall
      this.camera.position.copy(this.pos);
    }
  }

  update(dt, vehicle, lookBack) {
    const b = vehicle.body, cam = this.camera;
    const q = new THREE.Quaternion(b.orientation.x, b.orientation.y, b.orientation.z, b.orientation.w);
    const carPos = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const vel = new THREE.Vector3(b.velocity.x, b.velocity.y, b.velocity.z);
    const L = vehicle.config.body.dimensions.length, H = vehicle.config.body.dimensions.height;
    const mode = MODES[this.mode];
    let fov = 60;

    if (mode === 'Chase' || mode === 'Chase far' || mode === 'Follow') {
      // heading follows the car's nose, blended toward travel direction when sliding fast
      const flatF = fwd.clone().setY(0).normalize();
      const vFlat = vel.clone().setY(0);
      let target = flatF;
      if (vFlat.length() > 3 && vFlat.dot(flatF) > 0) target = flatF.clone().lerp(vFlat.normalize(), 0.35).normalize();
      if (lookBack) target = target.clone().negate();
      if (this.snap) { this.heading.copy(target); }
      this.heading.lerp(target, 1 - Math.exp(-dt * 5)).normalize();
      const dist = (mode === 'Chase' ? 2.2 : 3.4) * L * 0.5 + 2.5;
      const height = mode === 'Chase' ? H + 0.9 : H + 2.0;
      const want = carPos.clone().addScaledVector(this.heading, -dist).add(new THREE.Vector3(0, height, 0));
      if (this.snap) this.pos.copy(want);
      this.pos.lerp(want, 1 - Math.exp(-dt * 12));
      this.pos.y = Math.max(this.pos.y, (this.groundAt?.(this.pos.x, this.pos.z) ?? -1e9) + 0.6);
      this._avoidWalls(carPos);
      cam.position.copy(this.pos);
      this.look.copy(carPos).add(new THREE.Vector3(0, H * 0.55, 0)).addScaledVector(this.heading, 2.5);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      fov = 62 + Math.min(14, vel.length() * 0.15);
    } else if (mode === 'Hood' || mode === 'Bumper') {
      const y0 = vehicle.hullBox.y0;
      const hood = vehicle.config.view?.hood; // optional per-car cockpit camera [y, z]
      const local = mode === 'Hood'
        ? (hood ? new THREE.Vector3(0, hood[0], hood[1]) : new THREE.Vector3(0, y0 + H * 0.85, L * 0.1))
        : new THREE.Vector3(0, y0 + 0.35, L / 2 + 0.1);
      cam.position.copy(local.applyQuaternion(q).add(carPos));
      const dir = lookBack ? fwd.clone().negate() : fwd;
      cam.up.copy(up);
      cam.lookAt(cam.position.clone().add(dir).addScaledVector(up, -0.02));
      fov = 75;
    } else if (mode === 'Orbit') {
      const o = this.orbit;
      cam.position.set(carPos.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, carPos.y + Math.sin(o.pitch) * o.dist, carPos.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
      cam.up.set(0, 1, 0); cam.lookAt(carPos);
      fov = 55;
    } else if (mode === 'Trackside') {
      if (!this.trackside || this.trackside.distanceTo(carPos) > 90) {
        const ahead = carPos.clone().addScaledVector(vel.lengthSq() > 4 ? vel.clone().normalize() : fwd, 45);
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(22);
        this.trackside = ahead.add(side);
        this.trackside.y = Math.max((this.groundAt?.(this.trackside.x, this.trackside.z) ?? carPos.y) + 3, carPos.y + 1);
      }
      cam.position.copy(this.trackside); cam.up.set(0, 1, 0); cam.lookAt(carPos);
      fov = Math.max(12, Math.min(60, 1400 / Math.max(10, this.trackside.distanceTo(carPos))));
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
    this.snap = false;
  }
}
