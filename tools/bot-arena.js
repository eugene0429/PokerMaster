#!/usr/bin/env node
/**
 * How strong are the bots, really? Plays duplicate matches with no server and
 * prints bb/100 with error bars.
 *
 *   npm run arena                 # both lineups, 6000 decks each (36,000 hands)
 *   npm run arena -- --decks 500  # quicker, noisier
 */
import { playMatch } from '../server/bot/simulate.js';
import { PROFILE_BY_KEY, PRO_STYLE_BY_KEY, SKILLS } from '../server/bot/profiles.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const decks = arg('decks', 6000);
const seed = arg('seed', 1);
// Full per-difficulty sample budgets, but no clock: a run must replay exactly.
const budget = { timeMs: Infinity };

const casual = (key) => ({ id: key, brain: 'casual', profile: PROFILE_BY_KEY[key] });
const pro = (id, skill) => ({ id, brain: 'pro', profile: PRO_STYLE_BY_KEY['pro-solid'], skill: SKILLS[skill] });
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);

function report(title, lineup, pairs = []) {
  const t = Date.now();
  const m = playMatch({ lineup, decks, seed, budget });
  console.log(`\n${title} — ${decks * lineup.length} hands each, ${((Date.now() - t) / 1000).toFixed(0)}s`);
  console.table(m.table.map((r) => ({ bot: r.id, 'bb/100': fmt(r.bbPer100), '±': r.se.toFixed(1) })));
  for (const [a, b] of pairs) {
    const c = m.compare(a, b);
    console.log(`${a} − ${b}: ${fmt(c.diff)} ± ${c.se.toFixed(1)} bb/100  (z = ${(c.diff / c.se).toFixed(2)})`);
  }
  console.log(`pro decision time p95: ${m.p95.toFixed(1)} ms`);
  return m;
}

report('Hard pro vs the casual field', [
  pro('pro-hard', 'hard'), casual('nit'), casual('tag'), casual('lag'), casual('station'), casual('maniac'),
]);
report('Difficulty ladder', [
  pro('hard', 'hard'), pro('normal', 'normal'), pro('easy', 'easy'), casual('tag'), casual('rock'), casual('tricky'),
], [['hard', 'normal'], ['normal', 'easy']]);
