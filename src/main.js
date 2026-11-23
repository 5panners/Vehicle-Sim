import * as THREE from 'three';
import { World } from './world/World.js';
import { Shadows } from './render/Shadows.js';
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
import { Multiplayer } from './net/Multiplayer.js';
import { Graphics } from './render/Graphics.js';

const DEFAULT_CAR = 'GT3';
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
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 6000);   // a larger near plane keeps coplanar surfaces from z-fighting
    this.hemi = new THREE.HemisphereLight(0xe3f0ff, 0x4a5a30, 1.1); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.shadows = new Shadows(this);                       // cascaded shadow maps (the sun above just owns colour and intensity)
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); this.shadows.resize(); });

    // ---- simulation
    this.world = new World(MAPS[this.mapId]);
    const sky = this.world.map.sky;
    if (sky) { scene.fog.color.set(sky.fog); this.sun.intensity = sky.sun; this.hemi.intensity = sky.hemi; if (sky.fogNear) scene.fog.near = sky.fogNear; if (sky.fogFar) scene.fog.far = sky.fogFar; }
    this.baseLight = { hemi: this.hemi.intensity, sun: this.sun.intensity, exposure: renderer.toneMappingExposure }; this.tunnelLight = 1;
    this.lapTimer = new LapTimer(this.world);
    this.maps = MAPS;
    this.worldView = new WorldView(this.world, scene);
    this.gfx = new Graphics(this);   // shadow distance, render scale, time of day
    this.lights = new StartLights();
    const startCar = this.world.map.defaultCar || DEFAULT_CAR;                          // a map can pick its own starting car (the kart circuit: a kart)
    this.presetIndex = Math.max(0, PRESETS.findIndex((p) => p.name === startCar));   // otherwise opens in the GT3
    this.vehicle = new Vehicle(structuredClone(PRESETS[this.presetIndex]), this.world);
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
    this.net = new Multiplayer(this);
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
      let auto = null; try { auto = JSON.parse(sessionStorage.getItem('vehicleSim.autoJoin') || 'null'); sessionStorage.removeItem('vehicleSim.autoJoin'); } catch { /* ignore */ }
      if (auto?.password) {                                  // came back from a track switch for an online match: reconnect
        const go = auto.role === 'host' ? this.net.host(auto.password, auto.slots || ['you', 'open']) : this.net.join(auto.password);
        go.then(() => this.menu.open('race')).catch((e) => this.hud.showToast(`Online: ${e.message}`, 3000));
      } else if (this.pendingRace) { this.createRace(this.pendingRace); this.pendingRace = null; }
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
    this.vehicle.steerSensitivity = g.carSteerSensitivity?.[this.vehicle.config.name] ?? g.steerSensitivity;   // each car can keep its own value; the Controls slider is the default
  }

  get playerName() { try { return localStorage.getItem('vehicleSim.name') || 'Player'; } catch { return 'Player'; } }
  set playerName(n) { try { localStorage.setItem('vehicleSim.name', String(n).slice(0, 16)); } catch { /* ignore */ } }

  applyConfig(cfg) {
    const assists = this.vehicle.assists;
    this.vehicle.setConfig(cfg);
    this.vehicle.assists = assists;
    this.applySteeringMode();
    this.race?.syncSpec();   // opponents keep the same spec as you
  }

  loadPreset(i, { quiet = false } = {}) {
    this.presetIndex = i; this.torqueScale = 1;
    const pos = this.vehicle.body.position.clone(), yaw = this.currentYaw();
    this.vehicle = new Vehicle(structuredClone(PRESETS[i]), this.world);
    this.applySteeringMode();
    this.carView.build(this.vehicle);
    this.placeCar(pos.x, pos.z, yaw);
    if (!quiet) this.hud.showToast(PRESETS[i].name);
    if (this.tuning.isOpen) this.tuning.render(); // keep the panel in sync when switching cars
    if (this.race?.online) this.race.syncSpec();           // online: the AI follows your car; the host's next start sends it to everyone
    else if (this.race) this.createRace(this.race.settings);   // opponents always drive the same car as you
    this.net?.refreshLobby();
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
    this.endRace(true);
    if (rest.online) { this.race = new Race(this, rest); this.race.start(); this.hud.showToast(`Online ${rest.laps ? `${rest.laps}-lap race` : 'practice'} · ${rest.lineup.length} on the grid · you start P${this.race.myGrid + 1}`, 2600); return; }
    if (rest.laps !== 0 || rest.opponents !== 1) this.raceSettings = rest;   // the O quick practice doesn't overwrite your race setup
    this.race = new Race(this, rest);
    this.race.start();
    const n = rest.opponents;
    this.hud.showToast(`${rest.laps ? `${rest.laps}-lap race` : 'Practice'} · ${n} opponent${n > 1 ? 's' : ''} (${BOT_SKILLS[rest.skill].name}) · you start P${Math.min(rest.slot, n + 1)}`, 2600);
  }

  /** repaint your own car in a colour (online: the colour the other players see you in), or back to its own paint with no argument */
  setCarTint(color) {
    const tint = color ? parseInt(String(color).replace('#', ''), 16) : undefined;
    if (this.carView.tint === tint) return;
    this.carView.tint = tint; this.carView._tintMat = null; this.carView.build(this.vehicle);
  }

  endRace(silent = false) {
    if (!this.race) return;
    if (this.race.online) this.setCarTint(null);
    if (this.race.online && !silent && this.net.isHost) this.net.endRaceAll();   // the host ending it ends it for everyone
    this.race.dispose(); this.race = null; this.hud.mapOthers = [];
    this.lights.phase = 'idle'; this.lights.lit = 0; this.worldView.setStartLights(0); this.hud.setStartLights(0, false);
    this.hud.hideResults();
  }

  /** O: quick practice against one opponent on the grid, or end the current race */
  toggleQuickRace() {
    if (this.net.active) { this.hud.showToast('Online match: races start from the menu (Esc)', 2000); return; }
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
      if (/grid/i.test(name) && this.race.online) { if (this.net.isHost) this.net.startRace(); else this.hud.showToast('Only the host can restart the race', 1500); return; }
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
      else if (e.code === 'KeyV') this.cycleFollow();
      else if (e.code === 'KeyN') this.hud.showToast(this.hud.toggleMap() ? 'Track map on' : 'Track map off', 900);
      else if (e.code === 'KeyG') { this.vehicle.assists.autoGearbox = !this.vehicle.assists.autoGearbox; this.hud.showToast(this.vehicle.assists.autoGearbox ? 'Automatic gearbox' : 'Manual gearbox'); }
      else if (e.code === 'BracketRight') this.loadPreset((this.presetIndex + 1) % PRESETS.length);
      else if (e.code === 'BracketLeft') this.loadPreset((this.presetIndex + PRESETS.length - 1) % PRESETS.length);
    });
  }

  // ------------------------------------------------------------------ follow camera
  /** the cars the Follow camera can watch: you first, then every opponent in the race */
  followList() { return this.race ? this.race.cars : [{ isPlayer: true, name: 'You' }]; }
  followVehicle() {
    const list = this.followList(), c = list[(this.followIdx || 0) % list.length];
    return !c || c.isPlayer || !c.vehicle ? this.vehicle : c.vehicle;
  }
  /** V: switch to the Follow camera and move on to the next car */
  cycleFollow() {
    const list = this.followList();
    if (list.length < 2) { this.hud.showToast('Follow camera: start a race with opponents (O) to follow other cars', 2200); return; }
    this.followIdx = this.rig.modeName === 'Follow' ? ((this.followIdx || 0) + 1) % list.length : (this.followIdx || 0) % list.length;
    this.rig.setMode('Follow');
    const c = list[this.followIdx];
    this.hud.showToast(`Following ${c.isPlayer ? 'your car' : c.name}`, 1400);
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
    const online = !!this.race?.online;
    this.net.update(dt);                                    // online: keep talking even with the menu open
    const paused = (this.menu.isOpen && !online) || !this.started;   // an online race can't pause: the others keep driving
    this.audio.setPaused(paused);
    if (!paused) {
      if (inp.pressed.camera) { this.rig.next(); const fl = this.followList()[(this.followIdx || 0) % this.followList().length]; this.hud.showToast(this.rig.modeName === 'Follow' ? `Camera: Follow · ${fl.isPlayer ? 'your car' : fl.name} (V: next car)` : `Camera: ${this.rig.modeName}`, 1200); }
      if (inp.pressed.telemetry) this.hud.toggleTelemetry();
      if (inp.pressed.reset) { const yaw = this.currentYaw(), back = 3;   // upright again, a few metres back so you aren't left in the wall
        this.placeCar(v.body.position.x - Math.sin(yaw) * back, v.body.position.z - Math.cos(yaw) * back, yaw); this.hud.drift.combo = 0; this.hud.drift.active = false; }
      if (inp.pressed.shiftUp || inp.pressed.shiftDown) {
        if (v.assists.autoGearbox) { v.assists.autoGearbox = false; this.hud.showToast('Manual gearbox (G toggles)'); }
        inp.pressed.shiftUp ? v.shiftUp() : v.shiftDown();
      }
      const s = this.menu.isOpen ? { steer: 0, throttle: 0, brake: 1, handbrake: 0, clutch: 0 } : inp.state;   // menu open online: brakes on
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
      // water: a car in the canal is slowed right down, then lifted back onto the road before the jump
      const map = this.world.map;
      if (map.waterLevel !== undefined && v.body.position.y < map.waterLevel - 0.1 && Math.abs(v.body.position.x - map.canalX) < 7) {
        const k = Math.max(0, 1 - 2.5 * dt); v.body.velocity.x *= k; v.body.velocity.z *= k;
        this._swim = (this._swim || 0) + dt;
        if (this._swim > 1.6) { this._swim = 0; const sp = map.splashSpawn(this.world); this.placeCar(sp.x, sp.z, sp.yaw); this.hud.showToast('Splash! Back on the road', 1600); }
      } else this._swim = 0;
      const lev = this.lights.update(dt * (this.slowmo ? 0.25 : 1));
      if (lev === 'out') this.hud.showToast('Lights out — go!', 1200);
      this.worldView.setStartLights(this.lights.lit);
      this.hud.setStartLights(this.lights.lit, this.lights.phase === 'lights' || (this.lights.phase === 'go' && this.lights.t < 1));
      if (bump > 1.5) { this.audio.thump(Math.min(1, bump / 12)); this.hud.drift.combo = 0; }
      if (race) this.audio.updateOthers(v, race.others.filter((b) => !b.remote || b.seen).map((b, i) => ({ key: b, vehicle: b.vehicle, index: i })));
      if (race) {
        for (const b of race.bots) if (b.vehicle.body.position.y < -60) b.driver.placeAt(b.driver.idx);
        for (const e of race.update(dt * (this.slowmo ? 0.25 : 1), lev)) {
          if (e.type === 'finish' && !e.car.isPlayer && e.place === 1) this.hud.showToast(`${e.car.name} wins!`, 2000);
          if (e.type === 'over') this.hud.showResults(race.resultsHtml(), [
            ...(!race.online ? [['Race again', () => { this.hud.hideResults(); race.start(); }]] : this.net.isHost ? [['Race again', () => { this.hud.hideResults(); this.net.startRace(); }]] : []),
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
      for (const b of this.race.others) b.view.update(b.vehicle, b.vehicle.input.brake);
      this._botHud = (this._botHud || 0) + 1; if (this._botHud % 4 === 1) { const html = this.race.hudHtml(); if (this.hud.el.hBot._h !== html) { this.hud.el.hBot._h = html; this.hud.el.hBot.innerHTML = html; } }   // a few times a second is plenty
      this.hud.mapOthers = this.race.mapDots();
    } else if (this.hud.el.hBot._h !== '') { this.hud.el.hBot._h = ''; this.hud.el.hBot.textContent = ''; }
    const wc = v.wallContact; // read before effects consume it
    if (!paused) this.effects.update(dt * (this.slowmo ? 0.25 : 1), v);
    if (wc) this.audio.scrape = Math.max(this.audio.scrape || 0, wc.scrape);
    this.rig.update(dt, this.rig.modeName === 'Follow' ? this.followVehicle() : v, inp.buttons.lookBack);
    const p = v.body.position;
    // tunnels: the daylight drops away as the car goes in (eased, so the eyes 'adapt')
    this.worldView.update(this.camera);       // tree level of detail
    this.gfx.update(dt);                     // time of day: sun position, sky, fog and base light levels
    if (this.world.map.inTunnel) {
      const info = this.world.trackInfo(p.x, p.z), T = this.world.track[Math.max(0, info.index)];
      const inside = info.index >= 0 && info.dist < T.w / 2 + 3 && this.world.map.inTunnel(this.world.map.dist(this.world, T));
      this.tunnelLight += ((inside ? 0.22 : 1) - this.tunnelLight) * (1 - Math.exp(-(inside ? 5 : 3) * dt));
    }
    const tl = this.tunnelLight, bl = this.baseLight;
    this.hemi.intensity = bl.hemi * (0.35 + 0.65 * tl); this.sun.intensity = bl.sun * tl;
    this.renderer.toneMappingExposure = bl.exposure * (1 + (1 - tl) * 0.55);
    const sd = this.gfx.sunDir, reach = 130;
    this.sun.position.set(p.x + sd.x * reach, p.y + sd.y * reach, p.z + sd.z * reach); this.sun.target.position.set(p.x, p.y, p.z);
    this.shadows.update();
    this.hud.update(dt, v, inp, { physicsHz: PHYSICS_HZ, camera: this.rig.modeName, slowmo: this.slowmo, lap: this.lapTimer, clock: this.gfx.hourText, night: this.gfx.s.hour < 6 || this.gfx.s.hour >= 18 });
    if (!paused) {
      this.audio.update(v);
      // feedback
      const t = v.telemetry;
      let rough = 0;
      for (const w of v.wheels) if (w.contact && w.surface) rough = Math.max(rough, w.surface.bump * 30 * Math.min(1, v.speed / 20));
      const moving = Math.min(1, Math.max(0, (v.speed - 1.5) / 4)); // no slip/ABS rumble while stationary
      const slip = Math.max(0, Math.min(1, (t.maxSlip || 0) - 0.85)) * moving;
      const limiter = v.drivetrain.engine.limiterTimer > 0 ? 0.25 * moving : 0;
      const scrape = wc ? Math.min(0.6, wc.scrape * 0.04) : 0;
      inp.rumble(Math.min(1, t.impact + limiter), Math.min(1, slip * 0.8 + rough + scrape + (v.absActive ? 0.35 * moving : 0)));
    }
    v.wallContact = null; // consumed by effects, audio, rumble and HUD this frame
    this.renderer.render(this.scene, this.camera);
  }
}

window.app = new App();
