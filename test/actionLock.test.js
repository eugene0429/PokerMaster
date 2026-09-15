import { describe, it, expect } from 'vitest';
import { createActionLock, decisionKey } from '../public/js/actionLock.js';

const at = ({ handId = 1, street = 'preflop', currentSeat = 1, currentBet = 100, mySeat = 1, toAct = true, complete = false } = {}) => ({
  you: { seat: mySeat },
  toAct: toAct ? { seat: mySeat } : null,
  hand: { handId, street, currentSeat, currentBet, complete },
});

describe('what counts as the same decision', () => {
  it('is the same while nothing about the spot has changed', () => {
    expect(decisionKey(at())).toBe(decisionKey(at()));
  });

  it('changes when the street does', () => {
    expect(decisionKey(at({ street: 'flop' }))).not.toBe(decisionKey(at()));
  });

  it('changes when the action moves to someone else', () => {
    expect(decisionKey(at({ currentSeat: 4 }))).not.toBe(decisionKey(at()));
  });

  it('changes when somebody raises', () => {
    expect(decisionKey(at({ currentBet: 400 }))).not.toBe(decisionKey(at()));
  });

  it('changes when the next hand is dealt', () => {
    expect(decisionKey(at({ handId: 2 }))).not.toBe(decisionKey(at()));
  });

  it('collapses every finished hand onto one key', () => {
    expect(decisionKey(at({ complete: true }))).toBe('idle');
    expect(decisionKey({})).toBe('idle');
  });
});

describe('the action lock', () => {
  it('locks the buttons the moment an action is sent', () => {
    const lock = createActionLock();
    expect(lock.locked).toBe(false);
    lock.arm(at());
    expect(lock.locked).toBe(true);
  });

  it('stays locked while the server has not answered', () => {
    const lock = createActionLock();
    lock.arm(at());
    lock.sync(at());
    expect(lock.locked).toBe(true);
  });

  it('frees them when the turn passes to someone else', () => {
    const lock = createActionLock();
    lock.arm(at());
    lock.sync(at({ currentSeat: 4, toAct: false }));
    expect(lock.locked).toBe(false);
  });

  it('frees them when closing the street hands the action straight back', () => {
    // Heads-up: the big blind checks to end preflop and acts first on the flop.
    // This is the case that left the buttons dead until the clock ran out.
    const lock = createActionLock();
    lock.arm(at({ street: 'preflop', currentSeat: 1, currentBet: 100 }));
    lock.sync(at({ street: 'flop', currentSeat: 1, currentBet: 0 }));
    expect(lock.locked).toBe(false);
  });

  it('frees them when the hand ends', () => {
    const lock = createActionLock();
    lock.arm(at());
    lock.sync(at({ complete: true, toAct: false }));
    expect(lock.locked).toBe(false);
  });

  it('frees them when the server rejects the action', () => {
    const lock = createActionLock();
    lock.arm(at());
    lock.release();
    expect(lock.locked).toBe(false);
  });

  it('frees them rather than leaving anyone stuck if no reply arrives', () => {
    let clock = 1000;
    const lock = createActionLock({ timeoutMs: 4000, now: () => clock });
    lock.arm(at());

    clock = 3000;
    lock.sync(at());
    expect(lock.locked).toBe(true);

    clock = 5500;
    lock.sync(at());
    expect(lock.locked).toBe(false);
  });
});
