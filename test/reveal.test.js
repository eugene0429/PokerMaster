import { describe, it, expect, vi, afterEach } from 'vitest';
import { createReveal } from '../public/js/reveal.js';
import { displayStack } from '../public/js/render.js';

afterEach(() => vi.useRealTimers());

const card = (r, s) => ({ r, s });
const board = (n) => Array.from({ length: n }, (_, i) => card(2 + i, 's'));

function snapshot({ handId = 1, boardCount = 0, complete = false, showdown = false, hands = [], awards = [], seats = [] } = {}) {
  return {
    seats,
    hand: {
      handId,
      board: board(boardCount),
      complete,
      results: complete ? { showdown, hands, awards } : null,
    },
  };
}

describe('holding the pot until it moves on screen', () => {
  const seats = [
    { seat: 0, stack: 12000 },
    { seat: 1, stack: 8000 },
  ];

  it('shows the winner without the pot they have already been paid', () => {
    const s = snapshot({
      boardCount: 5, complete: true, showdown: true,
      awards: [{ seat: 0, amount: 4000, potIndex: 0 }], seats,
    });
    expect(displayStack(s, { settled: false }, 0)).toBe(8000);
    expect(displayStack(s, { settled: false }, 1)).toBe(8000);
  });

  it('shows the full stack once the chips have slid across', () => {
    const s = snapshot({
      boardCount: 5, complete: true, showdown: true,
      awards: [{ seat: 0, amount: 4000, potIndex: 0 }], seats,
    });
    expect(displayStack(s, { settled: true }, 0)).toBe(12000);
  });

  it('adds up a split across several pots', () => {
    const s = snapshot({
      boardCount: 5, complete: true, showdown: true,
      awards: [
        { seat: 0, amount: 1500, potIndex: 0 },
        { seat: 0, amount: 2500, potIndex: 1 },
      ],
      seats,
    });
    expect(displayStack(s, { settled: false }, 0)).toBe(8000);
  });

  it('leaves a hand in progress alone', () => {
    const s = snapshot({ boardCount: 3, seats });
    expect(displayStack(s, { settled: false }, 0)).toBe(12000);
  });

  it('never goes negative', () => {
    const s = snapshot({
      boardCount: 5, complete: true, showdown: true,
      awards: [{ seat: 1, amount: 99999, potIndex: 0 }], seats,
    });
    expect(displayStack(s, { settled: false }, 1)).toBe(0);
  });

  it('shrugs at a seat that is not there', () => {
    expect(displayStack(snapshot({ seats }), { settled: false }, 7)).toBe(0);
  });
});

describe('the reveal pipeline', () => {
  function run() {
    const steps = [];
    const reveal = createReveal((step) => steps.push(step));
    return { reveal, steps };
  }

  it('lays the flop as one motion after a dealer\'s pause', () => {
    vi.useFakeTimers();
    const { reveal } = run();
    reveal.sync(snapshot({ boardCount: 0 }));     // the hand is dealt
    reveal.sync(snapshot({ boardCount: 3 }));     // the flop lands

    expect(reveal.view().board).toBe(0);
    vi.advanceTimersByTime(500);
    expect(reveal.view().board).toBe(0);
    vi.advanceTimersByTime(200);
    expect(reveal.view().board).toBe(3);
  });

  it('deals the turn and the river one at a time, not together', () => {
    vi.useFakeTimers();
    const { reveal } = run();
    reveal.sync(snapshot({ boardCount: 0 }));
    // An all-in run-out: the rest of the board arrives in a single snapshot.
    reveal.sync(snapshot({ boardCount: 5 }));

    vi.advanceTimersByTime(700);
    expect(reveal.view().board).toBe(3);
    vi.advanceTimersByTime(950);
    expect(reveal.view().board).toBe(4);
    vi.advanceTimersByTime(950);
    expect(reveal.view().board).toBe(5);
  });

  it('turns each hand over separately, then settles, then shows the standings', () => {
    vi.useFakeTimers();
    const { reveal, steps } = run();
    reveal.sync(snapshot({ boardCount: 0 }));
    reveal.sync(snapshot({
      boardCount: 5, complete: true, showdown: true,
      hands: [{ seat: 0 }, { seat: 3 }],
    }));

    // 600 for the flop + 900 + 900 for the turn and river = 2400.
    vi.advanceTimersByTime(2500);
    expect(reveal.view().board).toBe(5);
    expect(reveal.view().tabled.size).toBe(0);

    vi.advanceTimersByTime(650);
    expect([...reveal.view().tabled]).toEqual([0]);
    vi.advanceTimersByTime(650);
    expect([...reveal.view().tabled]).toEqual([0, 3]);

    expect(reveal.view().settled).toBe(false);
    vi.advanceTimersByTime(750);
    expect(reveal.view().settled).toBe(true);

    expect(reveal.view().results).toBe(false);
    vi.advanceTimersByTime(3600);
    expect(reveal.view().results).toBe(true);

    expect(steps).toEqual(['board', 'board', 'board', 'tabled', 'tabled', 'settled', 'results']);
  });

  it('gives the standings a beat after the winner is shown', () => {
    vi.useFakeTimers();
    const { reveal } = run();
    reveal.sync(snapshot({ boardCount: 0 }));
    reveal.sync(snapshot({ complete: true, showdown: false }));

    vi.advanceTimersByTime(700);
    expect(reveal.view().settled).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(reveal.view().results).toBe(false);   // still reading the table
    vi.advanceTimersByTime(600);
    expect(reveal.view().results).toBe(true);
  });

  it('starts over when the next hand is dealt', () => {
    vi.useFakeTimers();
    const { reveal } = run();
    reveal.sync(snapshot({ handId: 1, boardCount: 0 }));
    reveal.sync(snapshot({ handId: 1, boardCount: 5 }));
    vi.advanceTimersByTime(5000);
    expect(reveal.view().board).toBe(5);

    reveal.sync(snapshot({ handId: 2, boardCount: 0 }));
    expect(reveal.view().board).toBe(0);
    expect(reveal.view().settled).toBe(false);
  });

  it('shows everything at once to someone who joined mid-hand', () => {
    vi.useFakeTimers();
    const { reveal, steps } = run();
    // First snapshot this client ever sees already has a finished hand on it.
    reveal.sync(snapshot({
      handId: 9, boardCount: 5, complete: true, showdown: true, hands: [{ seat: 2 }],
    }));

    expect(reveal.view().board).toBe(5);
    expect([...reveal.view().tabled]).toEqual([2]);
    expect(reveal.view().settled).toBe(true);
    expect(steps).toEqual([]);               // nothing was replayed
  });
});
