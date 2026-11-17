// The hero car: a low-poly rally EV buggy built entirely from code — tub with neon livery, roll
// cage, driver, long-travel suspension, chunky tyres. Physics is 2D; the model gives it width.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from '../sim/config';
import { Vehicle } from '../sim/vehicle';
import { canvasTexture, softSprite } from './gfx';

export const ACCENT = 0x28e0ff; // the game's neon — shared by the car, props and UI
const PAINT = 0xe2202c;
const HALF_TRACK = 0.95; // wheel centre z

interface Bucket {
  mat: THREE.Material;
  geos: THREE.BufferGeometry[];
}

/** Collects geometry per material, then merges: a few draw calls instead of a hundred. */
class Builder {
  private buckets = new Map<string, Bucket>();
  constructor(private mats: Record<string, THREE.Material>) {}
  add(key: string, geo: THREE.BufferGeometry, m?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g = g.clone().applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat: this.mats[key], geos: [] }));
    b.geos.push(g);
  }
  box(key: string, w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, rx = 0) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(key, new THREE.BoxGeometry(w, h, d), m);
  }
  /** Cylinder between two points. */
  rod(key: string, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.add(key, new THREE.CylinderGeometry(r, r, len, seg), m);
  }
  tube(key: string, pts: [number, number, number][], r: number, seg = 24) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.35);
    this.add(key, new THREE.TubeGeometry(curve, seg, r, 7, false));
  }
  build(into: THREE.Object3D, shadow = true) {
    for (const b of this.buckets.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(b.geos, false)!, b.mat);
      mesh.castShadow = shadow && !(b.mat as any).transparent && !(b.mat instanceof THREE.MeshBasicMaterial);
      mesh.receiveShadow = false;
      into.add(mesh);
    }
  }
}

function liveryTexture(): THREE.Texture {
  // 3.6 m × 0.9 m of bodywork: hot red with neon rally splatter and a bolt on the door.
  return canvasTexture(1024, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#f2333c');
    grad.addColorStop(1, '#b3121f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 256);
    const stripe = (x: number, w: number, color: string, skew = 150) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, 256);
      g.lineTo(x + w, 256);
      g.lineTo(x + w + skew, 0);
      g.lineTo(x + skew, 0);
      g.closePath();
      g.fill();
    };
    stripe(250, 46, '#19d8ff');
    stripe(310, 22, '#ff3fb4');
    stripe(345, 60, '#ffd21f');
    stripe(420, 16, '#7a3cff');
    stripe(610, 30, '#ff3fb4', 110);
    stripe(655, 14, '#19d8ff', 110);
    stripe(120, 14, '#ffd21f', 90);
    // Halftone fade.
    g.fillStyle = 'rgba(20,6,10,0.55)';
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 7; j++) {
        const r = 5.5 * (1 - i / 26);
        g.beginPath();
        g.arc(700 + i * 12 + (j % 2) * 6, 150 + j * 14, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Bolt.
    g.save();
    g.translate(520, 128);
    g.fillStyle = '#ffe14a';
    g.strokeStyle = '#2a0a10';
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.beginPath();
    const pts = [[10, -78], [-34, 6], [-4, 6], [-22, 78], [38, -16], [6, -16], [26, -78]];
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    // Sill shadow.
    const sh = g.createLinearGradient(0, 190, 0, 256);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = sh;
    g.fillRect(0, 190, 1024, 66);
  });
}

function wheelGeometry() {
  const R = CFG.wheelRadius;
  const prof: [number, number][] = [
    [0.3, -0.2], [0.43, -0.215], [0.495, -0.17], [R, -0.085], [R, 0.085], [0.495, 0.17], [0.43, 0.215], [0.3, 0.2],
  ];
  const tire = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 30).rotateX(Math.PI / 2);
  const lugs: THREE.BufferGeometry[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lug = new THREE.BoxGeometry(0.105, 0.05, 0.17).toNonIndexed();
    const side = i % 2 ? 0.1 : -0.1;
    lug.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * (R + 0.012), Math.sin(a) * (R + 0.012), side),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a + Math.PI / 2)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    lugs.push(lug);
  }
  const lugGeo = mergeGeometries(lugs)!;
  const rimParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.31, 0.31, 0.34, 22).rotateX(Math.PI / 2).toNonIndexed()];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    for (const z of [0.175, -0.175]) {
      const sp = new THREE.BoxGeometry(0.27, 0.075, 0.03).toNonIndexed();
      sp.applyMatrix4(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * 0.15, Math.sin(a) * 0.15, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a)),
          new THREE.Vector3(1, 1, 1),
        ),
      );
      rimParts.push(sp);
    }
  }
  const rim = mergeGeometries(rimParts)!;
  const glowParts: THREE.BufferGeometry[] = [];
  for (const z of [0.18, -0.18]) {
    glowParts.push(new THREE.TorusGeometry(0.285, 0.02, 6, 28).translate(0, 0, z).toNonIndexed());
    glowParts.push(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12).rotateX(Math.PI / 2).translate(0, 0, z * 1.08).toNonIndexed());
  }
  return { tire, lugGeo, rim, glow: mergeGeometries(glowParts)! };
}

export interface VehicleViewState {
  dark: number; // 0…1 headlights
  battery: number; // 0…1
  joy: boolean;
  jets: boolean;
  jetsFiring: number; // 0…1 flame intensity
  turbo: boolean;
  throttle: number;
  loopZ: number; // z shift while riding a corkscrew loop
}

export class VehicleModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private shocks: { tube: THREE.Mesh; spring: THREE.Mesh; arm: THREE.Mesh; side: number; idx: number }[] = [];
  private driver = new THREE.Group();
  private armNear!: THREE.Mesh;
  private cells: THREE.Mesh[] = [];
  private headBeam!: THREE.Mesh;
  private headLight!: THREE.SpotLight;
  private underLight!: THREE.PointLight;
  private lampMat!: THREE.MeshBasicMaterial;
  private neonMat!: THREE.MeshBasicMaterial;
  private jetGroup = new THREE.Group();
  private jetFlames: THREE.Mesh[] = [];
  private rollBar = new THREE.Group();
  readonly groundGlow: THREE.Mesh;
  private visScale = 1;
  private lean = 0;
  private joyT = 0;
  private lastSpeed = 0;
  /** World-space anchor points for FX. */
  readonly rearWheelPos = new THREE.Vector3();
  readonly frontWheelPos = new THREE.Vector3();
  readonly exhaustPos = new THREE.Vector3();

  constructor() {
    const mats: Record<string, THREE.Material> = {
      paint: new THREE.MeshStandardMaterial({ color: PAINT, roughness: 0.34, metalness: 0.25 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.6, metalness: 0.4 }),
      cage: new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.35, metalness: 0.85 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc9d2e0, roughness: 0.18, metalness: 1 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.85 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xe9b48c, roughness: 0.7 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x5a3420, roughness: 0.8 }),
      suit: new THREE.MeshStandardMaterial({ color: 0xc81826, roughness: 0.6 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.25, metalness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 }),
      tail: new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }),
    };
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false });
    this.neonMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false });
    mats.lamp = this.lampMat;
    mats.neon = this.neonMat;
    const b = new Builder(mats);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // ---- tub: extruded side profile with the livery on its flanks ----
    const W = 1.3;
    const shape = new THREE.Shape();
    const prof: [number, number][] = [
      [-1.6, -0.24], [1.42, -0.24], [1.76, -0.02], [1.78, 0.2], [1.2, 0.3], [0.72, 0.36], [0.56, 0.54], [0.44, 0.3],
      [-0.74, 0.25], [-0.94, 0.45], [-1.66, 0.42], [-1.79, 0.14],
    ];
    prof.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const tubGeo = new THREE.ExtrudeGeometry(shape, { depth: W - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2 });
    tubGeo.translate(0, 0, -(W - 0.1) / 2);
    const livery = liveryTexture();
    livery.repeat.set(1 / 3.7, 1 / 0.92);
    livery.offset.set(0.5, 0.3 / 0.92);
    const tub = new THREE.Mesh(tubGeo, [
      new THREE.MeshStandardMaterial({ map: livery, roughness: 0.32, metalness: 0.25 }),
      mats.paint,
    ]);
    tub.castShadow = true;
    this.body.add(tub);

    b.box('dark', 3.05, 0.08, 1.12, -0.08, -0.29, 0); // skid plate
    b.box('dark', 0.5, 0.05, 0.9, 1.18, 0.33, 0, -0.17); // hood vent
    b.box('glass', 0.03, 0.26, 1.1, 0.6, 0.62, 0, -0.5); // wind deflector

    // Fender arcs over each wheel (long-travel gap underneath).
    for (const sx of [-1, 1]) {
      const fs = new THREE.Shape();
      fs.absarc(0, 0, 0.74, 0.3, Math.PI - 0.3, false);
      fs.absarc(0, 0, 0.68, Math.PI - 0.3, 0.3, true);
      const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.5, bevelEnabled: false, curveSegments: 14 });
      for (const sz of [-1, 1]) {
        b.add('paint', fg, new THREE.Matrix4().makeTranslation(sx * CFG.wheelBaseHalf, CFG.wheelRestY + 0.2, sz * HALF_TRACK - 0.25));
      }
    }

    // Roll cage.
    for (const sz of [-1, 1]) {
      const z = sz * 0.56;
      b.tube('cage', [[-1.3, 0.42, z], [-1.12, 0.86, z], [-0.86, 1.05, z], [-0.2, 1.06, z], [0.22, 0.98, z], [0.52, 0.52, z]], 0.045);
      b.tube('cage', [[-0.9, 1.04, z], [-1.3, 0.7, z], [-1.68, 0.44, z]], 0.038, 10);
      b.rod('cage', V(-0.86, 1.05, z), V(-0.78, 0.26, z), 0.04);
    }
    b.rod('cage', V(-0.86, 1.05, -0.56), V(-0.86, 1.05, 0.56), 0.045);
    b.rod('cage', V(0.22, 0.98, -0.56), V(0.22, 0.98, 0.56), 0.04);
    b.rod('cage', V(-0.2, 1.06, -0.56), V(-0.2, 1.06, 0.56), 0.035);
    // Roof light bar.
    b.box('dark', 0.1, 0.07, 0.86, 0.2, 1.07, 0);
    for (const z of [-0.3, -0.1, 0.1, 0.3]) b.box('lamp', 0.03, 0.05, 0.14, 0.255, 1.07, z);

    // Bumpers, lamps, spare.
    b.tube('chrome', [[1.62, -0.16, -0.62], [1.92, -0.1, -0.5], [1.94, -0.1, 0.5], [1.62, -0.16, 0.62]], 0.04, 14);
    b.tube('chrome', [[-1.62, -0.1, -0.6], [-1.92, -0.04, -0.48], [-1.92, -0.04, 0.48], [-1.62, -0.1, 0.6]], 0.04, 14);
    for (const z of [-0.42, 0.42]) {
      b.add('chrome', new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(1.79, 0.1, z));
      b.add('lamp', new THREE.CylinderGeometry(0.105, 0.105, 0.03, 14).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(1.84, 0.1, z));
      b.box('tail', 0.04, 0.09, 0.22, -1.8, 0.26, z);
    }
    b.add('black', new THREE.TorusGeometry(0.3, 0.13, 8, 18).rotateY(Math.PI / 2), new THREE.Matrix4().makeRotationZ(0.35).setPosition(-1.5, 0.72, 0));
    b.add('chrome', new THREE.CylinderGeometry(0.17, 0.17, 0.2, 12).rotateZ(Math.PI / 2), new THREE.Matrix4().makeRotationZ(0.35).setPosition(-1.5, 0.72, 0));

    // Battery pack on each sill + neon rocker tubes (the EV tell).
    for (const sz of [-1, 1]) {
      b.box('dark', 1.26, 0.2, 0.06, 0.08, -0.12, sz * 0.67);
      b.add('neon', new THREE.CylinderGeometry(0.028, 0.028, 2.05, 6).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(-0.05, -0.31, sz * 0.63));
    }

    // Cockpit.
    b.box('seat', 0.5, 0.12, 0.5, -0.5, 0.26, 0.02);
    b.box('seat', 0.12, 0.62, 0.48, -0.76, 0.56, 0.02, 0.22);
    b.box('dark', 0.1, 0.22, 1.0, 0.5, 0.42, 0); // dash
    b.add('black', new THREE.TorusGeometry(0.15, 0.024, 6, 16).rotateY(Math.PI / 2), new THREE.Matrix4().makeRotationZ(-0.45).setPosition(0.2, 0.62, 0.02));
    b.rod('dark', V(0.2, 0.62, 0.02), V(0.46, 0.46, 0.02), 0.02, 6);
    b.build(this.body);

    // Live battery gauge: five cells that drain with the charge.
    const cellGeo = new THREE.BoxGeometry(0.2, 0.12, 0.02);
    for (let i = 0; i < 5; i++) {
      for (const sz of [-1, 1]) {
        const cell = new THREE.Mesh(cellGeo, new THREE.MeshBasicMaterial({ color: 0x6dff7a, toneMapped: false }));
        cell.position.set(-0.4 + i * 0.24, -0.12, sz * 0.705);
        cell.userData.i = i;
        this.cells.push(cell);
        this.body.add(cell);
      }
    }

    // ---- driver ----
    const db = new Builder(mats);
    db.add('suit', new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), new THREE.Matrix4().makeRotationZ(0.2).setPosition(-0.5, 0.56, 0.02));
    db.box('black', 0.1, 0.36, 0.36, -0.57, 0.56, 0.02, 0.2);
    db.add('skin', new THREE.SphereGeometry(0.155, 14, 12), new THREE.Matrix4().makeTranslation(-0.42, 0.89, 0.02));
    db.add('hair', new THREE.SphereGeometry(0.168, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.Matrix4().makeRotationZ(0.45).setPosition(-0.44, 0.905, 0.02));
    db.box('hair', 0.12, 0.07, 0.24, -0.34, 1.03, 0.02, -0.25);
    db.box('black', 0.05, 0.062, 0.3, -0.285, 0.905, 0.02);
    db.box('skin', 0.03, 0.03, 0.04, -0.262, 0.86, 0.02);
    db.rod('suit', V(-0.44, 0.72, -0.2), V(0.12, 0.62, -0.14), 0.05, 6); // far arm
    db.add('black', new THREE.SphereGeometry(0.06, 8, 6), new THREE.Matrix4().makeTranslation(0.14, 0.62, -0.14));
    db.build(this.driver);
    // Near arm is its own mesh so it can punch the air.
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.58, 6).translate(0, 0.29, 0);
    this.armNear = new THREE.Mesh(armGeo, mats.suit);
    this.armNear.position.set(-0.44, 0.72, 0.22);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), mats.black);
    fist.position.y = 0.6;
    this.armNear.add(fist);
    this.armNear.castShadow = true;
    this.driver.add(this.armNear);
    this.body.add(this.driver);

    // ---- headlight beams + underglow ----
    const beamGeo = new THREE.ConeGeometry(1.15, 6.5, 16, 1, true).rotateZ(Math.PI / 2).translate(3.25, 0, 0);
    this.headBeam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        map: canvasTexture(8, 64, (g) => {
          const gr = g.createLinearGradient(0, 0, 0, 64);
          gr.addColorStop(0, 'rgba(255,243,196,0)');
          gr.addColorStop(1, 'rgba(255,243,196,0.3)');
          g.fillStyle = gr;
          g.fillRect(0, 0, 8, 64);
        }),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.headBeam.position.set(1.8, 0.1, 0);
    this.headBeam.rotation.z = -0.08;
    this.body.add(this.headBeam);
    this.headLight = new THREE.SpotLight(0xfff0c8, 0, 34, 0.5, 0.7, 1.2);
    this.headLight.position.set(1.7, 0.4, 0);
    this.headLight.target.position.set(12, -1.2, 0);
    this.body.add(this.headLight, this.headLight.target);
    this.underLight = new THREE.PointLight(ACCENT, 0, 7, 1.6);
    this.underLight.position.set(0, -0.6, 0.4);
    this.body.add(this.underLight);

    // ---- jump-jet pods (hidden until the power-up) ----
    const jb = new Builder(mats);
    for (const x of [-0.55, 0.55]) {
      for (const z of [-0.36, 0.36]) {
        jb.add('chrome', new THREE.CylinderGeometry(0.14, 0.14, 0.14, 12), new THREE.Matrix4().makeTranslation(x, -0.38, z));
        jb.add('dark', new THREE.CylinderGeometry(0.1, 0.18, 0.16, 12, 1, true), new THREE.Matrix4().makeTranslation(x, -0.52, z));
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.15, 1.1, 10, 1, true).rotateX(Math.PI).translate(0, -0.55, 0),
          new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        );
        flame.position.set(x, -0.6, z);
        this.jetFlames.push(flame);
        this.jetGroup.add(flame);
      }
    }
    jb.build(this.jetGroup);
    this.jetGroup.visible = false;
    this.body.add(this.jetGroup);

    // ---- roll bar hoop (power-up): the same arc the physics caps sit on ----
    const caps = Vehicle.rollBarCaps(1);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0xdfe7f2, roughness: 0.15, metalness: 1, emissive: 0x88aacc, emissiveIntensity: 0.35 });
    for (const z of [-0.72, 0.72]) {
      const curve = new THREE.CatmullRomCurve3(caps.map((c) => new THREE.Vector3(c.x, c.y, z)));
      const hoop = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.085, 8), hoopMat);
      hoop.castShadow = true;
      this.rollBar.add(hoop);
    }
    for (const i of [0, 2, 4, 6, 8]) {
      const c = caps[i];
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.44, 8).rotateX(Math.PI / 2), hoopMat);
      link.position.set(c.x, c.y, 0);
      this.rollBar.add(link);
    }
    this.rollBar.visible = false;
    this.body.add(this.rollBar);

    this.root.add(this.body);

    // ---- wheels ----
    const wg = wheelGeometry();
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.92 });
    const lugMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.95 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b8, roughness: 0.28, metalness: 0.95 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(wg.tire, tireMat);
      tire.castShadow = true;
      g.add(tire, new THREE.Mesh(wg.lugGeo, lugMat), new THREE.Mesh(wg.rim, rimMat), new THREE.Mesh(wg.glow, this.neonMat));
      this.wheels.push(g);
      this.root.add(g);
    }

    // ---- suspension: lower arm + coil-over per corner, stretched between live anchors ----
    const armMat = mats.cage;
    const springMat = new THREE.MeshStandardMaterial({ color: 0xffc928, roughness: 0.4, metalness: 0.5 });
    const helix: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      helix.push(new THREE.Vector3(Math.cos(t * Math.PI * 10) * 0.075, t, Math.sin(t * Math.PI * 10) * 0.075));
    }
    const springGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 70, 0.02, 5);
    const tubeGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 8).translate(0, 0.5, 0);
    const armGeo2 = new THREE.BoxGeometry(0.07, 1, 0.16).translate(0, 0.5, 0);
    for (let idx = 0; idx < 2; idx++) {
      for (const side of [1, -1]) {
        const tube = new THREE.Mesh(tubeGeo, mats.dark);
        const spring = new THREE.Mesh(springGeo, springMat);
        const arm = new THREE.Mesh(armGeo2, armMat);
        this.shocks.push({ tube, spring, arm, side, idx });
        this.root.add(tube, spring, arm);
      }
    }

    // Neon pool on the ground under the car (placed by the world view).
    this.groundGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.2, 3.4),
      new THREE.MeshBasicMaterial({ map: softSprite(), color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.renderOrder = 2;
  }

  /** Snap the grow/shrink animation (used when a fresh world is staged). */
  resetScale(s: number) {
    this.visScale = s;
  }

  private static stretch(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thick: number) {
    const d = _v1.subVectors(b, a);
    const len = d.length();
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(_up, d.normalize());
    m.scale.set(thick, len, thick);
  }

  update(v: Vehicle, alpha: number, st: VehicleViewState, dt: number, time: number) {
    const target = v.scale;
    this.visScale += (target - this.visScale) * Math.min(1, dt * 9);
    if (Math.abs(target - this.visScale) < 0.004) this.visScale = target;
    const s = this.visScale;
    const c = v.chassisPose(alpha);
    const z0 = st.loopZ;
    this.body.position.set(c.x, c.y, z0);
    this.body.rotation.z = c.a;
    this.body.scale.setScalar(s);

    const cos = Math.cos(c.a);
    const sin = Math.sin(c.a);
    const local = (lx: number, ly: number, lz: number, out: THREE.Vector3) =>
      out.set(c.x + (lx * cos - ly * sin) * s, c.y + (lx * sin + ly * cos) * s, z0 + lz * s);

    for (let i = 0; i < 2; i++) {
      const w = v.wheelPose(i, alpha);
      for (let k = 0; k < 2; k++) {
        const g = this.wheels[i * 2 + k];
        const side = k === 0 ? 1 : -1;
        g.position.set(w.x, w.y, z0 + side * HALF_TRACK * s);
        g.rotation.z = w.a;
        g.scale.setScalar(s);
      }
      (i === 0 ? this.rearWheelPos : this.frontWheelPos).set(w.x, w.y, z0);
    }
    for (const sh of this.shocks) {
      const w = v.wheelPose(sh.idx, alpha);
      const sx = sh.idx === 0 ? -1 : 1;
      const hub = _v2.set(w.x, w.y, z0 + sh.side * (HALF_TRACK - 0.24) * s);
      const lowIn = local(sx * (CFG.wheelBaseHalf - 0.16), -0.22, sh.side * 0.5, _v3);
      VehicleModel.stretch(sh.arm, lowIn, hub, s);
      const top = local(sx * (CFG.wheelBaseHalf - 0.3), 0.3, sh.side * 0.6, _v4);
      const lowOut = _v5.copy(lowIn).lerp(hub, 0.72);
      VehicleModel.stretch(sh.tube, top, lowOut, s);
      VehicleModel.stretch(sh.spring, top, lowOut, s);
      const len = _v1.subVectors(lowOut, top).length();
      sh.spring.scale.set(s, len * 0.92, s);
    }
    local(-1.9, 0.0, 0, this.exhaustPos);

    // Driver: leans with acceleration, punches the air on stunts.
    const accel = (v.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = v.speed;
    this.lean += (THREE.MathUtils.clamp(-accel * 0.012, -0.22, 0.26) - this.lean) * Math.min(1, dt * 6);
    this.driver.rotation.z = this.lean;
    this.driver.position.set(-0.5 * (1 - Math.cos(this.lean)), 0, 0);
    this.joyT += ((st.joy ? 1 : 0) - this.joyT) * Math.min(1, dt * 8);
    const rest = -1.38; // arm resting toward the wheel
    this.armNear.rotation.z = rest + this.joyT * (1.75 + Math.sin(time * 14) * 0.18);
    this.armNear.rotation.x = this.joyT * 0.35;

    // Lights.
    const dark = st.dark;
    this.headBeam.visible = dark > 0.02;
    (this.headBeam.material as THREE.MeshBasicMaterial).opacity = dark * 0.55;
    this.headLight.intensity = dark * 220;
    this.underLight.intensity = (0.25 + dark * 0.75) * 9 * (st.turbo ? 1.6 : 1);
    this.neonMat.color.setHex(st.turbo ? 0xffa23a : ACCENT).multiplyScalar(1.5 + dark);
    this.underLight.color.setHex(st.turbo ? 0xff8a2a : ACCENT);
    (this.groundGlow.material as THREE.MeshBasicMaterial).color.setHex(st.turbo ? 0xff8a2a : ACCENT);
    this.lampMat.color.setHex(0xfff3c4).multiplyScalar(0.8 + dark * 1.6);

    // Battery cells.
    for (const cell of this.cells) {
      const i = cell.userData.i as number;
      const on = st.battery * 5 > i + 0.02;
      const low = st.battery < CFG.lowBatteryFraction;
      const m = cell.material as THREE.MeshBasicMaterial;
      if (!on) m.color.setHex(0x1c2a22);
      else if (low) m.color.setHex(Math.sin(time * 12) > 0 ? 0xff4a3a : 0x5a1410);
      else m.color.setHex(st.battery < 0.45 ? 0xffd23a : 0x6dff7a);
    }

    this.jetGroup.visible = st.jets;
    if (st.jets) {
      for (const f of this.jetFlames) {
        f.scale.set(1, 0.25 + st.jetsFiring * 1.6 + Math.sin(time * 40 + f.position.x * 9) * 0.08, 1);
        (f.material as THREE.MeshBasicMaterial).opacity = 0.35 + st.jetsFiring * 0.6;
      }
    }
    this.rollBar.visible = v.rollBar;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
