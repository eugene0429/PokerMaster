/**
 * How much of the hand the screen is allowed to show yet.
 *
 * The server sends the finished truth in one go — in an all-in run-out the
 * turn, the river, both hands and the pot all arrive in a single snapshot.
 * Drawing that immediately means nobody sees what happened. So the table
 * deliberately lags the server and plays it out at a dealer's pace.
 */

const FIRST_STREET_MS = 600;   // the beat before the flop hits the felt
const STREET_MS = 900;         // and between each later card
const TABLE_MS = 600;          // between one player's cards and the next
const SETTLE_MS = 700;         // before the pot moves
const RESULTS_MS = 3500;       // before the standings cover the table

export function createReveal(onChange) {
  let state = blank();
  let snapshot = null;
  let timer = null;

  function blank() {
    return { handId: null, board: 0, tabled: new Set(), settled: false, results: false };
  }

  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function later(ms, fn) {
    clear();
    timer = setTimeout(() => {
      timer = null;
      fn();
      step();
    }, ms);
  }

  function step() {
    if (timer || !snapshot) return;
    const hand = snapshot.hand;
    if (!hand) return;

    if (state.board < hand.board.length) {
      // The flop arrives as one motion; the turn and river each get their own.
      const target = state.board < 3 ? 3 : state.board + 1;
      later(state.board === 0 ? FIRST_STREET_MS : STREET_MS, () => {
        state.board = Math.min(target, hand.board.length);
        onChange('board');
      });
      return;
    }

    if (!hand.complete) return;

    const showdown = hand.results?.showdown ? hand.results.hands : [];
    const next = showdown.find((h) => !state.tabled.has(h.seat));
    if (next) {
      later(TABLE_MS, () => {
        state.tabled.add(next.seat);
        onChange('tabled');
      });
      return;
    }

    if (!state.settled) {
      later(SETTLE_MS, () => { state.settled = true; onChange('settled'); });
      return;
    }

    if (!state.results) {
      later(RESULTS_MS, () => { state.results = true; onChange('results'); });
    }
  }

  return {
    sync(next) {
      snapshot = next;
      const hand = next.hand;

      if (!hand) {
        clear();
        state = blank();
        return;
      }

      if (state.handId !== hand.handId) {
        clear();
        state = blank();
        state.handId = hand.handId;
        // Arriving in the middle of a hand: there is no story to replay, so
        // show whatever is already on the table.
        if (hand.board.length > 0) {
          state.board = hand.board.length;
          if (hand.complete) {
            for (const h of hand.results?.hands ?? []) state.tabled.add(h.seat);
            state.settled = true;
          }
        }
      }
      step();
    },

    view() {
      return state;
    }
  };
}
