import { ACTION, CATEGORY } from '../engine/constants.js';
import { evaluateHand } from '../engine/handEval.js';
import { DEFAULT_PROFILE } from './bot-profiles.js';

/**
 * Rule-based opponents with personalities. Not strong players — the point is
 * that each one folds, calls and raises for its own recognisable reasons, so
 * there is something to read.
 *
 * Every return value is passed through safe() and is guaranteed legal.
 */

/* -------------------------- hand strength -------------------------- */

const CHEN_POINTS = { 14: 10, 13: 8, 12: 7, 11: 6 };
const pointsFor = (r) => CHEN_POINTS[r] ?? r / 2;

/**
 * Chen formula, roughly -1..20. The published version rounds up; we keep the
 * fraction. Rounding collapses 169 starting hands onto ~15 rungs, and the gaps
 * between rungs are wide enough that a threshold cannot sit between "6% of
 * hands" and "20% of hands" — which is exactly where a tight range lives.
 */
export function chenScore(cards) {
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
  return score;
}

/** Chen mapped onto the 0..1 scale the profile thresholds use. */
export function preflopStrength(cards) {
  return clamp01((chenScore(cards) - 1) / 19);
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
  return clamp01(base);
}

function pairQuality(hole, board) {
  const boardRanks = board.map((c) => c.r).sort((a, b) => b - a);
  const topBoard = boardRanks[0] ?? 0;
  const pocket = hole[0].r === hole[1].r;
  const holeRanks = hole.map((c) => c.r);

  if (pocket && hole[0].r > topBoard) return 0.70;            // overpair
  if (holeRanks.includes(topBoard)) return 0.55;              // top pair
  if (holeRanks.some((r) => boardRanks.includes(r))) return 0.35;
  if (pocket) return 0.30;                                    // underpair
  return 0.20;
}

function highCardBonus(hole) {
  const hi = Math.max(hole[0].r, hole[1].r);
  return hi >= 13 ? 0.12 : hi >= 11 ? 0.06 : 0;
}

/** Flush and open-ended straight draws, so bots chase for a reason. */
function drawEquity(hole, board) {
  if (board.length === 0 || board.length >= 5) return 0;
  const all = [...hole, ...board];
  let bonus = 0;

  const suits = {};
  for (const c of all) suits[c.s] = (suits[c.s] ?? 0) + 1;
  if (Object.values(suits).some((n) => n === 4)) bonus += 0.22;

  const ranks = [...new Set(all.map((c) => c.r))].sort((a, b) => a - b);
  for (let i = 0; i + 3 < ranks.length; i++) {
    if (ranks[i + 3] - ranks[i] === 3) { bonus += 0.16; break; }
  }
  return bonus;
}

/* ----------------------------- position ---------------------------- */

/** 0 for the first player to act after the button, 1 for the button itself. */
export function lateness(state, seat) {
  const order = [];
  for (let i = 1; i <= state.maxSeats; i++) {
    const s = (state.buttonSeat + i) % state.maxSeats;
    const p = state.players[s];
    if (p && !p.folded) order.push(s);
  }
  const idx = order.indexOf(seat);
  if (idx < 0 || order.length < 2) return 1;
  return idx / (order.length - 1);
}

/* ---------------------------- decisions ---------------------------- */

export function decideBotAction(state, seat, legal, options = {}) {
  const { profile = DEFAULT_PROFILE, rand = Math.random } = options;
  const player = state.players[seat];
  const decision = state.board.length === 0
    ? preflop(state, player, legal, profile, rand)
    : postflop(state, player, legal, profile, rand);
  return safe(decision, legal);
}

function preflop(state, player, legal, profile, rand) {
  const late = lateness(state, player.seat);
  const openMin = profile.open - profile.position * late;
  const callMin = profile.call - profile.position * late * 0.6;
  const s = preflopStrength(player.cards);

  // Nobody has raised yet if the bet is still just the big blind.
  const unraised = state.currentBet <= state.blinds.bb;

  if (legal.canCheck) {
    // The big blind with the option, or a limped pot back around.
    if (s > openMin + 0.04 && rand() < raiseRoll(profile)) return raise(state, legal, profile, rand);
    if (rand() < profile.bluff * 0.4) return raise(state, legal, profile, rand);
    return { type: ACTION.CHECK };
  }

  if (unraised) {
    if (s > openMin) {
      // Aggressive profiles raise first in rather than limp along.
      if (rand() < raiseRoll(profile)) return raise(state, legal, profile, rand);
      return { type: ACTION.CALL };
    }
    if (s > openMin - profile.limp) return { type: ACTION.CALL };
    return { type: ACTION.FOLD };
  }

  // Facing a raise.
  if (s > profile.threeBet && rand() < profile.aggression) return raise(state, legal, profile, rand);
  if (s > callMin * (1 - profile.pressure * 0.45)) return { type: ACTION.CALL };
  if (legal.toCall <= state.blinds.bb && s > 0.12) return { type: ACTION.CALL };
  return { type: ACTION.FOLD };
}

function postflop(state, player, legal, profile, rand) {
  const made = postflopStrength(player.cards, state.board);
  const equity = clamp01(made + drawEquity(player.cards, state.board) * profile.chase);

  if (legal.canCheck) {
    if (made > 0.85 && rand() < profile.slowplay) return { type: ACTION.CHECK };
    if (equity > 0.52 && rand() < 0.12 + profile.aggression * 0.75) return raise(state, legal, profile, rand);
    if (rand() < profile.bluff) return raise(state, legal, profile, rand);
    return { type: ACTION.CHECK };
  }

  const price = legal.toCall / (potNow(state) + legal.toCall);
  if (equity > 0.78 && rand() < profile.aggression * 0.8) return raise(state, legal, profile, rand);

  // A station needs far less than the true price; a nit wants more.
  const need = price * (1.25 - profile.pressure * 0.7);
  if (equity > need) return { type: ACTION.CALL };
  if (legal.toCall <= state.blinds.bb && equity > 0.18) return { type: ACTION.CALL };
  return { type: ACTION.FOLD };
}

/** How often a hand worth playing becomes a raise rather than a call. */
function raiseRoll(profile) {
  return 0.15 + profile.aggression * 0.8;
}

function raise(state, legal, profile, rand) {
  const pot = potNow(state);
  const [lo, hi] = profile.sizing;
  const fraction = lo + rand() * (hi - lo);
  const extra = state.board.length === 0 ? state.blinds.bb : 0;
  const target = state.currentBet + Math.round(pot * fraction) + extra;

  // Shoving beats leaving a stub behind that we would have to call off anyway.
  if (target > legal.maxRaiseTo * 0.8) return { type: ACTION.RAISE, amount: legal.maxRaiseTo };
  return { type: ACTION.RAISE, amount: target };
}

function potNow(state) {
  return state.potCollected
    + state.players.reduce((sum, p) => sum + (p ? p.streetCommitted : 0), 0);
}

/** Last line of defence: never hand the engine an action it would reject. */
function safe(action, legal) {
  if (action.type === ACTION.RAISE) {
    if (!legal.canRaise) return legal.canCall ? { type: ACTION.CALL } : { type: ACTION.CHECK };
    const amount = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(action.amount)));
    return { type: ACTION.RAISE, amount };
  }
  if (action.type === ACTION.CALL && !legal.canCall) return { type: ACTION.CHECK };
  if (action.type === ACTION.CHECK && !legal.canCheck) {
    return legal.canCall ? { type: ACTION.CALL } : { type: ACTION.FOLD };
  }
  return action;
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/* ------------------------------ naming ----------------------------- */

const BOT_NAMES = [
  'Doyle', 'Stu', 'Vanessa', 'Daniel', 'Chris', 'Jennifer',
  'Erik', 'Johnny', 'Fedor', 'Isildur', 'Maria', 'Tom',
];

export function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Bots pause long enough that the table doesn't feel like a spreadsheet. */
export function botThinkingTime() {
  return 900 + Math.random() * 1500;
}
