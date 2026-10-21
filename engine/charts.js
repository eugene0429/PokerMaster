import { CLASS_PERCENTILE } from './range.js';

/**
 * Preflop reference ranges, as fractions of all hands. They are the
 * population model two ways round: what a bot opens with, and what a bot
 * assumes somebody else opened with. Approximations of common 6-max and
 * full-ring charts, keyed on how many players are still to act behind the
 * raiser, which is what actually sets how wide an open can be.
 */

/** Opening range when everyone before you folded. */
export function rfiPercent(behind, playersDealt) {
  if (playersDealt === 2) return 0.8;               // heads-up button
  const table = [0, 0.4, 0.45, 0.27, 0.2, 0.16, 0.13, 0.11, 0.1, 0.09];
  return table[Math.min(behind, table.length - 1)];
}

/** Of an opener's range, how much a good player re-raises for value. */
export const THREE_BET_SHARE = 0.3;
/** Of an opener's range, how much a good player flats in position. */
export const FLAT_SHARE_IP = 0.7;
/** The big blind is getting a price and closes the action: defend wider. */
export const BB_DEFEND = (openPct) => Math.min(0.6, openPct * 1.2 + 0.1);
/** Against a 3-bet: 4-bet this share of the 3-bettor's range, call this share. */
export const FOUR_BET_SHARE = 0.35;
export const CALL_THREE_BET_SHARE = 0.9;

/**
 * Hands that play well enough postflop to open or flat wider than their
 * all-in equity suggests: pocket pairs, and suited connectors from 54s up.
 */
export function isSpeculative(cls) {
  if (cls.length === 2) return true;
  if (!cls.endsWith('s')) return false;
  const ranks = '23456789TJQKA';
  const hi = ranks.indexOf(cls[0]);
  const lo = ranks.indexOf(cls[1]);
  return hi - lo === 1 && lo >= 2;
}

/** Is `cls` inside a range of width `pct`, counting speculative hands generously? */
export function inRange(cls, pct) {
  const p = CLASS_PERCENTILE[cls];
  if (p <= pct) return true;
  return pct >= 0.15 && isSpeculative(cls) && p <= pct * 2.2;
}

/**
 * Shove-or-fold width for a short stack, by effective stack in big blinds.
 * Roughly the push charts: wide from late position, tight from early.
 */
export function pushPercent(behind, playersDealt, effBB) {
  const base = playersDealt === 2 ? 0.7 : [0, 0.5, 0.4, 0.28, 0.2, 0.15, 0.12, 0.1, 0.09, 0.08][Math.min(behind, 9)];
  return Math.min(0.95, base * Math.pow(15 / Math.max(effBB, 1), 0.7));
}
