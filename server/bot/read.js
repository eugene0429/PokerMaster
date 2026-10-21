import { ACTION, STREET } from '../../engine/constants.js';
import {
  COMBO_COUNT, ALL_COMBOS, fullRange, removeCards, boardStrength, topOfRange,
} from '../../engine/range.js';
import {
  rfiPercent, inRange, THREE_BET_SHARE, FLAT_SHARE_IP, BB_DEFEND, CALL_THREE_BET_SHARE,
} from '../../engine/charts.js';
import { potNow, clamp, playersBehind, playersDealt } from './common.js';

/**
 * Reading opponents: what a player's actions this hand say about their cards,
 * and what their play over the session says about them. Everything here is
 * built from public information — the action log and hands tabled at
 * showdown. Nothing reads anyone's hole cards.
 */

/* --------------------------- the action log --------------------------- */

/**
 * Describe an action from the table as it stands just before the action is
 * applied. Taken first and committed with observe() only once the engine
 * accepts the action, so a rejected click never enters anyone's history.
 */
export function noteAction(state, seat, action) {
  const p = state.players[seat];
  return {
    seat,
    id: p.id,
    street: state.street,
    type: action.type,
    amount: action.amount ?? 0,
    potBefore: potNow(state),
    betBefore: state.currentBet,
    toCall: Math.max(0, Math.min(state.currentBet - p.streetCommitted, p.stack)),
  };
}

/** Commit a note to this hand's log and the session stats. Room and arena both call it. */
export function observe({ log, stats }, note) {
  log.push(note);
  stats?.record(note);
}

/** Preflop raises in order, and how many players limped before the first one. */
export function preflopSummary(log) {
  const raises = [];
  let limpers = 0;
  const callersSinceRaise = [];
  for (const a of log) {
    if (a.street !== STREET.PREFLOP) continue;
    if (a.type === ACTION.RAISE) { raises.push({ seat: a.seat, to: a.amount }); callersSinceRaise.length = 0; }
    else if (a.type === ACTION.CALL) {
      if (raises.length === 0) limpers++;
      else callersSinceRaise.push(a.seat);
    }
  }
  return { raises, limpers, callers: callersSinceRaise.length };
}

/* --------------------------- session stats ---------------------------- */

/** What an average player looks like before we have seen anything. */
export const PRIOR = { vpip: 0.28, pfr: 0.18, foldToCbet: 0.45, aggression: 0.45 };
/** How many observations the prior is worth. */
const SHRINK = 12;

const NEUTRAL_MODEL = Object.freeze({ width: 1, callWidth: 1, looseness: 1, aggression: 1, hands: 0 });

/**
 * Per-player tendencies across the session, keyed by player id. Small samples
 * are pulled toward the prior, so three hands of watching someone does not
 * turn into a conclusion.
 */
export class SessionStats {
  constructor() {
    this.players = new Map();
    this.hand = null;
  }

  counters(id) {
    let c = this.players.get(id);
    if (!c) {
      c = { hands: 0, vpip: 0, pfr: 0, aggActs: 0, passiveActs: 0, cbetFaced: 0, cbetFolded: 0, sawFlop: 0, wtsd: 0 };
      this.players.set(id, c);
    }
    return c;
  }

  startHand(state) {
    this.hand = { flags: new Map(), aggressor: null, cbet: false };
    for (const p of state.players) {
      if (!p) continue;
      this.counters(p.id).hands++;
      this.hand.flags.set(p.id, {});
    }
  }

  record(note) {
    if (!this.hand) this.hand = { flags: new Map(), aggressor: null, cbet: false };
    const c = this.counters(note.id);
    let f = this.hand.flags.get(note.id);
    if (!f) { f = {}; this.hand.flags.set(note.id, f); }

    if (note.street === STREET.PREFLOP) {
      if (note.type === ACTION.RAISE || note.type === ACTION.CALL) {
        if (!f.vpip) { f.vpip = true; c.vpip++; }
      }
      if (note.type === ACTION.RAISE) {
        if (!f.pfr) { f.pfr = true; c.pfr++; }
        this.hand.aggressor = note.seat;
      }
      return;
    }

    if (!f.sawFlop) { f.sawFlop = true; c.sawFlop++; }
    if (note.type === ACTION.RAISE) c.aggActs++;
    else if (note.type === ACTION.CALL) c.passiveActs++;

    if (note.street !== STREET.FLOP) return;
    if (note.type === ACTION.RAISE && note.betBefore === 0 && note.seat === this.hand.aggressor) {
      this.hand.cbet = true;
      return;
    }
    if (this.hand.cbet && note.betBefore > 0 && note.seat !== this.hand.aggressor && !f.facedCbet) {
      f.facedCbet = true;
      c.cbetFaced++;
      if (note.type === ACTION.FOLD) c.cbetFolded++;
    }
  }

  endHand(state) {
    if (state.results?.showdown) {
      for (const h of state.results.hands) {
        const p = state.players[h.seat];
        if (p) this.counters(p.id).wtsd++;
      }
    }
    this.hand = null;
  }

  /**
   * Multipliers against an average player, 1 meaning "average". `exploit`
   * scales how far a bot is willing to move off average: 0 ignores the
   * stats entirely, 1 trusts them fully.
   */
  model(id, exploit = 1) {
    const c = this.players.get(id);
    if (!c || exploit <= 0) return NEUTRAL_MODEL;
    const shrink = (obs, n, prior) => (obs + prior * SHRINK) / (n + SHRINK);
    const vpip = shrink(c.vpip, c.hands, PRIOR.vpip);
    const pfr = shrink(c.pfr, c.hands, PRIOR.pfr);
    const fold = shrink(c.cbetFolded, c.cbetFaced, PRIOR.foldToCbet);
    const agg = shrink(c.aggActs, c.aggActs + c.passiveActs, PRIOR.aggression);
    const toward = (x) => 1 + (x - 1) * exploit;
    return {
      width: toward(clamp(pfr / PRIOR.pfr, 0.5, 2.5)),
      callWidth: toward(clamp(vpip / PRIOR.vpip, 0.5, 2.5)),
      looseness: toward(clamp((1 - fold) / (1 - PRIOR.foldToCbet), 0.6, 1.6)),
      aggression: toward(clamp(agg / PRIOR.aggression, 0.5, 2)),
      hands: c.hands,
    };
  }
}

export const neutralModel = () => NEUTRAL_MODEL;

/* ------------------------ range for one opponent ----------------------- */

const BLUFF_THREE_BETS = new Set(['A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', 'T8s']);

/** A 0/1 range from a chart width, with speculative hands counted generously. */
function chart(pct, extras = null, extraWeight = 0.3) {
  const w = new Float64Array(COMBO_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const cls = ALL_COMBOS[i].cls;
    if (inRange(cls, pct)) w[i] = 1;
    else if (extras?.has(cls)) w[i] = extraWeight;
  }
  return w;
}

/** Scale down the combos inside a narrower chart: hands that would have raised instead. */
function discountTop(w, pct, factor) {
  for (let i = 0; i < COMBO_COUNT; i++) if (w[i] > 0 && inRange(ALL_COMBOS[i].cls, pct)) w[i] *= factor;
  return w;
}

/**
 * What `seat` could be holding, as preflop charts narrowed by what they did
 * preflop, then by every postflop action. With `narrow` false the postflop
 * steps are skipped — the easy bots read position and nothing else.
 */
export function estimateRange(state, seat, log, model, { narrow = true, dead = [], strengthFor } = {}) {
  let w = preflopRange(state, seat, log, model);
  if (narrow) {
    for (const a of log) {
      if (a.seat !== seat || a.street === STREET.PREFLOP) continue;
      const boardLen = a.street === STREET.FLOP ? 3 : a.street === STREET.TURN ? 4 : 5;
      const strength = strengthFor(boardLen);
      w = narrowBy(w, a, strength, model);
    }
  }
  const out = removeCards(w, dead);
  let total = 0;
  for (let i = 0; i < COMBO_COUNT; i++) total += out[i];
  return total > 0 ? out : removeCards(fullRange(), dead);
}

function preflopRange(state, seat, log, model) {
  const dealt = playersDealt(state);
  let raiseLevel = 0;
  let last = null;
  let openerSeat = null;
  for (const a of log) {
    if (a.street !== STREET.PREFLOP) continue;
    if (a.seat === seat) last = { type: a.type, level: a.type === ACTION.RAISE ? raiseLevel + 1 : raiseLevel };
    if (a.type === ACTION.RAISE) {
      raiseLevel++;
      if (raiseLevel === 1) openerSeat = a.seat;
    }
  }
  const openPct = openerSeat === null ? 0.2 : rfiPercent(playersBehind(state, openerSeat), dealt);

  if (!last) return chart(0.5);
  if (last.type === ACTION.CHECK) return discountTop(fullRange(), 0.08, 0.3);   // big blind, option
  if (last.type === ACTION.RAISE) {
    if (last.level === 1) return chart(rfiPercent(playersBehind(state, seat), dealt) * model.width);
    if (last.level === 2) return chart(openPct * THREE_BET_SHARE * model.width, BLUFF_THREE_BETS);
    return chart(0.03 * model.width);
  }
  // A call.
  if (last.level === 0) return discountTop(chart(0.45 * model.callWidth), 0.08, 0.3);   // limp
  if (last.level === 1) {
    const isBB = seat === state.bbSeat;
    const pct = (isBB ? BB_DEFEND(openPct) : openPct * FLAT_SHARE_IP) * model.callWidth;
    return discountTop(chart(pct), openPct * THREE_BET_SHARE, 0.35);
  }
  return discountTop(chart(openPct * CALL_THREE_BET_SHARE * model.callWidth), 0.03, 0.4);
}

/** Bottom `fraction` of a range by strength. */
function bottomOfRange(w, strength, fraction) {
  const inv = Float64Array.from(strength, (x) => -x);
  return topOfRange(w, inv, fraction);
}

function narrowBy(w, a, strength, model) {
  const out = Float64Array.from(w);
  const scaleOutside = (mask, factor) => {
    for (let i = 0; i < COMBO_COUNT; i++) if (!mask[i]) out[i] *= factor;
  };
  const floor = (x) => clamp(x * model.aggression, 0.05, 1);

  if (a.type === ACTION.CHECK) {
    // Strong hands check sometimes — to trap — so they thin out but stay.
    for (let i = 0; i < COMBO_COUNT; i++) if (strength[i] > 0.85) out[i] *= 0.5;
    return out;
  }
  if (a.type === ACTION.CALL) {
    const potBeforeBet = Math.max(1, a.potBefore - a.toCall);
    const defend = clamp((potBeforeBet / (potBeforeBet + a.toCall)) * model.looseness, 0.1, 0.95);
    scaleOutside(topOfRange(w, strength, defend), 0.15);
    return out;
  }
  if (a.type !== ACTION.RAISE) return out;

  if (a.toCall > 0) {
    // Raising a bet: strong made hands and the draws that can take a stand.
    scaleOutside(topOfRange(w, strength, 0.25), floor(0.2));
    return out;
  }
  const size = (a.amount - a.betBefore) / Math.max(1, a.potBefore);
  if (size <= 0.5) {
    scaleOutside(topOfRange(w, strength, 0.6), floor(0.35));
  } else if (size >= 0.75) {
    const top = topOfRange(w, strength, 0.35);
    const bottom = bottomOfRange(w, strength, 0.2);
    for (let i = 0; i < COMBO_COUNT; i++) {
      if (top[i]) continue;
      out[i] *= bottom[i] ? floor(0.6) : floor(0.2);
    }
  } else {
    scaleOutside(topOfRange(w, strength, 0.45), floor(0.3));
  }
  return out;
}

/** Board-strength tables for this hand, one per street, built once and kept. */
export function strengthCache(board, memory) {
  const cache = memory ? (memory.strength ??= {}) : {};
  return (len) => (cache[len] ??= boardStrength(board.slice(0, len)));
}
