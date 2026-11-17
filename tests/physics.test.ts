import { describe, expect, it } from 'vitest';
import { autoDrive, AutoDriver } from '../src/sim/autodriver';
import { generateLevel } from '../src/sim/campaign';
import { CFG, wrapAngle } from '../src/sim/config';
import { RunSim, SimEvent } from '../src/sim/run';
import { EndlessTrack, FnTrack, LevelTrack, PropKind } from '../src/sim/track';
import { deriveStats, MAXED_LOADOUT, STOCK_LOADOUT, Loadout } from '../src/sim/upgrades';
import { carRating, loadoutForRating } from '../src/sim/climbs';
import { levelRating } from '../src/sim/campaign';

const dt = 1 / CFG.stepHz;
const idle = { gas: 0, brake: 0, jump: false };
const gas = { gas: 1, brake: 0, jump: false };

function run(sim: RunSim, seconds: number, input = idle, keepCharged = true): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < seconds * CFG.stepHz; i++) {
    sim.step(dt, input);
    if (keepCharged) sim.battery = CFG.batteryCapacity;
    ev.push(...sim.events);
    sim.events.length = 0;
  }
  return ev;
}
const flat = (lo: Loadout = STOCK_LOADOUT, props: { kind: PropKind; x: number; size: number }[] = []) => {
  const sim = new RunSim(new FnTrack(() => 0, undefined, props), lo);
  sim.live = true;
  return sim;
};

describe('rig', () => {
  it('settles level at its ride height', () => {
    const sim = flat();
    run(sim, 1.5);
    const v = sim.vehicle;
    expect(v.y).toBeCloseTo(v.rideHeight, 1);
    expect(Math.abs(v.angle)).toBeLessThan(0.03);
    expect(v.grounded).toEqual([true, true]);
    expect(Math.abs(v.vx)).toBeLessThan(0.05);
  });

  it('holds on a slope while parked (title/garage backdrop, ready state)', () => {
    const sim = new RunSim(new FnTrack((x) => x * 0.25), STOCK_LOADOUT); // live = false
    run(sim, 6);
    expect(Math.abs(sim.vehicle.x)).toBeLessThan(0.3);
    sim.live = true;
    run(sim, 2); // released: it rolls back
    expect(sim.vehicle.x).toBeLessThan(-1);
  });

  it('reaches its designed top speed and stays planted on flat ground', () => {
    for (const lo of [STOCK_LOADOUT, MAXED_LOADOUT]) {
      const sim = flat(lo);
      let maxTilt = 0;
      for (let i = 0; i < 9 * CFG.stepHz; i++) {
        sim.step(dt, gas);
        sim.battery = 100;
        maxTilt = Math.max(maxTilt, Math.abs(sim.vehicle.angle));
      }
      const top = deriveStats(lo).topSpeed;
      expect(sim.vehicle.speed).toBeGreaterThan(top * 0.93);
      expect(sim.vehicle.speed).toBeLessThan(top * 1.03);
      expect(maxTilt).toBeLessThan(0.15); // no flat-ground wheelie flip, even maxed
    }
  });

  it('lands dead: a 3 m drop settles fast with no second bounce (the anti-float bar)', () => {
    for (const lo of [STOCK_LOADOUT, MAXED_LOADOUT]) {
      const sim = flat(lo);
      run(sim, 0.6);
      const rest = sim.vehicle.y;
      sim.placeAt(0, 3);
      let contactT = -1;
      let rebounds = 0;
      let wasAir = true;
      let lastDisturbed = 0;
      for (let i = 0; i < 3 * CFG.stepHz; i++) {
        sim.step(dt, idle);
        const t = i * dt;
        const g = sim.vehicle.anyGrounded;
        if (contactT < 0 && g) contactT = t;
        if (contactT >= 0) {
          if (wasAir && g && t > contactT + 0.05) rebounds++;
          if (Math.abs(sim.vehicle.y - rest) > 0.04) lastDisturbed = t;
        }
        wasAir = !g;
      }
      expect(rebounds).toBe(0);
      expect(lastDisturbed - contactT).toBeLessThan(0.6);
    }
  });

  it('climbs what it should: stock holds 0.5, stalls on 0.9; maxed climbs 1.2', () => {
    const climb = (lo: Loadout, slope: number) => {
      const f = (x: number) => (x < 25 ? 0 : x - 25 < 6 ? (slope * (x - 25) ** 2) / 12 : slope * (x - 28));
      const sim = new RunSim(new FnTrack(f), lo);
      sim.live = true;
      for (let i = 0; i < 12 * CFG.stepHz; i++) {
        const tilt = sim.vehicle.angle - Math.atan(slope);
        sim.step(dt, { gas: tilt > 0.5 ? 0 : 1, brake: 0, jump: false });
        sim.battery = 100;
      }
      return sim.vehicle.y;
    };
    expect(climb(STOCK_LOADOUT, 0.5)).toBeGreaterThan(25);
    expect(climb(STOCK_LOADOUT, 0.9)).toBeLessThan(15);
    expect(climb(MAXED_LOADOUT, 1.2)).toBeGreaterThan(60);
  });

  it('keeps its rotational inertia when the roll bar comes off (regression: locked chassis)', () => {
    const sim = flat();
    run(sim, 0.5);
    const I0 = sim.vehicle.chassis.getInertia();
    const m0 = sim.vehicle.chassis.getMass();
    sim.grant('rollbar');
    expect(sim.vehicle.rollBar).toBe(true);
    run(sim, 8.3, gas);
    expect(sim.vehicle.rollBar).toBe(false);
    expect(sim.vehicle.chassis.getInertia()).toBeCloseTo(I0, 6);
    expect(sim.vehicle.chassis.getMass()).toBeCloseTo(m0, 6);
  });

  it('never tunnels through the ground on a brutal landing', () => {
    const sim = flat(MAXED_LOADOUT);
    run(sim, 0.4);
    sim.placeAt(0, 30);
    sim.vehicle.setVelocity(25, -30, 3);
    for (let i = 0; i < 4 * CFG.stepHz; i++) {
      sim.step(dt, idle);
      const v = sim.vehicle;
      expect(v.y).toBeGreaterThan(-0.2);
      for (const w of v.wheels) expect(w.getPosition().y).toBeGreaterThan(-0.05);
    }
  });
});

describe('run rules', () => {
  it('drains to "out of charge" and reports it once', () => {
    const sim = flat();
    sim.battery = 4;
    const ev = run(sim, 12, gas, false);
    expect(sim.status).toBe('ended');
    expect(sim.endCause).toBe('drained');
    expect(ev.filter((e) => e.t === 'ended').length).toBe(1);
    expect(ev.some((e) => e.t === 'lowBattery')).toBe(true);
  });

  it('wrecks a car left on its roof, but rescues it while a stunt assist burns', () => {
    const wreck = flat();
    run(wreck, 0.4);
    wreck.placeAt(0, 1.2, Math.PI);
    run(wreck, 6);
    expect(wreck.status).toBe('ended');
    expect(wreck.endCause).toBe('wrecked');

    const saved = flat();
    run(saved, 0.4);
    saved.grant('wheelie');
    saved.placeAt(0, 1.2, Math.PI);
    const ev = run(saved, 4);
    expect(ev.some((e) => e.t === 'rescue')).toBe(true);
    expect(saved.status).toBe('playing');
    expect(Math.abs(wrapAngle(saved.vehicle.angle))).toBeLessThan(0.5);
    expect(saved.vehicle.grounded).toEqual([true, true]);
  });

  it('revives once: upright, charged, playing', () => {
    const sim = flat();
    run(sim, 0.4);
    sim.placeAt(0, 1.2, Math.PI);
    run(sim, 6);
    expect(sim.status).toBe('ended');
    sim.revive();
    expect(sim.status).toBe('playing');
    expect(sim.reviveUsed).toBe(true);
    expect(sim.batteryFraction).toBeGreaterThanOrEqual(0.6);
    run(sim, 1);
    expect(Math.abs(wrapAngle(sim.vehicle.angle))).toBeLessThan(0.2);
  });

  it('jump jets only fire from the ground and buy about a second of air', () => {
    const sim = flat();
    run(sim, 0.5);
    sim.step(dt, { gas: 0, brake: 0, jump: true });
    expect(sim.vehicle.vy).toBeLessThan(1); // no power-up: nothing happens
    sim.grant('jumpjets');
    run(sim, 0.1);
    sim.events.length = 0;
    sim.step(dt, { gas: 0, brake: 0, jump: true });
    expect(sim.events.some((e) => e.t === 'jets')).toBe(true);
    sim.events.length = 0;
    let air = 0;
    let second = false;
    for (let i = 0; i < 3 * CFG.stepHz; i++) {
      sim.step(dt, { gas: 0, brake: 0, jump: i === 20 }); // a mid-air press must do nothing
      if (sim.events.some((e) => e.t === 'jets')) second = true;
      sim.events.length = 0;
      if (sim.vehicle.airborne) air += dt;
    }
    expect(second).toBe(false);
    expect(air).toBeGreaterThan(0.7);
    expect(air).toBeLessThan(1.3);
  });

  it('super sized grows above ground, smashes a loop, and shrinks back safely', () => {
    const sim = flat(STOCK_LOADOUT, [{ kind: 'loop', x: 40, size: 0 }]);
    run(sim, 0.4);
    sim.grant('supersized');
    expect(sim.vehicle.scale).toBeCloseTo(CFG.superScale, 5);
    const ev = run(sim, 15.6, gas);
    expect(ev.some((e) => e.t === 'loopSmash')).toBe(true);
    expect(ev.some((e) => e.t === 'popup' && e.text.startsWith('CRASH THROUGH'))).toBe(true);
    expect(sim.vehicle.scale).toBe(1);
    expect(sim.status).toBe('playing');
    run(sim, 1, idle);
    expect(sim.vehicle.y).toBeGreaterThan(0.5);
    expect(sim.vehicle.x).toBeGreaterThan(80);
  });

  it('coins respect the combo, energy charges and bumps it, the bank adds distance', () => {
    const sim = new RunSim(new EndlessTrack(12), STOCK_LOADOUT);
    const r = autoDrive(sim, 'pro', 30, 400);
    expect(r.distance).toBeGreaterThan(200);
    expect(sim.stats.coins).toBe(sim.stats.pickupCoins + sim.stats.stuntCoins);
    expect(sim.stats.bestComboLevel).toBeGreaterThan(2);
    expect(sim.bankCoins).toBe(sim.stats.coins + Math.floor(sim.stats.distance * CFG.coinsPerMeter));
  });
});

describe('props', () => {
  const trial = (kind: PropKind, lo: Loadout, hilly: number) => {
    const fn = (x: number) => (hilly ? Math.sin(x / 9 + hilly) * 1.2 * Math.min(1, Math.max(0, (x - 20) / 20)) : 0);
    const sim = new RunSim(new FnTrack(fn, undefined, [{ kind, x: 70, size: 0 }]), lo);
    const d = new AutoDriver('pro');
    sim.live = true;
    const pops: string[] = [];
    for (let i = 0; i < 30 * CFG.stepHz && sim.status === 'playing' && sim.vehicle.x < 190; i++) {
      sim.step(dt, d.input(sim, dt));
      sim.battery = 100;
      for (const e of sim.events) if (e.t === 'popup') pops.push(e.text);
      sim.events.length = 0;
    }
    return { ok: sim.vehicle.x >= 190, pops };
  };

  it('the loop is completable stock and maxed, on flat and hilly approaches', () => {
    for (const lo of [STOCK_LOADOUT, MAXED_LOADOUT]) {
      for (const h of [0, 1.8, 3.6, 5.4]) {
        const r = trial('loop', lo, h);
        expect(r.ok).toBe(true);
        expect(r.pops).toContain('LOOP!');
      }
    }
  });

  it('the plank bridge carries the car and pays the deck run', () => {
    for (const lo of [STOCK_LOADOUT, MAXED_LOADOUT]) {
      const r = trial('bridge', lo, 0);
      expect(r.ok).toBe(true);
      expect(r.pops).toContain('DECK RUN!');
    }
  });

  it('ramps, whoops and half-pipes never stop a stock car', () => {
    for (const k of ['ramp', 'whoops', 'halfpipe'] as PropKind[]) for (const h of [0, 2.7]) expect(trial(k, STOCK_LOADOUT, h).ok).toBe(true);
  });
});

describe('upgrade walls', () => {
  const drive = (seed: number, lo: Loadout) => {
    const track = new EndlessTrack(seed);
    const sim = new RunSim(track, lo);
    const r = autoDrive(sim, 'pro', 420, 9000);
    return { dist: r.distance, sim, track };
  };
  const tier = (t: number): Loadout => ({ ...STOCK_LOADOUT, tiers: { motor: t, traction: t, suspension: t, flip: 0 } });

  it('Endless: a stock car tops the warm-up climbs, then meets a wall it cannot hold', () => {
    for (const seed of [7919, 15838, 31676]) {
      const { dist, sim, track } = drive(seed, STOCK_LOADOUT);
      const climbs = track.firstClimbs(8);
      expect(sim.stats.climbs).toBeGreaterThanOrEqual(1);
      // It never gets over a climb rated a full step and a half above itself.
      const wall = climbs.find((c) => c.rating >= 1.5)!;
      expect(dist).toBeLessThan(wall.riseEnd);
      expect(dist).toBeGreaterThan(climbs[0].riseEnd);
    }
  });

  it('Endless: every upgrade step buys real distance', () => {
    const med = (lo: Loadout) => {
      const d = [7919, 15838, 31676].map((s) => drive(s, lo).dist).sort((a, b) => a - b);
      return d[1];
    };
    const d0 = med(STOCK_LOADOUT);
    const d2 = med(tier(2));
    const d4 = med(tier(4));
    expect(d2).toBeGreaterThan(d0 + 500);
    expect(d4).toBeGreaterThan(d2 + 500);
  });

  it('Adventure: an under-rated car is stopped, a car at the rating finishes', () => {
    for (const [w, l] of [[1, 8], [3, 11], [6, 8]] as const) {
      const need = levelRating(w, l);
      const lv = generateLevel(`w${w}-l${l}`)!;
      // "Under" = a clear step short (a car only a fraction below can still muscle over with momentum).
      const weak = loadoutForRating(need - 1.6);
      expect(carRating(weak)).toBeLessThan(need - 0.9);
      const under = autoDrive(new RunSim(new LevelTrack(lv), weak), 'pro', 400, 1e9);
      const at = autoDrive(new RunSim(new LevelTrack(lv), loadoutForRating(need)), 'pro', 400, 1e9);
      expect(under.cause).not.toBe('completed');
      expect(at.cause).toBe('completed');
    }
  });

  it('a stalled car is told why, and summits pay', () => {
    const lv = generateLevel('w3-l11')!;
    const sim = new RunSim(new LevelTrack(lv), STOCK_LOADOUT);
    const d = new AutoDriver('pro');
    sim.live = true;
    const seen = new Set<string>();
    const pops: string[] = [];
    for (let i = 0; i < 200 * CFG.stepHz && sim.status === 'playing'; i++) {
      sim.step(dt, d.input(sim, dt));
      for (const e of sim.events) {
        seen.add(e.t);
        if (e.t === 'popup') pops.push(e.text);
      }
      sim.events.length = 0;
    }
    expect(seen.has('stall')).toBe(true);
    expect(sim.lastStall!.rating).toBeGreaterThan(sim.climbRating);
    expect(pops.some((p) => p.startsWith('CLIMB '))).toBe(true);
    expect(sim.status).toBe('ended'); // the wall, then the battery, ends the run

    const ok = new RunSim(new LevelTrack(generateLevel('w1-l2')!), STOCK_LOADOUT);
    autoDrive(ok, 'pro', 120, 1e9);
    expect(ok.stats.climbs).toBe(1);
  });

  it('a half-pipe is never a trap: a stock car drives out from a dead stop at the bottom', () => {
    const sim = new RunSim(new FnTrack(() => 0, undefined, [{ kind: 'halfpipe', x: 30, size: 1 }]), STOCK_LOADOUT);
    sim.live = true;
    run(sim, 0.3);
    sim.placeAt(43); // the deepest point of the big pipe
    run(sim, 1.0);
    run(sim, 8, gas);
    expect(sim.vehicle.x).toBeGreaterThan(60);
  });
});

describe('completability', () => {
  it('every world opener is finishable stock with charge to spare', () => {
    for (let w = 1; w <= 6; w++) {
      const sim = new RunSim(new LevelTrack(generateLevel(`w${w}-l1`)!), STOCK_LOADOUT);
      const r = autoDrive(sim, 'pro', 90, 1e9);
      expect(r.cause).toBe('completed');
      expect(r.battery).toBeGreaterThan(0.5);
    }
  });

  it('the first three levels of a world need no upgrades', () => {
    for (const w of [2, 5]) {
      for (const l of [2, 3]) {
        const r = autoDrive(new RunSim(new LevelTrack(generateLevel(`w${w}-l${l}`)!), STOCK_LOADOUT), 'pro', 150, 1e9);
        expect(r.cause).toBe('completed');
      }
    }
  });

  it('a stock car reaches the end of the hook zone in endless', () => {
    for (const seed of [3, 17, 256]) {
      const r = autoDrive(new RunSim(new EndlessTrack(seed), STOCK_LOADOUT), 'pro', 60, CFG.hookM + 20);
      expect(r.distance).toBeGreaterThanOrEqual(CFG.hookM);
    }
  });
});
