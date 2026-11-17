import { Vec3, Quat } from './math.js';

const _t = new Vec3(), _r = new Vec3(), _a = new Vec3(), _b = new Vec3();

/**
 * 6-DOF rigid body. Position is the centre of mass. Angular velocity is
 * stored in world space; the inertia tensor is diagonal in body space.
 */
export class RigidBody {
  constructor(mass, inertia /* Vec3 diag, body space */) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.inertia = inertia.clone();
    this.invInertia = new Vec3(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
    this.position = new Vec3();
    this.velocity = new Vec3();
    this.orientation = new Quat();
    this.angularVelocity = new Vec3();
    this.force = new Vec3();
    this.torque = new Vec3();
  }

  localToWorld(p, out) { this.orientation.rotate(p, out); return out.add(this.position); }
  localDir(d, out) { return this.orientation.rotate(d, out); }
  worldToLocalDir(d, out) { return this.orientation.rotateInv(d, out); }

  pointVelocity(worldPoint, out) {
    _r.subVectors(worldPoint, this.position);
    out.crossVectors(this.angularVelocity, _r);
    return out.add(this.velocity);
  }

  addForce(f) { this.force.add(f); }
  addForceAtPoint(f, worldPoint) {
    this.force.add(f);
    _r.subVectors(worldPoint, this.position);
    this.torque.add(_t.crossVectors(_r, f));
  }
  addTorque(t) { this.torque.add(t); }

  // world-space inverse inertia applied to vector v
  applyInvInertiaWorld(v, out) {
    this.orientation.rotateInv(v, out);
    out.x *= this.invInertia.x; out.y *= this.invInertia.y; out.z *= this.invInertia.z;
    return this.orientation.rotate(out, out);
  }

  applyImpulse(j, worldPoint) {
    this.velocity.addScaled(j, this.invMass);
    _r.subVectors(worldPoint, this.position);
    _t.crossVectors(_r, j);
    this.applyInvInertiaWorld(_t, _a);
    this.angularVelocity.add(_a);
  }

  // effective inverse mass of the body at a point along a direction
  invMassAlong(worldPoint, dir) {
    _r.subVectors(worldPoint, this.position);
    _t.crossVectors(_r, dir);
    this.applyInvInertiaWorld(_t, _a);
    _b.crossVectors(_a, _r);
    return this.invMass + _b.dot(dir);
  }

  integrate(dt) {
    // linear
    this.velocity.addScaled(this.force, this.invMass * dt);
    this.position.addScaled(this.velocity, dt);

    // angular in body space, including gyroscopic term  w x Iw
    const q = this.orientation;
    q.rotateInv(this.torque, _t);
    q.rotateInv(this.angularVelocity, _a);
    const I = this.inertia, iI = this.invInertia;
    _b.set(_a.x * I.x, _a.y * I.y, _a.z * I.z);
    _r.crossVectors(_a, _b);
    _a.x += (_t.x - _r.x) * iI.x * dt;
    _a.y += (_t.y - _r.y) * iI.y * dt;
    _a.z += (_t.z - _r.z) * iI.z * dt;
    q.rotate(_a, this.angularVelocity);
    q.integrate(this.angularVelocity, dt);

    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}
