import { describe, it, expect } from 'vitest';
import { evaluateHand, evaluate5, compareHands, handName } from '../engine/handEval.js';
import { parseCards } from '../engine/deck.js';
import { CATEGORY } from '../engine/constants.js';

const ev = (s) => evaluateHand(parseCards(s));
const beats = (a, b) => compareHands(ev(a), ev(b)) > 0;
const ties = (a, b) => compareHands(ev(a), ev(b)) === 0;

describe('categories', () => {
  it('ranks every category correctly', () => {
    expect(ev('As Ks Qs Js Ts').category).toBe(CATEGORY.STRAIGHT_FLUSH);
    expect(ev('9h 8h 7h 6h 5h').category).toBe(CATEGORY.STRAIGHT_FLUSH);
    expect(ev('7c 7d 7h 7s 2c').category).toBe(CATEGORY.QUADS);
    expect(ev('Kc Kd Kh 4s 4c').category).toBe(CATEGORY.FULL_HOUSE);
    expect(ev('Ah Jh 8h 5h 2h').category).toBe(CATEGORY.FLUSH);
    expect(ev('9c 8d 7h 6s 5c').category).toBe(CATEGORY.STRAIGHT);
    expect(ev('Qc Qd Qh 9s 4c').category).toBe(CATEGORY.TRIPS);
    expect(ev('Ac Ad 7h 7s 3c').category).toBe(CATEGORY.TWO_PAIR);
    expect(ev('Tc Td 8h 5s 3c').category).toBe(CATEGORY.PAIR);
    expect(ev('Ac Jd 9h 5s 3c').category).toBe(CATEGORY.HIGH_CARD);
  });

  it('orders the categories against each other', () => {
    expect(beats('As Ks Qs Js Ts', '7c 7d 7h 7s 2c')).toBe(true);
    expect(beats('7c 7d 7h 7s 2c', 'Kc Kd Kh 4s 4c')).toBe(true);
    expect(beats('Kc Kd Kh 4s 4c', 'Ah Jh 8h 5h 2h')).toBe(true);
    expect(beats('Ah Jh 8h 5h 2h', '9c 8d 7h 6s 5c')).toBe(true);
    expect(beats('9c 8d 7h 6s 5c', 'Qc Qd Qh 9s 4c')).toBe(true);
    expect(beats('Qc Qd Qh 9s 4c', 'Ac Ad 7h 7s 3c')).toBe(true);
    expect(beats('Ac Ad 7h 7s 3c', 'Tc Td 8h 5s 3c')).toBe(true);
    expect(beats('Tc Td 8h 5s 3c', 'Ac Jd 9h 5s 3c')).toBe(true);
  });
});

describe('the wheel', () => {
  it('reads A-2-3-4-5 as a five-high straight', () => {
    const w = ev('Ac 5d 4h 3s 2c');
    expect(w.category).toBe(CATEGORY.STRAIGHT);
    expect(w.ranks[0]).toBe(5);
    expect(handName(w)).toBe('Straight, Five high');
  });

  it('loses to a six-high straight', () => {
    expect(beats('6c 5d 4h 3s 2c', 'Ac 5d 4h 3s 2c')).toBe(true);
  });

  it('reads the steel wheel as a straight flush', () => {
    const w = ev('Ah 5h 4h 3h 2h');
    expect(w.category).toBe(CATEGORY.STRAIGHT_FLUSH);
    expect(w.ranks[0]).toBe(5);
  });

  it('does not read A-K-Q-J-T as a wheel', () => {
    expect(ev('Ac Kd Qh Js Tc').ranks[0]).toBe(14);
  });
});

describe('tiebreakers within a category', () => {
  it('compares kickers on one pair', () => {
    expect(beats('9c 9d Ah 5s 3c', '9h 9s Kh 5d 3d')).toBe(true);
    expect(ties('9c 9d Ah 5s 3c', '9h 9s Ad 5d 3d')).toBe(true);
  });

  it('compares the second pair, then the kicker, on two pair', () => {
    expect(beats('Ac Ad 8h 8s 2c', 'Ah As 7h 7d Kc')).toBe(true);
    expect(beats('Ac Ad 8h 8s Kc', 'Ah As 8c 8d Qc')).toBe(true);
  });

  it('compares the trips before the pair on a full house', () => {
    expect(beats('6c 6d 6h Ks Kd', '5c 5d 5h As Ad')).toBe(true);
    expect(beats('6c 6d 6h As Ad', '7s 7h 7c 2s 2d')).toBe(false);
    expect(beats('6c 6d 6h As Ad', '6s 6h 6c Ks Kd')).toBe(true);
  });

  it('compares a flush card by card', () => {
    expect(beats('Ah Kh 7h 4h 2h', 'Ad Kd 7d 4d 3d')).toBe(false);
    expect(beats('Ah Kh 8h 4h 2h', 'Ad Kd 7d 6d 5d')).toBe(true);
  });

  it('compares the kicker on quads', () => {
    expect(beats('4c 4d 4h 4s Ac', '4c 4d 4h 4s Kc')).toBe(true);
  });
});

describe('best five out of seven', () => {
  it('picks the flush over the lower made hand', () => {
    const r = ev('Ah Kh 9h 4h 2h Ks Kd');
    expect(r.category).toBe(CATEGORY.FLUSH);
  });

  it('picks the full house over the trips it is built on', () => {
    const r = ev('Kh Kd Ks 9h 9c 4h 2h');
    expect(r.category).toBe(CATEGORY.FULL_HOUSE);
    expect(r.ranks).toEqual([13, 9]);
  });

  it('picks the straight flush over the quads on the same board', () => {
    const r = ev('9h 8h 7h 6h 5h 9c 9d');
    expect(r.category).toBe(CATEGORY.STRAIGHT_FLUSH);
    expect(r.ranks[0]).toBe(9);
  });

  it('returns the five cards that make the hand', () => {
    const r = ev('Ac Ad Ah 7s 3c 2d 9h');
    expect(r.cards).toHaveLength(5);
    expect(r.cards.filter((c) => c.r === 14)).toHaveLength(3);
    expect(r.cards.map((c) => c.r).sort((a, b) => b - a)).toEqual([14, 14, 14, 9, 7]);
  });

  it('lets both players play the board', () => {
    const board = 'Ah Kh Qh Jh Th';
    expect(ties(`2c 3d ${board}`, `4s 5s ${board}`)).toBe(true);
  });

  it('finds a straight that spans both hole cards and the board', () => {
    const r = ev('9c 8d 7h 6s 5c 2d 2h');
    expect(r.category).toBe(CATEGORY.STRAIGHT);
    expect(r.ranks[0]).toBe(9);
  });
});

describe('hand names', () => {
  it('names each category the way a dealer would', () => {
    expect(handName(evaluate5(parseCards('As Ks Qs Js Ts')))).toBe('Royal Flush');
    expect(handName(evaluate5(parseCards('9h 8h 7h 6h 5h')))).toBe('Straight Flush, Nine high');
    expect(handName(evaluate5(parseCards('7c 7d 7h 7s 2c')))).toBe('Four of a Kind, Sevens');
    expect(handName(evaluate5(parseCards('Kc Kd Kh 4s 4c')))).toBe('Full House, Kings full of Fours');
    expect(handName(evaluate5(parseCards('Ah Jh 8h 5h 2h')))).toBe('Flush, Ace high');
    expect(handName(evaluate5(parseCards('Qc Qd Qh 9s 4c')))).toBe('Three of a Kind, Queens');
    expect(handName(evaluate5(parseCards('Ac Ad 7h 7s 3c')))).toBe('Two Pair, Aces and Sevens');
    expect(handName(evaluate5(parseCards('Tc Td 8h 5s 3c')))).toBe('Pair of Tens');
    expect(handName(evaluate5(parseCards('Ac Jd 9h 5s 3c')))).toBe('High Card, Ace');
  });
});
