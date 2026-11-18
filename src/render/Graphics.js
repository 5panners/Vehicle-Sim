import * as THREE from 'three';
import { smoothstep } from '../physics/math.js';
import { lighting } from './lighting.js';

/**
 * Graphics options: shadow distance, render scale, time of day and how fast time flows.
 *
 * Time of day drives the sun (or the moon at night), the sky and fog colours and the light levels.
 * The map's own sky settings are taken as its noon look; dawn, dusk and night are derived from them.
 * Settings persist in localStorage.
 */
const KEY = 'vehicleSim.graphics';
export const FLOW_OPTIONS = [[0, 'Frozen'], [1, 'Real time'], [10, '10×'], [60, '60× (a day in 24 min)'], [300, '300× (a day in 5 min)'], [1200, '1200× (a day in 72 s)']];
const DEFAULTS = { shadowDistance: 45, renderScale: 1, hour: 11, flow: 0, sunIntensity: 1, sunColor: '#fff5e0', moonIntensity: 1, moonColor: '#8ca8ff' };
const NIGHT_TOP = new THREE.Color(0.012, 0.02, 0.06), NIGHT_BOTTOM = new THREE.Color(0.03, 0.04, 0.09);
const DUSK = new THREE.Color(0.95, 0.45, 0.2);
const LOW_TINT = new THREE.Color(1.0, 0.6, 0.38);   // a low sun is warmer than the colour picked for noon

const SKY_R = 3500;

/** radial sprite texture: a bright disc (radius = disc, 0..1 of the half-width) inside a soft glow */
function discTexture(disc, glow, craters = false) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), m = 128;
  if (glow > 0) {
    const gr = g.createRadialGradient(m, m, m * disc * 0.9, m, m, m);
    gr.addColorStop(0, `rgba(255,255,255,${glow})`); gr.addColorStop(0.25, `rgba(255,255,255,${glow * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(m, m, m * disc, 0, Math.PI * 2); g.fill();
  if (craters) {                                            // pale grey maria and craters on the moon
    g.save(); g.beginPath(); g.arc(m, m, m * disc, 0, Math.PI * 2); g.clip();
    for (const [x, y, r, a] of [[-0.3, -0.25, 0.32, 0.22], [0.25, -0.1, 0.26, 0.18], [-0.05, 0.3, 0.3, 0.2], [0.35, 0.32, 0.12, 0.25], [-0.45, 0.15, 0.1, 0.25], [0.05, -0.5, 0.1, 0.2]]) {
      g.fillStyle = `rgba(120,130,150,${a})`; g.beginPath(); g.arc(m + x * m * disc, m + y * m * disc, r * m * disc, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export class Graphics {
  constructor(app) {
    this.app = app;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
    this.s = { ...DEFAULTS, ...saved };
    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.3);
    this._toSun = new THREE.Vector3(); this._light = new THREE.Vector3();        // scratch objects: update() runs every frame and must not allocate
    this._c1 = new THREE.Color(); this._c2 = new THREE.Color(); this._c3 = new THREE.Color(); this._white = new THREE.Color(1, 1, 1);
    this._saveAcc = 0;
    const sky = app.world.map.sky || {};
    this.day = { top: new THREE.Color(sky.top ?? 0x3a7bd5), bottom: new THREE.Color(sky.bottom ?? 0xdfe9f3), sun: sky.sun ?? 2.4, hemi: sky.hemi ?? 1.1, exposure: 1.0 };
    this._skyBodies();
    this.applyRender(); this.applyShadows(); this.update(0);
  }

  /** the sun and moon discs and a field of stars, drawn on a sphere that follows the camera */
  _skyBodies() {
    const mk = (tex, size) => {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
      const sp = new THREE.Sprite(m); sp.scale.set(size, size, 1); sp.renderOrder = -1; sp.frustumCulled = false; this.app.scene.add(sp); return sp;
    };
    this.sunSprite = mk(discTexture(0.13, 0.9), 1500);
    this.moonSprite = mk(discTexture(0.42, 0.25, true), 520);
    const n = 700, pos = new Float32Array(n * 3);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd(), v = rnd() * 0.97, th = u * Math.PI * 2, y = v, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * SKY_R, y * SKY_R, Math.sin(th) * r * SKY_R], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -2; this.app.scene.add(this.stars);
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
    lighting.dark = smoothstep(0.40, 0.06, sn);                              // headlights come on as the light starts to go
    // sun by day, moon by night: one directional light, faded to nothing as it crosses the horizon
    const toSun = this._toSun.set(Math.cos(a) * 0.85, sn, 0.45).normalize();
    const light = sn >= 0 ? toSun : this._light.set(-toSun.x, -toSun.y, toSun.z);
    this.sunDir.copy(light);
    const base = app.baseLight;
    const sunI = sn >= 0 ? this.day.sun * s.sunIntensity * smoothstep(0, 0.25, sn) : this.day.sun * 0.14 * s.moonIntensity * smoothstep(0, 0.25, -sn);
    base.sun = sunI;
    base.hemi = this.day.hemi * (0.17 + 0.83 * f);   // never fully black: you can still drive at night
    base.exposure = this.day.exposure * (1 + 0.25 * (1 - f));
    const lowSun = 1 - smoothstep(0.1, 0.45, sn);
    if (sn >= 0) { const noon = this._c1.set(s.sunColor); app.sun.color.copy(noon).lerp(this._c2.copy(noon).multiply(LOW_TINT), lowSun); }
    else app.sun.color.set(s.moonColor);
    // sky and fog
    const dusk = Math.exp(-Math.pow(sn / 0.2, 2));
    const top = this._c2.copy(NIGHT_TOP).lerp(this.day.top, f);
    const bottom = this._c3.copy(NIGHT_BOTTOM).lerp(this.day.bottom, f).lerp(DUSK, 0.55 * dusk);
    const u = app.worldView?.sky?.material?.uniforms;
    if (u) { u.top.value.copy(top); u.bottom.value.copy(bottom); }
    if (app.scene.fog) app.scene.fog.color.copy(bottom).multiplyScalar(0.92);
    app.renderer.toneMappingExposure = base.exposure;
    // the visible discs: placed far out along the light direction, following the camera
    const cp = app.camera.position, up = sn >= 0;
    this.sunSprite.position.set(cp.x + toSun.x * SKY_R, cp.y + toSun.y * SKY_R, cp.z + toSun.z * SKY_R);
    this.sunSprite.material.opacity = smoothstep(-0.07, 0.03, sn) * Math.min(1, s.sunIntensity * 1.4);
    this.sunSprite.material.color.copy(app.sun.color).lerp(this._white, up ? 0.35 * (1 - lowSun) : 0);
    this.sunSprite.scale.setScalar(1500 * (1 + 0.5 * lowSun));              // a low sun looks bigger
    this.moonSprite.position.set(cp.x - toSun.x * SKY_R, cp.y - toSun.y * SKY_R, cp.z + toSun.z * SKY_R);
    this.moonSprite.material.opacity = smoothstep(0.0, -0.1, sn) * Math.min(1, 0.5 + s.moonIntensity * 0.5);
    this.moonSprite.material.color.set(s.moonColor).lerp(this._white, 0.55);
    this.stars.position.copy(cp);
    this.stars.material.opacity = smoothstep(0.05, -0.2, sn) * 0.9;
  }
}
