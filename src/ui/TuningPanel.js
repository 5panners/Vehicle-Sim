import { PRESETS, deepMerge } from '../vehicles/presets.js';

const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

// [label, path(s), min, max, step]. Multiple paths are set together.
const SECTIONS = [
  ['Chassis', [
    ['Mass (kg)', 'body.mass', 600, 3200, 10],
    ['CG height (m)', 'body.cgHeight', 0.25, 1.1, 0.01],
    ['Front weight', 'body.weightDistFront', 0.35, 0.7, 0.01],
    ['Yaw inertia ×', 'body.inertiaScale.y', 0.5, 1.5, 0.05],
  ]],
  ['Suspension', [
    ['Spring F (N/m)', 'suspension.front.springRate', 10000, 220000, 1000],
    ['Spring R (N/m)', 'suspension.rear.springRate', 10000, 220000, 1000],
    ['Bump damp F', 'suspension.front.bumpDamping', 500, 12000, 100],
    ['Bump damp R', 'suspension.rear.bumpDamping', 500, 12000, 100],
    ['Rebound F', 'suspension.front.reboundDamping', 500, 15000, 100],
    ['Rebound R', 'suspension.rear.reboundDamping', 500, 15000, 100],
    ['Anti-roll F', 'suspension.front.antiRollBar', 0, 90000, 500],
    ['Anti-roll R', 'suspension.rear.antiRollBar', 0, 90000, 500],
    ['Camber F (°)', 'suspension.front.camber', -5, 1, 0.1],
    ['Camber R (°)', 'suspension.rear.camber', -5, 1, 0.1],
    ['Toe F (°)', 'suspension.front.toe', -1, 1, 0.05],
    ['Toe R (°)', 'suspension.rear.toe', -1, 1, 0.05],
    ['Ride height (m)', ['suspension.front.rideHeightOffset', 'suspension.rear.rideHeightOffset'], -0.08, 0.15, 0.005],
  ]],
  ['Tyres', [
    ['Grip F (μ)', ['tires.front.peakFrictionX', 'tires.front.peakFrictionY'], 0.5, 2.0, 0.01],
    ['Grip R (μ)', ['tires.rear.peakFrictionX', 'tires.rear.peakFrictionY'], 0.5, 2.0, 0.01],
    ['Peak slip angle (°)', ['tires.front.peakSlipAngle', 'tires.rear.peakSlipAngle'], 3, 14, 0.25],
    ['Peak slip ratio', ['tires.front.peakSlipRatio', 'tires.rear.peakSlipRatio'], 0.04, 0.25, 0.005],
    ['Load sensitivity', ['tires.front.loadSensitivity', 'tires.rear.loadSensitivity'], 0, 0.3, 0.01],
    ['Relaxation len (m)', ['tires.front.relaxationLengthY', 'tires.rear.relaxationLengthY'], 0.1, 1.0, 0.01],
  ]],
  ['Engine & Gearing', [
    ['Torque ×', '_torqueScale', 0.3, 3, 0.05],
    ['Final drive', 'transmission.finalDrive', 2, 6, 0.05],
    ['Shift time (s)', 'transmission.shiftTime', 0.03, 0.5, 0.01],
    ['Engine inertia', 'engine.inertia', 0.05, 0.5, 0.01],
    ['Engine braking (Nm)', 'engine.engineBrakingTorque', 0, 200, 5],
  ]],
  ['Differential', [
    ['Front split (AWD)', 'drivetrain.centerSplitFront', 0, 1, 0.05],
    ['Rear LSD preload', 'drivetrain.rearDiff.preload', 0, 400, 5],
    ['Rear power lock', 'drivetrain.rearDiff.powerLock', 0, 1, 0.05],
    ['Rear coast lock', 'drivetrain.rearDiff.coastLock', 0, 1, 0.05],
    ['Front power lock', 'drivetrain.frontDiff.powerLock', 0, 1, 0.05],
  ]],
  ['Brakes & Steering', [
    ['Brake torque (Nm)', 'brakes.maxTorque', 1000, 12000, 100],
    ['Brake bias (front)', 'brakes.bias', 0.4, 0.85, 0.01],
    ['Handbrake (Nm)', 'brakes.handbrakeTorque', 0, 6000, 100],
    ['Max steer (°)', 'steering.maxAngle', 15, 60, 1],
    ['Steer speed', 'steering.steerSpeed', 1, 15, 0.25],
    ['Speed sensitivity', 'steering.speedSensitivity', 0, 1, 0.05],
    ['Countersteer assist', 'steering.countersteerAssist', 0, 1, 0.05],
    ['Ackermann', 'steering.ackermann', 0, 1, 0.05],
    ['Steering sensitivity (this car)', '_steerSens', 0.2, 4, 0.05],
  ]],
  ['Aero', [
    ['Downforce F (Cl)', 'aero.liftCoefFront', -3, 0.3, 0.05],
    ['Downforce R (Cl)', 'aero.liftCoefRear', -3, 0.3, 0.05],
    ['Drag (Cd)', 'aero.dragCoefficient', 0.2, 0.8, 0.01],
  ]],
];

export class TuningPanel {
  constructor(root, app) {
    this.root = root; this.app = app; this.isOpen = false;
    this.open = new Set(['Chassis', 'Suspension']);
  }
  toggle() { this.isOpen = !this.isOpen; this.root.classList.toggle('open', this.isOpen); if (this.isOpen) this.render(); }

  apply(cfg) { this.app.applyConfig(cfg); }

  render() {
    const app = this.app, v = app.vehicle, cfg = v.config;
    const base = PRESETS[app.presetIndex];
    this.root.innerHTML = '';
    const p = document.createElement('div'); p.className = 'panel tuning';
    p.innerHTML = `<div class="panel-head"><h2>Vehicle</h2><button class="btn" data-x="close">Close (Tab)</button></div>`;
    // preset select
    const sel = document.createElement('select');
    PRESETS.forEach((pr, i) => { const o = new Option(pr.name, i); if (i === app.presetIndex) o.selected = true; sel.append(o); });
    sel.onchange = () => { app.loadPreset(+sel.value); this.render(); };
    const row = (label, el) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = label; r.append(l, el); return r; };
    p.append(row('Preset', sel));
    const msel = document.createElement('select');
    for (const [id, m] of Object.entries(app.maps || {})) { const o = new Option(m.name, id); if (id === app.mapId) o.selected = true; msel.append(o); }
    msel.onchange = () => app.switchMap(msel.value);
    p.append(row('Map (reloads)', msel));
    const desc = document.createElement('p'); desc.className = 'hint'; desc.textContent = cfg.description; p.append(desc);

    // assists
    const as = document.createElement('div'); as.className = 'toggles';
    for (const [k, lbl] of [['abs', 'ABS'], ['tcs', 'Traction ctrl'], ['stability', 'Stability ctrl'], ['autoGearbox', 'Auto gearbox'], ['autoClutch', 'Auto clutch']]) {
      const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!v.assists[k];
      c.onchange = () => { v.assists[k] = c.checked; app.race?.syncSpec(); };
      l.append(c, ' ' + lbl); as.append(l);
    }
    p.append(as);
    // layout + diff types
    const mk = (opts, cur, onch) => { const s = document.createElement('select'); for (const o of opts) s.append(new Option(o, o)); s.value = cur; s.onchange = () => onch(s.value); return s; };
    p.append(row('Drive layout', mk(['RWD', 'FWD', 'AWD'], cfg.drivetrain.layout, (val) => { const c = structuredClone(cfg); c.drivetrain.layout = val; this.apply(c); })));
    p.append(row('Rear diff', mk(['open', 'lsd', 'locked'], cfg.drivetrain.rearDiff.type, (val) => { const c = structuredClone(cfg); c.drivetrain.rearDiff.type = val; this.apply(c); })));
    p.append(row('Front diff', mk(['open', 'lsd', 'locked'], cfg.drivetrain.frontDiff.type, (val) => { const c = structuredClone(cfg); c.drivetrain.frontDiff.type = val; this.apply(c); })));

    for (const [name, items] of SECTIONS) {
      const sec = document.createElement('div'); sec.className = 'section';
      const hd = document.createElement('h3'); hd.textContent = (this.open.has(name) ? '▾ ' : '▸ ') + name; hd.className = 'clickable';
      hd.onclick = () => { this.open.has(name) ? this.open.delete(name) : this.open.add(name); this.render(); };
      sec.append(hd);
      if (this.open.has(name)) for (const [label, path, min, max, step] of items) {
        const paths = Array.isArray(path) ? path : [path];
        const gl = app.input.data.global;
        const cur = path === '_torqueScale' ? (app.torqueScale ?? 1) : path === '_steerSens' ? (gl.carSteerSensitivity?.[cfg.name] ?? gl.steerSensitivity) : get(cfg, paths[0]);
        const baseVal = path === '_torqueScale' ? 1 : path === '_steerSens' ? gl.steerSensitivity : get(base, paths[0]);
        const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = cur;
        const out = document.createElement('span'); out.className = 'val';
        const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(step < 0.01 ? 3 : 2));
        const mark = () => { out.textContent = fmt(+r.value); out.classList.toggle('changed', Math.abs(+r.value - baseVal) > step / 2); };
        mark();
        r.oninput = () => {
          mark();
          if (path === '_steerSens') {                  // saved per car, not part of the car's config
            (gl.carSteerSensitivity ||= {})[app.vehicle.config.name] = +r.value; app.input.save(); app.applySteeringMode(); return;
          }
          const c = structuredClone(app.vehicle.config);
          if (path === '_torqueScale') {
            app.torqueScale = +r.value;
            c.engine.torqueCurve = base.engine.torqueCurve.map(([rpm, t]) => [rpm, t * app.torqueScale]);
          } else for (const pp of paths) set(c, pp, +r.value);
          this.apply(c);
        };
        const rr = row(label, r); rr.append(out); sec.append(rr);
      }
      p.append(sec);
    }
    // export / import
    const io = document.createElement('div'); io.className = 'row';
    const ex = document.createElement('button'); ex.className = 'btn'; ex.textContent = 'Export JSON';
    const im = document.createElement('button'); im.className = 'btn'; im.textContent = 'Import JSON';
    const rs = document.createElement('button'); rs.className = 'btn ghost'; rs.textContent = 'Reset preset';
    const ta = document.createElement('textarea'); ta.className = 'json'; ta.placeholder = 'Vehicle JSON (export, edit, import)';
    ex.onclick = () => { ta.value = JSON.stringify(app.vehicle.config, null, 2); ta.select(); navigator.clipboard?.writeText(ta.value).catch(() => {}); app.hud.showToast('Config copied to clipboard'); };
    im.onclick = () => { try { const c = deepMerge(PRESETS[0], JSON.parse(ta.value)); this.apply(c); app.carView.build(app.vehicle); this.render(); app.hud.showToast('Config imported'); } catch (err) { app.hud.showToast('Invalid JSON: ' + err.message, 3000); } };
    rs.onclick = () => { app.loadPreset(app.presetIndex); this.render(); };
    io.append(ex, im, rs);
    p.append(io, ta);
    p.querySelector('[data-x=close]').onclick = () => this.toggle();
    this.root.append(p);
  }
}
