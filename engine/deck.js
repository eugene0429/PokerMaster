import { randomInt } from 'node:crypto';
import { SUITS, RANKS } from './constants.js';

export function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck;
}

/** Fisher-Yates. rng(maxExclusive) -> int in [0, maxExclusive). */
export function shuffle(deck, rng = randomInt) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function freshShuffledDeck(rng = randomInt) {
  return shuffle(createDeck(), rng);
}

export function cardToString(card) {
  const r = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[card.r] ?? String(card.r);
  return r + card.s;
}

/** Parse "As", "Td", "7h" — used by tests and fixtures. */
export function parseCard(str) {
  const rankChar = str.slice(0, -1);
  const s = str.slice(-1);
  const r = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[rankChar.toUpperCase()] ?? Number(rankChar);
  return { r, s };
}

export function parseCards(str) {
  return str.trim().split(/\s+/).map(parseCard);
}
