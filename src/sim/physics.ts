// Box2D (planck) world: terrain chain chunks, loop + bridge bodies, debris. No rendering.

import { Body, Box, Chain, Edge, Fixture, RevoluteJoint, Vec2, World } from 'planck';
import { CFG, TAU } from './config';
import { bridgeGeom, loopGeom, PlacedProp, PROP, Track } from './track';

export const CAT = { terrain: 0x1, car: 0x2, prop: 0x4, debris: 0x8, plank: 0x10 } as const;

export interface LoopBody {
  prop: PlacedProp;
  cx: number;
  cy: number;
  r: number;
  body: Body;
  entry: Fixture; // bottom → right wall → over the top
  exit: Fixture; // top → left wall → bottom
  entryOn: boolean;
  exitOn: boolean;
  passedTop: boolean;
  sweep: number; // radians travelled around the centre (CCW from the bottom)
  lastAng: number | null;
  credited: boolean;
  smashed: boolean;
}

export interface BridgeBody {
  prop: PlacedProp;
  planks: Body[];
  plankLen: number[];
  crossedOnDeck: boolean;
  entryX: number | null;
}

export interface Debris {
  body: Body;
  w: number;
  h: number;
  kind: number;
  life: number;
}

export class PhysWorld {
  readonly world: World;
  readonly ground: Body;
  private chunks = new Map<number, Fixture>();
  readonly loops = new Map<number, LoopBody>();
  readonly bridges = new Map<number, BridgeBody>();
  readonly debris: Debris[] = [];
  /** Bumped whenever chunk/prop bodies change (renderer watches it). */
  revision = 0;

  constructor(readonly track: Track) {
    this.world = new World({ gravity: new Vec2(0, -CFG.gravity), allowSleep: true });
    this.ground = this.world.createBody({ type: 'static' });
    // Back wall: the world goes quiet behind the start line.
    const wallX = -(CFG.wrongWayMeters + 4);
    this.ground.createFixture({
      shape: new Edge(new Vec2(wallX, -200), new Vec2(wallX, 400)),
      friction: 0.2,
      filterCategoryBits: CAT.terrain,
    });
    if (track.length != null) {
      const endX = track.length + 70;
      this.ground.createFixture({
        shape: new Edge(new Vec2(endX, -200), new Vec2(endX, 400)),
        friction: 0.2,
        filterCategoryBits: CAT.terrain,
      });
    }
  }

  /** Sample x positions for one chunk (shared with the terrain mesh so art == physics). */
  static chunkXs(track: Track, c: number): number[] {
    const x0 = c * CFG.chunkLen;
    const x1 = x0 + CFG.chunkLen;
    const xs: number[] = [];
    const n = Math.round(CFG.chunkLen / CFG.sampleStep);
    for (let i = 0; i <= n; i++) xs.push(x0 + i * CFG.sampleStep);
    const br = track.breaksIn(x0, x1);
    if (br.length) {
      for (const b of br) xs.push(b);
      xs.sort((a, b) => a - b);
      // Drop grid samples that crowd a break (degenerate edges upset the solver).
      for (let i = xs.length - 2; i > 0; i--) {
        if (xs[i + 1] - xs[i] < 0.04 && !br.includes(xs[i])) xs.splice(i, 1);
        else if (xs[i] - xs[i - 1] < 0.04 && !br.includes(xs[i])) xs.splice(i, 1);
      }
    }
    return xs;
  }

  /** Build/destroy terrain chunks and prop bodies around the car. */
  sync(centerX: number) {
    const c0 = Math.floor((centerX - CFG.buildBehind) / CFG.chunkLen);
    const c1 = Math.floor((centerX + CFG.buildAhead) / CFG.chunkLen);
    for (const [c, fx] of this.chunks) {
      if (c < c0 - 1 || c > c1 + 1) {
        this.ground.destroyFixture(fx);
        this.chunks.delete(c);
        this.revision++;
      }
    }
    for (let c = c0; c <= c1; c++) {
      if (this.chunks.has(c)) continue;
      const xs = PhysWorld.chunkXs(this.track, c);
      const pts = xs.map((x) => new Vec2(x, this.track.height(x)));
      const chain = new Chain(pts, false);
      const xa = xs[0];
      const xb = xs[xs.length - 1];
      chain.setPrevVertex(new Vec2(xa - CFG.sampleStep, this.track.height(xa - CFG.sampleStep)));
      chain.setNextVertex(new Vec2(xb + CFG.sampleStep, this.track.height(xb + CFG.sampleStep)));
      const fx = this.ground.createFixture({ shape: chain, friction: 1, restitution: 0, filterCategoryBits: CAT.terrain });
      this.chunks.set(c, fx);
      this.revision++;
    }
    // Prop bodies.
    const x0 = centerX - CFG.buildBehind;
    const x1 = centerX + CFG.buildAhead;
    const live = new Set<number>();
    for (const p of this.track.propsIn(x0, x1)) {
      live.add(p.index);
      if (p.kind === 'loop' && !this.loops.has(p.index)) this.buildLoop(p);
      else if (p.kind === 'bridge' && !this.bridges.has(p.index)) this.buildBridge(p);
    }
    for (const [i, l] of this.loops) {
      if (!live.has(i)) {
        this.world.destroyBody(l.body);
        this.loops.delete(i);
        this.revision++;
      }
    }
    for (const [i, b] of this.bridges) {
      if (!live.has(i)) {
        for (const pl of b.planks) this.world.destroyBody(pl);
        this.bridges.delete(i);
        this.revision++;
      }
    }
  }

  static loopArc(cx: number, cy: number, r: number, a0: number, a1: number): Vec2[] {
    const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 0.45));
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new Vec2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return pts;
  }

  private buildLoop(p: PlacedProp) {
    const g = loopGeom(p);
    const body = this.world.createBody({ type: 'static' });
    const over = 0.22;
    const entryPts = PhysWorld.loopArc(g.cx, g.cy, g.r, -Math.PI / 2, Math.PI / 2 + over);
    const exitPts = PhysWorld.loopArc(g.cx, g.cy, g.r, Math.PI / 2 - over, (3 * Math.PI) / 2);
    const mk = (pts: Vec2[], on: boolean) =>
      body.createFixture({
        shape: new Chain(pts, false),
        friction: 1,
        restitution: 0,
        filterCategoryBits: on ? CAT.prop : 0,
        filterMaskBits: on ? 0xffff : 0,
      });
    const lb: LoopBody = {
      prop: p,
      cx: g.cx,
      cy: g.cy,
      r: g.r,
      body,
      entry: mk(entryPts, true),
      exit: mk(exitPts, false),
      entryOn: true,
      exitOn: false,
      passedTop: false,
      sweep: 0,
      lastAng: null,
      credited: false,
      smashed: false,
    };
    this.loops.set(p.index, lb);
    this.revision++;
  }

  setLoopCollide(l: LoopBody, entryOn: boolean, exitOn: boolean) {
    if (l.entryOn !== entryOn) {
      l.entry.setFilterData({ groupIndex: 0, categoryBits: entryOn ? CAT.prop : 0, maskBits: entryOn ? 0xffff : 0 });
      l.entryOn = entryOn;
    }
    if (l.exitOn !== exitOn) {
      l.exit.setFilterData({ groupIndex: 0, categoryBits: exitOn ? CAT.prop : 0, maskBits: exitOn ? 0xffff : 0 });
      l.exitOn = exitOn;
    }
  }

  /** Deck sample points: a shallow parabola so the plank chain starts at rest, already sagging. */
  static bridgeDeckPoints(p: PlacedProp): { x: number; y: number }[] {
    const g = bridgeGeom(p);
    const n = PROP.bridgePlanks;
    const sag = 0.42;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push({ x: g.a + (g.b - g.a) * u, y: g.deckY - sag * 4 * u * (1 - u) });
    }
    return pts;
  }

  private buildBridge(p: PlacedProp) {
    const pts = PhysWorld.bridgeDeckPoints(p);
    const thick = 0.24;
    const planks: Body[] = [];
    const plankLen: number[] = [];
    let prev: Body = this.ground;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const body = this.world.createBody({
        type: 'dynamic',
        position: new Vec2((a.x + b.x) / 2 + Math.sin(ang) * thick * 0.5, (a.y + b.y) / 2 - Math.cos(ang) * thick * 0.5),
        angle: ang,
        angularDamping: 0.6,
        linearDamping: 0.15,
      });
      body.createFixture({
        shape: new Box(len / 2 + 0.03, thick / 2),
        density: 3.2,
        friction: 1,
        restitution: 0,
        filterCategoryBits: CAT.plank,
        filterMaskBits: CAT.car,
      });
      this.world.createJoint(new RevoluteJoint({}, prev, body, new Vec2(a.x, a.y - thick * 0.5)));
      planks.push(body);
      plankLen.push(len);
      prev = body;
    }
    const last = pts[pts.length - 1];
    this.world.createJoint(new RevoluteJoint({}, prev, this.ground, new Vec2(last.x, last.y - thick * 0.5)));
    this.bridges.set(p.index, { prop: p, planks, plankLen, crossedOnDeck: false, entryX: null });
    this.revision++;
  }

  /** Shatter a loop into dynamic rubble (Super Sized smash-through). */
  smashLoop(l: LoopBody, impactX: number, impactY: number, carVx: number) {
    if (l.smashed) return;
    l.smashed = true;
    this.setLoopCollide(l, false, false);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / n) * TAU;
      const x = l.cx + Math.cos(a) * l.r;
      const y = Math.max(l.cy + Math.sin(a) * l.r, this.track.height(x) + 0.5);
      const w = (TAU * l.r) / n;
      const body = this.world.createBody({
        type: 'dynamic',
        position: new Vec2(x, y),
        angle: a + Math.PI / 2,
        angularDamping: 0.4,
        linearDamping: 0.05,
      });
      body.createFixture({
        shape: new Box(w * 0.46, 0.22),
        density: 2.2,
        friction: 0.9,
        restitution: 0.04,
        filterCategoryBits: CAT.debris,
        filterMaskBits: CAT.terrain,
      });
      const d2 = (x - impactX) ** 2 + (y - impactY) ** 2;
      const fall = 1 / (1 + d2 / 30);
      const dir = Math.atan2(y - impactY, x - impactX);
      body.setLinearVelocity(new Vec2(Math.cos(dir) * 16 * fall + carVx * 0.7 * fall, Math.sin(dir) * 14 * fall + 3 * fall));
      body.setAngularVelocity((i % 2 ? 1 : -1) * 4 * fall);
      this.debris.push({ body, w: w * 0.92, h: 0.44, kind: i % 3, life: 14 });
    }
    this.revision++;
  }

  stepDebris(dt: number, cullBehindX: number) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0 || d.body.getPosition().x < cullBehindX) {
        this.world.destroyBody(d.body);
        this.debris.splice(i, 1);
      }
    }
  }

  chunkRange(): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of this.chunks.keys()) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
    return [lo, hi];
  }
}
