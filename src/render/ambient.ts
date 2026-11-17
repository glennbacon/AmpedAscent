// Ambient weather: fireflies, pollen, snow, sand, bubbles, marine snow, embers, ash.
// One small wrapping point cloud per kind, living in a box that follows the camera.

import * as THREE from 'three';
import { lerp } from '../sim/config';
import { BiomeBlend } from '../sim/track';
import { AmbientKind } from '../sim/worlds';
import { Gfx, softSprite } from './gfx';

interface Spec {
  count: number;
  color: number;
  size: number; // pixels
  additive: boolean;
  opacity: number;
  vx: number;
  vy: number;
  wobble: number;
  twinkle: number;
}

const SPECS: Partial<Record<AmbientKind, Spec>> = {
  fireflies: { count: 46, color: 0xffe08a, size: 7, additive: true, opacity: 0.9, vx: 0.4, vy: 0.15, wobble: 1.6, twinkle: 1 },
  pollen: { count: 90, color: 0xe6f6d8, size: 3.4, additive: true, opacity: 0.4, vx: 0.9, vy: 0.3, wobble: 0.7, twinkle: 0.3 },
  snow: { count: 240, color: 0xffffff, size: 4.2, additive: false, opacity: 0.85, vx: -2.6, vy: -4.2, wobble: 0.9, twinkle: 0 },
  sand: { count: 120, color: 0xf2d6a0, size: 2.8, additive: true, opacity: 0.4, vx: 9, vy: 0.2, wobble: 0.6, twinkle: 0.2 },
  bubbles: { count: 80, color: 0xcff4ff, size: 6, additive: true, opacity: 0.4, vx: 0.2, vy: 2.4, wobble: 0.9, twinkle: 0.2 },
  marineSnow: { count: 130, color: 0xcfe6ec, size: 2.6, additive: true, opacity: 0.32, vx: -0.4, vy: -0.5, wobble: 0.5, twinkle: 0.2 },
  embers: { count: 110, color: 0xffa050, size: 4.4, additive: true, opacity: 0.9, vx: 1.2, vy: 2.6, wobble: 1.3, twinkle: 0.7 },
  ash: { count: 120, color: 0x9a8c88, size: 3.2, additive: false, opacity: 0.5, vx: -1, vy: -1.3, wobble: 0.8, twinkle: 0 },
};

const BOX = { x: 44, y: 24, z0: -30, z1: 8 };

interface Layer {
  kind: AmbientKind;
  spec: Spec;
  points: THREE.Points;
  seed: Float32Array;
  weight: number;
}

export class Ambient {
  private layers: Layer[] = [];

  constructor(gfx: Gfx) {
    const k = gfx.spec.particles;
    for (const kind of Object.keys(SPECS) as AmbientKind[]) {
      const spec = SPECS[kind]!;
      const n = Math.max(8, Math.round(spec.count * k));
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() * 2 - 1) * BOX.x;
        pos[i * 3 + 1] = (Math.random() * 2 - 1) * BOX.y;
        pos[i * 3 + 2] = lerp(BOX.z0, BOX.z1, Math.random());
        seed[i * 2] = Math.random() * 100;
        seed[i * 2 + 1] = 0.6 + Math.random() * 0.8;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      const points = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: spec.color,
          size: spec.size * gfx.renderer.getPixelRatio(),
          sizeAttenuation: false,
          map: softSprite(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
          fog: false,
          toneMapped: false,
        }),
      );
      points.frustumCulled = false;
      points.visible = false;
      points.renderOrder = 6;
      gfx.scene.add(points);
      this.layers.push({ kind, spec, points, seed, weight: 0 });
    }
  }

  update(bl: BiomeBlend, cam: THREE.Camera, dt: number, time: number) {
    for (const L of this.layers) {
      const wa = (bl.a.ambient as string[]).includes(L.kind) ? 1 : 0;
      const wb = (bl.b.ambient as string[]).includes(L.kind) ? 1 : 0;
      const target = lerp(wa, wb, bl.t);
      L.weight += (target - L.weight) * Math.min(1, dt * 2.5);
      const vis = L.weight > 0.01;
      L.points.visible = vis;
      if (!vis) continue;
      const m = L.points.material as THREE.PointsMaterial;
      m.opacity = L.spec.opacity * L.weight * (1 - L.spec.twinkle * 0.3 + Math.sin(time * 3.1) * L.spec.twinkle * 0.3);
      const attr = L.points.geometry.attributes.position as THREE.BufferAttribute;
      const p = attr.array as Float32Array;
      const cx = cam.position.x;
      const cy = cam.position.y;
      const n = p.length / 3;
      for (let i = 0; i < n; i++) {
        const sd = L.seed[i * 2];
        const sp = L.seed[i * 2 + 1];
        let x = p[i * 3] + (L.spec.vx * sp + Math.sin(time * 0.9 + sd) * L.spec.wobble) * dt;
        let y = p[i * 3 + 1] + (L.spec.vy * sp + Math.cos(time * 1.1 + sd * 1.7) * L.spec.wobble * 0.7) * dt;
        // Wrap inside the camera-following box.
        if (x - cx > BOX.x) x -= BOX.x * 2;
        else if (x - cx < -BOX.x) x += BOX.x * 2;
        if (y - cy > BOX.y) y -= BOX.y * 2;
        else if (y - cy < -BOX.y) y += BOX.y * 2;
        p[i * 3] = x;
        p[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
    }
  }
}
