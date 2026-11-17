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
- **Open source, MIT** (`LICENSE`). Nothing in the repo is under another licence: no asset files.
- **Hosted in the arcade**: <https://glennbacon.github.io/arcade/amped-ascent/>. The `glennbacon/arcade`
  repo holds a built copy; its `./build.sh amped-ascent` runs `npm run build` here and copies `dist/`.
  `base: './'` in `vite.config.ts` is what lets the build run from that subfolder — keep it relative.
- `screenshot.png` (README): four 800 × 480 captures tiled 2 × 2 — title, `world=caverns`, `prop=loop`,
  `screen=garage`.

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
- **Player levels never bank coins** (`Game.bank`) — a level full of coins would be a mint.
- **Economy is tuned around a ×5 combo cap** (`comboMaxLevel` 4, one step per `comboPickupsPerLevel`
  energy cells) and small base rewards, because every coin and stunt is multiplied by the combo.
  At ×10 with the old game's reward values a single stock run paid for seven upgrades. Auto-driver
  reference: ≈1.5k coins per stock endless run, ≈6k maxed (upgrade line 800 → 12,800 per tier, 4WD 24,000).
- `sim/` stays import-clean (see Architecture). `Save` and `Input` tolerate missing `localStorage` /
  gamepads.

## QA

- `npm test` — rules + physics, including: loop completable stock and maxed on flat and hilly
  approaches, bridge crossing, no-tunnel landing, drop-settle bar, climb bars, rescue/wreck/revive,
  Super Sized grow → smash → shrink, all 90 campaign levels inside their slope bars, endless
  determinism and seam continuity.
- `npm run tune [flat|drop|climb|jump|endless]` — prints 0–10 m/s, top speed, drop rebound/settle,
  climb height by slope, jump airtime, and endless distance batches for stock/maxed × beginner/pro.
  `npx vite-node tools/camp.ts [levels]` drives campaign levels with three loadouts;
  `npx vite-node tools/props.ts [kind|all]` runs prop trials; `npx vite-node tools/soak.ts [seeds]`
  soaks long endless runs for NaNs, cars under the ground and runs that never end.
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
- Not ported: epic-run screenshots/share, the DEV TUNE panel (use `CFG` + `npm run tune`), and the
  one-time refund migrations (no old saves on this platform).

## Open playtest gates (only a human can close these)

1. **Feel.** Does the car read as weighty and planted without feeling dead? Knobs: `gravity`,
   `fallGravityMul`, `dampRebound`, `springHz`, `downforce`, `driveForce`, `topSpeed`.
2. **Throttle skill vs forgiveness.** Wheelie guard window and `airPitchAccel` / `airPitchRampSeconds`.
   A maxed car still backflips if the gas is held through a jump — intended?
3. **Pacing.** Stock auto-driver median is ≈1.4 km in endless before the battery runs dry
   (`endlessEnergyGap`, `batteryDrainPerSec`). First upgrade ≈ one run. Too generous?
4. **Adventure difficulty.** The pro auto-driver clears most levels stock; late worlds lean on
   sustained climbs (`climbShare`) and scarcer energy. Human pass wanted on a mid and a late level.
5. **Audio.** Motor voices, SFX loudness and the music mix need ears on real speakers/phones.
6. **Device performance.** Quality tiers (`render/gfx.ts`) are picked by `autoQuality()`; verify on a
   mid-range phone.
7. **Touch controls.** Left/right half-screen pedals and the JUMP button position.

## Workflow

Feature work on a branch; commit messages end with a `Co-Authored-By: Claude` trailer. Glenn gates merges.
