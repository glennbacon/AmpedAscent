// Menus: title, Adventure, Garage, Settings, My Levels, pause and both end cards.
// Plain DOM built on demand; one "screen" is mounted at a time, sheets stack over the title.

import { AudioEngine, MOTOR_VOICES } from '../audio/audio';
import { MAX_LEVELS, Save } from '../core/save';
import { CAMPAIGN, firstClearBonus, isUnlocked, levelId, levelLength, levelRating, starCount, worldOfLevel } from '../sim/campaign';
import { carRating, formatRating } from '../sim/climbs';
import { CFG } from '../sim/config';
import { EndCause } from '../sim/run';
import {
  DEFAULT_TUNING, deriveStats, isDetuned, statBars, STOCK_LOADOUT, TUNING_PRESETS, Tuning, UPGRADE_IDS, UPGRADE_INFO, upgradeCost, UpgradeId,
} from '../sim/upgrades';
import { WORLDS, WORLD_ORDER } from '../sim/worlds';
import { btn, fmt, h, hex } from './dom';
import { icon } from './icons';

export interface GameApi {
  save: Save;
  audio: AudioEngine;
  playEndless(): void;
  playCampaign(id: string): void;
  playCustom(index: number): void;
  editLevel(index: number | null): void;
  toTitle(): void;
  openGarage(tab?: GarageTab): void;
  closeGarage(): void;
  resume(): void;
  restart(): void;
  revive(): void;
  nextLevel(): void;
  backToEditor(): void;
  settingsChanged(): void;
  loadoutChanged(): void;
}

export type GarageTab = 'upgrades' | 'tuning' | 'sound';

export interface GameOverData {
  cause: EndCause;
  endless: boolean;
  distance: number;
  best: number;
  newBest: boolean;
  pickupCoins: number;
  stuntCoins: number;
  distanceCoins: number;
  banked: number;
  flips: number;
  stunts: number;
  bestMultiplier: number;
  topSpeed: number;
  canRevive: boolean;
  canEdit: boolean;
  custom: boolean;
  /** Rating of the climb that stopped the run, if one did. */
  stalledRating: number | null;
  carRating: number;
  climbs: number;
}

export interface CompleteData {
  title: string;
  campaignLevel: number | null; // 1…15 for campaign levels
  priorStars: number;
  earnedStars: number;
  starBonus: number;
  runCoins: number;
  distanceCoins: number;
  banked: number;
  time: number;
  hasNext: boolean;
  canEdit: boolean;
  bestMultiplier: number;
  batteryPct: number;
  custom: boolean;
}

export class Menus {
  private screen: HTMLElement | null = null;
  private toasts: HTMLDivElement;
  private garageTab: GarageTab = 'upgrades';
  private advWorld = 1;
  /** Name of the mounted screen ('' when none). */
  current = '';

  constructor(private root: HTMLElement, private api: GameApi) {
    this.toasts = h('div', { class: 'toasts' });
    root.append(this.toasts);
  }

  private mount(name: string, el: HTMLElement) {
    this.screen?.remove();
    this.screen = el;
    this.current = name;
    this.root.insertBefore(el, this.toasts);
  }
  close() {
    this.screen?.remove();
    this.screen = null;
    this.current = '';
  }

  toast(text: string, bad = false) {
    const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, text);
    this.toasts.append(t);
    t.addEventListener('animationend', () => t.remove());
  }

  private tap<T extends (...a: any[]) => void>(fn: T): T {
    return ((...a: any[]) => {
      this.api.audio.unlock();
      this.api.audio.ui();
      fn(...a);
    }) as T;
  }

  private coinChip(): HTMLElement {
    return h('div', { class: 'chip coins', html: `${icon('coin')}<span>${fmt(this.api.save.data.coins)}</span>` });
  }

  private sheet(name: string, title: string, sub: string | null, body: (Node | null)[], footer: (Node | null)[], opts: { wide?: boolean; onScrim?: () => void; head?: Node[] } = {}) {
    const scrim = h('div', { class: 'scrim' });
    if (opts.onScrim) scrim.addEventListener('click', opts.onScrim);
    const head = h('header', null, h('h2', null, title, sub ? h('small', null, sub) : null), ...(opts.head ?? []));
    const sh = h('div', { class: `sheet${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title }, head, h('div', { class: 'rail' }), h('div', { class: 'body' }, ...body), footer.length ? h('footer', null, ...footer) : null);
    this.mount(name, h('div', { class: 'screen' }, scrim, sh));
    return sh;
  }

  // ---------------------------------------------------------------- title
  showTitle() {
    const s = this.api.save;
    const d = s.data;
    const stars = Object.values(d.stars).reduce((a, m) => a + starCount(m), 0);
    const logo = h('div', { class: 'logo', html: `AMPED<span class="l2">${icon('bolt')}ASCENT</span><small>ELECTRIC HILL CLIMB</small>` });
    const menu = h(
      'div',
      { class: 'menu' },
      btn('Endless Drive', this.tap(() => this.api.playEndless()), { icon: 'bolt', cls: 'big primary', sub: d.best > 0 ? `Best ${fmt(d.best)} m` : 'How far can you get on one charge?' }),
      btn('Adventure', this.tap(() => this.showAdventure()), { icon: 'flag', sub: `${stars} / ${CAMPAIGN.worlds * CAMPAIGN.levelsPerWorld * 3} stars` }),
      btn('Garage', this.tap(() => this.api.openGarage(isDetuned(d.tuning) ? 'tuning' : 'upgrades')), { icon: 'wrench', sub: isDetuned(d.tuning) ? 'Custom tune active' : 'Upgrades · Tuning', badge: s.affordableUpgrade() }),
      btn('My Levels', this.tap(() => this.showLevels()), { icon: 'pencil', sub: `${d.levels.length} / ${MAX_LEVELS} built` }),
      btn('Settings', this.tap(() => this.showSettings(() => this.showTitle())), { icon: 'gear', sub: 'Sound · Graphics' }),
    );
    const el = h('div', { class: 'screen title' }, h('div', { class: 'top' }, logo, this.coinChip()), menu, h('div', { class: 'foot' }, 'Gas → / D   ·   Brake ← / A   ·   Jump Space   ·   Pause Esc'));
    this.mount('title', el);
  }

  // ---------------------------------------------------------------- adventure
  showAdventure(world = this.advWorld) {
    this.advWorld = world;
    const d = this.api.save.data;
    const done = new Set(d.completed);
    const total = Object.entries(d.stars).reduce((a, [, m]) => a + starCount(m), 0);
    const worldStars = (w: number) => {
      let n = 0;
      for (let l = 1; l <= CAMPAIGN.levelsPerWorld; l++) n += starCount(d.stars[levelId(w, l)] ?? 0);
      return n;
    };
    const cards = h('div', { class: 'worlds' });
    for (let w = 1; w <= CAMPAIGN.worlds; w++) {
      const def = WORLDS[WORLD_ORDER[w - 1]];
      const card = h('button', { class: `world${w === world ? ' sel' : ''}`, type: 'button' }, h('span', null, def.name), h('small', { html: `${icon('star')} ${worldStars(w)} / ${CAMPAIGN.levelsPerWorld * 3}` }));
      card.style.setProperty('--g1', hex(def.sky[0]));
      card.style.setProperty('--g2', hex(def.sky[2]));
      card.style.setProperty('--g3', hex(def.sky[3]));
      card.style.setProperty('--gr', hex(def.ground.top));
      card.addEventListener('click', this.tap(() => this.showAdventure(w)));
      cards.append(card);
    }
    const def = WORLDS[worldOfLevel(world)];
    const grid = h('div', { class: 'levelgrid' });
    const mine = carRating(this.api.save.loadout);
    let nextMarked = false;
    for (let l = 1; l <= CAMPAIGN.levelsPerWorld; l++) {
      const id = levelId(world, l);
      const open = isUnlocked(id, done, d.devUnlock);
      const mask = d.stars[id] ?? 0;
      const isNext = open && !done.has(id) && !nextMarked;
      if (isNext) nextMarked = true;
      const pips = h('span', { class: 'pips', html: [1, 2, 4].map((b) => `<span class="${mask & b ? 'on' : ''}">${icon('star')}</span>`).join('') });
      // Each level states the climb rating its steepest wall needs; amber/red when the car is short.
      const need = levelRating(world, l);
      const gap = need - mine;
      const req = h('small', { class: `req${gap > 1 ? ' far' : gap > 0.05 ? ' under' : ''}`, html: `${icon('mountain')}${formatRating(need)}` });
      const cell = h('button', { class: `lvl${done.has(id) ? ' done' : ''}${isNext ? ' next' : ''}${open ? '' : ' locked'}`, type: 'button',
        title: open ? `${def.name} ${l} — ${levelLength(l)} m — climb rating ${formatRating(need)} (your car: ${formatRating(mine)})` : 'Clear the previous level to unlock' },
        open ? String(l) : h('span', { html: icon('lock') }), open ? pips : null, req);
      cell.addEventListener('click', () => {
        if (!open) {
          this.api.audio.deny();
          this.toast(`Clear ${def.name} ${l - 1} first`, true);
          return;
        }
        if (gap > 0.05) this.toast(`This level's climbs are rated ${formatRating(need)} — your car is ${formatRating(mine)}`);
        this.tap(() => this.api.playCampaign(id))();
      });
      grid.append(cell);
    }
    this.sheet(
      'adventure',
      'Adventure',
      `${total} / ${CAMPAIGN.worlds * CAMPAIGN.levelsPerWorld * 3} stars · every world is open from level 1`,
      [cards, h('div', { class: 'worldhead' }, h('h3', null, def.name), h('span', { html: `${def.tagline} &nbsp;·&nbsp; Your climb rating <b class="mine">${formatRating(mine)}</b>` })), grid,
        h('p', { class: 'note', html: `${icon('mountain')} is the climb rating a level's steepest wall needs — raise yours with <b>Motor</b> and <b>Traction</b> in the Garage. Stars: <b>finish</b>, reach a <b>×${CFG.masteryComboMultiplier} combo</b>, finish with <b>${Math.round(CFG.masteryBatteryFraction * 100)}% charge</b>.` })],
      [btn('Back', this.tap(() => this.showTitle()), { icon: 'chevL' })],
      { wide: true, onScrim: () => this.showTitle() },
    );
  }

  // ---------------------------------------------------------------- garage
  showGarage(tab: GarageTab = this.garageTab) {
    this.garageTab = tab;
    const s = this.api.save;
    const d = s.data;
    const lo = s.loadout;
    const bars = statBars(lo);
    const sb = h('div', { class: 'statbars' });
    for (const [label, v] of [['Power', bars.power], ['Top speed', bars.speed], ['Grip', bars.grip], ['Composure', bars.composure], ['Agility', bars.agility]] as const) {
      sb.append(h('span', null, label), h('div', { class: 'sb' }, h('i', { style: { width: `${Math.round(6 + v * 94)}%` } })));
    }
    const rating = h('div', { class: 'rating' },
      h('span', { html: `${icon('mountain')} Climb rating` }), h('b', null, formatRating(carRating(lo))),
      h('small', null, 'Climbs in Endless and Adventure are rated. A car below a climb\'s rating stalls on it — raise Motor and Traction together.'));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const [id, label, ic] of [['upgrades', 'Upgrades', 'bolt'], ['tuning', 'Tuning', 'wrench'], ['sound', 'Motor', 'speaker']] as const) {
      const t = h('button', { class: `tab${id === tab ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(id === tab), html: `${icon(ic)}<span>${label}</span>` });
      t.addEventListener('click', this.tap(() => this.showGarage(id)));
      tabs.append(t);
    }
    const body = h('div', { class: 'gbody' });
    if (tab === 'upgrades') this.fillUpgrades(body);
    else if (tab === 'tuning') this.fillTuning(body);
    else this.fillSound(body);
    const panel = h('div', { class: 'panel' }, rating, sb, tabs, body, h('div', { class: 'gfoot' }, btn('Drive!', this.tap(() => this.api.playEndless()), { icon: 'play', cls: 'primary' })));
    const top = h('div', { class: 'gtop' }, btn('', this.tap(() => this.api.closeGarage()), { icon: 'chevL', cls: 'icon', title: 'Back' }), h('div', { class: 'gtitle' }, 'GARAGE'), this.coinChip());
    this.mount('garage', h('div', { class: 'screen garage' }, top, panel));
    void d;
  }

  private fillUpgrades(body: HTMLElement) {
    const s = this.api.save;
    const d = s.data;
    const dev = d.devUnlock;
    const effect = (id: UpgradeId, tier: number): string => {
      const st = deriveStats({ ...STOCK_LOADOUT, tiers: { ...STOCK_LOADOUT.tiers, [id]: tier } });
      const b = deriveStats(STOCK_LOADOUT);
      const pct = (a: number, base: number) => `${a >= base ? '+' : ''}${Math.round((a / base - 1) * 100)}%`;
      switch (id) {
        case 'motor': return `${pct(st.driveForce, b.driveForce)} torque · ${Math.round(st.topSpeed * 3.6)} km/h`;
        case 'traction': return `${pct(st.grip, b.grip)} grip`;
        case 'suspension': return `${pct(st.dampRebound, b.dampRebound)} damping · ${pct(st.bumpTravel, b.bumpTravel)} travel`;
        case 'flip': return `×${(1 + CFG.flipTier * tier).toFixed(1)} air rotation`;
      }
    };
    // What buying the next tier does to the climb rating (the number the walls are measured in).
    const now = carRating(s.loadout);
    const ratingDelta = (id: UpgradeId): string => {
      if (id !== 'motor' && id !== 'traction') return '';
      const lo = s.loadout;
      const next = carRating({ ...lo, tiers: { ...lo.tiers, [id]: lo.tiers[id] + 1 } });
      return next - now > 0.04 ? `  ·  climb ${formatRating(now)} → ${formatRating(next)}` : '  ·  climb rating held back by the other upgrade';
    };
    for (const id of UPGRADE_IDS) {
      const tier = dev ? CFG.upgradeMaxTier : d.tiers[id];
      const maxed = tier >= CFG.upgradeMaxTier;
      const cost = maxed ? 0 : upgradeCost(tier);
      const can = d.coins >= cost;
      const pips = h('div', { class: 'pips' }, ...Array.from({ length: CFG.upgradeMaxTier }, (_, i) => h('i', { class: i < tier ? 'on' : '' })));
      const buy = btn(maxed ? 'Maxed' : fmt(cost), () => {
        if (s.buyUpgrade(id)) {
          this.api.audio.buy();
          this.api.loadoutChanged();
          this.showGarage('upgrades');
        } else {
          this.api.audio.deny();
          this.toast(`Need ${fmt(cost - d.coins)} more coins`, true);
        }
      }, { icon: maxed ? 'check' : 'coin', cls: `small ${can && !maxed ? 'gold' : ''}` });
      body.append(
        h('div', { class: `up${maxed ? ' maxed' : ''}` },
          h('h4', null, UPGRADE_INFO[id].name, pips),
          buy,
          h('p', null, UPGRADE_INFO[id].blurb, ' ', h('span', { class: 'effect' }, maxed ? effect(id, tier) : `${effect(id, tier)}  →  ${effect(id, tier + 1)}${ratingDelta(id)}`)),
        ),
      );
    }
    const owned = d.has4WD || dev;
    const can4 = d.coins >= CFG.fourWDPrice;
    const buy4 = btn(owned ? 'Owned' : fmt(CFG.fourWDPrice), () => {
      if (s.buy4WD()) {
        this.api.audio.buy();
        this.api.loadoutChanged();
        this.showGarage('upgrades');
      } else {
        this.api.audio.deny();
        this.toast(`Need ${fmt(CFG.fourWDPrice - d.coins)} more coins`, true);
      }
    }, { icon: owned ? 'check' : 'coin', cls: `small ${can4 && !owned ? 'gold' : ''}`, disabled: owned });
    body.append(
      h('div', { class: 'up' }, h('h4', null, 'Four-wheel drive'), buy4,
        h('p', null, 'The front axle joins in whenever its tyres bite — the biggest single step up the climb ratings. Toggle it in Tuning. ',
          h('span', { class: 'effect' }, owned ? 'Installed' : `climb ${formatRating(now)} → ${formatRating(carRating({ ...s.loadout, has4WD: true, tuning: { ...s.loadout.tuning, fourWD: true } }))}`))),
    );
    if (dev) body.append(h('p', { class: 'note' }, 'Developer unlock is ON — the car runs maxed; your save is untouched.'));
  }

  private fillTuning(body: HTMLElement) {
    const s = this.api.save;
    const d = s.data;
    const t = d.tuning;
    const changed = () => {
      s.commit();
      this.api.loadoutChanged();
    };
    const presets = h('div', { class: 'presets' });
    for (const p of TUNING_PRESETS) {
      const on = (['gearing', 'stiffness', 'balance', 'flipSpeed'] as const).every((k) => Math.abs(t[k] - p.tuning[k]) < 0.01);
      presets.append(
        btn(p.name, this.tap(() => {
          Object.assign(t, p.tuning);
          changed();
          this.showGarage('tuning');
        }), { cls: `small${on ? ' primary' : ''}`, sub: p.blurb }),
      );
    }
    body.append(presets);
    const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}%`;
    const slider = (key: keyof Tuning, label: string, lo: string, hi: string, min: number, max: number, describe: (v: number) => string) => {
      const val = h('span', null, describe(t[key] as number));
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: '0.02', value: String(t[key]), 'aria-label': label });
      inp.addEventListener('input', () => {
        (t as any)[key] = parseFloat(inp.value);
        val.textContent = describe(t[key] as number);
      });
      inp.addEventListener('change', () => {
        changed();
        this.showGarage('tuning');
      });
      body.append(h('div', { class: 'slider' }, h('div', { class: 'lab' }, label, val), inp, h('div', { class: 'ends' }, h('span', null, lo), h('span', null, hi))));
    };
    slider('gearing', 'Gearing', 'Short — torque', 'Tall — top speed', -1, 1, (v) => (Math.abs(v) < 0.02 ? 'Stock' : `${pct(-14 * v)} torque · ${pct(14 * v)} speed`));
    slider('stiffness', 'Suspension', 'Soft', 'Firm', -1, 1, (v) => (Math.abs(v) < 0.02 ? 'Stock' : `${pct(18 * v)} spring rate`));
    slider('balance', 'Weight balance', 'Rear — wheelies', 'Front — planted', -1, 1, (v) => (Math.abs(v) < 0.02 ? 'Stock' : `${Math.round(Math.abs(v) * 16)} cm ${v < 0 ? 'rearward' : 'forward'}`));
    const ceil = 1 + CFG.flipTier * (d.devUnlock ? CFG.upgradeMaxTier : d.tiers.flip);
    slider('flipSpeed', 'Flip speed', 'Slow flip', 'Fast flip', 0, 1, (v) => `×${(Math.min(0.6, ceil) + (ceil - Math.min(0.6, ceil)) * v).toFixed(2)} of ×${ceil.toFixed(1)}`);
    const owned = d.has4WD || d.devUnlock;
    const tog = h('button', { class: `toggle${owned && t.fourWD ? ' on' : ''}`, type: 'button', disabled: !owned, role: 'switch', 'aria-checked': String(owned && t.fourWD) },
      h('span', null, 'Four-wheel drive', h('small', null, owned ? 'On: more pull. Off: livelier tail, easier wheelies.' : `Unlock in Upgrades — ${fmt(CFG.fourWDPrice)} coins`)), h('span', { class: 'sw' }));
    tog.addEventListener('click', this.tap(() => {
      t.fourWD = !t.fourWD;
      changed();
      this.showGarage('tuning');
    }));
    body.append(tog);
    body.append(btn('Reset tuning', this.tap(() => {
      Object.assign(t, { ...DEFAULT_TUNING, fourWD: t.fourWD });
      changed();
      this.showGarage('tuning');
    }), { icon: 'restart', cls: 'small ghost' }));
  }

  private fillSound(body: HTMLElement) {
    const s = this.api.save;
    const d = s.data;
    body.append(h('p', { class: 'note', style: { margin: '0 0 0.7em', textAlign: 'left' } }, 'Pick your motor voice. Each tap revs it.'));
    const grid = h('div', { class: 'voices' });
    MOTOR_VOICES.forEach((v, i) => {
      grid.append(
        btn(v.name, () => {
          this.api.audio.unlock();
          d.settings.motorVoice = i;
          s.commit();
          this.api.audio.setMotorVoice(i);
          this.api.audio.previewMotor();
          this.showGarage('sound');
        }, { icon: 'speaker', cls: `small${d.settings.motorVoice === i ? ' primary' : ''}` }),
      );
    });
    body.append(grid);
  }

  // ---------------------------------------------------------------- settings
  showSettings(back: () => void) {
    const s = this.api.save;
    const st = s.data.settings;
    const vol = (key: 'sfx' | 'music', label: string) => {
      const val = h('span', null, `${Math.round(st[key] * 100)}%`);
      const inp = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(st[key]), 'aria-label': label });
      inp.addEventListener('input', () => {
        st[key] = parseFloat(inp.value);
        val.textContent = `${Math.round(st[key] * 100)}%`;
        this.api.audio.unlock();
        this.api.settingsChanged();
      });
      inp.addEventListener('change', () => {
        s.commit();
        if (key === 'sfx') this.api.audio.coin();
      });
      return h('div', { class: 'field' }, h('label', null, label, val), inp);
    };
    const hap = h('button', { class: `toggle${st.haptics ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(st.haptics) }, h('span', null, 'Vibration', h('small', null, 'Landings and crashes buzz on phones that support it.')), h('span', { class: 'sw' }));
    hap.addEventListener('click', this.tap(() => {
      st.haptics = !st.haptics;
      s.commit();
      this.showSettings(back);
    }));
    const seg = h('div', { class: 'seg' });
    for (const q of ['auto', 'low', 'medium', 'high'] as const) {
      seg.append(btn(q, this.tap(() => {
        st.quality = q;
        s.commit();
        this.api.settingsChanged();
        this.showSettings(back);
      }), { cls: `small${st.quality === q ? ' on' : ''}` }));
    }
    let armed = false;
    const reset = btn('Reset all progress', () => {
      if (!armed) {
        armed = true;
        reset.querySelector('.lbl')!.textContent = 'Tap again to erase everything';
        this.api.audio.deny();
        return;
      }
      s.reset();
      this.api.loadoutChanged();
      this.toast('Progress reset');
      this.showSettings(back);
    }, { icon: 'trash', cls: 'small danger' });
    const dev = h('button', { class: `toggle${s.data.devUnlock ? ' on' : ''}`, type: 'button', role: 'switch' }, h('span', null, 'Developer unlock', h('small', null, 'All levels open, car maxed. Reversible — the save is never changed.')), h('span', { class: 'sw' }));
    dev.addEventListener('click', this.tap(() => {
      s.data.devUnlock = !s.data.devUnlock;
      s.commit();
      this.api.loadoutChanged();
      this.showSettings(back);
    }));
    const fs = btn('Fullscreen', this.tap(() => {
      const el = document.documentElement as any;
      // Optional everywhere: phones and embedded views may refuse it.
      try {
        const p = document.fullscreenElement ? document.exitFullscreen() : (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
        if (p && typeof p.catch === 'function') p.catch(() => this.toast('Fullscreen is not available here', true));
      } catch {
        this.toast('Fullscreen is not available here', true);
      }
    }), { icon: 'expand', cls: 'small ghost' });
    this.sheet(
      'settings', 'Settings', null,
      [vol('sfx', 'Sound effects'), vol('music', 'Music'), hap, h('div', { class: 'field' }, h('label', null, 'Graphics')), seg,
        h('p', { class: 'note', style: { textAlign: 'left' }, html: 'Drive: <b>→ / D</b> gas, <b>← / A</b> brake &amp; reverse. In the air, gas tips the nose up and brake tips it down. <b>Space</b> fires Jump Jets. On touch screens, hold the right or left side.' }),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '0.8em' } }, fs, reset), h('div', { style: { height: '8px' } }), dev],
      [btn('Done', this.tap(back), { icon: 'check', cls: 'primary' })],
      { onScrim: back },
    );
  }

  // ---------------------------------------------------------------- my levels
  showLevels() {
    const s = this.api.save;
    const levels = s.data.levels;
    const body: Node[] = [];
    if (!levels.length) body.push(h('div', { class: 'empty', html: 'No levels yet.<br>Build a track, drop in pickups and props, then drive it.' }));
    levels.forEach((lv, i) => {
      let armed = false;
      const name = h('b', null, lv.name);
      const del = btn('', () => {
        if (!armed) {
          armed = true;
          del.classList.add('danger');
          del.title = 'Tap again to delete';
          del.querySelector('span')!.insertAdjacentHTML('beforeend', '<span class="lbl">Sure?</span>');
          this.api.audio.deny();
          return;
        }
        s.deleteLevel(i);
        this.showLevels();
      }, { icon: 'trash', cls: 'small icon ghost', title: 'Delete' });
      const rename = btn('', () => {
        const inp = h('input', { class: 'text', value: lv.name, maxLength: 24, 'aria-label': 'Level name' });
        const commit = () => {
          const v = inp.value.trim();
          if (v) {
            lv.name = v.slice(0, 24);
            s.commit();
          }
          this.showLevels();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') this.showLevels();
          e.stopPropagation();
        });
        inp.addEventListener('blur', commit);
        name.replaceWith(inp);
        inp.focus();
        inp.select();
      }, { icon: 'pencil', cls: 'small icon ghost', title: 'Rename' });
      body.push(
        h('div', { class: 'lrow' },
          h('div', null, name, h('small', null, `${Math.round(lv.length)} m · ${WORLDS[lv.world].name} · ${lv.pickups.length} pickups · ${lv.props.length} props`)),
          h('div', { class: 'acts' }, btn('Play', this.tap(() => this.api.playCustom(i)), { icon: 'play', cls: 'small primary' }), btn('Edit', this.tap(() => this.api.editLevel(i)), { icon: 'wrench', cls: 'small' }), rename, del)),
      );
    });
    const full = levels.length >= MAX_LEVELS;
    this.sheet(
      'levels', 'My Levels', `${levels.length} / ${MAX_LEVELS} saved`, body,
      [btn('Back', this.tap(() => this.showTitle()), { icon: 'chevL' }), btn(full ? 'Level limit reached' : 'New level', this.tap(() => this.api.editLevel(null)), { icon: 'plus', cls: 'primary', disabled: full })],
      { onScrim: () => this.showTitle() },
    );
  }

  // ---------------------------------------------------------------- pause
  showPause(o: { title: string; canEdit: boolean }) {
    const body = [
      h('div', { class: 'stack', style: { gap: '8px' } },
        btn('Resume', this.tap(() => this.api.resume()), { icon: 'play', cls: 'primary big' }),
        btn('Restart', this.tap(() => this.api.restart()), { icon: 'restart' }),
        o.canEdit ? btn('Edit level', this.tap(() => this.api.backToEditor()), { icon: 'pencil' }) : null,
        btn('Settings', this.tap(() => this.showSettings(() => this.showPause(o))), { icon: 'gear' }),
        btn('Quit to menu', this.tap(() => this.api.toTitle()), { icon: 'home', cls: 'ghost' })),
    ];
    this.sheet('pause', 'Paused', o.title, body, []);
  }

  // ---------------------------------------------------------------- end cards
  showGameOver(g: GameOverData) {
    const s = this.api.save;

    const walled = g.stalledRating != null && g.cause !== 'wrecked';
    const headline = g.newBest ? 'NEW BEST!' : g.cause === 'wrecked' ? 'WRECKED!' : walled ? 'TOO STEEP!' : 'OUT OF CHARGE';
    const sub = g.cause === 'wrecked' ? 'The buggy ended up off its wheels.'
      : walled ? `Stopped by a climb rated ${formatRating(g.stalledRating!)} — your car is rated ${formatRating(g.carRating)}.`
      : 'The pack ran flat. Grab more green cells next time.';
    const rows = h('div', { class: 'rows' },
      h('div', { class: 'row' }, h('span', null, 'Pickups'), h('b', null, `+${fmt(g.pickupCoins)}`)),
      g.stuntCoins ? h('div', { class: 'row' }, h('span', null, `Stunts (${g.stunts})${g.flips ? ` · ${g.flips} flip${g.flips > 1 ? 's' : ''}` : ''}`), h('b', null, `+${fmt(g.stuntCoins)}`)) : null,
      h('div', { class: 'row' }, h('span', null, `Distance (${fmt(g.distance)} m)`), h('b', null, `+${fmt(g.distanceCoins)}`)),
      h('div', { class: 'row gold' }, h('span', null, 'Banked'), h('b', null, `${fmt(g.banked)} coins`)));
    const canAfford = s.data.coins >= CFG.reviveCost;
    const foot: (Node | null)[] = [];
    if (g.canRevive) {
      foot.push(btn(`Revive`, () => {
        if (!canAfford) {
          this.api.audio.deny();
          this.toast(`Revive costs ${CFG.reviveCost} coins`, true);
          return;
        }
        this.tap(() => this.api.revive())();
      }, { icon: 'heart', cls: canAfford ? 'gold' : '', sub: `${CFG.reviveCost} coins · once per run` }));
    }
    foot.push(btn(g.endless ? 'Drive again' : 'Retry', this.tap(() => this.api.restart()), { icon: 'restart', cls: 'primary' }));
    if (g.canEdit) foot.push(btn('Edit level', this.tap(() => this.api.backToEditor()), { icon: 'pencil' }));
    else foot.push(btn('Garage', this.tap(() => this.api.openGarage('upgrades')), { icon: 'wrench', badge: s.affordableUpgrade() }));
    foot.push(btn('Menu', this.tap(() => this.api.toTitle()), { icon: 'home', cls: 'ghost' }));
    this.sheet(
      'gameover', '', null,
      [h('div', { class: 'result' },
        h('div', { class: `headline${g.newBest ? ' best' : ''}` }, headline), h('div', { class: 'subline' }, sub),
        h('div', { class: 'bigstat' },
          h('div', null, h('b', null, `${fmt(g.distance)} m`), h('small', null, 'DISTANCE')),
          g.endless ? h('div', null, h('b', null, `${fmt(g.best)} m`), h('small', null, 'BEST')) : null,
          g.climbs ? h('div', null, h('b', null, String(g.climbs)), h('small', null, g.climbs === 1 ? 'CLIMB TOPPED' : 'CLIMBS TOPPED'))
            : h('div', null, h('b', null, `×${g.bestMultiplier}`), h('small', null, 'BEST COMBO'))),
        rows,
        g.custom ? h('p', { class: 'note' }, 'Player-built levels are for fun — they do not bank coins.')
          : walled ? h('p', { class: 'note', html: `That face needs more pull and more bite: upgrade <b>Motor</b> and <b>Traction</b> together${s.affordableUpgrade() ? ' — you can afford one now.' : '.'}` })
          : s.affordableUpgrade() ? h('p', { class: 'note', html: 'You can afford an <b>upgrade</b> — visit the Garage.' }) : null)],
      foot,
    );
    this.screen!.querySelector('header')!.remove();
  }

  showComplete(c: CompleteData) {
    const starRow = h('div', { class: 'stars' });
    const labels = ['Finish', `×${CFG.masteryComboMultiplier} combo`, `${Math.round(CFG.masteryBatteryFraction * 100)}% charge`];
    const detail = ['', `best ×${c.bestMultiplier}`, `${c.batteryPct}% left`];
    [1, 2, 4].forEach((bit, i) => {
      const on = !!(c.earnedStars & bit) || !!(c.priorStars & bit);
      const fresh = !!(c.earnedStars & bit) && !(c.priorStars & bit);
      const el = h('div', { class: `star${fresh ? ' new' : ''}`, html: icon('star') }, h('small', null, labels[i], detail[i] ? h('div', null, detail[i]) : null));
      starRow.append(el);
      if (on) {
        setTimeout(() => {
          el.classList.add('on');
          if (fresh) this.api.audio.star(i);
        }, 350 + i * 300);
      }
    });
    const rows = h('div', { class: 'rows' },
      h('div', { class: 'row' }, h('span', null, 'Pickups & stunts'), h('b', null, `+${fmt(c.runCoins)}`)),
      h('div', { class: 'row' }, h('span', null, 'Distance'), h('b', null, `+${fmt(c.distanceCoins)}`)),
      c.starBonus ? h('div', { class: 'row' }, h('span', null, `New stars × ${fmt(firstClearBonus(c.campaignLevel ?? 1))}`), h('b', null, `+${fmt(c.starBonus)}`)) : null,
      h('div', { class: 'row gold' }, h('span', null, 'Banked'), h('b', null, `${fmt(c.banked)} coins`)));
    const foot: (Node | null)[] = [];
    if (c.hasNext) foot.push(btn('Next level', this.tap(() => this.api.nextLevel()), { icon: 'play', cls: 'primary' }));
    foot.push(btn('Retry', this.tap(() => this.api.restart()), { icon: 'restart', cls: c.hasNext ? '' : 'primary' }));
    if (c.canEdit) foot.push(btn('Edit level', this.tap(() => this.api.backToEditor()), { icon: 'pencil' }));
    if (c.campaignLevel != null) foot.push(btn('Levels', this.tap(() => { this.api.toTitle(); this.showAdventure(); }), { icon: 'flag', cls: 'ghost' }));
    else foot.push(btn('Menu', this.tap(() => this.api.toTitle()), { icon: 'home', cls: 'ghost' }));
    this.sheet(
      'complete', '', null,
      [h('div', { class: 'result' },
        h('div', { class: 'headline win' }, 'LEVEL COMPLETE'), h('div', { class: 'subline' }, `${c.title} · ${c.time.toFixed(1)} s`),
        c.campaignLevel != null ? starRow : null, rows,
        c.custom ? h('p', { class: 'note' }, 'Player-built levels are for fun — they do not bank coins.') : null)],
      foot,
    );
    this.screen!.querySelector('header')!.remove();
  }
}
