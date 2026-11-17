// One drawn icon set for everything: HUD chips, menu buttons, and the faces of the 3D pickup
// tokens (rasterised from the same SVG). 24×24 design space, stroke/fill follow `currentColor`.

import type { PowerupKind } from '../sim/powerups';

const wrap = (body: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

const F = 'fill="currentColor" stroke="none"';

export const ICONS = {
  bolt: wrap(`<path ${F} d="M13.5 1.5 4 13.5h6.2L8.6 22.5 20 9.6h-6.6z"/>`),
  flag: wrap(`<path d="M5 22V3"/><path ${F} d="M5 3.5h13.5l-3 4.2 3 4.3H5z"/>`),
  pencil: wrap(`<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.6z"/><path d="M14.5 6l3.5 3.5"/>`),
  wrench: wrap(`<path d="M20.4 6.4l-3.2 3.2-2.8-2.8 3.2-3.2a5 5 0 0 0-6.5 6.2L3.6 17.3a2.2 2.2 0 0 0 3.1 3.1l7.5-7.5a5 5 0 0 0 6.2-6.5z"/>`),
  gear: wrap(`<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>`),
  home: wrap(`<path d="M3.5 11 12 3.5l8.5 7.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>`),
  play: wrap(`<path ${F} d="M7 4.2v15.6a.8.8 0 0 0 1.2.7l12.4-7.8a.8.8 0 0 0 0-1.4L8.2 3.5A.8.8 0 0 0 7 4.2z"/>`),
  pause: wrap(`<path ${F} d="M6 4h4.2v16H6zM13.8 4H18v16h-4.2z"/>`),
  restart: wrap(`<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M3.5 3.5v4.8h4.8"/>`),
  lock: wrap(`<rect x="5" y="10.5" width="14" height="10" rx="2" ${F}/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>`),
  star: wrap(`<path ${F} d="M12 2.2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.3l-6 3.3 1.3-6.7-5-4.7 6.8-.8z"/>`),
  coin: wrap(`<circle cx="12" cy="12" r="9.5" ${F}/><path fill="#7a4a00" stroke="none" d="M13 5.5 7.8 13h3.6l-.9 5.5L16.2 11h-3.7z"/>`),
  speaker: wrap(`<path ${F} d="M3.5 9.2v5.6h3.8l5.2 4.2V5L7.3 9.2z"/><path d="M16 8.6a5 5 0 0 1 0 6.8M18.6 6a8.6 8.6 0 0 1 0 12"/>`),
  speakerOff: wrap(`<path ${F} d="M3.5 9.2v5.6h3.8l5.2 4.2V5L7.3 9.2z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>`),
  music: wrap(`<path d="M9 18V5.5l11-2.2V16"/><circle cx="6.5" cy="18" r="2.6" ${F}/><circle cx="17.5" cy="16" r="2.6" ${F}/>`),
  vibe: wrap(`<rect x="8" y="3.5" width="8" height="17" rx="2"/><path d="M4.5 8.5v7M1.8 10.5v3M19.5 8.5v7M22.2 10.5v3"/>`),
  trash: wrap(`<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14M10 10.5v6M14 10.5v6"/>`),
  undo: wrap(`<path d="M8.5 5 4 9.5 8.5 14"/><path d="M4 9.5h10a6 6 0 0 1 0 12h-3"/>`),
  plus: wrap(`<path d="M12 4.5v15M4.5 12h15"/>`),
  minus: wrap(`<path d="M4.5 12h15"/>`),
  close: wrap(`<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>`),
  check: wrap(`<path d="M4.5 12.5l5 5 10-11"/>`),
  chevL: wrap(`<path d="M15 4.5 7.5 12 15 19.5"/>`),
  chevR: wrap(`<path d="M9 4.5 16.5 12 9 19.5"/>`),
  mountain: wrap(`<path d="M2.5 19.5 9 8l4 6.5 2.5-3.5 6 8.5z"/>`),
  box: wrap(`<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>`),
  eraser: wrap(`<path d="M8.5 20 3.5 15 13.5 5l6.5 6.5L11.5 20z"/><path d="M8.5 20H21M9.5 9l6.5 6.5"/>`),
  save: wrap(`<path d="M5 3.5h11.5L20.5 7.5V20.5H3.5V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M7.5 3.5v5h8v-5M7 20.5v-7h10v7"/>`),
  jump: wrap(`<path d="M5 13l7-7.5 7 7.5"/><path d="M5 19.5l7-7.5 7 7.5"/>`),
  heart: wrap(`<path ${F} d="M12 20.8S3.2 15.4 3.2 8.9A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.8 2.5c0 6.5-8.8 11.9-8.8 11.9z"/>`),
  share: wrap(`<path d="M12 15.5V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v8h14v-8"/>`),
  ruler: wrap(`<path d="M2.5 16.5 16.5 2.5l5 5-14 14z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>`),
  expand: wrap(`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`),
  info: wrap(`<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.2v.6"/>`),
  // ---- power-ups ----
  turbo: wrap(`<path ${F} d="M12.5 1.8c1 3.6 5.6 5.6 5.6 11a6.1 6.1 0 0 1-12.2 0c0-2 .7-3.6 1.8-4.8.2 1.6.9 2.6 2 3.1-.4-3.6 1-6.8 2.8-9.3z"/><path fill="#fff" fill-opacity=".55" stroke="none" d="M12 12.5c1.2 1.3 2.2 2.3 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1.4.9-2.3 2.2-4z"/>`),
  magnet: wrap(`<path d="M5 3.5v8a7 7 0 0 0 14 0v-8h-4.5v8a2.5 2.5 0 0 1-5 0v-8z" ${F}/><path stroke="#fff" stroke-width="2.4" d="M5 6.6h4.5M14.5 6.6H19"/>`),
  frenzy: wrap(`<circle cx="8.5" cy="15" r="5.5" ${F}/><circle cx="16.5" cy="9" r="4.5" ${F}/><path stroke="#fff" stroke-opacity=".6" stroke-width="1.6" d="M8.5 12.5v5M16.5 7v4M3 4.5l1.6 1.6M12 2.5v2M21 17l-1.6-1"/>`),
  wheelie: wrap(`<circle cx="7" cy="17.5" r="4" stroke-width="2.6"/><path d="M9.5 14.5 19 6"/><circle cx="19" cy="6" r="2.6" ${F}/><path d="M3 22h18"/>`),
  backflip: wrap(`<path d="M19.5 12a7.5 7.5 0 1 1-3-6" stroke-width="2.6"/><path ${F} d="M14.2 2.2l5.8 3.2-5.2 3.9z"/><circle cx="12" cy="12" r="2.2" ${F}/>`),
  jumpjets: wrap(`<path ${F} d="M7 2.5h4v9H7zM13 2.5h4v9h-4z"/><path ${F} d="M6 11.5h6l-1 3H7zM12 11.5h6l-1 3h-4z" opacity=".7"/><path d="M9 17v4.5M15 17v4.5" stroke-width="2.8"/>`),
  rollbar: wrap(`<path d="M3 20.5V13a9 9 0 0 1 18 0v7.5" stroke-width="2.8"/><path d="M3 20.5h18M7.5 20.5l9-12M16.5 20.5l-9-12"/>`),
  supersized: wrap(`<path ${F} d="M12 2.5c5.6 0 9.5 3.9 9.5 8.2 0 1.5-1.2 2.3-2.6 2.3H5.1c-1.4 0-2.6-.8-2.6-2.3 0-4.3 3.9-8.2 9.5-8.2z"/><path ${F} opacity=".75" d="M8.5 13h7l1 6.3a2.2 2.2 0 0 1-2.2 2.2H9.7a2.2 2.2 0 0 1-2.2-2.2z"/><circle cx="8" cy="8.6" r="1.7" fill="#fff" stroke="none"/><circle cx="15.5" cy="7" r="2" fill="#fff" stroke="none"/><circle cx="12.6" cy="11" r="1.1" fill="#fff" stroke="none"/>`),
  stuntfever: wrap(`<path ${F} d="M12 1.8l2.6 6.3 6.9.5-5.3 4.4 1.7 6.7L12 16.1l-5.9 3.6 1.7-6.7-5.3-4.4 6.9-.5z"/><path d="M5 22c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0" stroke-width="1.8"/>`),
} as const;

export type IconName = keyof typeof ICONS;

export const POWERUP_ICON: Record<PowerupKind, IconName> = {
  turbo: 'turbo', magnet: 'magnet', frenzy: 'frenzy', wheelie: 'wheelie', backflip: 'backflip',
  jumpjets: 'jumpjets', rollbar: 'rollbar', supersized: 'supersized', stuntfever: 'stuntfever',
};

/** Inline SVG markup for the DOM. */
export function icon(name: IconName, cls = ''): string {
  return `<span class="ico ${cls}" aria-hidden="true">${ICONS[name]}</span>`;
}

/** Data URL of an icon in a fixed colour (for canvas/WebGL textures). */
export function iconDataUrl(name: IconName, color: string): string {
  const svg = ICONS[name].replace(/currentColor/g, color).replace('<svg ', '<svg width="256" height="256" ');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
