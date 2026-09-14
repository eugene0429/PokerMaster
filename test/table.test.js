import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions, IllegalAction } from '../engine/table.js';
import { parseCards } from '../engine/deck.js';
import { STREET, ACTION } from '../engine/constants.js';

const BLINDS = { sb: 50, bb: 100 };

/** Cards listed in the order they should be dealt (the engine pops off the end). */
const stacked = (str) => parseCards(str).reverse();

function seats(specs) {
  return specs.map((s, i) => ({
    seat: s.seat ?? i, id: `p${s.seat ?? i}`, name: `P${s.seat ?? i}`, stack: s.stack ?? 10000,
  }));
}

const act = (state, seat, type, amount) => applyAction(state, { seat, type, amount });
const stackOf = (state, seat) => state.players[seat].stack;

describe('starting a hand', () => {
  it('posts the blinds left of the button and acts from under the gun', () => {
    const { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    expect(state.players[1].totalCommitted).toBe(50);
    expect(state.players[2].totalCommitted).toBe(100);
    expect(state.currentSeat).toBe(0);
    expect(state.currentBet).toBe(100);
  });

  it('deals two cards to everyone', () => {
    const { state } = startHand({ seats: seats([{}, {}, {}, {}]), buttonSeat: 2, blinds: BLINDS });
    for (const p of state.players.filter(Boolean)) expect(p.cards).toHaveLength(2);
  });

  it('keeps hole cards private in the event stream', () => {
    const { events } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    const holes = events.filter((e) => e.type === 'holeCards');
    expect(holes).toHaveLength(3);
    for (const e of holes) expect(e.private).toBe(e.seat);
  });

  it('makes the button the small blind heads-up, acting first preflop', () => {
    const { state } = startHand({ seats: seats([{}, {}]), buttonSeat: 0, blinds: BLINDS });
    expect(state.sbSeat).toBe(0);
    expect(state.bbSeat).toBe(1);
    expect(state.currentSeat).toBe(0);
  });

  it('gives the big blind the option to act postflop first heads-up', () => {
    let { state } = startHand({ seats: seats([{}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.CALL));
    ({ state } = act(state, 1, ACTION.CHECK));
    expect(state.street).toBe(STREET.FLOP);
    expect(state.currentSeat).toBe(1);
  });

  it('puts a player all-in when their stack is under the blind', () => {
    const { state } = startHand({
      seats: seats([{ stack: 10000 }, { stack: 10000 }, { stack: 40 }]),
      buttonSeat: 0, blinds: BLINDS,
    });
    expect(state.players[2].allIn).toBe(true);
    expect(state.players[2].totalCommitted).toBe(40);
  });
});

describe('action legality', () => {
  it('rejects an action out of turn', () => {
    const { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    expect(() => act(state, 1, ACTION.FOLD)).toThrow(IllegalAction);
  });

  it('rejects a check facing a bet', () => {
    const { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    expect(() => act(state, 0, ACTION.CHECK)).toThrow(/cannot check/);
  });

  it('rejects a raise below the minimum', () => {
    const { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    expect(legalActions(state, 0).minRaiseTo).toBe(200);
    expect(() => act(state, 0, ACTION.RAISE, 150)).toThrow(/minimum raise is 200/);
  });

  it('sets the next minimum raise from the size of the last raise', () => {
    let { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.RAISE, 350));
    expect(legalActions(state, 1).minRaiseTo).toBe(600); // 350 + a 250 increment
  });

  it('turns a call larger than the stack into an all-in call', () => {
    let { state } = startHand({
      seats: seats([{ stack: 10000 }, { stack: 10000 }, { stack: 600 }]),
      buttonSeat: 0, blinds: BLINDS,
    });
    ({ state } = act(state, 0, ACTION.RAISE, 2000));
    ({ state } = act(state, 1, ACTION.FOLD));
    // This closes the betting, so inspect the event rather than the settled state.
    const { state: after, events } = act(state, 2, ACTION.CALL);
    const call = events.find((e) => e.type === 'action' && e.seat === 2);
    expect(call.allIn).toBe(true);
    expect(call.amount).toBe(500);
    expect(after.players[2].totalCommitted).toBe(600);
    // The 1400 seat 0 bet beyond the short stack comes back.
    expect(after.players[0].totalCommitted).toBe(600);
  });
});

describe('an all-in below a full raise', () => {
  // seat0 raises to 300, seat1 calls, seat2 jams 350 — only a 50 increment.
  const setup = () => {
    let { state } = startHand({
      seats: seats([{ stack: 10000 }, { stack: 10000 }, { stack: 350 }]),
      buttonSeat: 0, blinds: BLINDS,
    });
    ({ state } = act(state, 0, ACTION.RAISE, 300));
    ({ state } = act(state, 1, ACTION.CALL));
    ({ state } = act(state, 2, ACTION.RAISE, 350));
    return state;
  };

  it('does not reopen the betting for players who already acted', () => {
    const state = setup();
    expect(state.currentSeat).toBe(0);
    const legal = legalActions(state, 0);
    expect(legal.toCall).toBe(50);
    expect(legal.canRaise).toBe(false);
    expect(() => act(state, 0, ACTION.RAISE, 700)).toThrow(/may not raise/);
  });

  it('leaves the minimum raise where the last full raise left it', () => {
    let state = setup();
    ({ state } = act(state, 0, ACTION.CALL));
    // seat1 already acted too, so they are also capped.
    expect(legalActions(state, 1).canRaise).toBe(false);
    expect(state.minRaise).toBe(200);
  });

  it('still lets a player who has not acted yet raise', () => {
    let { state } = startHand({
      seats: seats([{ stack: 10000 }, { stack: 10000 }, { stack: 10000 }, { stack: 150 }]),
      buttonSeat: 0, blinds: BLINDS,
    });
    ({ state } = act(state, 3, ACTION.RAISE, 150)); // UTG jams for a 50 increment
    expect(state.minRaise).toBe(100); // unchanged: not a full raise
    expect(state.currentSeat).toBe(0);
    const legal = legalActions(state, 0);
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(250); // 150 + the last full raise size
  });
});

describe('street progression', () => {
  it('leaves the big blind their option preflop', () => {
    let { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.CALL));
    ({ state } = act(state, 1, ACTION.CALL));
    expect(state.street).toBe(STREET.PREFLOP);
    expect(state.currentSeat).toBe(2);
    expect(legalActions(state, 2).canCheck).toBe(true);
  });

  it('deals the flop once the big blind checks', () => {
    let { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.CALL));
    ({ state } = act(state, 1, ACTION.CALL));
    ({ state } = act(state, 2, ACTION.CHECK));
    expect(state.street).toBe(STREET.FLOP);
    expect(state.board).toHaveLength(3);
    expect(state.potCollected).toBe(300);
    expect(state.currentSeat).toBe(1); // first live seat left of the button
  });

  it('walks all the way to the river on checks', () => {
    let { state } = startHand({ seats: seats([{}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.CALL));
    ({ state } = act(state, 1, ACTION.CHECK));
    for (const street of [STREET.FLOP, STREET.TURN, STREET.RIVER]) {
      expect(state.street).toBe(street);
      ({ state } = act(state, 1, ACTION.CHECK));
      ({ state } = act(state, 0, ACTION.CHECK));
    }
    expect(state.complete).toBe(true);
    expect(state.board).toHaveLength(5);
    expect(state.results.showdown).toBe(true);
  });

  it('runs the board out when nobody can bet any more', () => {
    let { state } = startHand({
      seats: seats([{ stack: 500 }, { stack: 500 }]), buttonSeat: 0, blinds: BLINDS,
    });
    ({ state } = act(state, 0, ACTION.RAISE, 500));
    ({ state } = act(state, 1, ACTION.CALL));
    expect(state.complete).toBe(true);
    expect(state.board).toHaveLength(5);
  });
});

describe('ending the hand', () => {
  it('returns the uncalled bet and pays the last player standing', () => {
    let { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.FOLD));
    ({ state } = act(state, 1, ACTION.FOLD));
    expect(state.complete).toBe(true);
    expect(state.results.showdown).toBe(false);
    expect(stackOf(state, 2)).toBe(10050); // won the small blind only
    expect(stackOf(state, 1)).toBe(9950);
  });

  it('gives back the part of a bet nobody called', () => {
    let { state } = startHand({ seats: seats([{}, {}, {}]), buttonSeat: 0, blinds: BLINDS });
    ({ state } = act(state, 0, ACTION.RAISE, 900));
    ({ state } = act(state, 1, ACTION.FOLD));
    ({ state } = act(state, 2, ACTION.FOLD));
    expect(stackOf(state, 0)).toBe(10150); // 900 back, plus both blinds
  });

  it('pays the main pot and the side pot to different players', () => {
    // seat2 is short and flops quad sevens; seat0 takes the side pot with two pair.
    const deck = stacked('2c 7c Ah 3d 7d Kh 2h 7h 7s Ad 4c Kd 5c 9c');
    let { state } = startHand({
      seats: seats([{ stack: 1000 }, { stack: 1000 }, { stack: 200 }]),
      buttonSeat: 0, blinds: BLINDS, deck,
    });
    ({ state } = act(state, 0, ACTION.RAISE, 1000));
    ({ state } = act(state, 1, ACTION.CALL));
    ({ state } = act(state, 2, ACTION.CALL));

    expect(state.complete).toBe(true);
    expect(state.pots).toEqual([
      { amount: 600, eligible: [0, 1, 2] },
      { amount: 1600, eligible: [0, 1] },
    ]);
    expect(stackOf(state, 2)).toBe(600);
    expect(stackOf(state, 0)).toBe(1600);
    expect(stackOf(state, 1)).toBe(0);
  });

  it('never creates or destroys chips', () => {
    const before = 1000 + 1000 + 200;
    const deck = stacked('2c 7c Ah 3d 7d Kh 2h 7h 7s Ad 4c Kd 5c 9c');
    let { state } = startHand({
      seats: seats([{ stack: 1000 }, { stack: 1000 }, { stack: 200 }]),
      buttonSeat: 0, blinds: BLINDS, deck,
    });
    ({ state } = act(state, 0, ACTION.RAISE, 1000));
    ({ state } = act(state, 1, ACTION.CALL));
    ({ state } = act(state, 2, ACTION.CALL));
    const after = state.players.filter(Boolean).reduce((s, p) => s + p.stack, 0);
    expect(after).toBe(before);
  });

  it('names the winning hand and marks the five cards that made it', () => {
    const deck = stacked('2c 7c Ah 3d 7d Kh 2h 7h 7s Ad 4c Kd 5c 9c');
    let { state, events } = startHand({
      seats: seats([{ stack: 1000 }, { stack: 1000 }, { stack: 200 }]),
      buttonSeat: 0, blinds: BLINDS, deck,
    });
    let all = [...events];
    for (const [seat, type, amt] of [[0, ACTION.RAISE, 1000], [1, ACTION.CALL], [2, ACTION.CALL]]) {
      const r = act(state, seat, type, amt);
      state = r.state;
      all.push(...r.events);
    }
    const award = all.find((e) => e.type === 'awardPot' && e.seat === 2);
    expect(award.handName).toBe('Four of a Kind, Sevens');
    expect(award.winningCards).toHaveLength(5);
  });
});
