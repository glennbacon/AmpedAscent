import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN, earnedStars, firstClearBonus, generateLevel, isUnlocked, levelId, levelLength, levelMaxSlope, levelRating, levelSlopeLimit, nextLevelId,
  parseLevelId, slopeBar, starCount, starPayout, STAR_CHARGE, STAR_CLEAR, STAR_COMBO,
} from '../src/sim/campaign';
import { capacitySlope, carRating, climbHeight, climbLift, climbSlope, endlessClimbRating, loadoutForRating, makeClimb, MAX_RATING } from '../src/sim/climbs';
import { CFG } from '../src/sim/config';
import { POWERUP_KINDS, POWERUPS, PowerupState, RARE_KINDS, STANDARD_KINDS } from '../src/sim/powerups';
import { hash01, Rng } from '../src/sim/rng';
import { EndlessTrack, isFairPlacement, LevelTrack, placeProp, sanitizeLevel } from '../src/sim/track';
import { deriveStats, MAXED_LOADOUT, STOCK_LOADOUT, upgradeCost } from '../src/sim/upgrades';
import { WORLD_ORDER } from '../src/sim/worlds';
import { Save } from '../src/core/save';

describe('rng', () => {
  it('is deterministic and uniform-ish', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
  });
});

describe('endless track', () => {
  it('is a pure function of the seed, whatever order it is sampled in', () => {
    const a = new EndlessTrack(4242);
    const b = new EndlessTrack(4242);
    for (let x = 3000; x >= -40; x -= 37) b.height(x); // sample b backwards first
    for (let x = -40; x <= 3000; x += 11.3) expect(a.height(x)).toBeCloseTo(b.height(x), 9);
    const pa = a.pickupsIn(0, 2500).map((p) => `${p.kind}@${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    const c = new EndlessTrack(4242);
    for (let x = 0; x < 2500; x += 90) c.pickupsIn(x, x + 90); // streamed in small windows
    expect(c.pickupsIn(0, 2500).map((p) => `${p.kind}@${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toEqual(pa);
    expect(new EndlessTrack(7).height(500)).not.toBeCloseTo(a.height(500), 3);
  });

  it('starts on a level pad and never tears, including across biome seams', () => {
    for (const seed of [1, 99, 4242]) {
      const t = new EndlessTrack(seed);
      expect(Math.abs(t.slope(0))).toBeLessThan(0.02);
      const seam = t.firstSeamX();
      expect(seam).toBeGreaterThanOrEqual(CFG.seamMinM);
      expect(seam).toBeLessThanOrEqual(CFG.seamMaxM);
      let prev = t.base(-40);
      for (let x = -39.75; x < seam + 300; x += 0.25) {
        const h = t.base(x);
        expect(Math.abs(h - prev)).toBeLessThan(0.45); // base slope stays far under any wall
        prev = h;
      }
    }
  });

  it('cycles every biome and never repeats one back-to-back', () => {
    const seq = new EndlessTrack(31337).biomeSequence(13);
    expect(seq[0]).toBe('sylvan');
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq.slice(1, 7)).size).toBe(WORLD_ORDER.length);
  });

  it('keeps the hook zone gentle: whoops only, common power-ups only, nothing behind the start', () => {
    for (const seed of [5, 6, 7, 8, 9, 10]) {
      const t = new EndlessTrack(seed);
      for (const p of t.propsIn(0, CFG.hookM - 20)) expect(p.kind).toBe('whoops');
      for (const p of t.pickupsIn(0, CFG.hookM)) if (p.kind !== 'coin' && p.kind !== 'energy') expect(STANDARD_KINDS).toContain(p.kind);
      expect(t.pickupsIn(-200, 0)).toEqual([]);
      // The 48–72 m chunk always pays a power-up.
      expect(t.pickupsIn(48, 72).some((p) => p.kind !== 'coin' && p.kind !== 'energy')).toBe(true);
    }
  });

  it('only realizes props that pass the fairness gate and never overlaps their windows', () => {
    const t = new EndlessTrack(2024);
    const props = t.propsIn(0, 6000);
    expect(props.length).toBeGreaterThan(20);
    for (let i = 0; i < props.length; i++) {
      expect(isFairPlacement(props[i], (x) => t.base(x))).toBe(true);
      if (i) expect(props[i].x0).toBeGreaterThan(props[i - 1].x1);
    }
    expect(new Set(props.map((p) => p.kind)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('campaign', () => {
  it('has the documented shape and unlock rules', () => {
    expect(CAMPAIGN.worlds).toBe(6);
    expect(levelLength(1)).toBe(300);
    expect(levelLength(15)).toBe(3100);
    expect(firstClearBonus(4)).toBe(450);
    expect(parseLevelId('w3-l7')).toEqual({ world: 3, level: 7 });
    expect(parseLevelId('w7-l1')).toBeNull();
    expect(nextLevelId('w2-l15')).toBeNull();
    expect(nextLevelId('w2-l3')).toBe('w2-l4');
    const done = new Set(['w1-l1']);
    for (let w = 1; w <= 6; w++) expect(isUnlocked(levelId(w, 1), new Set())).toBe(true); // parallel worlds
    expect(isUnlocked('w1-l2', done)).toBe(true);
    expect(isUnlocked('w1-l3', done)).toBe(false);
    expect(isUnlocked('w2-l2', done)).toBe(false);
    expect(isUnlocked('w5-l15', new Set(), true)).toBe(true);
  });

  it('pays each star exactly once', () => {
    expect(earnedStars(1, 0.1)).toBe(STAR_CLEAR);
    expect(earnedStars(CFG.masteryComboMultiplier - 1, 0.1)).toBe(STAR_CLEAR);
    expect(earnedStars(CFG.masteryComboMultiplier, 0.1)).toBe(STAR_CLEAR | STAR_COMBO);
    expect(earnedStars(CFG.masteryComboMultiplier, 0.6)).toBe(7);
    expect(starCount(7)).toBe(3);
    expect(starPayout(4, 0, 7)).toBe(3 * firstClearBonus(4));
    expect(starPayout(4, STAR_CLEAR, 7)).toBe(2 * firstClearBonus(4));
    expect(starPayout(4, 7, 7)).toBe(0);
    expect(starPayout(4, STAR_CLEAR | STAR_CHARGE, STAR_CLEAR)).toBe(0);
  });

  it('generates all 90 levels deterministically inside their slope bars', () => {
    let rareCarriers = 0;
    for (let w = 1; w <= CAMPAIGN.worlds; w++) {
      for (let l = 1; l <= CAMPAIGN.levelsPerWorld; l++) {
        const id = levelId(w, l);
        const lv = generateLevel(id)!;
        expect(lv.length).toBe(levelLength(l));
        expect(lv.heights.length).toBe(lv.length / lv.step + 1);
        expect(lv.heights[0]).toBeCloseTo(0, 6);
        expect(levelMaxSlope(lv)).toBeLessThanOrEqual(levelSlopeLimit(w, l) + 0.02);
        // Climbs: at least one, easiest first, the last at the level's own rating, clear of both ends.
        const climbs = lv.climbs!;
        expect(climbs.length).toBeGreaterThanOrEqual(1);
        expect(climbs[climbs.length - 1].rating).toBeCloseTo(levelRating(w, l), 6);
        for (let k = 1; k < climbs.length; k++) expect(climbs[k].rating).toBeGreaterThan(climbs[k - 1].rating);
        expect(climbs[0].x0).toBeGreaterThan(80);
        expect(climbs[climbs.length - 1].riseEnd).toBeLessThan(lv.length - 60);
        // Rares join at level 4, at most one of each.
        const rares = lv.pickups.filter((p) => (RARE_KINDS as string[]).includes(p.kind)).map((p) => p.kind);
        if (l < 4) expect(rares).toEqual([]);
        expect(new Set(rares).size).toBe(rares.length);
        if (rares.length) rareCarriers++;
        expect(lv.pickups.filter((p) => p.kind === 'energy').length).toBeGreaterThanOrEqual(Math.floor(lv.length / 48));
        expect(lv.props.filter((p) => p.kind === 'loop' || p.kind === 'bridge').length).toBeLessThanOrEqual(1);
        if (l < 4) expect(lv.props.every((p) => p.kind === 'whoops' || p.kind === 'ramp')).toBe(true);
        // Every prop sits on ground it is fair to build on, clear of the start and finish.
        const t = new LevelTrack({ ...lv, props: [], pickups: [] });
        for (const def of lv.props) {
          const p = placeProp(def, 0, (x) => t.base(x));
          expect(p.x0).toBeGreaterThanOrEqual(70);
          expect(p.x1).toBeLessThanOrEqual(lv.length - 55);
          expect(isFairPlacement(p, (x) => t.base(x), Math.min(CFG.maxFaceSlope, slopeBar(w)))).toBe(true);
          for (const c of climbs) expect(p.x1 < c.x0 - 10 || p.x0 > c.riseEnd).toBe(true); // faces stay clean
        }
      }
    }
    expect(rareCarriers).toBeGreaterThan(20);
    expect(generateLevel('w4-l9')).toBe(generateLevel('w4-l9')); // cached instance
    expect(generateLevel('nope')).toBeNull();
  });

  it('gets steeper with level and hardest in the last world', () => {
    const s = (w: number, l: number) => levelMaxSlope(generateLevel(levelId(w, l))!);
    for (let w = 1; w <= 6; w++) expect(s(w, 15)).toBeGreaterThan(s(w, 1));
    expect(s(6, 15)).toBeGreaterThan(s(1, 15));
  });
});

describe('power-ups and upgrades', () => {
  it('has nine kinds, three commons, unique colours', () => {
    expect(POWERUP_KINDS.length).toBe(9);
    expect(STANDARD_KINDS).toEqual(['turbo', 'magnet', 'frenzy']);
    expect(new Set(POWERUP_KINDS.map((k) => POWERUPS[k].color)).size).toBe(9);
    const st = new PowerupState();
    st.activate('turbo');
    expect(st.isActive('turbo')).toBe(true);
    expect(st.tick(POWERUPS.turbo.duration - 0.01)).toEqual([]);
    expect(st.tick(0.02)).toEqual(['turbo']);
    expect(st.isActive('turbo')).toBe(false);
  });

  it('prices and scales upgrades as designed', () => {
    expect([0, 1, 2, 3, 4].map(upgradeCost)).toEqual([800, 1600, 3200, 6400, 12800]);
    const a = deriveStats(STOCK_LOADOUT);
    const b = deriveStats(MAXED_LOADOUT);
    expect(b.driveForce).toBeGreaterThan(a.driveForce * 1.5);
    expect(b.topSpeed).toBeGreaterThan(a.topSpeed * 1.65);
    expect(b.grip).toBeGreaterThan(a.grip * 1.4);
    expect(b.dampRebound).toBeGreaterThan(a.dampRebound);
    expect(b.airAccel).toBeCloseTo(a.airAccel * 2, 5);
    expect(a.fourWD).toBe(false);
    expect(b.fourWD).toBe(true);
    // Gearing is a trade, never free power.
    const tall = deriveStats({ ...STOCK_LOADOUT, tuning: { ...STOCK_LOADOUT.tuning, gearing: 1 } });
    expect(tall.topSpeed).toBeGreaterThan(a.topSpeed);
    expect(tall.driveForce).toBeLessThan(a.driveForce);
  });
});

describe('climbs (the upgrade walls)', () => {
  it('rates steeper and taller with every step, and a climb leaves a net ascent', () => {
    for (let r = -2; r < MAX_RATING; r += 0.5) {
      expect(capacitySlope(r + 0.5)).toBeGreaterThan(capacitySlope(r));
      expect(climbSlope(r)).toBeLessThan(capacitySlope(r));
      expect(climbHeight(r + 0.5)).toBeGreaterThanOrEqual(climbHeight(r));
    }
    const c = makeClimb(0, 100, 2);
    expect(climbLift(c, 99)).toBe(0);
    expect(climbLift(c, c.riseEnd)).toBeCloseTo(c.height, 6);
    expect(climbLift(c, c.end + 5)).toBeCloseTo(c.height * (1 - CFG.climbDescentShare), 6);
    // The face is a clean ramp at the rated slope: no step is steeper.
    let worst = 0;
    for (let x = c.x0; x < c.riseEnd; x += 0.25) worst = Math.max(worst, (climbLift(c, x + 0.25) - climbLift(c, x)) / 0.25);
    expect(worst).toBeLessThanOrEqual(c.slope + 1e-6);
    expect(worst).toBeGreaterThan(c.slope - 0.01);
  });

  it('rates the car: both Motor and Traction count, 4WD is a big step, gearing shifts it', () => {
    expect(carRating(STOCK_LOADOUT)).toBe(0);
    const t = (motor: number, traction: number, fwd = false) => carRating({ ...STOCK_LOADOUT, has4WD: fwd, tiers: { motor, traction, suspension: 0, flip: 0 } });
    for (let k = 1; k <= 5; k++) expect(t(k, k)).toBeCloseTo(k, 6);
    expect(t(5, 0)).toBeLessThan(2); // power without grip is mostly wasted
    expect(t(0, 5)).toBeLessThan(2);
    expect(t(3, 2)).toBeGreaterThan(t(2, 2));
    expect(t(2, 2, true) - t(2, 2)).toBeGreaterThan(1.2);
    const short = carRating({ ...STOCK_LOADOUT, tiers: { ...STOCK_LOADOUT.tiers, motor: 2, traction: 3 }, tuning: { ...STOCK_LOADOUT.tuning, gearing: -1 } });
    expect(short).toBeGreaterThan(t(2, 3));
    for (const r of [0, 1.5, 3, 4.6, 6]) expect(carRating(loadoutForRating(r))).toBeGreaterThanOrEqual(r - 0.05);
  });

  it('lays an ever-harder ladder of climbs through Endless, clear of props and the hook zone', () => {
    expect(endlessClimbRating(0)).toBeLessThan(-1);
    expect(endlessClimbRating(550)).toBeCloseTo(0, 6);
    expect(endlessClimbRating(3600)).toBeCloseTo(5, 6);
    for (let m = 0; m < 9000; m += 250) expect(endlessClimbRating(m + 250)).toBeGreaterThanOrEqual(endlessClimbRating(m));
    for (const seed of [3, 44, 505]) {
      const track = new EndlessTrack(seed);
      const climbs = track.firstClimbs(14);
      expect(climbs[0].x0).toBeGreaterThanOrEqual(CFG.hookM);
      expect(climbs[0].rating).toBeLessThan(-1); // the first wall is a warm-up for a stock car
      for (let i = 1; i < climbs.length; i++) {
        expect(climbs[i].rating).toBeGreaterThan(climbs[i - 1].rating);
        expect(climbs[i].x0 - climbs[i - 1].end).toBeGreaterThanOrEqual(CFG.endlessClimbGap[0] - 1e-6);
      }
      for (const c of climbs) {
        // The realized face matches the rated slope (rollers are damped out on it).
        let worst = 0;
        for (let x = c.x0 + 8; x < c.riseEnd - 8; x += 0.5) worst = Math.max(worst, (track.base(x + 0.5) - track.base(x)) / 0.5);
        expect(worst).toBeLessThan(c.slope + 0.08);
        expect(worst).toBeGreaterThan(c.slope - 0.08);
        expect(track.propsIn(c.x0 - 8, c.riseEnd).length).toBe(0);
        // A cell at the foot and one on the summit.
        const cells = track.pickupsIn(c.x0 - 10, c.riseEnd + 8).filter((p) => p.kind === 'energy');
        expect(cells.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('asks more of the car with every Adventure level, most in the last world', () => {
    for (let w = 1; w <= CAMPAIGN.worlds; w++) {
      for (let l = 1; l <= 3; l++) expect(levelRating(w, l)).toBeLessThan(0); // a stock car's first three levels
      for (let l = 4; l <= 15; l++) expect(levelRating(w, l)).toBeGreaterThan(levelRating(w, l - 1));
      if (w > 1) expect(levelRating(w, 15)).toBeGreaterThan(levelRating(w - 1, 15));
    }
    expect(levelRating(1, 15)).toBeCloseTo(3, 6);
    expect(levelRating(6, 15)).toBeCloseTo(6, 6); // maxed tiers alone are not enough: this one wants 4WD
    expect(carRating({ ...STOCK_LOADOUT, tiers: { motor: 5, traction: 5, suspension: 5, flip: 5 } })).toBeLessThan(levelRating(6, 15));
  });
});

describe('save', () => {
  it('buys upgrades, refuses what it cannot afford, and survives junk input', () => {
    const s = new Save();
    expect(s.buyUpgrade('motor')).toBe(false);
    s.addCoins(1000);
    expect(s.affordableUpgrade()).toBe(true);
    expect(s.buyUpgrade('motor')).toBe(true);
    expect(s.data.coins).toBe(200);
    expect(s.data.tiers.motor).toBe(1);
    expect(s.buy4WD()).toBe(false);
    expect(sanitizeLevel(null)).toBeNull();
    expect(sanitizeLevel({ heights: [0] })).toBeNull();
    const lv = sanitizeLevel({ name: 'x'.repeat(80), world: 'moon', heights: [0, 1, 'a', 999], pickups: [{ kind: 'coin', x: 5 }, { x: 2 }], props: [{ kind: 'ufo', x: 1 }, { kind: 'loop', x: 9 }] })!;
    expect(lv.name.length).toBe(24);
    expect(lv.world).toBe('sylvan');
    expect(lv.heights).toEqual([0, 1, 0, 60]);
    expect(lv.pickups.length).toBe(1);
    expect(lv.props).toEqual([{ kind: 'loop', x: 9, size: 0 }]);
  });
});
