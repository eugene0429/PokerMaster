import { ACTION } from '../../engine/constants.js';
import { snapRaiseTo } from '../../engine/chips.js';

/** Everything in the middle: swept pots plus what is in front of each player. */
export function potNow(state) {
  return state.potCollected
    + state.players.reduce((sum, p) => sum + (p ? p.streetCommitted : 0), 0);
}

/** Last line of defence: never hand the engine an action it would reject. */
export function safe(action, legal) {
  if (action.type === ACTION.RAISE) {
    if (!legal.canRaise) return legal.canCall ? { type: ACTION.CALL } : { type: ACTION.CHECK };
    const wanted = Math.max(legal.minRaiseTo, Math.round(action.amount));
    const amount = snapRaiseTo(wanted, legal, legal.chipUnit);
    return { type: ACTION.RAISE, amount };
  }
  if (action.type === ACTION.CALL && !legal.canCall) return { type: ACTION.CHECK };
  if (action.type === ACTION.CHECK && !legal.canCheck) {
    return legal.canCall ? { type: ACTION.CALL } : { type: ACTION.FOLD };
  }
  if (action.type === ACTION.FOLD && legal.canCheck) return { type: ACTION.CHECK };
  return action;
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Preflop acting order is UTG … button, small blind, big blind. How many
 * players dealt in act after `seat` preflop: 0 for the big blind, 1 for the
 * small blind, 2 for the button. Heads-up the button is the small blind.
 */
export function playersBehind(state, seat) {
  const order = [];
  for (let i = 1; i <= state.maxSeats; i++) {
    const s = (state.bbSeat + i) % state.maxSeats;
    if (state.players[s]) order.push(s);
  }
  const idx = order.indexOf(seat);
  return idx < 0 ? 0 : order.length - 1 - idx;
}

/** Postflop the button acts last. Larger means later. */
export function postflopOrder(state, seat) {
  return (seat - state.buttonSeat - 1 + state.maxSeats) % state.maxSeats;
}

export const playersDealt = (state) => state.players.filter(Boolean).length;
