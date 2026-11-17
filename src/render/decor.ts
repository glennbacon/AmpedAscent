// Biome dressing: low-poly props generated from code and merged per terrain chunk (two draw calls:
// lit + glow). Placement is a pure function of the chunk index, so it never pops or reshuffles.

import * as THREE from 'three';
import { CFG } from '../sim/config';
import { hash01, Rng } from '../sim/rng';
import { bridgeGeom, loopGeom, Track } from '../sim/track';
import { DecorKind } from '../sim/worlds';
import { landY, TRACK_HALF } from './terrain';

interface Tpl {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  glow: boolean;
}

/** Bake a coloured primitive into a template. */
function part(geo: THREE.BufferGeometry, color: number, m?: THREE.Matrix4, shade = 1): Tpl {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  g.computeVertexNormals();
  const pos = g.attributes.position.array as Float32Array;
  const nor = g.attributes.normal.array as Float32Array;
  const c = new THREE.Color(color).multiplyScalar(shade);
  const col = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    col[i] = c.r;
    col[i + 1] = c.g;
    col[i + 2] = c.b;
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col, glow: false };
}
function join(parts: Tpl[], glow = false): Tpl {
  const n = parts.reduce((s, p) => s + p.pos.length, 0);
  const pos = new Float32Array(n);
  const nor = new Float32Array(n);
  const col = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    pos.set(p.pos, o);
    nor.set(p.nor, o);
    col.set(p.col, o);
    o += p.pos.length;
  }
  return { pos, nor, col, glow };
}
const T = (x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, rz = 0, rx = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
const ico = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0);
const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0);

class Batch {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  add(t: Tpl, x: number, y: number, z: number, s: number, ry: number, tint = 1, sy = s, tilt = 0) {
    this.e.set(tilt, ry, 0);
    this.q.setFromEuler(this.e);
    this.m.compose(this.v.set(x, y, z), this.q, new THREE.Vector3(s, sy, s));
    const e = this.m.elements;
    const p = t.pos;
    const n = t.nor;
    const c = t.col;
    for (let i = 0; i < p.length; i += 3) {
      const px = p[i], py = p[i + 1], pz = p[i + 2];
      this.pos.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]);
      const nx = n[i], ny = n[i + 1], nz = n[i + 2];
      // rotation only (uniform-ish scale): good enough for flat-shaded props
      const rx = e[0] * nx + e[4] * ny + e[8] * nz;
      const ry2 = e[1] * nx + e[5] * ny + e[9] * nz;
      const rz = e[2] * nx + e[6] * ny + e[10] * nz;
      const l = Math.hypot(rx, ry2, rz) || 1;
      this.nor.push(rx / l, ry2 / l, rz / l);
      this.col.push(c[i] * tint, c[i + 1] * tint, c[i + 2] * tint);
    }
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

// ---- template library (built once, lazily) ---------------------------------------------------
interface Entry {
  t: Tpl;
  weight: number;
  size: [number, number]; // scale range
  near: number; // min distance behind the track edge
  far: number; // max distance
  sink?: number;
}
interface Kit {
  entries: Entry[];
  perChunk: number;
  tufts: Tpl[]; // small shoulder dressing along the track edges
  tuftCount: number;
}
let kits: Record<DecorKind, Kit> | null = null;

function makeKits(): Record<DecorKind, Kit> {
  // ---------- forest ----------
  const trunk = (h: number, r = 0.2, c = 0x6b4a2e) => part(cyl(r * 0.7, r, h, 6), c);
  const oak = join([
    trunk(2.1, 0.26),
    part(ico(1.5), 0x4f9440, T(0, 3.1, 0)),
    part(ico(1.15), 0x62a84a, T(0.9, 2.5, 0.3)),
    part(ico(1.0), 0x3f7f38, T(-0.85, 2.6, -0.2)),
    part(ico(0.9), 0x6fb654, T(0.1, 4.0, 0.2)),
  ]);
  const poplar = join([trunk(1.6, 0.18), part(ico(1), 0x5aa24a, T(0, 3.2, 0, 0.9, 2.3, 0.9)), part(ico(0.7), 0x74ba58, T(0.25, 4.6, 0, 0.8, 1.4, 0.8))]);
  const pine = join([
    trunk(1.2, 0.2, 0x5a3e2a),
    part(cone(1.5, 2.2), 0x2f6e48, T(0, 0.9, 0)),
    part(cone(1.15, 2.0), 0x357a50, T(0, 2.2, 0)),
    part(cone(0.75, 1.7), 0x3d8858, T(0, 3.4, 0)),
  ]);
  const bush = join([part(ico(0.6), 0x4c8c3c, T(0, 0.4, 0)), part(ico(0.45), 0x63a64a, T(0.45, 0.32, 0.15)), part(ico(0.4), 0x3f7a36, T(-0.4, 0.28, 0.1))]);
  const rock = join([part(new THREE.DodecahedronGeometry(0.7, 0), 0x8a8f8c, T(0, 0.3, 0, 1.2, 0.75, 1)), part(new THREE.DodecahedronGeometry(0.4, 0), 0x767b78, T(0.7, 0.16, 0.2))]);
  const stump = join([part(cyl(0.34, 0.42, 0.55, 8), 0x6e4c30), part(cyl(0.3, 0.3, 0.03, 8), 0xc9a878, T(0, 0.55, 0))]);
  const grass = join([
    part(cone(0.07, 0.5, 4), 0x7cc65a, T(0, 0, 0, 1, 1, 1, 0.2)),
    part(cone(0.07, 0.62, 4), 0x9adb6e, T(0.1, 0, 0.04, 1, 1, 1, -0.15)),
    part(cone(0.06, 0.42, 4), 0x5fae48, T(-0.1, 0, -0.03, 1, 1, 1, 0.35)),
  ]);
  const flower = join([part(cone(0.03, 0.4, 4), 0x5fae48), part(ico(0.11, 0), 0xffd84a, T(0, 0.44, 0))]);

  // ---------- snow ----------
  const snowPine = join([
    trunk(1.0, 0.2, 0x3e3430),
    part(cone(1.45, 2.1), 0x1f5052, T(0, 0.8, 0)),
    part(cone(1.5, 0.55), 0xe6f0ff, T(0, 1.02, 0, 1, 1, 1)),
    part(cone(1.1, 1.9), 0x24595a, T(0, 2.1, 0)),
    part(cone(1.14, 0.5), 0xf2f7ff, T(0, 2.34, 0)),
    part(cone(0.7, 1.6), 0x2a6464, T(0, 3.3, 0)),
    part(cone(0.74, 0.7), 0xffffff, T(0, 3.7, 0)),
  ]);
  const shard = join([part(new THREE.OctahedronGeometry(0.6, 0), 0x9fd8ff, T(0, 1.2, 0, 0.55, 2.2, 0.55, 0.12)), part(new THREE.OctahedronGeometry(0.4, 0), 0xc8ecff, T(0.5, 0.7, 0.1, 0.5, 1.6, 0.5, -0.3))], true);
  const snowRock = join([part(new THREE.DodecahedronGeometry(0.8, 0), 0x3a4a6a, T(0, 0.35, 0, 1.2, 0.8, 1)), part(ico(0.62, 1), 0xeef5ff, T(0, 0.72, 0, 1.25, 0.45, 1.05))]);
  const mound = part(ico(1, 1), 0xe4eeff, T(0, 0.05, 0, 1.6, 0.45, 1.2));
  const snowTuft = join([part(ico(0.16, 0), 0xf4f8ff, T(0, 0.06, 0, 1.3, 0.6, 1)), part(cone(0.03, 0.34, 4), 0x8fa6c8, T(0.12, 0, 0, 1, 1, 1, -0.2))]);

  // ---------- desert ----------
  const hoodoo = join([
    part(cyl(0.7, 0.95, 1.5, 7), 0xb5653a),
    part(cyl(0.6, 0.7, 1.1, 7), 0xd08a4e, T(0, 1.5, 0)),
    part(cyl(0.48, 0.6, 1.0, 7), 0x9a4e30, T(0, 2.6, 0)),
    part(cyl(0.85, 0.5, 0.5, 7), 0xc2743f, T(0, 3.6, 0)),
    part(cyl(0.7, 0.85, 0.35, 7), 0xe09a58, T(0, 4.1, 0)),
  ]);
  const mesa = join([
    part(cyl(2.4, 3.0, 2.0, 8), 0xa85a36),
    part(cyl(2.2, 2.4, 1.4, 8), 0xc87c48, T(0, 2.0, 0)),
    part(cyl(2.3, 2.2, 0.5, 8), 0xe2a060, T(0, 3.4, 0)),
  ]);
  const cactus = join([
    part(cyl(0.2, 0.24, 2.0, 7), 0x4f8f52),
    part(cyl(0.13, 0.13, 0.6, 6), 0x4f8f52, T(0.25, 0.9, 0, 1, 1, 1, -Math.PI / 2)),
    part(cyl(0.13, 0.13, 0.8, 6), 0x5a9c5c, T(0.72, 0.84, 0)),
    part(cyl(0.12, 0.12, 0.5, 6), 0x4f8f52, T(-0.2, 1.2, 0, 1, 1, 1, Math.PI / 2)),
    part(cyl(0.12, 0.12, 0.6, 6), 0x5a9c5c, T(-0.62, 1.14, 0)),
  ]);
  const sandRock = join([part(new THREE.DodecahedronGeometry(0.7, 0), 0xc08a58, T(0, 0.28, 0, 1.3, 0.7, 1)), part(new THREE.DodecahedronGeometry(0.35, 0), 0xa87048, T(-0.7, 0.14, 0.2))]);
  const dryBush = join([part(ico(0.4, 0), 0xa8964e, T(0, 0.3, 0, 1.2, 0.8, 1)), part(cone(0.04, 0.6, 4), 0x8a7a40, T(0.2, 0, 0, 1, 1, 1, -0.4))]);

  // ---------- reef ----------
  const coralBranch = (c1: number, c2: number) => {
    const ps: Tpl[] = [part(cyl(0.16, 0.24, 0.8, 6), c1)];
    const tips: Tpl[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const lean = 0.5 + (i % 2) * 0.25;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * 0.12, 0.6, Math.sin(a) * 0.12),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * lean, 0, -Math.cos(a) * lean)),
        new THREE.Vector3(1, 1, 1),
      );
      ps.push(part(cyl(0.07, 0.12, 1.3 + (i % 3) * 0.3, 5), c1, m));
      const tm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.3 + (i % 3) * 0.3, 0));
      tips.push(part(ico(0.11, 0), c2, tm));
    }
    return { body: join(ps), tips: join(tips, true) };
  };
  const coralA = coralBranch(0xff6f91, 0xffc2d4);
  const coralB = coralBranch(0xff9a4a, 0xffe0a0);
  const coralC = coralBranch(0xa56cff, 0xd9c2ff);
  for (const c of [coralA, coralB, coralC]) companions.set(c.body, c.tips);
  const brain = join([part(ico(0.8, 1), 0xd9578a, T(0, 0.35, 0, 1.2, 0.7, 1.1)), part(ico(0.45, 1), 0xe873a0, T(0.8, 0.2, 0.1, 1, 0.7, 1))]);
  const kelp = join([
    part(new THREE.BoxGeometry(0.22, 2.2, 0.05).translate(0, 1.1, 0), 0x2f8a6a, T(0, 0, 0, 1, 1, 1, 0.1)),
    part(new THREE.BoxGeometry(0.2, 2.0, 0.05).translate(0, 1.0, 0), 0x3aa07a, T(0.05, 2.1, 0, 1, 1, 1, -0.22)),
    part(new THREE.BoxGeometry(0.16, 1.7, 0.05).translate(0, 0.85, 0), 0x46b488, T(-0.3, 3.9, 0, 1, 1, 1, 0.3)),
    part(new THREE.BoxGeometry(0.2, 2.6, 0.05).translate(0, 1.3, 0), 0x277a5e, T(0.5, 0, 0.2, 1, 1, 1, -0.12)),
  ]);
  const sponge = join([part(cyl(0.2, 0.14, 1.0, 7), 0xf2c84a), part(cyl(0.16, 0.11, 0.7, 7), 0xe8b23a, T(0.32, 0, 0.1)), part(cyl(0.13, 0.1, 0.5, 7), 0xf6d868, T(-0.26, 0, -0.1))]);
  const seaRock = join([part(new THREE.DodecahedronGeometry(0.8, 0), 0x2f6a72, T(0, 0.3, 0, 1.3, 0.7, 1)), part(ico(0.25, 0), 0x4adcb4, T(0.4, 0.7, 0.2))]);
  const seaGrass = join([
    part(new THREE.BoxGeometry(0.07, 0.7, 0.02).translate(0, 0.35, 0), 0x4adcb4, T(0, 0, 0, 1, 1, 1, 0.2)),
    part(new THREE.BoxGeometry(0.07, 0.9, 0.02).translate(0, 0.45, 0), 0x38b898, T(0.12, 0, 0, 1, 1, 1, -0.15)),
  ]);

  // ---------- crystal ----------
  const prism = (r: number, h: number, c: number, m: THREE.Matrix4) =>
    join([part(cyl(r, r, h, 6), c, m), part(cone(r, r * 1.6, 6), c, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, h, 0)), 1.25)]);
  const cluster = (c1: number, c2: number) =>
    join(
      [
        prism(0.34, 2.2, c1, T(0, 0, 0, 1, 1, 1, 0.08)),
        prism(0.24, 1.5, c2, T(0.5, 0, 0.1, 1, 1, 1, -0.45)),
        prism(0.2, 1.2, c1, T(-0.45, 0, -0.1, 1, 1, 1, 0.5)),
        prism(0.16, 0.9, c2, T(0.1, 0, 0.45, 1, 1, 1, 0, 0.5)),
      ],
      true,
    );
  const crystalA = cluster(0xa66cff, 0xd5a6ff);
  const crystalB = cluster(0x3fe0ff, 0xa6f2ff);
  const crystalC = cluster(0xff6fd0, 0xffb0e6);
  const stalag = join([part(cone(0.7, 2.6, 6), 0x4a3a66), part(cone(0.4, 1.4, 6), 0x5a4878, T(0.7, 0, 0.2))]);
  const caveRock = join([part(new THREE.DodecahedronGeometry(0.8, 0), 0x3a2e52, T(0, 0.3, 0, 1.3, 0.75, 1))]);
  const shroomStem = part(cyl(0.09, 0.13, 0.7, 6), 0xcfc6e8);
  const shroomCap = join([part(ico(0.38, 1), 0x4ff4dd, T(0, 0.74, 0, 1, 0.5, 1)), part(ico(0.22, 1), 0x8ffaea, T(0.4, 0.4, 0.1, 1, 0.5, 1))], true);
  companions.set(shroomStem, shroomCap);
  const shardlet = join([part(new THREE.OctahedronGeometry(0.16, 0), 0xc89cff, T(0, 0.2, 0, 0.6, 1.7, 0.6))], true);

  // ---------- volcanic ----------
  const hex = (r: number, h: number, x: number, z: number, c: number) => join([part(cyl(r, r, h, 6), c, T(x, 0, z)), part(cyl(r * 0.96, r * 0.96, 0.04, 6), 0x4a3a36, T(x, h, z))]);
  const basalt = join([
    hex(0.5, 3.0, 0, 0, 0x2c2224),
    hex(0.5, 2.3, 0.86, 0.1, 0x33282a),
    hex(0.5, 3.6, 0.43, -0.75, 0x261d1f),
    hex(0.5, 1.6, -0.86, 0.15, 0x3a2e30),
    hex(0.5, 2.6, -0.43, -0.75, 0x2f2426),
    hex(0.5, 1.1, 0.4, 0.8, 0x33282a),
  ]);
  const deadTree = join([
    part(cyl(0.1, 0.22, 2.6, 6), 0x1c1616, T(0, 0, 0, 1, 1, 1, 0.06)),
    part(cyl(0.04, 0.09, 1.3, 5), 0x1c1616, T(0.05, 1.5, 0, 1, 1, 1, -0.9)),
    part(cyl(0.04, 0.08, 1.1, 5), 0x1c1616, T(-0.02, 1.9, 0, 1, 1, 1, 0.8)),
    part(cyl(0.03, 0.06, 0.8, 5), 0x1c1616, T(0.1, 2.4, 0, 1, 1, 1, -0.35)),
  ]);
  const ashRock = join([part(new THREE.DodecahedronGeometry(0.8, 0), 0x2e2424, T(0, 0.3, 0, 1.3, 0.75, 1)), part(new THREE.DodecahedronGeometry(0.4, 0), 0x3a2c2a, T(0.75, 0.15, 0.2))]);
  const ventBody = part(cyl(0.5, 1.2, 1.3, 8), 0x2a1e1e);
  const ventGlow = join([part(cyl(0.44, 0.44, 0.06, 8), 0xff7a2a, T(0, 1.28, 0)), part(ico(0.16, 0), 0xffc060, T(0.1, 1.5, 0))], true);
  companions.set(ventBody, ventGlow);
  const lavaPool = join([part(cyl(1.5, 1.5, 0.05, 9), 0xff5a1e, T(0, 0.02, 0, 1, 1, 0.7)), part(cyl(0.8, 0.8, 0.07, 8), 0xffb040, T(0.2, 0.02, 0, 1, 1, 0.7))], true);
  const emberBit = join([part(new THREE.OctahedronGeometry(0.1, 0), 0xff8a3a, T(0, 0.1, 0))], true);
  const cinder = part(new THREE.DodecahedronGeometry(0.16, 0), 0x3a2a28, T(0, 0.08, 0));

  const E = (t: Tpl, weight: number, size: [number, number], near: number, far: number, sink = 0): Entry => ({ t, weight, size, near, far, sink });
  return {
    forest: {
      entries: [E(oak, 5, [0.8, 1.35], 5, 42), E(poplar, 2, [0.8, 1.25], 6, 42), E(pine, 3, [0.8, 1.45], 4.5, 42), E(bush, 5, [0.7, 1.4], 0.6, 30), E(rock, 2, [0.6, 1.5], 0.8, 40), E(stump, 1, [0.8, 1.2], 1, 16)],
      perChunk: 22,
      tufts: [grass, grass, grass, flower],
      tuftCount: 34,
    },
    snow: {
      entries: [E(snowPine, 6, [0.9, 1.8], 2.5, 42), E(shard, 2, [0.8, 1.8], 1.5, 40), E(snowRock, 3, [0.7, 1.6], 0.8, 40), E(mound, 3, [0.8, 2], 1, 40, 0.05)],
      perChunk: 22,
      tufts: [snowTuft],
      tuftCount: 16,
    },
    desert: {
      entries: [E(hoodoo, 3, [0.9, 2.2], 5, 42), E(mesa, 1.4, [1.2, 2.6], 16, 42), E(cactus, 4, [0.8, 1.5], 1.2, 36), E(sandRock, 4, [0.6, 1.6], 0.8, 40), E(dryBush, 4, [0.7, 1.3], 0.6, 30)],
      perChunk: 18,
      tufts: [dryBush],
      tuftCount: 8,
    },
    reef: {
      entries: [
        E(coralA.body, 3, [0.8, 1.8], 1.2, 40), E(coralB.body, 3, [0.8, 1.8], 1.2, 40), E(coralC.body, 2.5, [0.8, 2], 1.2, 40),
        E(brain, 3, [0.7, 1.6], 0.8, 36), E(kelp, 5, [0.9, 1.9], 2, 42), E(sponge, 2, [0.8, 1.5], 0.8, 30), E(seaRock, 3, [0.7, 1.8], 0.8, 40),
      ],
      perChunk: 28,
      tufts: [seaGrass],
      tuftCount: 30,
    },
    crystal: {
      entries: [E(crystalA, 4, [0.8, 2.2], 1.5, 42), E(crystalB, 3, [0.8, 2], 1.5, 42), E(crystalC, 2, [0.7, 1.8], 1.5, 42), E(stalag, 4, [0.8, 2.2], 2, 42), E(caveRock, 3, [0.7, 1.8], 0.8, 40), E(shroomStem, 3, [0.8, 1.6], 0.8, 24)],
      perChunk: 24,
      tufts: [shardlet],
      tuftCount: 12,
    },
    volcanic: {
      entries: [E(basalt, 4, [0.8, 1.9], 3, 42), E(deadTree, 3, [0.9, 1.6], 1.5, 40), E(ashRock, 4, [0.7, 1.8], 0.8, 40), E(ventBody, 1.5, [0.9, 1.7], 5, 40), E(lavaPool, 1.6, [0.8, 1.8], 4, 38, -0.02)],
      perChunk: 20,
      tufts: [cinder, cinder, emberBit],
      tuftCount: 16,
    },
  };
}

// Glow companions that ride on top of a lit template (coral tips, mushroom caps, vent mouths).
const companions = new Map<Tpl, Tpl>();
function ensureKits() {
  if (!kits) kits = makeKits();
}

function pickEntry(kit: Kit, r: number): Entry {
  const total = kit.entries.reduce((s, e) => s + e.weight, 0);
  let t = r * total;
  for (const e of kit.entries) {
    t -= e.weight;
    if (t <= 0) return e;
  }
  return kit.entries[kit.entries.length - 1];
}

export function buildDecor(track: Track, c: number, density: number): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  ensureKits();
  const solid = new Batch();
  const glow = new Batch();
  const rng = new Rng(0xabcd ^ (c * 2654435761));
  const x0 = c * CFG.chunkLen;
  const props = track.propsIn(x0 - 4, x0 + CFG.chunkLen + 4);
  const overBody = (x: number) =>
    props.some((p) => {
      if (p.kind === 'loop') {
        const g = loopGeom(p);
        return x > g.cx - g.r - 1.5 && x < g.cx + g.r + 1.5;
      }
      if (p.kind === 'bridge') {
        const g = bridgeGeom(p);
        return x > g.a - 1 && x < g.b + 1;
      }
      return false;
    });
  const kitAt = (x: number): Kit => {
    const bl = track.biomeAt(x);
    const w = bl.t > 0 && hash01(Math.round(x * 3), c, 91) < bl.t ? bl.b : bl.a; // dithered seam
    return kits![w.decor];
  };
  const place = (t: Tpl, x: number, y: number, z: number, s: number, ry: number, tint: number, tilt = 0) => {
    (t.glow ? glow : solid).add(t, x, y, z, s, ry, t.glow ? 1.25 : tint, s, tilt);
    const comp = companions.get(t);
    if (comp) glow.add(comp, x, y, z, s, ry, 1.3, s, tilt);
  };

  // Big dressing on the landscape behind the track.
  const kit0 = kitAt(x0 + CFG.chunkLen / 2);
  const count = Math.round(kit0.perChunk * density);
  for (let i = 0; i < count; i++) {
    const x = x0 + rng.next() * CFG.chunkLen;
    const kit = kitAt(x);
    const e = pickEntry(kit, rng.next());
    const depth = e.near + Math.pow(rng.next(), 1.35) * (e.far - e.near);
    const z = -TRACK_HALF - depth;
    const s = e.size[0] + rng.next() * (e.size[1] - e.size[0]);
    const ry = rng.next() * Math.PI * 2;
    const tint = 0.86 + rng.next() * 0.28;
    if (overBody(x) && depth < 3) continue;
    place(e.t, x, landY(track, x, z) - (e.sink ?? 0.06) * s, z, s * (1 + depth / 90), ry, tint);
  }
  // Shoulder tufts on both edges of the ribbon + a few on the camera-side lip.
  const tc = Math.round(kit0.tuftCount * density);
  for (let i = 0; i < tc; i++) {
    const x = x0 + rng.next() * CFG.chunkLen;
    const kit = kitAt(x);
    const t = kit.tufts[Math.floor(rng.next() * kit.tufts.length)];
    const front = rng.next() < 0.42;
    const z = front ? TRACK_HALF - 0.1 - rng.next() * 0.9 : -TRACK_HALF + 0.1 + rng.next() * 1.0 - (rng.next() < 0.4 ? 1.6 : 0);
    const s = 0.55 + rng.next() * 0.6;
    if (overBody(x) || props.some((p) => x > p.x - 0.6 && x < p.x + p.span + 0.6)) continue;
    const y = z < -TRACK_HALF ? landY(track, x, z) : track.height(x);
    place(t, x, y - 0.02, z, s, rng.next() * 6.28, 0.9 + rng.next() * 0.2, (rng.next() - 0.5) * 0.3);
  }
  return { solid: solid.geometry(), glow: glow.geometry() };
}
