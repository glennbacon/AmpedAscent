// The six biomes. Pure data: terrain character for the sim, palette + dressing for the renderer.
// Terrain octaves are ported from the original game (px ÷ 30 → metres); slopes are preserved.

export type WorldId = 'sylvan' | 'aurora' | 'mirage' | 'coral' | 'caverns' | 'ember';
export const WORLD_ORDER: WorldId[] = ['sylvan', 'aurora', 'mirage', 'coral', 'caverns', 'ember'];

export interface Octave {
  amp: number;
  wave: number;
  phase: number;
}

export type DecorKind = 'forest' | 'snow' | 'desert' | 'reef' | 'crystal' | 'volcanic';
export type AmbientKind =
  | 'fireflies' | 'pollen' | 'snow' | 'stars' | 'aurora' | 'sand' | 'bubbles' | 'marineSnow' | 'embers' | 'ash';

export interface WorldDef {
  id: WorldId;
  name: string;
  tagline: string;
  octaves: Octave[];
  spice: Octave; // short crest-sharpener, faded in with difficulty
  baseY: number;
  gravityMul: number;
  dark: boolean; // headlights on
  // ---- look ----
  sky: [number, number, number, number]; // zenith → upper → lower → horizon
  fog: { color: number; near: number; far: number };
  sun: { color: number; intensity: number; dir: [number, number, number] };
  hemi: { sky: number; ground: number; intensity: number };
  ground: { top: number; topAlt: number; side: number; deep: number; rim: number; rimGlow: number };
  backdrop: [number, number, number]; // far → near silhouette layers
  backdropRim: number;
  decor: DecorKind;
  ambient: AmbientKind[];
  celestial: { kind: 'sun' | 'moon' | 'planet' | 'none'; color: number; x: number; y: number; size: number };
  dust: number; // wheel dirt tint
  accent: number; // UI card accent
  exposure: number;
}

const o = (ampPx: number, wavePx: number, phase: number): Octave => ({ amp: ampPx / 30, wave: wavePx / 30, phase });

export const WORLDS: Record<WorldId, WorldDef> = {
  sylvan: {
    id: 'sylvan',
    name: 'Sylvan Trails',
    tagline: 'Golden-hour forest. Soft rollers.',
    octaves: [o(81, 1400, 0.9), o(22, 700, 2.4), o(5, 320, 0.5)],
    spice: o(10, 230, 1.1),
    baseY: 0,
    gravityMul: 1,
    dark: false,
    sky: [0x27506a, 0x6f9aa8, 0xf0b07c, 0xffdb92],
    fog: { color: 0xe9c79a, near: 60, far: 330 },
    sun: { color: 0xffe2b0, intensity: 2.6, dir: [-0.55, 0.62, 0.56] },
    hemi: { sky: 0xbfd8e6, ground: 0x4a5a34, intensity: 0.95 },
    ground: { top: 0x6fae4e, topAlt: 0x8cc45c, side: 0x6a4a30, deep: 0x2e2018, rim: 0xc6f2a0, rimGlow: 0 },
    backdrop: [0x8fb0b4, 0x5b8f78, 0x3a6a4a],
    backdropRim: 0xffe7b0,
    decor: 'forest',
    ambient: ['pollen', 'fireflies'],
    celestial: { kind: 'sun', color: 0xfff0c4, x: -0.42, y: 0.2, size: 0.11 },
    dust: 0x8a6a46,
    accent: 0x7ed957,
    exposure: 1.0,
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora Pass',
    tagline: 'Moonlit snowfields. Long, tall swells.',
    octaves: [o(135, 2000, 0.9), o(32, 950, 2.4), o(5, 380, 0.5)],
    spice: o(8, 260, 0.7),
    baseY: 0,
    gravityMul: 1,
    dark: true,
    sky: [0x050816, 0x0c1530, 0x1a2c58, 0x2a4a78],
    fog: { color: 0x1c3056, near: 50, far: 300 },
    sun: { color: 0xa9c8ff, intensity: 1.35, dir: [0.5, 0.7, 0.5] },
    hemi: { sky: 0x6f93d8, ground: 0x1a2440, intensity: 0.9 },
    ground: { top: 0xb4c4e2, topAlt: 0x9fb2d6, side: 0x2c4270, deep: 0x0e1730, rim: 0xe6f0ff, rimGlow: 0 },
    backdrop: [0x22386a, 0x182a52, 0x10203f],
    backdropRim: 0xbfe0ff,
    decor: 'snow',
    ambient: ['stars', 'aurora', 'snow'],
    celestial: { kind: 'moon', color: 0xfbfaf3, x: 0.38, y: 0.3, size: 0.07 },
    dust: 0x9fb2d2,
    accent: 0x78ffb4,
    exposure: 1.05,
  },
  mirage: {
    id: 'mirage',
    name: 'Mirage Dunes',
    tagline: 'Sunset desert. Punchy dune crests.',
    octaves: [o(62, 1300, 0.2), o(28, 620, 1.4), o(5, 300, 2.2)],
    spice: o(12, 260, 2.0),
    baseY: 0,
    gravityMul: 1,
    dark: false,
    sky: [0x2a1a4a, 0x6a3468, 0xd25a4c, 0xffa64a],
    fog: { color: 0xe08a5a, near: 55, far: 320 },
    sun: { color: 0xffb070, intensity: 2.7, dir: [-0.7, 0.42, 0.5] },
    hemi: { sky: 0xd89a8a, ground: 0x5a3a2a, intensity: 0.85 },
    ground: { top: 0xe2b877, topAlt: 0xf0cc8c, side: 0x9a6038, deep: 0x40241a, rim: 0xffe6b4, rimGlow: 0 },
    backdrop: [0xb0606a, 0x8a4450, 0x5c2c3a],
    backdropRim: 0xffc890,
    decor: 'desert',
    ambient: ['sand'],
    celestial: { kind: 'sun', color: 0xffd9a0, x: -0.3, y: 0.1, size: 0.16 },
    dust: 0xd8b078,
    accent: 0xff9a40,
    exposure: 1.0,
  },
  coral: {
    id: 'coral',
    name: 'Coral Deep',
    tagline: 'Sunken reef. A little floaty.',
    octaves: [o(58, 850, 0.7), o(23, 480, 1.9), o(6, 300, 0.4)],
    spice: o(9, 240, 1.5),
    baseY: 0,
    gravityMul: 0.955, // the original's subtle floaty accent (−10.5 vs −11)
    dark: true,
    sky: [0x2a9ac0, 0x167098, 0x0d4a70, 0x083252],
    fog: { color: 0x0d4a6c, near: 26, far: 190 },
    sun: { color: 0x9fe6ff, intensity: 1.9, dir: [-0.2, 0.92, 0.35] },
    hemi: { sky: 0x5fc8e8, ground: 0x0a2c3a, intensity: 1.0 },
    ground: { top: 0x2a8a84, topAlt: 0x3aa494, side: 0x1c5560, deep: 0x06202a, rim: 0x4adcb4, rimGlow: 0.5 },
    backdrop: [0x14587a, 0x0e4462, 0x0a3048],
    backdropRim: 0x6ff2ff,
    decor: 'reef',
    ambient: ['bubbles', 'marineSnow'],
    celestial: { kind: 'none', color: 0, x: 0, y: 0, size: 0 },
    dust: 0xbfe6dc,
    accent: 0x4adcb4,
    exposure: 1.05,
  },
  caverns: {
    id: 'caverns',
    name: 'Crystal Caverns',
    tagline: 'Glowing underworld. Tight, choppy floor.',
    octaves: [o(38, 1050, 0.6), o(17, 520, 1.8), o(6, 260, 2.9)],
    spice: o(14, 220, 0.4),
    baseY: 0,
    gravityMul: 1,
    dark: true,
    sky: [0x07040f, 0x130b26, 0x24102c, 0x3a1420],
    fog: { color: 0x1d1230, near: 34, far: 210 },
    sun: { color: 0xb09aff, intensity: 1.25, dir: [0.3, 0.85, 0.45] },
    hemi: { sky: 0x7a5cc8, ground: 0x2a1418, intensity: 0.85 },
    ground: { top: 0x4a3a66, topAlt: 0x5a4878, side: 0x2c2040, deep: 0x100a18, rim: 0xff9b5a, rimGlow: 0.7 },
    backdrop: [0x2a1c48, 0x20143a, 0x180e2c],
    backdropRim: 0x9a7cff,
    decor: 'crystal',
    ambient: ['fireflies', 'embers'],
    celestial: { kind: 'none', color: 0, x: 0, y: 0, size: 0 },
    dust: 0x9a86c0,
    accent: 0xb48cff,
    exposure: 1.1,
  },
  ember: {
    id: 'ember',
    name: 'Ember Summit',
    tagline: 'Volcanic ridge. The hardest climb.',
    octaves: [o(44, 1550, 1.1), o(18, 600, 0.3), o(6, 280, 2.5)],
    spice: o(11, 260, 1.7),
    baseY: 0,
    gravityMul: 1,
    dark: true,
    sky: [0x0a0606, 0x1e0c0a, 0x4a160c, 0x8a2c10],
    fog: { color: 0x3a140c, near: 40, far: 240 },
    sun: { color: 0xff9a60, intensity: 1.6, dir: [-0.4, 0.55, 0.6] },
    hemi: { sky: 0xb0502c, ground: 0x1a0a08, intensity: 0.8 },
    ground: { top: 0x3a2624, topAlt: 0x4a302a, side: 0x241414, deep: 0x0c0606, rim: 0xff7e2e, rimGlow: 1.0 },
    backdrop: [0x3a1612, 0x2a100e, 0x1a0a0a],
    backdropRim: 0xff6a2e,
    decor: 'volcanic',
    ambient: ['embers', 'ash'],
    celestial: { kind: 'none', color: 0, x: 0, y: 0, size: 0 },
    dust: 0x5a4640,
    accent: 0xff6a2e,
    exposure: 1.1,
  },
};

/** Raw biome field around its base line: sum of sines (no difficulty envelope). */
export function worldField(w: WorldDef, x: number): number {
  let y = 0;
  for (const oc of w.octaves) y += oc.amp * Math.sin((x / oc.wave) * Math.PI * 2 + oc.phase);
  return y;
}
export function worldSpice(w: WorldDef, x: number): number {
  const s = w.spice;
  return s.amp * Math.sin((x / s.wave) * Math.PI * 2 + s.phase);
}
