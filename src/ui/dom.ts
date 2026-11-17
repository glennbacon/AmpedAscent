// Tiny DOM helpers — the menus are plain HTML/CSS, no framework.

import { icon, IconName } from './icons';

type Kid = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any> | null, ...kids: (Kid | Kid[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list') (el as any)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export interface BtnOpts {
  icon?: IconName;
  cls?: string;
  sub?: string;
  title?: string;
  disabled?: boolean;
  badge?: boolean;
}

/** Standard button. `onTap` fires on click (pointer or keyboard). */
export function btn(label: string, onTap: (e: Event) => void, o: BtnOpts = {}): HTMLButtonElement {
  const b = h('button', { class: `btn ${o.cls ?? ''}${o.sub ? ' col' : ''}`, type: 'button', title: o.title, disabled: o.disabled });
  const line = h('span', { html: `${o.icon ? icon(o.icon) : ''}${label ? `<span class="lbl">${label}</span>` : ''}`, style: { display: 'inline-flex', alignItems: 'center', gap: '0.5em' } });
  b.append(line);
  if (o.sub) b.append(h('span', { class: 'sub' }, o.sub));
  if (o.badge) b.append(h('i', { class: 'badge' }));
  if (!label && o.title) b.setAttribute('aria-label', o.title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap(e);
  });
  return b;
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
