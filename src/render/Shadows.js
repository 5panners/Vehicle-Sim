import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

/**
 * Cascaded shadow maps for the sun / moon: three 2048 maps fitted to the camera's view, so the shadows next to the car are
 * crisp while the ones further out still reach the shadow distance. Replaces the single fixed-size map the sun used to carry.
 *
 * The scene's original `sun` light stays the owner of colour / intensity (the time of day writes to it); each frame its values are
 * copied to the three cascade lights and the original is switched off, so nothing is lit twice.
 */
export class Shadows {
  constructor(app) {
    this.app = app;
    this.enabled = true;
    this.distance = 45;
    this.size = 2048;
    this.csm = new CSM({
      camera: app.camera, parent: app.scene, cascades: 3, mode: 'custom', maxFar: 60, shadowMapSize: this.size, shadowBias: -0.0002,
      lightDirection: new THREE.Vector3(-0.5, -0.8, -0.3).normalize(), lightIntensity: 2.4, lightNear: 1, lightFar: 1500, lightMargin: 150,
      customSplitsCallback: (n, near, far, target) => { const a = Math.min(18, Math.max(7, far * 0.14)); target.push(a / far, Math.max(a * 2.6, far * 0.42) / far, 1); },
    });
    for (const l of this.csm.lights) { l.shadow.normalBias = 0.03; l.shadow.bias = -0.0002; }
    this._seen = new WeakSet();
    this._frame = 0;
    app.sun.castShadow = false;
  }

  /** how far from the camera shadows are drawn (0 turns them off) */
  setDistance(d) {
    this.distance = d; this.enabled = d > 0;
    for (const l of this.csm.lights) l.castShadow = this.enabled;
    if (!this.enabled) return;
    this.csm.maxFar = Math.max(30, d * 1.35);
    const size = d > 90 ? 4096 : 2048;
    if (size !== this.size) { this.size = size; for (const l of this.csm.lights) { l.shadow.mapSize.set(size, size); l.shadow.map?.dispose(); l.shadow.map = null; } this.csm.shadowMapSize = size; }
    this.csm.updateFrustums();
  }

  resize() { this.csm.updateFrustums(); }

  /** give every lit material the cascade shader (once), keeping any shader tweak it already had (tree fade ...) */
  _setup(m) {
    if (!m || this._seen.has(m) || !(m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial)) return;
    this._seen.add(m);
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    this.csm.setupMaterial(m);
    const mine = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => { if (prev) prev.call(m, shader, renderer); mine.call(m, shader, renderer); };
    const base = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') && prevKey ? prevKey.call(m) : (prev ? prev.toString() : '');
    m.customProgramCacheKey = () => `${base}|csm`;
    m.needsUpdate = true;
  }

  _scan() {
    this.app.scene.traverse((o) => {
      const mm = o.material; if (!mm) return;
      if (Array.isArray(mm)) mm.forEach((x) => this._setup(x)); else this._setup(mm);
    });
  }

  /** call once per frame after the camera and the sun have been placed */
  update() {
    const app = this.app, sun = app.sun;
    if (this._frame++ % 20 === 0) this._scan();                // pick up cars, scenery and clones created since the last pass
    const d = app.gfx.sunDir;
    this.csm.lightDirection.set(-d.x, -d.y, -d.z).normalize();
    for (const l of this.csm.lights) { l.intensity = sun.intensity; l.color.copy(sun.color); }
    sun.intensity = 0; sun.castShadow = false;
    this.csm.update();
  }
}
