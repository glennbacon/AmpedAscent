// WorldView: everything visible about a RunSim. Owns the scene content and the camera rig.
// It only reads the sim; gameplay never depends on it (the sim runs headless in tests).

import * as THREE from 'three';
import { CFG, clamp, lerp, smoothstep } from '../sim/config';
import { RunSim, SimEvent } from '../sim/run';
import { Gfx } from './gfx';
import { SkyView } from './sky';
import { TerrainView } from './terrain';
import { VehicleModel } from './vehicleModel';
import { PickupsView } from './pickups';
import { PropsView } from './props';
import { Particles } from './particles';
import { Ambient } from './ambient';

export type CamMode = 'drive' | 'title' | 'garage' | 'editor';

export class WorldView {
  readonly sky: SkyView;
  readonly terrain = new TerrainView();
  readonly car = new VehicleModel();
  readonly pickups: PickupsView;
  readonly props: PropsView;
  readonly fx: Particles;
  readonly ambient: Ambient;
  private sim: RunSim | null = null;
  camMode: CamMode = 'drive';
  /** Editor camera target (world x / y of the view centre) and zoom distance. */
  editorCam = { x: 0, y: 0, dist: 34 };
  private focus = new THREE.Vector3();
  private dist = 26;
  private speedF = 0;
  private boost = { turbo: 0, giant: 0, loop: 0, air: 0 };
  private shake = 0;
  private shakeSeed = 0;
  private jetsFire = 0;
  private garageAngle = 0.6;
  private time = 0;
  private firstFrame = true;
  private loopZ = 0;

  constructor(readonly gfx: Gfx) {
    this.sky = new SkyView(gfx);
    this.pickups = new PickupsView();
    this.props = new PropsView();
    this.fx = new Particles(gfx);
    this.ambient = new Ambient(gfx);
    const s = gfx.scene;
    s.add(this.terrain.group, this.car.root, this.car.groundGlow, this.pickups.group, this.props.group, this.fx.group);
  }

  setSim(sim: RunSim) {
    this.sim = sim;
    this.terrain.decorDensity = this.gfx.spec.decor;
    this.terrain.setTrack(sim.track);
    this.props.setSim(sim);
    this.pickups.clear();
    this.fx.clear();
    this.car.resetScale(sim.vehicle.scale);
    this.terrain.syncAll(sim.vehicle.x);
    this.firstFrame = true;
    this.shake = 0;
    this.boost = { turbo: 0, giant: 0, loop: 0, air: 0 };
    this.loopZ = 0;
  }

  /** Editor: swap in a re-staged sim, rebuilding only the terrain span that changed. */
  editorStage(sim: RunSim, range?: [number, number]) {
    if (!this.sim || !range) {
      this.setSim(sim);
      this.terrain.syncAll(this.editorCam.x);
      return;
    }
    this.sim = sim;
    this.terrain.replaceTrack(sim.track);
    this.terrain.invalidate(range[0], range[1]);
    this.terrain.syncAll(this.editorCam.x);
    this.props.setSim(sim);
    this.pickups.clear();
    this.car.resetScale(1);
  }

  addShake(mag: number) {
    this.shake = Math.max(this.shake, mag);
  }

  /** Visual reactions to sim events (particles, shake). Audio/HUD consume the same list elsewhere. */
  handleEvent(e: SimEvent) {
    const sim = this.sim;
    if (!sim) return;
    const v = sim.vehicle;
    const dust = sim.track.biomeAt(v.x).a.dust;
    switch (e.t) {
      case 'pickup':
        this.fx.pickupBurst(e.x, e.y, e.kind);
        break;
      case 'land': {
        const k = clamp(e.impact / 16, 0, 1);
        if (e.impact > 3) this.fx.landingBurst(e.x, e.y, dust, 0.4 + k);
        this.addShake(0.08 + k * 0.5 * (v.scale > 1.01 ? 1.7 : 1));
        break;
      }
      case 'jets':
        this.jetsFire = 1;
        this.fx.jetBlast(e.x, e.y - v.rideHeight * 0.6);
        this.addShake(0.2);
        break;
      case 'rescue':
        this.fx.ring(e.x, e.y, 0x37c9e0);
        break;
      case 'transform':
        this.fx.ring(e.x, e.y, e.grow ? 0xc94f3d : 0xffffff);
        this.fx.landingBurst(e.x, e.y - 1, dust, 1.4);
        this.addShake(0.35);
        break;
      case 'loopSmash':
        this.fx.smash(e.x, e.y);
        this.addShake(1.3);
        break;
      case 'powerup':
        this.fx.ring(v.x, v.y, 0xffffff);
        if (e.kind === 'turbo') this.addShake(0.3);
        break;
      case 'roofHit':
        if (e.speed > 4) this.fx.sparks(e.x, e.y + 0.9 * v.scale, 10);
        break;
      case 'completed':
        this.fx.confetti(v.x + 2, v.y + 3);
        break;
      default:
        break;
    }
  }

  update(dt: number, alpha: number) {
    const sim = this.sim;
    if (!sim) return;
    this.time += dt;
    const v = sim.vehicle;
    const pose = v.chassisPose(alpha);
    const track = sim.track;
    const bl = track.biomeAt(pose.x);
    const dark = this.sky.darkness(bl);

    const focusX = this.camMode === 'editor' ? this.editorCam.x : pose.x;
    this.terrain.sync(focusX);
    this.props.update(sim, focusX, this.time);
    this.pickups.update(sim, this.time, focusX);

    // Corkscrew offset while riding a loop: the ribbon passes beside itself in depth.
    const lzTarget = sim.loopRide ? lerp(1.15, -1.15, sim.loopRide.t) : 0;
    this.loopZ += (lzTarget - this.loopZ) * Math.min(1, dt * 7);

    const pu = sim.powerups;
    this.jetsFire = Math.max(0, this.jetsFire - dt * 2.4);
    const joy =
      sim.live && sim.status !== 'ended' &&
      (pu.isActive('turbo') || (v.airborne && v.airTime > 0.45) || sim.wheelieSeconds > 0.6 || sim.status === 'completed' || this.camMode === 'title');
    this.car.update(
      v,
      alpha,
      { dark, battery: sim.batteryFraction, joy, jets: pu.isActive('jumpjets'), jetsFiring: this.jetsFire, turbo: pu.isActive('turbo'), throttle: v.throttle, loopZ: this.loopZ },
      dt,
      this.time,
    );

    // Neon pool under the car, pinned to the surface.
    const gy = track.surface(pose.x);
    const clearance = pose.y - v.rideHeight - gy;
    const glow = this.car.groundGlow;
    const gm = glow.material as THREE.MeshBasicMaterial;
    gm.opacity = (0.16 + dark * 0.5) * clamp(1 - clearance / 4, 0, 1);
    glow.position.set(pose.x, gy + 0.06, this.loopZ);
    glow.rotation.set(-Math.PI / 2, 0, 0);
    glow.rotateY(-Math.atan(track.slope(pose.x)));
    glow.scale.setScalar(v.scale);
    glow.visible = !sim.loopRide;

    this.fx.vehicle(sim, this.car, dt, this.time, bl.a.dust, this.loopZ);
    this.fx.update(dt);
    this.ambient.update(bl, this.gfx.camera, dt, this.time);

    this.updateCamera(sim, pose.x, pose.y, dt);
    this.sky.update(bl, pose.x, pose.y, this.time);
    this.gfx.setBloom(0.42 + dark * 0.3);
  }

  private updateCamera(sim: RunSim, cx: number, cy: number, dt: number) {
    const cam = this.gfx.camera;
    const v = sim.vehicle;
    const pu = sim.powerups;
    if (this.camMode === 'editor') {
      const e = this.editorCam;
      cam.position.set(e.x, e.y + 2, e.dist);
      cam.lookAt(e.x, e.y, 0);
      return;
    }
    if (this.camMode === 'garage') {
      // Slow turntable around the parked car.
      this.garageAngle += dt * 0.22;
      const a = 0.55 + Math.sin(this.garageAngle) * 0.5;
      const r = 9.2;
      const narrow = cam.aspect < 1.2;
      const tx = cx + (narrow ? 0 : 1.9);
      const ty = cy + (narrow ? -1.6 : 0.15);
      cam.position.lerp(_v.set(tx + Math.sin(a) * r, cy + 2.4, Math.cos(a) * r), this.firstFrame ? 1 : Math.min(1, dt * 3));
      cam.lookAt(tx, ty, 0);
      this.firstFrame = false;
      return;
    }
    const title = this.camMode === 'title';
    const sf = clamp(v.speed / 30, 0, 1);
    this.speedF += (sf - this.speedF) * Math.min(1, dt * (sf > this.speedF ? 2.2 : 0.7));
    const ease = (cur: number, target: number, up: number, down: number) => cur + (target - cur) * Math.min(1, dt * (target > cur ? up : down));
    this.boost.turbo = ease(this.boost.turbo, pu.isActive('turbo') ? 1 : 0, 5, 1.6);
    this.boost.giant = ease(this.boost.giant, v.scale > 1.01 ? 1 : 0, 3, 2);
    let nearLoop = 0;
    for (const l of sim.phys.loops.values()) if (!l.smashed && Math.abs(cx - l.cx) < l.r + 16) nearLoop = 1;
    this.boost.loop = ease(this.boost.loop, nearLoop, 2.2, 1.4);
    const clearance = cy - sim.track.surface(cx);
    this.boost.air = ease(this.boost.air, smoothstep((clearance - 5) / 12), 3, 1.5);

    const narrow = cam.aspect < 1.25;
    let dist: number;
    let ahead: number;
    let up: number;
    if (title) {
      dist = narrow ? 21 : 15.5;
      ahead = narrow ? 0 : 3.1;
      up = narrow ? -1.2 : 1.1;
    } else {
      dist = lerp(24.5, 35, this.speedF) + this.boost.turbo * 3 + this.boost.giant * 13 + this.boost.loop * 12 + this.boost.air * 8;
      if (narrow) dist *= 1.12;
      ahead = lerp(2.4, 8.5, this.speedF) + this.boost.loop * 3;
      up = 2.1 + this.boost.giant * 2.2 + this.boost.loop * 4.5;
    }
    const tx = cx + ahead;
    const ty = cy + up;
    if (this.firstFrame) {
      this.focus.set(tx, ty, 0);
      this.dist = dist;
      this.firstFrame = false;
    } else {
      this.focus.x += (tx - this.focus.x) * Math.min(1, dt * 7);
      this.focus.y += (ty - this.focus.y) * Math.min(1, dt * 4.2);
      this.dist += (dist - this.dist) * Math.min(1, dt * 2.5);
    }
    // Shake: decaying, deterministic wobble (plus a low turbo rumble).
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const mag = this.shake + this.boost.turbo * 0.035;
    this.shakeSeed += dt * 47;
    const sx = Math.sin(this.shakeSeed * 1.7) * mag * 0.5;
    const sy = Math.cos(this.shakeSeed * 2.3) * mag * 0.5;
    const rise = title ? 1.0 : 3.4;
    cam.position.set(this.focus.x - 1.2 + sx, this.focus.y + rise + sy, this.dist);
    cam.lookAt(this.focus.x + 0.6 + sx, this.focus.y + (title ? 0.9 : 0.4) + sy, 0);
  }
}

const _v = new THREE.Vector3();
void CFG;
