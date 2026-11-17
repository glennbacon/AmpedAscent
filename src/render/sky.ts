// Atmosphere: screen-space sky gradient, sun/moon, stars, aurora, far silhouette ranges, fog and
// the biome's lights. Everything cross-fades with the track's biome blend, so seams never pop.

import * as THREE from 'three';
import { lerp } from '../sim/config';
import { BiomeBlend } from '../sim/track';
import { WorldDef } from '../sim/worlds';
import { Gfx, softSprite } from './gfx';

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const mixHex = (a: number, b: number, t: number, out: THREE.Color) => out.setHex(a).lerp(_c2.setHex(b), t);
const has = (w: WorldDef, k: string) => (w.ambient as string[]).includes(k);

function moonTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(54, 54, 6, 64, 64, 60);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(1, '#d9dcec');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(150,158,190,0.5)';
  for (const [x, y, r] of [[44, 50, 12], [80, 40, 8], [78, 82, 14], [50, 88, 7], [96, 62, 6]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SkyView {
  private skyCanvas = document.createElement('canvas');
  private skyTex: THREE.CanvasTexture;
  private skyKey = '';
  readonly fog = new THREE.Fog(0xffffff, 60, 320);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private celestial: THREE.Sprite;
  private halo: THREE.Sprite;
  private moonTex = moonTexture();
  private stars: THREE.Points;
  private aurora: THREE.Mesh[] = [];
  private layers: { mesh: THREE.Mesh; period: number; z: number; lift: number }[] = [];
  private camGroup = new THREE.Group();

  constructor(private gfx: Gfx) {
    const scene = gfx.scene;
    this.skyCanvas.width = 4;
    this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.skyTex;
    scene.fog = this.fog;
    scene.add(this.hemi);

    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    // Camera-space group: celestial body, stars, aurora ride with the view (pure backdrop).
    scene.add(gfx.camera);
    gfx.camera.add(this.camGroup);

    const spr = (map: THREE.Texture, additive: boolean) =>
      new THREE.Sprite(
        new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false }),
      );
    this.halo = spr(softSprite(), true);
    this.celestial = spr(softSprite(), false);
    this.halo.renderOrder = -10;
    this.celestial.renderOrder = -9;
    this.camGroup.add(this.halo, this.celestial);

    // Stars.
    const n = 420;
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 1500;
      sp[i * 3 + 1] = Math.pow(Math.random(), 0.7) * 520 - 90;
      sp[i * 3 + 2] = -760;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, map: softSprite(), toneMapped: false }),
    );
    this.stars.renderOrder = -12;
    this.camGroup.add(this.stars);

    // Aurora ribbons: additive curtains with a slow travelling shimmer.
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(0x78ffb4) }, uB: { value: new THREE.Color(0x9678ff) }, uAlpha: { value: 0 }, uSeed: { value: i * 3.7 } },
        vertexShader: `
          uniform float uTime; uniform float uSeed; varying vec2 vUv;
          void main(){ vUv = uv; vec3 p = position;
            p.y += sin(p.x*0.012 + uTime*0.25 + uSeed)*26.0 + sin(p.x*0.031 - uTime*0.17 + uSeed*2.0)*10.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
        fragmentShader: `
          uniform float uTime; uniform float uSeed; uniform vec3 uA; uniform vec3 uB; uniform float uAlpha; varying vec2 vUv;
          void main(){
            float rays = 0.55 + 0.45*sin(vUv.x*90.0 + uSeed*5.0 + sin(vUv.x*17.0 + uTime*0.6)*2.0);
            float v = smoothstep(0.0,0.12,vUv.y) * pow(1.0-vUv.y, 1.6);
            float ends = smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x);
            vec3 c = mix(uA, uB, vUv.y*1.2);
            gl_FragColor = vec4(c * rays * v * ends * uAlpha, 1.0); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1100, 170, 60, 1), mat);
      m.position.set(-120 + i * 130, 110 + i * 36, -700 + i * 12);
      m.renderOrder = -11;
      this.aurora.push(m);
      this.camGroup.add(m);
    }

    // Far silhouette ranges (world space → real parallax). Periodic, so they snap-follow seamlessly.
    const specs = [
      { z: -250, period: 640, amp: 62, base: -22, jag: 0.9, seed: 1.3 },
      { z: -165, period: 520, amp: 44, base: -30, jag: 0.6, seed: 4.1 },
      { z: -100, period: 400, amp: 26, base: -32, jag: 0.35, seed: 7.7 },
    ];
    for (const s of specs) {
      const seg = 220;
      const W = s.period * 3;
      const pos = new Float32Array((seg + 1) * 2 * 3);
      const colr = new Float32Array((seg + 1) * 2 * 3);
      const k = (Math.PI * 2) / s.period;
      for (let i = 0; i <= seg; i++) {
        const x = -W / 2 + (i / seg) * W;
        const ridge =
          Math.sin(x * k + s.seed) * 0.5 +
          Math.sin(x * k * 2 + s.seed * 2.1) * 0.28 +
          Math.abs(Math.sin(x * k * 3 + s.seed * 0.7)) * 0.5 * s.jag +
          Math.abs(Math.sin(x * k * 7 + s.seed * 3.3)) * 0.22 * s.jag +
          Math.sin(x * k * 11 + s.seed) * 0.06;
        const y = s.base + ridge * s.amp;
        pos.set([x, y, 0, x, s.base - 220, 0], i * 6);
        colr.set([1.35, 1.35, 1.35, 0.72, 0.72, 0.72], i * 6);
      }
      const idx: number[] = [];
      for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
      mesh.position.z = s.z;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.layers.push({ mesh, period: s.period, z: s.z, lift: s.base });
    }
  }

  private drawSky(a: WorldDef, b: WorldDef, t: number) {
    const key = `${a.id}|${b.id}|${Math.round(t * 60)}`;
    if (key === this.skyKey) return;
    this.skyKey = key;
    const g = this.skyCanvas.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    // The land hides the lower half of the screen, so the whole zenith→horizon ramp is packed
    // into the upper ~58%; below that the horizon colour holds.
    const stops = [0, 0.2, 0.42, 0.58];
    for (let i = 0; i < 4; i++) gr.addColorStop(stops[i], `#${mixHex(a.sky[i], b.sky[i], t, _c1).getHexString()}`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 256);
    this.skyTex.needsUpdate = true;
  }

  /** Darkness 0…1 of the current blend (headlights, glow strength). */
  darkness(bl: BiomeBlend): number {
    return lerp(bl.a.dark ? 1 : 0, bl.b.dark ? 1 : 0, bl.t);
  }

  update(bl: BiomeBlend, focusX: number, focusY: number, time: number) {
    const { a, b, t } = bl;
    this.drawSky(a, b, t);
    mixHex(a.fog.color, b.fog.color, t, this.fog.color);
    this.fog.near = lerp(a.fog.near, b.fog.near, t);
    this.fog.far = lerp(a.fog.far, b.fog.far, t);
    mixHex(a.hemi.sky, b.hemi.sky, t, this.hemi.color);
    mixHex(a.hemi.ground, b.hemi.ground, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemi.intensity, b.hemi.intensity, t) * 0.82;
    mixHex(a.sun.color, b.sun.color, t, this.sun.color);
    this.sun.intensity = lerp(a.sun.intensity, b.sun.intensity, t) * 0.74;
    const dx = lerp(a.sun.dir[0], b.sun.dir[0], t);
    const dy = lerp(a.sun.dir[1], b.sun.dir[1], t);
    const dz = lerp(a.sun.dir[2], b.sun.dir[2], t);
    this.sun.target.position.set(focusX + 6, focusY, -6);
    this.sun.position.set(focusX + 6 + dx * 90, focusY + dy * 90, -6 + dz * 90);
    this.gfx.setExposure(lerp(a.exposure, b.exposure, t));

    // Celestial body: whichever biome dominates shows its light; it fades through the seam.
    const cam = this.gfx.camera;
    const depth = 640;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * depth;
    const halfW = halfH * cam.aspect;
    const w = t < 0.5 ? a : b;
    const fade = Math.abs(t - 0.5) * 2;
    const cel = w.celestial;
    const show = cel.kind !== 'none';
    this.celestial.visible = this.halo.visible = show;
    if (show) {
      const px = cel.x * 2 * halfW;
      const py = cel.y * 2 * halfH;
      const size = cel.size * 2 * halfH;
      const cm = this.celestial.material as THREE.SpriteMaterial;
      const hm = this.halo.material as THREE.SpriteMaterial;
      const isMoon = cel.kind === 'moon';
      cm.map = isMoon ? this.moonTex : softSprite();
      cm.color.setHex(cel.color);
      cm.opacity = fade;
      hm.color.setHex(cel.color);
      hm.opacity = fade * (isMoon ? 0.28 : 0.6);
      this.celestial.position.set(px, py, -depth);
      this.celestial.scale.setScalar(isMoon ? size : size * 1.5);
      this.halo.position.set(px, py, -depth - 2);
      this.halo.scale.setScalar(size * (isMoon ? 4.5 : 7));
    }
    (this.stars.material as THREE.PointsMaterial).opacity = lerp(has(a, 'stars') ? 0.9 : 0, has(b, 'stars') ? 0.9 : 0, t) * (0.85 + Math.sin(time * 1.7) * 0.1);
    const au = lerp(has(a, 'aurora') ? 1 : 0, has(b, 'aurora') ? 1 : 0, t);
    for (const m of this.aurora) {
      m.visible = au > 0.01;
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = time;
      u.uAlpha.value = au * 0.55;
    }

    // Silhouette ranges: tint, snap to their period, and ride most of the camera's climb.
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      const m = L.mesh.material as THREE.MeshBasicMaterial;
      // Aerial perspective by hand: the farther the range, the more horizon haze it takes on.
      mixHex(a.backdrop[i], b.backdrop[i], t, m.color).lerp(mixHex(a.sky[3], b.sky[3], t, _c1), [0.5, 0.3, 0.14][i]);
      L.mesh.position.x = Math.round(cam.position.x / L.period) * L.period;
      L.mesh.position.y = cam.position.y * (0.82 + i * 0.05);
    }
  }
}
