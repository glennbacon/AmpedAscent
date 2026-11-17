// Adventure: 6 worlds × 15 levels, generated at runtime from a seed (no bundled level files).
// Every world's level 1 is open from a fresh save; later levels unlock in order within a world.

import { CFG, clamp, lerp, smoothstep, TAU } from './config';
import { hash32, Rng } from './rng';
import { POWERUPS, PowerupKind, RARE_KINDS } from './powerups';
import {
  isBody, isFairPlacement, LevelData, LevelPickup, LevelTrack, PickupKind, placeProp, PROP, PropDef, propRewardCoins,
  propSpan, rampGeom, loopGeom,
} from './track';
import { WORLD_ORDER, WORLDS, WorldId } from './worlds';

export const CAMPAIGN = { worlds: WORLD_ORDER.length, levelsPerWorld: 15 } as const;

export const levelId = (world: number, level: number) => `w${world}-l${level}`;
export function parseLevelId(id: string): { world: number; level: number } | null {
  const m = /^w(\d+)-l(\d+)$/.exec(id);
  if (!m) return null;
  const world = +m[1];
  const level = +m[2];
  if (world < 1 || world > CAMPAIGN.worlds || level < 1 || level > CAMPAIGN.levelsPerWorld) return null;
  return { world, level };
}
export function nextLevelId(id: string): string | null {
  const p = parseLevelId(id);
  if (!p || p.level >= CAMPAIGN.levelsPerWorld) return null;
  return levelId(p.world, p.level + 1);
}
export const levelLength = (level: number) => 300 + 200 * (level - 1);
export const firstClearBonus = (level: number) => 250 + 50 * level;
export const worldOfLevel = (world: number): WorldId => WORLD_ORDER[world - 1];

export function isUnlocked(id: string, completed: ReadonlySet<string>, devUnlock = false): boolean {
  const p = parseLevelId(id);
  if (!p) return false;
  if (devUnlock || p.level === 1) return true;
  return completed.has(levelId(p.world, p.level - 1));
}

// ---- mastery stars: 3 bits per level, OR-accumulated ----------------------------------------
export const STAR_CLEAR = 1;
export const STAR_COMBO = 2;
export const STAR_CHARGE = 4;
export function earnedStars(bestMultiplier: number, batteryFraction: number): number {
  return (
    STAR_CLEAR |
    (bestMultiplier >= CFG.masteryComboMultiplier ? STAR_COMBO : 0) |
    (batteryFraction >= CFG.masteryBatteryFraction ? STAR_CHARGE : 0)
  );
}
export const starCount = (mask: number) => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
/** Each newly earned star pays the level's first-clear bonus once. */
export const starPayout = (level: number, prior: number, earned: number) => firstClearBonus(level) * starCount(earned & ~prior);

// ---- difficulty curves ----------------------------------------------------------------------
const WORLD_AMP_CEIL = [1.0, 1.08, 1.15, 1.1, 1.25, 1.45];
const STEEP_FLOOR = 0.6;
const STEEP_CEIL = [0.95, 1.0, 1.05, 0.98, 1.15, 1.35]; // the last world is a deliberate upgrade wall
export const slopeBar = (world: number) => (world >= 6 ? 1.5 : 1.2);

export const ampMul = (world: number, level: number) =>
  lerp(0.6, WORLD_AMP_CEIL[world - 1], smoothstep((level - 1) / (CAMPAIGN.levelsPerWorld - 1)));
export const steepTarget = (world: number, level: number) =>
  level < 4 ? 0 : lerp(STEEP_FLOOR, STEEP_CEIL[world - 1], (level - 4) / (CAMPAIGN.levelsPerWorld - 4));

const cache = new Map<string, LevelData>();

export function generateLevel(id: string): LevelData | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = parseLevelId(id);
  if (!p) return null;
  const { world, level } = p;
  const def = WORLDS[worldOfLevel(world)];
  const rng = new Rng(hash32(0xa3ed, world, level));
  const texRng = new Rng(hash32(0x7e87, world, level)); // texture stream: never perturbs pickup/prop draws
  const length = levelLength(level);
  const amp = ampMul(world, level);
  const steep = steepTarget(world, level);

  // Per-level texture: jittered wavelengths + free phases, so no two levels roll the same hills.
  const octs = def.octaves.map((o) => ({
    amp: o.amp * amp,
    wave: o.wave * (level < 4 ? 1 : texRng.range(0.82, 1.18)),
    phase: texRng.range(0, TAU),
  }));
  const spice = { wave: def.spice.wave * texRng.range(0.9, 1.1), phase: texRng.range(0, TAU) };

  // Section plan (l4+): varied stretches — one runs at full steepness with calmer neighbours.
  interface Section { x0: number; x1: number; amp: number; steep: number }
  const sections: Section[] = [];
  if (level >= 4) {
    let x = 0;
    while (x < length) {
      const len = texRng.range(150, 350);
      sections.push({ x0: x, x1: Math.min(length, x + len), amp: texRng.range(0.78, 1.08), steep: texRng.range(0.35, 0.75) });
      x += len;
    }
    const mid = Math.min(sections.length - 1, Math.max(0, Math.round(sections.length * 0.55)));
    sections[mid].steep = 1;
    sections[mid].amp = 1.05;
    sections[sections.length - 1].steep = Math.min(sections[sections.length - 1].steep, 0.6);
  } else sections.push({ x0: 0, x1: length, amp: 1, steep: 0 });
  const envAt = (x: number) => {
    // Linear cross-fade ±25 m around each section boundary.
    let a = sections[0].amp;
    let s = sections[0].steep;
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      if (x >= sec.x0) {
        const prev = sections[Math.max(0, i - 1)];
        const t = smoothstep((x - sec.x0 + 25) / 50);
        a = lerp(prev.amp, sec.amp, i === 0 ? 1 : t);
        s = lerp(prev.steep, sec.steep, i === 0 ? 1 : t);
      }
    }
    return { a, s };
  };

  const climbShare = level < 9 ? 0 : lerp(0, world >= 6 ? 0.62 : 0.34, (level - 8) / 7);
  const baseSlopeBound = octs.reduce((sum, o) => sum + (o.amp * TAU) / o.wave, 0);
  const raw = (x: number, kSpice: number, kAll: number) => {
    const { a, s } = envAt(x);
    let y = 0;
    for (const o of octs) y += a * o.amp * Math.sin((x / o.wave) * TAU + o.phase);
    if (steep > 0) {
      // Steep layer: the slope still owed to the target is split between punchy crests (the biome's
      // short octave) and SUSTAINED climbs (a boost to the mid octave) — momentum carries a weak car
      // over a crest, only torque and grip get it up a long face.
      const want = Math.max(0, steep * s - baseSlopeBound * a * 0.72);
      y += kSpice * (1 - climbShare) * ((want * spice.wave) / TAU) * Math.sin((x / spice.wave) * TAU + spice.phase);
      const mid = octs[1];
      y += kSpice * climbShare * ((want * mid.wave) / TAU) * Math.sin((x / mid.wave) * TAU + mid.phase);
    }
    return y * kAll;
  };

  // Sample with the ends eased flat. If the realized worst face overshoots the level's bar, scale the
  // crest layer (then everything) down and re-sample — never clamp, a clamp leaves kinks in the ridge.
  const step = 1;
  const n = Math.round(length / step) + 1;
  const heights = new Array<number>(n);
  const bar: number = Math.min(slopeBar(world), Math.max(0.7, steep + 0.04));
  let kSpice = 1;
  let kAll = 1;
  for (let pass = 0; pass < 6; pass++) {
    const h0 = raw(0, kSpice, kAll);
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const ease = smoothstep((x - 8) / 45) * smoothstep((length - 6 - x) / 40);
      heights[i] = (raw(x, kSpice, kAll) - h0) * ease;
      if (i > 0) worst = Math.max(worst, (heights[i] - heights[i - 1]) / step);
    }
    if (worst <= bar) break;
    if (kSpice > 0.15 && steep > 0) kSpice *= Math.max(0.5, (bar / worst) * 0.92);
    else kAll *= (bar / worst) * 0.97;
  }

  const level0: LevelData = { v: 1, name: `${def.name} ${level}`, world: def.id, length, step, heights, pickups: [], props: [] };

  // ---- props: budget rides the level curve; every roll must pass the fairness gate ----
  const probe = new LevelTrack(level0);
  const base = (x: number) => probe.base(x);
  const props: PropDef[] = [];
  const windows: [number, number][] = [];
  const tryPlace = (def: PropDef) => {
    const placed = placeProp(def, props.length, base);
    if (placed.x0 < 70 || placed.x1 > length - 55) return;
    if (windows.some(([a, b]) => placed.x0 < b + 14 && placed.x1 > a - 14)) return;
    if (!isFairPlacement(placed, base, Math.min(CFG.maxFaceSlope as number, slopeBar(world)) as number)) return;
    props.push(def);
    windows.push([placed.x0, placed.x1]);
  };
  let overlayRolls = 0;
  if (level <= 3) overlayRolls = rng.chance(0.5) ? 1 : 0;
  else if (level <= 9) overlayRolls = rng.int(1, 2);
  else overlayRolls = Math.min(3, rng.int(2, 4));
  for (let i = 0; i < overlayRolls; i++) {
    const x = rng.range(80, Math.max(90, length - 110));
    const kr = rng.next();
    const sr = rng.next();
    if (level <= 3) tryPlace(kr < 0.6 ? { kind: 'whoops', x, size: 0 } : { kind: 'ramp', x, size: 0 });
    else if (kr < 0.45) tryPlace({ kind: 'ramp', x, size: sr < 0.4 ? 0 : sr < 0.8 ? 1 : 2 });
    else if (kr < 0.7) tryPlace({ kind: 'whoops', x, size: 0 });
    else tryPlace({ kind: 'halfpipe', x, size: sr < 0.7 ? 0 : 1 });
  }
  // One body prop at most (loop / bridge), from level 4 in every world.
  {
    const maxOdds = world <= 2 ? 0.35 : 0.5;
    const odds = level < 4 ? 0 : maxOdds * lerp(0.3, 1, (level - 4) / 11);
    const roll = rng.next();
    const kindRoll = rng.next();
    const x = rng.range(110, Math.max(120, length - 130));
    if (roll < odds) tryPlace({ kind: kindRoll < 0.6 ? 'loop' : 'bridge', x, size: 0 });
  }
  level0.props = props;

  // ---- pickups ----
  const track = new LevelTrack(level0);
  const placedProps = track.allProps();
  const blocked = (x: number) =>
    placedProps.some((p) => {
      if (p.kind === 'loop') {
        const g = loopGeom(p);
        return x > g.cx - g.r - 3 && x < g.cx + g.r + 3;
      }
      if (p.kind === 'ramp') {
        const g = rampGeom(p);
        return x > g.kickStart - 1 && x < g.lipX + 14;
      }
      return x > p.x - 0.5 && x < p.x + p.span + 0.5;
    });
  const pickups: LevelPickup[] = [];
  const add = (kind: PickupKind, x: number, dy: number) => {
    if (x > 6 && x < length - 4) pickups.push({ kind, x, dy });
  };
  // Energy: a cell every 18–30 m — the level's battery budget.
  const scarcity = (level - 1) / (CAMPAIGN.levelsPerWorld - 1);
  for (let x = 14; x < length - 10; x += rng.range(lerp(18, 30, scarcity), lerp(30, 46, scarcity))) if (!blocked(x)) add('energy', x, 1.35);
  // Coin arcs.
  for (let x = 24; x < length - 16; x += rng.range(28, 44)) {
    const lift = rng.range(0.9, 2.2);
    if (blocked(x) || blocked(x + 6.5)) continue;
    for (let i = 0; i < 5; i++) add('coin', x + i * 1.3, 1.25 + Math.sin((i / 4) * Math.PI) * lift);
  }
  // Power-ups on a 75 m stride. Rares join from level 4, at most one of each per level.
  const usedRares = new Set<PowerupKind>();
  const standardPool: PowerupKind[] = ['turbo', 'magnet', 'frenzy', 'frenzy'];
  for (let x = 60; x < length - 30; x += 75) {
    const jx = x + rng.range(-12, 12);
    const rareRoll = rng.next();
    const rare = rng.pick(RARE_KINDS);
    const common = rng.pick(standardPool);
    if (blocked(jx)) continue;
    const useRare = level >= 4 && rareRoll < 0.34 && !usedRares.has(rare);
    if (useRare) usedRares.add(rare);
    add(useRare ? rare : common, jx, 1.7);
  }
  // Reward lines on props (stored as heights above the drivable surface).
  for (const p of placedProps) {
    for (const c of propRewardCoins(p, (x) => track.height(x))) add('coin', c.x, c.y - track.surface(c.x));
  }
  pickups.sort((a, b) => a.x - b.x);
  level0.pickups = pickups;
  cache.set(id, level0);
  return level0;
}

/** Realized worst uphill face of a level (props excluded) — used by tests and the level card. */
export function levelMaxSlope(level: LevelData): number {
  let worst = 0;
  const t = new LevelTrack({ ...level, props: [], pickups: [] });
  for (let x = 0.5; x < level.length; x += 0.5) worst = Math.max(worst, (t.base(x) - t.base(x - 0.5)) / 0.5);
  return worst;
}

export { POWERUPS, PROP, propSpan, isBody };
