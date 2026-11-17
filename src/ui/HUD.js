import { BUILD } from '../build.js';
const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const DEG = 180 / Math.PI;

export class HUD {
  constructor(root) {
    this.root = root;
    // mph by default; a U toggle is remembered between sessions
    let saved = null; try { saved = localStorage.getItem('vehicleSim.units'); } catch { /* storage unavailable */ }
    this.units = saved === 'kmh' ? 'kmh' : 'mph';
    root.append($(`<div class="hud-top-left">
        <div class="car-name" id="hCar"></div>
        <div class="assists"><span id="aABS">ABS</span><span id="aTCS">TCS</span><span id="aESC">ESC</span><span id="aAUTO">AUTO</span></div>
        <div class="small" id="hSurf"></div>
        <div class="small" id="hDev"></div>
        <div class="lap" id="hLap"></div>
      </div>`));
    root.append($(`<div class="hud-top-right"><div class="small build">Build ${BUILD.number} · ${BUILD.date}</div><div id="hFps" class="small"></div><div class="small" id="hCam"></div>
        <div class="small hintline">Esc/Start: controls · Tab: tuning · T: telemetry · F: spawn · H: help</div></div>`));
    root.append($(`<div class="hud-dash">
        <div class="rpm"><div class="rpm-fill" id="hRpm"></div><div class="rpm-red" id="hRed"></div></div>
        <div class="dash-row"><div class="gear" id="hGear">N</div>
        <div class="speed"><span id="hSpd">0</span><em id="hUnit">km/h</em></div></div>
        <div class="small" id="hRpmTxt"></div>
      </div>`));
    root.append($(`<div class="hud-inputs">
        <div class="ib"><label>STR</label><div class="bar bi"><i id="iSteer"></i></div></div>
        <div class="ib"><label>THR</label><div class="bar"><i id="iThr" class="g"></i></div></div>
        <div class="ib"><label>BRK</label><div class="bar"><i id="iBrk" class="r"></i></div></div>
        <div class="ib"><label>HB</label><div class="bar"><i id="iHb" class="y"></i></div></div>
        <div class="ib"><label>CLU</label><div class="bar"><i id="iClu" class="b"></i></div></div>
      </div>`));
    this.tele = $(`<div class="telemetry panel"><h3>Telemetry</h3>
        <div class="tele-grid">
          <div class="wheel" id="tw0"></div><div class="gg"><canvas id="ggc" width="150" height="150"></canvas></div><div class="wheel" id="tw1"></div>
          <div class="wheel" id="tw2"></div><div class="mid" id="tmid"></div><div class="wheel" id="tw3"></div>
        </div></div>`);
    root.append(this.tele);
    this.help = $(`<div class="help panel"><h3>Driving</h3><table>
        <tr><td>Throttle / Brake</td><td>W S · ↑ ↓ · RT LT</td></tr>
        <tr><td>Steer</td><td>A D · ← → · Left stick</td></tr>
        <tr><td>Handbrake</td><td>Space · A</td></tr>
        <tr><td>Shift up / down</td><td>E / Q · B / X</td></tr>
        <tr><td>Clutch (manual)</td><td>Z · LB</td></tr>
        <tr><td>Camera / Look back</td><td>C / B · Y / RB</td></tr>
        <tr><td>Reset car</td><td>R · Back/View</td></tr>
        <tr><td>Spawn points</td><td>F (cycle) · 1-8</td></tr>
        <tr><td>Controls & calibration</td><td>Esc · Start</td></tr>
        <tr><td>Tuning panel</td><td>Tab</td></tr>
        <tr><td>Telemetry</td><td>T · D-pad up</td></tr>
        <tr><td>Units / Mute / Slow-mo</td><td>U / M / P</td></tr>
        <tr><td>Track map / next map (reloads)</td><td>N / L</td></tr>
        </table><p class="hint">In auto mode, hold brake at a standstill to reverse.</p></div>`);
    root.append(this.help);
    this.toast = $('<div class="toast"></div>'); root.append(this.toast);
    this.mapEl = $('<div class="minimap"><canvas></canvas></div>'); root.append(this.mapEl);
    this.driftEl = $('<div class="drift"><div class="d-angle"></div><div class="d-combo"></div><div class="d-total"></div></div>'); root.append(this.driftEl);
    this.drift = { combo: 0, total: 0, idle: 0, active: false, flash: 0, best: 0 };
    this.el = {};
    for (const id of ['hLap', 'hCar', 'hSurf', 'hDev', 'hFps', 'hCam', 'hRpm', 'hRed', 'hGear', 'hSpd', 'hUnit', 'hRpmTxt', 'iSteer', 'iThr', 'iBrk', 'iHb', 'iClu', 'aABS', 'aTCS', 'aESC', 'aAUTO', 'tmid', 'tw0', 'tw1', 'tw2', 'tw3', 'ggc'])
      this.el[id] = root.querySelector('#' + id);
    this.ggTrail = [];
    this.fps = 60;
  }

  // ---------------------------------------------------------------- track map
  /**
   * North-up minimap. The static layer (track, walls, test areas) is drawn once to
   * an offscreen canvas; each frame only blits it and draws the car arrow.
   * Seen from above with +Z up the screen, the driver's right (-X) is screen right,
   * so world (x, z) -> canvas (cx - x*s, cy - z*s).
   */
  buildMap(world, zones = {}) {
    this.world = world;
    const T = world.track;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of T) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z); }
    for (const r of Object.values(zones)) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1); }
    const pad = 20; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    this.mapBounds = { x0, x1, z0, z1, aspect: (x1 - x0) / (z1 - z0) };
    this.mapZones = zones;
    this._mapStatic = null; // (re)drawn at the current display size on next frame
  }

  _mapProject(x, z, W, H) {
    const b = this.mapBounds, s = Math.min(W / (b.x1 - b.x0), H / (b.z1 - b.z0));
    const cx = W / 2, cy = H / 2, mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    return [cx - (x - mx) * s, cy - (z - mz) * s, s];
  }

  _drawMapStatic(W, H, dpr) {
    const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const P = (x, z) => this._mapProject(x, z, W, H);
    // background
    g.fillStyle = 'rgba(10,14,20,0.85)'; g.beginPath(); g.roundRect(0, 0, W, H, 10); g.fill();
    // infield test areas (faint)
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (const r of Object.values(this.mapZones)) {
      const [ax, az] = P(r.x0, r.z0), [bx, bz] = P(r.x1, r.z1);
      g.fillRect(Math.min(ax, bx), Math.min(az, bz), Math.abs(bx - ax), Math.abs(bz - az));
    }
    // track: dark casing + light surface
    const T = this.world.track;
    const path = () => { g.beginPath(); T.forEach((t, i) => { const [x, y] = P(t.x, t.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    const [, , sc] = P(0, 0);
    const tw = Math.max(3, 14 * sc);
    g.lineJoin = 'round'; g.lineCap = 'round';
    path(); g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = tw + 3; g.stroke();
    path(); g.strokeStyle = '#d7dde3'; g.lineWidth = tw; g.stroke();
    // walls: street/concrete walls in red, Armco as a faint line, buildings not drawn
    for (const [styles, col, lw] of [[['armco', 'pitwall'], 'rgba(255,255,255,0.18)', 0.8], [['street', 'concrete'], '#ff4d4d', 1.5]]) {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
      for (const w of this.world.walls || []) { if (!styles.includes(w.style)) continue; const [ax, ay] = P(w.ax, w.az), [bx, by] = P(w.bx, w.bz); g.moveTo(ax, ay); g.lineTo(bx, by); }
      g.stroke();
    }
    // start / finish line
    const t0 = T[0], hw = 9;
    const [sx0, sy0] = P(t0.x + t0.rx * hw, t0.z + t0.rz * hw), [sx1, sy1] = P(t0.x - t0.rx * hw, t0.z - t0.rz * hw);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx1, sy1); g.stroke();
    g.strokeStyle = '#111'; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx1, sy1); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '9px system-ui'; g.fillText('N', W - 12, 12);
    return c;
  }

  _updateMap(v) {
    if (!this.world || this.mapEl.classList.contains('off')) return;
    const cv = this.mapEl.firstChild, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.mapEl.clientWidth), H = Math.round(W / this.mapBounds.aspect);
    if (!W) return;
    if (!this._mapStatic || this._mapW !== W || this._mapDpr !== dpr) {
      cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
      this._mapStatic = this._drawMapStatic(W, H, dpr); this._mapW = W; this._mapDpr = dpr;
    }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this._mapStatic, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // car arrow, pointing along the car's heading
    const p = v.body.position, f = v.body.localDir({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 });
    let [x, y] = this._mapProject(p.x, p.z, W, H);
    // off the map (the world is bigger than the circuit): pin to the edge, draw hollow
    const m = 7, off = x < m || x > W - m || y < m || y > H - m;
    x = Math.min(W - m, Math.max(m, x)); y = Math.min(H - m, Math.max(m, y));
    const a = Math.atan2(-f.z, -f.x);
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 5.5); g.lineTo(-3, 0); g.lineTo(-6, -5.5); g.closePath();
    g.lineWidth = 1.5; g.strokeStyle = off ? '#ffd54f' : '#000'; g.stroke();
    if (!off) { g.fillStyle = '#ffd54f'; g.fill(); }
    g.restore();
  }
  toggleUnits() {
    this.units = this.units === 'mph' ? 'kmh' : 'mph';
    try { localStorage.setItem('vehicleSim.units', this.units); } catch { /* ignore */ }
    return this.units;
  }
  toggleMap() { this.mapEl.classList.toggle('off'); return !this.mapEl.classList.contains('off'); }

  showToast(msg, ms = 1800) {
    this.toast.textContent = msg; this.toast.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toast.classList.remove('show'), ms);
  }
  toggleTelemetry() { this.tele.classList.toggle('open'); }
  toggleHelp() { this.help.classList.toggle('open'); }

  update(dt, vehicle, input, extra) {
    const e = this.el, v = vehicle, eng = v.config.engine;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    e.hFps.textContent = `${this.fps.toFixed(0)} fps · physics ${extra.physicsHz} Hz${extra.slowmo ? ' · SLOW-MO' : ''}`;
    e.hCam.textContent = `Camera: ${extra.camera}`;
    e.hCar.textContent = v.config.name + (this.mapName ? `  ·  ${this.mapName}` : '');
    const lt = extra.lap;
    if (lt) {
      const f = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
      const sec = lt.sectors.map((x, i) => `<span class="${x === null ? '' : lt.bestSectors[i] !== null && x <= lt.bestSectors[i] + 1e-6 ? 'pb' : ''}">S${i + 1} ${x === null ? '--.--' : x.toFixed(2)}</span>`).join(' ');
      e.hLap.innerHTML = lt.running
        ? `<b class="${lt.valid ? '' : 'inv'}">LAP ${lt.lap} &nbsp;${f(lt.lapTime)}</b><br>${sec}<br>best ${lt.best === null ? '--:--.---' : f(lt.best)} · last ${lt.last ? f(lt.last.time) + (lt.last.valid ? '' : ' ✗') : '--:--.---'}`
        : `<span class="small">Cross the start line to start timing</span>${lt.best !== null ? `<br>best ${f(lt.best)}` : ''}`;
    }
    const surfaces = [...new Set(v.wheels.filter((w) => w.contact && w.surface).map((w) => w.surface.name))];
    e.hSurf.textContent = surfaces.length ? 'Surface: ' + surfaces.join(' / ') : 'Airborne';
    e.hDev.textContent = input.padConnected ? `Controller: ${input.lastDevice === 'gamepad' ? 'active' : 'connected'}` : 'Keyboard (connect a controller anytime)';
    e.aABS.className = v.assists.abs ? (v.absActive ? 'on act' : 'on') : '';
    e.aTCS.className = v.assists.tcs ? (v.tcsActive ? 'on act' : 'on') : '';
    e.aESC.className = v.assists.stability ? (v.escActive ? 'on act' : 'on') : '';
    e.aAUTO.className = v.assists.autoGearbox ? 'on' : '';
    e.aAUTO.textContent = v.assists.autoGearbox ? 'AUTO' : 'MANUAL';

    const rpm = v.rpm, maxR = eng.limiterRPM * 1.02;
    e.hRpm.style.width = `${Math.min(100, (rpm / maxR) * 100)}%`;
    e.hRpm.classList.toggle('shift', rpm > eng.redlineRPM * 0.96);
    e.hRed.style.left = `${(eng.redlineRPM / maxR) * 100}%`;
    const g = v.gear;
    e.hGear.textContent = g === 0 ? 'N' : g < 0 ? 'R' : g;
    const sp = v.forwardSpeed;
    e.hSpd.textContent = Math.abs(this.units === 'kmh' ? sp * 3.6 : sp * 2.237).toFixed(0);
    e.hUnit.textContent = this.units === 'kmh' ? 'km/h' : 'mph';
    const boost = v.drivetrain.engine.boost;
    e.hRpmTxt.textContent = `${rpm.toFixed(0)} rpm${boost > 0.01 ? ` · boost ${(boost * 100).toFixed(0)}%` : ''}${v.drivetrain.clutchSlipping ? ' · clutch slip' : ''}`;

    const s = input.state;
    e.iSteer.style.left = `${50 + Math.min(0, s.steer) * 50}%`; e.iSteer.style.width = `${Math.abs(s.steer) * 50}%`;
    e.iThr.style.width = `${s.throttle * 100}%`; e.iBrk.style.width = `${s.brake * 100}%`;
    e.iHb.style.width = `${s.handbrake * 100}%`; e.iClu.style.width = `${s.clutch * 100}%`;

    if (this.tele.classList.contains('open')) this._telemetry(v);
    this._driftMeter(dt, v);
    this._updateMap(v);
  }

  /**
   * Drift scoring: while sliding (|body slip| > 12° above 20 km/h with the rears
   * on the ground) points accrue as angle × speed. Recovering for 1.2 s banks the
   * combo into the total; spinning out (> 100°) or a hard hit loses it.
   */
  _driftMeter(dt, v) {
    const d = this.drift, el = this.driftEl;
    const ang = Math.abs(v.telemetry.slipAngle) * DEG, kmh = v.speed * 3.6;
    const rearsDown = v.wheels[2].contact && v.wheels[3].contact;
    const sliding = ang > 12 && ang < 100 && kmh > 20 && rearsDown;
    if (ang > 100 && d.combo > 0) { this.showToast('Spun out — combo lost', 1500); d.combo = 0; d.active = false; }
    if (v.telemetry.impact > 0.8 && d.combo > 0 && (v.hullContacts > 0 || v.wallContact)) { this.showToast('Crashed — combo lost', 1500); d.combo = 0; d.active = false; }
    if (sliding) { d.active = true; d.idle = 0; d.combo += ang * v.speed * dt * 0.5; d.angle = ang; }
    else if (d.active) {
      d.idle += dt;
      if (d.idle > 1.2) {
        const pts = Math.round(d.combo); d.total += pts; d.best = Math.max(d.best, pts);
        if (pts > 50) this.showToast(`Drift +${pts}`, 1200);
        d.combo = 0; d.active = false;
      }
    }
    el.classList.toggle('show', d.active || d.total > 0);
    el.classList.toggle('live', sliding);
    el.firstChild.textContent = d.active ? `DRIFT ${Math.round(sliding ? ang : d.angle)}°` : '';
    el.children[1].textContent = d.active ? Math.round(d.combo).toLocaleString() : '';
    el.children[2].textContent = d.total > 0 ? `total ${d.total.toLocaleString()} · best ${d.best.toLocaleString()}` : '';
  }
  resetDrift() { Object.assign(this.drift, { combo: 0, total: 0, idle: 0, active: false, best: 0 }); }

  _telemetry(v) {
    const e = this.el;
    v.wheels.forEach((w, i) => {
      const t = w.tire, travel = Math.min(1, w.compression / w.susp.travel);
      const tc = t.temp < t.cfg.optimalTemp - t.cfg.tempWindow * 0.6 ? 'cold' : t.temp > t.cfg.optimalTemp + t.cfg.tempWindow * 0.6 ? 'hot' : 'ok';
      const sat = Math.min(1, t.normSlip);
      e['tw' + i].innerHTML = `<b>${w.name}</b> <span class="sf">${w.contact ? w.surface.name : 'air'}</span>
        <div class="kv"><span>Load</span><em>${(w.Fz / 1000).toFixed(2)} kN</em></div>
        <div class="kv"><span>Slip ratio</span><em>${(t.slipRatio * 100).toFixed(1)}%</em></div>
        <div class="kv"><span>Slip angle</span><em>${(t.slipAngle * DEG).toFixed(1)}°</em></div>
        <div class="kv"><span>Fx / Fy</span><em>${(t.fx / 1000).toFixed(1)} / ${(t.fy / 1000).toFixed(1)}</em></div>
        <div class="kv"><span>Wheel</span><em>${(w.omega * w.radius * 3.6).toFixed(0)} km/h</em></div>
        <div class="kv"><span>Temp</span><em class="${tc}">${t.temp.toFixed(0)}°C</em></div>
        <div class="minibar"><i style="width:${travel * 100}%" class="${w.bottomed ? 'r' : ''}"></i><span>susp ${(w.compression * 100).toFixed(1)} cm</span></div>
        <div class="minibar"><i style="width:${sat * 100}%" class="${t.normSlip > 1 ? 'r' : 'g'}"></i><span>grip used ${(sat * 100).toFixed(0)}%</span></div>`;
    });
    const tl = v.telemetry, dt = v.drivetrain;
    e.tmid.innerHTML = `<div class="kv"><span>Lat G</span><em>${tl.gLat.toFixed(2)}</em></div>
      <div class="kv"><span>Long G</span><em>${tl.gLong.toFixed(2)}</em></div>
      <div class="kv"><span>Body slip</span><em>${(tl.slipAngle * DEG).toFixed(1)}°</em></div>
      <div class="kv"><span>Yaw rate</span><em>${(tl.yawRate * DEG).toFixed(0)}°/s</em></div>
      <div class="kv"><span>Steer</span><em>${(v.steerAngle * DEG).toFixed(1)}°</em></div>
      <div class="kv"><span>Clutch</span><em>${(dt.clutch * 100).toFixed(0)}% ${dt.clutchSlipping ? 'slip' : ''}</em></div>
      <div class="kv"><span>Eng torque</span><em>${dt.engine.torque.toFixed(0)} Nm</em></div>
      <div class="kv"><span>Drive</span><em>${v.config.drivetrain.layout}</em></div>`;
    // g-g diagram
    const c = e.ggc, ctx = c.getContext('2d'), W = c.width, H = c.height, sc = W / 2 / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    for (const r of [0.5, 1, 1.5, 2]) { ctx.beginPath(); ctx.arc(W / 2, H / 2, r * sc, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    this.ggTrail.push([tl.gLat, tl.gLong]); if (this.ggTrail.length > 120) this.ggTrail.shift();
    ctx.fillStyle = 'rgba(79,195,247,0.35)';
    for (const [x, y] of this.ggTrail) ctx.fillRect(W / 2 + x * sc - 1, H / 2 - y * sc - 1, 2, 2);
    ctx.fillStyle = '#ffca28'; ctx.beginPath(); ctx.arc(W / 2 + tl.gLat * sc, H / 2 - tl.gLong * sc, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px system-ui'; ctx.fillText('g-g (rings 0.5g)', 4, 12);
  }
}
