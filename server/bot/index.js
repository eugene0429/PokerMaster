import { decideCasualAction } from './casual.js';
import { decideProAction } from './pro.js';

/**
 * One entry point for every bot. `options.brain` picks the player behind the
 * seat: 'pro' for the equity engine, anything else for the casual archetypes.
 * Either way the action returned is legal.
 */
export function decideBotAction(state, seat, legal, options = {}) {
  if (options.brain === 'pro') return decideProAction(state, seat, legal, options);
  return decideCasualAction(state, seat, legal, options);
}

const BOT_NAMES = [
  'Doyle', 'Stu', 'Vanessa', 'Daniel', 'Chris', 'Jennifer',
  'Erik', 'Johnny', 'Fedor', 'Isildur', 'Maria', 'Tom',
];

export function pickBotName(taken) {
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Bots pause long enough that the table doesn't feel like a spreadsheet. */
export function botThinkingTime() {
  return 900 + Math.random() * 1500;
}
