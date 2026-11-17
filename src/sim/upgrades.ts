// Upgrades + tuning → the numbers the rig is built from. Pure; shared by the sim, Garage UI and tests.

import { CFG, clamp, lerp } from './config';

export type UpgradeId = 'motor' | 'traction' | 'suspension' | 'flip';
export const UPGRADE_IDS: UpgradeId[] = ['motor', 'traction', 'suspension', 'flip'];

export const UPGRADE_INFO: Record<UpgradeId, { name: string; blurb: string }> = {
  motor: { name: 'Motor', blurb: 'More torque and a higher top speed.' },
  traction: { name: 'Traction', blurb: 'Grippier tyres: harder launches, steeper climbs.' },
  suspension: { name: 'Suspension', blurb: 'Longer travel, firmer damping. Landings stay composed.' },
  flip: { name: 'Flip Control', blurb: 'Raises how fast you can pitch the car in the air.' },
};

/** Tuning sliders are trade-offs, never free power. Each is centred on 0 (flipSpeed defaults to 1). */
export interface Tuning {
  gearing: number; // −1 torque … +1 top speed
  stiffness: number; // −1 soft … +1 firm
  balance: number; // −1 rear-heavy (wheelies) … +1 front-heavy (planted climbs)
  flipSpeed: number; // 0 slow … 1 fast, within the purchased Flip Control ceiling
  fourWD: boolean; // engaged (only matters once owned)
}
export const DEFAULT_TUNING: Tuning = { gearing: 0, stiffness: 0, balance: 0, flipSpeed: 1, fourWD: true };

export const TUNING_PRESETS: { id: string; name: string; blurb: string; tuning: Omit<Tuning, 'fourWD'> }[] = [
  { id: 'balanced', name: 'Balanced', blurb: 'Factory setup.', tuning: { gearing: 0, stiffness: 0, balance: 0, flipSpeed: 1 } },
  { id: 'climber', name: 'Climber', blurb: 'Short gears, nose-heavy.', tuning: { gearing: -0.8, stiffness: 0.2, balance: 0.8, flipSpeed: 0.7 } },
  { id: 'sprinter', name: 'Sprinter', blurb: 'Tall gears, firm and low.', tuning: { gearing: 0.9, stiffness: 0.7, balance: 0.2, flipSpeed: 0.8 } },
  { id: 'stunt', name: 'Stunt', blurb: 'Tail-heavy, soft, max flip.', tuning: { gearing: -0.2, stiffness: -0.6, balance: -0.8, flipSpeed: 1 } },
];

export interface Loadout {
  tiers: Record<UpgradeId, number>;
  has4WD: boolean;
  tuning: Tuning;
}
export const STOCK_LOADOUT: Loadout = {
  tiers: { motor: 0, traction: 0, suspension: 0, flip: 0 },
  has4WD: false,
  tuning: { ...DEFAULT_TUNING },
};
export const MAXED_LOADOUT: Loadout = {
  tiers: { motor: 5, traction: 5, suspension: 5, flip: 5 },
  has4WD: true,
  tuning: { ...DEFAULT_TUNING },
};

export const upgradeCost = (tier: number) => CFG.upgradeBaseCost << tier; // 800 · 2^tier
export const isDetuned = (t: Tuning) => t.gearing !== 0 || t.stiffness !== 0 || t.balance !== 0;

export interface VehicleStats {
  driveForce: number; // N at the tyres
  topSpeed: number; // m/s
  grip: number; // friction coefficient
  springHz: number;
  dampBump: number;
  dampRebound: number;
  bumpTravel: number;
  airAccel: number; // rad/s²
  airMaxOmega: number;
  comX: number;
  fourWD: boolean;
  suspensionTier: number;
}

export function deriveStats(l: Loadout): VehicleStats {
  const t = l.tiers;
  const tu = l.tuning;
  const g = clamp(tu.gearing, -1, 1);
  const flipCeil = 1 + CFG.flipTier * t.flip;
  const flipMul = lerp(Math.min(0.6, flipCeil), flipCeil, clamp(tu.flipSpeed, 0, 1));
  return {
    driveForce: CFG.driveForce * (1 + CFG.motorTierForce * t.motor) * (1 - 0.14 * g),
    topSpeed: CFG.topSpeed * (1 + CFG.motorTierSpeed * t.motor) * (1 + 0.14 * g),
    grip: CFG.wheelGrip * (1 + CFG.tractionTier * t.traction),
    springHz: CFG.springHz * (1 + CFG.suspensionTierHz * t.suspension) * (1 + 0.18 * clamp(tu.stiffness, -1, 1)),
    dampBump: CFG.dampBump + CFG.suspensionTierDamp * 0.5 * t.suspension,
    dampRebound: CFG.dampRebound + CFG.suspensionTierDamp * t.suspension,
    bumpTravel: CFG.bumpTravel + CFG.suspensionTierTravel * t.suspension,
    airAccel: CFG.airPitchAccel * flipMul,
    airMaxOmega: CFG.airPitchMaxOmega * (0.75 + 0.25 * flipMul),
    comX: CFG.comX + 0.16 * clamp(tu.balance, -1, 1),
    fourWD: l.has4WD && tu.fourWD,
    suspensionTier: t.suspension,
  };
}

/** 0…1 bars for the Garage stat readout (stock → maxed). */
export function statBars(l: Loadout) {
  const s = deriveStats(l);
  const max = deriveStats(MAXED_LOADOUT);
  const min = deriveStats(STOCK_LOADOUT);
  const f = (v: number, a: number, b: number) => clamp((v - a) / (b - a), 0, 1);
  return {
    power: f(s.driveForce, min.driveForce * 0.86, max.driveForce * 1.14),
    speed: f(s.topSpeed, min.topSpeed * 0.86, max.topSpeed * 1.14),
    grip: f(s.grip * (s.fourWD ? 1.35 : 1), min.grip, max.grip * 1.35),
    composure: f(s.dampRebound, min.dampRebound, max.dampRebound),
    agility: f(s.airAccel, CFG.airPitchAccel * 0.6, max.airAccel),
  };
}
