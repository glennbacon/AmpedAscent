// Pickups: spinning 3D coins (instanced), glowing energy cells (instanced), and power-up tokens —
// hex medallions whose faces are the same drawn icons the HUD uses.

import * as THREE from 'three';
import { POWERUPS, POWERUP_KINDS, PowerupKind, isPowerupKind } from '../sim/powerups';
import { RunSim } from '../sim/run';
import { ICONS, POWERUP_ICON, iconDataUrl } from '../ui/icons';
import { canvasTexture, softSprite } from './gfx';

const MAX_COINS = 420;
const MAX_ENERGY = 60;

function iconTexture(kind: PowerupKind): THREE.Texture {
  // Token face: dark disc + the kind's icon in its own colour.
  const color = `#${POWERUPS[kind].color.toString(16).padStart(6, '0')}`;
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#12141b';
    g.fillRect(0, 0, 256, 256);
  });
  const img = new Image();
  img.onload = () => {
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(128, 110, 10, 128, 128, 150);
    gr.addColorStop(0, '#2a2f3d');
    gr.addColorStop(1, '#0d0f14');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    g.drawImage(img, 46, 46, 164, 164);
    tex.needsUpdate = true;
  };
  img.src = iconDataUrl(POWERUP_ICON[kind], color);
  void ICONS;
  return tex;
}

function coinFaceTexture(): THREE.Texture {
  return canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(54, 50, 6, 64, 64, 64);
    gr.addColorStop(0, '#fff3a8');
    gr.addColorStop(0.55, '#ffc928');
    gr.addColorStop(1, '#d98a08');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#b06a00';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#a05c00';
    g.beginPath();
    const pts = [[70, 22], [40, 70], [60, 70], [52, 106], [88, 54], [66, 54], [78, 22]];
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  });
}

interface Token {
  group: THREE.Group;
  kind: PowerupKind;
  id: number;
}

export class PickupsView {
  readonly group = new THREE.Group();
  private coins: THREE.InstancedMesh;
  private energy: THREE.InstancedMesh;
  private energyCore: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private tokens = new Map<number, Token>();
  private tokenPool = new Map<PowerupKind, THREE.Group[]>();
  private tokenMats = new Map<PowerupKind, THREE.Material[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    const face = coinFaceTexture();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc22a, roughness: 0.3, metalness: 0.9, emissive: 0x6a3c00, emissiveIntensity: 0.5 });
    const faceMat = new THREE.MeshStandardMaterial({ map: face, roughness: 0.35, metalness: 0.7, emissive: 0xffa400, emissiveIntensity: 0.25, emissiveMap: face });
    const cg = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 22).rotateX(Math.PI / 2);
    this.coins = new THREE.InstancedMesh(cg, [gold, faceMat, faceMat], MAX_COINS);
    this.coins.frustumCulled = false;

    // Energy cell: green glass canister with chrome caps and a hot core.
    const eg = new THREE.CylinderGeometry(0.3, 0.3, 0.84, 14, 1, false);
    const glass = new THREE.MeshStandardMaterial({ color: 0x3dff6e, roughness: 0.15, metalness: 0.1, emissive: 0x1ed84a, emissiveIntensity: 0.9, transparent: true, opacity: 0.82 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x9aa4b8, roughness: 0.25, metalness: 1 });
    this.energy = new THREE.InstancedMesh(eg, [glass, cap, cap], MAX_ENERGY);
    this.energy.frustumCulled = false;
    const boltShape = new THREE.Shape();
    [[0.05, 0.3], [-0.14, -0.02], [-0.02, -0.02], [-0.08, -0.3], [0.14, 0.04], [0.02, 0.04], [0.1, 0.3]].forEach(([x, y], i) =>
      i ? boltShape.lineTo(x, y) : boltShape.moveTo(x, y),
    );
    const bg = new THREE.ExtrudeGeometry(boltShape, { depth: 0.66, bevelEnabled: false }).translate(0, 0, -0.33);
    this.energyCore = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0xf4ffd8, toneMapped: false }), MAX_ENERGY);
    this.energyCore.frustumCulled = false;

    this.glows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: softSprite(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55 }),
      MAX_ENERGY + 24,
    );
    this.glows.frustumCulled = false;
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((MAX_ENERGY + 24) * 3), 3);
    this.glows.renderOrder = 1;
    this.group.add(this.coins, this.energy, this.energyCore, this.glows);
  }

  clear() {
    for (const t of this.tokens.values()) this.release(t);
    this.tokens.clear();
    this.coins.count = this.energy.count = this.energyCore.count = this.glows.count = 0;
  }

  private release(t: Token) {
    this.group.remove(t.group);
    let pool = this.tokenPool.get(t.kind);
    if (!pool) this.tokenPool.set(t.kind, (pool = []));
    pool.push(t.group);
  }

  private makeToken(kind: PowerupKind): THREE.Group {
    const pooled = this.tokenPool.get(kind)?.pop();
    if (pooled) return pooled;
    let mats = this.tokenMats.get(kind);
    if (!mats) {
      const color = POWERUPS[kind].color;
      const tex = iconTexture(kind);
      const rim = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.8, emissive: color, emissiveIntensity: 0.9 });
      const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      mats = [rim, faceMat, faceMat];
      this.tokenMats.set(kind, mats);
    }
    const g = new THREE.Group();
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.2, 6).rotateX(Math.PI / 2), mats);
    hex.rotation.z = Math.PI / 6;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.035, 6, 32),
      new THREE.MeshBasicMaterial({ color: POWERUPS[kind].color, toneMapped: false }),
    );
    g.add(hex, ring);
    g.userData.ring = ring;
    g.userData.hex = hex;
    return g;
  }

  update(sim: RunSim, time: number, focusX: number) {
    let nc = 0;
    let ne = 0;
    let ng = 0;
    const live = new Set<number>();
    const camX = focusX;
    for (const p of sim.pickups) {
      if (Math.abs(p.x - camX) > 120) continue;
      let y = p.y;
      let scale = 1;
      if (p.rain) {
        // Frenzy coins drop in from above, one after another.
        const t = (sim.time - p.bornAt) / 0.5;
        if (t < 0) continue;
        if (t < 1) {
          y += (1 - t) * (1 - t) * 9;
          scale = 0.6 + t * 0.4;
        }
      }
      if (p.kind === 'coin') {
        if (nc >= MAX_COINS) continue;
        this.e.set(0, time * 3.2 + p.x * 0.7, 0);
        this.m.compose(this.p.set(p.x, y + Math.sin(time * 2.4 + p.x) * 0.06, 0), this.q.setFromEuler(this.e), this.s.setScalar(scale));
        this.coins.setMatrixAt(nc++, this.m);
      } else if (p.kind === 'energy') {
        if (ne >= MAX_ENERGY) continue;
        const bob = Math.sin(time * 2 + p.x * 0.5) * 0.12;
        this.e.set(0, time * 1.6 + p.x, 0.28);
        this.m.compose(this.p.set(p.x, y + bob, 0), this.q.setFromEuler(this.e), this.s.setScalar(1));
        this.energy.setMatrixAt(ne, this.m);
        this.energyCore.setMatrixAt(ne, this.m);
        ne++;
        const pulse = 2.5 + Math.sin(time * 5 + p.x) * 0.35;
        this.m.compose(this.p.set(p.x, y + bob, -0.3), this.q.identity(), this.s.setScalar(pulse));
        this.glows.setMatrixAt(ng, this.m);
        this.glows.setColorAt(ng++, this.c.setHex(0x3dff6e));
      } else if (isPowerupKind(p.kind)) {
        live.add(p.id);
        let t = this.tokens.get(p.id);
        if (!t) {
          t = { group: this.makeToken(p.kind), kind: p.kind, id: p.id };
          this.tokens.set(p.id, t);
          this.group.add(t.group);
        }
        const bob = Math.sin(time * 2.2 + p.x) * 0.16;
        t.group.position.set(p.x, y + bob, 0);
        t.group.rotation.y = Math.sin(time * 1.5 + p.x) * 0.55;
        const ring = t.group.userData.ring as THREE.Mesh;
        ring.rotation.z = time * 1.2;
        ring.scale.setScalar(1 + Math.sin(time * 4 + p.x) * 0.06);
        if (ng < MAX_ENERGY + 24) {
          this.m.compose(this.p.set(p.x, y + bob, -0.4), this.q.identity(), this.s.setScalar(3.6));
          this.glows.setMatrixAt(ng, this.m);
          this.glows.setColorAt(ng++, this.c.setHex(POWERUPS[p.kind].color));
        }
      }
    }
    for (const [id, t] of this.tokens) {
      if (!live.has(id)) {
        this.release(t);
        this.tokens.delete(id);
      }
    }
    this.coins.count = nc;
    this.energy.count = ne;
    this.energyCore.count = ne;
    this.glows.count = ng;
    this.coins.instanceMatrix.needsUpdate = true;
    this.energy.instanceMatrix.needsUpdate = true;
    this.energyCore.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
  }
}

export { POWERUP_KINDS };
