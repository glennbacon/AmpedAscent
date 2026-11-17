// RunSim: one drive, start to finish. Owns the physics world, the rig and every gameplay rule.
// Headless by design — the renderer, HUD and audio only READ it (and drain `events`).

import { Vec2 } from 'planck';
import { CFG, clamp, wrapAngle } from './config';
import { LoopBody, PhysWorld } from './physics';
import { POWERUPS, PowerupKind, PowerupState, isPowerupKind } from './powerups';
import { PickupDef, PickupKind, PlacedProp, Track, loopGeom, rampGeom } from './track';
import { deriveStats, Loadout, VehicleStats } from './upgrades';
import { Vehicle, VehicleCtx } from './vehicle';

export interface SimInput {
  gas: number;
  brake: number;
  jump: boolean; // edge: true on the step the button went down
}

export type EndCause = 'drained' | 'wrecked';
export type PopupTone = 'stunt' | 'power' | 'combo' | 'info' | 'warn' | 'save';

export type SimEvent =
  | { t: 'pickup'; kind: PickupKind; x: number; y: number; value: number }
  | { t: 'popup'; text: string; tone: PopupTone; coins?: number }
  | { t: 'powerup'; kind: PowerupKind }
  | { t: 'powerupEnd'; kind: PowerupKind }
  | { t: 'land'; x: number; y: number; impact: number; airTime: number }
  | { t: 'jets'; x: number; y: number }
  | { t: 'rescue'; x: number; y: number }
  | { t: 'transform'; grow: boolean; x: number; y: number }
  | { t: 'loopSmash'; x: number; y: number }
  | { t: 'roofHit'; x: number; y: number; speed: number }
  | { t: 'lowBattery' }
  | { t: 'combo'; multiplier: number }
  | { t: 'ended'; cause: EndCause }
  | { t: 'completed' };

export interface RunStats {
  distance: number;
  coins: number; // everything earned in-run (pickups + stunts)
  pickupCoins: number;
  stuntCoins: number;
  flips: number;
  loops: number;
  bigAirs: number;
  stunts: number;
  comboLevel: number;
  bestComboLevel: number;
  topSpeed: number;
  airTimeTotal: number;
}

export interface ActivePickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  bornAt: number; // sim time (frenzy coins rain in)
  rain: boolean;
}

const newStats = (): RunStats => ({
  distance: 0, coins: 0, pickupCoins: 0, stuntCoins: 0, flips: 0, loops: 0, bigAirs: 0, stunts: 0,
  comboLevel: 0, bestComboLevel: 0, topSpeed: 0, airTimeTotal: 0,
});

export class RunSim {
  readonly phys: PhysWorld;
  vehicle: Vehicle;
  readonly powerups = new PowerupState();
  readonly stats = newStats();
  readonly events: SimEvent[] = [];
  readonly pickups: ActivePickup[] = [];
  readonly vstats: VehicleStats;

  /** false while parked on the title/ready screen: physics settles, no rules run. */
  live = false;
  status: 'playing' | 'ended' | 'completed' = 'playing';
  endCause: EndCause | null = null;
  time = 0;
  battery: number = CFG.batteryCapacity;
  wrongWay = false;
  reviveUsed = false;
  /** Loop the car is riding (renderer shifts the car along the corkscrew). */
  loopRide: { loop: LoopBody; t: number } | null = null;
  jumpReady = false;
  finishBattery = 0;

  private spawnedTo = 0;
  private collected = new Set<number>();
  private lastSyncX = -1e9;
  private sinceCharge = 0;
  private airRot = 0;
  private lastAngle = 0;
  private wheelieT = 0;
  private strandT = 0;
  private emptyT = 0;
  private stillT = 0;
  private rescueGrace = 0;
  private lowWarned = false;
  private frenzyT = 0;
  private frenzyId = -1;
  private shrinkPending = 0; // >0: Super Sized ended, waiting for a safe moment to shrink
  private crossings = new Map<number, { t0: number; credited: boolean }>();
  private roofWas = false;
  private takeoffRamp: PlacedProp | null = null;

  constructor(readonly track: Track, readonly loadout: Loadout) {
    this.vstats = deriveStats(loadout);
    this.phys = new PhysWorld(track);
    this.phys.sync(0);
    this.vehicle = this.spawnVehicle(0, 1);
    this.lastAngle = this.vehicle.angle;
    this.syncWorld(true);
  }

  private spawnVehicle(x: number, scale: number): Vehicle {
    const ride = (-CFG.wheelRestY + CFG.wheelRadius) * scale;
    const a = Math.atan(this.track.slope(x));
    return new Vehicle(this.phys.world, this.vstats, x, this.track.surface(x) + ride + 0.08, a, scale);
  }

  private emit(e: SimEvent) {
    this.events.push(e);
  }
  private popup(text: string, tone: PopupTone, coins?: number) {
    this.emit({ t: 'popup', text, tone, coins });
  }

  get multiplier() {
    return this.stats.comboLevel + 1;
  }
  get batteryFraction() {
    return this.battery / CFG.batteryCapacity;
  }
  get progress() {
    return this.track.length ? clamp(this.vehicle.x / this.track.length, 0, 1) : 0;
  }
  /** Coins the run banks: in-run earnings + the distance bonus. */
  get bankCoins() {
    return this.stats.coins + Math.floor(this.stats.distance * CFG.coinsPerMeter);
  }

  private stuntPayout(base: number): number {
    return base * this.multiplier * (this.powerups.isActive('stuntfever') ? 3 : 1);
  }
  private earnStunt(label: string, base: number) {
    const n = this.stuntPayout(base);
    this.stats.coins += n;
    this.stats.stuntCoins += n;
    this.stats.stunts++;
    this.popup(label, 'stunt', n);
  }
  private earnPickup(n: number) {
    this.stats.coins += n;
    this.stats.pickupCoins += n;
  }

  /** Grant a power-up (pickup or QA). */
  grant(kind: PowerupKind) {
    this.powerups.activate(kind);
    this.emit({ t: 'powerup', kind });
    this.popup(POWERUPS[kind].title, 'power');
    if (kind === 'supersized') {
      this.shrinkPending = 0;
      if (this.vehicle.scale < 1.01) this.swapRig(CFG.superScale);
    }
    if (kind === 'rollbar') this.vehicle.setRollBar(true);
  }

  private ctx(g: number): VehicleCtx {
    const tr = this.track;
    return {
      g,
      surface: (x) => tr.surface(x),
      slopeAngle: (x) => Math.atan(tr.slope(x)),
      hasCharge: this.battery > 0,
      turbo: this.powerups.isActive('turbo'),
      wheelieAssist: this.powerups.isActive('wheelie'),
      flipMaster: this.powerups.isActive('backflip'),
      loop: this.loopRide ? this.loopRide.loop : null,
    };
  }

  private syncWorld(force = false) {
    const x = this.vehicle.x;
    if (!force && Math.abs(x - this.lastSyncX) < 4) return;
    this.lastSyncX = x;
    this.phys.sync(x);
    // Pickups: spawn ahead, cull far behind.
    const ahead = x + CFG.buildAhead;
    if (ahead > this.spawnedTo) {
      for (const d of this.track.pickupsIn(this.spawnedTo, ahead)) this.addPickup(d);
      this.spawnedTo = ahead;
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (this.pickups[i].x < x - CFG.buildBehind - 10) this.pickups.splice(i, 1);
    }
    this.phys.stepDebris(0, x - CFG.buildBehind);
  }

  private addPickup(d: PickupDef) {
    if (this.collected.has(d.id)) return;
    if (this.track.length != null && d.x > this.track.length + 2) return;
    this.pickups.push({ id: d.id, kind: d.kind, x: d.x, y: d.y, bornAt: this.time, rain: false });
  }

  // ------------------------------------------------------------------------------------------
  step(dt: number, input: SimInput) {
    const v = this.vehicle;
    v.savePrev();
    const tr = this.track;
    const flipFloat = this.powerups.isActive('backflip') && v.airborne && v.airTime > 0.1;
    const g = CFG.gravity * tr.gravityMulAt(v.x) * (flipFloat ? CFG.flipMasterGravityMul : 1);
    this.phys.world.setGravity(new Vec2(0, -g));
    this.syncWorld();
    this.updateLoops();

    let inp = input;
    if (!this.live || this.status === 'ended') inp = { gas: 0, brake: 0, jump: false };
    else if (this.status === 'completed') inp = { gas: 0, brake: v.speed > 1.2 ? 1 : 0, jump: false };
    const ctx = this.ctx(g);

    this.jumpReady = this.powerups.isActive('jumpjets') && v.canJump(ctx);
    if (inp.jump && this.jumpReady && this.status === 'playing' && this.live) {
      v.fireJets(g);
      this.emit({ t: 'jets', x: v.x, y: v.y });
    }

    v.update(dt, inp, ctx);
    this.phys.world.step(dt, CFG.velIters, CFG.posIters);
    const land = v.postStep(dt);

    if (!this.live) {
      this.lastAngle = v.angle;
      return;
    }
    this.time += dt;
    this.trackStunts(dt, land, ctx);
    if (this.status !== 'playing') {
      this.lastAngle = v.angle;
      return;
    }
    this.updateBattery(dt, inp);
    this.updatePickups(dt);
    this.updatePowerups(dt, g);
    this.updateCrossings();
    this.updateEndConditions(dt, ctx, g);

    const st = this.stats;
    const dist = tr.length != null ? Math.min(v.x, tr.length) : v.x;
    if (dist > st.distance) st.distance = dist;
    if (v.speed > st.topSpeed) st.topSpeed = v.speed;
    this.wrongWay = v.x < -6;
    if (st.comboLevel > 0) {
      this.sinceCharge += dt;
      if (this.sinceCharge >= CFG.comboDecaySeconds) {
        st.comboLevel--;
        this.sinceCharge = 0;
        this.emit({ t: 'combo', multiplier: this.multiplier });
      }
    } else this.sinceCharge = 0;

    if (tr.length != null && v.x >= tr.length && this.status === 'playing') {
      this.status = 'completed';
      this.finishBattery = this.batteryFraction;
      this.emit({ t: 'completed' });
    }
    this.lastAngle = v.angle;
  }

  // ---- loops: Sonic-style layer switch + earned assist ----------------------------------------
  private updateLoops() {
    const v = this.vehicle;
    this.loopRide = null;
    const giant = v.scale > 1.01;
    for (const l of this.phys.loops.values()) {
      if (l.smashed) continue;
      const wc = v.chassis.getWorldCenter();
      const dx = wc.x - l.cx;
      const dy = wc.y - l.cy;
      const dist = Math.hypot(dx, dy);
      if (giant) {
        // A giant does not fit the tube: it goes THROUGH it.
        this.phys.setLoopCollide(l, false, false);
        if (v.x + CFG.hullHalfLen * v.scale > l.cx - 0.5 && v.x < l.cx + l.r) {
          this.phys.smashLoop(l, wc.x + 2, wc.y + 1, v.vx);
          this.emit({ t: 'loopSmash', x: l.cx, y: l.cy });
          if (this.live && this.status === 'playing') this.earnStunt('CRASH THROUGH!', CFG.crashThroughReward);
        }
        continue;
      }
      const out = wc.x < l.cx - l.r - 2.5 || wc.x > l.cx + l.r + 2.5;
      if (out) {
        l.passedTop = false;
        l.sweep = 0;
        l.lastAng = null;
        this.phys.setLoopCollide(l, wc.x < l.cx, false);
        continue;
      }
      // Unwrapped angle around the centre, CCW, bottom = −π/2. Only tracked near the rim so a
      // car tumbling through the middle cannot fake a lap.
      const ang = Math.atan2(dy, dx);
      if (dist > l.r * 0.45) {
        if (l.lastAng === null) {
          l.sweep = ang > Math.PI / 2 ? ang - 2 * Math.PI : ang; // approach side reads −π…−π/2
        } else l.sweep += wrapAngle(ang - l.lastAng);
        l.lastAng = ang;
      } else l.lastAng = null;
      if (!l.passedTop && l.sweep > 1.78) l.passedTop = true;
      if (l.passedTop && l.sweep < 0.9) l.passedTop = false; // slid back down the entry wall
      const inside = dist < l.r - 0.3;
      const entryOn = !l.passedTop && (wc.x < l.cx + 0.6 || inside);
      const exitOn = l.passedTop || (l.sweep > 0.95 && inside);
      this.phys.setLoopCollide(l, entryOn, exitOn);
      const riding = dist > l.r * 0.5 && dist < l.r + 0.3 && l.sweep > -1.72 && l.sweep < 4.55;
      if (riding) this.loopRide = { loop: l, t: clamp((l.sweep + Math.PI / 2) / (2 * Math.PI), 0, 1) };
      if (!l.credited && l.sweep > 4.3) {
        l.credited = true;
        this.rescueGrace = Math.max(this.rescueGrace, 4);
        if (this.live && this.status === 'playing') {
          this.stats.loops++;
          this.earnStunt('LOOP!', CFG.loopReward);
        }
      }
    }
  }

  // ---- stunts ---------------------------------------------------------------------------------
  private trackStunts(dt: number, land: { landed: boolean; airTime: number; impact: number }, ctx: VehicleCtx) {
    const v = this.vehicle;
    const playing = this.status === 'playing';
    if (v.airborne) {
      if (v.airTime <= dt * 1.5) {
        this.airRot = 0;
        // Remember a ramp we just launched from (Big Air is a ramp credit, not a bunny-hop credit).
        this.takeoffRamp = null;
        for (const p of this.track.propsIn(v.x - 6, v.x + 1)) {
          if (p.kind === 'ramp' && v.x > rampGeom(p).kickStart && v.x < rampGeom(p).lipX + 4) this.takeoffRamp = p;
        }
      }
      this.airRot += v.angle - this.lastAngle;
      this.stats.airTimeTotal += dt;
    }
    if (land.landed) {
      this.emit({ t: 'land', x: v.x, y: v.y - v.rideHeight, impact: land.impact, airTime: land.airTime });
      const upright = Math.abs(wrapAngle(v.angle - ctx.slopeAngle(v.x))) < 1.15;
      if (playing && upright) {
        const flips = Math.min(3, Math.floor((Math.abs(this.airRot) + 0.75) / (Math.PI * 2)));
        if (flips > 0) {
          this.stats.flips += flips;
          const name = this.airRot > 0 ? 'BACKFLIP' : 'FRONT FLIP';
          this.earnStunt(`${['', '', 'DOUBLE ', 'TRIPLE '][flips]}${name}!`, CFG.flipReward * flips);
        }
        if (land.airTime >= CFG.bigAirSeconds && (this.takeoffRamp || Math.abs(v.vx) > 9)) {
          this.stats.bigAirs++;
          this.earnStunt('BIG AIR!', CFG.bigAirReward);
        }
      }
      this.airRot = 0;
      this.takeoffRamp = null;
    }
    if (!v.airborne && !land.landed) this.airRot = 0;

    // Wheelie: rear down, front up, nose high, rolling.
    const tilt = wrapAngle(v.angle - ctx.slopeAngle(v.x));
    const wheelie = v.grounded[0] && !v.grounded[1] && tilt > CFG.wheelieMinTilt && tilt < 1.5 && v.speed > 2.5 && !this.loopRide;
    if (wheelie && playing) this.wheelieT += dt;
    else {
      if (this.wheelieT >= CFG.wheelieCreditSeconds && playing) {
        this.earnStunt('WHEELIE!', Math.round(Math.min(this.wheelieT, 5) * CFG.wheelieRewardPerSec));
      }
      this.wheelieT = 0;
    }
    if (v.roofContact && !this.roofWas) {
      this.emit({ t: 'roofHit', x: v.x, y: v.y, speed: Math.hypot(v.vx, v.vy) });
    }
    this.roofWas = v.roofContact;
  }
  get wheelieSeconds() {
    return this.wheelieT;
  }

  // ---- battery --------------------------------------------------------------------------------
  private updateBattery(dt: number, inp: SimInput) {
    const v = this.vehicle;
    if (v.throttle > 0) this.battery -= CFG.batteryDrainPerSec * v.throttle * dt;
    else {
      this.battery -= CFG.batteryIdleDrainPerSec * dt;
      if (Math.abs(v.speed) > 5 && v.anyGrounded) this.battery += CFG.batteryRegenPerSec * dt;
    }
    this.battery = clamp(this.battery, 0, CFG.batteryCapacity);
    const low = this.batteryFraction < CFG.lowBatteryFraction;
    if (low && !this.lowWarned) this.emit({ t: 'lowBattery' });
    this.lowWarned = low;
  }

  // ---- pickups --------------------------------------------------------------------------------
  private updatePickups(dt: number) {
    const v = this.vehicle;
    const wc = v.chassis.getWorldCenter();
    const cx = wc.x;
    const cy = wc.y + 0.25 * v.scale;
    const reach = CFG.pickupRadius * v.scale;
    const magnet = this.powerups.isActive('magnet');
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      let dx = cx - p.x;
      let dy = cy - p.y;
      let d = Math.hypot(dx, dy);
      if (magnet && d < CFG.magnetRadius * v.scale && (p.kind === 'coin' || p.kind === 'energy')) {
        const stepLen = Math.min(d, (CFG.magnetPullSpeed + Math.abs(v.speed)) * dt);
        p.x += (dx / d) * stepLen;
        p.y += (dy / d) * stepLen;
        d -= stepLen;
      }
      if (d > reach) continue;
      this.pickups.splice(i, 1);
      if (p.id > 0) this.collected.add(p.id);
      this.collect(p);
    }
  }

  private collect(p: ActivePickup) {
    const st = this.stats;
    if (p.kind === 'coin') {
      const n = this.multiplier;
      this.earnPickup(n);
      this.emit({ t: 'pickup', kind: 'coin', x: p.x, y: p.y, value: n });
    } else if (p.kind === 'energy') {
      this.battery = Math.min(CFG.batteryCapacity, this.battery + CFG.energyPickupCharge);
      const before = st.comboLevel;
      const bump = this.powerups.isActive('stuntfever') ? 2 : 1;
      st.comboLevel = Math.min(CFG.comboMaxLevel, st.comboLevel + bump);
      st.bestComboLevel = Math.max(st.bestComboLevel, st.comboLevel);
      this.sinceCharge = 0;
      this.emit({ t: 'pickup', kind: 'energy', x: p.x, y: p.y, value: CFG.energyPickupCharge });
      if (st.comboLevel !== before) {
        this.emit({ t: 'combo', multiplier: this.multiplier });
        this.popup(`×${this.multiplier}`, 'combo');
      }
    } else if (isPowerupKind(p.kind)) {
      this.emit({ t: 'pickup', kind: p.kind, x: p.x, y: p.y, value: 0 });
      this.grant(p.kind);
    }
  }

  // ---- power-ups ------------------------------------------------------------------------------
  private updatePowerups(dt: number, g: number) {
    const v = this.vehicle;
    const armedBefore = this.rescueArmedNow();
    for (const k of this.powerups.tick(dt)) {
      this.emit({ t: 'powerupEnd', kind: k });
      if (k === 'supersized') this.shrinkPending = 0.0001;
      if (k === 'rollbar') this.vehicle.setRollBar(false);
    }
    if (armedBefore && !this.rescueArmedNow()) this.rescueGrace = Math.max(this.rescueGrace, CFG.rescueGraceSeconds);
    if (this.rescueGrace > 0) this.rescueGrace -= dt;

    // Deferred shrink: never pop back to normal size mid-air far above the ground.
    if (this.shrinkPending > 0) {
      this.shrinkPending += dt;
      const clearance = v.y - v.rideHeight - this.track.surface(v.x);
      if (v.anyGrounded || clearance < 2.2 || this.shrinkPending > CFG.superShrinkDeferSeconds) {
        this.shrinkPending = 0;
        if (v.rescueT <= 0) this.swapRig(1);
        else this.shrinkPending = 0.0001;
      }
    }

    // Coin Frenzy: arcs of coins rain in ahead of the car.
    if (this.powerups.isActive('frenzy')) {
      this.frenzyT -= dt;
      if (this.frenzyT <= 0) {
        this.frenzyT = CFG.frenzySpawnInterval;
        const lead = 9 + ((this.time * 7.3) % 6) + Math.max(0, v.speed) * 0.45;
        for (let i = 0; i < CFG.frenzyArcCount; i++) {
          const x = v.x + lead + i * 1.6;
          if (this.track.length != null && x > this.track.length - 2) break;
          const arc = Math.sin((i / (CFG.frenzyArcCount - 1)) * Math.PI) * 1.3;
          this.pickups.push({ id: this.frenzyId--, kind: 'coin', x, y: this.track.surface(x) + 1.9 + arc, bornAt: this.time + i * 0.06, rain: true });
        }
      }
    } else this.frenzyT = 0;
  }

  private rescueArmedNow(): boolean {
    const p = this.powerups;
    return p.isActive('wheelie') || p.isActive('backflip') || p.isActive('jumpjets');
  }

  /** Rebuild the rig at a new scale, keeping pose and momentum (Box2D cannot resize a live body). */
  private swapRig(scale: number) {
    const old = this.vehicle;
    const x = old.x;
    const a = old.angle;
    const vx = old.vx;
    const vy = old.vy;
    const om = old.omega;
    const oldRide = old.rideHeight;
    const hadBar = old.rollBar;
    old.destroy();
    const ride = (-CFG.wheelRestY + CFG.wheelRadius) * scale;
    // Seat the new footprint on the highest ground under either axle.
    let need = -Infinity;
    for (const side of [-1, 1]) {
      const lx = side * CFG.wheelBaseHalf * scale;
      const ly = CFG.wheelRestY * scale;
      const wx = x + lx * Math.cos(a) - ly * Math.sin(a);
      const wyOff = lx * Math.sin(a) + ly * Math.cos(a);
      need = Math.max(need, this.track.surface(wx) + CFG.wheelRadius * scale - wyOff);
    }
    const y = Math.max(old.y + (ride - oldRide), need + 0.06);
    this.vehicle = new Vehicle(this.phys.world, this.vstats, x, y, a, scale);
    this.vehicle.setVelocity(vx, vy, om);
    if (hadBar && this.powerups.isActive('rollbar')) this.vehicle.setRollBar(true);
    this.lastAngle = a;
    this.emit({ t: 'transform', grow: scale > 1.01, x, y });
  }

  // ---- prop crossings: Pipe Swoop / Deck Run ---------------------------------------------------
  private updateCrossings() {
    const v = this.vehicle;
    for (const p of this.track.propsIn(v.x - 2, v.x + 2)) {
      if (p.kind !== 'halfpipe' && p.kind !== 'bridge') continue;
      let c = this.crossings.get(p.index);
      if (!c) {
        if (v.x >= p.x && v.x < p.x + 3 && v.speed > 0) {
          c = { t0: this.time, credited: false };
          this.crossings.set(p.index, c);
        }
        continue;
      }
      if (v.x < p.x - 0.5) {
        this.crossings.delete(p.index);
        continue;
      }
      if (!c.credited && v.x >= p.x + p.span - 0.5) {
        c.credited = true;
        const avg = p.span / Math.max(0.01, this.time - c.t0);
        if (avg >= CFG.pipeSwoopSpeed) {
          if (p.kind === 'halfpipe') this.earnStunt('PIPE SWOOP!', CFG.pipeSwoopReward);
          else this.earnStunt('DECK RUN!', CFG.deckRunReward);
        }
      }
    }
  }

  // ---- how a run ends -------------------------------------------------------------------------
  private updateEndConditions(dt: number, ctx: VehicleCtx, g: number) {
    const v = this.vehicle;
    const tilt = Math.abs(wrapAngle(v.angle - ctx.slopeAngle(v.x)));
    const clearance = v.y - this.track.surface(v.x);
    const nearGround = clearance < 2.6 * v.scale;
    // Roof-down, or propped on the tail/nose: any pose the wheels cannot drive out of.
    const inverted = tilt > 1.3 && nearGround && !v.airborne;
    const beached = !v.anyGrounded && !v.airborne && Math.hypot(v.vx, v.vy) < 1.2;
    // Only a SETTLED car counts down at full rate: one still rolling over (Roll Bar!) or sliding
    // on its roof gets the time to come out of it.
    const settled = Math.abs(v.omega) < 0.7 && Math.hypot(v.vx, v.vy) < 2.5;
    if (v.rescueT > 0 || this.loopRide) this.strandT = 0;
    else if (inverted) this.strandT += dt * (settled ? (tilt > 1.95 ? 1 : 0.75) : 0.22);
    else if (beached) this.strandT += dt * 0.6;
    else this.strandT = Math.max(0, this.strandT - dt * 2);

    const armed = (this.rescueArmedNow() || this.rescueGrace > 0) && v.scale < 1.01;
    if (armed && inverted && this.strandT > 0.45) {
      // A burning stunt assist never leaves you on your roof.
      this.strandT = 0;
      v.beginRescue(g);
      this.emit({ t: 'rescue', x: v.x, y: v.y });
      this.popup('SAVED!', 'save');
      return;
    }
    if (this.strandT > CFG.wreckDwellSeconds) return this.end('wrecked');

    if (this.battery <= 0) {
      this.emptyT += dt;
      if (Math.abs(v.speed) < 0.9 && !v.airborne) this.stillT += dt;
      else this.stillT = 0;
      if (this.stillT > CFG.drainedDwellSeconds || this.emptyT > CFG.drainedMaxSeconds) return this.end('drained');
    } else {
      this.emptyT = 0;
      this.stillT = 0;
    }
  }

  private end(cause: EndCause) {
    if (this.status !== 'playing') return;
    this.status = 'ended';
    this.endCause = cause;
    this.emit({ t: 'ended', cause });
  }

  /** One-per-run second chance: back on the wheels where you stopped, with charge in the pack. */
  revive() {
    if (this.status !== 'ended') return;
    const old = this.vehicle;
    const x = old.x;
    old.destroy();
    this.powerups.clear('supersized');
    this.shrinkPending = 0;
    this.vehicle = this.spawnVehicle(x, 1);
    if (this.powerups.isActive('rollbar')) this.vehicle.setRollBar(true);
    this.battery = Math.max(this.battery, CFG.batteryCapacity * 0.6);
    this.status = 'playing';
    this.endCause = null;
    this.reviveUsed = true;
    this.strandT = 0;
    this.emptyT = 0;
    this.stillT = 0;
    this.rescueGrace = 2;
    this.lastAngle = this.vehicle.angle;
    this.popup('REVIVED!', 'save');
  }

  /** Editor preview: show every pickup of a level at once (normally they stream in near the car). */
  revealAll() {
    const len = this.track.length;
    if (len == null) return;
    this.pickups.length = 0;
    for (const d of this.track.pickupsIn(0, len + 4)) this.pickups.push({ id: d.id, kind: d.kind, x: d.x, y: d.y, bornAt: 0, rain: false });
    this.spawnedTo = len + 4;
  }

  /** QA: teleport the rig (used by staging flags and tests). */
  placeAt(x: number, yAbove = 0.08, angle?: number) {
    const scale = this.vehicle.scale;
    this.vehicle.destroy();
    this.phys.sync(x);
    this.vehicle = this.spawnVehicle(x, scale);
    if (angle != null || yAbove !== 0.08) {
      const p = this.vehicle.chassis.getPosition();
      const dy = yAbove - 0.08;
      for (const b of this.vehicle.bodies()) {
        const bp = b.getPosition();
        b.setTransform(new Vec2(bp.x, bp.y + dy), b.getAngle());
      }
      if (angle != null) {
        // rotate the whole rig about the chassis origin
        const c = Math.cos(angle - this.vehicle.angle);
        const s = Math.sin(angle - this.vehicle.angle);
        const o = this.vehicle.chassis.getPosition();
        const ox = o.x;
        const oy = o.y;
        const d = angle - this.vehicle.angle;
        for (const b of this.vehicle.bodies()) {
          const bp = b.getPosition();
          const rx = bp.x - ox;
          const ry = bp.y - oy;
          b.setTransform(new Vec2(ox + rx * c - ry * s, oy + rx * s + ry * c), b.getAngle() + d);
        }
      }
      void p;
      this.vehicle.savePrev();
    }
    this.lastAngle = this.vehicle.angle;
    this.syncWorld(true);
  }
}

export { loopGeom };
