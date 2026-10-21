import { describe, it, expect } from 'vitest';
import { equityVsRanges } from '../engine/equity.js';
import { COMBO_COUNT, comboIndex, fullRange, boardStrength, topOfRange, topPercent } from '../engine/range.js';
import { parseCards } from '../engine/deck.js';
import { seeded } from '../engine/rng.js';

const only = (s) => {
  const w = new Float64Array(COMBO_COUNT);
  w[comboIndex(...parseCards(s))] = 1;
  return w;
};
const eq = (hole, board, ranges, samples = 20000) =>
  equityVsRanges(parseCards(hole), board ? parseCards(board) : [], ranges, { samples, rand: seeded(11) }).equity;

describe('equity', () => {
  it('matches known preflop all-in numbers', () => {
    expect(eq('As Ah', '', [only('Kd Kc')])).toBeCloseTo(0.82, 1);
    expect(eq('As Ks', '', [only('Qh Qd')])).toBeCloseTo(0.46, 1);
    expect(Math.abs(eq('As Ah', '', [fullRange()]) - 0.852)).toBeLessThan(0.02);
    expect(Math.abs(eq('As Ah', '', [fullRange(), fullRange(), fullRange()]) - 0.64)).toBeLessThan(0.02);
  });

  it('counts the river exactly against one range', () => {
    const board = 'Kh 7d 2c 9s 3h';
    expect(eq('Ks Kd', board, [fullRange()])).toBe(1);
    expect(eq('As Qd', board, [only('Ah Qs')])).toBe(0.5);
  });

  it('never deals a card twice', () => {
    // Opponent's only hand shares a card with ours: it falls back to any hand.
    const r = equityVsRanges(parseCards('As Ah'), [], [only('As Kd')], { samples: 500, rand: seeded(1) });
    expect(r.samples).toBe(500);
    expect(r.equity).toBeGreaterThan(0.8);
  });

  it('stops at the sample cap and at the time cap', () => {
    const r = equityVsRanges(parseCards('As Ah'), [], [fullRange()], { samples: 300, rand: seeded(1) });
    expect(r.samples).toBe(300);
    // A billion samples would take hours. Stopping at all is the point; the
    // bound is loose so a busy machine does not fail it.
    const t = performance.now();
    const capped = equityVsRanges(parseCards('As Ah'), [], [fullRange()], { samples: 1e9, timeMs: 20, rand: seeded(1) });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(capped.samples).toBeLessThan(1e9);
  });

  it('prices a bet in the same pass: fold rate and equity once called', () => {
    const board = parseCards('Kh 7d 2c');
    const range = topPercent(0.3);
    const strength = boardStrength(board);
    const half = topOfRange(range, strength, 0.5);
    const r = equityVsRanges(parseCards('Ad Qd'), board, [range], { samples: 6000, rand: seeded(2), masks: [[half]] });
    // About half the range folds, and what stays is stronger than the whole.
    expect(r.sizes[0].foldAll).toBeGreaterThan(0.35);
    expect(r.sizes[0].foldAll).toBeLessThan(0.65);
    expect(r.sizes[0].eqCalled).toBeLessThan(r.equity);
  });
});
