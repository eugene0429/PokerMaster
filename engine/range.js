import { SUITS } from './constants.js';
import { fastScore } from './fastEval.js';

/**
 * A range is a Float64Array of 1326 weights, one per two-card combo, all
 * indexing the same shared ALL_COMBOS list. Working per combo rather than per
 * 169 hand classes is what makes card removal exact: an ace on the board takes
 * away exactly the ace combos that contain it.
 */

const RANK_CHARS = '__23456789TJQKA';
const SUIT_INDEX = { s: 0, h: 1, d: 2, c: 3 };

export const COMBO_COUNT = 1326;

/** 0..51, stable. Used for "is this card already out" bitmaps. */
export const cardId = (c) => (c.r - 2) * 4 + SUIT_INDEX[c.s];

/** 'AKs', 'AKo', 'QQ' — the higher rank always first. */
export function classOf(a, b) {
  const [hi, lo] = a.r >= b.r ? [a, b] : [b, a];
  const name = RANK_CHARS[hi.r] + RANK_CHARS[lo.r];
  if (hi.r === lo.r) return name;
  return name + (hi.s === lo.s ? 's' : 'o');
}

/**
 * The 169 starting hands, best first. Ordered by the mean z-score of all-in
 * equity against one random hand and against two, each over 40-60k seeded
 * runouts. Heads-up equity alone ranks A2o above 76s; adding the three-way
 * number gives suited and connected hands the credit they earn at a full table.
 */
export const HAND_ORDER = 'AA KK QQ JJ TT 99 88 AKs AQs AJs AKo 77 ATs AQo KQs AJo KJs A9s ATo KTs 66 KQo A8s QJs KJo A7s QTs K9s A9o KTo A5s A6s A8o 55 JTs QJo A4s Q9s K8s A7o QTo A3s K9o A2s K7s A5o J9s A6o JTo K6s Q8s 44 A4o K8o T9s Q9o K5s A3o K4s K7o J8s A2o Q7s K3s Q8o Q6s K6o J9o T8s K2s T9o J7s Q5s K5o 98s 33 K4o T7s Q4s J8o Q7o Q3s J6s 97s T8o Q6o K3o Q2s J5s 87s J7o K2o T6s Q5o 22 J4s 98o J3s 96s Q4o T7o 86s T5s 97o J6o J2s 76s Q3o T4s J5o Q2o 95s 87o T6o T3s J4o 85s 75s T2s 65s 96o J3o 94s T5o 93s 86o 76o 54s J2o 84s 74s T4o 64s 92s 95o T3o 85o 75o 53s 65o T2o 83s 63s 73s 82s 43s 94o 93o 84o 54o 52s 74o 72s 62s 64o 42s 92o 32s 83o 53o 63o 73o 82o 43o 52o 72o 62o 42o 32o'.split(' ');

export const ALL_COMBOS = (() => {
  const deck = [];
  for (let r = 2; r <= 14; r++) for (const s of SUITS) deck.push({ r, s });
  const out = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const a = deck[i];
      const b = deck[j];
      out.push(Object.freeze({ a, b, ia: cardId(a), ib: cardId(b), cls: classOf(a, b) }));
    }
  }
  return Object.freeze(out);
})();

const COMBO_BY_IDS = new Map(ALL_COMBOS.map((c, i) => [c.ia * 64 + c.ib, i]));

export function comboIndex(a, b) {
  const [x, y] = cardId(a) < cardId(b) ? [cardId(a), cardId(b)] : [cardId(b), cardId(a)];
  return COMBO_BY_IDS.get(x * 64 + y);
}

/**
 * Where each class sits, as the fraction of all 1326 combos at or above it.
 * AA is 6/1326 ≈ 0.0045; 32o is 1.0. "Top 20%" means percentile ≤ 0.2.
 */
export const CLASS_PERCENTILE = (() => {
  const out = {};
  let seen = 0;
  for (const cls of HAND_ORDER) {
    seen += cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12;
    out[cls] = seen / COMBO_COUNT;
  }
  return out;
})();

/** Per-combo percentile, precomputed so hot loops never touch strings. */
export const COMBO_PERCENTILE = Float64Array.from(ALL_COMBOS, (c) => CLASS_PERCENTILE[c.cls]);

export function fullRange() {
  return new Float64Array(COMBO_COUNT).fill(1);
}

/** Every combo whose class is inside the best `fraction` of hands. */
export function topPercent(fraction) {
  const w = new Float64Array(COMBO_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) if (COMBO_PERCENTILE[i] <= fraction + 1e-9) w[i] = 1;
  return w;
}

/** Weight by preflop percentile: fn(percentile) -> weight. */
export function rangeFrom(fn) {
  return Float64Array.from(COMBO_PERCENTILE, (p) => Math.max(0, fn(p)));
}

/** A copy with every combo that uses one of `cards` set to zero. */
export function removeCards(range, cards) {
  const dead = new Uint8Array(52);
  for (const c of cards) dead[cardId(c)] = 1;
  const out = Float64Array.from(range);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const c = ALL_COMBOS[i];
    if (dead[c.ia] || dead[c.ib]) out[i] = 0;
  }
  return out;
}

export function totalWeight(range) {
  let t = 0;
  for (let i = 0; i < COMBO_COUNT; i++) t += range[i];
  return t;
}

/**
 * How good each combo is on this board right now, 0..1: the share of all
 * other holdings its made hand beats, plus credit for live draws. It is the
 * yardstick for "what does this player continue with" — not an equity.
 * Combos that use a board card are left at 0.
 */
export function boardStrength(board) {
  const out = new Float64Array(COMBO_COUNT);
  const dead = new Uint8Array(52);
  for (const c of board) dead[cardId(c)] = 1;

  const cards = [null, null, ...board];
  const n = board.length + 2;
  const scores = new Float64Array(COMBO_COUNT).fill(-1);
  const live = [];
  for (let i = 0; i < COMBO_COUNT; i++) {
    const c = ALL_COMBOS[i];
    if (dead[c.ia] || dead[c.ib]) continue;
    cards[0] = c.a;
    cards[1] = c.b;
    scores[i] = fastScore(cards, n);
    live.push(i);
  }

  // Rank the live combos by score; ties share the average rank.
  live.sort((x, y) => scores[x] - scores[y]);
  for (let k = 0; k < live.length; ) {
    let j = k;
    while (j + 1 < live.length && scores[live[j + 1]] === scores[live[k]]) j++;
    const pct = live.length > 1 ? ((k + j) / 2) / (live.length - 1) : 1;
    for (let m = k; m <= j; m++) out[live[m]] = pct;
    k = j + 1;
  }

  if (board.length < 5) {
    const bonus = board.length === 3 ? 1 : 0.8;   // one card to come pays less
    for (const i of live) {
      const c = ALL_COMBOS[i];
      out[i] = Math.min(1, out[i] + drawCredit(c.a, c.b, board) * bonus);
    }
  }
  return out;
}

/** Flush draws and straight draws that use at least one hole card. */
function drawCredit(a, b, board) {
  let credit = 0;
  for (const s of SUITS) {
    const onBoard = board.filter((c) => c.s === s).length;
    const inHand = (a.s === s) + (b.s === s);
    if (inHand > 0 && onBoard + inHand === 4) { credit += 0.25; break; }
  }
  const all = [a, b, ...board];
  const mask = all.reduce((m, c) => m | (1 << c.r) | (c.r === 14 ? 2 : 0), 0);
  const without = board.reduce((m, c) => m | (1 << c.r) | (c.r === 14 ? 2 : 0), 0);
  let outs = 0;
  for (let r = 1; r <= 14; r++) {
    if (mask & (1 << r)) continue;
    const m = mask | (1 << r);
    for (let hi = Math.min(14, r + 4); hi >= Math.max(5, r); hi--) {
      const run = 0x1f << (hi - 4);
      // A straight the board alone would also make is not our draw.
      if ((m & run) === run && ((without | (1 << r)) & run) !== run) { outs++; break; }
    }
  }
  if (outs >= 2) credit += 0.2;          // open-ended or double gutter
  else if (outs === 1) credit += 0.08;   // gutshot
  return credit;
}

/**
 * The best `fraction` of a range by `strength`, as a 0/1 mask. Weight, not
 * combo count, decides where the line falls.
 */
export function topOfRange(range, strength, fraction) {
  const idx = [];
  let total = 0;
  for (let i = 0; i < COMBO_COUNT; i++) if (range[i] > 0) { idx.push(i); total += range[i]; }
  idx.sort((x, y) => strength[y] - strength[x]);
  const mask = new Uint8Array(COMBO_COUNT);
  let kept = 0;
  for (const i of idx) {
    if (kept >= total * fraction) break;
    mask[i] = 1;
    kept += range[i];
  }
  return mask;
}
