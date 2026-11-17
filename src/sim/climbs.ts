// Climbs: the upgrade walls. A climb is one big hill — a long, steady, steep face (the test), a short
// summit, and a gentler descent that gives back part of the height (the reward). Everything about a
// climb derives from one number, its RATING: the equal-tier Motor+Traction level a rear-drive car
// needs to hold the face. Rating 0 = a stock car's limit; each +1 ≈ one more tier of both.
//
// The slope table is MEASURED, not derived: `tools/capacity.ts` drives each equal-tier car up test ramps of
// the matching height and records the steepest face it tops. Re-run it after touching drive force,
// grip, mass, gravity, the wheelie guard or drag, and paste the new numbers here.

import { CFG, clamp, lerp, smoothstep } from './config';
import { Loadout, STOCK_LOADOUT } from './upgrades';

/** Steepest face (rise/run) a rear-drive car with Motor = Traction = rating tops at `climbHeight(rating)`. */
const CAPACITY: [rating: number, slope: number][] = [
  [-3, 0.34], [-2, 0.44], [-1, 0.54], [0, 0.64], [1, 0.74], [2, 0.84], [3, 0.96], [4, 1.1], [5, 1.26], [6, 1.47], [7, 1.7],
];
export const MAX_RATING = 7;

export function capacitySlope(rating: number): number {
  const r = clamp(rating, CAPACITY[0][0], MAX_RATING);
  for (let i = 1; i < CAPACITY.length; i++) {
    if (r <= CAPACITY[i][0]) {
      const [r0, s0] = CAPACITY[i - 1];
      const [r1, s1] = CAPACITY[i];
      return lerp(s0, s1, (r - r0) / (r1 - r0));
    }
  }
  return CAPACITY[CAPACITY.length - 1][1];
}

/** Face slope of a climb of this rating: a hair under capacity, so a car AT the rating gets over. */
export const climbSlope = (rating: number) => capacitySlope(rating) - CFG.climbMargin;
/** Taller walls for faster cars — height is what stops momentum from doing the motor's job. */
export const climbHeight = (rating: number) => clamp(CFG.climbHeightBase + CFG.climbHeightPerRating * rating, CFG.climbHeightMin, CFG.climbHeightMax);

export interface Climb {
  index: number;
  rating: number;
  x0: number; // foot of the face
  slope: number;
  height: number;
  riseLen: number;
  riseEnd: number; // top of the face (start of the summit)
  fallStart: number;
  fallLen: number;
  drop: number; // height given back on the far side
  end: number; // foot of the descent
}

export function makeClimb(index: number, x0: number, rating: number): Climb {
  const slope = climbSlope(rating);
  const height = climbHeight(rating);
  const a = Math.min(CFG.climbFillet, height / slope);
  const riseLen = height / slope + a;
  const drop = height * CFG.climbDescentShare;
  const ad = Math.min(CFG.climbDescentFillet, drop / CFG.climbDescentSlope);
  const fallLen = drop / CFG.climbDescentSlope + ad;
  const riseEnd = x0 + riseLen;
  const fallStart = riseEnd + CFG.climbSummit;
  return { index, rating, x0, slope, height, riseLen, riseEnd, fallStart, fallLen, drop, end: fallStart + fallLen };
}

/** Straight ramp of `slope` with parabolic fillets of length `a` at both ends; rises `h` in total. */
function ramp(u: number, h: number, slope: number, a: number): number {
  const len = h / slope + a;
  if (u <= 0) return 0;
  if (u >= len) return h;
  if (u < a) return (slope * u * u) / (2 * a);
  if (u < len - a) return slope * (u - a / 2);
  return h - (slope * (len - u) * (len - u)) / (2 * a);
}

/** Height the climb adds at x, relative to the ground at its foot. Past its end it leaves a net gain. */
export function climbLift(c: Climb, x: number): number {
  if (x <= c.x0) return 0;
  const a = Math.min(CFG.climbFillet, c.height / c.slope);
  const up = ramp(x - c.x0, c.height, c.slope, a);
  if (x <= c.fallStart) return up;
  const ad = Math.min(CFG.climbDescentFillet, c.drop / CFG.climbDescentSlope);
  return up - ramp(x - c.fallStart, c.drop, CFG.climbDescentSlope, ad);
}

/** 0…1: how much the climb owns the ground at x (the rolling terrain is damped by this). */
export function climbWeight(c: Climb, x: number): number {
  const m = CFG.climbBlendM;
  if (x <= c.x0 - m || x >= c.end + m) return 0;
  // Fades in on the approach, full from the foot to the bottom of the descent (a clean, fast run
  // down — rollers under a car at that speed just pitch it onto its nose), fades out after.
  if (x < c.x0) return smoothstep((x - (c.x0 - m)) / m);
  if (x <= c.end) return 1;
  return 1 - smoothstep((x - c.end) / m);
}

/** Endless: the rating of a climb whose foot is `m` metres into the run. */
export function endlessClimbRating(m: number): number {
  const t = CFG.endlessClimbRatings;
  if (m <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (m <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (m - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
  }
  return t[t.length - 1][1];
}

/**
 * The car's climb rating, for the Garage readout and the "recommended" hints. A fitted estimate of
 * what the sim measures: Motor and Traction both count (the lower one dominates), gearing shifts
 * the motor's share, four-wheel drive is worth roughly a tier and a half.
 */
export function carRating(l: Loadout): number {
  const g = clamp(l.tuning.gearing, -1, 1);
  // Gearing trades torque for speed; express its torque change in motor tiers.
  const m = ((1 + CFG.motorTierForce * l.tiers.motor) * (1 - 0.14 * g) - 1) / CFG.motorTierForce;
  const t = l.tiers.traction;
  let r = Math.min(m, t) + 0.3 * Math.abs(m - t);
  if (l.has4WD && l.tuning.fourWD) r += 1.3 + 0.12 * Math.max(0, m);
  return clamp(r, -1, MAX_RATING + 1);
}

/** Ratings are shown 1-based: a stock car reads 1.0. */
export const shownRating = (r: number) => Math.max(1, r + 1);
export const formatRating = (r: number) => shownRating(r).toFixed(1);

/** Cheapest balanced loadout whose rating reaches `r` (4WD only once tiers alone cannot). QA + tests. */
export function loadoutForRating(r: number): Loadout {
  for (const fwd of [false, true]) {
    for (let t = 0; t <= CFG.upgradeMaxTier; t++) {
      for (const m of [t, t + 1]) {
        if (m > CFG.upgradeMaxTier) continue;
        const lo: Loadout = { ...STOCK_LOADOUT, has4WD: fwd, tiers: { motor: m, traction: t, suspension: t, flip: 0 } };
        if (carRating(lo) >= r - 0.05) return lo;
      }
    }
  }
  return { ...STOCK_LOADOUT, has4WD: true, tiers: { motor: 5, traction: 5, suspension: 5, flip: 0 } };
}
