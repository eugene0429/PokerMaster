import { describe, it, expect } from 'vitest';
import { playMatch } from '../server/bot/simulate.js';
import { PROFILE_BY_KEY, PRO_STYLE_BY_KEY, SKILLS } from '../server/bot/profiles.js';

const casual = (key) => ({ id: key, brain: 'casual', profile: PROFILE_BY_KEY[key] });
const pro = (id, skill) => ({ id, brain: 'pro', profile: PRO_STYLE_BY_KEY['pro-solid'], skill: SKILLS[skill] });
// A small budget keeps this under a few seconds. `npm run arena` runs the real thing.
const QUICK = { samples: 300, timeMs: Infinity };

describe('bots against bots', () => {
  it('has a hard pro beating a field of casual bots', () => {
    const { table } = playMatch({
      lineup: [pro('PRO', 'hard'), casual('nit'), casual('tag'), casual('lag'), casual('station'), casual('maniac')],
      decks: 150, seed: 3, budget: QUICK,
    });
    const [me, ...field] = table;
    expect(me.hands).toBe(900);
    expect(me.bbPer100).toBeGreaterThan(0);
    expect(me.bbPer100).toBeGreaterThan(Math.max(...field.map((r) => r.bbPer100)));
  }, 60000);

  it('replays exactly for the same seed', () => {
    const run = () => playMatch({
      lineup: [pro('PRO', 'normal'), casual('tag'), casual('station')], decks: 20, seed: 8, budget: QUICK,
    }).table;
    expect(run()).toEqual(run());
  });

  it('conserves chips: what one bot wins, the others lose', () => {
    const { table } = playMatch({
      lineup: [pro('A', 'easy'), pro('B', 'hard'), casual('lag')], decks: 30, seed: 2, budget: QUICK,
    });
    expect(table.reduce((s, r) => s + r.bbPer100, 0)).toBeCloseTo(0, 6);
  });
});
