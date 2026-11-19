import { PRESETS } from '../vehicles/presets.js';
import { BOT_SKILLS, BOT_PARAMS, BOT_SKILL_DEFAULTS, MISTAKE_TYPES, saveBotSkills, resetBotSkill, resetAllBotSkills } from '../game/BotDriver.js';
import { MAX_OPPONENTS } from '../game/Race.js';
import { MAX_SLOTS, SLOT_KINDS } from '../net/Multiplayer.js';
import { FLOW_OPTIONS } from '../render/Graphics.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};

const TABS = [['race', 'Create Race'], ['ai', 'Bot AI'], ['audio', 'Audio'], ['graphics', 'Graphics'], ['controls', 'Controls'], ['vehicle', 'Vehicle']];

/** rough peak power from the torque curve (no boost), in hp */
const peakHp = (cfg) => Math.round(Math.max(...cfg.engine.torqueCurve.map(([rpm, nm]) => (nm * rpm) / 9549)) * 1.341 * (1 + (cfg.engine.turbo?.maxBoost || 0)));

/**
 * Main menu (Esc / Start): Create Race, Controls (binding + calibration) and Vehicle tabs.
 * Pauses the game while open. Gamepad: LB/RB switch tabs, D-pad moves, A selects, B/Start closes.
 */
export class Menu {
  constructor(app, root) {
    this.app = app; this.root = root; this.isOpen = false; this.tab = 'race'; this.navPrev = {};
    this.panel = h('div', { class: 'panel menu' });
    this.tabBar = h('div', { class: 'tabs' }, ...TABS.map(([id, label]) => h('button', { class: 'tab', 'data-tab': id, onclick: () => this.show(id) }, label)),
      h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => this.close() }, 'Close (Esc / Start)'));
    this.body = h('div', { class: 'tabbody' });
    this.controlsRoot = h('div', { class: 'controls-root' });
    this.panel.append(this.tabBar, this.body);
    root.append(this.panel);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open(tab = this.tab) { this.isOpen = true; this.root.classList.add('open'); this.show(tab); }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.root.classList.remove('open');
    if (this.setup?.isOpen) { this.setup.onClose = null; this.setup.close(); this.setup.onClose = () => this.close(); }
  }

  show(tab) {
    this.tab = tab;
    for (const b of this.tabBar.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
    if (tab !== 'controls' && this.setup?.isOpen) { this.setup.onClose = null; this.setup.close(); this.setup.onClose = () => this.close(); }
    this.body.innerHTML = '';
    if (tab === 'race') this.body.append(this._race());
    else if (tab === 'vehicle') this.body.append(this._vehicle());
    else if (tab === 'ai') this.body.append(this._ai());
    else if (tab === 'audio') this.body.append(this._audio());
    else if (tab === 'graphics') this.body.append(this._graphics());
    else { this.body.append(this.controlsRoot); this.setup.open(); }
    this.body.querySelector('button, select, input')?.focus();
  }

  update(dt) {
    if (!this.isOpen) return;
    if (this.tab === 'controls') this.setup.update(dt);      // live input bars + its own pad navigation
    if (this.tab === 'graphics' && this._clock) { this._clock.textContent = this.app.gfx.hourText; if (document.activeElement !== this._hourSlider) this._hourSlider.value = this.app.gfx.s.hour; }
    const pad = this.app.input.activePad();
    if (!pad || pad.mapping !== 'standard') return;
    const edge = (i) => { const v = pad.buttons[i]?.pressed; const was = this.navPrev[i]; this.navPrev[i] = v; return v && !was; };
    const ids = TABS.map((t) => t[0]), k = ids.indexOf(this.tab);
    if (edge(4)) this.show(ids[(k + ids.length - 1) % ids.length]);
    if (edge(5)) this.show(ids[(k + 1) % ids.length]);
    if (this.tab === 'controls') return;
    const focusables = [...this.body.querySelectorAll('button:not([disabled]), select, input')];
    const cur = focusables.indexOf(document.activeElement);
    const move = (d) => { const n = focusables[(Math.max(0, cur) + d + focusables.length) % focusables.length]; n?.focus(); n?.scrollIntoView({ block: 'nearest' }); };
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

  // ---------------------------------------------------------------- Create Race
  /** grid slots, P1 first: 'you', 'bot', 'open' (a player can join online), 'na' */
  _slots(s) {
    if (Array.isArray(s.slots) && s.slots.length === MAX_SLOTS) return s.slots;
    const n = Math.min(MAX_OPPONENTS, s.opponents ?? 3) + 1, mine = Math.max(1, Math.min(n, s.slot ?? 1)) - 1;
    return Array.from({ length: MAX_SLOTS }, (_, i) => (i === mine ? 'you' : i < n ? 'bot' : 'na'));
  }

  _race() {
    const app = this.app, net = app.net, s = { ...app.raceSettings, map: app.mapId };
    s.slots = this._slots(s);
    const save = () => { const { map, ...rest } = s; app.raceSettings = rest; net.refreshLobby(); };
    const select = (value, options, onchange, attrs = {}) => {
      const el = h('select', { onchange: (e) => onchange(e.target.value), ...attrs }, ...options.map(([v, label]) => h('option', { value: v }, label)));
      el.value = String(value); return el;
    };
    const maps = Object.entries(app.maps).filter(([, m]) => m);
    const online = net.active, host = net.isHost, guest = online && !host;
    const nameIn = h('input', { type: 'text', value: app.playerName, maxlength: 16, class: 'text', onchange: (e) => { app.playerName = e.target.value.trim() || 'Player'; } });

    // ---- the grid: one dropdown per slot
    const grid = h('div', { class: 'slots' });
    const drawSlots = () => {
      grid.innerHTML = '';
      const lobby = online ? net.lobby : null;
      for (let i = 0; i < MAX_SLOTS; i++) {
        let el;
        const ls = lobby?.slots?.[i];
        if (ls?.k === 'human') el = h('div', { class: 'slot-name' + (ls.id === net.id ? ' me' : '') }, ls.id === net.id ? `${ls.name} (you)` : ls.name);
        else if (guest) el = h('div', { class: 'slot-name dim' }, ls ? (ls.k === 'bot' ? 'Bot' : ls.k === 'open' ? 'Open (player)' : 'NA') : '…');
        else {
          const kind = online ? ls?.k ?? 'na' : s.slots[i];
          const opts = online ? SLOT_KINDS : [['you', `${app.playerName} (you)`], ...SLOT_KINDS];
          el = select(kind, opts, (v) => {
            if (online) { net.setSlot(i, v); drawSlots(); return; }
            if (v === 'you') s.slots = s.slots.map((k) => (k === 'you' ? 'bot' : k));
            else if (s.slots[i] === 'you') { this.app.hud.showToast('Pick another slot for yourself first', 1500); drawSlots(); return; }
            s.slots[i] = v; save(); drawSlots();
          });
        }
        grid.append(h('div', { class: 'slot' }, h('span', { class: 'pos' }, `P${i + 1}`), el));
      }
      const bots = online ? (lobby?.slots ?? []).filter((x) => x.k === 'bot').length : s.slots.filter((k) => k === 'bot').length;
      const players = online ? (lobby?.slots ?? []).filter((x) => x.k === 'human').length : 1;
      const open = online ? (lobby?.slots ?? []).filter((x) => x.k === 'open').length : s.slots.filter((k) => k === 'open').length;
      grid.append(h('div', { class: 'slot-sum' }, online ? `${players} player${players === 1 ? '' : 's'} · ${bots} bot${bots === 1 ? '' : 's'}${open ? ` · ${open} open` : ''}` : `Solo against ${bots} bot${bots === 1 ? '' : 's'}${open ? ` · ${open} player slot${open === 1 ? '' : 's'} (fill when you host online)` : ''}`));
    };
    drawSlots();
    net.onChange = () => { if (!this.isOpen || this.tab !== 'race') return; if (guest !== (net.active && !net.isHost) || online !== net.active) { this.show('race'); return; } if (guest) { this.show('race'); return; } drawSlots(); statusEl.textContent = net.status; buttons(); };

    // ---- online: shared password through the relay
    const pw = h('input', { type: 'password', placeholder: 'Password', class: 'text', value: net.password || '' });
    const statusEl = h('span', { class: 'net-status' }, net.status);
    const btnBox = h('span', { class: 'net-btns' });
    const run = (p) => p.catch((e) => { statusEl.textContent = e.message; });
    const buttons = () => {
      btnBox.innerHTML = '';
      if (!net.active) {
        btnBox.append(
          h('button', { class: 'btn primary', onclick: () => { app.playerName = nameIn.value.trim() || 'Player'; save(); run(net.host(pw.value, s.slots).then(() => this.show('race'))); } }, 'Host match'),
          h('button', { class: 'btn', onclick: () => { app.playerName = nameIn.value.trim() || 'Player'; run(net.join(pw.value).then(() => this.show('race'))); } }, 'Join match'));
      } else btnBox.append(h('button', { class: 'btn', onclick: () => { net.leave(); this.show('race'); } }, 'Leave'));
    };
    buttons();

    const startBtn = guest ? h('span', { class: 'hint' }, 'The host starts the race.')
      : h('button', { class: 'btn primary', onclick: () => {
        save();
        if (online) {
          if (s.map !== app.mapId) { net._pendingMap(s.map); return; }      // the host moves everyone to the new track
          this.close(); net.startRace(); return;
        }
        const lineup = s.slots.filter((k) => k === 'you' || k === 'bot').map((k) => ({ kind: k === 'you' ? 'me' : 'bot' }));
        if (lineup.length < 2) { app.hud.showToast('Set at least one slot to Bot (or host online for players)', 2000); return; }
        this.close(); app.createRace({ map: s.map, laps: s.laps, skill: s.skill, lineup, slots: s.slots, opponents: lineup.length - 1, slot: lineup.findIndex((l) => l.kind === 'me') + 1 });
      } }, online ? 'Start online race' : 'Start race');

    const lockIfGuest = guest ? { disabled: 'disabled' } : {};
    const box = h('div', { class: 'race-form' },
      h('p', { class: 'hint' }, 'Line up on the grid against AI opponents in the same car as you, then wait for the five red lights to go out. Host online to race friends: everyone types the same password.'),
      h('div', { class: 'row' }, h('label', {}, 'Your name'), nameIn),
      h('div', { class: 'row' }, h('label', {}, 'Track'), select(online ? net.lobby?.map ?? app.mapId : s.map, maps.map(([id, m]) => [id, m.name]), (v) => { s.map = v; }, lockIfGuest)),
      h('div', { class: 'row' }, h('label', {}, 'Bot skill'), select(online ? net.lobby?.skill ?? s.skill : s.skill, BOT_SKILLS.map((k, i) => [i, k.name]), (v) => { s.skill = +v; save(); }, lockIfGuest)),
      h('div', { class: 'row' }, h('label', {}, 'Laps'), select(online ? net.lobby?.laps ?? s.laps : s.laps, [[0, 'Practice (no limit)'], [1, '1'], [3, '3'], [5, '5'], [10, '10'], [20, '20']], (v) => { s.laps = +v; save(); }, lockIfGuest)),
      h('div', { class: 'row' }, h('label', {}, 'Vehicle'), h('span', {}, app.vehicle.config.name), guest ? h('span', { class: 'hint' }, '(set by the host)') : h('button', { class: 'btn ghost', onclick: () => this.show('vehicle') }, 'Change…')),
      h('h3', {}, 'Grid'), grid,
      h('h3', {}, 'Play online'),
      h('div', { class: 'row' }, h('label', {}, 'Connect'), pw, btnBox),
      h('div', { class: 'row' }, h('label', {}, ''), statusEl),
      h('p', { class: 'hint' }, 'Type the same password on both sides, then one presses Host match and the others Join match. Joining players take the open Player slots. Runs through a free public relay: share the password only with the people you are racing.'),
      h('div', { class: 'row btnrow' },
        h('label', {}, ''), startBtn,
        app.race ? h('button', { class: 'btn', onclick: () => { app.endRace(); this.show('race'); } }, online && !host ? 'Leave race' : 'End current race') : null),
      h('p', { class: 'hint' }, 'Quick keys: O = practice against one opponent · K = opponent skill · 1 = restart from the grid'));
    return box;
  }

  // ---------------------------------------------------------------- Bot AI
  _ai() {
    const app = this.app, lvl = this.aiLevel ?? app.raceSettings.skill;
    this.aiLevel = lvl;
    const sk = BOT_SKILLS[lvl], def = BOT_SKILL_DEFAULTS[lvl];
    const levels = h('div', { class: 'levels' }, ...BOT_SKILLS.map((k, i) => h('button', { class: 'tab' + (i === lvl ? ' active' : ''), onclick: () => { this.aiLevel = i; this.show('ai'); } }, k.name)));
    const sliders = BOT_PARAMS.map((p) => {
      const out = h('span', { class: 'val' }, p.fmt(sk[p.key]));
      const r = h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: sk[p.key], title: p.help });
      r.addEventListener('input', () => {
        sk[p.key] = +r.value; out.textContent = p.fmt(sk[p.key]); saveBotSkills();
        if (p.key === 'grip' || p.key === 'brake') app.race?.refreshSkills();   // pace and braking points change at once
      });
      const mark = Math.abs(sk[p.key] - def[p.key]) > 1e-9 ? ' *' : '';
      return h('div', { class: 'row' }, h('label', {}, p.label + mark), r, out);
    });
    const log = app.race ? app.race.mistakeSummary() : [];
    const mistakes = log.length ? h('div', { class: 'mistakes' }, h('h3', {}, 'Mistakes in the current race'),
      ...log.map((b) => h('div', { class: 'row' }, h('label', {}, h('i', { class: 'dot', style: `background:${b.color}` }), b.name),
        h('span', {}, b.log.length ? MISTAKE_TYPES.map((t) => [t, b.log.filter((m) => m === t).length]).filter(([, n]) => n).map(([t, n]) => `${n}× ${t}`).join(' · ') : 'none yet')))) : null;
    return h('div', { class: 'ai-form' },
      h('p', { class: 'hint' }, 'Each skill level has its own settings. Changes are saved and take effect straight away, even mid-race. A mistake is rolled for at every corner: late braking, a missed apex, a sliding exit or over-braking.'),
      levels, ...sliders,
      h('div', { class: 'row btnrow' }, h('label', {}, ''),
        h('button', { class: 'btn', onclick: () => { resetBotSkill(lvl); app.race?.refreshSkills(); this.show('ai'); } }, `Reset ${sk.name}`),
        h('button', { class: 'btn ghost', onclick: () => { resetAllBotSkills(); app.race?.refreshSkills(); this.show('ai'); } }, 'Reset all levels')),
      h('p', { class: 'hint' }, '* = changed from the default. Hover a slider for what it does.'),
      mistakes);
  }

  // ---------------------------------------------------------------- Audio
  _graphics() {
    const g = this.app.gfx, S = g.s;
    const slider = (label, key, min, max, step, fmt, hint) => {
      const out = h('span', { class: 'val' }, fmt(S[key]));
      const r = h('input', { type: 'range', min, max, step, value: S[key], title: hint });
      r.addEventListener('input', () => { g.set(key, +r.value); out.textContent = fmt(S[key]); });
      return { row: h('div', { class: 'row' }, h('label', {}, label), r, out), input: r, out };
    };
    const shadow = slider('Shadow distance', 'shadowDistance', 0, 200, 5, (v) => (v ? `${v} m` : 'Off'), 'How far around the car shadows are drawn (0 turns them off)');
    const scale = slider('Render scale', 'renderScale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, 'Below 100% draws fewer pixels (faster); above 100% is sharper but heavier');
    const time = slider('Time of day', 'hour', 0, 24, 0.05, () => g.hourText, 'Drag to set the time');
    this._clock = time.out; this._hourSlider = time.input;
    const flow = h('select', { onchange: (e) => g.set('flow', +e.target.value) }, ...FLOW_OPTIONS.map(([v, label]) => h('option', { value: v }, label)));
    flow.value = String(S.flow);
    const pct = (v) => `${Math.round(v * 100)}%`;
    const sunI = slider('Sun intensity', 'sunIntensity', 0, 3, 0.05, pct, 'Brightness of the sun (100% is the map\'s own daylight)');
    const moonI = slider('Moon intensity', 'moonIntensity', 0, 10, 0.1, pct, 'Brightness of the moonlight at night');
    const colour = (label, key, hint) => {
      const c = h('input', { type: 'color', value: S[key], title: hint });
      c.addEventListener('input', () => g.set(key, c.value));
      return h('div', { class: 'row' }, h('label', {}, label), c, h('span', { class: 'hint' }, hint));
    };
    return h('div', { class: 'ai-form' },
      h('p', { class: 'hint' }, 'Shadows, resolution and the sky. Time of day moves the sun (and the moon at night), the colour of the sky and fog and the light levels; the clock can run on its own so a race can end at dusk.'),
      shadow.row, scale.row, time.row,
      h('div', { class: 'row' }, h('label', {}, 'Time flow'), flow, h('span', { class: 'hint' }, 'How fast the clock runs')),
      h('h3', {}, 'Sun and moon'),
      sunI.row, colour('Sun colour', 'sunColor', 'Noon colour; it warms towards the horizon'),
      moonI.row, colour('Moon colour', 'moonColor', 'Moonlight colour at night'),
      h('div', { class: 'row btnrow' }, h('label', {}, ''),
        h('button', { class: 'btn', onclick: () => { g.reset(); this.show('graphics'); } }, 'Reset graphics')));
  }

  _audio() {
    const au = this.app.audio, S = au.settings;
    const slider = (label, key, hint) => {
      const out = h('span', { class: 'val' }, `${Math.round(S[key] * 100)}%`);
      const r = h('input', { type: 'range', min: 0, max: key === 'master' ? 1 : 1.5, step: 0.05, value: S[key], title: hint });
      r.addEventListener('input', () => { au.set(key, +r.value); out.textContent = `${Math.round(S[key] * 100)}%`; });
      return h('div', { class: 'row' }, h('label', {}, label), r, out);
    };
    const check = (label, key, hint) => {
      const c = h('input', { type: 'checkbox', title: hint }); c.checked = !!S[key];
      c.addEventListener('change', () => { au.set(key, c.checked); this.show('audio'); });
      return h('div', { class: 'row' }, h('label', {}, label), c, h('span', { class: 'hint' }, hint));
    };
    return h('div', { class: 'ai-form' },
      h('p', { class: 'hint' }, 'Every car has its own sound: engine (with a turbo whistle on boosted cars), tyre squeal, loose-surface and kerb rumble, wall scrapes and impacts. Opponents are heard in space, with distance, stereo position and Doppler. Settings save in the browser and apply at once.'),
      slider('Master volume', 'master', 'Overall level'),
      slider('Engines', 'engine', 'Your engine, the opponents\' engines and the turbo whistle'),
      slider('Tyres & surfaces', 'tyres', 'Squeal, gravel and grass rumble, kerb rumble'),
      slider('Impacts & scrapes', 'impacts', 'Wall and car hits, landings, scraping barriers'),
      slider('Wind', 'wind', 'Wind noise at speed (your car only)'),
      slider('Opponents', 'opponents', 'How loud the other cars are overall'),
      check('3D positioning', 'spatial', 'Opponents get quieter with distance and move across the stereo image'),
      check('Doppler effect', 'doppler', 'Pitch shift as cars pass (needs 3D positioning)'),
      check('Mute everything', 'muted', 'Same as the M key'),
      h('div', { class: 'row btnrow' }, h('label', {}, 'Try it'),
        h('button', { class: 'btn', onclick: () => au.preview('engine') }, 'Engine'),
        h('button', { class: 'btn', onclick: () => au.preview('squeal') }, 'Tyre squeal'),
        h('button', { class: 'btn', onclick: () => au.preview('impact') }, 'Impact'),
        h('button', { class: 'btn ghost', onclick: () => { au.resetSettings(); this.show('audio'); } }, 'Reset')));
  }

  // ---------------------------------------------------------------- Vehicle
  _vehicle() {
    const app = this.app;
    const grid = h('div', { class: 'cars' });
    PRESETS.forEach((cfg, i) => {
      if (cfg.name === 'Base') return;
      const card = h('div', { class: 'car' + (i === app.presetIndex ? ' active' : ''), role: 'button', tabindex: '0', onclick: () => { app.loadPreset(i); this.show('vehicle'); } },
        h('div', { class: 'carhead' }, h('b', {}, cfg.name),
          h('button', { class: 'btn small edit', title: `Open ${cfg.name}'s settings`, onclick: (e) => { e.stopPropagation(); app.loadPreset(i); this.close(); if (!app.tuning.isOpen) app.tuning.toggle(); else app.tuning.render(); } }, 'Edit')),
        h('span', { class: 'spec' }, `${cfg.body.mass} kg · ~${peakHp(cfg)} hp · ${cfg.drivetrain.layout}`),
        h('span', { class: 'desc' }, cfg.description || ''));
      grid.append(card);
    });
    return h('div', {}, h('p', { class: 'hint' }, 'Pick a car. Opponents in a race drive the same car. Edit opens that car\'s settings (Tab does the same for the current car).'), grid);
  }
}
