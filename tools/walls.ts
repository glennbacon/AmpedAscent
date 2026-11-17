// Upgrade-wall check: how far does each upgrade tier get in Endless, and which climb stops it?
//   npx vite-node tools/walls.ts [seeds=8]
import { AutoDriver } from '../src/sim/autodriver';
import { carRating, formatRating } from '../src/sim/climbs';
import { RunSim } from '../src/sim/run';
import { EndlessTrack } from '../src/sim/track';
import { Loadout, STOCK_LOADOUT } from '../src/sim/upgrades';

const dt = 1 / 120;
const seeds = Number(process.argv[2] ?? 8);
const eq = (t: number, fwd = false): Loadout => ({ ...STOCK_LOADOUT, has4WD: fwd, tiers: { motor: t, traction: t, suspension: t, flip: 0 } });
const cases: [string, Loadout][] = [
  ['stock', eq(0)], ['tier 1', eq(1)], ['tier 2', eq(2)], ['tier 3', eq(3)], ['tier 4', eq(4)], ['tier 5', eq(5)],
  ['stock + 4WD', eq(0, true)], ['tier 3 + 4WD', eq(3, true)], ['tier 5 + 4WD', eq(5, true)],
];
for (const [name, lo] of cases) {
  const dist: number[] = [];
  const stoppedAt: number[] = [];
  const causes: Record<string, number> = {};
  let coins = 0;
  for (let s = 1; s <= seeds; s++) {
    const track = new EndlessTrack(s * 7919);
    const sim = new RunSim(track, lo);
    const d = new AutoDriver('pro');
    sim.live = true;
    let t = 0;
    while (t < 600 && sim.status === 'playing' && sim.vehicle.x < 12000) {
      sim.step(dt, d.input(sim, dt));
      sim.events.length = 0;
      t += dt;
    }
    const x = sim.vehicle.x;
    dist.push(Math.round(sim.stats.distance));
    coins += sim.bankCoins;
    const c = sim.status === 'ended' ? sim.endCause! : 'cap';
    causes[c] = (causes[c] ?? 0) + 1;
    // Which climb was it on (or heading for)?
    const on = track.climbsIn(x - 30, x + 30).find((k) => x > k.x0 - 30 && x < k.riseEnd + 4);
    stoppedAt.push(on ? on.index + 1 : 0);
  }
  dist.sort((a, b) => a - b);
  const onClimb = stoppedAt.filter((i) => i > 0);
  console.log(
    `${name.padEnd(13)} rating ${formatRating(carRating(lo))}  dist ${dist[0]}/${dist[dist.length >> 1]}/${dist[dist.length - 1]} (min/med/max)  ` +
      `ended on a climb ${onClimb.length}/${seeds}${onClimb.length ? ` (climb #${Math.min(...onClimb)}–${Math.max(...onClimb)})` : ''}  coins/run ${Math.round(coins / seeds)}  ${JSON.stringify(causes)}`,
  );
}
