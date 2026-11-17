import { PRESETS } from '../vehicles/presets.js';
import { BOT_SKILLS, BOT_PARAMS, BOT_SKILL_DEFAULTS, MISTAKE_TYPES, saveBotSkills, resetBotSkill, resetAllBotSkills } from '../game/BotDriver.js';
import { MAX_OPPONENTS } from '../game/Race.js';

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

const TABS = [['race', 'Create Race'], ['ai', 'Bot AI'], ['controls', 'Controls'], ['vehicle', 'Vehicle']];

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
    else { this.body.append(this.controlsRoot); this.setup.open(); }
    this.body.querySelector('button, select, input')?.focus();
  }

  update(dt) {
    if (!this.isOpen) return;
    if (this.tab === 'controls') this.setup.update(dt);      // live input bars + its own pad navigation
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
  _race() {
    const app = this.app, s = { ...app.raceSettings, map: app.mapId };
    const select = (value, options, onchange) => {
      const el = h('select', { onchange: (e) => onchange(e.target.value) }, ...options.map(([v, label]) => h('option', { value: v }, label)));
      el.value = String(value); return el;
    };
    const slotSel = () => {
      const n = s.opponents + 1;
      return select(Math.min(s.slot, n), Array.from({ length: n }, (_, i) => [i + 1, i === 0 ? 'Pole (P1)' : i === n - 1 ? `P${i + 1} (back of the grid)` : `P${i + 1}`]), (v) => (s.slot = +v));
    };
    let slotRow = h('div', { class: 'row' }, h('label', {}, 'Your grid slot'), slotSel());
    const maps = Object.entries(app.maps).filter(([, m]) => m);
    const box = h('div', { class: 'race-form' },
      h('p', { class: 'hint' }, 'Line up on the grid against AI opponents in the same car as you, then wait for the five red lights to go out.'),
      h('div', { class: 'row' }, h('label', {}, 'Track'), select(s.map, maps.map(([id, m]) => [id, m.name]), (v) => (s.map = v))),
      h('div', { class: 'row' }, h('label', {}, 'Opponents'), select(s.opponents, Array.from({ length: MAX_OPPONENTS }, (_, i) => [i + 1, String(i + 1)]), (v) => {
        s.opponents = +v; s.slot = Math.min(s.slot, s.opponents + 1);
        const next = h('div', { class: 'row' }, h('label', {}, 'Your grid slot'), slotSel()); slotRow.replaceWith(next); slotRow = next;
      })),
      h('div', { class: 'row' }, h('label', {}, 'Opponent skill'), select(s.skill, BOT_SKILLS.map((k, i) => [i, k.name]), (v) => (s.skill = +v))),
      h('div', { class: 'row' }, h('label', {}, 'Laps'), select(s.laps, [[0, 'Practice (no limit)'], [1, '1'], [3, '3'], [5, '5'], [10, '10'], [20, '20']], (v) => (s.laps = +v))),
      slotRow,
      h('div', { class: 'row' }, h('label', {}, 'Vehicle'), h('span', {}, app.vehicle.config.name), h('button', { class: 'btn ghost', onclick: () => this.show('vehicle') }, 'Change…')),
      h('div', { class: 'row btnrow' },
        h('label', {}, ''),
        h('button', { class: 'btn primary', onclick: () => { this.close(); app.createRace(s); } }, 'Start race'),
        app.race ? h('button', { class: 'btn', onclick: () => { app.endRace(); this.show('race'); } }, 'End current race') : null),
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

  // ---------------------------------------------------------------- Vehicle
  _vehicle() {
    const app = this.app;
    const grid = h('div', { class: 'cars' });
    PRESETS.forEach((cfg, i) => {
      if (cfg.name === 'Base') return;
      const card = h('button', { class: 'car' + (i === app.presetIndex ? ' active' : ''), onclick: () => { app.loadPreset(i); this.show('vehicle'); } },
        h('b', {}, cfg.name),
        h('span', { class: 'spec' }, `${cfg.body.mass} kg · ~${peakHp(cfg)} hp · ${cfg.drivetrain.layout}`),
        h('span', { class: 'desc' }, cfg.description || ''));
      grid.append(card);
    });
    return h('div', {}, h('p', { class: 'hint' }, 'Pick a car. Opponents in a race drive the same car. Tab opens the tuning panel for the current car.'), grid);
  }
}
