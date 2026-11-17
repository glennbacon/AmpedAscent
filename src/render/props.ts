// Track furniture: ramps, whoops and half-pipes as built "electric rail" decks over the terrain;
// the corkscrew loop; the plank bridge (follows its physics bodies); the finish gate; smash rubble.

import * as THREE from 'three';
import { TAU, lerp } from '../sim/config';
import { PhysWorld } from '../sim/physics';
import { RunSim } from '../sim/run';
import { bridgeGeom, loopGeom, PlacedProp, PROP, rampGeom, Track } from '../sim/track';
import { canvasTexture } from './gfx';
import { TRACK_HALF } from './terrain';
import { ACCENT } from './vehicleModel';

const DECK = 0x2b2f38;

interface PropView {
  group: THREE.Group;
  prop: PlacedProp;
  planks?: THREE.InstancedMesh;
  ropes?: THREE.Line[];
  loopMesh?: THREE.Group;
  chevrons?: THREE.Mesh[];
}

/** Flat ribbon across z following a height function. */
function ribbon(xs: number[], y: (x: number) => number, z0: number, z1: number, lift: number): THREE.BufferGeometry {
  const n = xs.length;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const h = y(x) + lift;
    const s = (y(x + 0.15) - y(x - 0.15)) / 0.3;
    const inv = 1 / Math.hypot(s, 1);
    pos.set([x, h, z0, x, h, z1], i * 6);
    nor.set([-s * inv, inv, 0, -s * inv, inv, 0], i * 6);
    uv.set([(x - xs[0]) / 2, 0, (x - xs[0]) / 2, 1], i * 4);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Vertical skirt on the camera side from the deck down to `bottom(x)`. */
function skirt(xs: number[], top: (x: number) => number, bottom: (x: number) => number, z: number): THREE.BufferGeometry {
  const n = xs.length;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    pos.set([x, top(x), z, x, Math.min(bottom(x), top(x) - 0.05), z], i * 6);
    nor.set([0, 0, 1, 0, 0, 1], i * 6);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  const n = Math.max(2, Math.ceil((b - a) / step));
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
};

export class PropsView {
  readonly group = new THREE.Group();
  private views = new Map<number, PropView>();
  private track: Track | null = null;
  private deckMat = new THREE.MeshStandardMaterial({ color: DECK, roughness: 0.55, metalness: 0.55, side: THREE.DoubleSide });
  private structMat = new THREE.MeshStandardMaterial({ color: 0x4a5162, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide });
  private neonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ACCENT).multiplyScalar(1.7), toneMapped: false, side: THREE.DoubleSide });
  private woodMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.85 });
  private hazardMat: THREE.MeshStandardMaterial;
  private debris: THREE.Mesh[] = [];
  private finish: THREE.Group | null = null;

  constructor() {
    const hz = canvasTexture(64, 64, (g) => {
      g.fillStyle = '#ffd21f';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#16181d';
      for (let i = -64; i < 128; i += 32) {
        g.beginPath();
        g.moveTo(i, 64);
        g.lineTo(i + 16, 64);
        g.lineTo(i + 80, 0);
        g.lineTo(i + 64, 0);
        g.fill();
      }
    });
    hz.wrapS = hz.wrapT = THREE.RepeatWrapping;
    hz.repeat.set(6, 1);
    this.hazardMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6 });
  }

  setSim(sim: RunSim) {
    for (const v of this.views.values()) this.dispose(v);
    this.views.clear();
    for (const d of this.debris) this.group.remove(d);
    this.debris = [];
    if (this.finish) {
      this.group.remove(this.finish);
      this.finish = null;
    }
    this.track = sim.track;
    if (sim.track.length != null) {
      this.finish = this.buildFinish(sim.track, sim.track.length);
      this.group.add(this.finish);
    }
  }

  /** Drop cached visuals overlapping a span (level editor moved a prop / reshaped the ground). */
  invalidate() {
    for (const v of this.views.values()) this.dispose(v);
    this.views.clear();
  }

  private dispose(v: PropView) {
    this.group.remove(v.group);
    v.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = mat !== this.neonMat;
    return m;
  }

  private buildOverlay(track: Track, p: PlacedProp): PropView {
    const group = new THREE.Group();
    const h = (x: number) => track.height(x);
    let x0 = p.x;
    let x1 = p.x + p.span;
    let bottom: (x: number) => number = (x) => h(x) - 0.7;
    const chevrons: THREE.Mesh[] = [];
    if (p.kind === 'ramp') {
      const g = rampGeom(p);
      x0 = g.kickStart - 0.4;
      x1 = g.lipX;
      bottom = () => p.seatY - 0.3;
      // Lip end-wall with hazard stripes.
      const wall = this.mesh(new THREE.PlaneGeometry(TRACK_HALF * 2, g.h + 0.3).rotateY(Math.PI / 2), this.hazardMat, true);
      wall.position.set(g.lipX + 0.02, p.seatY + (g.h - 0.3) / 2, 0);
      group.add(wall);
      // Launch chevrons painted up the deck.
      for (let i = 0; i < 3; i++) {
        const cx = g.kickStart + g.span * (0.3 + i * 0.22);
        const sh = new THREE.Shape();
        sh.moveTo(-0.5, -1.3);
        sh.lineTo(0.25, 0);
        sh.lineTo(-0.5, 1.3);
        sh.lineTo(-0.15, 1.3);
        sh.lineTo(0.6, 0);
        sh.lineTo(-0.15, -1.3);
        sh.closePath();
        const m = this.mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), this.neonMat.clone());
        const slope = (h(cx + 0.2) - h(cx - 0.2)) / 0.4;
        m.position.set(cx, h(cx) + 0.07, 0);
        m.rotation.z = Math.atan(slope);
        chevrons.push(m);
        group.add(m);
      }
    }
    const xs = range(x0, x1, 0.3);
    group.add(this.mesh(ribbon(xs, h, -TRACK_HALF, TRACK_HALF + 0.26, 0.035), this.deckMat));
    group.add(this.mesh(skirt(xs, (x) => h(x) + 0.03, bottom, TRACK_HALF + 0.3), this.deckMat));
    // Neon rails along both edges of the deck.
    group.add(this.mesh(ribbon(xs, h, TRACK_HALF + 0.12, TRACK_HALF + 0.3, 0.06), this.neonMat));
    group.add(this.mesh(ribbon(xs, h, -TRACK_HALF, -TRACK_HALF + 0.16, 0.06), this.neonMat));
    if (p.kind === 'halfpipe') {
      // Coping blocks at each end of the pipe.
      for (const x of [p.x, p.x + p.span]) {
        const b = this.mesh(new THREE.BoxGeometry(0.5, 0.16, TRACK_HALF * 2 + 0.5), this.structMat, true);
        b.position.set(x, h(x) + 0.05, 0.12);
        group.add(b);
      }
    }
    this.group.add(group);
    return { group, prop: p, chevrons };
  }

  private buildLoop(p: PlacedProp): PropView {
    const group = new THREE.Group();
    const g = loopGeom(p);
    const N = 96;
    const half = 1.38;
    const thick = 0.42;
    const inner: number[] = [];
    const innerN: number[] = [];
    const outer: number[] = [];
    const outerN: number[] = [];
    const sideA: number[] = [];
    const sideB: number[] = [];
    const railA: number[] = [];
    const railB: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = -Math.PI / 2 + t * TAU;
      const zc = lerp(1.15, -1.15, t);
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      const ix = g.cx + cx * g.r;
      const iy = g.cy + sy * g.r;
      const ox = g.cx + cx * (g.r + thick);
      const oy = g.cy + sy * (g.r + thick);
      inner.push(ix, iy, zc - half, ix, iy, zc + half);
      innerN.push(-cx, -sy, 0, -cx, -sy, 0);
      outer.push(ox, oy, zc + half, ox, oy, zc - half);
      outerN.push(cx, sy, 0, cx, sy, 0);
      sideA.push(ix, iy, zc + half, ox, oy, zc + half);
      sideB.push(ox, oy, zc - half, ix, iy, zc - half);
      const rx = g.cx + cx * (g.r - 0.05);
      const ry = g.cy + sy * (g.r - 0.05);
      railA.push(rx, ry, zc + half - 0.16, rx, ry, zc + half);
      railB.push(rx, ry, zc - half, rx, ry, zc - half + 0.16);
    }
    const strip = (v: number[], n?: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      const idx: number[] = [];
      for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
      geo.setIndex(idx);
      if (n) geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
      else geo.computeVertexNormals();
      return geo;
    };
    const ring = new THREE.Group();
    ring.add(this.mesh(strip(inner, innerN), this.deckMat), this.mesh(strip(outer, outerN), this.structMat, true));
    ring.add(this.mesh(strip(sideA), this.structMat), this.mesh(strip(sideB), this.structMat));
    ring.add(this.mesh(strip(railA), this.neonMat), this.mesh(strip(railB), this.neonMat));
    // Rear A-frame: two legs up to a crown beam, plus stays to the ring.
    const leg = (x0: number, x1: number, y1: number, z: number) => {
      const a = new THREE.Vector3(x0, g.groundY - 0.3, z);
      const b = new THREE.Vector3(x1, y1, z);
      const d = new THREE.Vector3().subVectors(b, a);
      const m = this.mesh(new THREE.CylinderGeometry(0.17, 0.2, d.length(), 8), this.structMat, true);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      ring.add(m);
    };
    const topY = g.cy + g.r + thick + 0.5;
    for (const z of [-2.75]) {
      leg(g.cx - g.r - 2.2, g.cx - 0.6, topY, z);
      leg(g.cx + g.r + 2.2, g.cx + 0.6, topY, z);
      leg(g.cx - g.r * 0.62, g.cx - g.r * 0.62, g.cy - g.r * 0.2, z);
      leg(g.cx + g.r * 0.62, g.cx + g.r * 0.62, g.cy - g.r * 0.2, z);
    }
    const crown = this.mesh(new THREE.BoxGeometry(2.4, 0.5, 1.9), this.structMat, true);
    crown.position.set(g.cx, topY, -1.9);
    const beacon = this.mesh(new THREE.BoxGeometry(2.0, 0.14, 0.14), this.neonMat);
    beacon.position.set(g.cx, topY + 0.34, -1.0);
    ring.add(crown, beacon);
    group.add(ring);
    this.group.add(group);
    return { group, prop: p, loopMesh: ring };
  }

  private buildBridge(p: PlacedProp): PropView {
    const group = new THREE.Group();
    const g = bridgeGeom(p);
    const width = TRACK_HALF * 2 + 0.2;
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.24, width), this.woodMat, PROP.bridgePlanks);
    planks.castShadow = true;
    planks.receiveShadow = true;
    planks.frustumCulled = false;
    group.add(planks);
    for (const x of [g.a, g.b]) {
      for (const z of [-TRACK_HALF - 0.1, TRACK_HALF + 0.3]) {
        const post = this.mesh(new THREE.BoxGeometry(0.34, 2.3, 0.34), this.deckMat, true);
        post.position.set(x, g.deckY + 0.75, z);
        const cap = this.mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), this.neonMat);
        cap.position.set(x, g.deckY + 1.95, z);
        group.add(post, cap);
      }
    }
    const ropes: THREE.Line[] = [];
    for (const z of [-TRACK_HALF - 0.1, TRACK_HALF + 0.3]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PROP.bridgePlanks + 2) * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe8dcc0 }));
      line.userData.z = z;
      line.frustumCulled = false;
      ropes.push(line);
      group.add(line);
    }
    this.group.add(group);
    return { group, prop: p, planks, ropes };
  }

  private buildFinish(track: Track, x: number): THREE.Group {
    const g = new THREE.Group();
    const y = track.height(x);
    const checker = canvasTexture(256, 64, (c) => {
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 4; j++) {
          c.fillStyle = (i + j) % 2 ? '#f4f6fa' : '#15171c';
          c.fillRect(i * 16, j * 16, 16, 16);
        }
      }
    });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.6, TRACK_HALF * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 }));
    (strip.material as THREE.MeshStandardMaterial).map!.rotation = Math.PI / 2;
    strip.position.set(x, y + 0.04, 0);
    g.add(strip);
    const banner = canvasTexture(512, 128, (c) => {
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 8; j++) {
          c.fillStyle = (i + j) % 2 ? '#f4f6fa' : '#15171c';
          c.fillRect(i * 16, j * 16, 16, 16);
        }
      }
      c.fillStyle = '#15171c';
      c.fillRect(96, 26, 320, 76);
      c.fillStyle = '#28e0ff';
      c.font = 'bold 62px "Chakra Petch", Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('FINISH', 256, 66);
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: banner, toneMapped: false }));
    board.position.set(x, y + 6.2, -TRACK_HALF - 0.6);
    g.add(board);
    for (const dx of [-3.8, 3.8]) {
      const post = this.mesh(new THREE.CylinderGeometry(0.16, 0.2, 7.4, 8), this.structMat, true);
      post.position.set(x + dx, y + 3.5, -TRACK_HALF - 0.7);
      g.add(post);
    }
    // Gantry over the track, seen edge-on: reads as depth.
    for (const z of [-TRACK_HALF - 0.4, TRACK_HALF + 0.5]) {
      const post = this.mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), this.deckMat, true);
      post.position.set(x, y + 2.3, z);
      g.add(post);
    }
    const beam = this.mesh(new THREE.BoxGeometry(0.36, 0.36, TRACK_HALF * 2 + 1.3), this.deckMat, true);
    beam.position.set(x, y + 4.7, 0.05);
    const glow = this.mesh(new THREE.BoxGeometry(0.1, 0.1, TRACK_HALF * 2 + 1.3), this.neonMat);
    glow.position.set(x, y + 4.46, 0.05);
    g.add(beam, glow);
    return g;
  }

  update(sim: RunSim, focusX: number, time: number) {
    const track = this.track;
    if (!track) return;
    const cx = focusX;
    const live = new Set<number>();
    for (const p of track.propsIn(cx - 135, cx + 170)) {
      live.add(p.index);
      if (!this.views.has(p.index)) {
        const v = p.kind === 'loop' ? this.buildLoop(p) : p.kind === 'bridge' ? this.buildBridge(p) : this.buildOverlay(track, p);
        this.views.set(p.index, v);
      }
    }
    for (const [i, v] of this.views) {
      if (!live.has(i)) {
        this.dispose(v);
        this.views.delete(i);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const v of this.views.values()) {
      if (v.chevrons) {
        v.chevrons.forEach((c, i) => {
          const ph = (time * 2.2 - i * 0.45) % 3;
          (c.material as THREE.MeshBasicMaterial).color.setHex(ACCENT).multiplyScalar(0.5 + Math.max(0, 1 - Math.abs(ph - 0.5) * 2) * 1.6);
        });
      }
      if (v.loopMesh) {
        const lb = sim.phys.loops.get(v.prop.index);
        v.loopMesh.visible = !(lb && lb.smashed);
      }
      if (v.planks && v.ropes) {
        const bb = sim.phys.bridges.get(v.prop.index);
        const pts = PhysWorld.bridgeDeckPoints(v.prop);
        const g = bridgeGeom(v.prop);
        for (let i = 0; i < PROP.bridgePlanks; i++) {
          let x = (pts[i].x + pts[i + 1].x) / 2;
          let y = (pts[i].y + pts[i + 1].y) / 2 - 0.12;
          let a = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
          let len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
          if (bb) {
            const b = bb.planks[i];
            x = b.getPosition().x;
            y = b.getPosition().y;
            a = b.getAngle();
            len = bb.plankLen[i];
          }
          e.set(0, 0, a);
          m.compose(new THREE.Vector3(x, y, 0.1), q.setFromEuler(e), new THREE.Vector3(len * 0.94, 1, 1));
          v.planks.setMatrixAt(i, m);
          for (const r of v.ropes) {
            const arr = (r.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
            arr.set([x, y + 1.05, r.userData.z], (i + 1) * 3);
          }
        }
        v.planks.instanceMatrix.needsUpdate = true;
        for (const r of v.ropes) {
          const attr = r.geometry.attributes.position as THREE.BufferAttribute;
          const arr = attr.array as Float32Array;
          arr.set([g.a, g.deckY + 1.9, r.userData.z], 0);
          arr.set([g.b, g.deckY + 1.9, r.userData.z], (PROP.bridgePlanks + 1) * 3);
          attr.needsUpdate = true;
        }
      }
    }
    // Rubble: one box per debris body.
    const ds = sim.phys.debris;
    while (this.debris.length < ds.length) {
      const d = ds[this.debris.length];
      const mesh = this.mesh(new THREE.BoxGeometry(d.w, d.h, 2.6), d.kind === 0 ? this.structMat : this.deckMat, true);
      this.group.add(mesh);
      this.debris.push(mesh);
    }
    while (this.debris.length > ds.length) this.group.remove(this.debris.pop()!);
    for (let i = 0; i < ds.length; i++) {
      const b = ds[i].body;
      this.debris[i].position.set(b.getPosition().x, b.getPosition().y, (i % 5) * 0.5 - 1);
      this.debris[i].rotation.z = b.getAngle();
    }
  }
}
