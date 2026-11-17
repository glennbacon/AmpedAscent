import { generateLevel, levelId, levelMaxSlope, CAMPAIGN } from '../src/sim/campaign';
import { RunSim } from '../src/sim/run';
import { LevelTrack } from '../src/sim/track';
import { MAXED_LOADOUT, STOCK_LOADOUT, Loadout } from '../src/sim/upgrades';
import { autoDrive } from '../src/sim/autodriver';
const mid: Loadout = { tiers: { motor: 3, traction: 3, suspension: 2, flip: 1 }, has4WD: false, tuning: STOCK_LOADOUT.tuning };
const levels = (process.argv[2] ?? '1,4,8,12,15').split(',').map(Number);
for (let w = 1; w <= CAMPAIGN.worlds; w++) {
  const row: string[] = [];
  for (const l of levels) {
    const lv = generateLevel(levelId(w, l))!;
    const res = [STOCK_LOADOUT, mid, MAXED_LOADOUT].map((lo) => {
      const r = autoDrive(new RunSim(new LevelTrack(lv), lo), 'pro', 400, 1e9);
      return r.cause === 'completed' ? `ok${Math.round(r.time)}s/${Math.round(r.battery * 100)}%` : `${r.cause[0]}@${Math.round(r.distance)}`;
    });
    row.push(`l${l}[s${levelMaxSlope(lv).toFixed(2)} p${lv.props.map((p) => p.kind[0]).join('')}] ${res.join(' ')}`);
  }
  console.log(`w${w}: ${row.join(' | ')}`);
}
