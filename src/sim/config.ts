// Central tuning. One place to feel-tune the whole game.
// Units: metres, seconds, kilograms-ish (Box2D MKS). 1 unit = 1 m = 1 HUD metre.

export const CFG = {
  // ---- Simulation clock ----------------------------------------------------
  stepHz: 120, // physics sub-step rate (two steps per 60 Hz frame)
  velIters: 8,
  posIters: 4,

  // ---- World ---------------------------------------------------------------
  gravity: 23, // m/s² — roughly 2× Hill Climb Racing in car-lengths/s²: weighty, not floaty
  fallGravityMul: 1.22, // extra pull while airborne AND descending (snappy landings)
  airDrag: 0.013, // quadratic drag coefficient (caps runaway downhill speed; low enough that every tier reaches its top speed)

  // ---- Vehicle geometry (chassis-local metres) -----------------------------
  wheelBaseHalf: 1.28,
  wheelRadius: 0.52,
  wheelRestY: -0.46, // axle height at rest, chassis-local
  bumpTravel: 0.28, // compression travel from rest
  droopTravel: 0.24, // extension travel from rest
  hullHalfLen: 1.78,
  hullBottom: -0.28,
  hullTop: 0.26,
  cageTop: 1.08,

  // ---- Masses --------------------------------------------------------------
  chassisMass: 10,
  chassisInertia: 9.5, // about the centre of mass
  comX: 0.16, // centre of mass, chassis-local (forward bias keeps climbs honest)
  comY: -0.2, // low CoM = planted
  wheelMass: 0.95,
  carrierMass: 0.3,

  // ---- Suspension (manual spring/damper on a limited prismatic) ------------
  springHz: 2.35, // chassis bounce frequency on its springs
  springProgressive: 2600, // extra N/m² stiffening under compression (soft bump-stop)
  dampBump: 0.42, // damping ratio on compression (lets the wheel absorb the hit)
  dampRebound: 1.0, // damping ratio on extension (kills the pogo — the "not floaty" knob)
  suspensionTierDamp: 0.07, // +ratio per Suspension tier
  suspensionTierHz: 0.06, // +fraction stiffness-frequency per tier
  suspensionTierTravel: 0.012, // +m bump travel per tier

  // ---- Drive ---------------------------------------------------------------
  topSpeed: 15.5, // m/s stock
  driveForce: 150, // N of tractive force at the tyre, stock (≈0.55 g launch)
  powerBaseFrac: 0.5, // constant torque below this fraction of top speed, constant power above
  motorTierForce: 0.11, // +fraction per Motor tier
  motorTierSpeed: 0.14, // +fraction per Motor tier (maxed ≈ 26.4 m/s)
  reverseForceFrac: 0.7,
  reverseSpeedFrac: 0.42,
  brakeForce: 330, // N, both axles
  coastBrakeForce: 14, // N of engine-braking/regen while off the pedals
  wheelGrip: 0.95, // tyre friction coefficient, stock
  tractionTier: 0.09, // +fraction per Traction tier (maxed 1.38)
  fourWDFrontShare: 0.14, // EXTRA tractive force through the front axle with 4WD engaged (rear keeps 1.0); worth ≈1.5 climb ratings
  wheelAngularDamping: 0.25,
  wheelieGuardStart: 0.7, // rad of nose-up (vs the slope) where rear-only drive starts to fade
  wheelieGuardEnd: 1.2, // …and is fully cut

  // ---- Attitude ------------------------------------------------------------
  airPitchAccel: 7.5, // rad/s² of pitch authority in the air, stock
  airPitchRampSeconds: 0.45, // air authority eases in over this much airtime
  airPitchMaxOmega: 6.2, // rad/s the pitch control stops pushing past
  flipTier: 0.2, // +fraction air authority per Flip Control tier
  airAngularDamping: 1.1, // hands-off spin bleed in the air (settles rotation)
  groundAngularDamping: 0.35,
  groundLeanAccel: 2.4, // rad/s² gentle lean authority with exactly one axle down
  downforce: 0.011, // N per (m/s)² per kg while grounded — glues the car over crests

  // ---- Battery -------------------------------------------------------------
  batteryCapacity: 100,
  batteryDrainPerSec: 6.4, // full throttle at top speed
  batteryDrainFloor: 0.6, // fraction still drawn at a crawl (a slow climb costs less than a flat-out sprint)
  batteryIdleDrainPerSec: 1.1,
  batteryRegenPerSec: 2.2, // coasting/braking at speed
  energyPickupCharge: 26,
  lowBatteryFraction: 0.2,

  // ---- Scoring -------------------------------------------------------------
  // Economy note: every reward below is multiplied by the combo (×1…×5), so base values are small.
  coinsPerMeter: 0.12,
  flipReward: 12,
  wheelieCreditSeconds: 1.2,
  wheelieRewardPerSec: 2,
  wheelieMinTilt: 0.2,
  bigAirSeconds: 0.9,
  bigAirReward: 15,
  loopReward: 30,
  pipeSwoopReward: 10,
  pipeSwoopSpeed: 9,
  deckRunReward: 10,
  crashThroughReward: 15,
  comboMaxLevel: 4, // ×5 at full combo
  comboPickupsPerLevel: 2, // energy cells per combo step
  comboDecaySeconds: 12,
  reviveCost: 150,

  // ---- Power-ups -----------------------------------------------------------
  turboForceMul: 1.6,
  turboSpeedMul: 1.3,
  magnetRadius: 9,
  magnetPullSpeed: 22,
  frenzySpawnInterval: 1.0,
  frenzyArcCount: 4,
  jetsAirtime: 1.05, // seconds of air one burst buys at normal gravity
  rollBarRadius: 1.75,
  superScale: 2.1,
  superMassMul: 3.0,
  superForceMul: 4.2, // tractive force multiplier (climb budget = 4.2/3.0 = 1.4× stock)
  superSpeedMul: 1.1,
  superAirMul: 0.45, // air authority (angular accel) vs stock — heavy, hard to flip
  superShrinkDeferSeconds: 4,
  flipMasterGravityMul: 0.72,
  wheelieAssistAngle: 0.92, // rad (~53°) held while Wheelie Time burns
  wheelieAssistMaxSlope: 0.3, // rad of uphill beyond which Wheelie Time stands down (climbs need the drive)
  rescueGraceSeconds: 3.5, // stunt assists keep self-righting this long after they expire

  // ---- Run rules -----------------------------------------------------------
  wrongWayMeters: 40,
  wreckDwellSeconds: 2.4, // continuously roof-down + near the ground → wrecked
  drainedDwellSeconds: 1.6, // battery empty and (nearly) stopped → out of charge
  drainedMaxSeconds: 7, // …or this long after the battery emptied, whatever the speed
  pickupRadius: 1.75,

  // ---- Terrain -------------------------------------------------------------
  chunkLen: 24,
  sampleStep: 0.5,
  buildAhead: 110,
  buildBehind: 70,
  maxFaceSlope: 1.2, // steepest uphill face a prop/seat may compose
  startPadMeters: 46, // the raw terrain eases in over this distance from the launch pad

  // ---- Endless difficulty envelope ----------------------------------------
  hookM: 250,
  rampEndM: 2500,
  ampFloor: 0.6,
  ampCeil: 1.25,
  ampCreepPerKm: 0.03, // past rampEndM the rollers keep growing a little (the climbs are the real ramp)
  ampMax: 1.4,
  seamMinM: 800,
  seamMaxM: 1000,
  seamBlendHalfM: 28,

  // ---- Climbs: the upgrade walls (see sim/climbs.ts) ----------------------
  climbMargin: 0.05, // a climb's face is this much shallower than the capacity of a car AT its rating
  climbHeightBase: 24, // m of rise at rating 0…
  climbHeightPerRating: 4, // …plus this per rating (faster cars carry more momentum)
  climbHeightMin: 12,
  climbHeightMax: 48,
  climbFillet: 6, // m of eased transition at the foot and the top of the face
  climbSummit: 12, // m of level summit
  climbDescentShare: 0.65, // fraction of the height given back on the far side (the rest is net ascent)
  climbDescentSlope: 0.45,
  climbDescentFillet: 10,
  climbDamp: 0.96, // how much of the rolling terrain is flattened on a climb (faces stay clean ramps)
  climbBlendM: 26, // distance over which the rolling terrain fades out before/after a climb
  endlessFirstClimbM: 300,
  endlessClimbGap: [130, 210] as readonly [number, number], // rolling ground between climbs
  /** Endless: [distance m, climb rating]. Stock walls out around the third climb; each tier buys ~a climb or two. */
  endlessClimbRatings: [
    [300, -1.6], [550, 0], [950, 1], [1450, 2], [2050, 3], [2750, 4], [3600, 5], [4600, 6], [5800, 6.8], [7500, 7],
  ] as readonly (readonly [number, number])[],
  summitReward: 8, // coins (× combo) for topping a climb, plus this again per rating above stock

  // ---- Economy -------------------------------------------------------------
  upgradeBaseCost: 800,
  upgradeMaxTier: 5,
  fourWDPrice: 24000,
  masteryComboMultiplier: 5,
  masteryBatteryFraction: 0.6,
} as const;

export const TAU = Math.PI * 2;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
export const wrapAngle = (a: number) => {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
};
export const approach = (cur: number, target: number, maxDelta: number) =>
  cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);
