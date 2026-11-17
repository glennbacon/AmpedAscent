// Timed power-ups: pure model. Nine kinds — three commons and six rares.

export type PowerupKind =
  | 'turbo' | 'magnet' | 'frenzy' | 'wheelie' | 'backflip' | 'jumpjets' | 'rollbar' | 'supersized' | 'stuntfever';

export interface PowerupInfo {
  title: string; // callout when collected
  label: string; // short HUD/editor label
  blurb: string;
  duration: number;
  color: number;
  rare: boolean;
}

export const POWERUPS: Record<PowerupKind, PowerupInfo> = {
  turbo: { title: 'TURBO!', label: 'Turbo', blurb: 'More torque, higher top speed.', duration: 6, color: 0xff9b3d, rare: false },
  magnet: { title: 'MAGNET!', label: 'Magnet', blurb: 'Pulls in coins and energy.', duration: 8, color: 0xff6b8a, rare: false },
  frenzy: { title: 'COIN FRENZY!', label: 'Coin Frenzy', blurb: 'Coins rain down ahead of you.', duration: 5, color: 0xffc83a, rare: false },
  wheelie: { title: 'WHEELIE TIME!', label: 'Wheelie Time', blurb: 'Auto-balanced wheelies while you hold the gas.', duration: 8, color: 0x37c9e0, rare: true },
  backflip: { title: 'FLIP MASTER!', label: 'Flip Master', blurb: 'Jumps become clean backflips that land on the wheels.', duration: 8, color: 0x8bd450, rare: true },
  jumpjets: { title: 'JUMP JETS!', label: 'Jump Jets', blurb: 'Tap JUMP to blast off the ground.', duration: 10, color: 0xa8c6e8, rare: true },
  rollbar: { title: 'ROLL BAR!', label: 'Roll Bar', blurb: 'A hoop that rolls you back onto your wheels.', duration: 8, color: 0xc8d0dc, rare: true },
  supersized: { title: 'SUPER SIZED!', label: 'Super Sized', blurb: 'Monster-truck mode. Smash through loops.', duration: 15, color: 0xc94f3d, rare: true },
  stuntfever: { title: 'STUNT FEVER!', label: 'Stunt Fever', blurb: 'Every stunt pays triple.', duration: 10, color: 0xff5533, rare: true },
};

export const POWERUP_KINDS = Object.keys(POWERUPS) as PowerupKind[];
export const STANDARD_KINDS: PowerupKind[] = POWERUP_KINDS.filter((k) => !POWERUPS[k].rare);
export const RARE_KINDS: PowerupKind[] = POWERUP_KINDS.filter((k) => POWERUPS[k].rare);
export const isPowerupKind = (k: string): k is PowerupKind => k in POWERUPS;

export class PowerupState {
  private remaining = new Map<PowerupKind, number>();

  activate(kind: PowerupKind) {
    this.remaining.set(kind, POWERUPS[kind].duration);
  }
  /** Force-expire (used by the Super Sized deferred shrink and by revive/reset). */
  clear(kind?: PowerupKind) {
    if (kind) this.remaining.delete(kind);
    else this.remaining.clear();
  }
  isActive(kind: PowerupKind): boolean {
    return (this.remaining.get(kind) ?? 0) > 0;
  }
  timeLeft(kind: PowerupKind): number {
    return this.remaining.get(kind) ?? 0;
  }
  fraction(kind: PowerupKind): number {
    return Math.max(0, Math.min(1, this.timeLeft(kind) / POWERUPS[kind].duration));
  }
  active(): PowerupKind[] {
    return POWERUP_KINDS.filter((k) => this.isActive(k));
  }
  /** Advance timers; returns the kinds that expired this tick. */
  tick(dt: number): PowerupKind[] {
    const expired: PowerupKind[] = [];
    for (const [k, t] of this.remaining) {
      const n = t - dt;
      if (n <= 0) {
        this.remaining.delete(k);
        expired.push(k);
      } else this.remaining.set(k, n);
    }
    return expired;
  }
}
