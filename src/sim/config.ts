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
  airDrag: 0.016, // quadratic drag coefficient (caps runaway downhill speed)

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
  motorTierForce: 0.2, // +fraction per Motor tier
  motorTierSpeed: 0.18, // +fraction per Motor tier (maxed ≈ 29.5 m/s)
  reverseForceFrac: 0.7,
  reverseSpeedFrac: 0.42,
  brakeForce: 330, // N, both axles
  coastBrakeForce: 14, // N of engine-braking/regen while off the pedals
  wheelGrip: 0.95, // tyre friction coefficient, stock
  tractionTier: 0.15, // +fraction per Traction tier (maxed 1.66)
  fourWDFrontShare: 0.4, // EXTRA tractive force through the front axle with 4WD engaged (rear keeps 1.0)
  wheelAngularDamping: 0.25,

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
  batteryDrainPerSec: 6.4, // full throttle
  batteryIdleDrainPerSec: 1.1,
  batteryRegenPerSec: 2.2, // coasting/braking at speed
  energyPickupCharge: 26,
  lowBatteryFraction: 0.2,

  // ---- Scoring -------------------------------------------------------------
  coinsPerMeter: 0.12,
  flipReward: 25,
  wheelieCreditSeconds: 1.2,
  wheelieRewardPerSec: 4,
  wheelieMinTilt: 0.2,
  bigAirSeconds: 0.9,
  bigAirReward: 30,
  loopReward: 60,
  pipeSwoopReward: 20,
  pipeSwoopSpeed: 9,
  deckRunReward: 20,
  crashThroughReward: 30,
  comboMaxLevel: 9,
  comboDecaySeconds: 12,
  reviveCost: 150,

  // ---- Power-ups -----------------------------------------------------------
  turboForceMul: 1.6,
  turboSpeedMul: 1.3,
  magnetRadius: 9,
  magnetPullSpeed: 22,
  frenzySpawnInterval: 0.8,
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
  seamMinM: 800,
  seamMaxM: 1000,
  seamBlendHalfM: 28,

  // ---- Economy -------------------------------------------------------------
  upgradeBaseCost: 800,
  upgradeMaxTier: 5,
  fourWDPrice: 24000,
  masteryComboMultiplier: 8,
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
