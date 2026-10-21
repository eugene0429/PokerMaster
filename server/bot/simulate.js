import { startHand, applyAction, legalActions } from '../../engine/table.js';
import { createDeck, shuffle } from '../../engine/deck.js';
import { ACTION } from '../../engine/constants.js';
import { seeded, intRng } from '../../engine/rng.js';
import { decideBotAction } from './index.js';
import { SessionStats, noteAction, observe } from './read.js';

/**
 * Bots against bots with no server in the way, for measuring strength.
 *
 * Duplicate format: every deck is dealt once per seat rotation, so each
 * player in the lineup gets every seat's cards against the same board. Most
 * of the luck cancels out, which is what makes a few thousand hands enough to
 * say who is better. Stacks reset every hand; results are chips won.
 *
 * The deck, not the hand, is the independent unit — its rotations share
 * cards — so per-deck results are kept for the error bars.
 *
 * lineup: [{ id, brain, profile, skill }]
 * budget: overrides every pro's sample budget, e.g. { samples: 200, timeMs: Infinity }
 */
export function playMatch({ lineup, decks, seed = 1, bb = 100, stackBB = 100, budget = null }) {
  const n = lineup.length;
  const rand = seeded(seed);
  const stats = new SessionStats();
  const perDeck = new Map(lineup.map((b) => [b.id, new Float64Array(decks)]));
  const ledgers = new Map(lineup.map((b) => [b.id, {}]));
  const timings = [];
  let handId = 0;

  for (let d = 0; d < decks; d++) {
    const deck = shuffle(createDeck(), intRng(seeded(seed * 7919 + d)));
    const buttonSeat = d % n;
    for (let rot = 0; rot < n; rot++) {
      const bySeat = Array.from({ length: n }, (_, s) => lineup[(s + rot) % n]);
      const seats = bySeat.map((b, s) => ({ seat: s, id: b.id, name: b.id, stack: stackBB * bb, isBot: true }));
      let { state } = startHand({ seats, buttonSeat, blinds: { sb: bb / 2, bb }, deck, maxSeats: n, handId: ++handId });
      stats.startHand(state);
      const log = [];
      const memory = new Map(lineup.map((b) => [b.id, { handId, streets: [] }]));

      while (!state.complete) {
        const seat = state.currentSeat;
        const bot = bySeat[seat];
        const legal = legalActions(state, seat);
        const t0 = performance.now();
        let action = decideBotAction(state, seat, legal, {
          brain: bot.brain, profile: bot.profile, skill: bot.skill, budget,
          memory: memory.get(bot.id), ledger: ledgers.get(bot.id), stats, actions: log, rand,
        });
        if (bot.brain === 'pro') timings.push(performance.now() - t0);
        let note = noteAction(state, seat, action);
        try {
          ({ state } = applyAction(state, { seat, ...action }));
        } catch {
          action = legal.canCheck ? { type: ACTION.CHECK } : { type: ACTION.FOLD };
          note = noteAction(state, seat, action);
          ({ state } = applyAction(state, { seat, ...action }));
        }
        observe({ log, stats }, note);
      }
      stats.endHand(state);
      for (const p of state.players) {
        if (p) perDeck.get(p.id)[d] += p.stack - stackBB * bb;
      }
    }
  }

  // One deck is n hands per bot, so per-deck nets convert to bb/100 by 100 / (n · bb).
  const scale = 100 / (n * bb);
  const table = lineup.map((b) => {
    const { mean, se } = meanAndError(perDeck.get(b.id));
    return { id: b.id, hands: decks * n, bbPer100: mean * scale, se: se * scale };
  });
  /** Edge of `a` over `b` in bb/100, with the error of the paired difference. */
  const compare = (a, b) => {
    const x = perDeck.get(a);
    const y = perDeck.get(b);
    const { mean, se } = meanAndError(x.map((v, i) => v - y[i]));
    return { diff: mean * scale, se: se * scale };
  };
  timings.sort((a, b) => a - b);
  const p95 = timings.length ? timings[Math.floor(timings.length * 0.95)] : 0;
  return { table, compare, p95 };
}

function meanAndError(xs) {
  const n = xs.length;
  let sum = 0;
  for (const x of xs) sum += x;
  const mean = sum / n;
  let sq = 0;
  for (const x of xs) sq += (x - mean) ** 2;
  const se = n > 1 ? Math.sqrt(sq / (n - 1)) / Math.sqrt(n) : Infinity;
  return { mean, se };
}
