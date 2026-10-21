import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../engine/table.js';
import { createDeck, shuffle, parseCards } from '../engine/deck.js';
import { ACTION } from '../engine/constants.js';
import { seeded, intRng } from '../engine/rng.js';
import { HAND_ORDER } from '../engine/range.js';
import { decideBotAction } from '../server/bot/index.js';
import { SKILLS, PRO_STYLE_BY_KEY, PROFILE_BY_KEY } from '../server/bot/profiles.js';
import { SessionStats, noteAction, observe } from '../server/bot/read.js';

const BLINDS = { sb: 50, bb: 100 };
const FAST = { samples: 400, timeMs: Infinity };
const seats = (n, stack = 10000) =>
  Array.from({ length: n }, (_, i) => ({ seat: i, id: `p${i}`, name: `P${i}`, stack }));

const pro = (state, seat, opts = {}) =>
  decideBotAction(state, seat, legalActions(state, seat), {
    brain: 'pro', skill: SKILLS.hard, budget: FAST, rand: seeded(opts.seed ?? 1), ...opts,
  });

/**
 * Heads-up on the river. Seat 0 is the button, seat 1 the big blind, who acts
 * first. `villainBet` is what seat 1 has bet into the pot; the log says how
 * they got here.
 */
function river({ hero, villain = '2s 3d', board, pot = 1000, villainBet = 0, log = [], heroStack = 9000 }) {
  const { state } = startHand({ seats: seats(2), buttonSeat: 0, blinds: BLINDS, deck: createDeck(), maxSeats: 2 });
  state.players[0].cards = parseCards(hero);
  state.players[1].cards = parseCards(villain);
  state.board = parseCards(board);
  state.street = 'river';
  state.potCollected = pot;
  for (const p of state.players) { p.streetCommitted = 0; p.hasActed = false; p.canRaise = true; }
  state.players[0].stack = heroStack;
  state.players[1].stack = heroStack - villainBet;
  state.players[1].streetCommitted = villainBet;
  state.players[1].hasActed = villainBet > 0;
  state.currentBet = villainBet;
  state.minRaise = Math.max(BLINDS.bb, villainBet);
  state.currentSeat = 0;
  return { state, log };
}

/** Villain 3-bet preflop and fired the river: a tight, strong line. */
const threeBetLine = (riverBet) => [
  { seat: 0, id: 'p0', street: 'preflop', type: 'raise', amount: 250, potBefore: 150, betBefore: 100, toCall: 50 },
  { seat: 1, id: 'p1', street: 'preflop', type: 'raise', amount: 900, potBefore: 350, betBefore: 250, toCall: 150 },
  { seat: 0, id: 'p0', street: 'preflop', type: 'call', amount: 0, potBefore: 1150, betBefore: 900, toCall: 650 },
  { seat: 1, id: 'p1', street: 'river', type: 'raise', amount: riverBet, potBefore: 1800, betBefore: 0, toCall: 0 },
];

describe('pro bot: spots', () => {
  it('never folds the nuts, at any difficulty', () => {
    for (const skill of Object.values(SKILLS)) {
      for (let seed = 0; seed < 40; seed++) {
        const { state, log } = river({ hero: 'Th 3d', board: 'Ah Kh Qh Jh 2c', pot: 1800, villainBet: 1800, log: threeBetLine(1800) });
        const a = pro(state, 0, { skill, seed, actions: log });
        expect(a.type).not.toBe(ACTION.FOLD);
      }
    }
  });

  it('folds seven-high to a pot-sized river bet from a 3-bettor', () => {
    const { state, log } = river({ hero: '7c 4d', board: 'Ks Qd 9h 5c 2s', pot: 1800, villainBet: 1800, log: threeBetLine(1800) });
    expect(pro(state, 0, { actions: log }).type).toBe(ACTION.FOLD);
  });

  it('calls top pair when the price is a quarter of the pot', () => {
    const log = [
      { seat: 0, id: 'p0', street: 'preflop', type: 'call', amount: 0, potBefore: 150, betBefore: 100, toCall: 50 },
      { seat: 1, id: 'p1', street: 'preflop', type: 'check', amount: 0, potBefore: 200, betBefore: 100, toCall: 0 },
      { seat: 1, id: 'p1', street: 'river', type: 'raise', amount: 100, potBefore: 400, betBefore: 0, toCall: 0 },
    ];
    const { state } = river({ hero: 'Kd Qs', board: 'Kh 7d 2c 9s 3h', pot: 400, villainBet: 100 });
    expect(pro(state, 0, { actions: log }).type).not.toBe(ACTION.FOLD);
  });

  it('bets the nuts for value when checked to', () => {
    let bets = 0;
    for (let seed = 0; seed < 40; seed++) {
      const log = [
        { seat: 0, id: 'p0', street: 'preflop', type: 'raise', amount: 250, potBefore: 150, betBefore: 100, toCall: 50 },
        { seat: 1, id: 'p1', street: 'preflop', type: 'call', amount: 0, potBefore: 350, betBefore: 250, toCall: 150 },
        { seat: 1, id: 'p1', street: 'river', type: 'check', amount: 0, potBefore: 500, betBefore: 0, toCall: 0 },
      ];
      const { state } = river({ hero: 'Th 3d', board: 'Ah Kh Qh Jh 2c', pot: 500 });
      if (pro(state, 0, { actions: log, seed }).type === ACTION.RAISE) bets++;
    }
    expect(bets).toBeGreaterThanOrEqual(32);
  });

  it('opens aces from every seat and folds 72o under the gun', () => {
    for (let button = 0; button < 6; button++) {
      const { state } = startHand({ seats: seats(6), buttonSeat: button, blinds: BLINDS, deck: createDeck() });
      state.players[state.currentSeat].cards = parseCards('As Ad');
      expect(pro(state, state.currentSeat).type).toBe(ACTION.RAISE);
    }
    const { state } = startHand({ seats: seats(6), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
    state.players[state.currentSeat].cards = parseCards('7c 2d');
    expect(pro(state, state.currentSeat).type).toBe(ACTION.FOLD);
  });

  it('opens more hands on the button than under the gun', () => {
    const opens = (foldsFirst) => {
      let n = 0;
      for (const cls of HAND_ORDER) {
        let { state } = startHand({ seats: seats(6), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
        for (let i = 0; i < foldsFirst; i++) ({ state } = applyAction(state, { seat: state.currentSeat, type: ACTION.FOLD }));
        const [a, b] = [cls[0], cls[1]];
        state.players[state.currentSeat].cards = parseCards(`${a}s ${b}${cls[2] === 's' ? 's' : 'd'}`);
        if (pro(state, state.currentSeat, { seed: 3 }).type === ACTION.RAISE) n++;
      }
      return n;
    };
    expect(opens(3)).toBeGreaterThan(opens(0) * 2);   // button vs UTG at six-handed
  });

  it('shoves or folds a short stack, never min-raising it', () => {
    for (const [hand, want] of [['As Ad', 'shove'], ['7c 2d', ACTION.FOLD]]) {
      const short = seats(6).map((s) => ({ ...s, stack: 1000 }));      // 10 big blinds
      const { state } = startHand({ seats: short, buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
      state.players[state.currentSeat].cards = parseCards(hand);
      const legal = legalActions(state, state.currentSeat);
      const a = pro(state, state.currentSeat);
      if (want === 'shove') expect(a).toEqual({ type: ACTION.RAISE, amount: legal.maxRaiseTo });
      else expect(a.type).toBe(want);
    }
  });

  it('keeps making legal decisions in a multiway pot with a player all in', () => {
    const deal = seeded(31);
    let checked = 0;
    for (let h = 0; h < 40; h++) {
      const stacks = [800, 10000, 10000, 10000];                          // seat 0 is short
      let { state } = startHand({
        seats: stacks.map((stack, seat) => ({ seat, id: `p${seat}`, name: `P${seat}`, stack })),
        buttonSeat: 3, blinds: BLINDS, deck: shuffle(createDeck(), intRng(deal)), maxSeats: 4,
      });
      const log = [];
      while (!state.complete) {
        const seat = state.currentSeat;
        const legal = legalActions(state, seat);
        // The short stack jams; everyone else is a pro.
        const action = seat === 0 && legal.canRaise
          ? { type: ACTION.RAISE, amount: legal.maxRaiseTo }
          : pro(state, seat, { actions: log, seed: h * 50 + log.length });
        if (state.players.some((p) => p?.allIn) && seat !== 0) checked++;
        const note = noteAction(state, seat, action);
        expect(() => ({ state } = applyAction(state, { seat, ...action }))).not.toThrow();
        log.push(note);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('calls a preflop shove with aces and folds 72o to one', () => {
    for (const [hand, want] of [['As Ad', ACTION.CALL], ['7c 2d', ACTION.FOLD]]) {
      let { state } = startHand({ seats: seats(2), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
      const log = [];
      const shover = state.currentSeat;
      log.push(noteAction(state, shover, { type: ACTION.RAISE, amount: 10000 }));
      ({ state } = applyAction(state, { seat: shover, type: ACTION.RAISE, amount: 10000 }));
      state.players[state.currentSeat].cards = parseCards(hand);
      expect(pro(state, state.currentSeat, { actions: log }).type).toBe(want);
    }
  });
});

describe('pro bot: fair play', () => {
  it('decides the same whatever the opponents are really holding', () => {
    const deal = seeded(21);
    let checked = 0;
    for (let h = 0; h < 25; h++) {
      const deck = shuffle(createDeck(), intRng(deal));
      let { state } = startHand({ seats: seats(4), buttonSeat: h % 4, blinds: BLINDS, deck });
      const log = [];
      while (!state.complete) {
        const seat = state.currentSeat;
        const legal = legalActions(state, seat);
        const opts = { brain: 'pro', skill: SKILLS.hard, budget: FAST, actions: log };
        const action = decideBotAction(state, seat, legal, { ...opts, rand: seeded(h * 100 + log.length) });

        // Same table, every other hand swapped for cards nobody holds.
        const swapped = structuredClone(state);
        const used = new Set([...state.board, ...state.players.flatMap((p) => p?.cards ?? [])].map((c) => c.r + c.s));
        const spare = createDeck().filter((c) => !used.has(c.r + c.s));
        for (const p of swapped.players) if (p && p.seat !== seat) p.cards = [spare.pop(), spare.pop()];
        const again = decideBotAction(swapped, seat, legal, { ...opts, rand: seeded(h * 100 + log.length) });
        expect(again).toEqual(action);
        checked++;

        const note = noteAction(state, seat, action);
        ({ state } = applyAction(state, { seat, ...action }));
        log.push(note);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('pro bot: never breaks the engine', () => {
  it('plays 300 hands at every difficulty and style without an illegal action', () => {
    const rand = seeded(5);
    const deal = seeded(6);
    const lineup = [
      { brain: 'pro', skill: SKILLS.easy, profile: PRO_STYLE_BY_KEY['pro-loose'] },
      { brain: 'pro', skill: SKILLS.normal, profile: PRO_STYLE_BY_KEY['pro-tricky'] },
      { brain: 'pro', skill: SKILLS.hard, profile: PRO_STYLE_BY_KEY['pro-tight'] },
      { brain: 'pro', skill: SKILLS.hard, profile: PRO_STYLE_BY_KEY['pro-solid'] },
      { brain: 'casual', profile: PROFILE_BY_KEY.maniac },
    ];
    const stats = new SessionStats();
    const ledgers = lineup.map(() => ({}));
    let stacks = lineup.map(() => 10000);
    for (let h = 0; h < 300; h++) {
      if (stacks.filter((x) => x > 0).length < 2) stacks = lineup.map(() => 10000);
      const live = stacks.map((stack, seat) => ({ seat, id: `p${seat}`, name: `P${seat}`, stack })).filter((s) => s.stack > 0);
      let { state } = startHand({
        seats: live, buttonSeat: live[h % live.length].seat,
        blinds: BLINDS, deck: shuffle(createDeck(), intRng(deal)), maxSeats: lineup.length,
      });
      stats.startHand(state);
      const log = [];
      const memory = lineup.map(() => ({}));
      while (!state.complete) {
        const seat = state.currentSeat;
        const action = decideBotAction(state, seat, legalActions(state, seat), {
          ...lineup[seat], budget: FAST, rand, stats, actions: log, memory: memory[seat], ledger: ledgers[seat],
        });
        const note = noteAction(state, seat, action);
        expect(() => ({ state } = applyAction(state, { seat, ...action }))).not.toThrow();
        observe({ log, stats }, note);
      }
      stats.endHand(state);
      for (const p of state.players) if (p) stacks[p.seat] = p.stack;
      expect(stacks.reduce((a, b) => a + b, 0)).toBe(50000);
    }
  });
});

describe('pro bot: balanced bluffing', () => {
  it('keeps river bluffs within what its bet sizes can carry', () => {
    const ledger = {};
    let bets = 0;
    let bluffs = 0;
    for (let i = 0; i < 400; i++) {
      const nuts = i % 2 === 0;
      const log = [
        { seat: 0, id: 'p0', street: 'preflop', type: 'raise', amount: 250, potBefore: 150, betBefore: 100, toCall: 50 },
        { seat: 1, id: 'p1', street: 'preflop', type: 'call', amount: 0, potBefore: 350, betBefore: 250, toCall: 150 },
        { seat: 1, id: 'p1', street: 'river', type: 'check', amount: 0, potBefore: 500, betBefore: 0, toCall: 0 },
      ];
      const { state } = river({ hero: nuts ? 'Th 3d' : '4c 3d', board: 'Ah Kh Qh Jh 8c', pot: 500, heroStack: 20000 });
      const a = pro(state, 0, { actions: log, ledger, seed: i });
      if (a.type === ACTION.RAISE) { bets++; if (!nuts) bluffs++; }
    }
    expect(bets).toBeGreaterThan(100);
    // The largest solid size is a pot bet, which carries one bluff per two bets.
    expect(bluffs / bets).toBeLessThanOrEqual(0.55);
  });
});

describe('pro bot: bet sizing', () => {
  it('bets in whole chips, like every other player, as the blinds go up', () => {
    const rand = seeded(12);
    const deal = seeded(13);
    for (let h = 0; h < 80; h++) {
      // 50/100 bets in 25s; 100/200 in 100s.
      const blinds = h % 2 ? { sb: 100, bb: 200 } : BLINDS;
      let { state } = startHand({ seats: seats(4), buttonSeat: h % 4, blinds, deck: shuffle(createDeck(), intRng(deal)) });
      const log = [];
      while (!state.complete) {
        const seat = state.currentSeat;
        const legal = legalActions(state, seat);
        const action = decideBotAction(state, seat, legal, { brain: 'pro', skill: SKILLS.hard, budget: FAST, rand, actions: log });
        if (action.type === ACTION.RAISE) {
          const edge = action.amount === legal.minRaiseTo || action.amount === legal.maxRaiseTo;
          expect(edge || action.amount % legal.chipUnit === 0).toBe(true);
        }
        const note = noteAction(state, seat, action);
        ({ state } = applyAction(state, { seat, ...action }));
        log.push(note);
      }
    }
  });
});
