// Renderer + post-processing. One WebGLRenderer, optional bloom, three quality tiers.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'low' | 'medium' | 'high';

export interface QualitySpec {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  bloom: boolean;
  particles: number; // multiplier
  decor: number; // density multiplier
}

export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 0, bloom: false, particles: 0.5, decor: 0.55 },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, bloom: true, particles: 0.8, decor: 0.8 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, particles: 1, decor: 1 },
};

export class Gfx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 900);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  quality: Quality = 'high';
  spec: QualitySpec = QUALITY.high;
  width = 1;
  height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Soft studio reflections so glossy paint and chrome never read as flat black.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
  }

  static autoQuality(): Quality {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    if (coarse) return cores >= 8 && !small ? 'medium' : 'low';
    return cores >= 8 ? 'high' : 'medium';
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.spec = QUALITY[q];
    this.renderer.shadowMap.enabled = this.spec.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.spec.pixelRatio));
    this.composer = null;
    this.bloom = null;
    if (this.spec.bloom) {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.55, 0.55, 0.9);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    }
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // Keep the horizontal field of view generous on tall/narrow screens.
    this.camera.fov = this.camera.aspect < 1.4 ? 34 + (1.4 - this.camera.aspect) * 22 : 34;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(this.width, this.height);
    }
  }

  setExposure(e: number) {
    this.renderer.toneMappingExposure = e;
  }
  setBloom(strength: number) {
    if (this.bloom) this.bloom.strength = strength;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

// ---- small shared helpers ---------------------------------------------------------------------
export const col = (hex: number) => new THREE.Color(hex);
export function lerpHex(a: number, b: number, t: number, out = new THREE.Color()): THREE.Color {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return out.copy(ca).lerp(cb, t);
}

/** Soft round sprite (white, radial alpha) — particles, glows, sun. */
let softTex: THREE.Texture | null = null;
export function softSprite(): THREE.Texture {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softTex = new THREE.CanvasTexture(c);
  softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
