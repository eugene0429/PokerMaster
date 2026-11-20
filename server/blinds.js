/**
 * Blind structures. Levels are the starting blinds multiplied by a ladder, so
 * whatever the host picks at the menu escalates in the chosen shape.
 */

export const STRUCTURES = {
  // What a live casino tournament actually uses: about 1.5x a level.
  // 25/50 → 50/100 → 75/150 → 100/200 → 150/300 → 200/400 → 300/600 → …
  standard: {
    key: 'standard',
    label: 'Standard',
    multipliers: [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128],
  },
  // A home-game shortcut: every level doubles. Reaches the short-stack part of
  // the game in about five levels, which ends a session fast.
  turbo: {
    key: 'turbo',
    label: 'Turbo',
    multipliers: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096],
  },
};

export const DEFAULT_STRUCTURE = 'standard';

export function multipliersFor(structure) {
  return (STRUCTURES[structure] ?? STRUCTURES[DEFAULT_STRUCTURE]).multipliers;
}

export function maxLevelFor(structure) {
  return multipliersFor(structure).length - 1;
}

export function blindsForLevel(base, level, structure = DEFAULT_STRUCTURE) {
  const ladder = multipliersFor(structure);
  const m = ladder[Math.max(0, Math.min(level, ladder.length - 1))];
  return { sb: base.sb * m, bb: base.bb * m };
}

/** Which level the clock says we should be on, ignoring whether it is applied. */
export function levelForElapsed(elapsedMs, levelMs, maxLevel) {
  if (!levelMs || levelMs <= 0) return 0;
  return Math.min(maxLevel, Math.floor(elapsedMs / levelMs));
}

export const MODE = {
  CASH: 'cash',
  TOURNAMENT: 'tournament',
  TIMED: 'timed',
};

export const RISING_BLINDS = new Set([MODE.TOURNAMENT, MODE.TIMED]);
