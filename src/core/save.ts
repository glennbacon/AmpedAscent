// Persistent player data (localStorage, with an in-memory fallback when storage is unavailable).
// One JSON blob, tolerant load: unknown/missing fields fall back to defaults, never throw.

import { CFG, clamp } from '../sim/config';
import { LevelData, sanitizeLevel } from '../sim/track';
import { DEFAULT_TUNING, Loadout, Tuning, UPGRADE_IDS, UpgradeId, upgradeCost } from '../sim/upgrades';

const KEY = 'ampedascent.save.v1';
export const MAX_LEVELS = 15;

export interface Settings {
  sfx: number; // 0…1
  music: number; // 0…1
  haptics: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high';
  motorVoice: number;
}

export interface SaveData {
  coins: number;
  best: number; // endless best distance, m
  tiers: Record<UpgradeId, number>;
  has4WD: boolean;
  tuning: Tuning;
  completed: string[];
  stars: Record<string, number>;
  levels: LevelData[];
  settings: Settings;
  teach: { pedals: boolean; battery: boolean; jump: boolean; air: boolean };
  totals: { runs: number; distance: number; flips: number; coins: number };
  devUnlock: boolean;
}

const defaults = (): SaveData => ({
  coins: 0,
  best: 0,
  tiers: { motor: 0, traction: 0, suspension: 0, flip: 0 },
  has4WD: false,
  tuning: { ...DEFAULT_TUNING },
  completed: [],
  stars: {},
  levels: [],
  settings: { sfx: 0.8, music: 0.6, haptics: true, quality: 'auto', motorVoice: 0 },
  teach: { pedals: false, battery: false, jump: false, air: false },
  totals: { runs: 0, distance: 0, flips: 0, coins: 0 },
  devUnlock: false,
});

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);

function load(raw: string | null): SaveData {
  const d = defaults();
  if (!raw) return d;
  try {
    const j = JSON.parse(raw);
    d.coins = Math.floor(num(j.coins, 0, 0, 1e9));
    d.best = num(j.best, 0, 0, 1e7);
    for (const id of UPGRADE_IDS) d.tiers[id] = Math.floor(num(j.tiers?.[id], 0, 0, CFG.upgradeMaxTier));
    d.has4WD = !!j.has4WD;
    d.tuning = {
      gearing: num(j.tuning?.gearing, 0, -1, 1),
      stiffness: num(j.tuning?.stiffness, 0, -1, 1),
      balance: num(j.tuning?.balance, 0, -1, 1),
      flipSpeed: num(j.tuning?.flipSpeed, 1, 0, 1),
      fourWD: j.tuning?.fourWD !== false,
    };
    if (Array.isArray(j.completed)) d.completed = j.completed.filter((s: unknown) => typeof s === 'string');
    if (j.stars && typeof j.stars === 'object') for (const k of Object.keys(j.stars)) d.stars[k] = Math.floor(num(j.stars[k], 0, 0, 7));
    if (Array.isArray(j.levels)) d.levels = j.levels.map(sanitizeLevel).filter(Boolean).slice(0, MAX_LEVELS) as LevelData[];
    d.settings = {
      sfx: num(j.settings?.sfx, 0.8, 0, 1),
      music: num(j.settings?.music, 0.6, 0, 1),
      haptics: j.settings?.haptics !== false,
      quality: ['auto', 'low', 'medium', 'high'].includes(j.settings?.quality) ? j.settings.quality : 'auto',
      motorVoice: Math.floor(num(j.settings?.motorVoice, 0, 0, 7)),
    };
    d.teach = { pedals: !!j.teach?.pedals, battery: !!j.teach?.battery, jump: !!j.teach?.jump, air: !!j.teach?.air };
    d.totals = {
      runs: num(j.totals?.runs, 0, 0),
      distance: num(j.totals?.distance, 0, 0),
      flips: num(j.totals?.flips, 0, 0),
      coins: num(j.totals?.coins, 0, 0),
    };
    d.devUnlock = !!j.devUnlock;
  } catch {
    /* corrupt blob → defaults */
  }
  return d;
}

export class Save {
  data: SaveData;
  private mem: string | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      raw = null;
    }
    this.data = load(raw);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  commit() {
    const s = JSON.stringify(this.data);
    this.mem = s;
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* storage blocked: progress lives for this session only */
    }
    for (const fn of this.listeners) fn();
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.commit();
  }

  get loadout(): Loadout {
    const d = this.data;
    if (d.devUnlock) {
      return { tiers: { motor: 5, traction: 5, suspension: 5, flip: 5 }, has4WD: true, tuning: d.tuning };
    }
    return { tiers: { ...d.tiers }, has4WD: d.has4WD, tuning: d.tuning };
  }

  addCoins(n: number) {
    this.data.coins = Math.max(0, this.data.coins + Math.floor(n));
  }

  /** Buy the next tier of an upgrade. Returns false when unaffordable or maxed. */
  buyUpgrade(id: UpgradeId): boolean {
    const t = this.data.tiers[id];
    if (t >= CFG.upgradeMaxTier) return false;
    const cost = upgradeCost(t);
    if (this.data.coins < cost) return false;
    this.data.coins -= cost;
    this.data.tiers[id] = t + 1;
    this.commit();
    return true;
  }
  buy4WD(): boolean {
    if (this.data.has4WD || this.data.coins < CFG.fourWDPrice) return false;
    this.data.coins -= CFG.fourWDPrice;
    this.data.has4WD = true;
    this.data.tuning.fourWD = true;
    this.commit();
    return true;
  }
  /** Cheapest thing the player can buy right now (drives the "upgrade available" nudge). */
  affordableUpgrade(): boolean {
    const d = this.data;
    if (!d.has4WD && d.coins >= CFG.fourWDPrice) return true;
    return UPGRADE_IDS.some((id) => d.tiers[id] < CFG.upgradeMaxTier && d.coins >= upgradeCost(d.tiers[id]));
  }

  // ---- player levels ----
  saveLevel(level: LevelData, index: number | null): number {
    const lv = sanitizeLevel(JSON.parse(JSON.stringify(level)));
    if (!lv) return -1;
    if (index != null && index >= 0 && index < this.data.levels.length) this.data.levels[index] = lv;
    else if (this.data.levels.length < MAX_LEVELS) {
      this.data.levels.push(lv);
      index = this.data.levels.length - 1;
    } else return -1;
    this.commit();
    return index!;
  }
  deleteLevel(index: number) {
    this.data.levels.splice(index, 1);
    this.commit();
  }
}
