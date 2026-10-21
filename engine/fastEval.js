import { CATEGORY } from './constants.js';

/**
 * Score 5 to 7 cards as one integer: bigger wins, equal ties.
 *
 * handEval.js walks all 21 five-card subsets and builds objects, which is fine
 * for a showdown and far too slow for a simulation that needs tens of thousands
 * of evaluations per decision. This reads the whole hand in one pass from rank
 * counts and per-suit rank masks. It answers only "who wins" — names and the
 * best five cards still come from handEval.js.
 *
 * The score is category << 20 followed by up to five 4-bit tiebreak ranks, in
 * exactly the order handEval's `ranks` vector uses, so the two always agree.
 */

const SUIT_INDEX = { s: 0, h: 1, d: 2, c: 3 };

// Scratch space, reused on every call. The evaluator is synchronous and
// never re-entered, so sharing it is safe and saves the allocations.
const counts = new Uint8Array(15);
const suitMasks = new Int32Array(4);
const suitCounts = new Uint8Array(4);
const singles = new Uint8Array(7);

export function fastScore(cards, n = cards.length) {
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;

  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const si = SUIT_INDEX[c.s];
    counts[c.r]++;
    suitMasks[si] |= 1 << c.r;
    suitCounts[si]++;
    rankMask |= 1 << c.r;
  }

  // Five of one suit out of seven leaves too few cards for quads or a full
  // house, so a flush can be settled before looking at the groups.
  for (let si = 0; si < 4; si++) {
    if (suitCounts[si] < 5) continue;
    const mask = suitMasks[si];
    const sf = straightHigh(mask);
    if (sf) return pack(CATEGORY.STRAIGHT_FLUSH, sf);
    const top = [0, 0, 0, 0, 0];
    for (let r = 14, k = 0; r >= 2 && k < 5; r--) if (mask & (1 << r)) top[k++] = r;
    return pack(CATEGORY.FLUSH, top[0], top[1], top[2], top[3], top[4]);
  }

  let quad = 0, trip1 = 0, trip2 = 0, pair1 = 0, pair2 = 0, pair3 = 0, ns = 0;
  for (let r = 14; r >= 2; r--) {
    const k = counts[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (!trip1) trip1 = r; else trip2 = r; }
    else if (k === 2) { if (!pair1) pair1 = r; else if (!pair2) pair2 = r; else pair3 = r; }
    else if (k === 1) singles[ns++] = r;
  }
  for (let i = ns; i < 5; i++) singles[i] = 0;

  if (quad) {
    let kicker = 0;
    for (let r = 14; r >= 2; r--) if (r !== quad && counts[r]) { kicker = r; break; }
    return pack(CATEGORY.QUADS, quad, kicker);
  }
  if (trip1 && (trip2 || pair1)) return pack(CATEGORY.FULL_HOUSE, trip1, Math.max(trip2, pair1));

  const straight = straightHigh(rankMask);
  if (straight) return pack(CATEGORY.STRAIGHT, straight);

  if (trip1) return pack(CATEGORY.TRIPS, trip1, singles[0], singles[1]);
  if (pair2) return pack(CATEGORY.TWO_PAIR, pair1, pair2, Math.max(pair3, singles[0]));
  if (pair1) return pack(CATEGORY.PAIR, pair1, singles[0], singles[1], singles[2]);
  return pack(CATEGORY.HIGH_CARD, singles[0], singles[1], singles[2], singles[3], singles[4]);
}

/** Highest straight in a rank bitmask (bit r set = rank r present), or 0. */
function straightHigh(mask) {
  // The ace also plays low, as the bottom of A-2-3-4-5.
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let hi = 14; hi >= 5; hi--) {
    const run = 0x1f << (hi - 4);
    if ((mask & run) === run) return hi;
  }
  return 0;
}

function pack(category, a = 0, b = 0, c = 0, d = 0, e = 0) {
  return (category << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;
}

/** The category back out of a score, for code that only cares "is it a flush?". */
export const categoryOf = (score) => score >>> 20;
