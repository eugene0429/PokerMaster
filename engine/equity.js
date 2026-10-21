import { fastScore } from './fastEval.js';
import { ALL_COMBOS, COMBO_COUNT, cardId, removeCards, totalWeight, fullRange } from './range.js';
import { createDeck } from './deck.js';

/**
 * How often `hole` wins against opponents holding hands from `ranges`, with
 * the rest of the board still to come. A tie counts as the share of the pot
 * it would actually win.
 *
 * `masks` asks a second question in the same pass. Each entry is one bet size:
 * an array, per opponent, of 0/1 flags over the 1326 combos saying which hands
 * would keep going against that bet. For each size the result reports how
 * often everybody folds, and how we do against whoever is left when somebody
 * does not. One simulation answers every size at once.
 *
 * Stops at `samples` or `timeMs`, whichever comes first. The river against one
 * opponent is small enough to count exactly, so it is.
 */
export function equityVsRanges(hole, board, ranges, opts = {}) {
  const { samples = 1500, timeMs = Infinity, rand = Math.random, masks = [] } = opts;
  const known = [...hole, ...board];
  const live = ranges.map((r) => {
    const w = removeCards(r, known);
    return totalWeight(w) > 0 ? w : removeCards(fullRange(), known);
  });

  if (board.length === 5 && live.length === 1) return exactRiver(hole, board, live[0], masks);
  return monteCarlo(hole, board, live, masks, samples, timeMs, rand);
}

const DECK_IDS = createDeck();
const BY_ID = new Array(52);
for (const c of DECK_IDS) BY_ID[cardId(c)] = c;

function sampler(weights) {
  const idx = [];
  const cum = [];
  let t = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (weights[i] > 0) { t += weights[i]; idx.push(i); cum.push(t); }
  }
  return (u) => {
    const x = u * t;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1; else hi = mid;
    }
    return idx[lo];
  };
}

function monteCarlo(hole, board, live, masks, samples, timeMs, rand) {
  const draw = live.map(sampler);
  const used = new Uint8Array(52);
  const baseUsed = [...hole, ...board].map(cardId);
  const runout = 5 - board.length;
  const mine = [hole[0], hole[1], ...board, null, null, null, null, null].slice(0, 7);
  const theirs = new Array(7);
  const picks = new Array(live.length);
  const scores = new Array(live.length);

  let share = 0;
  let n = 0;
  const sizeStats = masks.map(() => ({ foldAll: 0, calledShare: 0, called: 0 }));
  const deadline = timeMs === Infinity ? Infinity : Date.now() + timeMs;

  outer:
  while (n < samples) {
    if ((n & 63) === 0 && n > 0 && Date.now() > deadline) break;
    used.fill(0);
    for (const id of baseUsed) used[id] = 1;

    for (let o = 0; o < live.length; o++) {
      let tries = 0;
      let ci;
      do {
        ci = draw[o](rand());
        if (++tries > 50) continue outer;   // this sample is unlucky, draw another
      } while (used[ALL_COMBOS[ci].ia] || used[ALL_COMBOS[ci].ib]);
      used[ALL_COMBOS[ci].ia] = 1;
      used[ALL_COMBOS[ci].ib] = 1;
      picks[o] = ci;
    }

    for (let k = 0; k < runout; k++) {
      let id;
      do { id = Math.floor(rand() * 52); } while (used[id]);
      used[id] = 1;
      mine[board.length + 2 + k] = BY_ID[id];
    }

    const me = fastScore(mine, 7);
    for (let i = 2; i < 7; i++) theirs[i] = mine[i];
    let best = me;
    for (let o = 0; o < live.length; o++) {
      const c = ALL_COMBOS[picks[o]];
      theirs[0] = c.a;
      theirs[1] = c.b;
      scores[o] = fastScore(theirs, 7);
      if (scores[o] > best) best = scores[o];
    }
    share += potShare(me, scores, null);

    for (let m = 0; m < masks.length; m++) {
      const cont = masks[m];
      let anyone = false;
      for (let o = 0; o < live.length; o++) if (cont[o][picks[o]]) { anyone = true; break; }
      if (!anyone) { sizeStats[m].foldAll++; continue; }
      sizeStats[m].called++;
      sizeStats[m].calledShare += potShare(me, scores, (o) => cont[o][picks[o]]);
    }
    n++;
  }

  return finish(share, n, sizeStats);
}

/** Our cut of the pot against the opponents `stays` keeps (all if null). */
function potShare(me, scores, stays) {
  let tied = 1;
  for (let o = 0; o < scores.length; o++) {
    if (stays && !stays(o)) continue;
    if (scores[o] > me) return 0;
    if (scores[o] === me) tied++;
  }
  return 1 / tied;
}

function exactRiver(hole, board, weights, masks) {
  const mine = fastScore([...hole, ...board]);
  const cards = [null, null, ...board];
  let total = 0;
  let share = 0;
  const sizeStats = masks.map(() => ({ foldAll: 0, calledShare: 0, called: 0 }));

  for (let i = 0; i < COMBO_COUNT; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    cards[0] = ALL_COMBOS[i].a;
    cards[1] = ALL_COMBOS[i].b;
    const theirs = fastScore(cards, 7);
    const s = mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
    total += w;
    share += w * s;
    for (let m = 0; m < masks.length; m++) {
      if (masks[m][0][i]) { sizeStats[m].called += w; sizeStats[m].calledShare += w * s; }
      else sizeStats[m].foldAll += w;
    }
  }
  return finish(share, total, sizeStats);
}

function finish(share, n, sizeStats) {
  return {
    equity: n > 0 ? share / n : 0,
    samples: n,
    sizes: sizeStats.map((s) => ({
      foldAll: n > 0 ? s.foldAll / n : 0,
      eqCalled: s.called > 0 ? s.calledShare / s.called : 0,
    })),
  };
}
