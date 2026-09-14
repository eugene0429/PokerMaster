import { compareHands } from './handEval.js';

/**
 * Split the money into main pot + side pots.
 * `players`: [{ seat, committed, folded }] — `committed` is the total put in
 * across the whole hand.
 * Returns [{ amount, eligible: [seat] }], main pot first.
 */
export function buildPots(players) {
  const levels = [...new Set(players.filter((p) => p.committed > 0).map((p) => p.committed))]
    .sort((a, b) => a - b);

  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      amount += Math.min(p.committed, level) - Math.min(p.committed, prev);
    }
    prev = level;
    if (amount <= 0) continue;

    const eligible = players.filter((p) => !p.folded && p.committed >= level).map((p) => p.seat);
    if (eligible.length === 0) {
      // Dead money nobody can claim at this level — fold it into the pot below.
      if (pots.length) pots[pots.length - 1].amount += amount;
      continue;
    }
    const last = pots[pots.length - 1];
    if (last && sameSeats(last.eligible, eligible)) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  return pots;
}

function sameSeats(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Decide who gets what.
 * `strengthBySeat`: Map<seat, evaluatedHand> for every player still live.
 * `oddChipSeat`: where odd-chip distribution starts — the seat left of the button.
 * Returns { awards: [{ seat, amount, potIndex }], potWinners: [[seat]] }.
 */
export function awardPots(pots, strengthBySeat, oddChipSeat, maxSeats) {
  const awards = [];
  const potWinners = [];
  const order = seatOrderFrom(oddChipSeat, maxSeats);

  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligible.filter((s) => strengthBySeat.has(s));
    if (contenders.length === 0) {
      potWinners.push([]);
      return;
    }

    let winners = [contenders[0]];
    for (const seat of contenders.slice(1)) {
      const cmp = compareHands(strengthBySeat.get(seat), strengthBySeat.get(winners[0]));
      if (cmp > 0) winners = [seat];
      else if (cmp === 0) winners.push(seat);
    }

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    const byseat = new Map(winners.map((s) => [s, share]));
    // Odd chips go one at a time, starting left of the button.
    for (const seat of order) {
      if (remainder === 0) break;
      if (!byseat.has(seat)) continue;
      byseat.set(seat, byseat.get(seat) + 1);
      remainder--;
    }

    for (const seat of winners) {
      if (byseat.get(seat) > 0) awards.push({ seat, amount: byseat.get(seat), potIndex });
    }
    potWinners.push(winners);
  });

  return { awards, potWinners };
}

export function seatOrderFrom(startSeat, maxSeats) {
  const out = [];
  for (let i = 0; i < maxSeats; i++) out.push((startSeat + i) % maxSeats);
  return out;
}
