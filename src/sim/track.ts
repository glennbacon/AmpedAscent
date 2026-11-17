// Track = the drivable world as pure functions of x: base terrain + props + pickups.
// Two flavours share one composition path: EndlessTrack (seeded biome cycle) and LevelTrack
// (authored / campaign-generated LevelData). Nothing here touches physics or rendering.

import { CFG, clamp, lerp, smoothstep, TAU } from './config';
import { hash01, hash32 } from './rng';
import { WORLDS, WORLD_ORDER, WorldDef, WorldId, worldField, worldSpice } from './worlds';
import type { PowerupKind } from './powerups';
import { RARE_KINDS, STANDARD_KINDS } from './powerups';

export type PropKind = 'ramp' | 'whoops' | 'halfpipe' | 'bridge' | 'loop';
export const PROP_KINDS: PropKind[] = ['ramp', 'whoops', 'halfpipe', 'bridge', 'loop'];
export type PickupKind = 'coin' | 'energy' | PowerupKind;

export interface PropDef {
  kind: PropKind;
  x: number; // footprint start (pad start for seated kinds)
  size: number; // ramp: 0/1/2 = S/M/L · halfpipe: 0/1 = standard/big · others: 0
}

export interface PickupDef {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

/** Prop geometry constants (metres). */
export const PROP = {
  blend: 5.5, // smoothstep ramp between raw terrain and a flattened seat
  rampSpan: [4.0, 5.7, 8.0],
  rampHeight: [1.25, 2.0, 3.0],
  rampPadApproach: 2.7,
  rampPadLanding: 2.0,
  rampTrapLookahead: 45,
  rampTrapMaxRise: 4.6,
  whoopsSpan: 12,
  whoopsAmp: 0.34,
  whoopsCount: 5,
  halfpipeSpan: [20.6, 26],
  halfpipeDepthRatio: 0.27,
  bridgePad: 3,
  bridgeLength: 15,
  bridgeValleyDepth: 3.4,
  bridgePlanks: 12,
  loopRadius: 6.5,
  loopApproach: 15, // pad start → loop bottom centre (flat run-up)
  loopExit: 12, // loop bottom centre → pad end
  slotStride: 30,
  endlessOdds: 0.5,
  bodyFadeEndM: 1400,
} as const;

export interface PlacedProp extends PropDef {
  index: number;
  span: number; // footprint length from x
  seated: boolean;
  seatY: number; // flattened pad height (seated kinds)
  x0: number; // influence window start (incl. blend)
  x1: number; // influence window end
}

export function propSpan(kind: PropKind, size: number): number {
  switch (kind) {
    case 'ramp':
      return PROP.rampPadApproach + PROP.rampSpan[size] + PROP.rampPadLanding;
    case 'whoops':
      return PROP.whoopsSpan;
    case 'halfpipe':
      return PROP.halfpipeSpan[size];
    case 'bridge':
      return PROP.bridgePad * 2 + PROP.bridgeLength;
    case 'loop':
      return PROP.loopApproach + PROP.loopExit;
  }
}
export const isSeated = (k: PropKind) => k === 'ramp' || k === 'bridge' || k === 'loop';
export const isBody = (k: PropKind) => k === 'bridge' || k === 'loop';

export function rampGeom(p: PlacedProp) {
  const kickStart = p.x + PROP.rampPadApproach;
  const span = PROP.rampSpan[p.size];
  return { kickStart, span, lipX: kickStart + span, h: PROP.rampHeight[p.size] };
}
export function loopGeom(p: PlacedProp) {
  const cx = p.x + PROP.loopApproach;
  return { cx, cy: p.seatY + PROP.loopRadius, r: PROP.loopRadius, groundY: p.seatY };
}
export function bridgeGeom(p: PlacedProp) {
  const a = p.x + PROP.bridgePad;
  return { a, b: a + PROP.bridgeLength, deckY: p.seatY, depth: PROP.bridgeValleyDepth };
}

/** Height contribution of one prop at x, given the base terrain height there. */
function applyProp(p: PlacedProp, x: number, h: number): number {
  if (x <= p.x0 || x >= p.x1) return h;
  if (p.seated) {
    const end = p.x + p.span;
    let w = 1;
    if (x < p.x) w = smoothstep((x - p.x0) / PROP.blend);
    else if (x > end) w = 1 - smoothstep((x - end) / PROP.blend);
    h = lerp(h, p.seatY, w);
    if (p.kind === 'ramp') {
      const g = rampGeom(p);
      if (x > g.kickStart && x <= g.lipX) {
        const t = (x - g.kickStart) / g.span;
        h += g.h * t * t;
      }
    } else if (p.kind === 'bridge') {
      const g = bridgeGeom(p);
      if (x > g.a && x < g.b) {
        const s = Math.sin(((x - g.a) / (g.b - g.a)) * Math.PI);
        h -= g.depth * s * s;
      }
    }
    return h;
  }
  const t = (x - p.x) / p.span;
  if (t <= 0 || t >= 1) return h;
  if (p.kind === 'whoops') {
    return h + (PROP.whoopsAmp * (1 - Math.cos(TAU * PROP.whoopsCount * t))) / 2;
  }
  // halfpipe
  const s = Math.sin(t * Math.PI);
  return h - p.span * PROP.halfpipeDepthRatio * s * s;
}

export function placeProp(def: PropDef, index: number, base: (x: number) => number): PlacedProp {
  const span = propSpan(def.kind, def.size);
  const seated = isSeated(def.kind);
  let seatY = 0;
  if (seated) {
    // Seat on the mean of the footprint so the blend is balanced on hillsides.
    seatY = (base(def.x) + base(def.x + span * 0.5) + base(def.x + span)) / 3;
  }
  return {
    ...def,
    index,
    span,
    seated,
    seatY,
    x0: seated ? def.x - PROP.blend : def.x,
    x1: seated ? def.x + span + PROP.blend : def.x + span,
  };
}

/** Placement fairness: no unclimbable uphill wall composed by the prop, no ramp valley-trap. */
export function isFairPlacement(p: PlacedProp, base: (x: number) => number, maxSlope: number = CFG.maxFaceSlope): boolean {
  const step = 0.5;
  let prev = applyProp(p, p.x0, base(p.x0));
  const lip = p.kind === 'ramp' ? rampGeom(p).lipX : NaN;
  for (let x = p.x0 + step; x <= p.x1 + 1e-6; x += step) {
    const h = applyProp(p, x, base(x));
    const s = (h - prev) / step;
    const acrossLip = p.kind === 'ramp' && x - step <= lip && x > lip;
    if (!acrossLip) {
      if (s > (p.kind === 'whoops' ? Math.min(maxSlope, 0.92) : maxSlope)) return false;
      if (p.kind === 'halfpipe' && s < -maxSlope) return false;
    }
    prev = h;
  }
  if (p.kind === 'ramp') {
    const g = rampGeom(p);
    const lipTop = p.seatY + g.h;
    for (let d = 2; d <= PROP.rampTrapLookahead; d += 1.5) {
      if (base(g.lipX + d) - lipTop > PROP.rampTrapMaxRise) return false;
    }
  }
  return true;
}

export interface BiomeBlend {
  a: WorldDef;
  b: WorldDef;
  t: number; // 0 = all a, 1 = all b
}

export abstract class Track {
  abstract readonly mode: 'endless' | 'level';
  /** Finish-line x for levels, null for endless. */
  abstract readonly length: number | null;
  abstract base(x: number): number;
  abstract biomeAt(x: number): BiomeBlend;
  /** Props whose influence window may touch [x0, x1]. */
  abstract propsIn(x0: number, x1: number): PlacedProp[];
  /** All pickups with x in [x0, x1) — deterministic, stable ids. */
  abstract pickupsIn(x0: number, x1: number): PickupDef[];

  /** Composed ridge: base terrain + every prop. THE height the physics chain and mesh follow. */
  height(x: number): number {
    let h = this.base(x);
    const props = this.propsIn(x, x);
    for (let i = 0; i < props.length; i++) h = applyProp(props[i], x, h);
    return h;
  }
  slope(x: number): number {
    return (this.height(x + 0.25) - this.height(x - 0.25)) / 0.5;
  }
  /** Highest drivable surface at x: the ridge, or a bridge deck spanning it. */
  surface(x: number): number {
    const h = this.height(x);
    const props = this.propsIn(x, x);
    for (const p of props) {
      if (p.kind === 'bridge') {
        const g = bridgeGeom(p);
        if (x >= g.a && x <= g.b) return Math.max(h, g.deckY);
      }
    }
    return h;
  }
  /** Extra chain/mesh vertices needed to keep sharp features sharp (ramp lips). */
  breaksIn(x0: number, x1: number): number[] {
    const out: number[] = [];
    for (const p of this.propsIn(x0, x1)) {
      if (p.kind === 'ramp') {
        const lip = rampGeom(p).lipX;
        if (lip > x0 && lip < x1) out.push(lip, lip + 0.06);
      }
    }
    return out;
  }
  gravityMulAt(x: number): number {
    const b = this.biomeAt(x);
    return lerp(b.a.gravityMul, b.b.gravityMul, b.t);
  }
}

// ---------------------------------------------------------------------------------------------
// Reward lines: coins that make a prop worth driving. Shared by endless + campaign generation.
// ---------------------------------------------------------------------------------------------
export function propRewardCoins(p: PlacedProp, heightAt: (x: number) => number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  switch (p.kind) {
    case 'ramp': {
      const g = rampGeom(p);
      const slope = (2 * g.h) / g.span;
      const v = 15;
      const ang = Math.atan(slope);
      const vx = v * Math.cos(ang);
      const vy = v * Math.sin(ang);
      const y0 = p.seatY + g.h + 1.2;
      for (let i = 1; i <= 6; i++) {
        const t = i * 0.13;
        const x = g.lipX + vx * t;
        const y = y0 + vy * t - 0.5 * CFG.gravity * t * t;
        out.push({ x, y: Math.max(y, heightAt(x) + 1.3) });
      }
      break;
    }
    case 'whoops':
      for (let i = 0; i < PROP.whoopsCount; i++) {
        const x = p.x + ((i + 0.5) / PROP.whoopsCount) * p.span;
        out.push({ x, y: heightAt(x) + 1.7 });
      }
      break;
    case 'halfpipe':
      for (let i = 0; i < 9; i++) {
        const x = p.x + ((i + 1) / 10) * p.span;
        out.push({ x, y: heightAt(x) + 1.6 });
      }
      break;
    case 'bridge': {
      const g = bridgeGeom(p);
      for (let i = 0; i < 7; i++) out.push({ x: g.a + ((i + 0.5) / 7) * (g.b - g.a), y: g.deckY + 1.5 });
      break;
    }
    case 'loop': {
      const g = loopGeom(p);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + ((i + 0.5) / n) * TAU;
        out.push({ x: g.cx + Math.cos(a) * (g.r - 1.9), y: g.cy + Math.sin(a) * (g.r - 1.9) });
      }
      break;
    }
  }
  return out;
}

/** True where generic (non-reward-line) pickups must not spawn. */
function insideExclusion(p: PlacedProp, x: number): boolean {
  if (p.kind === 'loop') {
    const g = loopGeom(p);
    return x > g.cx - g.r - 3 && x < g.cx + g.r + 3;
  }
  if (p.kind === 'ramp') {
    const g = rampGeom(p);
    return x > g.kickStart - 1 && x < g.lipX + 14;
  }
  return x > p.x - 0.5 && x < p.x + p.span + 0.5;
}

// ---------------------------------------------------------------------------------------------
// Endless
// ---------------------------------------------------------------------------------------------
interface Segment {
  world: WorldDef;
  start: number; // seam x where this segment begins (−∞ for the first)
  phase: number[]; // per-run phase offsets so every run rolls different hills
}

export const endlessAmpMul = (m: number) =>
  CFG.ampFloor + (CFG.ampCeil - CFG.ampFloor) * smoothstep((m - CFG.hookM) / (CFG.rampEndM - CFG.hookM));
export const endlessSpiceMul = (m: number) => smoothstep((m - CFG.hookM) / (CFG.rampEndM - CFG.hookM));

export class EndlessTrack extends Track {
  readonly mode = 'endless' as const;
  readonly length = null;
  private segments: Segment[] = [];
  private slots = new Map<number, PlacedProp | null>();
  private slotsBuiltTo = -1;
  private lastWindowEnd = -Infinity;
  private pickups: PickupDef[] = [];
  private pickupsBuiltTo = 0;
  private nextEnergyX = 12;
  private nextCoinX = 20;
  private nextChunk = 0;
  private nextId = 1;
  private rewardedSlots = new Set<number>();
  private biomeSeq: WorldId[];
  private energyCount = 0;
  private coinCount = 0;

  /** `firstSeam` (QA) forces the first biome seam to that distance. */
  constructor(readonly seed: number, startWorld: WorldId = 'sylvan', private flat = false, private firstSeam = 0) {
    super();
    this.biomeSeq = [startWorld];
    this.segments.push(this.makeSegment(WORLDS[startWorld], -Infinity, 0));
  }

  private makeSegment(world: WorldDef, start: number, idx: number): Segment {
    const phase = [0, 1, 2, 3].map((k) => hash01(this.seed, 0x5e6 + idx, k) * TAU);
    return { world, start, phase };
  }

  /** Seam k (k ≥ 1) sits a seeded 800–1000 m past seam k−1. Always keeps one segment beyond x. */
  private ensureSegments(x: number) {
    for (;;) {
      const last = this.segments[this.segments.length - 1];
      const lastStart = last.start === -Infinity ? 0 : last.start;
      if (this.segments.length > 1 && lastStart > x + CFG.seamBlendHalfM + 10) break;
      const idx = this.segments.length;
      const gap = idx === 1 && this.firstSeam ? this.firstSeam : lerp(CFG.seamMinM, CFG.seamMaxM, hash01(this.seed, 0xa11, idx));
      this.segments.push(this.makeSegment(this.pickWorld(idx), lastStart + gap, idx));
    }
  }

  /** Biomes cycle in shuffled laps of all six; a lap never opens on the biome just driven. */
  private pickWorld(idx: number): WorldDef {
    while (this.biomeSeq.length <= idx) {
      const lapNo = Math.floor(this.biomeSeq.length / WORLD_ORDER.length);
      const lap = WORLD_ORDER.slice();
      for (let i = lap.length - 1; i > 0; i--) {
        const j = Math.floor(hash01(this.seed, 0xb10 + lapNo, i) * (i + 1));
        [lap[i], lap[j]] = [lap[j], lap[i]];
      }
      if (lap[0] === this.biomeSeq[this.biomeSeq.length - 1]) lap.push(lap.shift()!);
      // The opening lap must not immediately repeat the boot biome either.
      this.biomeSeq.push(...lap);
    }
    return WORLDS[this.biomeSeq[idx]];
  }

  private segIndexAt(x: number): number {
    this.ensureSegments(x);
    let i = this.segments.length - 1;
    while (i > 0 && this.segments[i].start > x) i--;
    return i;
  }

  private enveloped(seg: Segment, x: number): number {
    const m = Math.max(0, x);
    const w = seg.world;
    let y = w.baseY;
    const amp = endlessAmpMul(m);
    for (let k = 0; k < w.octaves.length; k++) {
      const oc = w.octaves[k];
      y += amp * oc.amp * Math.sin((x / oc.wave) * TAU + oc.phase + seg.phase[k]);
    }
    const s = w.spice;
    y += endlessSpiceMul(m) * s.amp * Math.sin((x / s.wave) * TAU + s.phase + seg.phase[3]);
    return y;
  }

  private raw(x: number): number {
    if (this.flat) return 0;
    const i = this.segIndexAt(x);
    const seg = this.segments[i];
    const half = CFG.seamBlendHalfM;
    let h = this.enveloped(seg, x);
    if (seg.start !== -Infinity && x < seg.start + half && i > 0) {
      const t = smoothstep((x - (seg.start - half)) / (2 * half));
      h = lerp(this.enveloped(this.segments[i - 1], x), h, t);
    } else if (i + 1 < this.segments.length) {
      const nxt = this.segments[i + 1];
      if (x > nxt.start - half) {
        const t = smoothstep((x - (nxt.start - half)) / (2 * half));
        h = lerp(h, this.enveloped(nxt, x), t);
      }
    }
    return h;
  }

  private h0: number | null = null;
  base(x: number): number {
    const raw = this.raw(x);
    // Flattened launch pad so every run starts on level ground.
    const ax = Math.abs(x);
    if (ax >= CFG.startPadMeters) return raw;
    if (this.h0 === null) this.h0 = this.raw(0);
    return lerp(this.h0, raw, smoothstep((ax - 6) / (CFG.startPadMeters - 6)));
  }

  biomeAt(x: number): BiomeBlend {
    const i = this.segIndexAt(x);
    const seg = this.segments[i];
    const half = CFG.seamBlendHalfM;
    if (seg.start !== -Infinity && x < seg.start + half && i > 0) {
      return { a: this.segments[i - 1].world, b: seg.world, t: smoothstep((x - (seg.start - half)) / (2 * half)) };
    }
    if (i + 1 < this.segments.length) {
      const nxt = this.segments[i + 1];
      if (x > nxt.start - half) return { a: seg.world, b: nxt.world, t: smoothstep((x - (nxt.start - half)) / (2 * half)) };
    }
    return { a: seg.world, b: seg.world, t: 0 };
  }

  /** First seam position (QA + tests). */
  firstSeamX(): number {
    this.ensureSegments(1200);
    return this.segments[1].start;
  }
  biomeSequence(count: number): WorldId[] {
    let x = 0;
    while (this.segments.length < count) {
      x += 600;
      this.ensureSegments(x);
    }
    return this.segments.slice(0, count).map((s) => s.world.id);
  }

  // ---- props: one candidate per 30 m slot, realized in index order (adjacency-aware) ----
  private rollSlot(i: number): PropDef | null {
    if (i < 2) return null; // nothing in the first 60 m
    const r = hash01(this.seed, 0x50d5, i);
    if (r >= PROP.endlessOdds) return null;
    const m = i * PROP.slotStride;
    const kr = hash01(this.seed, 0x50d6, i);
    const jitter = hash01(this.seed, 0x50d7, i);
    const sizeR = hash01(this.seed, 0x50d8, i);
    let kind: PropKind;
    let size = 0;
    if (m < CFG.hookM) {
      kind = 'whoops'; // hook zone: no launch geometry, ever
    } else {
      const bodyShare = 0.16 * smoothstep((m - CFG.hookM) / (PROP.bodyFadeEndM - CFG.hookM));
      if (kr < bodyShare) kind = kr < bodyShare * 0.5 ? 'loop' : 'bridge';
      else if (kr < bodyShare + 0.42) {
        kind = 'ramp';
        size = sizeR < 0.45 ? 0 : sizeR < 0.82 ? 1 : 2;
      } else if (kr < bodyShare + 0.66) kind = 'whoops';
      else {
        kind = 'halfpipe';
        size = sizeR < 0.7 ? 0 : 1;
      }
    }
    const span = propSpan(kind, size);
    const room = Math.max(0, PROP.slotStride - Math.min(span, PROP.slotStride) - 1);
    return { kind, size, x: i * PROP.slotStride + jitter * room };
  }

  private ensureSlots(upTo: number) {
    while (this.slotsBuiltTo < upTo) {
      const i = ++this.slotsBuiltTo;
      const def = this.flat ? null : this.rollSlot(i);
      let placed: PlacedProp | null = null;
      if (def) {
        const p = placeProp(def, i, (x) => this.base(x));
        const clear = p.x0 > this.lastWindowEnd + 2;
        if (clear && isFairPlacement(p, (x) => this.base(x))) {
          placed = p;
          this.lastWindowEnd = p.x1;
        }
      }
      this.slots.set(i, placed);
    }
  }

  /** QA: plant a prop by hand (replaces whatever the slot rolled). */
  forceProp(def: PropDef): PlacedProp {
    const i = Math.floor(def.x / PROP.slotStride);
    this.ensureSlots(i + 2);
    for (const [k, p] of this.slots) {
      if (p && p.x1 > def.x - PROP.blend - 3 && p.x0 < def.x + propSpan(def.kind, def.size) + PROP.blend + 3) this.slots.set(k, null);
    }
    const placed = placeProp(def, i, (x) => this.base(x));
    this.slots.set(i, placed);
    return placed;
  }

  propsIn(x0: number, x1: number): PlacedProp[] {
    if (x1 < 0) return [];
    const i0 = Math.max(0, Math.floor(x0 / PROP.slotStride) - 2);
    const i1 = Math.floor(x1 / PROP.slotStride) + 1;
    this.ensureSlots(i1);
    const out: PlacedProp[] = [];
    for (let i = i0; i <= i1; i++) {
      const p = this.slots.get(i);
      if (p && p.x1 >= x0 && p.x0 <= x1) out.push(p);
    }
    return out;
  }

  // ---- pickups: sequential recurrences, generated outward from the start and cached ----
  private blocked(x: number): boolean {
    for (const p of this.propsIn(x - 1, x + 1)) if (insideExclusion(p, x)) return true;
    return false;
  }
  private push(kind: PickupKind, x: number, y: number) {
    this.pickups.push({ id: this.nextId++, kind, x, y });
  }

  private ensurePickups(upTo: number) {
    if (upTo <= this.pickupsBuiltTo) return;
    const target = upTo + 30;
    // Energy cells: dense through the hook, thinning to an "edge" with dry stretches.
    while (this.nextEnergyX < target) {
      const x = this.nextEnergyX;
      const k = this.energyCount++;
      const t = clamp((x - 400) / 1200, 0, 1);
      let gap = x >= 1600 ? 36 + hash01(this.seed, 0xe1, k) * 10 : lerp(15.3, 33, t) + hash01(this.seed, 0xe1, k) * lerp(8, 10, t);
      if (x >= 1600 && hash01(this.seed, 0xe2, k) < 0.15) gap *= 1.6;
      if (!this.blocked(x)) this.push('energy', x, this.surface(x) + 1.35);
      this.nextEnergyX = x + gap;
    }
    // Coin arcs.
    while (this.nextCoinX < target) {
      const x = this.nextCoinX;
      const k = this.coinCount++;
      const t = clamp((x - 400) / 1200, 0, 1);
      const n = 5;
      const lift = 0.9 + hash01(this.seed, 0xc3, k) * 1.4;
      if (!this.blocked(x) && !this.blocked(x + n * 1.3)) {
        for (let i = 0; i < n; i++) {
          const cx = x + i * 1.3;
          const local = this.surface(cx);
          const arc = Math.sin((i / (n - 1)) * Math.PI) * lift;
          this.push('coin', cx, clamp(local + 1.25 + arc, local + 1.2, local + 5.5));
        }
      }
      this.nextCoinX = x + lerp(22.7, 43, t) + hash01(this.seed, 0xc4, k) * lerp(13.3, 10, t);
    }
    // Power-ups: one roll per 24 m chunk; the chunk at 48–72 m always pays (the hook guarantee).
    while (this.nextChunk * 24 < target) {
      const c = this.nextChunk++;
      const m = c * 24;
      const odds = lerp(0.55, 0.22, clamp((m - CFG.hookM) / (2500 - CFG.hookM), 0, 1));
      if (c >= 2 && (c === 2 || hash01(this.seed, 0x9e37, c) < odds)) {
        const x = m + 4 + hash01(this.seed, 0x9e38, c) * 16;
        if (!this.blocked(x)) {
          const kr = hash01(this.seed, 0x9e39, c);
          let kind: PowerupKind;
          if (m >= CFG.hookM && kr < 0.12) kind = RARE_KINDS[hash32(this.seed, 0x9e3a, c) % RARE_KINDS.length];
          else kind = STANDARD_KINDS[hash32(this.seed, 0x9e3b, c) % STANDARD_KINDS.length];
          this.push(kind, x, this.surface(x) + 1.7);
        }
      }
    }
    // Prop reward lines.
    for (const p of this.propsIn(this.pickupsBuiltTo - 60, target)) {
      if (this.rewardedSlots.has(p.index) || p.x + p.span > target) continue;
      this.rewardedSlots.add(p.index);
      for (const c of propRewardCoins(p, (x) => this.height(x))) this.push('coin', c.x, c.y);
    }
    this.pickupsBuiltTo = target;
    this.pickups.sort((a, b) => a.x - b.x);
  }

  pickupsIn(x0: number, x1: number): PickupDef[] {
    if (x1 <= 0) return [];
    this.ensurePickups(x1);
    const out: PickupDef[] = [];
    for (const p of this.pickups) {
      if (p.x >= x1) break;
      if (p.x >= x0) out.push(p);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// Levels (campaign-generated or player-authored)
// ---------------------------------------------------------------------------------------------
export interface LevelPickup {
  kind: PickupKind;
  x: number;
  dy: number; // height above the drivable surface
}
export interface LevelData {
  v: 1;
  name: string;
  world: WorldId;
  length: number; // metres to the finish line
  step: number; // spacing of `heights`
  heights: number[]; // heights[i] at x = i·step, covering [0, length]
  pickups: LevelPickup[];
  props: PropDef[];
}

export function emptyLevel(name: string, world: WorldId = 'sylvan', length = 120): LevelData {
  const step = 4;
  const n = Math.round(length / step) + 1;
  return { v: 1, name, world, length, step, heights: new Array(n).fill(0), pickups: [], props: [] };
}

export function sanitizeLevel(raw: any): LevelData | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.heights)) return null;
  const world: WorldId = WORLD_ORDER.includes(raw.world) ? raw.world : 'sylvan';
  const step = Number(raw.step) > 0 ? Number(raw.step) : 4;
  const heights = raw.heights.map((h: any) => (Number.isFinite(+h) ? clamp(+h, -60, 60) : 0));
  if (heights.length < 2) return null;
  const length = clamp(Number(raw.length) || (heights.length - 1) * step, step, (heights.length - 1) * step);
  const pickups: LevelPickup[] = Array.isArray(raw.pickups)
    ? raw.pickups
        .filter((p: any) => p && typeof p.kind === 'string' && Number.isFinite(+p.x))
        .map((p: any) => ({ kind: p.kind, x: +p.x, dy: Number.isFinite(+p.dy) ? +p.dy : 1.4 }))
    : [];
  const props: PropDef[] = Array.isArray(raw.props)
    ? raw.props
        .filter((p: any) => p && PROP_KINDS.includes(p.kind) && Number.isFinite(+p.x))
        .map((p: any) => ({ kind: p.kind, x: +p.x, size: clamp(Math.round(+p.size || 0), 0, 2) }))
    : [];
  return { v: 1, name: String(raw.name ?? 'Level').slice(0, 24), world, length, step, heights, pickups, props };
}

export class LevelTrack extends Track {
  readonly mode = 'level' as const;
  readonly length: number;
  readonly world: WorldDef;
  private placed: PlacedProp[] = [];
  private pickups: PickupDef[] = [];

  constructor(readonly level: LevelData) {
    super();
    this.length = level.length;
    this.world = WORLDS[level.world];
    const sorted = level.props.slice().sort((a, b) => a.x - b.x);
    sorted.forEach((def, i) => this.placed.push(placeProp(def, i, (x) => this.base(x))));
    let id = 1;
    for (const p of level.pickups) {
      if (p.x < 1 || p.x > level.length + 2) continue;
      this.pickups.push({ id: id++, kind: p.kind, x: p.x, y: this.surface(p.x) + p.dy });
    }
    this.pickups.sort((a, b) => a.x - b.x);
  }

  /** Catmull-Rom through the height samples; flat run-out past both ends. */
  base(x: number): number {
    const hs = this.level.heights;
    const n = hs.length;
    const u = x / this.level.step;
    if (u <= 0) return hs[0];
    if (u >= n - 1) return hs[n - 1];
    const i = Math.floor(u);
    const t = u - i;
    const p0 = hs[Math.max(0, i - 1)];
    const p1 = hs[i];
    const p2 = hs[Math.min(n - 1, i + 1)];
    const p3 = hs[Math.min(n - 1, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  biomeAt(): BiomeBlend {
    return { a: this.world, b: this.world, t: 0 };
  }

  propsIn(x0: number, x1: number): PlacedProp[] {
    const out: PlacedProp[] = [];
    for (const p of this.placed) if (p.x1 >= x0 && p.x0 <= x1) out.push(p);
    return out;
  }
  allProps(): PlacedProp[] {
    return this.placed;
  }

  pickupsIn(x0: number, x1: number): PickupDef[] {
    const out: PickupDef[] = [];
    for (const p of this.pickups) {
      if (p.x >= x1) break;
      if (p.x >= x0) out.push(p);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// FnTrack: arbitrary height function + hand-placed props. Test rigs, QA staging, the garage pad.
// ---------------------------------------------------------------------------------------------
export class FnTrack extends Track {
  readonly mode = 'endless' as const;
  readonly length = null;
  private placed: PlacedProp[] = [];
  constructor(private fn: (x: number) => number, private world: WorldDef = WORLDS.sylvan, props: PropDef[] = []) {
    super();
    props
      .slice()
      .sort((a, b) => a.x - b.x)
      .forEach((def, i) => this.placed.push(placeProp(def, i, (x) => this.base(x))));
  }
  base(x: number): number {
    return this.fn(x);
  }
  biomeAt(): BiomeBlend {
    return { a: this.world, b: this.world, t: 0 };
  }
  propsIn(x0: number, x1: number): PlacedProp[] {
    return this.placed.filter((p) => p.x1 >= x0 && p.x0 <= x1);
  }
  pickupsIn(): PickupDef[] {
    return [];
  }
}
