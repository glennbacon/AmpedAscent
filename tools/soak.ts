// Soak: many seeds, long runs. Flags NaNs, cars under the ground, and runs that never end.
import { AutoDriver } from '../src/sim/autodriver';
import { RunSim } from '../src/sim/run';
import { EndlessTrack } from '../src/sim/track';
import { MAXED_LOADOUT, STOCK_LOADOUT } from '../src/sim/upgrades';
const dt = 1 / 120;
let bad = 0;
const rows: string[] = [];
for (const [name, lo] of [['stock', STOCK_LOADOUT], ['maxed', MAXED_LOADOUT]] as const) {
  const dist: number[] = []; const coins: number[] = []; const causes: Record<string, number> = {}; let stunts = 0;
  for (let seed = 100; seed < 100 + Number(process.argv[2] ?? 16); seed++) {
    const sim = new RunSim(new EndlessTrack(seed * 104729), lo);
    const d = new AutoDriver('pro');
    sim.live = true;
    let t = 0;
    while (t < 420 && sim.status === 'playing' && sim.vehicle.x < 9000) {
      sim.step(dt, d.input(sim, dt)); sim.events.length = 0; t += dt;
      const v = sim.vehicle;
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.angle)) { bad++; rows.push(`NaN seed=${seed} t=${t.toFixed(1)}`); break; }
      if (v.y < sim.track.height(v.x) - 1.5) { bad++; rows.push(`UNDERGROUND ${name} seed=${seed} x=${v.x.toFixed(0)} t=${t.toFixed(1)} y=${v.y.toFixed(1)} h=${sim.track.height(v.x).toFixed(1)}`); break; }
    }
    const c = sim.status === 'ended' ? sim.endCause! : sim.status === 'playing' ? (t >= 420 ? 'TIMEOUT' : 'cap') : sim.status;
    causes[c] = (causes[c] ?? 0) + 1;
    dist.push(Math.round(sim.stats.distance)); coins.push(sim.bankCoins); stunts += sim.stats.stunts;
  }
  dist.sort((a, b) => a - b); coins.sort((a, b) => a - b);
  const mid = Math.floor(dist.length / 2);
  console.log(`${name}: dist min/med/max ${dist[0]}/${dist[mid]}/${dist[dist.length - 1]}  coins med ${coins[mid]}  stunts/run ${(stunts / dist.length).toFixed(1)}  ${JSON.stringify(causes)}`);
}
console.log(bad ? `PROBLEMS ${bad}\n${rows.join('\n')}` : 'soak clean');
