import { ACTION } from '../../engine/constants.js';
import { classOf, CLASS_PERCENTILE, comboIndex, topOfRange } from '../../engine/range.js';
import {
  rfiPercent, inRange, pushPercent, THREE_BET_SHARE, FLAT_SHARE_IP, BB_DEFEND,
  FOUR_BET_SHARE, CALL_THREE_BET_SHARE,
} from '../../engine/charts.js';
import { equityVsRanges } from '../../engine/equity.js';
import { SKILLS, PRO_STYLE_BY_KEY } from './profiles.js';
import { estimateRange, preflopSummary, strengthCache, neutralModel } from './read.js';
import { potNow, safe, clamp, playersBehind, postflopOrder, playersDealt } from './common.js';

/**
 * The pro brain. Every option on the table is priced in chips relative to
 * folding, and the best one is played — mixed with its nearest rival when the
 * two are close, so the bet size does not give the hand away.
 *
 * It reads its own two cards and nothing else of anybody's. Opponents are
 * ranges, built from the public action log.
 */

const BLUFF_EQUITY = 0.35;
const NEVER_FOLD_EQUITY = 0.8;
const BLUFF_THREE_BETS = new Set(['A5s', 'A4s', 'A3s', 'A2s']);

export function decideProAction(state, seat, legal, options = {}) {
  const ctx = context(state, seat, legal, options);
  const choice = state.board.length === 0 ? preflop(ctx) : postflop(ctx);
  return safe(choice, legal);
}

function context(state, seat, legal, options) {
  const skill = { ...(options.skill ?? SKILLS.normal), ...(options.budget ?? {}) };
  const style = options.profile?.width ? options.profile : PRO_STYLE_BY_KEY['pro-solid'];
  const me = state.players[seat];
  const opps = state.players.filter((p) => p && !p.folded && p.seat !== seat);
  const deepest = Math.max(...opps.map((p) => p.stack + p.streetCommitted));
  const eff = Math.min(me.stack + me.streetCommitted, deepest);
  const stats = options.stats ?? null;
  return {
    state, seat, legal, me, opps, skill, style,
    hole: me.cards,
    pot: potNow(state),
    bb: state.blinds.bb,
    effBB: eff / state.blinds.bb,
    log: options.actions ?? [],
    memory: options.memory ?? null,
    ledger: options.ledger ?? null,
    rand: options.rand ?? Math.random,
    modelOf: (p) => (stats ? stats.model(p.id, skill.exploit) : neutralModel()),
  };
}

const raiseTo = (amount) => ({ type: ACTION.RAISE, amount: Math.round(amount) });
const CALL = { type: ACTION.CALL };
const CHECK = { type: ACTION.CHECK };
const FOLD = { type: ACTION.FOLD };
const ALL_IN = (ctx) => raiseTo(ctx.legal.maxRaiseTo ?? 0);
const passive = (ctx) => (ctx.legal.canCheck ? CHECK : FOLD);

/** Big raises from a short stack are just all-ins that leave a stub. */
function sized(ctx, amount) {
  if (!ctx.legal.canRaise) return ctx.legal.canCall ? CALL : CHECK;
  if (amount - ctx.me.streetCommitted >= ctx.me.stack * 0.4) return ALL_IN(ctx);
  return raiseTo(amount);
}

/* ------------------------------ preflop ------------------------------ */

function preflop(ctx) {
  const { state, seat, legal, style, rand, bb } = ctx;
  const cls = classOf(ctx.hole[0], ctx.hole[1]);
  const pct = CLASS_PERCENTILE[cls];
  const dealt = playersDealt(state);
  const behind = playersBehind(state, seat);
  const { raises, limpers, callers } = preflopSummary(ctx.log);
  const facingAllIn = ctx.opps.some((p) => p.allIn) || legal.toCall >= ctx.me.stack;

  if (raises.length >= 3 || (raises.length > 0 && facingAllIn)) return priceTheCall(ctx);

  if (raises.length === 0) {
    if (ctx.effBB <= 15 && !legal.canCheck) {
      return inRange(cls, pushPercent(behind, dealt, ctx.effBB) * style.width) ? ALL_IN(ctx) : FOLD;
    }
    if (legal.canCheck) {
      // Limpers to the big blind: raise the top, see a free flop with the rest.
      return pct <= 0.12 * style.width ? sized(ctx, bb * (3 + limpers)) : CHECK;
    }
    const openPct = rfiPercent(behind, dealt) * style.width * (limpers > 0 ? 0.6 : 1);
    const open = sized(ctx, bb * (seat === state.sbSeat && dealt > 2 ? 3 : 2.5) + bb * limpers);
    if (inRange(cls, openPct)) return open;
    if (pct <= openPct * 1.15 && rand() < style.edgeMix) return open;
    if (limpers > 0 && pct <= 0.6 && inRange(cls, 0.6)) return CALL;
    return FOLD;
  }

  const opener = state.players[raises[0].seat];
  const openPct = rfiPercent(playersBehind(state, opener.seat), dealt) * ctx.modelOf(opener).width;
  const inPosition = postflopOrder(state, seat) > postflopOrder(state, opener.seat);
  const tighten = Math.pow(0.8, callers);

  if (raises.length === 1) {
    if (ctx.effBB <= 20) return pct <= openPct * 0.35 ? ALL_IN(ctx) : passive(ctx);
    const threeBetPct = openPct * THREE_BET_SHARE * style.width * tighten;
    const size = raises[0].to * (inPosition ? 3 : 3.8) + raises[0].to * callers;
    if (pct <= threeBetPct) return sized(ctx, size);
    if (BLUFF_THREE_BETS.has(cls) && rand() < 0.5 * style.bluffCap) return sized(ctx, size);

    const isBB = seat === state.bbSeat;
    const callPct = (isBB ? BB_DEFEND(openPct) : inPosition ? openPct * FLAT_SHARE_IP : openPct * 0.35)
      * style.width * tighten;
    const setMine = cls.length === 2 && ctx.effBB * bb >= legal.toCall * 20;
    if (inRange(cls, callPct) || setMine) return CALL;
    return passive(ctx);
  }

  // Facing a 3-bet.
  const threeBettor = state.players[raises[1].seat];
  const wasOpener = raises[0].seat === seat;
  if (!wasOpener) {
    if (pct <= 0.025) return sized(ctx, raises[1].to * 2.3);
    return pct <= 0.05 ? CALL : passive(ctx);
  }
  const tbPct = openPct * THREE_BET_SHARE * ctx.modelOf(threeBettor).width;
  if (pct <= Math.max(0.02, tbPct * FOUR_BET_SHARE)) return sized(ctx, raises[1].to * 2.3);
  const setMine = cls.length === 2 && ctx.effBB * bb >= legal.toCall * 20;
  if (pct <= tbPct * CALL_THREE_BET_SHARE || setMine) return CALL;
  return passive(ctx);
}

/**
 * Big preflop pots — 4-bets, all-ins — are priced exactly: equity against
 * what the raisers could hold, against the price.
 */
function priceTheCall(ctx) {
  const { legal } = ctx;
  const ranges = ctx.opps.map((p) => rangeOf(ctx, p));
  const { equity } = equityVsRanges(ctx.hole, [], ranges, runBudget(ctx));
  const evCall = equity * (ctx.pot + legal.toCall) - legal.toCall;
  if (legal.canRaise && equity > 0.55 && !ctx.opps.some((p) => p.allIn)) return ALL_IN(ctx);
  if (legal.canCheck) return CHECK;
  return evCall > 0 ? CALL : FOLD;
}

/* ------------------------------ postflop ----------------------------- */

function postflop(ctx) {
  const { state, legal, me, pot, style, skill, rand } = ctx;
  const strengthFor = strengthCache(state.board, ctx.memory);
  const strength = strengthFor(state.board.length);
  const mine = strength[comboIndex(ctx.hole[0], ctx.hole[1])];
  const ranges = ctx.opps.map((p) => rangeOf(ctx, p, strengthFor));

  const sizes = candidateSizes(ctx);
  const street = state.street;
  const canBluff = (to) => bluffRoom(ctx, street, to);

  // Nothing to bet for and no bluff left in the budget: skip the simulation.
  if (legal.canCheck && mine < 0.25 && !sizes.some(canBluff)) return CHECK;

  const potAfterCall = pot + legal.toCall;
  const masks = sizes.map((to) => {
    const bet = to - state.currentBet;
    return ctx.opps.map((p, i) => {
      const defend = clamp((potAfterCall / (potAfterCall + bet)) * ctx.modelOf(p).looseness, 0.05, 0.95);
      return topOfRange(ranges[i], strength, defend);
    });
  });
  const result = equityVsRanges(ctx.hole, state.board, ranges, { ...runBudget(ctx), masks });
  const eq = result.equity;
  const R = realization(ctx);

  const options = [];
  if (legal.canCheck) {
    options.push({ action: CHECK, ev: eq * R * pot });
  } else {
    options.push({ action: FOLD, ev: 0 });
    const callR = legal.toCall >= me.stack ? 1 : R;
    options.push({ action: CALL, ev: eq * callR * (pot + legal.toCall) - legal.toCall });
  }
  sizes.forEach((to, k) => {
    const bluff = eq < BLUFF_EQUITY;
    if (bluff && !canBluff(to)) return;
    const { foldAll, eqCalled } = result.sizes[k];
    const cost = to - me.streetCommitted;
    const add = to - state.currentBet;
    const r = to === legal.maxRaiseTo ? 1 : R;
    const ev = foldAll * pot + (1 - foldAll) * (eqCalled * r * (pot + cost + add) - cost);
    options.push({ action: raiseTo(to), ev, bluff });
  });

  let pick = choose(options, pot, style.mix, rand);
  if (skill.mistake > 0 && rand() < skill.mistake) pick = mistakeFrom(options, pick, eq, rand);
  if (pick.action.type === ACTION.RAISE && legal.canCheck && eq > 0.85 && rand() < style.slowplay) {
    pick = { action: CHECK, bluff: false };
  }
  if (pick.action.type === ACTION.RAISE) noteBet(ctx, street, pick.bluff);
  return pick.action;
}

function rangeOf(ctx, p, strengthFor = null) {
  const narrow = ctx.skill.narrow && strengthFor !== null;
  return estimateRange(ctx.state, p.seat, ctx.log, ctx.skill.narrow ? ctx.modelOf(p) : neutralModel(), {
    narrow,
    dead: [...ctx.hole, ...ctx.state.board],
    strengthFor,
  });
}

function runBudget(ctx) {
  return { samples: ctx.skill.samples, timeMs: ctx.skill.timeMs, rand: ctx.rand };
}

/** Bet sizes to price, as raise-to amounts, legal and without duplicates. */
function candidateSizes(ctx) {
  const { state, legal, pot, style } = ctx;
  if (!legal.canRaise) return [];
  const out = new Set();
  const base = pot + legal.toCall;
  for (const f of style.sizes) {
    let to = state.currentBet + Math.round(base * f);
    if (to < legal.minRaiseTo) to = legal.minRaiseTo;
    if (to >= legal.maxRaiseTo * 0.8) to = legal.maxRaiseTo;
    out.add(to);
  }
  // Shoving is only a real option once the stack is small next to the pot.
  if (legal.maxRaiseTo - state.currentBet <= base * 1.5) out.add(legal.maxRaiseTo);
  return [...out].sort((a, b) => a - b);
}

/**
 * Equity is not all collected: out of position, with streets to come, some
 * of it is lost to bets we cannot call. With little behind, less is at stake.
 */
function realization(ctx) {
  const { state, skill, seat } = ctx;
  if (!skill.realization || state.board.length === 5) return 1;
  const last = Math.max(...ctx.opps.map((p) => postflopOrder(state, p.seat)));
  const inPosition = postflopOrder(state, seat) > last;
  let r = 1 + (inPosition ? 0.08 : -0.08) - 0.05 * (ctx.opps.length - 1);
  const spr = (ctx.me.stack) / Math.max(1, ctx.pot);
  if (spr < 2) r = 1 - (1 - r) * 0.3;
  return clamp(r, 0.85, 1.15);
}

/** Best by EV, mixed with the runner-up when they are within `mix` of the pot. */
function choose(options, pot, mix, rand) {
  const sorted = options.slice().sort((a, b) => b.ev - a.ev);
  const [first, second] = sorted;
  if (!second) return first;
  const band = mix * Math.max(pot, 1);
  const gap = first.ev - second.ev;
  if (gap >= band) return first;
  return rand() < 0.5 + gap / (2 * band) ? first : second;
}

/**
 * A mistake is any other option, picked at random — never folding a hand
 * this good. Taking only the runner-up costs almost nothing, because the
 * runner-up is usually nearly as good; a weaker player errs more widely.
 */
function mistakeFrom(options, pick, eq, rand) {
  const rest = options
    .filter((o) => o !== pick)
    .filter((o) => !(o.action.type === ACTION.FOLD && eq >= NEVER_FOLD_EQUITY));
  return rest.length ? rest[Math.floor(rand() * rest.length)] : pick;
}

/**
 * Balanced bluffing: over the session, bluffs on a street may not outnumber
 * what a bet of this size can carry — bet/(pot + bet) of all bets.
 */
function bluffRoom(ctx, street, to) {
  if (!ctx.skill.balance || !ctx.ledger) return true;
  const bet = to - ctx.state.currentBet;
  const ratio = (bet / (ctx.pot + ctx.legal.toCall + bet)) * ctx.style.bluffCap;
  const l = ctx.ledger[street] ?? { bets: 0, bluffs: 0 };
  return (l.bluffs + 1) / (l.bets + 1) <= ratio + 0.05;
}

function noteBet(ctx, street, bluff) {
  if (!ctx.ledger) return;
  const l = (ctx.ledger[street] ??= { bets: 0, bluffs: 0 });
  l.bets++;
  if (bluff) l.bluffs++;
}
