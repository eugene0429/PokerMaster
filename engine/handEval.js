import { CATEGORY, RANK_NAME, RANK_PLURAL } from './constants.js';

/** All 21 ways to choose 5 indices out of 7. Precomputed once. */
const COMBOS_7C5 = (() => {
  const out = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) out.push([a, b, c, d, e]);
  return out;
})();

/**
 * Evaluate exactly 5 cards.
 * Returns { category, ranks } where `ranks` is the tiebreak vector, most
 * significant first. Two hands of the same category compare by `ranks`.
 */
export function evaluate5(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const firstSuit = cards[0].s;
  const isFlush = cards.every((c) => c.s === firstSuit);

  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Sort by count desc, then rank desc. This ordering IS the tiebreak order
  // for every group-based category (quads, boat, trips, two pair, pair, high card).
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const groupRanks = groups.map((g) => g[0]);
  const topCount = groups[0][1];
  const secondCount = groups[1]?.[1] ?? 0;

  const straightHigh = straightHighOf(ranks);

  if (straightHigh && isFlush) return { category: CATEGORY.STRAIGHT_FLUSH, ranks: [straightHigh] };
  if (topCount === 4) return { category: CATEGORY.QUADS, ranks: groupRanks };
  if (topCount === 3 && secondCount === 2) return { category: CATEGORY.FULL_HOUSE, ranks: groupRanks };
  if (isFlush) return { category: CATEGORY.FLUSH, ranks };
  if (straightHigh) return { category: CATEGORY.STRAIGHT, ranks: [straightHigh] };
  if (topCount === 3) return { category: CATEGORY.TRIPS, ranks: groupRanks };
  if (topCount === 2 && secondCount === 2) return { category: CATEGORY.TWO_PAIR, ranks: groupRanks };
  if (topCount === 2) return { category: CATEGORY.PAIR, ranks: groupRanks };
  return { category: CATEGORY.HIGH_CARD, ranks };
}

/** `ranks` must be sorted desc. Returns the straight's high card, or 0. */
function straightHighOf(ranks) {
  const uniq = [...new Set(ranks)];
  if (uniq.length !== 5) return 0;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  // Wheel: A-5-4-3-2 plays as a five-high straight.
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return 0;
}

/** Best 5-card hand out of 7 (or any 5..7 cards). */
export function evaluateHand(cards) {
  if (cards.length === 5) {
    const ev = evaluate5(cards);
    return { ...ev, cards: cards.slice() };
  }
  if (cards.length < 5) throw new Error(`need at least 5 cards, got ${cards.length}`);

  const combos = cards.length === 7 ? COMBOS_7C5 : combosOf(cards.length, 5);
  let best = null;
  let bestCards = null;
  for (const idx of combos) {
    const five = idx.map((i) => cards[i]);
    const ev = evaluate5(five);
    if (best === null || compareHands(ev, best) > 0) {
      best = ev;
      bestCards = five;
    }
  }
  return { ...best, cards: bestCards };
}

function combosOf(n, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) return void out.push(acc.slice());
    for (let i = start; i < n; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

/** > 0 if a beats b, < 0 if b beats a, 0 if exactly tied. */
export function compareHands(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < len; i++) {
    const d = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function handName(ev) {
  const [a, b] = ev.ranks;
  switch (ev.category) {
    case CATEGORY.STRAIGHT_FLUSH:
      return a === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAME[a]} high`;
    case CATEGORY.QUADS:
      return `Four of a Kind, ${RANK_PLURAL[a]}`;
    case CATEGORY.FULL_HOUSE:
      return `Full House, ${RANK_PLURAL[a]} full of ${RANK_PLURAL[b]}`;
    case CATEGORY.FLUSH:
      return `Flush, ${RANK_NAME[a]} high`;
    case CATEGORY.STRAIGHT:
      return `Straight, ${RANK_NAME[a]} high`;
    case CATEGORY.TRIPS:
      return `Three of a Kind, ${RANK_PLURAL[a]}`;
    case CATEGORY.TWO_PAIR:
      return `Two Pair, ${RANK_PLURAL[a]} and ${RANK_PLURAL[b]}`;
    case CATEGORY.PAIR:
      return `Pair of ${RANK_PLURAL[a]}`;
    default:
      return `High Card, ${RANK_NAME[a]}`;
  }
}
