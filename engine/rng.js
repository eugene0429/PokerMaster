/**
 * Seedable 0..1 generator (mulberry32). Simulations and tests pass one in so
 * that a run can be replayed exactly; live play uses Math.random.
 */
export function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adapt a 0..1 generator to the (maxExclusive) -> int shape deck.shuffle wants. */
export const intRng = (rand) => (n) => Math.floor(rand() * n);
