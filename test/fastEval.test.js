import { describe, it, expect } from 'vitest';
import { fastScore, categoryOf } from '../engine/fastEval.js';
import { evaluateHand, compareHands } from '../engine/handEval.js';
import { createDeck, shuffle, parseCards } from '../engine/deck.js';
import { seeded, intRng } from '../engine/rng.js';
import { CATEGORY } from '../engine/constants.js';

const score = (s) => fastScore(parseCards(s));

describe('fast evaluator', () => {
  it('agrees with handEval on who wins, for 100,000 random pairs of hands', () => {
    const rng = intRng(seeded(1));
    let disagreements = 0;
    for (let i = 0; i < 100000; i++) {
      const n = 5 + (i % 3);                       // 5, 6 and 7 cards
      const d = shuffle(createDeck(), rng);
      const a = d.slice(0, n);
      const b = d.slice(n, 2 * n);
      const want = Math.sign(compareHands(evaluateHand(a), evaluateHand(b)));
      const got = Math.sign(fastScore(a) - fastScore(b));
      if (want !== got) disagreements++;
    }
    expect(disagreements).toBe(0);
  });

  it('ranks every category in order', () => {
    const ladder = [
      '2c 7d 9h Js Kc 3d 4h',   // high card
      '2c 2d 9h Js Kc 3d 4h',   // pair
      '2c 2d 9h 9s Kc 3d 4h',   // two pair
      '2c 2d 2h Js Kc 3d 4h',   // trips
      '2c 3d 4h 5s 6c Jd Kh',   // straight
      '2c 7c 9c Jc Kc 3d 4h',   // flush
      '2c 2d 2h Js Jc 3d 4h',   // full house
      '2c 2d 2h 2s Kc 3d 4h',   // quads
      '2c 3c 4c 5c 6c Jd Kh',   // straight flush
    ].map(score);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    expect(categoryOf(ladder[8])).toBe(CATEGORY.STRAIGHT_FLUSH);
  });

  it('plays the ace low in a wheel, and a six-high straight beats it', () => {
    expect(score('Ac 2d 3h 4s 5c 9d Kh')).toBeLessThan(score('2d 3h 4s 5c 6c 9d Kh'));
    expect(categoryOf(score('Ac 2d 3h 4s 5c 9d Kh'))).toBe(CATEGORY.STRAIGHT);
  });

  it('takes the best full house out of two sets of trips', () => {
    expect(score('9c 9d 9h 4s 4c 4d Kh')).toBeGreaterThan(score('9c 9d 9h 3s 3c 2d Kh'));
    expect(score('9c 9d 9h 4s 4c 4d Kh')).toBe(score('9c 9d 9h 4s 4c Qd Kh'));
  });

  it('plays the kicker with two pair even when a third pair is lower', () => {
    expect(score('Ac Ad Kh Ks 2c 2d Qh')).toBeGreaterThan(score('Ac Ad Kh Ks 2c 2d Jh'));
  });

  it('is much faster than handEval', () => {
    const hand = parseCards('As Kd 9h 7c 4s 3d 2h');
    const rate = (fn) => {
      const t = performance.now();
      let n = 0;
      while (performance.now() - t < 100) { for (let i = 0; i < 200; i++) fn(hand); n += 200; }
      return n;
    };
    // Measured about 38x. The bar is low enough that a busy machine passes it,
    // high enough that sliding back to walking every five-card subset fails it.
    expect(rate(fastScore)).toBeGreaterThan(rate(evaluateHand) * 5);
  });
});
