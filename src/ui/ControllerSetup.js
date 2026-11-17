import { ACTIONS, applyCurve } from '../input/InputManager.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};

function describe(b) {
  if (!b) return '—';
  if (b.type === 'button') return `Button ${b.index}`;
  if (b.type === 'axis') return `Axis ${b.index} (${b.rest.toFixed(2)} → ${b.full.toFixed(2)})`;
  if (b.type === 'axis2') return `Axis ${b.index} (L ${b.left.toFixed(2)} · C ${b.center.toFixed(2)} · R ${b.right.toFixed(2)})`;
  return '?';
}

/**
 * Controller binding + calibration screen. Works with mouse, keyboard or the
 * gamepad itself (D-pad to move, A to activate, B/Start to close).
 */
export class ControllerSetup {
  constructor(input, root) {
    this.input = input; this.root = root; this.isOpen = false; this.capture = null;
    this.expanded = new Set(['steer', 'throttle', 'brake']);
    input.onDevicesChanged = () => this.isOpen && this.render();
    this.navPrev = {};
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { this.isOpen = true; this.root.classList.add('open'); this.render(); this.focusIndex = 0; }
  close() { this.cancelCapture(); this.isOpen = false; this.root.classList.remove('open'); this.input.save(); this.onClose?.(); }

  render() {
    const inp = this.input, pads = inp.gamepads(), pad = inp.activePad(), prof = inp.profile();
    const g = inp.data.global;
    this.root.innerHTML = '';
    const panel = h('div', { class: 'panel setup' });
    panel.append(h('div', { class: 'panel-head' },
      h('h2', {}, 'Controls & Calibration'),
      h('button', { class: 'btn', onclick: () => this.close() }, 'Close (Esc / Start)')));

    // device row
    const sel = h('select', { onchange: (e) => { inp.activeIndex = +e.target.value; this.render(); } });
    if (!pads.length) sel.append(h('option', {}, 'No controller detected — press a button on it'));
    for (const p of pads) {
      const o = h('option', { value: p.index }, `#${p.index} ${p.id.slice(0, 60)}`);
      if (pad && p.index === pad.index) o.selected = true;
      sel.append(o);
    }
    panel.append(h('div', { class: 'row' }, h('label', {}, 'Device'), sel,
      pad ? h('span', { class: 'tag ' + (pad.mapping === 'standard' ? 'ok' : 'warn') }, pad.mapping === 'standard' ? 'Standard mapping' : 'Custom device — bind & calibrate below') : null));

    // global settings
    const slider = (label, value, min, max, step, onInput, fmt = (v) => v.toFixed(2)) => {
      const out = h('span', { class: 'val' }, fmt(value));
      const r = h('input', { type: 'range', min, max, step, value });
      r.addEventListener('input', () => { onInput(+r.value); out.textContent = fmt(+r.value); });
      return h('div', { class: 'row' }, h('label', {}, label), r, out);
    };
    const modeSel = h('select', { onchange: (e) => { g.steeringMode = e.target.value; inp.save(); this.onSettingsChanged?.(); } },
      h('option', { value: 'pad' }, 'Gamepad (smoothed, speed-sensitive, countersteer assist)'),
      h('option', { value: 'wheel' }, 'Wheel (direct 1:1, no filtering)'));
    modeSel.value = g.steeringMode;
    panel.append(h('div', { class: 'grid2' },
      h('div', {},
        h('div', { class: 'row' }, h('label', {}, 'Steering mode'), modeSel),
        slider('Rumble strength', g.rumble, 0, 1, 0.05, (v) => { g.rumble = v; inp.save(); }),
        h('div', { class: 'row' }, h('label', {}, ''),
          h('button', { class: 'btn', onclick: () => { inp._lastRumble = 0; inp.rumble(1, 1, 400); } }, 'Test rumble'),
          h('button', { class: 'btn', onclick: () => { inp.resetProfile(); this.render(); } }, 'Reset to defaults'))),
      h('div', {},
        slider('Keyboard steer speed', inp.data.keyboard.steerSpeed, 1, 8, 0.25, (v) => { inp.data.keyboard.steerSpeed = v; inp.save(); }),
        h('p', { class: 'hint' }, 'Keyboard: W/S or ↑/↓ throttle/brake · A/D or ←/→ steer · Space handbrake · E/Q shift · Z clutch · C camera · R reset · T telemetry · Tab tuning · M mute'))));

    // raw view
    this.rawBox = h('div', { class: 'raw' });
    panel.append(h('h3', {}, 'Raw inputs'), this.rawBox);

    // actions
    panel.append(h('h3', {}, 'Bindings'));
    const table = h('div', { class: 'actions' });
    this.liveEls = {};
    for (const a of ACTIONS) {
      const b = prof?.bindings[a.id]?.[0];
      const bar = h('div', { class: 'bar' + (a.kind === 'bipolar' ? ' bi' : '') }, h('i'));
      this.liveEls[a.id] = { bar };
      const row = h('div', { class: 'action' },
        h('span', { class: 'name' }, a.label),
        h('span', { class: 'bind' }, prof ? describe(b) : 'connect a controller'),
        bar,
        h('button', { class: 'btn', disabled: pad ? null : '', onclick: () => this.startCapture(a) }, 'Bind'),
        h('button', { class: 'btn ghost', disabled: pad ? null : '', onclick: () => { prof.bindings[a.id] = []; inp.save(); this.render(); } }, 'Clear'),
        a.kind !== 'button' ? h('button', { class: 'btn ghost', onclick: () => { this.expanded.has(a.id) ? this.expanded.delete(a.id) : this.expanded.add(a.id); this.render(); } }, this.expanded.has(a.id) ? '▾' : '▸') : h('span'));
      table.append(row);
      if (a.kind !== 'button' && this.expanded.has(a.id) && prof) {
        const c = prof.curves[a.id];
        const cv = h('canvas', { width: 120, height: 90, class: 'curve' });
        this.liveEls[a.id].curve = cv;
        const sl = (lbl, key, min, max, step) => slider(lbl, c[key], min, max, step, (v) => { c[key] = v; inp.save(); });
        const extra = [];
        if (b && (b.type === 'axis2')) extra.push(h('button', { class: 'btn', onclick: () => { b.center = pad.axes[b.index]; inp.save(); this.render(); } }, 'Re-centre now'));
        if (b && (b.type === 'axis')) extra.push(h('button', { class: 'btn', onclick: () => { [b.rest, b.full] = [b.full, b.rest]; inp.save(); this.render(); } }, 'Invert'));
        if (b && (b.type === 'axis2')) extra.push(h('button', { class: 'btn', onclick: () => { [b.left, b.right] = [b.right, b.left]; inp.save(); this.render(); } }, 'Invert'));
        table.append(h('div', { class: 'curvebox' }, cv,
          h('div', { class: 'sliders' },
            sl('Inner deadzone', 'deadzone', 0, 0.5, 0.01),
            sl('Outer saturation', 'saturation', 0.5, 1, 0.01),
            sl('Linearity (γ)', 'linearity', 0.4, 3, 0.05),
            h('div', { class: 'row' }, h('label', {}, ''), ...extra))));
      }
    }
    panel.append(table);
    this.captureBox = h('div', { class: 'capture' });
    panel.append(this.captureBox);
    this.root.append(panel);
    this.updateCaptureBox();
  }

  // ---------------------------------------------------------------- capture
  startCapture(action) {
    const pad = this.input.activePad(); if (!pad) return;
    this.input.suspended = true;
    this.capture = {
      action, phase: action.kind === 'bipolar' ? 'right' : 'any',
      baseAxes: [...pad.axes], baseButtons: pad.buttons.map((b) => b.value > 0.5 || b.pressed),
      best: null, t: 0, holdT: 0,
    };
    this.updateCaptureBox();
  }
  cancelCapture() { this.capture = null; this.input.suspended = false; this.updateCaptureBox(); }

  updateCaptureBox() {
    if (!this.captureBox) return;
    const c = this.capture;
    this.captureBox.classList.toggle('show', !!c);
    if (!c) return;
    const msg = c.phase === 'right' ? `Turn <b>${c.action.label}</b> fully RIGHT and hold…`
      : c.phase === 'left' ? 'Now turn fully LEFT and hold…'
        : c.action.kind === 'button' ? `Press the control for <b>${c.action.label}</b>…`
          : `Press <b>${c.action.label}</b> all the way and hold… (pedal, trigger, axis or button)`;
    this.captureBox.innerHTML = `<div class="cap"><p>${msg}</p><p class="hint">Release everything else first. Esc to cancel.</p><button class="btn" id="capCancel">Cancel</button></div>`;
    this.captureBox.querySelector('#capCancel').onclick = () => this.cancelCapture();
  }

  _tickCapture(dt, pad) {
    const c = this.capture, prof = this.input.profile();
    c.t += dt;
    if (this.input.keys.has('Escape')) { this.cancelCapture(); return; }
    if (c.t < 0.25) return; // debounce the click that started capture
    // buttons (also analog triggers on standard mapping)
    if (c.phase === 'any') {
      for (let i = 0; i < pad.buttons.length; i++) {
        const v = pad.buttons[i].value > 0.5 || pad.buttons[i].pressed;
        if (v && !c.baseButtons[i]) { prof.bindings[c.action.id] = [{ type: 'button', index: i }]; return this._finish(); }
      }
    }
    // axes: find the axis with the largest deviation from baseline
    let bi = -1, bd = 0;
    pad.axes.forEach((v, i) => {
      if (c.phase === 'left') { // same axis, and it must be on the other side of centre
        if (i !== c.axis || Math.sign(v - c.baseAxes[i]) === Math.sign(c.right - c.baseAxes[i])) return;
      }
      const d = Math.abs(v - c.baseAxes[i]); if (d > bd) { bd = d; bi = i; }
    });
    if (bd > 0.4) {
      const v = pad.axes[bi];
      if (!c.best || c.best.index !== bi) c.best = { index: bi, value: v };
      // track the furthest point reached; the timer only restarts when it moves further out
      if (Math.abs(v - c.baseAxes[bi]) > Math.abs(c.best.value - c.baseAxes[bi]) + 0.01) { c.best.value = v; c.holdT = 0; }
      else c.holdT += dt;
      if (c.holdT > 0.5) { // held near the extreme long enough
        const rest = c.baseAxes[bi], ext = c.best.value;
        if (c.phase === 'right') { c.axis = bi; c.right = ext; c.phase = 'left'; c.best = null; c.holdT = 0; c.t = 0; this.updateCaptureBox(); return; }
        if (c.phase === 'left') {
          prof.bindings[c.action.id] = [{ type: 'axis2', index: c.axis, left: ext, center: rest, right: c.right }];
          return this._finish();
        }
        // snap typical pedal ranges to clean limits
        const snap = (x) => (Math.abs(Math.abs(x) - 1) < 0.03 ? Math.sign(x) : Math.abs(x) < 0.03 ? 0 : x);
        prof.bindings[c.action.id] = [{ type: 'axis', index: bi, rest: snap(rest), full: snap(ext) }];
        return this._finish();
      }
    }
  }
  _finish() { this.input.save(); this.capture = null; setTimeout(() => { this.input.suspended = false; }, 300); this.render(); }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.isOpen) return;
    const inp = this.input, pad = inp.activePad(), prof = inp.profile();
    if (this.capture && pad) this._tickCapture(dt, pad);

    // raw display
    if (this.rawBox) {
      if (!pad) this.rawBox.textContent = 'No controller. Connect one and press any button (browsers only expose a pad after a button press).';
      else {
        let html = '<div class="axes">';
        pad.axes.forEach((v, i) => { html += `<div class="ax"><span>A${i}</span><div class="bar bi"><i style="left:${50 + Math.min(0, v) * 50}%;width:${Math.abs(v) * 50}%"></i></div><em>${v.toFixed(2)}</em></div>`; });
        html += '</div><div class="btns">';
        pad.buttons.forEach((b, i) => { html += `<span class="b${b.pressed || b.value > 0.5 ? ' on' : ''}" title="${b.value.toFixed(2)}">${i}</span>`; });
        this.rawBox.innerHTML = html + '</div>';
      }
    }
    // live processed values + curve plots
    if (pad && prof) {
      for (const a of ACTIONS) {
        const el = this.liveEls?.[a.id]; if (!el) continue;
        const v = inp.readAction(pad, prof, a.id);
        const i = el.bar.firstChild;
        if (a.kind === 'bipolar') { i.style.left = `${50 + Math.min(0, v) * 50}%`; i.style.width = `${Math.abs(v) * 50}%`; }
        else { i.style.left = '0'; i.style.width = `${Math.abs(v) * 100}%`; }
        if (el.curve) {
          let raw = 0; for (const b of prof.bindings[a.id] || []) raw = Math.max(raw, Math.abs(inp.readBinding(pad, b)));
          drawCurve(el.curve, prof.curves[a.id], raw);
        }
      }
    }
    this._gamepadNav(pad);
  }

  _gamepadNav(pad) {
    if (!pad || pad.mapping !== 'standard' || this.capture) return;
    const edge = (i) => { const v = pad.buttons[i]?.pressed; const was = this.navPrev[i]; this.navPrev[i] = v; return v && !was; };
    const focusables = [...this.root.querySelectorAll('button:not([disabled]), select, input')];
    if (!focusables.length) return;
    const cur = focusables.indexOf(document.activeElement);
    const move = (d) => { const n = focusables[(Math.max(0, cur) + d + focusables.length) % focusables.length]; n.focus(); n.scrollIntoView({ block: 'nearest' }); };
    if (edge(13)) move(1);
    if (edge(12)) move(-1);
    const el = document.activeElement;
    if (edge(14) || edge(15)) {
      const dir = pad.buttons[15]?.pressed ? 1 : -1;
      if (el?.type === 'range') { el.value = +el.value + dir * +el.step * 2; el.dispatchEvent(new Event('input')); }
      else if (el?.tagName === 'SELECT') { el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir)); el.dispatchEvent(new Event('change')); }
      else move(dir);
    }
    if (edge(0) && el && focusables.includes(el)) el.click();
    if (edge(1) || edge(9)) this.close();
  }
}

function drawCurve(cv, c, raw) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.beginPath(); ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2;
  for (let i = 0; i <= 60; i++) { const x = i / 60, y = applyCurve(x, c); i ? ctx.lineTo(x * W, H - y * H) : ctx.moveTo(x * W, H - y * H); }
  ctx.stroke();
  const y = applyCurve(raw, c);
  ctx.fillStyle = '#ffca28'; ctx.beginPath(); ctx.arc(raw * W, H - y * H, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10px system-ui';
  ctx.fillText(`in ${raw.toFixed(2)} → out ${y.toFixed(2)}`, 4, 12);
}
