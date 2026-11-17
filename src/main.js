import * as THREE from 'three';
import { World } from './world/World.js';
import { MAPS, DEFAULT_MAP } from './world/maps/index.js';
import { LapTimer } from './game/LapTimer.js';
import { BotDriver, BOT_SKILLS, collideCars } from './game/BotDriver.js';
import { Vehicle } from './physics/Vehicle.js';
import { Vec3 } from './physics/math.js';
import { PRESETS } from './vehicles/presets.js';
import { WorldView } from './render/WorldView.js';
import { CarView } from './render/CarView.js';
import { Effects } from './render/Effects.js';
import { CameraRig } from './render/CameraRig.js';
import { InputManager } from './input/InputManager.js';
import { ControllerSetup } from './ui/ControllerSetup.js';
import { HUD } from './ui/HUD.js';
import { TuningPanel } from './ui/TuningPanel.js';
import { VehicleAudio } from './audio/VehicleAudio.js';

const PHYSICS_HZ = 600;          // fixed physics rate; 600 Hz keeps stiff tyres/suspension stable
const DT = 1 / PHYSICS_HZ;
const MAX_STEPS_PER_FRAME = 60;

class App {
  constructor() {
    // map: ?map=<id> in the URL, else the last one used, else the default
    let saved = null; try { saved = localStorage.getItem('vehicleSim.map'); } catch { /* storage unavailable */ }
    const want = new URLSearchParams(location.search).get('map') || saved || DEFAULT_MAP;
    this.mapId = MAPS[want] ? want : DEFAULT_MAP;
    try { localStorage.setItem('vehicleSim.map', this.mapId); } catch { /* ignore */ }
    const status = document.getElementById('loadStatus');
    status.textContent = `Building ${MAPS[this.mapId].name}…`;
    // plain timer (not rAF): background tabs never fire animation frames, which would stall loading
    setTimeout(() => this.init(), 60);
  }

  init() {
    // ---- renderer / scene
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    document.getElementById('app').append(renderer.domElement);
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xdfe9f3, 250, 1600);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
    this.hemi = new THREE.HemisphereLight(0xe3f0ff, 0x4a5a30, 1.1); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

    // ---- simulation
    this.world = new World(MAPS[this.mapId]);
    const sky = this.world.map.sky;
    if (sky) { scene.fog.color.set(sky.fog); this.sun.intensity = sky.sun; this.hemi.intensity = sky.hemi; }
    this.lapTimer = new LapTimer(this.world);
    this.maps = MAPS;
    new WorldView(this.world, scene);
    this.presetIndex = 0;
    this.vehicle = new Vehicle(structuredClone(PRESETS[0]), this.world);
    this.carView = new CarView(scene);
    this.carView.build(this.vehicle);
    this.effects = new Effects(scene);
    this.rig = new CameraRig(this.camera, renderer.domElement);
    this.rig.groundAt = (x, z) => this.world.heightAt(x, z);
    this.rig.world = this.world;

    // ---- io
    this.input = new InputManager();
    this.hud = new HUD(document.getElementById('hud'));
    this.hud.buildMap(this.world, this.world.map.minimapZones || {});
    this.hud.mapName = this.world.map.name;
    this.setup = new ControllerSetup(this.input, document.getElementById('setup'));
    this.setup.onSettingsChanged = () => this.applySteeringMode();
    this.tuning = new TuningPanel(document.getElementById('tuning'), this);
    this.audio = new VehicleAudio();
    this.applySteeringMode();

    this.spawnNames = Object.keys(this.world.spawnPoints()).filter((k) => !k.startsWith('_'));
    this.spawnIndex = 0;
    this.spawn(this.spawnNames[0]);
    this._keys();

    document.getElementById('loading').classList.add('ready');
    document.getElementById('loadStatus').textContent = 'Click, press a key or a controller button to start';
    this.started = false;
    const start = () => {
      if (this.started) return;
      this.started = true; this.audio.start();
      document.getElementById('loading').remove();
      if (!this.input.padConnected) this.hud.showToast('Tip: connect a controller and press any button — Esc/Start for calibration', 4000);
    };
    addEventListener('pointerdown', start); addEventListener('keydown', start);
    this._start = start;

    this.acc = 0; this.slowmo = false; this.last = performance.now();
    this.prevImpact = 0;
    renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------------ vehicle mgmt
  applySteeringMode() {
    const g = this.input.data.global;
    this.vehicle.directSteer = g.steeringMode === 'wheel';
    this.vehicle.steerSensitivity = g.steerSensitivity;
  }

  applyConfig(cfg) {
    const assists = this.vehicle.assists;
    this.vehicle.setConfig(cfg);
    this.vehicle.assists = assists;
    this.applySteeringMode();
  }

  loadPreset(i) {
    this.presetIndex = i; this.torqueScale = 1;
    const pos = this.vehicle.body.position.clone(), yaw = this.currentYaw();
    this.vehicle = new Vehicle(structuredClone(PRESETS[i]), this.world);
    this.applySteeringMode();
    this.carView.build(this.vehicle);
    this.placeCar(pos.x, pos.z, yaw);
    this.hud.showToast(PRESETS[i].name);
    if (this.tuning.isOpen) this.tuning.render(); // keep the panel in sync when switching cars
    if (this.bot) this.addBot();                   // the opponent always drives the same car as you
  }

  // ------------------------------------------------------------------ practice opponent
  get botSkill() { let i = 2; try { i = +(localStorage.getItem('vehicleSim.botSkill') ?? 2); } catch { /* ignore */ } return BOT_SKILLS[i] ? i : 2; }
  set botSkill(i) { try { localStorage.setItem('vehicleSim.botSkill', String(i)); } catch { /* ignore */ } }

  /** an AI car in the same model as yours, placed just ahead on the other side of the track */
  addBot() {
    if (!this.world.track) { this.hud.showToast('No circuit on this map for an opponent'); return; }
    this.removeBot();
    const cfg = structuredClone(PRESETS[this.presetIndex]);
    const vehicle = new Vehicle(cfg, this.world), skill = BOT_SKILLS[this.botSkill];
    const driver = new BotDriver(this.world, vehicle, skill, { mapId: this.mapId });
    const p = this.vehicle.body.position, i = driver.nearestIndex(p.x, p.z), T = this.world.track;
    const onTrack = Math.abs(driver.lateral(p, i)) < T[i].w / 2 + 3;
    if (onTrack) {
      const j = (i + Math.round(10 / driver.step)) % T.length, pl = driver.lateral(p, i);
      driver.placeAt(j, (pl > 0 ? pl - 4 : pl + 4) - driver.d[j]);
    } else driver.placeAt(T.length - Math.round(30 / driver.step));   // just before the start line
    const view = new CarView(this.scene); view.tint = 0x1e88e5; view.build(vehicle);
    this.bot = { vehicle, driver, view, lap: new LapTimer(this.world), skill };
    this.hud.showToast(`Opponent: ${skill.name} (K changes skill)`, 2200);
  }

  removeBot() {
    if (!this.bot) return;
    this.bot.view.group.removeFromParent();
    this.bot = null; this.hud.mapOthers = [];
  }


  currentYaw() {
    const f = this.vehicle.body.localDir(new Vec3(0, 0, 1), new Vec3());
    return Math.atan2(f.x, f.z);
  }

  placeCar(x, z, yaw) {
    const cfg = this.vehicle.config;
    // highest ground under the footprint so we never spawn inside a ramp
    let h = -Infinity;
    for (const dx of [-2, 0, 2]) for (const dz of [-2.5, 0, 2.5]) h = Math.max(h, this.world.heightAt(x + dx, z + dz));
    this.vehicle.reset(new Vec3(x, h + cfg.body.cgHeight + 0.25, z), yaw);
    this.lapTimer?.reset();
    this.effects.last = [null, null, null, null];
    this.rig.snap = true;
  }

  spawn(name) {
    this.hud?.resetDrift();
    const sp = this.world.spawnPoints()[name];
    this.placeCar(sp.x, sp.z, sp.yaw);
    this.hud?.showToast(`Spawn: ${name}`);
  }

  /** maps are built once at load; switching reloads the page with ?map= */
  switchMap(id) {
    if (!MAPS[id] || id === this.mapId) return;
    try { localStorage.setItem('vehicleSim.map', id); } catch { /* ignore */ }
    const u = new URL(location.href); u.searchParams.set('map', id); location.href = u.toString();
  }

  // ------------------------------------------------------------------ keys
  _keys() {
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (this.setup.isOpen) return;
      if (e.code === 'Tab') { e.preventDefault(); this.tuning.toggle(); }
      else if (e.code === 'KeyF') { this.spawnIndex = (this.spawnIndex + 1) % this.spawnNames.length; this.spawn(this.spawnNames[this.spawnIndex]); }
      else if (/^Digit[1-9]$/.test(e.code)) { const i = +e.code.slice(5) - 1; if (this.spawnNames[i]) { this.spawnIndex = i; this.spawn(this.spawnNames[i]); } }
      else if (e.code === 'KeyU') this.hud.showToast(this.hud.toggleUnits() === 'mph' ? 'Speed in mph' : 'Speed in km/h', 900);
      else if (e.code === 'KeyM') this.hud.showToast(this.audio.toggleMute() ? 'Sound off' : 'Sound on');
      else if (e.code === 'KeyP') { this.slowmo = !this.slowmo; this.hud.showToast(this.slowmo ? 'Slow motion ×0.25' : 'Real time'); }
      else if (e.code === 'KeyH') this.hud.toggleHelp();
      else if (e.code === 'KeyL') { const ids = Object.keys(MAPS); this.switchMap(ids[(ids.indexOf(this.mapId) + 1) % ids.length]); }
      else if (e.code === 'KeyO') { if (this.bot) { this.removeBot(); this.hud.showToast('Opponent off'); } else this.addBot(); }
      else if (e.code === 'KeyK') {
        this.botSkill = (this.botSkill + 1) % BOT_SKILLS.length; const s = BOT_SKILLS[this.botSkill];
        if (this.bot) { this.bot.driver.setSkill(s); this.bot.skill = s; }
        this.hud.showToast(`Opponent skill: ${s.name}`);
      }
      else if (e.code === 'KeyN') this.hud.showToast(this.hud.toggleMap() ? 'Track map on' : 'Track map off', 900);
      else if (e.code === 'KeyG') { this.vehicle.assists.autoGearbox = !this.vehicle.assists.autoGearbox; this.hud.showToast(this.vehicle.assists.autoGearbox ? 'Automatic gearbox' : 'Manual gearbox'); }
      else if (e.code === 'BracketRight') this.loadPreset((this.presetIndex + 1) % PRESETS.length);
      else if (e.code === 'BracketLeft') this.loadPreset((this.presetIndex + PRESETS.length - 1) % PRESETS.length);
    });
  }

  // ------------------------------------------------------------------ frame
  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const inp = this.input, v = this.vehicle;
    inp.update(dt);
    if (!this.started && Object.values(inp.pressed).some(Boolean)) this._start();

    // menu buttons
    if (inp.pressed.menu) { if (this.setup.isOpen) this.setup.close(); else this.setup.open(); }
    this.setup.update(dt);
    const paused = this.setup.isOpen || !this.started;
    if (!paused) {
      if (inp.pressed.camera) { this.rig.next(); this.hud.showToast(`Camera: ${this.rig.modeName}`, 900); }
      if (inp.pressed.telemetry) this.hud.toggleTelemetry();
      if (inp.pressed.reset) { this.placeCar(v.body.position.x, v.body.position.z, this.currentYaw()); this.hud.drift.combo = 0; this.hud.drift.active = false; }
      if (inp.pressed.shiftUp || inp.pressed.shiftDown) {
        if (v.assists.autoGearbox) { v.assists.autoGearbox = false; this.hud.showToast('Manual gearbox (G toggles)'); }
        inp.pressed.shiftUp ? v.shiftUp() : v.shiftDown();
      }
      const s = inp.state;
      v.setInput({ steer: s.steer, throttle: s.throttle, brake: s.brake, handbrake: s.handbrake, clutch: s.clutch });

      this.acc += dt * (this.slowmo ? 0.25 : 1);
      let n = 0;
      const bot = this.bot;
      let bump = 0;
      while (this.acc >= DT && n < MAX_STEPS_PER_FRAME) {
        v.step(DT);
        if (bot) { bot.driver.drive(DT, v); bot.vehicle.step(DT); bot.vehicle.wallContact = null; bump = Math.max(bump, collideCars(v, bot.vehicle)); }
        this.acc -= DT; n++;
      }
      if (bump > 1.5) { this.audio.thump(Math.min(1, bump / 12)); this.hud.drift.combo = 0; }
      if (bot) {
        if (bot.vehicle.body.position.y < -60) bot.driver.placeAt(bot.driver.idx);
        if (bot.lap.update(dt * (this.slowmo ? 0.25 : 1), bot.vehicle.body.position.x, bot.vehicle.body.position.z) === 'lap' && bot.lap.last.best) this.hud.showToast(`Opponent best lap ${LapTimer.fmt(bot.lap.last.time)}`, 2000);
      }
      if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
      if (v.body.position.y < -60) this.spawn(this.spawnNames[this.spawnIndex]);
      const lt = this.lapTimer, ev = lt.update(dt * (this.slowmo ? 0.25 : 1), v.body.position.x, v.body.position.z);
      if (ev === 'lap') this.hud.showToast(`Lap ${LapTimer.fmt(lt.last.time)}${lt.last.valid ? (lt.last.best ? ' · BEST' : '') : ' · invalid'}`, 3000);
      else if (ev === 'invalid') this.hud.showToast('Track limits — lap invalidated', 1500);
    }

    // ---- views
    this.carView.update(v, inp.state.brake);
    if (this.bot) { this.bot.view.update(this.bot.vehicle, this.bot.vehicle.input.brake); this._botHud(); }
    else this.hud.el.hBot.textContent = '';
    const wc = v.wallContact; // read before effects consume it
    if (!paused) this.effects.update(dt * (this.slowmo ? 0.25 : 1), v);
    if (wc) this.audio.scrape = Math.max(this.audio.scrape || 0, wc.scrape);
    this.rig.update(dt, v, inp.buttons.lookBack);
    const p = v.body.position;
    this.sun.position.set(p.x + 60, p.y + 120, p.z + 40); this.sun.target.position.set(p.x, p.y, p.z);
    this.hud.update(dt, v, inp, { physicsHz: PHYSICS_HZ, camera: this.rig.modeName, slowmo: this.slowmo, lap: this.lapTimer });
    if (!paused) {
      this.audio.update(v);
      // feedback
      const t = v.telemetry;
      if (t.impact > 0.4 && this.prevImpact <= 0.4) this.audio.thump(t.impact * 0.6);
      this.prevImpact = t.impact;
      let rough = 0;
      for (const w of v.wheels) if (w.contact && w.surface) rough = Math.max(rough, w.surface.bump * 30 * Math.min(1, v.speed / 20));
      const slip = Math.max(0, Math.min(1, (t.maxSlip || 0) - 0.85));
      const limiter = v.drivetrain.engine.limiterTimer > 0 ? 0.25 : 0;
      const scrape = wc ? Math.min(0.6, wc.scrape * 0.04) : 0;
      inp.rumble(Math.min(1, t.impact + limiter), Math.min(1, slip * 0.8 + rough + scrape + (v.absActive ? 0.35 : 0)));
    }
    v.wallContact = null; // consumed by effects, audio, rumble and HUD this frame
    this.renderer.render(this.scene, this.camera);
  }
}

/** opponent line under the lap timer: who's ahead, by how much, and the bot's laps */
App.prototype._botHud = function () {
  const b = this.bot, d = b.driver, M = d.M, p = this.vehicle.body.position;
  this._pIdx = this._pIdx === undefined || (p.x - d.T[this._pIdx].x) ** 2 + (p.z - d.T[this._pIdx].z) ** 2 > 900 ? d.nearestIndex(p.x, p.z) : d._track(p, this._pIdx);
  let ahead = (d.idx - this._pIdx + M) % M; if (ahead > M / 2) ahead -= M;
  const metres = ahead * d.step, secs = Math.abs(metres) / Math.max(8, (b.vehicle.speed + this.vehicle.speed) / 2);
  const where = Math.abs(metres) < 6 ? '<span>side by side</span>' : metres > 0 ? `<span class="ahead">${secs.toFixed(1)} s ahead</span>` : `<span class="behind">${secs.toFixed(1)} s behind</span>`;
  const lt = b.lap, f = LapTimer.fmt;
  this.hud.el.hBot.innerHTML = `<b>Opponent · ${b.skill.name}</b> ${where}<br>best ${lt.best === null ? '--:--.---' : f(lt.best)} · last ${lt.last ? f(lt.last.time) : '--:--.---'}`;
  this.hud.mapOthers = [{ x: b.vehicle.body.position.x, z: b.vehicle.body.position.z, color: '#1e88e5' }];
};

window.app = new App();
