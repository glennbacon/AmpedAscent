// Terrain view: per-chunk meshes that follow the SAME sample points as the physics chain.
// Each chunk = a smooth-shaded track ribbon with a cut-away soil face toward the camera, a
// faceted landscape rolling away behind it, an optional glowing rim, and biome decor.

import * as THREE from 'three';
import { CFG, lerp, smoothstep } from '../sim/config';
import { PhysWorld } from '../sim/physics';
import { hash01 } from '../sim/rng';
import { Track } from '../sim/track';
import { WorldDef } from '../sim/worlds';
import { buildDecor } from './decor';

export const TRACK_HALF = 3.3; // half-width of the drivable ribbon
const FACE_Z = 3.62;
const LAND_ROWS = [-3.15, -5.2, -8, -12, -17.5, -24.5, -34, -46];
const LAND_STEP = 2;
const FACE_DEPTHS = [0.22, 0.95, 2.6, 6.5, 14, 60];

const _a = new THREE.Color();
const _b = new THREE.Color();
function blendColor(track: Track, x: number, pick: (w: WorldDef) => number, out: THREE.Color): THREE.Color {
  const bl = track.biomeAt(x);
  _a.setHex(pick(bl.a));
  if (bl.t <= 0) return out.copy(_a);
  _b.setHex(pick(bl.b));
  return out.copy(_a).lerp(_b, bl.t);
}

/** Height of the landscape behind the track (z < −TRACK_HALF). Shared with decor placement. */
export function landY(track: Track, x: number, z: number): number {
  const h = track.height(x);
  const d = -z - 3.15;
  if (d <= 0) return h;
  const w = smoothstep(d / 15);
  const avg = (track.base(x - 14) + track.base(x) + track.base(x + 14)) / 3;
  const amp = 0.5 + (d / 43) * 2.4;
  const roll =
    Math.sin(x / 21 + z / 6.5) * 1.5 + Math.sin(x / 9.5 - z / 12 + 1.7) * 0.8 + Math.sin(x / 47 + z / 19 + 0.6) * 2.2;
  const land = avg * 0.6 + h * 0.4 + d * 0.035 - 0.6 * w + roll * amp * 0.42;
  return lerp(h - 0.03, land, w);
}

interface ChunkView {
  group: THREE.Group;
}

export class TerrainView {
  readonly group = new THREE.Group();
  private chunks = new Map<number, ChunkView>();
  private surfaceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  private landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private decorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  private track: Track | null = null;
  decorDensity = 1;

  setTrack(track: Track) {
    this.clear();
    this.track = track;
  }

  /** Swap the track without dropping built chunks (editor: only the edited span is invalidated). */
  replaceTrack(track: Track) {
    this.track = track;
  }

  clear() {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
  }

  private disposeChunk(c: ChunkView) {
    this.group.remove(c.group);
    c.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }

  /** Rebuild a span after the track changed under it (level editor). */
  invalidate(x0: number, x1: number) {
    const c0 = Math.floor(x0 / CFG.chunkLen) - 1;
    const c1 = Math.floor(x1 / CFG.chunkLen) + 1;
    for (let c = c0; c <= c1; c++) {
      const v = this.chunks.get(c);
      if (v) {
        this.disposeChunk(v);
        this.chunks.delete(c);
      }
    }
  }

  sync(centerX: number, behind = 130, ahead = 165) {
    const track = this.track;
    if (!track) return;
    const c0 = Math.floor((centerX - behind) / CFG.chunkLen);
    const c1 = Math.floor((centerX + ahead) / CFG.chunkLen);
    for (const [c, v] of this.chunks) {
      if (c < c0 - 1 || c > c1 + 1) {
        this.disposeChunk(v);
        this.chunks.delete(c);
      }
    }
    // Build at most two chunks per call so a fresh world streams in without a hitch.
    let built = 0;
    for (let c = c0; c <= c1 && built < 2; c++) {
      if (this.chunks.has(c)) continue;
      this.chunks.set(c, this.buildChunk(track, c));
      built++;
    }
  }

  /** Build everything in range now (first frame of a new world). */
  syncAll(centerX: number) {
    for (let i = 0; i < 12; i++) this.sync(centerX);
  }

  private buildChunk(track: Track, c: number): ChunkView {
    const group = new THREE.Group();
    const xs = PhysWorld.chunkXs(track, c);
    const n = xs.length;
    const col = new THREE.Color();
    const col2 = new THREE.Color();

    // ---- surface: ribbon top (6 verts) + lip + soil face (6 verts) per sample ----
    const topZ = [-TRACK_HALF, -2.05, -1.45, 1.45, 2.05, TRACK_HALF];
    const per = topZ.length + FACE_DEPTHS.length;
    const pos = new Float32Array(n * per * 3);
    const nor = new Float32Array(n * per * 3);
    const colr = new Float32Array(n * per * 3);
    let anyGlow = false;
    const glowPos: number[] = [];
    const glowCol: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const h = track.height(x);
      const slope = (track.height(x + 0.2) - track.height(x - 0.2)) / 0.4;
      const inv = 1 / Math.hypot(slope, 1);
      const nx = -slope * inv;
      const ny = inv;
      const noise = hash01(Math.round(x * 2), 77) * 0.6 + (Math.sin(x * 0.37) * 0.5 + 0.5) * 0.4;
      blendColor(track, x, (w) => w.ground.top, col).lerp(blendColor(track, x, (w) => w.ground.topAlt, col2), noise);
      const side = blendColor(track, x, (w) => w.ground.side, new THREE.Color());
      const deep = blendColor(track, x, (w) => w.ground.deep, new THREE.Color());
      const rim = blendColor(track, x, (w) => w.ground.rim, new THREE.Color());
      const road = col.clone().lerp(side, 0.5).multiplyScalar(0.92);
      let o = i * per * 3;
      for (let k = 0; k < topZ.length; k++) {
        pos[o] = x;
        pos[o + 1] = h;
        pos[o + 2] = topZ[k];
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = 0;
        const cc = k === 2 || k === 3 ? road : k === 5 ? rim.clone().lerp(col, 0.6) : col;
        colr[o] = cc.r;
        colr[o + 1] = cc.g;
        colr[o + 2] = cc.b;
        o += 3;
      }
      for (let k = 0; k < FACE_DEPTHS.length; k++) {
        const d = FACE_DEPTHS[k];
        pos[o] = x;
        pos[o + 1] = h - d;
        pos[o + 2] = k === 0 ? TRACK_HALF + 0.24 : FACE_Z;
        nor[o] = 0;
        nor[o + 1] = k === 0 ? 0.6 : 0;
        nor[o + 2] = k === 0 ? 0.8 : 1;
        // Strata: bright lip, then soil banding down to the deep tone.
        let cc: THREE.Color;
        if (k === 0) cc = rim.clone().lerp(col, 0.6).multiplyScalar(0.82);
        else if (k === 1) cc = side.clone().multiplyScalar(1.18);
        else if (k === 2) cc = side.clone().multiplyScalar(0.86 + hash01(Math.round(x), 5) * 0.1);
        else if (k === 3) cc = side.clone().lerp(deep, 0.55);
        else cc = deep;
        colr[o] = cc.r;
        colr[o + 1] = cc.g;
        colr[o + 2] = cc.b;
        o += 3;
      }
      // Glowing rim (lava edge, bioluminescent seagrass…).
      const bl = track.biomeAt(x);
      const g = lerp(bl.a.ground.rimGlow, bl.b.ground.rimGlow, bl.t);
      if (g > 0.01) anyGlow = true;
      glowPos.push(x, h + 0.015, TRACK_HALF + 0.03, x, h - 0.2, TRACK_HALF + 0.27);
      for (let k = 0; k < 2; k++) glowCol.push(rim.r * g * 1.6, rim.g * g * 1.6, rim.b * g * 1.6);
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * per;
      const b = (i + 1) * per;
      for (let k = 0; k < per - 1; k++) idx.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    sg.setIndex(idx);
    const surface = new THREE.Mesh(sg, this.surfaceMat);
    surface.receiveShadow = true;
    group.add(surface);

    if (anyGlow) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
      gg.setAttribute('color', new THREE.Float32BufferAttribute(glowCol, 3));
      const gi: number[] = [];
      for (let i = 0; i < n - 1; i++) gi.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
      gg.setIndex(gi);
      group.add(new THREE.Mesh(gg, this.glowMat));
    }

    // ---- land: coarse faceted heightfield rolling away behind the track ----
    const x0 = c * CFG.chunkLen;
    const cols = Math.round(CFG.chunkLen / LAND_STEP) + 1;
    const rows = LAND_ROWS.length;
    const lp = new Float32Array(cols * rows * 3);
    const lc = new Float32Array(cols * rows * 3);
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * LAND_STEP;
      for (let r = 0; r < rows; r++) {
        const z = LAND_ROWS[r];
        const o = (i * rows + r) * 3;
        lp[o] = x;
        lp[o + 1] = landY(track, x, z) - (r === 0 ? 0.04 : 0);
        lp[o + 2] = z;
        const nz = hash01(Math.round(x), r, 31);
        blendColor(track, x, (w) => w.ground.top, col).lerp(blendColor(track, x, (w) => w.ground.topAlt, col2), nz);
        col.multiplyScalar(0.96 - (r / rows) * 0.2 + nz * 0.06);
        lc[o] = col.r;
        lc[o + 1] = col.g;
        lc[o + 2] = col.b;
      }
    }
    const li: number[] = [];
    for (let i = 0; i < cols - 1; i++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = i * rows + r;
        const b = (i + 1) * rows + r;
        li.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    lg.setIndex(li);
    lg.computeVertexNormals();
    const land = new THREE.Mesh(lg, this.landMat);
    land.receiveShadow = true;
    group.add(land);

    // ---- decor ----
    const decor = buildDecor(track, c, this.decorDensity);
    if (decor.solid) {
      const m = new THREE.Mesh(decor.solid, this.decorMat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    if (decor.glow) group.add(new THREE.Mesh(decor.glow, this.glowMat));

    this.group.add(group);
    return { group };
  }
}
