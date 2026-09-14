/**
 * Playing cards drawn as SVG. No image assets: crisp at any size, nothing to
 * download, and the pip layout is the classic one rather than a big centred glyph.
 */

const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_LABEL = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const COLORS_TWO = { s: '#16181d', c: '#16181d', h: '#c8102e', d: '#c8102e' };
const COLORS_FOUR = { s: '#16181d', c: '#1a7f4b', h: '#c8102e', d: '#1f63c4' };

let fourColor = false;
export function setFourColor(on) { fourColor = !!on; }
export function suitColor(suit) {
  return (fourColor ? COLORS_FOUR : COLORS_TWO)[suit];
}

const COL = { L: 32, C: 50, R: 68 };
const ROW = [28, 49, 70, 91, 112];
const rowY = (i) => (Number.isInteger(i) ? ROW[i] : (ROW[Math.floor(i)] + ROW[Math.ceil(i)]) / 2);

// Where the pips sit for each rank, the way a real deck lays them out.
const PIPS = {
  2: [[COL.C, 0], [COL.C, 4]],
  3: [[COL.C, 0], [COL.C, 2], [COL.C, 4]],
  4: [[COL.L, 0], [COL.R, 0], [COL.L, 4], [COL.R, 4]],
  5: [[COL.L, 0], [COL.R, 0], [COL.C, 2], [COL.L, 4], [COL.R, 4]],
  6: [[COL.L, 0], [COL.R, 0], [COL.L, 2], [COL.R, 2], [COL.L, 4], [COL.R, 4]],
  7: [[COL.L, 0], [COL.R, 0], [COL.C, 1], [COL.L, 2], [COL.R, 2], [COL.L, 4], [COL.R, 4]],
  8: [[COL.L, 0], [COL.R, 0], [COL.C, 1], [COL.L, 2], [COL.R, 2], [COL.C, 3], [COL.L, 4], [COL.R, 4]],
  9: [[COL.L, 0], [COL.R, 0], [COL.L, 1], [COL.R, 1], [COL.C, 2], [COL.L, 3], [COL.R, 3], [COL.L, 4], [COL.R, 4]],
  10: [[COL.L, 0], [COL.R, 0], [COL.C, 0.5], [COL.L, 1], [COL.R, 1], [COL.L, 3], [COL.R, 3], [COL.C, 3.5], [COL.L, 4], [COL.R, 4]],
};

export function cardFaceSVG(card) {
  const glyph = SUIT_GLYPH[card.s];
  const color = suitColor(card.s);
  const label = RANK_LABEL[card.r];
  const isBroadway = card.r >= 11;

  const corner = (x, y, flip) => `
    <g transform="translate(${x} ${y})${flip ? ' rotate(180)' : ''}" fill="${color}">
      <text class="pm-rank" x="0" y="0" text-anchor="middle">${label}</text>
      <text class="pm-corner-suit" x="0" y="16" text-anchor="middle">${glyph}</text>
    </g>`;

  let centre;
  if (card.r === 14) {
    centre = `<text class="pm-ace" x="50" y="72" text-anchor="middle" fill="${color}">${glyph}</text>`;
  } else if (isBroadway) {
    centre = `
      <rect x="24" y="26" width="52" height="88" rx="5" fill="none" stroke="${color}" stroke-width="1.4" opacity=".45"/>
      <text class="pm-court" x="50" y="66" text-anchor="middle" fill="${color}">${label}</text>
      <text class="pm-court-suit" x="50" y="97" text-anchor="middle" fill="${color}">${glyph}</text>`;
  } else {
    centre = (PIPS[card.r] ?? []).map(([x, r]) => {
      const y = rowY(r);
      const flip = r > 2 ? ` transform="rotate(180 ${x} ${y})"` : '';
      return `<text class="pm-pip" x="${x}" y="${y}" text-anchor="middle" fill="${color}"${flip}>${glyph}</text>`;
    }).join('');
  }

  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">
    <rect x="1" y="1" width="98" height="138" rx="8" fill="#fdfcf8" stroke="rgba(0,0,0,.22)" stroke-width="1"/>
    ${corner(12, 21, false)}
    ${corner(88, 119, true)}
    ${centre}
  </svg>`;
}

export function cardBackSVG() {
  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">
    <defs>
      <pattern id="pm-back" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="12" fill="#7d1220"/>
        <path d="M0 6h12M6 0v12" stroke="rgba(255,255,255,.16)" stroke-width="1.6"/>
      </pattern>
    </defs>
    <rect x="1" y="1" width="98" height="138" rx="8" fill="#fdfcf8" stroke="rgba(0,0,0,.25)"/>
    <rect x="5" y="5" width="90" height="130" rx="5" fill="url(#pm-back)"/>
    <rect x="5" y="5" width="90" height="130" rx="5" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>
    <circle cx="50" cy="70" r="17" fill="rgba(0,0,0,.22)"/>
    <circle cx="50" cy="70" r="17" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/>
    <text x="50" y="70" text-anchor="middle" dominant-baseline="central"
          font-size="17" fill="rgba(255,255,255,.75)" font-family="Georgia, serif">♠</text>
  </svg>`;
}

export function cardKey(card) {
  return card ? `${card.r}${card.s}` : 'back';
}

export function cardLabel(card) {
  return `${RANK_LABEL[card.r]}${SUIT_GLYPH[card.s]}`;
}
