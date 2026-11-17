// QA drivers. `beginner` holds the gas blind; `pro` manages throttle, aligns landings and retries stalls.
// Used by the tuning harness, the tests and the in-browser ?driver= flag — never by players.

import { wrapAngle } from './config';
import type { RunSim, SimInput } from './run';

export type DriverProfile = 'beginner' | 'pro';

export class AutoDriver {
  private stallT = 0;
  private reverseT = 0;
  private jumpT = 0;
  constructor(readonly profile: DriverProfile = 'pro') {}

  input(sim: RunSim, dt: number): SimInput {
    const v = sim.vehicle;
    const out: SimInput = { gas: 1, brake: 0, jump: false };
    this.jumpT -= dt;
    // Jets on a steep face only bounce the car off its own traction — keep them for open ground.
    if (sim.jumpReady && this.jumpT <= 0 && Math.abs(sim.track.slope(v.x)) < 0.35 && Math.abs(sim.track.slope(v.x + 8)) < 0.5) {
      out.jump = true;
      this.jumpT = 1.6;
    }
    if (this.profile === 'beginner') return out;

    const tr = sim.track;
    const slope = Math.atan(tr.slope(v.x));
    const tilt = wrapAngle(v.angle - slope);
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      return { gas: 0, brake: 1, jump: false };
    }
    if (v.airborne) {
      // Pitch toward the slope we will land on.
      const T = Math.min(v.airTime < 0.05 ? 0.4 : 0.6, 1);
      const land = Math.atan(tr.slope(v.x + v.vx * T));
      const err = wrapAngle(land - v.angle) - v.omega * 0.18;
      out.gas = err > 0.1 ? 1 : 0;
      out.brake = err < -0.1 ? 1 : 0;
      return out;
    }
    if (sim.loopRide) return out; // never lift inside a loop
    // Throttle management: ease off before the nose comes over.
    if (tilt > 0.5 + (v.omega < 0 ? 0.15 : 0) || (tilt > 0.3 && v.omega > 1.6)) out.gas = 0;
    if (tilt > 0.95) out.brake = 1;
    // Stall retry: back up for a run-up.
    if (Math.abs(v.speed) < 0.6 && v.anyGrounded) this.stallT += dt;
    else this.stallT = Math.max(0, this.stallT - dt * 2);
    if (this.stallT > 1.2) {
      this.stallT = 0;
      this.reverseT = 1.6;
    }
    return out;
  }
}

export interface DriveResult {
  distance: number;
  time: number;
  cause: string;
  flips: number;
  coins: number;
  topSpeed: number;
  battery: number;
}

/** Drive a sim headless until it ends, completes, or hits a cap. */
export function autoDrive(sim: RunSim, profile: DriverProfile, maxSeconds = 240, maxMeters = 4000): DriveResult {
  const d = new AutoDriver(profile);
  const dt = 1 / 120;
  sim.live = true;
  let t = 0;
  while (t < maxSeconds && sim.status === 'playing' && sim.vehicle.x < maxMeters) {
    sim.step(dt, d.input(sim, dt));
    sim.events.length = 0;
    t += dt;
  }
  return {
    distance: sim.stats.distance,
    time: t,
    cause: sim.status === 'completed' ? 'completed' : sim.status === 'ended' ? (sim.endCause ?? 'ended') : 'cap',
    flips: sim.stats.flips,
    coins: sim.bankCoins,
    topSpeed: sim.stats.topSpeed,
    battery: sim.batteryFraction,
  };
}
