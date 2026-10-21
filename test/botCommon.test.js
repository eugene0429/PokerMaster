import { describe, it, expect } from 'vitest';
import { startHand } from '../engine/table.js';
import { createDeck } from '../engine/deck.js';
import { ACTION } from '../engine/constants.js';
import { safe, potNow, playersBehind, postflopOrder, playersDealt } from '../server/bot/common.js';

const BLINDS = { sb: 50, bb: 100 };
const seats = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, id: `p${i}`, name: `P${i}`, stack: 10000 }));

describe('bot helpers', () => {
  it('never folds when checking is free', () => {
    const legal = { canCheck: true, canCall: false, canRaise: true, toCall: 0, minRaiseTo: 100, maxRaiseTo: 10000, chipUnit: 25 };
    expect(safe({ type: ACTION.FOLD }, legal)).toEqual({ type: ACTION.CHECK });
  });

  it('turns an impossible raise into a call, and snaps a raise to whole chips', () => {
    const noRaise = { canCheck: false, canCall: true, canRaise: false, toCall: 100 };
    expect(safe({ type: ACTION.RAISE, amount: 500 }, noRaise)).toEqual({ type: ACTION.CALL });
    const legal = { canCheck: false, canCall: true, canRaise: true, toCall: 100, minRaiseTo: 200, maxRaiseTo: 10000, chipUnit: 25 };
    expect(safe({ type: ACTION.RAISE, amount: 437 }, legal)).toEqual({ type: ACTION.RAISE, amount: 425 });
  });

  it('counts the pot in the middle and in front of the players', () => {
    const { state } = startHand({ seats: seats(3), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
    expect(potNow(state)).toBe(150);
  });

  it('knows who acts behind whom, preflop and postflop', () => {
    const { state } = startHand({ seats: seats(6), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
    expect(playersBehind(state, state.bbSeat)).toBe(0);
    expect(playersBehind(state, state.sbSeat)).toBe(1);
    expect(playersBehind(state, 0)).toBe(2);                    // the button
    expect(playersBehind(state, state.currentSeat)).toBe(5);    // under the gun
    expect(postflopOrder(state, 0)).toBeGreaterThan(postflopOrder(state, state.sbSeat));
    expect(playersDealt(state)).toBe(6);
  });

  it('treats the heads-up button as the small blind, with one player behind', () => {
    const { state } = startHand({ seats: seats(2), buttonSeat: 0, blinds: BLINDS, deck: createDeck() });
    expect(state.sbSeat).toBe(0);
    expect(playersBehind(state, 0)).toBe(1);
    expect(playersBehind(state, 1)).toBe(0);
    expect(postflopOrder(state, 0)).toBeGreaterThan(postflopOrder(state, 1));
  });
});
