/** Chip stacks: the amount decomposed into coloured denominations. */

const DENOMS = [
  { value: 25000, color: '#e0a11a', edge: '#a8760a' },
  { value: 5000, color: '#1f1f28', edge: '#4a4a58' },
  { value: 1000, color: '#7a3bb5', edge: '#4d2077' },
  { value: 500, color: '#1f63c4', edge: '#123f84' },
  { value: 100, color: '#0f7a4a', edge: '#095232' },
  { value: 25, color: '#c8102e', edge: '#8b0a1f' },
  { value: 5, color: '#f3f1ea', edge: '#c3bfb2' },
  { value: 1, color: '#8a8f99', edge: '#5c6169' },
];

const MAX_DISCS = 9;

export function chipBreakdown(amount) {
  let left = Math.max(0, Math.round(amount));
  const discs = [];
  for (const d of DENOMS) {
    while (left >= d.value && discs.length < MAX_DISCS) {
      discs.push(d);
      left -= d.value;
    }
    if (discs.length >= MAX_DISCS) break;
  }
  if (left > 0 && discs.length === 0) discs.push(DENOMS[DENOMS.length - 1]);
  return discs;
}

/** Returns an element: a little stack of discs with the amount underneath. */
export function chipStackEl(amount, { label = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chip-stack';

  const pile = document.createElement('div');
  pile.className = 'chip-pile';
  const discs = chipBreakdown(amount);
  discs.forEach((d, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.setProperty('--chip-color', d.color);
    chip.style.setProperty('--chip-edge', d.edge);
    chip.style.setProperty('--i', String(i));
    pile.appendChild(chip);
  });
  wrap.appendChild(pile);

  if (label) {
    const text = document.createElement('span');
    text.className = 'chip-amount';
    text.textContent = formatChips(amount);
    wrap.appendChild(text);
  }
  return wrap;
}

export function formatChips(n) {
  return Math.round(n).toLocaleString('en-US');
}
