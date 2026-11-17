// In-run HUD: battery, distance / level gauge, coins, combo, power-up timers, callouts, pedals.
// DOM writes are change-gated — the HUD is touched every frame but only repaints what moved.

import { CFG } from '../sim/config';
import { POWERUPS, POWERUP_KINDS, PowerupKind } from '../sim/powerups';
import { PopupTone, RunSim } from '../sim/run';
import { Input } from '../core/input';
import { fmt, h, hex, isTouch } from './dom';
import { icon, POWERUP_ICON } from './icons';

export class Hud {
  readonly root: HTMLDivElement;
  private battery: HTMLDivElement;
  private batFill: HTMLElement;
  private batPct: HTMLElement;
  private combo: HTMLDivElement;
  private pus: HTMLDivElement;
  private puEls = new Map<PowerupKind, { el: HTMLDivElement; bar: HTMLElement }>();
  private mid: HTMLDivElement;
  private distEl: HTMLElement;
  private bestEl: HTMLDivElement;
  private gauge: HTMLDivElement;
  private gFill: HTMLElement;
  private gCar: HTMLElement;
  private gNow: HTMLElement;
  private gTotal: HTMLElement;
  private coins: HTMLElement;
  private popups: HTMLDivElement;
  private wrong: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private vigLow: HTMLDivElement;
  private vigTurbo: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private gas: HTMLDivElement;
  private brake: HTMLDivElement;
  private jump: HTMLButtonElement;
  private last: Record<string, string | number | boolean> = {};
  private best = 0;
  private levelLen: number | null = null;
  onPause: (() => void) | null = null;

  constructor(private input: Input) {
    const bar = h('div', { class: 'bar' }, (this.batFill = h('i')));
    this.battery = h('div', { class: 'battery', html: icon('bolt') }, bar, (this.batPct = h('b', null, '100%')));
    this.combo = h('div', { class: 'combo', hidden: true }, '×1');
    this.pus = h('div', { class: 'powerups' });
    this.distEl = h('b', null, '0');
    this.bestEl = h('div', { class: 'best' });
    const dist = h('div', { class: 'dist' }, this.distEl, h('small', null, 'm'));
    this.gFill = h('i');
    this.gCar = h('span', { class: 'car' });
    this.gNow = h('b', null, '0 m');
    this.gTotal = h('span');
    this.gauge = h(
      'div',
      { class: 'gauge', hidden: true },
      h('div', { class: 'line' }, this.gFill, this.gCar, h('span', { class: 'flag', html: icon('flag') })),
      h('div', { class: 'txt' }, this.gNow, this.gTotal),
    );
    this.mid = h('div', { class: 'hud-mid' }, dist, this.bestEl, this.gauge);
    this.coins = h('span', null, '0');
    const pause = h('button', { class: 'btn icon small', type: 'button', title: 'Pause', 'aria-label': 'Pause', html: icon('pause') });
    pause.addEventListener('click', () => this.onPause?.());
    const top = h(
      'div',
      { class: 'hud-top' },
      h('div', { class: 'hud-left' }, this.battery, this.combo, this.pus),
      this.mid,
      h('div', { class: 'hud-right' }, h('div', { class: 'chip coins', html: icon('coin') }, this.coins), pause),
    );
    this.popups = h('div', { class: 'popups' });
    this.wrong = h('div', { class: 'banner', hidden: true }, 'WRONG WAY');
    this.hintEl = h('div', { class: 'hint', hidden: true });
    this.vigLow = h('div', { class: 'vignette low' });
    this.vigTurbo = h('div', { class: 'vignette turbo' });
    this.flashEl = h('div', { class: 'flash' });

    // Touch: the whole lower half of each side is a pedal; the round graphics just show where.
    const zl = h('div', { class: 'zone l' });
    const zr = h('div', { class: 'zone r' });
    this.brake = h('div', { class: 'pedal brake', html: icon('chevL') });
    this.gas = h('div', { class: 'pedal gas', html: icon('chevR') });
    this.bindPedal(zl, 'brake', this.brake);
    this.bindPedal(zr, 'gas', this.gas);
    this.jump = h('button', { class: 'jumpbtn', type: 'button', hidden: true, 'aria-label': 'Jump', html: icon('jump') });
    this.jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.pressJump();
    });
    this.root = h('div', { class: `hud${isTouch() ? '' : ' no-touch'}`, hidden: true },
      this.vigLow, this.vigTurbo, this.flashEl, h('div', { class: 'zones' }, zl, zr), this.brake, this.gas, top, this.popups, this.wrong, this.hintEl, this.jump);
  }

  private bindPedal(zone: HTMLElement, which: 'gas' | 'brake', gfx: HTMLElement) {
    const held = new Set<number>();
    const set = () => {
      const down = held.size > 0;
      this.input.setPedal(which, down);
      gfx.classList.toggle('down', down);
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      held.add(e.pointerId);
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* older browsers */
      }
      set();
    });
    const up = (e: PointerEvent) => {
      held.delete(e.pointerId);
      set();
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(opts: { best: number; levelLength: number | null }) {
    this.best = opts.best;
    this.levelLen = opts.levelLength;
    this.root.hidden = false;
    this.last = {};
    this.gauge.hidden = opts.levelLength == null;
    this.distEl.parentElement!.hidden = opts.levelLength != null;
    this.bestEl.hidden = opts.levelLength != null;
    if (opts.levelLength != null) this.gTotal.textContent = `${fmt(opts.levelLength)} m`;
    this.popups.replaceChildren();
    this.wrong.hidden = true;
    this.setHint(null);
    this.releasePedals();
  }
  hide() {
    this.root.hidden = true;
    this.releasePedals();
  }
  /** Hide the driving chrome under an end card but keep the element mounted. */
  setDim(dim: boolean) {
    this.root.style.opacity = dim ? '0' : '1';
  }
  releasePedals() {
    this.input.setPedal('gas', false);
    this.input.setPedal('brake', false);
    this.gas.classList.remove('down');
    this.brake.classList.remove('down');
  }

  setHint(html: string | null) {
    if (html == null) {
      this.hintEl.hidden = true;
      return;
    }
    this.hintEl.innerHTML = html;
    this.hintEl.hidden = false;
  }
  get hintVisible() {
    return !this.hintEl.hidden;
  }

  popup(text: string, tone: PopupTone, coins?: number) {
    while (this.popups.children.length >= 3) this.popups.lastElementChild!.remove();
    const p = h('div', { class: `popup t-${tone}` }, text, coins ? h('span', null, `+${fmt(coins)}`) : null);
    this.popups.prepend(p);
    p.addEventListener('animationend', () => p.remove());
  }
  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }
  bumpCombo() {
    this.combo.classList.remove('bump');
    void this.combo.offsetWidth;
    this.combo.classList.add('bump');
  }

  private set(key: string, v: string | number | boolean, apply: () => void) {
    if (this.last[key] === v) return;
    this.last[key] = v;
    apply();
  }

  update(sim: RunSim) {
    const bf = sim.batteryFraction;
    const pct = Math.round(bf * 100);
    this.set('bat', pct, () => {
      this.batFill.style.transform = `scaleX(${Math.max(0.001, bf)})`;
      this.batPct.textContent = `${pct}%`;
    });
    const cls = bf < CFG.lowBatteryFraction ? 'low' : bf < 0.45 ? 'mid' : '';
    this.set('batc', cls, () => (this.battery.className = `battery ${cls}`));
    this.set('viglow', bf < CFG.lowBatteryFraction && sim.status === 'playing' && sim.live, () => this.vigLow.classList.toggle('on', !!this.last.viglow));
    this.set('vigt', sim.powerups.isActive('turbo'), () => this.vigTurbo.classList.toggle('on', !!this.last.vigt));

    if (this.levelLen == null) {
      const d = Math.max(0, Math.floor(sim.stats.distance));
      this.set('dist', d, () => (this.distEl.textContent = fmt(d)));
      const beaten = this.best > 0 && d > this.best;
      this.set('best', `${this.best}|${beaten}`, () => {
        this.bestEl.textContent = this.best > 0 ? (beaten ? 'NEW BEST!' : `BEST ${fmt(this.best)} m`) : '';
        this.bestEl.classList.toggle('beaten', beaten);
      });
    } else {
      const p = sim.progress;
      this.set('prog', Math.round(p * 500), () => {
        this.gFill.style.width = `${p * 100}%`;
        this.gCar.style.left = `${p * 100}%`;
      });
      const m = Math.max(0, Math.floor(sim.stats.distance));
      this.set('gnow', m, () => (this.gNow.textContent = `${fmt(m)} m`));
    }
    this.set('coins', sim.stats.coins, () => (this.coins.textContent = fmt(sim.stats.coins)));
    const mult = sim.multiplier;
    this.set('combo', mult, () => {
      this.combo.hidden = mult <= 1;
      this.combo.textContent = `×${mult}`;
    });
    this.set('wrong', sim.wrongWay, () => (this.wrong.hidden = !sim.wrongWay));

    // Power-up chips.
    for (const k of POWERUP_KINDS) {
      const active = sim.powerups.isActive(k);
      let e = this.puEls.get(k);
      if (active && !e) {
        const bar = h('i');
        const el = h('div', { class: 'pu', style: { '--c': hex(POWERUPS[k].color) } as any, html: icon(POWERUP_ICON[k]) }, h('span', null, POWERUPS[k].label), bar);
        el.style.setProperty('--c', hex(POWERUPS[k].color));
        this.pus.append(el);
        e = { el, bar };
        this.puEls.set(k, e);
      } else if (!active && e) {
        e.el.remove();
        this.puEls.delete(k);
        e = undefined;
      }
      if (e) {
        const f = sim.powerups.fraction(k);
        e.bar.style.transform = `scaleX(${f})`;
        e.el.classList.toggle('ending', sim.powerups.timeLeft(k) < 1.5);
      }
    }
    const jets = sim.powerups.isActive('jumpjets');
    this.set('jets', jets, () => (this.jump.hidden = !jets));
    if (jets) this.set('jready', sim.jumpReady, () => this.jump.classList.toggle('off', !sim.jumpReady));
  }
}
