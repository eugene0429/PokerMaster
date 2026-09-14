import { describe, it, expect } from 'vitest';
import { buildPots, awardPots } from '../engine/pot.js';
import { CATEGORY } from '../engine/constants.js';

const hand = (category, ...ranks) => ({ category, ranks });
const total = (pots) => pots.reduce((s, p) => s + p.amount, 0);

describe('buildPots', () => {
  it('makes a single pot when everyone covers everyone', () => {
    const pots = buildPots([
      { seat: 0, committed: 100, folded: false },
      { seat: 1, committed: 100, folded: false },
      { seat: 2, committed: 100, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });

  it('leaves a folded player\'s chips in the pot but not their claim', () => {
    const pots = buildPots([
      { seat: 0, committed: 100, folded: false },
      { seat: 1, committed: 40, folded: true },
      { seat: 2, committed: 100, folded: false },
    ]);
    expect(total(pots)).toBe(240);
    for (const p of pots) expect(p.eligible).not.toContain(1);
  });

  it('splits into a main pot and one side pot for a short all-in', () => {
    const pots = buildPots([
      { seat: 0, committed: 50, folded: false },   // all-in short
      { seat: 1, committed: 200, folded: false },
      { seat: 2, committed: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
  });

  it('builds three layers for three different all-in sizes', () => {
    const pots = buildPots([
      { seat: 0, committed: 50, folded: false },
      { seat: 1, committed: 120, folded: false },
      { seat: 2, committed: 300, folded: false },
      { seat: 3, committed: 300, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: [0, 1, 2, 3] },
      { amount: 210, eligible: [1, 2, 3] },
      { amount: 360, eligible: [2, 3] },
    ]);
    expect(total(pots)).toBe(770);
  });

  it('conserves every chip put into the hand', () => {
    const players = [
      { seat: 0, committed: 33, folded: true },
      { seat: 1, committed: 177, folded: false },
      { seat: 2, committed: 500, folded: false },
      { seat: 3, committed: 500, folded: true },
      { seat: 4, committed: 91, folded: false },
    ];
    const sum = players.reduce((s, p) => s + p.committed, 0);
    expect(total(buildPots(players))).toBe(sum);
  });

  it('ignores players who put in nothing', () => {
    const pots = buildPots([
      { seat: 0, committed: 100, folded: false },
      { seat: 1, committed: 100, folded: false },
      { seat: 2, committed: 0, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 200, eligible: [0, 1] }]);
  });
});

describe('awardPots', () => {
  const strengths = (map) => new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));

  it('gives the pot to the best hand', () => {
    const pots = [{ amount: 300, eligible: [0, 1, 2] }];
    const { awards } = awardPots(pots, strengths({
      0: hand(CATEGORY.PAIR, 9, 8, 5, 3),
      1: hand(CATEGORY.FLUSH, 14, 10, 8, 5, 2),
      2: hand(CATEGORY.TWO_PAIR, 10, 9, 4),
    }), 1, 10);
    expect(awards).toEqual([{ seat: 1, amount: 300, potIndex: 0 }]);
  });

  it('splits an even pot between tied hands', () => {
    const pots = [{ amount: 300, eligible: [0, 1] }];
    const tie = hand(CATEGORY.STRAIGHT, 10);
    const { awards } = awardPots(pots, strengths({ 0: tie, 1: tie }), 0, 10);
    expect(awards).toEqual([
      { seat: 0, amount: 150, potIndex: 0 },
      { seat: 1, amount: 150, potIndex: 0 },
    ]);
  });

  it('gives the odd chip to the first winner left of the button', () => {
    const pots = [{ amount: 301, eligible: [3, 7] }];
    const tie = hand(CATEGORY.STRAIGHT, 10);
    // Button on seat 5, so distribution starts at seat 6: seat 7 comes before seat 3.
    const { awards } = awardPots(pots, strengths({ 3: tie, 7: tie }), 6, 10);
    expect(awards.find((a) => a.seat === 7).amount).toBe(151);
    expect(awards.find((a) => a.seat === 3).amount).toBe(150);
  });

  it('lets a short stack win the main pot while someone else takes the side pot', () => {
    const pots = [
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ];
    const { awards } = awardPots(pots, strengths({
      0: hand(CATEGORY.QUADS, 7, 2),
      1: hand(CATEGORY.FLUSH, 14, 9, 6, 4, 2),
      2: hand(CATEGORY.PAIR, 5, 9, 4, 3),
    }), 1, 10);
    expect(awards).toEqual([
      { seat: 0, amount: 150, potIndex: 0 },
      { seat: 1, amount: 300, potIndex: 1 },
    ]);
  });

  it('skips a pot nobody is eligible for instead of crashing', () => {
    const { awards } = awardPots([{ amount: 100, eligible: [4] }], new Map(), 0, 10);
    expect(awards).toEqual([]);
  });
});
