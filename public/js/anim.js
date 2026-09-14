/**
 * Transient motion that sits on top of the rendered table: chips flying into
 * the pot, the pot sliding to the winner. The table itself is always drawn
 * from the current snapshot, so these are decoration — if one is skipped the
 * board is still correct.
 */

import { chipStackEl } from './chips.js';

let fxLayer = null;
let tableEl = null;

export function initAnim({ fx, table }) {
  fxLayer = fx;
  tableEl = table;
}

/** Position of a DOM node relative to the table, in px. */
export function localCenter(el) {
  if (!el || !tableEl) return null;
  const a = el.getBoundingClientRect();
  const t = tableEl.getBoundingClientRect();
  if (a.width === 0 && a.height === 0) return null;
  return { x: a.left - t.left + a.width / 2, y: a.top - t.top + a.height / 2 };
}

/** Percent coordinates on the table converted to local px. */
export function percentToLocal({ x, y }) {
  const t = tableEl.getBoundingClientRect();
  return { x: (x / 100) * t.width, y: (y / 100) * t.height };
}

export function flyChips(from, to, amount, { duration = 520, delay = 0, label = false } = {}) {
  if (!fxLayer || !from || !to) return;
  const node = chipStackEl(amount, { label });
  node.classList.add('fly');
  node.style.left = `${from.x}px`;
  node.style.top = `${from.y}px`;
  node.style.transform = 'translate(-50%, -50%)';
  node.style.transitionDuration = `${duration}ms`;
  node.style.transitionDelay = `${delay}ms`;
  fxLayer.appendChild(node);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      node.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(.9)`;
      node.style.opacity = '0';
    });
  });
  setTimeout(() => node.remove(), duration + delay + 260);
}

/** A short golden burst where the pot lands. */
export function sparkle(at) {
  if (!fxLayer || !at) return;
  const node = document.createElement('div');
  node.className = 'fly';
  node.style.cssText = `left:${at.x}px;top:${at.y}px;width:10px;height:10px;border-radius:50%;
    background:radial-gradient(circle,#ffe9b0,rgba(216,179,94,0));transition:transform .5s ease-out,opacity .5s ease-out;`;
  fxLayer.appendChild(node);
  requestAnimationFrame(() => {
    node.style.transform = 'translate(-50%,-50%) scale(14)';
    node.style.opacity = '0';
  });
  setTimeout(() => node.remove(), 800);
}
