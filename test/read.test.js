import { describe, it, expect } from 'vitest';
import { startHand, applyAction } from '../engine/table.js';
import { createDeck } from '../engine/deck.js';
import { ACTION } from '../engine/constants.js';
import { totalWeight, comboIndex } from '../engine/range.js';
import { parseCards } from '../engine/deck.js';
import {
  SessionStats, noteAction, observe, estimateRange, preflopSummary, strengthCache, neutralModel,
} from '../server/bot/read.js';

const BLINDS = { sb: 50, bb: 100 };
const seats = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, id: `p${i}`, name: `P${i}`, stack: 10000 }));

/** A table with a log that records every action the way the Room does. */
function table(n = 6) {
  let { state } = startHand({ seats: seats(n), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
  const log = [];
  const stats = new SessionStats();
  stats.startHand(state);
  const act = (type, amount) => {
    const seat = state.currentSeat;
    const note = noteAction(state, seat, { type, amount });
    ({ state } = applyAction(state, { seat, type, amount }));
    observe({ log, stats }, note);
    return seat;
  };
  return { get state() { return state; }, log, stats, act };
}

describe('the action log', () => {
  it('records who did what, with the pot and price they faced', () => {
    const t = table();
    const utg = t.act(ACTION.RAISE, 250);
    expect(t.log[0]).toMatchObject({ seat: utg, street: 'preflop', type: 'raise', amount: 250, potBefore: 150, betBefore: 100, toCall: 100 });
  });

  it('summarises the preflop raises and limpers', () => {
    const t = table();
    t.act(ACTION.CALL);          // UTG limps
    const opener = t.act(ACTION.RAISE, 400);
    t.act(ACTION.CALL);
    const s = preflopSummary(t.log);
    expect(s.limpers).toBe(1);
    expect(s.raises).toEqual([{ seat: opener, to: 400 }]);
    expect(s.callers).toBe(1);
  });
});

describe('narrowing a range', () => {
  it('gives an early raiser a tighter range than a button raiser', () => {
    const early = table();
    const utg = early.act(ACTION.RAISE, 250);
    const late = table();
    late.act(ACTION.FOLD); late.act(ACTION.FOLD); late.act(ACTION.FOLD);
    const btn = late.act(ACTION.RAISE, 250);
    const w = (t, seat) => totalWeight(estimateRange(t.state, seat, t.log, neutralModel(), { narrow: false }));
    expect(w(early, utg)).toBeLessThan(w(late, btn));
  });

  it('shrinks with every sign of strength: open, then 3-bet', () => {
    const t = table();
    const opener = t.act(ACTION.RAISE, 250);
    const open = totalWeight(estimateRange(t.state, opener, t.log, neutralModel(), { narrow: false }));
    const threeBettor = t.act(ACTION.RAISE, 800);
    const three = totalWeight(estimateRange(t.state, threeBettor, t.log, neutralModel(), { narrow: false }));
    expect(three).toBeLessThan(open);
  });

  it('keeps sets and drops air after a big flop bet', () => {
    // Heads-up to the flop, then a pot-sized bet on K-7-2.
    const deck = createDeck();
    let { state } = startHand({ seats: seats(2), buttonSeat: 0, blinds: BLINDS, deck });
    state.board = parseCards('Kh 7d 2c');
    state.street = 'flop';
    const log = [{ seat: 1, id: 'p1', street: 'flop', type: 'raise', amount: 400, potBefore: 400, betBefore: 0, toCall: 0 }];
    const memory = {};
    const before = estimateRange(state, 1, [], neutralModel(), { narrow: false });
    const after = estimateRange(state, 1, log, neutralModel(), { narrow: true, strengthFor: strengthCache(state.board, memory) });
    const set = comboIndex(...parseCards('7s 7c'));
    const air = comboIndex(...parseCards('Qs Jc'));
    expect(after[set] / before[set]).toBeGreaterThan(after[air] / before[air]);
    expect(memory.strength[3]).toBeDefined();          // cached for the next decision
  });

  it('never returns an empty range', () => {
    const t = table();
    const seat = t.act(ACTION.RAISE, 250);
    const all = [...'23456789TJQKA'].flatMap((r) => ['s', 'h', 'd', 'c'].map((s) => ({ r: '__23456789TJQKA'.indexOf(r), s })));
    const w = estimateRange(t.state, seat, t.log, neutralModel(), { narrow: false, dead: all.slice(0, 48) });
    expect(totalWeight(w)).toBeGreaterThan(0);
  });
});

describe('session stats', () => {
  it('starts every player at the prior', () => {
    expect(new SessionStats().model('nobody')).toEqual(neutralModel());
  });

  it('reads a player who raises every hand as wide, but only gradually', () => {
    const stats = new SessionStats();
    const at = (hands) => {
      const s = new SessionStats();
      for (let h = 0; h < hands; h++) {
        s.startHand({ players: [{ id: 'maniac' }, { id: 'x' }] });
        s.record({ seat: 0, id: 'maniac', street: 'preflop', type: 'raise', betBefore: 100 });
        s.endHand({});
      }
      return s.model('maniac').width;
    };
    expect(at(3)).toBeGreaterThan(1);
    expect(at(30)).toBeGreaterThan(at(3));
    expect(at(30)).toBeLessThanOrEqual(2.5);
    expect(stats.model('maniac', 0)).toEqual(neutralModel());
  });

  it('notices someone who folds to every continuation bet', () => {
    const s = new SessionStats();
    for (let h = 0; h < 40; h++) {
      s.startHand({ players: [{ id: 'a' }, { id: 'b' }] });
      s.record({ seat: 0, id: 'a', street: 'preflop', type: 'raise', betBefore: 100 });
      s.record({ seat: 1, id: 'b', street: 'preflop', type: 'call', betBefore: 250 });
      s.record({ seat: 0, id: 'a', street: 'flop', type: 'raise', betBefore: 0 });
      s.record({ seat: 1, id: 'b', street: 'flop', type: 'fold', betBefore: 300 });
      s.endHand({});
    }
    expect(s.model('b').looseness).toBeLessThan(0.8);
    expect(s.model('b', 0.5).looseness).toBeGreaterThan(s.model('b', 1).looseness);
  });
});
