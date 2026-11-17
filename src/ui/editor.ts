// Level editor: sculpt the ground by dragging it, drop pickups and props, test-drive, save.
// Works on a private copy of the level; nothing reaches the save until "Save".

import * as THREE from 'three';
import { MAX_LEVELS } from '../core/save';
import { clamp, smoothstep } from '../sim/config';
import { POWERUPS, POWERUP_KINDS, PowerupKind } from '../sim/powerups';
import { emptyLevel, isFairPlacement, LevelData, LevelTrack, PickupKind, placeProp, PROP, PropKind, propSpan } from '../sim/track';
import { WORLDS, WORLD_ORDER, WorldId } from '../sim/worlds';
import type { Game } from '../game';
import type { WorldView } from '../render/world';
import { btn, h } from './dom';
import { icon, IconName, POWERUP_ICON } from './icons';

type Tool = 'move' | 'terrain' | 'coin' | 'energy' | 'powerup' | 'prop' | 'erase';

const MIN_LEN = 60;
const MAX_LEN = 500;
const UNDO_DEPTH = 20;

const PROP_CHOICES: { kind: PropKind; size: number; label: string; icon: IconName }[] = [
  { kind: 'ramp', size: 0, label: 'Ramp S', icon: 'chevR' },
  { kind: 'ramp', size: 1, label: 'Ramp M', icon: 'chevR' },
  { kind: 'ramp', size: 2, label: 'Ramp L', icon: 'chevR' },
  { kind: 'whoops', size: 0, label: 'Whoops', icon: 'mountain' },
  { kind: 'halfpipe', size: 0, label: 'Half-pipe', icon: 'undo' },
  { kind: 'halfpipe', size: 1, label: 'Big pipe', icon: 'undo' },
  { kind: 'bridge', size: 0, label: 'Bridge', icon: 'ruler' },
  { kind: 'loop', size: 0, label: 'Loop', icon: 'restart' },
];

const TOOL_HINT: Record<Tool, string> = {
  move: 'Drag to scroll the track (or use the slider / mouse wheel).',
  terrain: 'Drag the ground up or down to shape hills and valleys.',
  coin: 'Tap to drop a coin. Higher taps place it higher.',
  energy: 'Tap to drop an energy cell.',
  powerup: 'Tap to place the selected power-up.',
  prop: 'Tap the ground to build the selected prop there.',
  erase: 'Tap a pickup or a prop to remove it.',
};

export class LevelEditor {
  private root: HTMLDivElement;
  private surface: HTMLDivElement;
  private nameEl!: HTMLElement;
  private lenEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private scrub!: HTMLInputElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private worldSel!: HTMLSelectElement;
  private undoBtn!: HTMLButtonElement;
  private sheetEl: HTMLElement | null = null;

  private level: LevelData = emptyLevel('My Level');
  private index: number | null = null;
  private tool: Tool = 'terrain';
  private power: PowerupKind = 'turbo';
  private prop = PROP_CHOICES[0];
  private undo: string[] = [];
  private dirty = false;
  private exitArmed = false;
  private track: LevelTrack = new LevelTrack(this.level);
  private drag: { id: number; x: number; y: number; camX: number; base: number[]; moved: boolean; px: number } | null = null;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private pendingRange: [number, number] | null = null;

  constructor(uiRoot: HTMLElement, private game: Game, private view: WorldView, private canvas: HTMLCanvasElement) {
    this.surface = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'auto', touchAction: 'none' } });
    this.root = h('div', { class: 'screen editor', hidden: true }, this.surface, this.buildTop(), (this.hintEl = h('div', { class: 'ehint' })), this.buildBottom());
    uiRoot.append(this.root);
    this.surface.addEventListener('pointerdown', (e) => this.down(e));
    this.surface.addEventListener('pointermove', (e) => this.move(e));
    this.surface.addEventListener('pointerup', (e) => this.up(e));
    this.surface.addEventListener('pointercancel', (e) => this.up(e));
    this.surface.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setCam(this.view.editorCam.x + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.05);
    }, { passive: false });
    this.surface.addEventListener('contextmenu', (e) => e.preventDefault());
    void this.canvas;
  }

  // ---------------------------------------------------------------- chrome
  private buildTop(): HTMLElement {
    const tap = (fn: () => void) => () => {
      this.game.audio.ui();
      fn();
    };
    this.nameEl = h('span', { class: 'name' });
    this.lenEl = h('span', { class: 'len' });
    this.worldSel = h('select', { class: 'text', style: { width: 'auto', minHeight: '38px' }, 'aria-label': 'Biome' }, ...WORLD_ORDER.map((w) => h('option', { value: w }, WORLDS[w].name)));
    this.worldSel.addEventListener('change', () => {
      this.snapshot();
      this.level.world = this.worldSel.value as WorldId;
      this.restage();
    });
    this.undoBtn = btn('', tap(() => this.doUndo()), { icon: 'undo', cls: 'small icon', title: 'Undo' });
    const rename = btn('', tap(() => {
      const inp = h('input', { class: 'text', value: this.level.name, maxLength: 24, style: { width: '11em', minHeight: '38px' }, 'aria-label': 'Level name' });
      const done = () => {
        const v = inp.value.trim();
        if (v && v !== this.level.name) {
          this.level.name = v.slice(0, 24);
          this.dirty = true;
        }
        inp.replaceWith(this.nameEl);
        this.refreshChrome();
      };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') inp.blur();
      });
      inp.addEventListener('blur', done);
      this.nameEl.replaceWith(inp);
      inp.focus();
      inp.select();
    }), { icon: 'pencil', cls: 'small icon ghost', title: 'Rename level' });
    return h(
      'div',
      { class: 'ebar' },
      btn('Exit', () => this.exit(), { icon: 'chevL', cls: 'small' }),
      this.nameEl, rename, this.worldSel,
      h('span', { class: 'grow' }),
      btn('', tap(() => this.setLength(this.level.length - 20)), { icon: 'minus', cls: 'small icon', title: 'Shorter' }),
      this.lenEl,
      btn('', tap(() => this.setLength(this.level.length + 20)), { icon: 'plus', cls: 'small icon', title: 'Longer' }),
      this.undoBtn,
      btn('Save', tap(() => this.saveLevel()), { icon: 'save', cls: 'small' }),
      btn('Test', tap(() => this.test()), { icon: 'play', cls: 'small primary' }),
    );
  }

  private buildBottom(): HTMLElement {
    const mk = (tool: Tool, label: string, ic: IconName, pick?: () => void) => {
      const b = btn(label, () => {
        this.game.audio.ui();
        if (pick && this.tool === tool) pick();
        else if (pick && tool !== this.tool) {
          this.setTool(tool);
          pick();
        } else this.setTool(tool);
      }, { icon: ic, cls: 'small tool' });
      this.toolBtns.set(tool, b);
      return b;
    };
    this.scrub = h('input', { type: 'range', class: 'scrub', min: '0', max: '100', step: '0.5', value: '0', 'aria-label': 'Scroll along the level' });
    this.scrub.addEventListener('input', () => this.setCam(parseFloat(this.scrub.value), false));
    return h(
      'div',
      { class: 'ebar bottom' },
      mk('move', 'Move', 'expand'),
      mk('terrain', 'Terrain', 'mountain'),
      mk('coin', 'Coin', 'coin'),
      mk('energy', 'Energy', 'bolt'),
      mk('powerup', 'Power-up', 'star', () => this.pickPowerup()),
      mk('prop', 'Prop', 'box', () => this.pickProp()),
      mk('erase', 'Erase', 'eraser'),
      h('div', { style: { flexBasis: '100%', height: '0' } }),
      this.scrub,
    );
  }

  private pickSheet(title: string, items: { label: string; icon: IconName; color?: number; on: boolean; pick: () => void }[]) {
    this.sheetEl?.remove();
    const close = () => {
      this.sheetEl?.remove();
      this.sheetEl = null;
    };
    const grid = h('div', { class: 'picker' });
    for (const it of items) {
      const b = btn(it.label, () => {
        this.game.audio.ui();
        it.pick();
        close();
        this.refreshChrome();
      }, { icon: it.icon, cls: it.on ? 'primary' : '' });
      if (it.color != null && !it.on) b.style.color = `#${it.color.toString(16).padStart(6, '0')}`;
      grid.append(b);
    }
    const scrim = h('div', { class: 'scrim' });
    scrim.addEventListener('click', close);
    const sh = h('div', { class: 'sheet' }, h('header', null, h('h2', null, title), btn('', close, { icon: 'close', cls: 'small icon ghost', title: 'Close' })), h('div', { class: 'rail' }), h('div', { class: 'body' }, grid));
    this.sheetEl = h('div', { class: 'screen', style: { zIndex: '5' } }, scrim, sh);
    this.root.append(this.sheetEl);
  }
  private pickPowerup() {
    this.pickSheet('Power-up', POWERUP_KINDS.map((k) => ({ label: POWERUPS[k].label, icon: POWERUP_ICON[k], color: POWERUPS[k].color, on: k === this.power, pick: () => (this.power = k) })));
  }
  private pickProp() {
    this.pickSheet('Prop', PROP_CHOICES.map((p) => ({ label: p.label, icon: p.icon, on: p === this.prop, pick: () => (this.prop = p) })));
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.refreshChrome();
  }

  private refreshChrome() {
    this.nameEl.textContent = this.level.name;
    this.lenEl.textContent = `${Math.round(this.level.length)} m`;
    this.worldSel.value = this.level.world;
    this.undoBtn.disabled = !this.undo.length;
    for (const [t, b] of this.toolBtns) b.classList.toggle('on', t === this.tool);
    const pb = this.toolBtns.get('powerup')!.querySelector('.lbl');
    if (pb) pb.textContent = POWERUPS[this.power].label;
    const rb = this.toolBtns.get('prop')!.querySelector('.lbl');
    if (rb) rb.textContent = this.prop.label;
    this.hintEl.textContent = TOOL_HINT[this.tool];
    this.scrub.max = String(this.level.length);
    this.scrub.value = String(this.view.editorCam.x);
  }

  // ---------------------------------------------------------------- lifecycle
  open(index: number | null) {
    const src = index != null ? this.game.save.data.levels[index] : null;
    this.level = src ? JSON.parse(JSON.stringify(src)) : emptyLevel(`Level ${this.game.save.data.levels.length + 1}`);
    this.index = src ? index : null;
    this.undo = [];
    this.dirty = false;
    this.tool = 'terrain';
    this.view.editorCam.x = 14;
    this.show();
  }
  /** Back from a test drive: same working copy, same camera. */
  reopen() {
    this.show();
  }
  private show() {
    this.root.hidden = false;
    this.exitArmed = false;
    this.restage();
  }
  hide() {
    this.root.hidden = true;
    this.sheetEl?.remove();
    this.sheetEl = null;
    this.drag = null;
  }
  onEscape() {
    if (this.sheetEl) {
      this.sheetEl.remove();
      this.sheetEl = null;
    } else this.exit();
  }

  private exit() {
    if (this.dirty && !this.exitArmed) {
      this.exitArmed = true;
      this.game.audio.deny();
      this.game.menus.toast('Unsaved changes — tap Exit again to discard', true);
      setTimeout(() => (this.exitArmed = false), 3500);
      return;
    }
    this.hide();
    this.game.toTitle();
    this.game.menus.showLevels();
  }

  private saveLevel() {
    if (this.index == null && this.game.save.data.levels.length >= MAX_LEVELS) {
      this.game.menus.toast(`You can keep ${MAX_LEVELS} levels — delete one first`, true);
      return;
    }
    const i = this.game.save.saveLevel(this.level, this.index);
    if (i < 0) {
      this.game.menus.toast('Could not save this level', true);
      return;
    }
    this.index = i;
    this.dirty = false;
    this.game.menus.toast('Level saved');
  }

  private test() {
    this.hide();
    this.game.testLevel(JSON.parse(JSON.stringify(this.level)), this.index);
  }

  // ---------------------------------------------------------------- model edits
  private snapshot() {
    this.undo.push(JSON.stringify(this.level));
    if (this.undo.length > UNDO_DEPTH) this.undo.shift();
    this.dirty = true;
  }
  private doUndo() {
    const s = this.undo.pop();
    if (!s) return;
    this.level = JSON.parse(s);
    this.dirty = true;
    this.restage();
  }

  private setLength(len: number) {
    len = clamp(Math.round(len / 20) * 20, MIN_LEN, MAX_LEN);
    if (len === this.level.length) return;
    this.snapshot();
    const lv = this.level;
    const n = Math.round(len / lv.step) + 1;
    const last = lv.heights[lv.heights.length - 1];
    while (lv.heights.length < n) lv.heights.push(last);
    lv.heights.length = n;
    lv.length = len;
    lv.pickups = lv.pickups.filter((p) => p.x < len - 2);
    lv.props = lv.props.filter((p) => p.x + propSpan(p.kind, p.size) < len - 6);
    this.setCam(Math.min(this.view.editorCam.x, len), false);
    this.restage();
  }

  /** Rebuild the preview world from the working copy. `range` limits the terrain rebuild. */
  private restage(range?: [number, number]) {
    this.track = this.game.stageEditor(this.level, range);
    this.setCam(this.view.editorCam.x, false);
    this.refreshChrome();
  }

  private setCam(x: number, syncScrub = true) {
    const cam = this.view.editorCam;
    cam.x = clamp(x, -4, this.level.length + 6);
    cam.y = this.track.surface(cam.x) + 3.2;
    if (syncScrub || true) this.scrub.value = String(clamp(cam.x, 0, this.level.length));
  }

  private world(e: PointerEvent): { x: number; y: number } | null {
    const r = this.surface.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.view.gfx.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, hit) ? { x: hit.x, y: hit.y } : null;
  }

  private down(e: PointerEvent) {
    if (this.drag || this.sheetEl) return;
    const w = this.world(e);
    if (!w) return;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const pan = this.tool === 'move' || e.button === 1 || e.button === 2;
    this.drag = { id: e.pointerId, x: w.x, y: w.y, camX: this.view.editorCam.x, base: this.level.heights.slice(), moved: false, px: e.clientX };
    if (pan) (this.drag as any).pan = true;
    else if (this.tool === 'terrain') this.snapshot();
  }

  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if ((d as any).pan) {
      // Screen-space pan: metres per pixel at the track plane.
      const cam = this.view.gfx.camera;
      const mPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * this.view.editorCam.dist) / this.surface.clientHeight;
      this.setCam(d.camX - (e.clientX - d.px) * mPerPx);
      return;
    }
    if (this.tool !== 'terrain') return;
    const w = this.world(e);
    if (!w) return;
    d.moved = true;
    const lv = this.level;
    const R = 11;
    const dy = clamp(w.y - d.y, -30, 30);
    for (let i = 0; i < lv.heights.length; i++) {
      const xi = i * lv.step;
      const u = Math.abs(xi - d.x) / R;
      if (u >= 1) {
        lv.heights[i] = d.base[i];
        continue;
      }
      const fall = 0.5 + 0.5 * Math.cos(u * Math.PI);
      // The first metres stay level so the car always has a launch pad.
      lv.heights[i] = clamp(d.base[i] + dy * fall * smoothstep((xi - 4) / 10), -40, 40);
    }
    this.pendingRange = [d.x - R - lv.step * 2, d.x + R + lv.step * 2];
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if ((d as any).pan) return;
    if (this.tool === 'terrain') {
      if (!d.moved) this.undo.pop();
      else this.restage([d.x - 16, d.x + 16]);
      this.refreshChrome();
      return;
    }
    const w = this.world(e) ?? d;
    this.tapAt(w.x, w.y);
  }

  private tapAt(x: number, y: number) {
    const lv = this.level;
    const t = this.track;
    if (x < 4 || x > lv.length - 3) {
      this.game.menus.toast('Place items between the start pad and the finish', true);
      return;
    }
    const place = (kind: PickupKind) => {
      this.snapshot();
      const dy = clamp(y - t.surface(x), 1.1, 9);
      lv.pickups.push({ kind, x: Math.round(x * 4) / 4, dy: dy < 1.9 ? 1.4 : Math.round(dy * 4) / 4 });
      this.game.audio.coin();
      this.restage();
    };
    if (this.tool === 'coin') place('coin');
    else if (this.tool === 'energy') place('energy');
    else if (this.tool === 'powerup') place(this.power);
    else if (this.tool === 'prop') {
      const span = propSpan(this.prop.kind, this.prop.size);
      const px = Math.round((x - span / 2) * 2) / 2;
      const base = (q: number) => t.base(q);
      const placed = placeProp({ kind: this.prop.kind, x: px, size: this.prop.size }, 0, base);
      if (placed.x0 < 6 || placed.x1 > lv.length - 8) {
        this.game.menus.toast('Not enough room for that prop here', true);
        this.game.audio.deny();
        return;
      }
      for (const o of t.allProps()) {
        if (placed.x0 < o.x1 + 2 && placed.x1 > o.x0 - 2) {
          this.game.menus.toast('Too close to another prop', true);
          this.game.audio.deny();
          return;
        }
      }
      this.snapshot();
      lv.props.push({ kind: this.prop.kind, x: px, size: this.prop.size });
      if (!isFairPlacement(placed, base)) this.game.menus.toast('Heads-up: that spot is steep — it may be hard to drive');
      this.game.audio.buy();
      this.restage();
    } else if (this.tool === 'erase') {
      // Nearest pickup within reach, else a prop under the tap.
      let best = -1;
      let bd = 1.6;
      lv.pickups.forEach((p, i) => {
        const dd = Math.hypot(p.x - x, t.surface(p.x) + p.dy - y);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      if (best >= 0) {
        this.snapshot();
        lv.pickups.splice(best, 1);
        this.restage();
        return;
      }
      const pi = lv.props.findIndex((p) => x >= p.x - 1 && x <= p.x + propSpan(p.kind, p.size) + 1);
      if (pi >= 0) {
        this.snapshot();
        lv.props.splice(pi, 1);
        this.restage();
      }
    }
  }

  /** Called every frame while the editor is open: applies in-flight terrain drags cheaply. */
  update(_dt: number) {
    if (this.pendingRange) {
      const r = this.pendingRange;
      this.pendingRange = null;
      this.track = this.game.stageEditor(this.level, r);
      this.setCam(this.view.editorCam.x, false);
    }
  }
}

export { PROP };
