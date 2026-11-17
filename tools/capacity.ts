// Measures the climb-capacity table in src/sim/climbs.ts: the steepest face each equal-tier car tops,
// on a test ramp of the height a climb of that rating uses. Paste the printed table into CAPACITY.
//   npx vite-node tools/capacity.ts
import { AutoDriver } from '../src/sim/autodriver';
import { carRating, climbHeight } from '../src/sim/climbs';
import { CFG } from '../src/sim/config';
import { RunSim } from '../src/sim/run';
import { FnTrack } from '../src/sim/track';
import { Loadout, STOCK_LOADOUT } from '../src/sim/upgrades';

const dt = 1 / CFG.stepHz;
const ramp = (u: number, H: number, s: number, a: number) => {
  const L = H / s + a;
  if (u <= 0) return 0;
  if (u < a) return (s * u * u) / (2 * a);
  if (u < L - a) return s * (u - a / 2);
  if (u < L) return H - (s * (L - u) * (L - u)) / (2 * a);
  return H;
};
function tops(lo: Loadout, s: number, H: number): boolean {
  const a = Math.min(CFG.climbFillet, H / s);
  const runup = 40;
  const sim = new RunSim(new FnTrack((x) => ramp(x - runup, H, s, a)), lo);
  const d = new AutoDriver('pro');
  sim.live = true;
  const end = runup + H / s + a + 6;
  for (let i = 0; i < 40 * CFG.stepHz && sim.status === 'playing'; i++) {
    sim.step(dt, d.input(sim, dt));
    sim.battery = CFG.batteryCapacity;
    sim.events.length = 0;
    if (sim.vehicle.x > end) return true;
  }
  return false;
}
function capacity(lo: Loadout, H: number): number {
  let best = 0;
  for (let s = 0.4; s <= 2.4; s += 0.02) {
    if (tops(lo, s, H)) best = s;
    else if (s > best + 0.07) break;
  }
  return best;
}
const eq = (t: number, fwd = false): Loadout => ({ ...STOCK_LOADOUT, has4WD: fwd, tiers: { motor: t, traction: t, suspension: 0, flip: 0 } });

const pts: [number, number][] = [];
for (let t = 0; t <= 5; t++) pts.push([t, capacity(eq(t), climbHeight(t))]);
// Above tier 5 only four-wheel drive gets there: use the 4WD cars' own ratings as the x-axis.
const fwd: [number, number][] = [4, 5].map((t) => [carRating(eq(t, true)), capacity(eq(t, true), climbHeight(7))]);
const at = (r: number) => fwd[0][1] + ((fwd[1][1] - fwd[0][1]) * (r - fwd[0][0])) / (fwd[1][0] - fwd[0][0]);
pts.push([6, Math.max(at(6), pts[5][1] + 0.1)], [7, at(7)]);
const step = pts[1][1] - pts[0][1];
const table = [[-3, pts[0][1] - 3 * step], [-2, pts[0][1] - 2 * step], [-1, pts[0][1] - step], ...pts];
console.log('measured:', pts.map(([r, s]) => `r${r}=${s.toFixed(2)}`).join('  '), ' | 4WD t4/t5:', fwd.map(([r, s]) => `r${r.toFixed(2)}=${s.toFixed(2)}`).join(' '));
console.log(`const CAPACITY: [rating: number, slope: number][] = [\n  ${table.map(([r, s]) => `[${r}, ${s.toFixed(2)}]`).join(', ')},\n];`);
// Separation: the tier below must NOT top the wall built for a rating.
console.log('tier below at each wall:', [1, 2, 3, 4, 5].map((r) => `r${r}: tier${r - 1}=${capacity(eq(r - 1), climbHeight(r)).toFixed(2)} vs wall ${(pts[r][1] - CFG.climbMargin).toFixed(2)}`).join('  '));
