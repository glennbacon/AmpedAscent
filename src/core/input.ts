// Drive input from every source: keyboard, touch pedals, gamepad. Produces one small state the
// game samples each physics step. Jump is edge-triggered (one burst per press).

export interface DriveState {
  gas: number;
  brake: number;
  jump: boolean;
}

export class Input {
  private keys = new Set<string>();
  private touchGas = false;
  private touchBrake = false;
  private jumpQueued = false;
  private padJumpWas = false;
  /** Fired on Escape / P / gamepad Start. */
  onPause: (() => void) | null = null;
  /** Fired on any drive key (used to leave the ready state and dismiss hints). */
  onAnyDrive: (() => void) | null = null;
  enabled = true;

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.code;
      if (k === 'Escape' || k === 'KeyP') {
        this.onPause?.();
        return;
      }
      if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') this.jumpQueued = true;
      if (['ArrowRight', 'KeyD', 'ArrowLeft', 'KeyA'].includes(k)) this.onAnyDrive?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  releaseAll() {
    this.keys.clear();
    this.touchGas = this.touchBrake = false;
    this.jumpQueued = false;
  }

  setPedal(which: 'gas' | 'brake', down: boolean) {
    if (which === 'gas') this.touchGas = down;
    else this.touchBrake = down;
    if (down) this.onAnyDrive?.();
  }
  pressJump() {
    this.jumpQueued = true;
  }

  /** True while any gas source is held (keyboard/touch) — used by UI affordances. */
  get gasHeld() {
    return this.touchGas || this.keys.has('ArrowRight') || this.keys.has('KeyD');
  }
  get brakeHeld() {
    return this.touchBrake || this.keys.has('ArrowLeft') || this.keys.has('KeyA');
  }

  /** Sample for one physics step. Consumes the queued jump. */
  sample(): DriveState {
    if (!this.enabled) {
      this.jumpQueued = false;
      return { gas: 0, brake: 0, jump: false };
    }
    let gas = this.gasHeld ? 1 : 0;
    let brake = this.brakeHeld ? 1 : 0;
    let jump = this.jumpQueued;
    this.jumpQueued = false;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      const ax = p.axes[0] ?? 0;
      gas = Math.max(gas, rt, ax > 0.35 ? ax : 0, p.buttons[15]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt, ax < -0.35 ? -ax : 0, p.buttons[14]?.pressed ? 1 : 0);
      const a = !!p.buttons[0]?.pressed;
      if (a && !this.padJumpWas) jump = true;
      this.padJumpWas = a;
      if (p.buttons[9]?.pressed && !this.padStartWas) this.onPause?.();
      this.padStartWas = !!p.buttons[9]?.pressed;
      if (gas > 0 || brake > 0) this.onAnyDrive?.();
    }
    return { gas, brake, jump };
  }
  private padStartWas = false;
}

export function haptic(ms: number | number[], enabled: boolean) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
