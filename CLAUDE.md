# Amped Ascent — Claude Code project guide

Web remake of the SpriteKit game (the old iOS project lives in the `AmpedAscent2` repo; its `CLAUDE.md`
is the design history). Same game — EV hill-climb, endless + 90-level adventure, upgrades, stunts,
power-ups, props, level editor — rebuilt on **three.js** (rendering) and **planck.js / Box2D** (physics).
All art and audio are generated from code: there are no image, model or sound files.

**History policy (inherited):** this file carries CURRENT truth only. When a value changes, replace it
here. Never append supersession paragraphs.

## Build / run

```sh
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm test             # vitest: sim rules + headless physics (≈5 s)
npm run typecheck    # tsc --noEmit (Vite does not type-check)
npm run build        # typecheck + static site in dist/ (host anywhere)
npm run build:single # dist-single/index.html — one self-contained file
npm run tune         # headless feel lab (see below)
```

- **Every change must pass `npm run typecheck` and `npm test`.**
- Stack: TypeScript, Vite 5, three 0.170, planck 1.4.2. No UI framework — menus are plain DOM + one CSS file.

## Architecture (`src/`)

The hard line: **`sim/` never imports three, the DOM, or anything outside `sim/`.** It runs headless
in Node, which is what makes the physics testable and tunable without a browser.

- `sim/config.ts` — `CFG`: every tuning constant (gravity, rig, suspension, drive, battery, scoring,
  endless curves, economy). **One place to feel-tune the game.**
- `sim/worlds.ts` — the six biomes as data: terrain octaves (ported from the old game, px ÷ 30 → m),
  gravity multiplier, and the whole look (sky, fog, lights, ground palette, decor kit, ambient weather).
- `sim/track.ts` — `Track` = base terrain + props + pickups as pure functions of x.
  `EndlessTrack` (seeded biome cycle, difficulty envelope, 30 m prop slots, pickup recurrences),
  `LevelTrack` (`LevelData` heights via Catmull-Rom), `FnTrack` (tests/staging). Prop geometry
  (`PROP`, `placeProp`, `isFairPlacement`, `propRewardCoins`) lives here.
- `sim/campaign.ts` — unlock math, mastery stars, and the runtime level generator (no bundled levels).
- `sim/physics.ts` — planck world: terrain chain chunks, loop + bridge bodies, smash debris.
- `sim/vehicle.ts` — the rig (see "Physics" below).
- `sim/run.ts` — `RunSim`: one drive. Battery, pickups, power-ups, stunts, loops, end conditions.
  Emits `SimEvent`s; the renderer, HUD and audio only read it.
- `sim/powerups.ts`, `sim/upgrades.ts`, `sim/rng.ts`, `sim/autodriver.ts` (QA drivers).
- `render/` — `gfx.ts` (renderer, bloom, quality tiers), `world.ts` (scene + camera rig),
  `terrain.ts` (chunk meshes on the SAME sample points as the physics chain), `decor.ts` (procedural
  biome props, merged per chunk), `sky.ts`, `ambient.ts`, `vehicleModel.ts` (the buggy), `pickups.ts`,
  `props.ts`, `particles.ts`.
- `audio/` — `audio.ts` (Web Audio engine, 8 motor voices, SFX), `music.ts` (live-sequenced synthwave).
- `ui/` — `menus.ts` (title, Adventure, Garage, Settings, My Levels, pause, end cards), `hud.ts`,
  `editor.ts`, `icons.ts` (one drawn icon set, also rasterised onto the 3D power-up tokens),
  `styles.css`.
- `core/` — `save.ts` (localStorage, tolerant load), `input.ts` (keyboard, touch, gamepad).
- `game.ts` — phases (`title/ready/playing/paused/ended/completed/garage/editor`), run lifecycle,
  banking, the fixed-step loop (120 Hz physics, interpolated rendering), QA URL flags.

## Difficulty: climbs are the upgrade walls (`sim/climbs.ts`)

The game is hard because of **climbs**: one big hill with a long, clean, steep face (the test), a
short summit, and a gentler descent that gives back 65 % of the height (so the track nets upward —
it is an *ascent*). Rollers are damped out on a climb; props never sit on one; each has energy cells
at the foot, twice on the face and on the summit, and coins up the face.

- **Everything derives from one number, the climb's RATING** = the equal Motor+Traction tier a
  rear-drive car needs to hold the face. Internally stock = 0; the UI shows rating + 1 (stock reads
  1.0). `climbSlope(r)` comes from the `CAPACITY` table, `climbHeight(r)` = 24 m + 4 m per rating
  (taller walls for faster cars, because height is what stops momentum doing the motor's job).
- **`CAPACITY` is MEASURED, not derived.** `npx vite-node tools/capacity.ts` drives each equal-tier car
  up test ramps and prints a paste-ready table (plus a check that the tier below does NOT top each
  wall). **Re-run it after touching drive force, grip, mass, gravity, drag, the wheelie guard or the
  auto-driver, and paste the result** — the gating tests fail if the table drifts.
- **Car rating** (`carRating`): `min(motor, traction) + 0.3·|difference|`, gearing shifts the motor
  share, 4WD adds ≈ 1.3 + 0.12·motor. Power without grip (or the reverse) is mostly wasted — the
  Garage says so on each upgrade row ("climb 1.0 → 1.3" / "held back by the other upgrade").
- **Endless** (`CFG.endlessClimbRatings`): first climb at ~300 m (warm-up), then one every
  130–210 m of rolling ground, rating rising with distance (0 at 550 m, 1 at 950, 2 at 1450, 3 at
  2050, 4 at 2750, 5 at 3600, 6 at 4600, 7 at 7500). Auto-driver medians (`tools/walls.ts`): stock
  ≈ 0.9 km, tier 1 ≈ 1.6, tier 2 ≈ 2.0, tier 3 ≈ 2.5, tier 4 ≈ 3.2, tier 5 ≈ 3.9, tier 5 + 4WD ≈ 6.7.
- **Adventure** (`levelRating`): levels 1–3 of every world sit below stock; from level 4 the rating
  rises to the world's ceiling at level 15 — 3.0, 3.5, 4.0, 4.5, 5.0, **6.0** (the last world needs
  4WD on top of maxed tiers). A level has `round(length/420)` climbs, easiest first, the last at the
  level's rating. `npx vite-node tools/camp.ts` drives levels with cars rated below/at/above.
- **Feedback loop:** approaching a climb pops `CLIMB n.n` (amber when above the car); stalling on a
  face with the pedal down raises a hint naming both ratings; topping one pays `SUMMIT!`; the end
  card reads "TOO STEEP! Stopped by a climb rated X — your car is rated Y" and points at Motor and
  Traction. The Adventure grid shows each level's rating, amber/red when the car is short.
- Things that must NOT sabotage a climb (each did): Wheelie Time stands down above
  `wheelieAssistMaxSlope`; the auto-driver does not fire Jump Jets on steep ground; half-pipes are
  shallow enough (`halfpipeDepthRatio` 0.15, fairness bar 0.58 uphill) that a stock car drives out
  from a dead stop — **a dug bowl must never be a trap**; descents stay roller-free so a fast car
  is not pitched onto its nose.
- Battery draw scales with motor speed (`batteryDrainFloor` 0.6 at a crawl) so a slow, honest climb
  does not cost a whole pack.

## Physics (what "less floaty than Hill Climb Racing" is made of)

Units are metres/seconds. Each knob below is a `CFG` field; the numbers are gated in `tests/physics.test.ts`.

- **Gravity 23 m/s²** plus `fallGravityMul` 1.22 while airborne and descending — arcs come down faster
  than they go up.
- **Suspension is hand-rolled**, not Box2D's WheelJoint: each wheel rides a `PrismaticJoint` (hard
  bump/droop stops) through a small carrier body and spins on a `RevoluteJoint` motor; the spring
  force is applied explicitly so **compression and rebound damp separately** (`dampBump` 0.42,
  `dampRebound` 1.0 as ratios of chassis-critical). Rebound-heavy damping is the anti-pogo knob:
  a 3 m drop settles in < 0.6 s with zero second bounce (test-gated).
- **Low, slightly forward centre of mass** (`comX`, `comY`) — planted on flat ground even maxed.
- **Speed-proportional downforce** while grounded (`downforce`) — fast cars stay glued over crests.
- **EV drive curve:** flat torque to `powerBaseFrac` of top speed, constant power above. A wheel
  already past its target speed freewheels (never engine-brakes), so there is no torque cut-out
  when a wheel overspins — the old game's slip-unaware cap bug cannot exist here.
- **Air control** eases in over `airPitchRampSeconds` of airtime: a held pedal over a small crest
  barely tips the car; a real jump still flips it.
- **Wheelie guard:** with only the rear axle down, drive fades between `wheelieGuardStart` and
  `wheelieGuardEnd` rad of nose-up. Momentum and air rotation can still roll the car over.
- Box2D's continuous collision keeps wheels and chassis out of the ground at any landing speed
  (test-gated) — no burial guards needed.

## Invariants (each one has bitten already)

- **`Body.destroyFixture()` recomputes mass from fixture densities.** The chassis fixtures are
  density-0 with authored `setMassData`, so removing the Roll Bar fixtures used to leave a 1 kg
  chassis with **zero rotational inertia** (rotation locked). `Vehicle.setRollBar(false)` re-asserts
  `massData`; any future fixture removal on the chassis must do the same (regression test exists).
- **Battery depletion is a latch** (`RunSim.depleted`): at 0 % the car cannot drive *or* regen until
  an energy cell is collected. Without the latch, regen trickle revived the pack every few frames and
  a flat run never ended.
- **One jet burst per ground contact** (`jetLock`): wheels stay "grounded" for a few steps after the
  kick; without the lock a double press stacked impulses.
- **Never clamp terrain heights to fix a slope** — a clamp leaves kinks that launch the car. The
  campaign generator rescales its crest layer and re-samples instead.
- **Terrain mesh and physics chain share `PhysWorld.chunkXs`** (including the extra vertices at ramp
  lips). Change one, change both, or art ≠ physics.
- **Loops are two chains with a Sonic-style layer switch** (`RunSim.updateLoops`): entry half
  collides until the car passes the top, then the exit half does. The switch keys on the car's
  unwrapped angle around the loop centre and only accumulates near the rim. Assist (radial press +
  power floor) acts only while the pedal is held.
- **Endless generation is order-independent:** heights are pure in x; pickups use per-stream counters
  (`energyCount`, `coinCount`), never `pickups.length`. Props realise in slot order (adjacency-aware)
  and are cached. Tests sample backwards and in windows to prove it.
- **Upgrade steps are deliberately modest** (`motorTierForce` 0.11, `tractionTier` 0.09,
  `fourWDFrontShare` 0.14): a maxed rear-drive car tops slopes around 1.26, a maxed 4WD car about
  1.7. Bigger steps made a maxed car climb near-vertical walls and left no room for a ladder.
- **Every tier must reach its rated top speed**: `airDrag` 0.013 with `motorTierSpeed` 0.14 keeps
  drag below drive at top speed for all tiers (test-gated). Raising either breaks that.
- **Player levels never bank coins** (`Game.bank`) — a level full of coins would be a mint.
- **Economy is tuned around a ×5 combo cap** (`comboMaxLevel` 4, one step per `comboPickupsPerLevel`
  energy cells) and small base rewards, because every coin and stunt is multiplied by the combo.
  At ×10 with the old game's reward values a single stock run paid for seven upgrades. Auto-driver
  reference (`tools/walls.ts`): ≈1.2k coins per stock endless run, ≈3k at tier 2, ≈5k at tier 4,
  ≈12k maxed with 4WD (upgrade line 800 → 12,800 per tier, 4WD 24,000).
- `sim/` stays import-clean (see Architecture). `Save` and `Input` tolerate missing `localStorage` /
  gamepads.

## QA

- `npm test` — rules + physics, including: **the upgrade walls** (stock tops the warm-up climbs then
  stalls; each tier buys ≥ 500 m of Endless; an under-rated car is stopped in Adventure and a car at
  the rating finishes; stall hint + summit pay; half-pipe escape from a dead stop), loop completable
  stock and maxed, bridge crossing, no-tunnel landing, drop-settle bar, rescue/wreck/revive,
  Super Sized grow → smash → shrink, all 90 campaign levels inside their slope limits, endless
  determinism and seam continuity.
- `npm run tune [flat|drop|climb|jump|endless]` — prints 0–10 m/s, top speed, drop rebound/settle,
  climb height by slope, jump airtime, and endless distance batches for stock/maxed × beginner/pro.
  `npx vite-node tools/capacity.ts` (the climb table), `tools/walls.ts [seeds]` (how far each tier
  gets in Endless and which climb stops it), `tools/camp.ts [levels] [worlds]` (Adventure gating),
  `tools/props.ts [kind|all]` (prop trials), `tools/soak.ts [seeds]` (long runs: NaNs, cars under
  the ground, runs that never end).
- Browser checks (need the dev server and Playwright): `node tools/shot.mjs out.png "<query>"`,
  `tools/shotm.mjs` (phone/touch), `tools/biomes.sh <dir>`, `node tools/e2e.mjs <dir>` (title →
  endless → pause → game over → garage purchase → adventure → editor → test drive; prints state per
  step and the console-error count).
- **URL flags** (dev tooling, harmless in production): `autodrive`, `driver=beginner|pro`,
  `world=<id>`, `seed=<n>`, `level=w3-l5`, `powerup=<raw>`, `prop=<kind>&propx=<m>&size=<n>`, `flat`,
  `seam=<m>`, `warp=<s>` (fast-forward), `charge` (keep the battery full during warp),
  `screen=garage|adventure|settings|levels|pause|editor|gameover|complete`, `tab=`, `coins=<n>`,
  `devunlock`, `reset`, `q=low|medium|high`, `mute`, `freeze=<ms>`.
- Blind `driver=beginner` holds the gas and will flip a maxed car in the air by design — its distance
  is a lower bound, not a difficulty signal. Judge difficulty with `driver=pro` batches.

## What changed from the SpriteKit game (deliberate)

- **Ads and in-app purchases are gone** (no AdMob/StoreKit on the web). Revive costs
  `CFG.reviveCost` coins, once per run; Double Coins and ad-unlocks are removed. Every world's level 1
  is open from a fresh save; later levels unlock in order.
- **Tuning is trade-offs, not detune:** gearing (torque ↔ top speed), suspension (soft ↔ firm),
  weight balance (rear ↔ front), flip speed, 4WD toggle, plus four named presets.
- **The bridge is a real plank bridge** (dynamic bodies on revolute joints) over a ravine.
- **The loop is a corkscrew** in 3D and completable by a stock car.
- Mastery stars: finish · reach the full **×5** combo · finish with ≥ 60 % charge.
- **Difficulty is built from rated climbs** rather than ever-rougher rollers (see the section above);
  the old steep-crest and sustained-climb layers of the campaign generator are reduced to texture.
- Not ported: epic-run screenshots/share, the DEV TUNE panel (use `CFG` + `npm run tune`), and the
  one-time refund migrations (no old saves on this platform).

## Open playtest gates (only a human can close these)

1. **Feel.** Does the car read as weighty and planted without feeling dead? Knobs: `gravity`,
   `fallGravityMul`, `dampRebound`, `springHz`, `downforce`, `driveForce`, `topSpeed`.
2. **Throttle skill vs forgiveness.** Wheelie guard window and `airPitchAccel` / `airPitchRampSeconds`.
   A maxed car still backflips if the gas is held through a jump — intended?
3. **Where the walls sit.** A stock car stalls around the third or fourth Endless climb (~0.9 km,
   about a minute in) and each tier buys roughly one or two more climbs. Is the first wall early
   enough, and does one upgrade feel like enough progress? Knob: `CFG.endlessClimbRatings`.
4. **Adventure pressure.** Level 4 of each world is the first that asks for an upgrade; a world's
   level 15 needs ratings 4.0–7.0 (shown). Too steep a ramp, or too slow? Knobs: `WORLD_RATING_CEIL`
   and the 0.9 exponent in `levelRating`. A human is weaker than the auto-driver the table was
   measured with — if rated cars feel short, raise `climbMargin`.
5. **Audio.** Motor voices, SFX loudness and the music mix need ears on real speakers/phones.
6. **Device performance.** Quality tiers (`render/gfx.ts`) are picked by `autoQuality()`; verify on a
   mid-range phone.
7. **Touch controls.** Left/right half-screen pedals and the JUMP button position.

## Workflow

Feature work on a branch; commit messages end with a `Co-Authored-By: Claude` trailer. Glenn gates merges.
