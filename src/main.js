import * as THREE from 'three';
import { World } from './world/World.js';
import { MAPS, DEFAULT_MAP } from './world/maps/index.js';
import { LapTimer } from './game/LapTimer.js';
import { BOT_SKILLS } from './game/BotDriver.js';
import { StartLights } from './game/RaceStart.js';
import { Race } from './game/Race.js';
import { Menu } from './ui/Menu.js';
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
    if (sky) { scene.fog.color.set(sky.fog); this.sun.intensity = sky.sun; this.hemi.intensity = sky.hemi; if (sky.fogNear) scene.fog.near = sky.fogNear; if (sky.fogFar) scene.fog.far = sky.fogFar; }
    this.baseLight = { hemi: this.hemi.intensity, sun: this.sun.intensity, exposure: renderer.toneMappingExposure }; this.tunnelLight = 1;
    this.lapTimer = new LapTimer(this.world);
    this.maps = MAPS;
    this.worldView = new WorldView(this.world, scene);
    this.lights = new StartLights();
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
    this.menu = new Menu(this, document.getElementById('menu'));
    this.setup = new ControllerSetup(this.input, this.menu.controlsRoot);
    this.menu.setup = this.setup; this.setup.onClose = () => this.menu.close();
    this.setup.onSettingsChanged = () => this.applySteeringMode();
    this.tuning = new TuningPanel(document.getElementById('tuning'), this);
    this.audio = new VehicleAudio();
    this.applySteeringMode();

    this.spawnNames = Object.keys(this.world.spawnPoints()).filter((k) => !k.startsWith('_'));
    this.spawnIndex = 0;
    this.spawn(this.spawnNames[0]);
    this._keys();
    // a race set up on another track (the track change reloads the page) starts once you're in
    try { this.pendingRace = JSON.parse(localStorage.getItem('vehicleSim.pendingRace') || 'null'); localStorage.removeItem('vehicleSim.pendingRace'); } catch { this.pendingRace = null; }

    document.getElementById('loading').classList.add('ready');
    document.getElementById('loadStatus').textContent = 'Click, press a key or a controller button to start';
    this.started = false;
    const start = () => {
      if (this.started) return;
      this.started = true; this.audio.start();
      document.getElementById('loading').remove();
      if (this.pendingRace) { this.createRace(this.pendingRace); this.pendingRace = null; }
      else if (!this.input.padConnected) this.hud.showToast('Tip: Esc / Start opens the menu: create a race, controls and vehicles', 4000);
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
    if (this.race) this.createRace(this.race.settings);   // opponents always drive the same car as you
  }

  // ------------------------------------------------------------------ races
  get raceSettings() {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('vehicleSim.race') || '{}'); } catch { /* ignore */ }
    return { opponents: 3, skill: 2, laps: 5, slot: 4, ...saved };
  }
  set raceSettings(s) { try { localStorage.setItem('vehicleSim.race', JSON.stringify(s)); } catch { /* ignore */ } }

  /** a race against AI opponents in your car; a different track reloads the page and starts it there */
  createRace(settings) {
    const { map, ...rest } = settings;
    if (map && map !== this.mapId) {
      try { localStorage.setItem('vehicleSim.pendingRace', JSON.stringify(rest)); } catch { /* ignore */ }
      this.raceSettings = rest; this.switchMap(map); return;
    }
    if (!this.world.track) { this.hud.showToast('No circuit on this map for a race'); return; }
    this.endRace();
    if (rest.laps !== 0 || rest.opponents !== 1) this.raceSettings = rest;   // the O quick practice doesn't overwrite your race setup
    this.race = new Race(this, rest);
    this.race.start();
    const n = rest.opponents;
    this.hud.showToast(`${rest.laps ? `${rest.laps}-lap race` : 'Practice'} · ${n} opponent${n > 1 ? 's' : ''} (${BOT_SKILLS[rest.skill].name}) · you start P${Math.min(rest.slot, n + 1)}`, 2600);
  }

  endRace() {
    if (!this.race) return;
    this.race.dispose(); this.race = null; this.hud.mapOthers = [];
    this.lights.phase = 'idle'; this.lights.lit = 0; this.worldView.setStartLights(0); this.hud.setStartLights(0, false);
    this.hud.hideResults();
  }

  /** O: quick practice against one opponent on the grid, or end the current race */
  toggleQuickRace() {
    if (this.race) { this.endRace(); this.hud.showToast('Race ended'); return; }
    this.createRace({ opponents: 1, skill: this.raceSettings.skill, laps: 0, slot: 2 });
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
    if (this.race) {
      if (/grid/i.test(name)) { this.hud.hideResults(); this.race.start(); this.hud.showToast('Race restart: lights sequence', 1500); return; }
      this.race.botsToGrid();
    }
    this.lights.phase = 'idle'; this.lights.lit = 0;   // spawning anywhere else cancels a start sequence
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
      if (this.menu.isOpen) return;
      if (e.code === 'Tab') { e.preventDefault(); this.tuning.toggle(); }
      else if (e.code === 'KeyF') { this.spawnIndex = (this.spawnIndex + 1) % this.spawnNames.length; this.spawn(this.spawnNames[this.spawnIndex]); }
      else if (/^Digit[1-9]$/.test(e.code)) { const i = +e.code.slice(5) - 1; if (this.spawnNames[i]) { this.spawnIndex = i; this.spawn(this.spawnNames[i]); } }
      else if (e.code === 'KeyU') this.hud.showToast(this.hud.toggleUnits() === 'mph' ? 'Speed in mph' : 'Speed in km/h', 900);
      else if (e.code === 'KeyM') this.hud.showToast(this.audio.toggleMute() ? 'Sound off' : 'Sound on');
      else if (e.code === 'KeyP') { this.slowmo = !this.slowmo; this.hud.showToast(this.slowmo ? 'Slow motion ×0.25' : 'Real time'); }
      else if (e.code === 'KeyH') this.hud.toggleHelp();
      else if (e.code === 'KeyL') { const ids = Object.keys(MAPS); this.switchMap(ids[(ids.indexOf(this.mapId) + 1) % ids.length]); }
      else if (e.code === 'KeyO') this.toggleQuickRace();
      else if (e.code === 'KeyK') {
        const rs = this.raceSettings, i = (rs.skill + 1) % BOT_SKILLS.length;
        this.raceSettings = { ...rs, skill: i };
        this.race?.setSkill(i);
        this.hud.showToast(`Opponent skill: ${BOT_SKILLS[i].name}`);
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
    if (inp.pressed.menu) this.menu.toggle();
    this.menu.update(dt);
    const paused = this.menu.isOpen || !this.started;
    this.audio.setPaused(paused);
    if (!paused) {
      if (inp.pressed.camera) { this.rig.next(); this.hud.showToast(`Camera: ${this.rig.modeName}`, 900); }
      if (inp.pressed.telemetry) this.hud.toggleTelemetry();
      if (inp.pressed.reset) { this.placeCar(v.body.position.x, v.body.position.z, this.currentYaw()); this.hud.drift.combo = 0; this.hud.drift.active = false; }
      if (inp.pressed.shiftUp || inp.pressed.shiftDown) {
        if (v.assists.autoGearbox) { v.assists.autoGearbox = false; this.hud.showToast('Manual gearbox (G toggles)'); }
        inp.pressed.shiftUp ? v.shiftUp() : v.shiftDown();
      }
      const s = inp.state;
      const held = this.lights.held;   // on the grid: handbrake on (opens the clutch, so you can rev), car pinned
      v.setInput(held ? { steer: s.steer, throttle: s.throttle, brake: 0, handbrake: 1, clutch: 0 }
        : { steer: s.steer, throttle: s.throttle, brake: s.brake, handbrake: s.handbrake, clutch: s.clutch });

      this.acc += dt * (this.slowmo ? 0.25 : 1);
      let n = 0;
      const race = this.race;
      let bump = 0;
      while (this.acc >= DT && n < MAX_STEPS_PER_FRAME) {
        v.step(DT);
        if (race) bump = Math.max(bump, race.step(DT));
        if (held) { v.body.velocity.x = 0; v.body.velocity.z = 0; v.body.angularVelocity.y = 0; }
        this.acc -= DT; n++;
      }
      const lev = this.lights.update(dt * (this.slowmo ? 0.25 : 1));
      if (lev === 'out') this.hud.showToast('Lights out — go!', 1200);
      this.worldView.setStartLights(this.lights.lit);
      this.hud.setStartLights(this.lights.lit, this.lights.phase === 'lights' || (this.lights.phase === 'go' && this.lights.t < 1));
      if (bump > 1.5) { this.audio.thump(Math.min(1, bump / 12)); this.hud.drift.combo = 0; }
      if (race) this.audio.updateOthers(v, race.bots.map((b, i) => ({ key: b, vehicle: b.vehicle, index: i })));
      if (race) {
        for (const b of race.bots) if (b.vehicle.body.position.y < -60) b.driver.placeAt(b.driver.idx);
        for (const e of race.update(dt * (this.slowmo ? 0.25 : 1), lev)) {
          if (e.type === 'finish' && !e.car.isPlayer && e.place === 1) this.hud.showToast(`${e.car.name} wins!`, 2000);
          if (e.type === 'over') this.hud.showResults(race.resultsHtml(), [
            ['Race again', () => { this.hud.hideResults(); race.start(); }],
            ['Menu', () => { this.hud.hideResults(); this.menu.open('race'); }],
            ['Keep driving', () => this.hud.hideResults()]]);
        }
      }
      if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
      if (v.body.position.y < -60) this.spawn(this.spawnNames[this.spawnIndex]);
      const lt = this.lapTimer, ev = lt.update(dt * (this.slowmo ? 0.25 : 1), v.body.position.x, v.body.position.z);
      if (ev === 'lap') this.hud.showToast(`Lap ${LapTimer.fmt(lt.last.time)}${lt.last.valid ? (lt.last.best ? ' · BEST' : '') : ' · invalid'}`, 3000);
      else if (ev === 'invalid') this.hud.showToast('Track limits — lap invalidated', 1500);
    }

    // ---- views
    this.carView.update(v, inp.state.brake);
    if (this.race) {
      for (const b of this.race.bots) b.view.update(b.vehicle, b.vehicle.input.brake);
      this.hud.el.hBot.innerHTML = this.race.hudHtml();
      this.hud.mapOthers = this.race.mapDots();
    } else this.hud.el.hBot.textContent = '';
    const wc = v.wallContact; // read before effects consume it
    if (!paused) this.effects.update(dt * (this.slowmo ? 0.25 : 1), v);
    if (wc) this.audio.scrape = Math.max(this.audio.scrape || 0, wc.scrape);
    this.rig.update(dt, v, inp.buttons.lookBack);
    const p = v.body.position;
    // tunnels: the daylight drops away as the car goes in (eased, so the eyes 'adapt')
    if (this.world.map.inTunnel) {
      const info = this.world.trackInfo(p.x, p.z), T = this.world.track[Math.max(0, info.index)];
      const inside = info.index >= 0 && info.dist < T.w / 2 + 3 && this.world.map.inTunnel(this.world.map.dist(this.world, T));
      this.tunnelLight += ((inside ? 0.22 : 1) - this.tunnelLight) * (1 - Math.exp(-(inside ? 5 : 3) * dt));
      const f = this.tunnelLight, b = this.baseLight;
      this.hemi.intensity = b.hemi * (0.35 + 0.65 * f); this.sun.intensity = b.sun * f;
      this.renderer.toneMappingExposure = b.exposure * (1 + (1 - f) * 0.55);
    }
    this.sun.position.set(p.x + 60, p.y + 120, p.z + 40); this.sun.target.position.set(p.x, p.y, p.z);
    this.hud.update(dt, v, inp, { physicsHz: PHYSICS_HZ, camera: this.rig.modeName, slowmo: this.slowmo, lap: this.lapTimer });
    if (!paused) {
      this.audio.update(v);
      // feedback
      const t = v.telemetry;
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

window.app = new App();
