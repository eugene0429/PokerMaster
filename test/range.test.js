import { describe, it, expect } from 'vitest';
import {
  ALL_COMBOS, COMBO_COUNT, HAND_ORDER, CLASS_PERCENTILE, classOf, comboIndex, topPercent,
  removeCards, totalWeight, boardStrength, topOfRange, fullRange,
} from '../engine/range.js';
import { rfiPercent, inRange, pushPercent } from '../engine/charts.js';
import { parseCards } from '../engine/deck.js';

const combo = (s) => comboIndex(...parseCards(s));

describe('ranges', () => {
  it('has every two-card combo exactly once', () => {
    expect(ALL_COMBOS).toHaveLength(1326);
    expect(new Set(ALL_COMBOS.map((c) => `${c.ia}-${c.ib}`)).size).toBe(1326);
    expect(combo('As Kd')).toBe(combo('Kd As'));
  });

  it('names hand classes with the high card first', () => {
    expect(classOf(...parseCards('Kd As'))).toBe('AKo');
    expect(classOf(...parseCards('7h 6h'))).toBe('76s');
    expect(classOf(...parseCards('Qc Qs'))).toBe('QQ');
  });

  it('orders all 169 classes from aces down', () => {
    expect(HAND_ORDER).toHaveLength(169);
    expect(new Set(HAND_ORDER).size).toBe(169);
    expect(HAND_ORDER.slice(0, 3)).toEqual(['AA', 'KK', 'QQ']);
    expect(HAND_ORDER.at(-1)).toBe('32o');
    expect(CLASS_PERCENTILE['76s']).toBeLessThan(CLASS_PERCENTILE['T2o']);
  });

  it('counts combos, not classes, for a top-percent range', () => {
    expect(totalWeight(topPercent(6 / 1326))).toBe(6);            // AA only
    expect(totalWeight(topPercent(0.2))).toBeGreaterThan(0.18 * COMBO_COUNT);
    expect(totalWeight(topPercent(0.2))).toBeLessThan(0.22 * COMBO_COUNT);
  });

  it('removes exactly the combos that use a dead card', () => {
    const w = removeCards(fullRange(), parseCards('As'));
    expect(totalWeight(w)).toBe(1326 - 51);
    expect(w[combo('As Kd')]).toBe(0);
    expect(w[combo('Ah Kd')]).toBe(1);
  });

  it('opens wider from the button than under the gun', () => {
    const btn = rfiPercent(2, 6);
    const utg = rfiPercent(5, 6);
    expect(btn).toBeGreaterThan(utg);
    for (const cls of HAND_ORDER) if (inRange(cls, utg)) expect(inRange(cls, btn)).toBe(true);
    expect(inRange('22', btn)).toBe(true);
    expect(inRange('22', rfiPercent(8, 9))).toBe(false);
  });

  it('shoves wider the shorter the stack', () => {
    expect(pushPercent(2, 6, 8)).toBeGreaterThan(pushPercent(2, 6, 15));
  });

  it('rates a set above top pair above a draw above air on the flop', () => {
    const st = boardStrength(parseCards('Kh 7d 2c'));
    expect(st[combo('7s 7c')]).toBeGreaterThan(st[combo('Ks Qd')]);
    expect(st[combo('Ks Qd')]).toBeGreaterThan(st[combo('6d 5d')]);
    expect(st[combo('6d 5d')]).toBeGreaterThan(st[combo('4s 3c')]);
    expect(st[combo('Kh Qd')]).toBe(0);                             // uses a board card
  });

  it('keeps the strongest share of a range by weight', () => {
    const st = boardStrength(parseCards('Kh 7d 2c'));
    const mask = topOfRange(fullRange(), st, 0.1);
    const kept = mask.reduce((s, x) => s + x, 0);
    expect(kept).toBeGreaterThan(100);
    expect(kept).toBeLessThan(140);
    expect(mask[combo('7s 7c')]).toBe(1);
    expect(mask[combo('4s 3c')]).toBe(0);
  });
});
