import { ACTION, CATEGORY } from '../engine/constants.js';
import { evaluateHand } from '../engine/handEval.js';

/**
 * Rule-based opponents. Not strong — the point is that they fold, call and
 * raise for recognisable reasons so practising against them isn't nonsense.
 */

const CHEN_POINTS = { 14: 10, 13: 8, 12: 7, 11: 6 };
const pointsFor = (r) => CHEN_POINTS[r] ?? r / 2;

/** Chen formula: a cheap, well-known preflop strength score (roughly -1..20). */
export function preflopScore(cards) {
  const [a, b] = [...cards].sort((x, y) => y.r - x.r);
  let score = pointsFor(a.r);

  if (a.r === b.r) return Math.max(score * 2, 5);

  if (a.s === b.s) score += 2;

  const gap = a.r - b.r - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;

  if (gap <= 1 && a.r < 12) score += 1;
  return Math.ceil(score);
}

/** 0..1, how good the made hand looks on this board. */
function postflopStrength(hole, board) {
  const ev = evaluateHand([...hole, ...board]);
  const boardEv = board.length >= 5 ? evaluateHand(board) : null;

  let base;
  switch (ev.category) {
    case CATEGORY.STRAIGHT_FLUSH:
    case CATEGORY.QUADS: base = 1.0; break;
    case CATEGORY.FULL_HOUSE: base = 0.95; break;
    case CATEGORY.FLUSH: base = 0.88; break;
    case CATEGORY.STRAIGHT: base = 0.82; break;
    case CATEGORY.TRIPS: base = 0.75; break;
    case CATEGORY.TWO_PAIR: base = 0.62; break;
    case CATEGORY.PAIR: base = pairQuality(hole, board); break;
    default: base = 0.15 + highCardBonus(hole); break;
  }

  // If the board itself already makes the hand, nobody is folding to us.
  if (boardEv && ev.category === boardEv.category && ev.ranks[0] === boardEv.ranks[0]) {
    base = Math.min(base, 0.35);
  }
  return Math.max(0, Math.min(1, base));
}

function pairQuality(hole, board) {
  const boardRanks = board.map((c) => c.r).sort((a, b) => b - a);
  const topBoard = boardRanks[0] ?? 0;
  const pocket = hole[0].r === hole[1].r;
  const holeRanks = hole.map((c) => c.r);

  if (pocket && hole[0].r > topBoard) return 0.7;          // overpair
  if (holeRanks.includes(topBoard)) return 0.55;           // top pair
  if (holeRanks.some((r) => boardRanks.includes(r))) return 0.35; // weaker pair
  if (pocket) return 0.3;                                  // underpair
  return 0.2;
}

function highCardBonus(hole) {
  const hi = Math.max(hole[0].r, hole[1].r);
  return hi >= 13 ? 0.12 : hi >= 11 ? 0.06 : 0;
}

/** Count flush and open-ended straight draws so bots chase reasonably. */
function drawBonus(hole, board) {
  if (board.length >= 5) return 0;
  const all = [...hole, ...board];
  let bonus = 0;

  const suitCounts = {};
  for (const c of all) suitCounts[c.s] = (suitCounts[c.s] ?? 0) + 1;
  if (Object.values(suitCounts).some((n) => n === 4)) bonus += 0.22;

  const ranks = [...new Set(all.map((c) => c.r))].sort((a, b) => a - b);
  for (let i = 0; i + 3 < ranks.length; i++) {
    if (ranks[i + 3] - ranks[i] === 3) { bonus += 0.16; break; }
  }
  return bonus;
}

export function decideBotAction(state, seat, legal, rand = Math.random) {
  const p = state.players[seat];
  const potAfterCall = state.potCollected
    + state.players.filter(Boolean).reduce((s, q) => s + q.streetCommitted, 0)
    + legal.toCall;
  const potOdds = legal.toCall > 0 ? legal.toCall / potAfterCall : 0;

  const strength = state.board.length === 0
    ? Math.min(1, Math.max(0, (preflopScore(p.cards) - 4) / 14))
    : Math.min(1, postflopStrength(p.cards, state.board) + drawBonus(p.cards, state.board));

  const noise = (rand() - 0.5) * 0.12;
  const s = Math.max(0, Math.min(1, strength + noise));

  // Nothing to call: bet with a good hand, occasionally bluff, otherwise check.
  if (legal.canCheck) {
    const bluff = rand() < 0.12;
    if (legal.canRaise && (s > 0.58 || bluff)) {
      return { type: ACTION.RAISE, amount: sizedRaise(state, legal, s, rand) };
    }
    return { type: ACTION.CHECK };
  }

  // Facing a bet.
  if (legal.canRaise && s > 0.80 && rand() < 0.6) {
    return { type: ACTION.RAISE, amount: sizedRaise(state, legal, s, rand) };
  }
  if (s > potOdds + 0.12) return { type: ACTION.CALL };
  if (legal.toCall <= state.blinds.bb && s > 0.2) return { type: ACTION.CALL };
  return { type: ACTION.FOLD };
}

function sizedRaise(state, legal, strength, rand) {
  const pot = state.potCollected
    + state.players.filter(Boolean).reduce((s, q) => s + q.streetCommitted, 0);
  const fraction = 0.5 + rand() * 0.35 + (strength > 0.9 ? 0.25 : 0);
  const target = state.currentBet + Math.round(pot * fraction);

  // Shove instead of leaving a token amount behind.
  if (target > legal.maxRaiseTo * 0.75) return legal.maxRaiseTo;
  return Math.max(legal.minRaiseTo, Math.min(target, legal.maxRaiseTo));
}

const BOT_NAMES = [
  'Doyle', 'Stu', 'Phil', 'Vanessa', 'Daniel', 'Chris', 'Jennifer',
  'Erik', 'Johnny', 'Fedor', 'Isildur', 'Maria',
];

export function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)] + (free.length ? '' : ` ${taken.length}`);
}

/** Bots pause long enough that the table doesn't feel like a spreadsheet. */
export function botThinkingTime() {
  return 900 + Math.random() * 1500;
}
