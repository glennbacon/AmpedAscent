// Headless prop trials: loop completion, bridge crossing, ramps, half-pipes — stock vs maxed.
import { RunSim } from '../src/sim/run';
import { EndlessTrack, FnTrack, PropKind } from '../src/sim/track';
import { MAXED_LOADOUT, STOCK_LOADOUT, Loadout } from '../src/sim/upgrades';
import { AutoDriver } from '../src/sim/autodriver';
const dt = 1 / 120;
function trial(kind: PropKind, size: number, lo: Loadout, hilly: number, powerup?: string, profile: 'pro' | 'beginner' = 'pro') {
  const fn = (x: number) => (hilly ? Math.sin(x / 9 + hilly) * 1.2 * Math.min(1, Math.max(0, (x - 20) / 20)) : 0);
  const sim = new RunSim(new FnTrack(fn, undefined, [{ kind, x: 70, size }]), lo);
  const d = new AutoDriver(profile);
  sim.live = true;
  if (powerup) sim.grant(powerup as any);
  let t = 0; const pops: string[] = []; let maxY = 0;
  while (t < 30 && sim.status === 'playing' && sim.vehicle.x < 190) {
    sim.step(dt, d.input(sim, dt)); sim.battery = 100; t += dt;
    for (const e of sim.events) if (e.t === 'popup' && e.tone === 'stunt') pops.push(e.text);
    sim.events.length = 0;
    maxY = Math.max(maxY, sim.vehicle.y);
  }
  return { ok: sim.vehicle.x >= 190, x: Math.round(sim.vehicle.x), t: +t.toFixed(1), pops: pops.join(','), status: sim.status, cause: sim.endCause, maxY: +maxY.toFixed(1) };
}
const which = process.argv[2] ?? 'loop';
const kinds: [PropKind, number][] = which === 'all' ? [['loop', 0], ['bridge', 0], ['ramp', 0], ['ramp', 2], ['whoops', 0], ['halfpipe', 0], ['halfpipe', 1]] : [[which as PropKind, Number(process.argv[3] ?? 0)]];
for (const [k, sz] of kinds) {
  for (const [name, lo] of [['stock', STOCK_LOADOUT], ['maxed', MAXED_LOADOUT]] as const) {
    let ok = 0; const fails: string[] = []; let credits = 0;
    for (let h = 0; h < 8; h++) {
      const r = trial(k, sz, lo, h === 0 ? 0 : h * 0.9);
      if (r.ok) ok++; else fails.push(`h${h}:x${r.x}/${r.cause ?? r.status}`);
      if (r.pops) credits++;
      if (h === 0) console.log(`   ${k}${sz} ${name} flat:`, JSON.stringify(r));
    }
    console.log(`${k}${sz} ${name}: ${ok}/8 passed, credits ${credits}/8 ${fails.join(' ')}`);
  }
}
if (which === 'loop' || which === 'all') {
  const r = trial('loop', 0, STOCK_LOADOUT, 0, 'supersized');
  console.log('giant vs loop:', JSON.stringify(r));
  const b = trial('loop', 0, STOCK_LOADOUT, 0, undefined, 'beginner');
  console.log('beginner stock loop:', JSON.stringify(b));
}
