// Unified input: keyboard + any Gamepad API device (pads, wheels, pedals, shifters).
// Every action is produced by a binding -> calibration -> response curve pipeline.
// Profiles are stored per controller id in localStorage.

const STORAGE_KEY = 'vehicleSim.input.v1';

export const ACTIONS = [
  { id: 'steer', label: 'Steering', kind: 'bipolar' },
  { id: 'throttle', label: 'Throttle', kind: 'analog' },
  { id: 'brake', label: 'Brake', kind: 'analog' },
  { id: 'handbrake', label: 'Handbrake', kind: 'analog' },
  { id: 'clutch', label: 'Clutch', kind: 'analog' },
  { id: 'shiftUp', label: 'Shift up', kind: 'button' },
  { id: 'shiftDown', label: 'Shift down', kind: 'button' },
  { id: 'camera', label: 'Change camera', kind: 'button' },
  { id: 'lookBack', label: 'Look back', kind: 'button' },
  { id: 'reset', label: 'Reset car', kind: 'button' },
  { id: 'telemetry', label: 'Telemetry', kind: 'button' },
  { id: 'menu', label: 'Menu', kind: 'button' },
];

const DEFAULT_CURVE = { deadzone: 0.05, saturation: 1.0, linearity: 1.0 };
const DEFAULT_CURVES = {
  steer: { deadzone: 0.08, saturation: 0.98, linearity: 1.3 },
  throttle: { deadzone: 0.03, saturation: 0.98, linearity: 1.0 },
  brake: { deadzone: 0.03, saturation: 0.95, linearity: 1.0 },
  handbrake: { deadzone: 0.05, saturation: 0.9, linearity: 1.0 },
  clutch: { deadzone: 0.05, saturation: 0.95, linearity: 1.0 },
};

// Xbox/PlayStation "standard" mapping defaults
export function standardBindings() {
  return {
    steer: [{ type: 'axis2', index: 0, left: -1, center: 0, right: 1 }],
    throttle: [{ type: 'button', index: 7 }],
    brake: [{ type: 'button', index: 6 }],
    handbrake: [{ type: 'button', index: 0 }],
    clutch: [{ type: 'button', index: 4 }],
    shiftUp: [{ type: 'button', index: 1 }],
    shiftDown: [{ type: 'button', index: 2 }],
    camera: [{ type: 'button', index: 3 }],
    lookBack: [{ type: 'button', index: 5 }],
    reset: [{ type: 'button', index: 8 }],
    telemetry: [{ type: 'button', index: 12 }],
    menu: [{ type: 'button', index: 9 }],
  };
}
// unknown devices (wheels/pedals): a guess the user should calibrate
function genericBindings() {
  return {
    steer: [{ type: 'axis2', index: 0, left: -1, center: 0, right: 1 }],
    throttle: [{ type: 'axis', index: 1, rest: 1, full: -1 }],
    brake: [{ type: 'axis', index: 2, rest: 1, full: -1 }],
    handbrake: [], clutch: [],
    shiftUp: [{ type: 'button', index: 5 }], shiftDown: [{ type: 'button', index: 4 }],
    camera: [{ type: 'button', index: 3 }], lookBack: [], reset: [{ type: 'button', index: 8 }],
    telemetry: [], menu: [{ type: 'button', index: 9 }],
  };
}

const KEYS = {
  steerLeft: ['ArrowLeft', 'KeyA'], steerRight: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  handbrake: ['Space'], clutch: ['KeyZ'],
  shiftUp: ['KeyE', 'ShiftLeft'], shiftDown: ['KeyQ', 'ControlLeft'],
  camera: ['KeyC'], lookBack: ['KeyB'], reset: ['KeyR'], telemetry: ['KeyT'], menu: ['Escape'],
};

export function applyCurve(v, c) {
  // v is 0..1 magnitude. inner deadzone -> outer saturation -> power curve
  const span = Math.max(1e-3, c.saturation - c.deadzone);
  let x = Math.min(1, Math.max(0, (v - c.deadzone) / span));
  return Math.pow(x, c.linearity);
}

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0 };
    this.buttons = {}; this.pressed = {}; // pressed = rising edge this frame
    for (const a of ACTIONS) { this.buttons[a.id] = false; this.pressed[a.id] = false; }
    this.kb = { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0 };
    this.activeIndex = null;  // selected gamepad index
    this.lastDevice = 'keyboard';
    this.suspended = false;   // UI capture mode
    this.load();

    addEventListener('keydown', (e) => {
      // typing in a form field doesn't drive the car, but Escape still closes the menu
      if (e.code !== 'Escape' && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => {
      if (this.activeIndex === null) this.activeIndex = e.gamepad.index;
      this.ensureProfile(e.gamepad);
      this.onDevicesChanged?.();
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (this.activeIndex === e.gamepad.index) this.activeIndex = null;
      this.onDevicesChanged?.();
    });
  }

  // ---------------------------------------------------------------- persistence
  load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* storage unavailable */ }
    this.data = data && data.profiles ? data : { profiles: {}, keyboard: { steerSpeed: 3.5 }, global: { rumble: 0.7, steeringMode: 'pad', steerSensitivity: 0.6 } };
    this.data.global = { rumble: 0.7, steeringMode: 'pad', steerSensitivity: 0.6, ...this.data.global };
  }
  save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }

  gamepads() { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean); }
  activePad() {
    const pads = this.gamepads();
    if (this.activeIndex !== null) { const p = pads.find((g) => g.index === this.activeIndex); if (p) return p; }
    if (pads.length) { this.activeIndex = pads[0].index; this.ensureProfile(pads[0]); return pads[0]; }
    return null;
  }
  ensureProfile(pad) {
    if (!this.data.profiles[pad.id]) {
      const curves = structuredClone(DEFAULT_CURVES);
      // non-standard devices are usually wheels/pedals: linear, no centre deadzone
      if (pad.mapping !== 'standard') curves.steer = { deadzone: 0, saturation: 1, linearity: 1 };
      this.data.profiles[pad.id] = {
        bindings: pad.mapping === 'standard' ? standardBindings() : genericBindings(),
        curves,
        standard: pad.mapping === 'standard',
      };
      this.save();
    }
    const prof = this.data.profiles[pad.id];
    for (const a of ACTIONS) { prof.bindings[a.id] ??= []; if (a.kind !== 'button') prof.curves[a.id] ??= { ...DEFAULT_CURVE }; }
    return prof;
  }
  profile() { const p = this.activePad(); return p ? this.ensureProfile(p) : null; }
  resetProfile() {
    const pad = this.activePad(); if (!pad) return;
    delete this.data.profiles[pad.id]; this.ensureProfile(pad); this.save();
  }

  // ---------------------------------------------------------------- reading
  /** raw normalised value 0..1 (or -1..1 for axis2) of a single binding */
  readBinding(pad, b) {
    if (!pad || !b) return 0;
    if (b.type === 'button') {
      // analog triggers report value 0..1 (and set `pressed` at ~10%), so prefer value
      const btn = pad.buttons[b.index]; if (!btn) return 0;
      if (typeof btn !== 'object') return btn;
      return btn.value > 0 ? btn.value : (btn.pressed ? 1 : 0);
    }
    const raw = pad.axes[b.index]; if (raw === undefined) return 0;
    if (b.type === 'axis') { const v = (raw - b.rest) / (b.full - b.rest || 1); return Math.min(1, Math.max(0, v)); }
    if (b.type === 'axis2') { // works for inverted axes too: left/right are whatever raw values were captured
      const d = raw - b.center, dr = b.right - b.center, dl = b.left - b.center;
      if (dr !== 0 && Math.sign(d) === Math.sign(dr)) return Math.min(1, d / dr);
      if (dl !== 0 && Math.sign(d) === Math.sign(dl)) return -Math.min(1, d / dl);
      return 0;
    }
    return 0;
  }
  /** processed value of an action from the gamepad (after curves) */
  readAction(pad, prof, id) {
    const bs = prof.bindings[id] || [];
    let v = 0;
    for (const b of bs) { const r = this.readBinding(pad, b); if (Math.abs(r) > Math.abs(v)) v = r; }
    const act = ACTIONS.find((a) => a.id === id);
    if (act.kind === 'button') return v > 0.5 ? 1 : 0;
    const c = prof.curves[id] || DEFAULT_CURVE;
    const out = applyCurve(Math.abs(v), c) * Math.sign(v);
    return act.kind === 'bipolar' ? out : Math.max(0, out);
  }

  update(dt) {
    const k = this.keys, has = (list) => list.some((c) => k.has(c));
    // keyboard: digital keys ramp so they behave like analog inputs
    const ramp = (cur, target, up, down) => cur + Math.max(-down * dt, Math.min(up * dt, target - cur));
    const ks = this.data.keyboard.steerSpeed;
    const steerT = (has(KEYS.steerRight) ? 1 : 0) - (has(KEYS.steerLeft) ? 1 : 0);
    const returning = steerT === 0 || Math.sign(steerT) !== Math.sign(this.kb.steer);
    this.kb.steer = ramp(this.kb.steer, steerT, returning ? ks * 2 : ks, returning ? ks * 2 : ks);
    this.kb.throttle = ramp(this.kb.throttle, has(KEYS.throttle) ? 1 : 0, 5, 10);
    this.kb.brake = ramp(this.kb.brake, has(KEYS.brake) ? 1 : 0, 6, 10);
    this.kb.handbrake = has(KEYS.handbrake) ? 1 : 0;
    this.kb.clutch = ramp(this.kb.clutch, has(KEYS.clutch) ? 1 : 0, 8, 8);

    const pad = this.activePad(), prof = pad ? this.ensureProfile(pad) : null;
    const s = this.state;
    const btn = {};
    for (const a of ACTIONS) btn[a.id] = a.kind === 'button' ? has(KEYS[a.id] || []) : false;
    let padActivity = 0;
    if (pad && !this.suspended) {
      for (const id of ['steer', 'throttle', 'brake', 'handbrake', 'clutch']) {
        const v = this.readAction(pad, prof, id);
        this.padState = this.padState || {};
        this.padState[id] = v;
        padActivity = Math.max(padActivity, Math.abs(v));
      }
      for (const a of ACTIONS) if (a.kind === 'button' && this.readAction(pad, prof, a.id)) { btn[a.id] = true; padActivity = 1; }
    }
    if (padActivity > 0.15) this.lastDevice = 'gamepad';
    const ps = this.padState || {};
    // merge: whichever device has the larger magnitude wins per action
    for (const id of ['steer', 'throttle', 'brake', 'handbrake', 'clutch']) {
      const a = this.kb[id], b = pad && !this.suspended ? ps[id] || 0 : 0;
      s[id] = Math.abs(a) >= Math.abs(b) ? a : b;
    }
    for (const a of ACTIONS) {
      if (a.kind !== 'button') continue;
      const v = this.suspended ? false : btn[a.id];
      this.pressed[a.id] = v && !this.buttons[a.id];
      this.buttons[a.id] = v;
    }
    this.padConnected = !!pad;
  }

  /** dual-rumble feedback; strong = impacts/limiter, weak = slip/ABS */
  rumble(strong, weak, ms = 120) {
    const pad = this.activePad(); const g = this.data.global.rumble;
    if (!pad || g <= 0 || !pad.vibrationActuator) return;
    const now = performance.now();
    if (now - (this._lastRumble || 0) < ms * 0.8) return;
    this._lastRumble = now;
    strong = Math.min(1, strong * g); weak = Math.min(1, weak * g);
    if (strong < 0.02 && weak < 0.02) return;
    try { pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* unsupported */ }
  }
}
