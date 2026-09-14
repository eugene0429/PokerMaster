import { STREET, ACTION, MAX_SEATS } from './constants.js';
import { freshShuffledDeck } from './deck.js';
import { evaluateHand, handName } from './handEval.js';
import { buildPots, awardPots, seatOrderFrom } from './pot.js';

/**
 * One hand of no-limit hold'em, as a state machine.
 *
 * Every transition returns { state, events }. `events` is the ordered list of
 * what just happened; the client replays it as animation. The state alone is
 * enough to draw the table, the events are what make it move.
 *
 * This module knows nothing about sockets, timers or the DOM.
 */

function makePlayer(p) {
  return {
    seat: p.seat,
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    stack: p.stack,
    cards: [],
    folded: false,
    allIn: false,
    streetCommitted: 0,
    totalCommitted: 0,
    hasActed: false,
    canRaise: true,
  };
}

/**
 * @param seats   [{ seat, id, name, stack, isBot }] — everyone dealt in (stack > 0)
 * @param deck    optional pre-built deck, for deterministic tests
 */
export function startHand({ seats, buttonSeat, blinds, handId = 1, deck = null, maxSeats = MAX_SEATS }) {
  const live = seats.filter((s) => s.stack > 0);
  if (live.length < 2) throw new Error('need at least 2 players with chips');

  const players = new Array(maxSeats).fill(null);
  for (const s of live) players[s.seat] = makePlayer(s);

  const state = {
    handId,
    maxSeats,
    buttonSeat,
    blinds: { ...blinds },
    players,
    deck: deck ? deck.slice() : freshShuffledDeck(),
    board: [],
    street: STREET.PREFLOP,
    currentSeat: null,
    currentBet: 0,
    minRaise: blinds.bb,
    potCollected: 0,
    pots: [],
    results: null,
    complete: false,
  };

  const events = [{ type: 'handStart', handId, buttonSeat, blinds: { ...blinds } }];

  const inHand = occupied(state);
  const headsUp = inHand.length === 2;
  // Heads-up: the button posts the small blind and acts first preflop.
  const sbSeat = headsUp ? buttonSeat : nextOccupied(state, buttonSeat);
  const bbSeat = nextOccupied(state, sbSeat);
  state.sbSeat = sbSeat;
  state.bbSeat = bbSeat;

  postBlind(state, events, sbSeat, blinds.sb, 'sb');
  postBlind(state, events, bbSeat, blinds.bb, 'bb');
  state.currentBet = Math.max(...occupied(state).map((p) => p.streetCommitted));
  state.minRaise = blinds.bb;

  // Two passes, starting left of the button (the small blind).
  for (let pass = 0; pass < 2; pass++) {
    let seat = sbSeat;
    for (let i = 0; i < inHand.length; i++) {
      const p = state.players[seat];
      p.cards.push(state.deck.pop());
      events.push({ type: 'deal', seat, pass });
      seat = nextOccupied(state, seat);
    }
  }
  for (const p of occupied(state)) {
    events.push({ type: 'holeCards', seat: p.seat, cards: p.cards.slice(), private: p.seat });
  }

  // Blind posters have not voluntarily acted yet — the big blind still has the option.
  for (const p of occupied(state)) {
    p.hasActed = false;
    p.canRaise = true;
  }

  state.currentSeat = nextActor(state, bbSeat);
  if (state.currentSeat === null) {
    // Everyone is all-in from the blinds. Run it out.
    return finishBettingRound(state, events);
  }
  events.push({ type: 'actionOn', seat: state.currentSeat });
  return { state, events };
}

function postBlind(state, events, seat, amount, kind) {
  const p = state.players[seat];
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.streetCommitted += paid;
  p.totalCommitted += paid;
  if (p.stack === 0) p.allIn = true;
  events.push({ type: 'postBlind', seat, amount: paid, kind, allIn: p.allIn });
}

/* ------------------------------------------------------------------ */
/* Seat helpers                                                        */
/* ------------------------------------------------------------------ */

function occupied(state) {
  return state.players.filter(Boolean);
}

function nextOccupied(state, from) {
  for (let i = 1; i <= state.maxSeats; i++) {
    const seat = (from + i) % state.maxSeats;
    if (state.players[seat]) return seat;
  }
  return null;
}

/** Next player who still has a decision to make. */
function nextActor(state, from) {
  for (let i = 1; i <= state.maxSeats; i++) {
    const seat = (from + i) % state.maxSeats;
    const p = state.players[seat];
    if (p && !p.folded && !p.allIn) return seat;
  }
  return null;
}

function firstActorAfterButton(state) {
  return nextActor(state, state.buttonSeat);
}

function liveSeats(state) {
  return occupied(state).filter((p) => !p.folded);
}

function actionableSeats(state) {
  return occupied(state).filter((p) => !p.folded && !p.allIn);
}

/* ------------------------------------------------------------------ */
/* Legal actions                                                       */
/* ------------------------------------------------------------------ */

export function legalActions(state, seat) {
  const p = state.players[seat];
  if (!p || state.complete || state.currentSeat !== seat) return null;

  const toCall = Math.min(state.currentBet - p.streetCommitted, p.stack);
  const maxRaiseTo = p.streetCommitted + p.stack;
  // A raise must reach currentBet + minRaise, unless the player is going all-in
  // for less — and a player facing an all-in under-raise cannot re-raise at all.
  const wantRaiseTo = state.currentBet + state.minRaise;
  const canRaise = p.canRaise && maxRaiseTo > state.currentBet;

  return {
    seat,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    toCall,
    canRaise,
    minRaiseTo: canRaise ? Math.min(wantRaiseTo, maxRaiseTo) : null,
    maxRaiseTo: canRaise ? maxRaiseTo : null,
    isBet: state.currentBet === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Applying an action                                                  */
/* ------------------------------------------------------------------ */

export class IllegalAction extends Error {}

export function applyAction(state, { seat, type, amount = 0 }) {
  if (state.complete) throw new IllegalAction('hand is over');
  if (state.currentSeat !== seat) throw new IllegalAction('not your turn');

  const p = state.players[seat];
  if (!p || p.folded || p.allIn) throw new IllegalAction('you cannot act');

  const legal = legalActions(state, seat);
  const events = [];

  switch (type) {
    case ACTION.FOLD: {
      p.folded = true;
      p.hasActed = true;
      p.canRaise = false;
      events.push({ type: 'action', seat, action: ACTION.FOLD });
      break;
    }
    case ACTION.CHECK: {
      if (!legal.canCheck) throw new IllegalAction('cannot check facing a bet');
      p.hasActed = true;
      p.canRaise = false;
      events.push({ type: 'action', seat, action: ACTION.CHECK });
      break;
    }
    case ACTION.CALL: {
      if (!legal.canCall) throw new IllegalAction('nothing to call');
      pay(p, legal.toCall);
      p.hasActed = true;
      p.canRaise = false;
      events.push({
        type: 'action', seat, action: ACTION.CALL,
        amount: legal.toCall, committed: p.streetCommitted, allIn: p.allIn,
      });
      break;
    }
    case ACTION.RAISE: {
      if (!legal.canRaise) throw new IllegalAction('you may not raise');
      const raiseTo = Math.min(Math.floor(amount), legal.maxRaiseTo);
      if (raiseTo <= state.currentBet) throw new IllegalAction('raise must exceed the current bet');
      const isAllIn = raiseTo === legal.maxRaiseTo;
      if (raiseTo < legal.minRaiseTo && !isAllIn) {
        throw new IllegalAction(`minimum raise is ${legal.minRaiseTo}`);
      }

      const increment = raiseTo - state.currentBet;
      pay(p, raiseTo - p.streetCommitted);
      p.hasActed = true;
      p.canRaise = false;

      const isFullRaise = increment >= state.minRaise;
      if (isFullRaise) {
        state.minRaise = increment;
        // A full raise reopens the betting for everyone else.
        for (const q of actionableSeats(state)) if (q.seat !== seat) q.canRaise = true;
      }
      // An all-in for less than a full raise does NOT reopen the betting:
      // players who already acted may only call or fold.
      state.currentBet = Math.max(state.currentBet, raiseTo);

      events.push({
        type: 'action', seat, action: ACTION.RAISE,
        amount: raiseTo, increment, committed: p.streetCommitted,
        allIn: p.allIn, isBet: legal.isBet,
      });
      break;
    }
    default:
      throw new IllegalAction(`unknown action: ${type}`);
  }

  return advance(state, events);
}

function pay(p, amount) {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.streetCommitted += paid;
  p.totalCommitted += paid;
  if (p.stack === 0) p.allIn = true;
}

/* ------------------------------------------------------------------ */
/* Round / street progression                                          */
/* ------------------------------------------------------------------ */

function advance(state, events) {
  if (liveSeats(state).length === 1) {
    return endHandUncontested(state, events);
  }
  if (bettingClosed(state)) {
    return finishBettingRound(state, events);
  }
  state.currentSeat = nextActor(state, state.currentSeat);
  if (state.currentSeat === null) return finishBettingRound(state, events);
  events.push({ type: 'actionOn', seat: state.currentSeat });
  return { state, events };
}

function bettingClosed(state) {
  const actionable = actionableSeats(state);
  if (actionable.length === 0) return true;
  // With one player left who can act and nothing to call, the round is over.
  return actionable.every((p) => p.hasActed && p.streetCommitted === state.currentBet);
}

/** Give back the part of the top bet that nobody called, then sweep to the pot. */
function returnUncalled(state, events) {
  const commits = occupied(state).map((p) => p.streetCommitted).sort((a, b) => b - a);
  if (commits.length < 2 || commits[0] <= commits[1]) return;
  const top = occupied(state).filter((p) => p.streetCommitted === commits[0]);
  if (top.length !== 1) return;

  const p = top[0];
  const excess = commits[0] - commits[1];
  p.stack += excess;
  p.streetCommitted -= excess;
  p.totalCommitted -= excess;
  if (p.stack > 0) p.allIn = false;
  events.push({ type: 'returnBet', seat: p.seat, amount: excess });
}

function sweepToPot(state, events) {
  let swept = 0;
  for (const p of occupied(state)) {
    swept += p.streetCommitted;
    p.streetCommitted = 0;
  }
  if (swept > 0) {
    state.potCollected += swept;
    events.push({ type: 'collectPot', amount: swept, total: state.potCollected });
  }
}

function finishBettingRound(state, events) {
  returnUncalled(state, events);
  sweepToPot(state, events);

  for (const p of occupied(state)) {
    p.hasActed = false;
    p.canRaise = true;
  }
  state.currentBet = 0;
  state.minRaise = state.blinds.bb;
  state.currentSeat = null;

  if (liveSeats(state).length === 1) return endHandUncontested(state, events);

  // Nobody left to bet: run the rest of the board out in one go.
  const runOut = actionableSeats(state).length < 2;

  while (state.street !== STREET.RIVER) {
    dealNextStreet(state, events);
    if (!runOut) {
      state.currentSeat = firstActorAfterButton(state);
      if (state.currentSeat === null) break;
      events.push({ type: 'actionOn', seat: state.currentSeat });
      return { state, events };
    }
  }
  return showdown(state, events);
}

function dealNextStreet(state, events) {
  const burn = state.deck.pop();
  events.push({ type: 'burn', card: burn });

  if (state.street === STREET.PREFLOP) {
    const cards = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
    state.board.push(...cards);
    state.street = STREET.FLOP;
    events.push({ type: 'community', street: STREET.FLOP, cards });
  } else if (state.street === STREET.FLOP) {
    const card = state.deck.pop();
    state.board.push(card);
    state.street = STREET.TURN;
    events.push({ type: 'community', street: STREET.TURN, cards: [card] });
  } else if (state.street === STREET.TURN) {
    const card = state.deck.pop();
    state.board.push(card);
    state.street = STREET.RIVER;
    events.push({ type: 'community', street: STREET.RIVER, cards: [card] });
  }
}

/* ------------------------------------------------------------------ */
/* Ending the hand                                                     */
/* ------------------------------------------------------------------ */

function endHandUncontested(state, events) {
  returnUncalled(state, events);
  sweepToPot(state, events);

  const winner = liveSeats(state)[0];
  const amount = state.potCollected;
  winner.stack += amount;
  state.pots = [{ amount, eligible: [winner.seat] }];
  state.results = {
    showdown: false,
    awards: [{ seat: winner.seat, amount, potIndex: 0 }],
    hands: [],
  };

  for (const p of occupied(state)) {
    if (p.folded) events.push({ type: 'muck', seat: p.seat });
  }
  events.push({ type: 'awardPot', seat: winner.seat, amount, potIndex: 0, winningCards: [] });
  return complete(state, events);
}

function showdown(state, events) {
  state.street = STREET.SHOWDOWN;

  const contributions = occupied(state).map((p) => ({
    seat: p.seat, committed: p.totalCommitted, folded: p.folded,
  }));
  state.pots = buildPots(contributions);

  const strength = new Map();
  const hands = [];
  for (const p of liveSeats(state)) {
    const ev = evaluateHand([...p.cards, ...state.board]);
    strength.set(p.seat, ev);
    hands.push({ seat: p.seat, cards: p.cards.slice(), best: ev.cards, name: handName(ev) });
  }

  // Reveal in seat order starting left of the button.
  for (const seat of seatOrderFrom((state.buttonSeat + 1) % state.maxSeats, state.maxSeats)) {
    const h = hands.find((x) => x.seat === seat);
    if (h) events.push({ type: 'showdown', seat, cards: h.cards, best: h.best, name: h.name });
  }
  for (const p of occupied(state)) {
    if (p.folded) events.push({ type: 'muck', seat: p.seat });
  }

  const oddChipSeat = (state.buttonSeat + 1) % state.maxSeats;
  const { awards, potWinners } = awardPots(state.pots, strength, oddChipSeat, state.maxSeats);

  for (const a of awards) {
    state.players[a.seat].stack += a.amount;
    const h = hands.find((x) => x.seat === a.seat);
    events.push({
      type: 'awardPot', seat: a.seat, amount: a.amount, potIndex: a.potIndex,
      winningCards: h ? h.best : [], handName: h ? h.name : null,
    });
  }

  state.results = { showdown: true, awards, hands, potWinners };
  return complete(state, events);
}

function complete(state, events) {
  state.street = STREET.COMPLETE;
  state.complete = true;
  state.currentSeat = null;
  events.push({ type: 'handEnd', handId: state.handId });
  return { state, events };
}
