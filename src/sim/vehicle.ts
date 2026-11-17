// The rig: chassis + two wheels on limited-travel sliders with a hand-rolled spring/damper.
//
// Why not Box2D's WheelJoint: it has no travel limits and one damping ratio for both directions.
// Here each wheel hangs on a PrismaticJoint (hard bump/droop stops) through a tiny carrier body,
// spins on a RevoluteJoint motor, and the spring force is applied explicitly so compression and
// rebound are damped separately — rebound-heavy damping is what kills the Hill-Climb pogo.

import { Body, Circle, Fixture, Polygon, PrismaticJoint, RevoluteJoint, Vec2, World } from 'planck';
import { CFG, clamp, smoothstep, wrapAngle } from './config';
import { CAT } from './physics';
import type { VehicleStats } from './upgrades';

export interface DriveInput {
  gas: number; // 0…1
  brake: number; // 0…1
}

export interface VehicleCtx {
  g: number; // gravity magnitude in effect this step
  surface(x: number): number;
  slopeAngle(x: number): number;
  hasCharge: boolean;
  turbo: boolean;
  wheelieAssist: boolean;
  flipMaster: boolean;
  /** The loop currently being ridden (radial press + power floor), else null. */
  loop: { cx: number; cy: number; r: number } | null;
}

export interface Pose {
  x: number;
  y: number;
  a: number;
}

const REAR = 0;
const FRONT = 1;

export class Vehicle {
  readonly chassis: Body;
  readonly wheels: Body[] = [];
  readonly carriers: Body[] = [];
  private susp: PrismaticJoint[] = [];
  private axles: RevoluteJoint[] = [];
  private hullFx!: Fixture;
  private cageFx!: Fixture;
  private barFx: Fixture[] = [];

  readonly totalMass: number;
  private readonly sprungMass: number;
  private readonly massData: { mass: number; center: Vec2; I: number };
  private readonly inertia: number;
  private readonly k: number;
  private readonly cBump: number;
  private readonly cRebound: number;
  private readonly preload: [number, number];
  readonly wheelR: number;
  readonly rideHeight: number; // chassis origin → ground at rest

  // ---- live state (read by the run sim, HUD, FX, audio) ----
  grounded: [boolean, boolean] = [false, false];
  anyGrounded = false;
  airborne = false;
  airTime = 0;
  lastAirTime = 0;
  roofContact = false;
  hullContact = false;
  compression: [number, number] = [0, 0]; // metres, + = compressed
  speed = 0; // signed forward ground speed, m/s
  slip = 0; // driven-wheel surface speed minus ground speed (wheelspin)
  throttle = 0; // applied drive 0…1 (audio/FX)
  braking = false;
  topSpeedNow: number = CFG.topSpeed;
  impactSpeed = 0; // closing speed of the last landing
  rescueT = 0; // >0 while a self-righting hop owns the attitude
  private flipTarget: number | null = null;
  private prevVy = 0;
  rollBar = false;

  private prev: { c: Pose; w: Pose[] } = { c: { x: 0, y: 0, a: 0 }, w: [{ x: 0, y: 0, a: 0 }, { x: 0, y: 0, a: 0 }] };

  constructor(
    private world: World,
    readonly stats: VehicleStats,
    x: number,
    y: number,
    angle = 0,
    readonly scale = 1,
  ) {
    const s = scale;
    const giant = s > 1.01;
    const massMul = giant ? CFG.superMassMul : 1;
    this.wheelR = CFG.wheelRadius * s;
    this.rideHeight = (-CFG.wheelRestY + CFG.wheelRadius) * s;

    this.chassis = world.createBody({
      type: 'dynamic',
      position: new Vec2(x, y),
      angle,
      angularDamping: CFG.groundAngularDamping,
      linearDamping: 0,
      allowSleep: false,
    });
    const filter = { filterGroupIndex: -1, filterCategoryBits: CAT.car, filterMaskBits: CAT.terrain | CAT.prop | CAT.plank };
    const L = CFG.hullHalfLen * s;
    const hb = CFG.hullBottom * s;
    const ht = CFG.hullTop * s;
    this.hullFx = this.chassis.createFixture({
      shape: new Polygon([
        new Vec2(-L + 0.24 * s, hb),
        new Vec2(L - 0.3 * s, hb),
        new Vec2(L, hb + 0.27 * s),
        new Vec2(L, ht),
        new Vec2(-L, ht),
        new Vec2(-L, hb + 0.25 * s),
      ]),
      density: 0,
      friction: 0.32,
      restitution: 0,
      ...filter,
    });
    this.cageFx = this.chassis.createFixture({
      shape: new Polygon([
        new Vec2(-1.3 * s, ht),
        new Vec2(0.62 * s, ht),
        new Vec2(0.28 * s, 0.98 * s),
        new Vec2(-0.86 * s, CFG.cageTop * s),
        new Vec2(-1.28 * s, 0.86 * s),
      ]),
      density: 0,
      friction: 0.45,
      restitution: 0.02,
      ...filter,
    });
    const cm = CFG.chassisMass * massMul;
    const cx = stats.comX * s;
    const cy = CFG.comY * s;
    const icm = CFG.chassisInertia * massMul * s * s;
    this.massData = { mass: cm, center: new Vec2(cx, cy), I: icm + cm * (cx * cx + cy * cy) };
    this.chassis.setMassData(this.massData);
    this.sprungMass = cm;

    const wm = CFG.wheelMass * massMul;
    const km = CFG.carrierMass * massMul;
    const axis = this.chassis.getWorldVector(new Vec2(0, 1));
    const wb = CFG.wheelBaseHalf * s;
    let extraI = 0;
    for (const side of [-1, 1]) {
      const local = new Vec2(side * wb, CFG.wheelRestY * s);
      const wp = this.chassis.getWorldPoint(local);
      const carrier = world.createBody({ type: 'dynamic', position: wp, angle, allowSleep: false });
      carrier.setMassData({ mass: km, center: new Vec2(0, 0), I: 0.04 * km * s * s });
      const wheel = world.createBody({
        type: 'dynamic',
        position: wp,
        angle,
        angularDamping: CFG.wheelAngularDamping,
        allowSleep: false,
      });
      wheel.createFixture({
        shape: new Circle(this.wheelR),
        density: wm / (Math.PI * this.wheelR * this.wheelR),
        friction: stats.grip * stats.grip, // mixes with terrain friction 1 → √(μ²·1) = μ
        restitution: 0,
        ...filter,
      });
      const pj = world.createJoint(
        new PrismaticJoint(
          { enableLimit: true, lowerTranslation: -CFG.droopTravel * s, upperTranslation: stats.bumpTravel * s },
          this.chassis,
          carrier,
          wp,
          axis,
        ),
      )!;
      const rj = world.createJoint(new RevoluteJoint({ enableMotor: true, maxMotorTorque: 0, motorSpeed: 0 }, carrier, wheel, wp))!;
      this.carriers.push(carrier);
      this.wheels.push(wheel);
      this.susp.push(pj);
      this.axles.push(rj);
      const dx = local.x - cx;
      const dy = local.y - cy;
      extraI += (wm + km) * (dx * dx + dy * dy);
    }
    this.totalMass = cm + 2 * (wm + km);
    this.inertia = icm + extraI;

    const hz = stats.springHz * (giant ? 0.85 : 1);
    const w = 2 * Math.PI * hz;
    this.k = (cm * w * w) / 2;
    const crit = Math.sqrt(2 * this.k * cm); // critical damping of the chassis on both springs, per wheel share
    this.cBump = stats.dampBump * crit;
    this.cRebound = stats.dampRebound * crit;
    const share = clamp((wb + cx) / (2 * wb), 0.2, 0.8); // static load fraction on the FRONT axle
    const weight = cm * CFG.gravity;
    this.preload = [weight * (1 - share), weight * share];
    this.savePrev();
  }

  destroy() {
    for (const j of [...this.axles, ...this.susp]) this.world.destroyJoint(j);
    for (const b of [...this.wheels, ...this.carriers, this.chassis]) this.world.destroyBody(b);
  }

  bodies(): Body[] {
    return [this.chassis, ...this.wheels, ...this.carriers];
  }

  // ---- pose helpers --------------------------------------------------------
  get x() {
    return this.chassis.getPosition().x;
  }
  get y() {
    return this.chassis.getPosition().y;
  }
  get angle() {
    return this.chassis.getAngle();
  }
  get vx() {
    return this.chassis.getLinearVelocity().x;
  }
  get vy() {
    return this.chassis.getLinearVelocity().y;
  }
  get omega() {
    return this.chassis.getAngularVelocity();
  }

  savePrev() {
    const p = this.chassis.getPosition();
    this.prev.c = { x: p.x, y: p.y, a: this.chassis.getAngle() };
    for (let i = 0; i < 2; i++) {
      const wp = this.wheels[i].getPosition();
      this.prev.w[i] = { x: wp.x, y: wp.y, a: this.wheels[i].getAngle() };
    }
  }
  /** Interpolated poses for rendering (alpha 0 = previous step, 1 = current). */
  chassisPose(alpha: number): Pose {
    const p = this.chassis.getPosition();
    const c = this.prev.c;
    return { x: c.x + (p.x - c.x) * alpha, y: c.y + (p.y - c.y) * alpha, a: c.a + (this.chassis.getAngle() - c.a) * alpha };
  }
  wheelPose(i: number, alpha: number): Pose {
    const p = this.wheels[i].getPosition();
    const w = this.prev.w[i];
    return { x: w.x + (p.x - w.x) * alpha, y: w.y + (p.y - w.y) * alpha, a: w.a + (this.wheels[i].getAngle() - w.a) * alpha };
  }

  translate(dx: number, dy: number) {
    for (const b of this.bodies()) {
      const p = b.getPosition();
      b.setTransform(new Vec2(p.x + dx, p.y + dy), b.getAngle());
    }
    this.savePrev();
  }
  setVelocity(vx: number, vy: number, omega: number) {
    for (const b of this.bodies()) {
      b.setLinearVelocity(new Vec2(vx, vy));
    }
    this.chassis.setAngularVelocity(omega);
    for (const c of this.carriers) c.setAngularVelocity(omega);
  }
  addVelocity(dvx: number, dvy: number) {
    for (const b of this.bodies()) {
      const v = b.getLinearVelocity();
      b.setLinearVelocity(new Vec2(v.x + dvx, v.y + dvy));
    }
  }

  // ---- power-up hardware ---------------------------------------------------
  /** Roll hoop: circles along an arc over the cabin. Fixtures on the chassis itself, zero density. */
  setRollBar(on: boolean) {
    if (on === this.rollBar) return;
    this.rollBar = on;
    if (!on) {
      for (const f of this.barFx) this.chassis.destroyFixture(f);
      this.barFx = [];
      // destroyFixture() recomputes mass from fixture densities (all zero here) — which would
      // leave a 1 kg chassis with NO rotational inertia. Re-assert the authored mass data.
      this.chassis.setMassData(this.massData);
      return;
    }
    const s = this.scale;
    for (const c of Vehicle.rollBarCaps(s)) {
      this.barFx.push(
        this.chassis.createFixture({
          shape: new Circle(new Vec2(c.x, c.y), c.r),
          density: 0,
          friction: 0.25,
          restitution: 0.05,
          filterGroupIndex: -1,
          filterCategoryBits: CAT.car,
          filterMaskBits: CAT.terrain | CAT.prop | CAT.plank,
        }),
      );
    }
  }
  /** Single source for the hoop: physics caps and the rendered tube both read this. */
  static rollBarCaps(s: number): { x: number; y: number; r: number }[] {
    const out: { x: number; y: number; r: number }[] = [];
    const R = CFG.rollBarRadius * s;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * (14 + (152 * i) / (n - 1))) / 180;
      out.push({ x: -0.15 * s + Math.cos(a) * R, y: 0.05 * s + Math.sin(a) * R, r: 0.2 * s });
    }
    return out;
  }

  /** Jump Jets: one upward kick sized for `airtime` seconds of air. Ground-only, upright-only. */
  canJump(ctx: VehicleCtx): boolean {
    if (!this.anyGrounded) return false;
    return Math.abs(wrapAngle(this.angle - ctx.slopeAngle(this.x))) < 1.0;
  }
  fireJets(g: number) {
    this.addVelocity(0, (g * CFG.jetsAirtime) / 2);
  }

  /** Self-righting hop (stunt rescue / revive): pops up and rotates the short way to upright. */
  beginRescue(g: number) {
    const air = 0.78;
    const err = wrapAngle(-this.angle);
    this.setVelocity(this.vx * 0.3, (g * air) / 2, err / (air * 0.7));
    for (const w of this.wheels) w.setAngularVelocity(0);
    this.rescueT = air + 0.25;
    this.flipTarget = null;
  }

  // ---- per-step control ----------------------------------------------------
  update(dt: number, inp: DriveInput, ctx: VehicleCtx) {
    const s = this.scale;
    const giant = s > 1.01;
    const st = this.stats;
    const ch = this.chassis;
    const up = ch.getWorldVector(new Vec2(0, 1));
    const fwd = ch.getWorldVector(new Vec2(1, 0));
    const vel = ch.getLinearVelocity();
    this.speed = vel.x * fwd.x + vel.y * fwd.y;

    // -- suspension: explicit spring + split damping on each slider --
    for (let i = 0; i < 2; i++) {
      const j = this.susp[i];
      const t = j.getJointTranslation();
      const v = j.getJointSpeed();
      this.compression[i] = t;
      const tn = t / s;
      let f = this.preload[i] + this.k * t + (t > 0 ? CFG.springProgressive * (giant ? CFG.superMassMul : 1) * tn * tn * s : 0);
      f += (v > 0 ? this.cBump : this.cRebound) * v;
      f = Math.max(f, -0.5 * this.preload[i]);
      const at = this.carriers[i].getPosition();
      ch.applyForce(new Vec2(up.x * f, up.y * f), at, true);
      this.carriers[i].applyForceToCenter(new Vec2(-up.x * f, -up.y * f), true);
    }

    // -- drive --
    const r = this.wheelR;
    const inLoop = ctx.loop != null;
    let top = st.topSpeed * (ctx.turbo ? CFG.turboSpeedMul : 1) * (giant ? CFG.superSpeedMul : 1);
    let force = st.driveForce * (ctx.turbo ? CFG.turboForceMul : 1) * (giant ? CFG.superForceMul : 1);
    if (inLoop) {
      // Earned assist: only while the pedal is held does a loop lend a weak car the power it lacks.
      top = Math.max(top, 19);
      force = Math.max(force, 0.82 * this.totalMass * ctx.g);
    }
    this.topSpeedNow = top;
    // Standing on its tail or roof the car cannot drive itself along the ground.
    const slopeHere = ctx.slopeAngle(this.x);
    const tipped = Math.abs(wrapAngle(this.angle - slopeHere)) > 1.3 && (this.hullContact || this.roofContact);
    const gas = ctx.hasCharge && !tipped ? clamp(inp.gas, 0, 1) : 0;
    const brake = clamp(inp.brake, 0, 1);
    const shares = st.fourWD ? [1, CFG.fourWDFrontShare] : [1, 0];
    const wheelSpeed = (i: number) => -(this.wheels[i].getAngularVelocity() - this.carriers[i].getAngularVelocity()) * r; // + = forward
    this.throttle = 0;
    this.braking = false;
    const rescuing = this.rescueT > 0;
    if (brake > 0 && !rescuing) {
      if (this.speed > 1.0) {
        this.braking = true;
        const tq = (CFG.brakeForce * (giant ? CFG.superMassMul : 1) * brake * r) / 2;
        for (let i = 0; i < 2; i++) {
          this.axles[i].setMotorSpeed(0);
          this.axles[i].setMaxMotorTorque(tq);
        }
      } else if (ctx.hasCharge) {
        const revTop = top * CFG.reverseSpeedFrac;
        this.throttle = brake * 0.7;
        for (let i = 0; i < 2; i++) {
          const over = -wheelSpeed(i) >= revTop;
          this.axles[i].setMotorSpeed(revTop / r);
          this.axles[i].setMaxMotorTorque(over ? 0 : force * CFG.reverseForceFrac * brake * r * shares[i]);
        }
      } else this.coast(r, giant);
    } else if (gas > 0 && !rescuing) {
      this.throttle = gas;
      for (let i = 0; i < 2; i++) {
        const ws = wheelSpeed(i);
        // EV curve: flat torque to the base speed, constant power above it.
        const taper = inLoop ? 1 : clamp((CFG.powerBaseFrac * top) / Math.max(ws, 0.01), 0.45, 1);
        const over = ws >= top; // already past the target (downhill): freewheel, never engine-brake
        this.axles[i].setMotorSpeed(-top / r);
        this.axles[i].setMaxMotorTorque(over ? 0 : force * taper * gas * r * shares[i]);
      }
    } else this.coast(r, giant);
    this.slip = wheelSpeed(REAR) - this.speed;

    // -- attitude --
    const omega = ch.getAngularVelocity();
    const pitch = gas - brake;
    let torque = 0;
    if (rescuing) {
      this.rescueT -= dt;
      const err = wrapAngle(slopeHere - this.angle);
      torque = this.inertia * clamp(42 * err - 9 * omega, -70, 70);
      ch.setAngularDamping(0.1);
    } else if (this.airborne && !inLoop) {
      if (ctx.flipMaster && this.airTime > 0.1) {
        torque = this.flightController(ctx);
        ch.setAngularDamping(0.05);
      } else {
        this.flipTarget = null;
        if (pitch !== 0) {
          // Authority ramps in over the first moments of air: a held pedal over a small crest
          // barely tips the car, a real jump still flips it.
          const ramp = 0.18 + 0.82 * smoothstep(this.airTime / CFG.airPitchRampSeconds);
          const accel = st.airAccel * ramp * (giant ? CFG.superAirMul : 1);
          if (pitch * omega < st.airMaxOmega) torque = pitch * this.inertia * accel;
          ch.setAngularDamping(0.08);
        } else ch.setAngularDamping(CFG.airAngularDamping);
      }
    } else {
      this.flipTarget = null;
      ch.setAngularDamping(CFG.groundAngularDamping);
      const oneAxle = this.grounded[REAR] !== this.grounded[FRONT];
      if (ctx.wheelieAssist && gas > 0 && this.grounded[REAR] && !inLoop) {
        // Wheelie Time: PD-balance on the rear axle at a show-off angle; can never loop over.
        const err = wrapAngle(slopeHere + CFG.wheelieAssistAngle - this.angle);
        torque = this.inertia * clamp(16 * err - 5.5 * omega, -34, 34);
      } else if (oneAxle && pitch !== 0 && !inLoop) {
        torque = pitch * this.inertia * CFG.groundLeanAccel * (giant ? CFG.superAirMul : 1);
      }
    }
    if (torque !== 0) ch.applyTorque(torque, true);

    // -- aero / gravity shaping --
    const sp2 = vel.x * vel.x + vel.y * vel.y;
    const sp = Math.sqrt(sp2);
    if (sp > 0.5) {
      const d = CFG.airDrag * this.totalMass * sp;
      ch.applyForceToCenter(new Vec2(-vel.x * d, -vel.y * d), true);
    }
    if (inLoop && Math.abs(this.speed) > 3.5 && gas > 0) {
      // Radial press: ⊥ to motion, so it is grip, never propulsion. Lift the pedal and you fall off.
      const wc = ch.getWorldCenter();
      const dx = wc.x - ctx.loop!.cx;
      const dy = wc.y - ctx.loop!.cy;
      const dl = Math.hypot(dx, dy) || 1;
      const f = 1.2 * this.totalMass * ctx.g;
      for (const b of this.bodies()) {
        const m = b.getMass();
        b.applyForceToCenter(new Vec2((dx / dl) * f * (m / this.totalMass), (dy / dl) * f * (m / this.totalMass)), true);
      }
    } else if (this.anyGrounded && !inLoop) {
      // Speed-proportional downforce along the car's own "down": more bite, less crest-float.
      const f = Math.min(CFG.downforce * sp2, 0.75 * ctx.g) * this.totalMass * (giant ? 0.5 : 1);
      ch.applyForceToCenter(new Vec2(-up.x * f, -up.y * f), true);
    } else if (this.airborne && vel.y < 0 && !inLoop) {
      // Heavier fall: the arc comes down faster than it went up.
      const k = clamp(-vel.y / 3, 0, 1) * (CFG.fallGravityMul - 1) * ctx.g;
      for (const b of this.bodies()) b.applyForceToCenter(new Vec2(0, -b.getMass() * k), true);
    }
    this.prevVy = vel.y;
  }

  private coast(r: number, giant: boolean) {
    const tq = (CFG.coastBrakeForce * (giant ? CFG.superMassMul : 1) * r) / 2;
    for (let i = 0; i < 2; i++) {
      this.axles[i].setMotorSpeed(0);
      this.axles[i].setMaxMotorTorque(tq);
    }
  }

  /** Seconds until the chassis reaches ride height over the surface (ballistic estimate). */
  timeToLand(ctx: VehicleCtx): number {
    const p = this.chassis.getPosition();
    const v = this.chassis.getLinearVelocity();
    const g = ctx.g * 1.08;
    for (let t = 0.04; t < 3; t += 0.04) {
      const x = p.x + v.x * t;
      const y = p.y + v.y * t - 0.5 * g * t * t;
      if (y - ctx.surface(x) <= this.rideHeight) return t;
    }
    return 3;
  }

  /** Flip Master: plan N backflips for the available airtime, then land on the wheels. */
  private flightController(ctx: VehicleCtx): number {
    const T = this.timeToLand(ctx);
    const a = this.angle;
    const v = this.chassis.getLinearVelocity();
    const landSlope = ctx.slopeAngle(this.x + v.x * T);
    if (this.flipTarget === null) {
      const flips = T >= 1.5 ? 2 : T >= 0.72 ? 1 : 0;
      this.flipTarget = a + wrapAngle(landSlope - a) + flips * Math.PI * 2;
    } else {
      this.flipTarget += wrapAngle(landSlope - this.flipTarget) * 0.2; // track the landing slope
    }
    const remaining = this.flipTarget - a;
    const omega = this.chassis.getAngularVelocity();
    let alpha: number;
    if (T < 0.16 || Math.abs(remaining) < 0.35) alpha = clamp(55 * remaining - 11 * omega, -90, 90);
    else alpha = clamp(14 * (clamp(remaining / Math.max(T - 0.12, 0.1), -13, 13) - omega), -90, 90);
    return this.inertia * alpha;
  }

  /** Contact bookkeeping after the world stepped. Returns landing info when the car touched down. */
  postStep(dt: number): { landed: boolean; airTime: number; impact: number } {
    const was = this.airborne;
    for (let i = 0; i < 2; i++) this.grounded[i] = this.touching(this.wheels[i]);
    this.anyGrounded = this.grounded[0] || this.grounded[1];
    this.roofContact = false;
    this.hullContact = false;
    for (let ce = this.chassis.getContactList(); ce; ce = ce.next) {
      const c = ce.contact;
      if (!c.isTouching()) continue;
      const mine = c.getFixtureA().getBody() === this.chassis ? c.getFixtureA() : c.getFixtureB();
      if (mine === this.hullFx) this.hullContact = true;
      else this.roofContact = true;
    }
    this.airborne = !this.anyGrounded && !this.roofContact && !this.hullContact;
    let landed = false;
    let lastAir = 0;
    if (this.airborne) this.airTime += dt;
    else {
      if (was && this.airTime > 0.12) {
        landed = true;
        lastAir = this.airTime;
        this.lastAirTime = this.airTime;
        this.impactSpeed = Math.max(0, -this.prevVy);
      }
      this.airTime = 0;
    }
    return { landed, airTime: lastAir, impact: this.impactSpeed };
  }

  private touching(b: Body): boolean {
    for (let ce = b.getContactList(); ce; ce = ce.next) {
      if (ce.contact.isTouching() && !ce.contact.getFixtureA().isSensor() && !ce.contact.getFixtureB().isSensor()) return true;
    }
    return false;
  }
}
