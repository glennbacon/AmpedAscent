// Adventure gate check: drive campaign levels with cars rated below, at and above each level's rating.
//   npx vite-node tools/camp.ts [levels=1,4,6,8,10,12,15] [worlds=1,2,3,4,5,6]
import { autoDrive } from '../src/sim/autodriver';
import { generateLevel, levelId, levelMaxSlope, levelRating } from '../src/sim/campaign';
import { carRating, formatRating, loadoutForRating } from '../src/sim/climbs';
import { RunSim } from '../src/sim/run';
import { LevelTrack } from '../src/sim/track';
import { Loadout, STOCK_LOADOUT } from '../src/sim/upgrades';

const levels = (process.argv[2] ?? '1,4,6,8,10,12,15').split(',').map(Number);
const worlds = (process.argv[3] ?? '1,2,3,4,5,6').split(',').map(Number);
const run = (id: string, lo: Loadout) => {
  const r = autoDrive(new RunSim(new LevelTrack(generateLevel(id)!), lo), 'pro', 500, 1e9);
  return r.cause === 'completed' ? `OK ${Math.round(r.time)}s ${Math.round(r.battery * 100)}%` : `stop@${Math.round(r.distance)}`;
};
{
  for (const w of worlds) {
    for (const l of levels) {
      const id = levelId(w, l);
      const lv = generateLevel(id)!;
      const need = levelRating(w, l);
      const under = loadoutForRating(need - 1);
      const at = loadoutForRating(need);
      const over = loadoutForRating(need + 1);
      console.log(
        `${id.padEnd(7)} needs ${formatRating(need)}  climbs ${lv.climbs!.length}  maxSlope ${levelMaxSlope(lv).toFixed(2)}  ` +
          `stock[${formatRating(carRating(STOCK_LOADOUT))}]: ${run(id, STOCK_LOADOUT)}  under[${formatRating(carRating(under))}]: ${run(id, under)}  ` +
          `at[${formatRating(carRating(at))}]: ${run(id, at)}  over[${formatRating(carRating(over))}]: ${run(id, over)}`,
      );
    }
  }
}
