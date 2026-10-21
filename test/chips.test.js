import { describe, it, expect } from 'vitest';
import { chipUnit, snapRaiseTo } from '../engine/chips.js';
import { startHand, applyAction, legalActions } from '../engine/table.js';
import { ACTION } from '../engine/constants.js';

describe('chip unit', () => {
  it('is the biggest chip that makes up both blinds', () => {
    expect(chipUnit({ sb: 25, bb: 50 })).toBe(25);
    expect(chipUnit({ sb: 50, bb: 100 })).toBe(25);
    expect(chipUnit({ sb: 75, bb: 150 })).toBe(25);
    expect(chipUnit({ sb: 100, bb: 200 })).toBe(100);
    expect(chipUnit({ sb: 1000, bb: 2000 })).toBe(1000);
    expect(chipUnit({ sb: 10, bb: 20 })).toBe(5);
    expect(chipUnit({ sb: 7, bb: 14 })).toBe(1);
  });
});

describe('snapping a raise to whole chips', () => {
  const legal = { minRaiseTo: 200, maxRaiseTo: 9950 };

  it('rounds to the nearest chip unit', () => {
    expect(snapRaiseTo(237, legal, 25)).toBe(225);
    expect(snapRaiseTo(238, legal, 25)).toBe(250);
    expect(snapRaiseTo(1367, legal, 100)).toBe(1400);
  });

  it('never rounds below the minimum or past the stack', () => {
    expect(snapRaiseTo(210, legal, 100)).toBe(200);
    expect(snapRaiseTo(9930, legal, 100)).toBe(9950);
  });

  it('keeps an odd minimum and an odd all-in as they are', () => {
    const odd = { minRaiseTo: 337, maxRaiseTo: 4013 };
    expect(snapRaiseTo(337, odd, 25)).toBe(337);
    expect(snapRaiseTo(4013, odd, 25)).toBe(4013);
    expect(snapRaiseTo(345, odd, 25)).toBe(350);
    expect(snapRaiseTo(4000, odd, 25)).toBe(4000);
  });

  it('leaves a raise below the minimum for the engine to reject', () => {
    expect(snapRaiseTo(150, legal, 25)).toBe(150);
  });
});

describe('the engine and chip units', () => {
  const seats = [0, 1, 2].map((i) => ({ seat: i, id: `p${i}`, name: `P${i}`, stack: 10000 }));

  it('tells the player which chip unit bets move in', () => {
    const { state } = startHand({ seats, buttonSeat: 0, blinds: { sb: 50, bb: 100 } });
    expect(legalActions(state, 0).chipUnit).toBe(25);
  });

  it('rounds an odd raise to whole chips', () => {
    const { state } = startHand({ seats, buttonSeat: 0, blinds: { sb: 50, bb: 100 } });
    const { events } = applyAction(state, { seat: 0, type: ACTION.RAISE, amount: 333 });
    const raise = events.find((e) => e.type === 'action');
    expect(raise.amount).toBe(325);
  });
});
