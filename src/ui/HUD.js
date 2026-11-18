import { BUILD } from '../build.js';
const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const DEG = 180 / Math.PI;

// DOM writes only when the value changed: even an identical textContent / style write costs a style recalculation
const setText = (el, v) => { if (el._t !== v) { el._t = v; el.textContent = v; } };
const setHtml = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
const setClass = (el, v) => { if (el._c !== v) { el._c = v; el.className = v; } };
const setStyle = (el, k, v) => { const key = '_s' + k; if (el[key] !== v) { el[key] = v; el.style[k] = v; } };

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
        <div class="small bot" id="hBot"></div>
      </div>`));
    root.append($(`<div class="hud-top-right"><div class="small build">Build ${BUILD.number} · ${BUILD.date}</div><div id="hFps" class="small"></div><div class="small" id="hCam"></div>
        <div class="small hintline">Esc/Start: menu · Tab: tuning · T: telemetry · F: spawn · O: opponent · H: help</div></div>`));
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
        <tr><td>Practice opponent / skill</td><td>O / K</td></tr>
        <tr><td>Controls & calibration</td><td>Esc · Start</td></tr>
        <tr><td>Tuning panel</td><td>Tab</td></tr>
        <tr><td>Telemetry</td><td>T · D-pad up</td></tr>
        <tr><td>Units / Mute / Slow-mo</td><td>U / M / P</td></tr>
        <tr><td>Track map / next map (reloads)</td><td>N / L</td></tr>
        </table><p class="hint">In auto mode, hold brake at a standstill to reverse.</p></div>`);
    root.append(this.help);
    this.toast = $('<div class="toast"></div>'); root.append(this.toast);
    this.mapEl = $('<div class="minimap"><canvas></canvas></div>'); root.append(this.mapEl);
    // race start lights (mirrors the gantry so they're visible from any camera)
    this.lightsEl = $('<div class="startlights">' + '<span><i></i><i></i></span>'.repeat(5) + '</div>'); root.append(this.lightsEl);
    this.resultsEl = $('<div class="results panel"></div>'); root.append(this.resultsEl);
    this.driftEl = $('<div class="drift"><div class="d-angle"></div><div class="d-combo"></div><div class="d-total"></div></div>'); root.append(this.driftEl);
    this.drift = { combo: 0, total: 0, idle: 0, active: false, flash: 0, best: 0 };
    this.el = {};
    for (const id of ['hLap', 'hBot', 'hCar', 'hSurf', 'hDev', 'hFps', 'hCam', 'hRpm', 'hRed', 'hGear', 'hSpd', 'hUnit', 'hRpmTxt', 'iSteer', 'iThr', 'iBrk', 'iHb', 'iClu', 'aABS', 'aTCS', 'aESC', 'aAUTO', 'tmid', 'tw0', 'tw1', 'tw2', 'tw3', 'ggc'])
      this.el[id] = root.querySelector('#' + id);
    this.ggTrail = [];
    this.fps = 60;
  }

  // ---------------------------------------------------------------- track map
  /**
   * 3/4-view minimap: a camera hovering behind and above the car looks down the road ahead, and the map turns with
   * the car (heading-up). The track is projected every frame as a ribbon of quads, far ones first, over a faint
   * ground grid; the height of the ground is real, so hills show. World north is shown by the compass in the corner.
   * Game axes: the car faces +z, its left is +x, so (u = right, w = forward) = (-dx*fz + dz*fx, dx*fx + dz*fz).
   */
  buildMap(world, zones = {}) {
    this.world = world;
    const T = world.track, step = Math.max(1, Math.round(6 / ((T.length ? Math.hypot(T[1].x - T[0].x, T[1].z - T[0].z) : 1) || 1)));
    this.mapPts = [];
    for (let i = 0; i < T.length; i += step) { const t = T[i]; this.mapPts.push({ x: t.x, y: t.y, z: t.z, rx: t.rx, rz: t.rz, hw: t.w / 2 }); }
    this.mapZones = zones;
  }

  _updateMap(v) {
    if (!this.world || this.mapEl.classList.contains('off')) return;
    const cv = this.mapEl.firstChild, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.mapEl.clientWidth), H = Math.round(W * 0.8);
    if (!W) return;
    if (this._mapW !== W || this._mapDpr !== dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; this._mapW = W; this._mapDpr = dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // frame
    g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 10); g.clip();
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(26,40,60,0.92)'); bg.addColorStop(1, 'rgba(8,12,18,0.92)');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    // the car and the camera behind it
    const p = v.body.position, f = v.body.localDir({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }), fx = f.x, fz = f.z;
    const k = 2.4, camH = 110 * k, camB = 46 * k, th = (50 * Math.PI) / 180, sinT = Math.sin(th), cosT = Math.cos(th);
    const F = (W / 2) / Math.tan((30 * Math.PI) / 180), cx = W / 2, cy = H * 0.34;
    // returns [sx, sy, zv] or null when the point is behind the camera
    const proj = (x, y, z) => {
      const dx = x - p.x, dz = z - p.z, u = -dx * fz + dz * fx, w = dx * fx + dz * fz, yy = (y - p.y) * 1.3;
      const vy = yy - camH, vz = w + camB;                          // camera at (0, camH, -camB), looking forward and down
      const zv = -vy * sinT + vz * cosT, yv = vy * cosT + vz * sinT;
      if (zv < 12) return null;
      return [cx + (u / zv) * F, cy - (yv / zv) * F, zv];
    };
    const horizon = 260 * k, ZF = 520 * k;

    // faint ground grid, fixed to the world so it turns with the map
    g.lineWidth = 1; g.strokeStyle = 'rgba(120,160,200,0.13)';
    const G = 60, gx0 = Math.floor((p.x - 330 * k) / G) * G, gz0 = Math.floor((p.z - 330 * k) / G) * G;
    g.beginPath();
    for (let i = 0; i <= (660 * k) / G + 1; i++) {
      const xx = gx0 + i * G, zz = gz0 + i * G;
      let a = proj(xx, p.y, gz0), b = proj(xx, p.y, gz0 + 660 * k + G);
      if (a && b) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      a = proj(gx0, p.y, zz); b = proj(gx0 + 660 * k + G, p.y, zz);
      if (a && b) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    }
    g.stroke();

    // test-area rectangles (the proving ground)
    for (const r of Object.values(this.mapZones || {})) {
      const c = [proj(r.x0, p.y, r.z0), proj(r.x1, p.y, r.z0), proj(r.x1, p.y, r.z1), proj(r.x0, p.y, r.z1)];
      if (c.some((q) => !q)) continue;
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); c.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fill();
    }

    // the track: a ribbon of quads, far ones first
    const P = this.mapPts, n = P.length, segs = [];
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const dx = a.x - p.x, dz = a.z - p.z;
      if (dx * dx + dz * dz > horizon * horizon) continue;
      const q = [proj(a.x + a.rx * a.hw, a.y, a.z + a.rz * a.hw), proj(b.x + b.rx * b.hw, b.y, b.z + b.rz * b.hw), proj(b.x - b.rx * b.hw, b.y, b.z - b.rz * b.hw), proj(a.x - a.rx * a.hw, a.y, a.z - a.rz * a.hw)];
      if (q.some((c) => !c)) continue;
      segs.push({ q, d: (q[0][2] + q[2][2]) / 2, first: i === 0 });
    }
    segs.sort((s1, s2) => s2.d - s1.d);
    g.lineJoin = 'round';
    for (const s of segs) {
      const fade = Math.max(0.12, 1 - s.d / ZF);
      g.globalAlpha = fade;
      g.beginPath(); s.q.forEach((c, i) => (i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]))); g.closePath();
      g.fillStyle = g.strokeStyle = s.first ? '#ffffff' : '#c9d1d9'; g.lineWidth = 1; g.fill(); g.stroke();
    }
    g.globalAlpha = 1;

    // other cars (opponents and remote players): coloured pins standing on the road
    for (const o of this.mapOthers || []) {
      const base = proj(o.x, p.y + (o.y ?? 0), o.z), top = proj(o.x, p.y + (o.y ?? 0) + 7, o.z);
      if (!base || !top) continue;
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(base[0], base[1]); g.lineTo(top[0], top[1]); g.stroke();
      g.beginPath(); g.arc(top[0], top[1], 4.2, 0, Math.PI * 2); g.fillStyle = o.color; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#000'; g.stroke();
    }

    // your car: an arrow lying on the road, always pointing up the screen
    const ar = [proj(p.x + fx * 9, p.y, p.z + fz * 9), proj(p.x - fx * 5 - fz * 5.5, p.y, p.z - fz * 5 + fx * 5.5), proj(p.x - fx * 2, p.y, p.z - fz * 2), proj(p.x - fx * 5 + fz * 5.5, p.y, p.z - fz * 5 - fx * 5.5)];
    if (ar.every(Boolean)) {
      g.beginPath(); ar.forEach((c, i) => (i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1]))); g.closePath();
      g.fillStyle = '#ffd54f'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#000'; g.stroke();
    }

    // compass: where world north is, relative to the car
    const nu = -fz * 0 + (fx * 0 + 0), nUp = (0 * fx + 1 * fz), nRight = (-0 * fz + 1 * fx);   // north = world +z: right = fx*1, forward = fz*1
    const R = 15, ccx = W - 22, ccy = 22;
    g.beginPath(); g.arc(ccx, ccy, R, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#ff6b6b'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', ccx + nRight * (R - 6), ccy - nUp * (R - 6));
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; g.beginPath(); g.roundRect(0.5, 0.5, W - 1, H - 1, 10); g.stroke();
  }

  toggleMap() { this.mapEl.classList.toggle('off'); return !this.mapEl.classList.contains('off'); }

  showToast(msg, ms = 1800) {
    this.toast.textContent = msg; this.toast.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toast.classList.remove('show'), ms);
  }
  toggleTelemetry() { this.tele.classList.toggle('open'); }
  toggleHelp() { this.help.classList.toggle('open'); }
  /** race results with buttons: actions = [[label, fn], ...] */
  showResults(html, actions = []) {
    const r = this.resultsEl; r.innerHTML = html;
    const row = document.createElement('div'); row.className = 'row';
    for (const [label, fn] of actions) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = label; b.onclick = fn; row.append(b); }
    r.append(row); r.classList.add('show'); row.querySelector('button')?.focus();
  }
  hideResults() { this.resultsEl.classList.remove('show'); }
  /** n = lights lit (0-5); show = panel visible */
  setStartLights(n, show) {
    this.lightsEl.classList.toggle('show', show);
    [...this.lightsEl.children].forEach((c, i) => c.classList.toggle('on', i < n));
  }

  update(dt, vehicle, input, extra) {
    const e = this.el, v = vehicle, eng = v.config.engine;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this._slowT = (this._slowT || 0) + dt; const slow = this._slowT > 0.066; if (slow) this._slowT = 0;   // text that changes constantly is refreshed ~15 times a second
    if (slow) setText(e.hFps, `${this.fps.toFixed(0)} fps · physics ${extra.physicsHz} Hz${extra.slowmo ? ' · SLOW-MO' : ''}`);
    setText(e.hCam, `Camera: ${extra.camera}`);
    setText(e.hCar, v.config.name + (this.mapName ? `  ·  ${this.mapName}` : ''));
    const lt = extra.lap;
    if (lt && (slow || !lt.running)) {
      const f = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
      const sec = lt.sectors.map((x, i) => `<span class="${x === null ? '' : lt.bestSectors[i] !== null && x <= lt.bestSectors[i] + 1e-6 ? 'pb' : ''}">S${i + 1} ${x === null ? '--.--' : x.toFixed(2)}</span>`).join(' ');
      setHtml(e.hLap, lt.running
        ? `<b class="${lt.valid ? '' : 'inv'}">LAP ${lt.lap} &nbsp;${f(lt.lapTime)}</b><br>${sec}<br>best ${lt.best === null ? '--:--.---' : f(lt.best)} · last ${lt.last ? f(lt.last.time) + (lt.last.valid ? '' : ' ✗') : '--:--.---'}`
        : `<span class="small">Cross the start line to start timing</span>${lt.best !== null ? `<br>best ${f(lt.best)}` : ''}`);
    }
    const surfaces = [...new Set(v.wheels.filter((w) => w.contact && w.surface).map((w) => w.surface.name))];
    setText(e.hSurf, surfaces.length ? 'Surface: ' + surfaces.join(' / ') : 'Airborne');
    setText(e.hDev, input.padConnected ? `Controller: ${input.lastDevice === 'gamepad' ? 'active' : 'connected'}` : 'Keyboard (connect a controller anytime)');
    setClass(e.aABS, v.assists.abs ? (v.absActive ? 'on act' : 'on') : '');
    setClass(e.aTCS, v.assists.tcs ? (v.tcsActive ? 'on act' : 'on') : '');
    setClass(e.aESC, v.assists.stability ? (v.escActive ? 'on act' : 'on') : '');
    setClass(e.aAUTO, v.assists.autoGearbox ? 'on' : '');
    setText(e.aAUTO, v.assists.autoGearbox ? 'AUTO' : 'MANUAL');

    const rpm = v.rpm, maxR = eng.limiterRPM * 1.02;
    setStyle(e.hRpm, 'width', `${Math.min(100, Math.round((rpm / maxR) * 1000) / 10)}%`);
    const shiftNow = rpm > eng.redlineRPM * 0.96; if (e.hRpm._shift !== shiftNow) { e.hRpm._shift = shiftNow; e.hRpm.classList.toggle('shift', shiftNow); }
    setStyle(e.hRed, 'left', `${(eng.redlineRPM / maxR) * 100}%`);
    const g = v.gear;
    setText(e.hGear, g === 0 ? 'N' : g < 0 ? 'R' : String(g));
    const sp = v.forwardSpeed;
    setText(e.hSpd, Math.abs(this.units === 'kmh' ? sp * 3.6 : sp * 2.237).toFixed(0));
    setText(e.hUnit, this.units === 'kmh' ? 'km/h' : 'mph');
    const boost = v.drivetrain.engine.boost;
    if (slow) setText(e.hRpmTxt, `${rpm.toFixed(0)} rpm${boost > 0.01 ? ` · boost ${(boost * 100).toFixed(0)}%` : ''}${v.drivetrain.clutchSlipping ? ' · clutch slip' : ''}`);

    const s = input.state;
    const pc = (x) => `${Math.round(x * 1000) / 10}%`;
    setStyle(e.iSteer, 'left', pc(0.5 + Math.min(0, s.steer) * 0.5)); setStyle(e.iSteer, 'width', pc(Math.abs(s.steer) * 0.5));
    setStyle(e.iThr, 'width', pc(s.throttle)); setStyle(e.iBrk, 'width', pc(s.brake));
    setStyle(e.iHb, 'width', pc(s.handbrake)); setStyle(e.iClu, 'width', pc(s.clutch));

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
    const showNow = d.active || d.total > 0; if (el._show !== showNow) { el._show = showNow; el.classList.toggle('show', showNow); }
    if (el._live !== sliding) { el._live = sliding; el.classList.toggle('live', sliding); }
    if (showNow) {
      setText(el.firstChild, d.active ? `DRIFT ${Math.round(sliding ? ang : d.angle)}°` : '');
      setText(el.children[1], d.active ? Math.round(d.combo).toLocaleString() : '');
      setText(el.children[2], d.total > 0 ? `total ${d.total.toLocaleString()} · best ${d.best.toLocaleString()}` : '');
    }
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
