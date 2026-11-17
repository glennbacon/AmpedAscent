// Particle FX: two pooled point clouds (additive glow + alpha-blended dust) and a few expanding
// rings. All CPU-simulated — a couple of thousand points is nothing next to the draw-call savings.

import * as THREE from 'three';
import { clamp } from '../sim/config';
import { POWERUPS, isPowerupKind } from '../sim/powerups';
import { RunSim } from '../sim/run';
import { PickupKind } from '../sim/track';
import { Gfx, softSprite } from './gfx';
import { VehicleModel } from './vehicleModel';

const VERT = `
  attribute float size; attribute vec4 color; varying vec4 vColor; uniform float uScale;
  void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `
  uniform sampler2D map; varying vec4 vColor;
  void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.004) discard; }`;

class Pool {
  readonly points: THREE.Points;
  private n = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array; // remaining
  private span: Float32Array; // total
  private grav: Float32Array;
  private drag: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private mat: THREE.ShaderMaterial;

  constructor(readonly cap: number, additive: boolean) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.span = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softSprite() }, uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
  }
  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }
  clear() {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: number, alpha: number, grav = 0, drag = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.span[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.a0[i] = alpha;
    this.col[i * 4] = ((color >> 16) & 255) / 255;
    this.col[i * 4 + 1] = ((color >> 8) & 255) / 255;
    this.col[i * 4 + 2] = (color & 255) / 255;
    this.col[i * 4 + 3] = alpha;
    this.size[i] = s0;
  }
  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const l = --this.n;
        if (i !== l) {
          this.pos.copyWithin(i * 3, l * 3, l * 3 + 3);
          this.vel.copyWithin(i * 3, l * 3, l * 3 + 3);
          this.col.copyWithin(i * 4, l * 4, l * 4 + 4);
          this.life[i] = this.life[l];
          this.span[i] = this.span[l];
          this.s0[i] = this.s0[l];
          this.s1[i] = this.s1[l];
          this.grav[i] = this.grav[l];
          this.drag[i] = this.drag[l];
          this.a0[i] = this.a0[l];
        }
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.span[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Particles {
  readonly group = new THREE.Group();
  private glow: Pool;
  private dust: Pool;
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private acc = { dirt: 0, flame: 0, wind: 0, spark: 0, smoke: 0 };

  constructor(private gfx: Gfx) {
    const k = gfx.spec.particles;
    this.glow = new Pool(Math.round(1400 * k), true);
    this.dust = new Pool(Math.round(1100 * k), false);
    this.group.add(this.dust.points, this.glow.points);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 1 });
    }
  }

  clear() {
    this.glow.clear();
    this.dust.clear();
    for (const r of this.rings) r.mesh.visible = false;
  }

  ring(x: number, y: number, color: number) {
    const r = this.rings.find((q) => !q.mesh.visible) ?? this.rings[0];
    r.t = 0;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, 0.5);
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  pickupBurst(x: number, y: number, kind: PickupKind) {
    const color = kind === 'coin' ? 0xffd24a : kind === 'energy' ? 0x5dff7e : isPowerupKind(kind) ? POWERUPS[kind].color : 0xffffff;
    const n = kind === 'coin' ? 7 : 16;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(2, kind === 'coin' ? 6 : 9);
      this.glow.emit(x, y, rnd(-0.3, 0.3), Math.cos(a) * sp, Math.sin(a) * sp + 1.5, rnd(-1, 1), rnd(0.25, 0.5), rnd(0.35, 0.6), 0.05, color, 0.95, 4, 2.5);
    }
    if (kind !== 'coin') this.ring(x, y, color);
  }

  landingBurst(x: number, y: number, dustColor: number, k: number) {
    const n = Math.round(10 + 22 * k);
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.dust.emit(x + rnd(-1.4, 1.4), y + rnd(0, 0.25), rnd(-1.6, 1.6), dir * rnd(1.5, 6) * k, rnd(0.6, 3.2) * k, rnd(-1, 1), rnd(0.5, 1.1), rnd(0.7, 1.2), rnd(2.2, 3.6) * (0.6 + k * 0.5), dustColor, 0.42, -0.4, 2.2);
    }
  }

  jetBlast(x: number, y: number) {
    for (let i = 0; i < 26; i++) {
      this.glow.emit(x + rnd(-0.8, 0.8), y, rnd(-0.5, 0.5), rnd(-3, 3), rnd(-12, -5), rnd(-1, 1), rnd(0.2, 0.45), rnd(0.6, 1.1), 0.1, i % 3 ? 0x7fd4ff : 0xffffff, 0.9, 0, 3);
    }
    for (let i = 0; i < 12; i++) this.dust.emit(x + rnd(-1, 1), y - 0.6, rnd(-1, 1), rnd(-5, 5), rnd(0.5, 2), 0, rnd(0.5, 0.9), 0.8, 3, 0xcfd6e2, 0.3, 0, 2);
  }

  sparks(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0.2, Math.PI - 0.2);
      const sp = rnd(4, 11);
      this.glow.emit(x, y, rnd(-0.6, 0.6), Math.cos(a) * sp - 3, Math.sin(a) * sp, rnd(-2, 2), rnd(0.25, 0.6), rnd(0.18, 0.32), 0.04, i % 2 ? 0xffd27a : 0xfff4d0, 1, 18, 1);
    }
  }

  confetti(x: number, y: number) {
    const cols = [0x28e0ff, 0xff3fb4, 0xffd21f, 0x7ed957, 0xffffff];
    for (let i = 0; i < 90; i++) {
      this.dust.emit(x + rnd(-5, 5), y + rnd(0, 3), rnd(-2, 2), rnd(-5, 5), rnd(3, 11), rnd(-2, 2), rnd(1.2, 2.4), rnd(0.28, 0.5), 0.22, cols[i % cols.length], 1, 9, 1.6);
    }
  }

  smash(x: number, y: number) {
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(1, 6.5);
      this.dust.emit(x + Math.cos(a) * r, y + Math.sin(a) * r, rnd(-2, 2), Math.cos(a) * rnd(2, 8) + 5, Math.sin(a) * rnd(2, 8), rnd(-2, 2), rnd(0.8, 1.6), rnd(1.2, 2), rnd(4, 6.5), 0xbdb4a8, 0.5, 1, 1.6);
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 0, Math.cos(a) * rnd(4, 14) + 6, Math.sin(a) * rnd(4, 14), rnd(-3, 3), rnd(0.3, 0.8), rnd(0.25, 0.45), 0.05, i % 2 ? 0x28e0ff : 0xffffff, 1, 14, 0.8);
    }
    this.ring(x, y, 0x28e0ff);
  }

  /** Continuous car FX: tyre roost, speed dust, turbo flames, wheelie sparks, wind streaks. */
  vehicle(sim: RunSim, car: VehicleModel, dt: number, _time: number, dustColor: number, z0: number) {
    const v = sim.vehicle;
    if (!sim.live) return;
    const s = v.scale;
    const turbo = sim.powerups.isActive('turbo');
    const speed = Math.abs(v.speed);
    const fwdX = Math.cos(v.angle);
    const fwdY = Math.sin(v.angle);

    // Roost: clods thrown back off each driven, grounded tyre — scaled by throttle and wheelspin.
    const power = v.throttle * (0.55 + clamp(Math.abs(v.slip) / 6, 0, 1.4)) + (v.braking ? 0.5 : 0);
    if (power > 0.05) {
      this.acc.dirt += dt * 70 * power * (s > 1.01 ? 2 : 1);
      const dir = v.braking ? 1 : v.speed < -0.5 && v.throttle > 0 ? 1 : -1;
      while (this.acc.dirt >= 1) {
        this.acc.dirt -= 1;
        for (let i = 0; i < 2; i++) {
          if (!v.grounded[i]) continue;
          if (i === 1 && !v.stats.fourWD && !v.braking) continue;
          const wp = i === 0 ? car.rearWheelPos : car.frontWheelPos;
          const side = Math.random() < 0.5 ? 0.95 : -0.95;
          this.dust.emit(
            wp.x - fwdX * 0.2 * dir * -1, wp.y - 0.42 * s, z0 + side * s,
            dir * fwdX * rnd(2.5, 7.5) + v.vx * 0.25, rnd(1.5, 5.5) + Math.abs(fwdY) * 2, rnd(-0.8, 0.8),
            rnd(0.35, 0.75), rnd(0.25, 0.5) * s, rnd(0.9, 1.9) * s, dustColor, 0.55, 9, 1.2,
          );
        }
      }
    } else this.acc.dirt = 0;

    // Rolling dust at speed.
    if (v.anyGrounded && speed > 9) {
      this.acc.smoke += dt * (speed - 6) * 0.9;
      while (this.acc.smoke >= 1) {
        this.acc.smoke -= 1;
        this.dust.emit(car.rearWheelPos.x - 0.6, car.rearWheelPos.y - 0.35 * s, z0 + rnd(-1, 1), -v.vx * 0.12 + rnd(-1, 1), rnd(0.2, 1.4), rnd(-0.5, 0.5), rnd(0.7, 1.3), 0.9 * s, rnd(2.6, 4.2) * s, dustColor, 0.22, -0.3, 1.4);
      }
    }

    // Turbo: twin flame trail + embers.
    if (turbo) {
      this.acc.flame += dt * 130;
      while (this.acc.flame >= 1) {
        this.acc.flame -= 1;
        const ex = car.exhaustPos;
        const hot = Math.random();
        this.glow.emit(ex.x, ex.y + rnd(-0.15, 0.15), z0 + rnd(-0.45, 0.45), -fwdX * rnd(6, 13) + v.vx * 0.3, -fwdY * rnd(6, 13) + rnd(-1, 1), rnd(-1, 1), rnd(0.18, 0.4), rnd(0.9, 1.4) * s, 0.15, hot > 0.6 ? 0xfff0b0 : hot > 0.25 ? 0xffa23a : 0xff5a1e, 0.85, -2, 2.5);
      }
    }

    // Wheelie sparks off the rear skid.
    const tilt = v.angle - Math.atan(sim.track.slope(v.x));
    if (v.grounded[0] && !v.grounded[1] && tilt > 0.35 && speed > 4) {
      this.acc.spark += dt * 34;
      while (this.acc.spark >= 1) {
        this.acc.spark -= 1;
        this.glow.emit(car.rearWheelPos.x - 0.5 * s, car.rearWheelPos.y - 0.45 * s, z0 + rnd(-0.9, 0.9), -rnd(2, 7), rnd(1, 5), rnd(-1, 1), rnd(0.2, 0.45), rnd(0.16, 0.28), 0.03, 0xffe2a0, 1, 16, 0.6);
      }
    }

    // Wind streaks past ~60% of top speed.
    const sf = speed / Math.max(1, v.topSpeedNow);
    if (sf > 0.62 || turbo) {
      this.acc.wind += dt * (turbo ? 46 : 20) * clamp((sf - 0.5) * 2.4, 0.3, 1.6);
      while (this.acc.wind >= 1) {
        this.acc.wind -= 1;
        this.glow.emit(v.x + rnd(6, 26), v.y + rnd(-3, 8), rnd(-6, 4), -rnd(26, 44), rnd(-0.6, 0.6), 0, rnd(0.25, 0.5), rnd(0.12, 0.22), 0.05, turbo ? 0xffc27a : 0xffffff, turbo ? 0.5 : 0.28, 0, 0);
      }
    }
  }

  update(dt: number) {
    const h = this.gfx.height * this.gfx.renderer.getPixelRatio();
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.gfx.camera.fov / 2)));
    this.glow.setScale(scale);
    this.dust.setScale(scale);
    this.glow.update(dt);
    this.dust.update(dt);
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt * 3.2;
      if (r.t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - r.t, 3);
      r.mesh.scale.setScalar(0.5 + e * 3.1);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - r.t) * (1 - r.t) * 0.7;
    }
  }
}
