// Headless feel lab: `npm run tune`. Prints the numbers the physics is judged by.
import { CFG } from '../src/sim/config';
import { RunSim } from '../src/sim/run';
import { EndlessTrack, FnTrack } from '../src/sim/track';
import { MAXED_LOADOUT, STOCK_LOADOUT, Loadout } from '../src/sim/upgrades';
import { autoDrive } from '../src/sim/autodriver';

const dt = 1 / 120;
const fmt = (n: number, d = 2) => n.toFixed(d);

function flat(l: Loadout, label: string) {
  const sim = new RunSim(new FnTrack(() => 0), l);
  sim.live = true;
  for (let i = 0; i < 120; i++) sim.step(dt, { gas: 0, brake: 0, jump: false });
  const restY = sim.vehicle.y;
  let t = 0, t10 = -1, maxTilt = 0;
  while (t < 9) {
    sim.step(dt, { gas: 1, brake: 0, jump: false });
    sim.battery = 100;
    t += dt;
    if (t10 < 0 && sim.vehicle.speed >= 10) t10 = t;
    maxTilt = Math.max(maxTilt, sim.vehicle.angle);
  }
  const top = sim.vehicle.speed;
  // braking distance
  const x0 = sim.vehicle.x; let tb = 0;
  while (sim.vehicle.speed > 0.5 && tb < 6) { sim.step(dt, { gas: 0, brake: 1, jump: false }); tb += dt; }
  console.log(`[flat ${label}] restY=${fmt(restY)} 0-10m/s=${fmt(t10)}s top=${fmt(top)} maxTilt=${fmt(maxTilt * 57.3, 1)}° brake=${fmt(sim.vehicle.x - x0, 1)}m/${fmt(tb)}s`);
}

function drop(l: Loadout, h: number, label: string) {
  const sim = new RunSim(new FnTrack(() => 0), l);
  sim.live = true;
  for (let i = 0; i < 60; i++) sim.step(dt, { gas: 0, brake: 0, jump: false });
  const rest = sim.vehicle.y;
  sim.placeAt(0, h);
  let t = 0, contact = -1, settle = -1, peakAfter = -1e9, minY = 1e9, bounces = 0, wasAir = true, lastAbove = 0;
  while (t < 4) {
    sim.step(dt, { gas: 0, brake: 0, jump: false });
    sim.battery = 100;
    t += dt;
    const y = sim.vehicle.y - rest;
    if (contact < 0 && sim.vehicle.anyGrounded) contact = t;
    if (contact >= 0) {
      minY = Math.min(minY, y);
      if (t > contact + 0.1) peakAfter = Math.max(peakAfter, y);
      if (wasAir && sim.vehicle.anyGrounded && t > contact + 0.05) bounces++;
      wasAir = !sim.vehicle.anyGrounded;
      if (Math.abs(y) > 0.03 || Math.abs(sim.vehicle.vy) > 0.25) lastAbove = t;
    }
  }
  settle = lastAbove - contact;
  console.log(`[drop ${h}m ${label}] bottom=${fmt(minY)}m rebound=${fmt(peakAfter)}m rebounds=${bounces} settle=${fmt(settle)}s`);
}

function climb(l: Loadout, label: string) {
  const res: string[] = [];
  for (const slope of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5]) {
    // 25 m flat run-up, then a constant slope (smooth 6 m transition).
    const f = (x: number) => {
      if (x < 25) return 0;
      const d = x - 25;
      return d < 6 ? (slope * d * d) / 12 : slope * (d - 3);
    };
    const sim = new RunSim(new FnTrack(f), l);
    sim.live = true;
    let t = 0, flipped = false;
    while (t < 14) {
      const tilt = sim.vehicle.angle - Math.atan(sim.track.slope(sim.vehicle.x));
      sim.step(dt, { gas: tilt > 0.5 ? 0 : 1, brake: 0, jump: false });
      sim.battery = 100;
      t += dt;
      if (Math.abs(tilt) > 1.7) { flipped = true; break; }
    }
    const gained = sim.vehicle.y - 1;
    res.push(`${slope}:${flipped ? 'FLIP' : ''}${fmt(gained, 0)}m@${fmt(sim.vehicle.speed, 1)}`);
  }
  console.log(`[climb ${label}] height gained in 14s @ end speed → ${res.join('  ')}`);
}

function jump(l: Loadout, label: string) {
  // crest launch: 30 m run-up into a 20° kicker
  const f = (x: number) => (x < 40 ? 0 : x < 48 ? ((x - 40) ** 2) / 44 : -2);
  const sim = new RunSim(new FnTrack(f), l);
  sim.live = true;
  let t = 0, air = 0, maxH = 0, landX = 0;
  while (t < 9 && sim.vehicle.x < 120) {
    sim.step(dt, { gas: sim.vehicle.x < 47 ? 1 : 0, brake: 0, jump: false });
    sim.battery = 100;
    t += dt;
    for (const e of sim.events) if (e.t === 'land' && e.airTime > air) { air = e.airTime; landX = e.x; }
    sim.events.length = 0;
    maxH = Math.max(maxH, sim.vehicle.y);
  }
  console.log(`[jump ${label}] air=${fmt(air)}s apex=${fmt(maxH)}m landX=${fmt(landX, 1)}`);
}

function endless(l: Loadout, label: string, profile: 'beginner' | 'pro') {
  const ds: number[] = [];
  const causes: Record<string, number> = {};
  for (let seed = 1; seed <= 8; seed++) {
    const sim = new RunSim(new EndlessTrack(seed * 7919), l);
    const r = autoDrive(sim, profile, 200, 3500);
    ds.push(Math.round(r.distance));
    causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  }
  ds.sort((a, b) => a - b);
  console.log(`[endless ${label} ${profile}] dist=${ds.join(',')} median=${ds[4]} causes=${JSON.stringify(causes)}`);
}

const which = process.argv[2] ?? 'all';
console.log(`g=${CFG.gravity} fall×${CFG.fallGravityMul}`);
if (which === 'all' || which === 'flat') { flat(STOCK_LOADOUT, 'stock'); flat(MAXED_LOADOUT, 'maxed'); flat({ ...MAXED_LOADOUT, has4WD: false }, 'maxed-rwd'); }
if (which === 'all' || which === 'drop') { for (const h of [1, 3, 6]) { drop(STOCK_LOADOUT, h, 'stock'); drop(MAXED_LOADOUT, h, 'maxed'); } }
if (which === 'all' || which === 'climb') { climb(STOCK_LOADOUT, 'stock'); climb({ ...STOCK_LOADOUT, has4WD: true }, 'stock+4wd'); climb(MAXED_LOADOUT, 'maxed'); climb({ ...MAXED_LOADOUT, has4WD: false }, 'maxed-rwd'); }
if (which === 'all' || which === 'jump') { jump(STOCK_LOADOUT, 'stock'); jump(MAXED_LOADOUT, 'maxed'); }
if (which === 'all' || which === 'endless') {
  endless(STOCK_LOADOUT, 'stock', 'beginner'); endless(STOCK_LOADOUT, 'stock', 'pro');
  endless(MAXED_LOADOUT, 'maxed', 'beginner'); endless(MAXED_LOADOUT, 'maxed', 'pro');
}
