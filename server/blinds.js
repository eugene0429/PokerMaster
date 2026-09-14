/**
 * Blind structure. Levels are the starting blinds multiplied by a ladder, so
 * whatever the host picks at the menu escalates in the usual shape:
 * 50/100 → 100/200 → 150/300 → 200/400 → 300/600 → …
 */
export const LEVEL_MULTIPLIERS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];

export const MAX_LEVEL = LEVEL_MULTIPLIERS.length - 1;

export function blindsForLevel(base, level) {
  const m = LEVEL_MULTIPLIERS[Math.max(0, Math.min(level, MAX_LEVEL))];
  return { sb: base.sb * m, bb: base.bb * m };
}

/** Which level the clock says we should be on, ignoring whether it is applied. */
export function levelForElapsed(elapsedMs, levelMs) {
  if (!levelMs || levelMs <= 0) return 0;
  return Math.min(MAX_LEVEL, Math.floor(elapsedMs / levelMs));
}

export const MODE = {
  CASH: 'cash',
  TOURNAMENT: 'tournament',
  TIMED: 'timed',
};

export const RISING_BLINDS = new Set([MODE.TOURNAMENT, MODE.TIMED]);
