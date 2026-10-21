import { decideCasualAction } from './casual.js';

/**
 * One entry point for every bot. For now there is only the casual brain.
 * Whatever comes back is legal.
 */
export function decideBotAction(state, seat, legal, options = {}) {
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
