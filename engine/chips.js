/**
 * Bets move in whole chips. The smallest chip that matters at a table is the
 * biggest one both blinds can be paid in, so a 50/100 game bets in 25s and a
 * 100/200 game in 100s — the same "colour up" a live room does as blinds rise.
 */

export const CHIP_DENOMS = [25000, 5000, 1000, 500, 100, 25, 5, 1];

export function chipUnit({ sb, bb }) {
  return CHIP_DENOMS.find((d) => sb % d === 0 && bb % d === 0) ?? 1;
}

/**
 * The nearest raise made of whole chips. The minimum and the all-in stay
 * reachable even when an earlier all-in has left them on an odd number.
 * An amount below the minimum is left alone so the engine can refuse it.
 */
export function snapRaiseTo(amount, { minRaiseTo, maxRaiseTo }, unit) {
  const x = Math.min(Math.floor(amount), maxRaiseTo);
  if (x <= minRaiseTo || x === maxRaiseTo) return x;
  const below = Math.max(minRaiseTo, Math.floor(x / unit) * unit);
  const above = Math.min(maxRaiseTo, Math.ceil(x / unit) * unit);
  return x - below < above - x ? below : above;
}
