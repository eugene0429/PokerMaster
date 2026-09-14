import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../engine/table.js';
import { decideBotAction, preflopStrength, lateness } from '../server/bots.js';
import { PROFILE_BY_KEY, PROFILES, makeProfileDealer } from '../server/bot-profiles.js';
import { parseCards } from '../engine/deck.js';
import { ACTION } from '../engine/constants.js';

const BLINDS = { sb: 50, bb: 100 };

/** Deterministic PRNG so personality comparisons don't flake. */
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const seats = (n, stack = 10000) =>
  Array.from({ length: n }, (_, i) => ({ seat: i, id: `p${i}`, name: `P${i}`, stack }));

/** What does this profile do in a fresh preflop spot, over and over? */
function preflopMix(profileKey, samples = 400, seed = 7) {
  const rand = seeded(seed);
  const profile = PROFILE_BY_KEY[profileKey];
  const counts = { fold: 0, call: 0, raise: 0, check: 0 };

  for (let i = 0; i < samples; i++) {
    const { state } = startHand({ seats: seats(6), buttonSeat: 0, blinds: BLINDS });
    const seat = state.currentSeat;
    const legal = legalActions(state, seat);
    const action = decideBotAction(state, seat, legal, { profile, rand });
    counts[action.type]++;
  }
  const pct = (n) => (n / samples) * 100;
  return { fold: pct(counts.fold), call: pct(counts.call), raise: pct(counts.raise) };
}

describe('preflop strength', () => {
  it('orders hands the way a player would', () => {
    const s = (str) => preflopStrength(parseCards(str));
    expect(s('Ac Ad')).toBeGreaterThan(s('Kc Kd'));
    expect(s('Kc Kd')).toBeGreaterThan(s('Ah Kh'));
    expect(s('Ah Kh')).toBeGreaterThan(s('Ah Kd'));   // suited beats offsuit
    expect(s('Ah Kd')).toBeGreaterThan(s('7c 2d'));
    expect(s('7c 2d')).toBe(0);
  });
});

describe('position', () => {
  it('reads the button as the latest seat and the blind as the earliest', () => {
    const { state } = startHand({ seats: seats(6), buttonSeat: 0, blinds: BLINDS });
    expect(lateness(state, 0)).toBe(1);   // the button acts last
    expect(lateness(state, 1)).toBe(0);   // the small blind acts first
    expect(lateness(state, 3)).toBeGreaterThan(0);
    expect(lateness(state, 3)).toBeLessThan(1);
  });
});

describe('personalities actually differ', () => {
  it('has the maniac raising far more than the nit', () => {
    const maniac = preflopMix('maniac');
    const nit = preflopMix('nit');
    expect(maniac.raise).toBeGreaterThan(40);
    expect(nit.raise).toBeLessThan(15);
    expect(maniac.raise - nit.raise).toBeGreaterThan(30);
  });

  it('has the nit folding far more than the maniac', () => {
    expect(preflopMix('nit').fold - preflopMix('maniac').fold).toBeGreaterThan(30);
  });

  it('has the calling station calling much more than it raises', () => {
    const station = preflopMix('station');
    expect(station.call).toBeGreaterThan(station.raise * 2);
  });

  it('has the loose-aggressive playing more hands than the tight-aggressive', () => {
    expect(preflopMix('lag').fold).toBeLessThan(preflopMix('tag').fold);
  });

  it('gives every personality a reason to enter a pot', () => {
    for (const p of PROFILES) {
      const mix = preflopMix(p.key);
      expect(mix.raise + mix.call).toBeGreaterThan(5);   // nobody folds everything
    }
  });

  it('has the aggressive personalities opening for a raise, not limping in', () => {
    // The old single bot almost never raised preflop; that was the complaint.
    for (const key of ['tag', 'lag', 'maniac']) {
      const mix = preflopMix(key);
      expect(mix.raise).toBeGreaterThan(12);
      expect(mix.raise).toBeGreaterThan(mix.call);
    }
  });
});

describe('profile dealing', () => {
  it('gives a table of bots different personalities', () => {
    const next = makeProfileDealer(seeded(3));
    const keys = Array.from({ length: PROFILES.length }, () => next().key);
    expect(new Set(keys).size).toBe(PROFILES.length);
  });
});

describe('bots never break the engine', () => {
  /** Deal a hand, let the bots play it out, hand back the finished state. */
  function playOut(playerSeats, profiles, rand) {
    let { state } = startHand({ seats: playerSeats, buttonSeat: 0, blinds: BLINDS });
    let guard = 0;
    while (!state.complete) {
      if (++guard > 500) throw new Error('hand never finished');
      const seat = state.currentSeat;
      const legal = legalActions(state, seat);
      const action = decideBotAction(state, seat, legal, { profile: profiles[seat], rand });
      ({ state } = applyAction(state, { seat, type: action.type, amount: action.amount }));
    }
    return state;
  }

  it('plays 200 full hands without an illegal action, and never loses a chip', () => {
    const rand = seeded(2024);
    for (let hand = 0; hand < 200; hand++) {
      const count = 2 + Math.floor(rand() * 9);
      const table = Array.from({ length: count }, (_, i) => ({
        seat: i, id: `p${i}`, name: `P${i}`,
        // Mixed stack depths so short stacks, all-ins and side pots all happen.
        stack: 200 + Math.floor(rand() * 12000),
      }));
      const profiles = table.map(() => PROFILES[Math.floor(rand() * PROFILES.length)]);
      const before = table.reduce((sum, p) => sum + p.stack, 0);

      const state = playOut(table, profiles, rand);

      const after = state.players.filter(Boolean).reduce((sum, p) => sum + p.stack, 0);
      expect(after).toBe(before);
      expect(state.players.filter(Boolean).every((p) => p.stack >= 0)).toBe(true);
    }
  });

  it('falls back to a legal action when it cannot raise', () => {
    // A player with exactly the call amount left can only call or fold.
    const table = [
      { seat: 0, id: 'a', name: 'A', stack: 10000 },
      { seat: 1, id: 'b', name: 'B', stack: 10000 },
      { seat: 2, id: 'c', name: 'C', stack: 300 },
    ];
    let { state } = startHand({ seats: table, buttonSeat: 0, blinds: BLINDS });
    ({ state } = applyAction(state, { seat: 0, type: ACTION.RAISE, amount: 300 }));
    ({ state } = applyAction(state, { seat: 1, type: ACTION.CALL }));

    const legal = legalActions(state, 2);
    expect(legal.canRaise).toBe(false);
    for (const profile of PROFILES) {
      const action = decideBotAction(state, 2, legal, { profile, rand: seeded(5) });
      expect([ACTION.FOLD, ACTION.CALL]).toContain(action.type);
    }
  });
});
