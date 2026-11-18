import * as THREE from 'three';
import { smoothstep } from '../physics/math.js';

/**
 * Graphics options: shadow distance, render scale, time of day and how fast time flows.
 *
 * Time of day drives the sun (or the moon at night), the sky and fog colours and the light levels.
 * The map's own sky settings are taken as its noon look; dawn, dusk and night are derived from them.
 * Settings persist in localStorage.
 */
const KEY = 'vehicleSim.graphics';
export const FLOW_OPTIONS = [[0, 'Frozen'], [1, 'Real time'], [10, '10×'], [60, '60× (a day in 24 min)'], [300, '300× (a day in 5 min)'], [1200, '1200× (a day in 72 s)']];
const DEFAULTS = { shadowDistance: 45, renderScale: 1, hour: 11, flow: 0 };
const NIGHT_TOP = new THREE.Color(0.012, 0.02, 0.06), NIGHT_BOTTOM = new THREE.Color(0.03, 0.04, 0.09);
const DUSK = new THREE.Color(0.95, 0.45, 0.2);
const SUN_WHITE = new THREE.Color(1.0, 0.96, 0.88), SUN_LOW = new THREE.Color(1.0, 0.58, 0.32), MOON = new THREE.Color(0.55, 0.66, 1.0);

export class Graphics {
  constructor(app) {
    this.app = app;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
    this.s = { ...DEFAULTS, ...saved };
    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.3);
    this._saveAcc = 0;
    const sky = app.world.map.sky || {};
    this.day = { top: new THREE.Color(sky.top ?? 0x3a7bd5), bottom: new THREE.Color(sky.bottom ?? 0xdfe9f3), sun: sky.sun ?? 2.4, hemi: sky.hemi ?? 1.1, exposure: 1.0 };
    this.applyRender(); this.applyShadows(); this.update(0);
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* ignore */ } }

  set(key, value) {
    this.s[key] = value;
    if (key === 'renderScale') this.applyRender();
    if (key === 'shadowDistance') this.applyShadows();
    if (key === 'hour') this.update(0);
    this.save();
  }

  reset() { this.s = { ...DEFAULTS }; this.applyRender(); this.applyShadows(); this.update(0); this.save(); }

  /** resolution multiplier on top of the screen's pixel ratio (below 1 trades sharpness for speed) */
  applyRender() {
    const r = this.app.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2) * this.s.renderScale);
    r.setSize(innerWidth, innerHeight);
  }

  /** shadow distance = half-width of the area around the car that gets shadows (0 turns them off) */
  applyShadows() {
    const sun = this.app.sun, d = this.s.shadowDistance;
    sun.castShadow = d > 0;
    if (d <= 0) return;
    const cam = sun.shadow.camera;
    Object.assign(cam, { left: -d, right: d, top: d, bottom: -d, far: Math.max(400, d * 6) });
    cam.updateProjectionMatrix();
    const size = d > 90 ? 4096 : 2048;                       // keep the shadows crisp when they cover more ground
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    sun.shadow.bias = -0.0004 * Math.max(1, d / 45); sun.shadow.normalBias = 0.03 * Math.max(1, d / 45);
  }

  get hourText() {
    const h = ((this.s.hour % 24) + 24) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /** advance the clock and set the sun, sky, fog and light levels */
  update(dt) {
    const s = this.s, app = this.app;
    if (s.flow > 0 && dt > 0) {
      s.hour = (s.hour + (dt * s.flow) / 3600) % 24;
      this._saveAcc += dt; if (this._saveAcc > 5) { this._saveAcc = 0; this.save(); }
    }
    const a = ((s.hour - 6) / 12) * Math.PI, sn = Math.sin(a);                 // 06:00 sunrise, 12:00 noon, 18:00 sunset
    const f = smoothstep(-0.12, 0.35, sn);                                    // how 'day' the sky is
    // sun by day, moon by night: one directional light, faded to nothing as it crosses the horizon
    const toSun = new THREE.Vector3(Math.cos(a) * 0.85, sn, 0.45).normalize();
    const light = sn >= 0 ? toSun : new THREE.Vector3(-toSun.x, -toSun.y, toSun.z);
    this.sunDir.copy(light);
    const base = app.baseLight;
    const sunI = sn >= 0 ? this.day.sun * smoothstep(0, 0.25, sn) : this.day.sun * 0.14 * smoothstep(0, 0.25, -sn);
    base.sun = sunI;
    base.hemi = this.day.hemi * (0.17 + 0.83 * f);   // never fully black: you can still drive at night
    base.exposure = this.day.exposure * (1 + 0.25 * (1 - f));
    const lowSun = 1 - smoothstep(0.1, 0.45, sn);
    app.sun.color.copy(sn >= 0 ? SUN_WHITE.clone().lerp(SUN_LOW, lowSun) : MOON);
    // sky and fog
    const dusk = Math.exp(-Math.pow(sn / 0.2, 2));
    const top = NIGHT_TOP.clone().lerp(this.day.top, f);
    const bottom = NIGHT_BOTTOM.clone().lerp(this.day.bottom, f).lerp(DUSK, 0.55 * dusk);
    const u = app.worldView?.sky?.material?.uniforms;
    if (u) { u.top.value.copy(top); u.bottom.value.copy(bottom); }
    if (app.scene.fog) app.scene.fog.color.copy(bottom).multiplyScalar(0.92);
    app.renderer.toneMappingExposure = base.exposure;
  }
}
