import { legalActions } from '../engine/table.js';
import { blindsForLevel, STRUCTURES, RISING_BLINDS } from './blinds.js';

/**
 * Build the one view of the table that this player is allowed to see.
 * Hidden cards are absent from the payload, not merely flagged — there is
 * nothing to uncover in the devtools.
 */
export function snapshotFor(room, playerId) {
  const me = playerId ? room.players.get(playerId) : null;
  const hand = room.hand;
  const mySeat = me?.seat ?? null;

  const seats = [];
  for (let seat = 0; seat < room.config.maxSeats; seat++) {
    const pl = room.playerAtSeat(seat);
    if (!pl) { seats.push(null); continue; }
    const hp = hand?.players[seat] ?? null;

    seats.push({
      seat,
      name: pl.name,
      isBot: pl.isBot,
      isHost: pl.id === room.hostId,
      isMe: !!me && pl.id === me.id,
      connected: pl.connected,
      sittingOut: pl.sittingOut,
      stack: hp ? hp.stack : pl.stack,
      inHand: !!hp,
      // Sat down mid-hand: dealt in from the next one. Not a state between hands.
      waiting: !!hand && !hand.complete && !hp && !pl.sittingOut,
      rebuysUsed: pl.rebuysUsed ?? 0,
      rebuysLeft: room.rebuysAreUnlimited ? null : room.rebuysLeft(pl),
      folded: hp?.folded ?? false,
      allIn: hp?.allIn ?? false,
      committed: hp?.streetCommitted ?? 0,
      cardCount: hp?.cards.length ?? 0,
      cards: visibleCards(hand, seat, mySeat),
      isDealer: hand ? hand.buttonSeat === seat : room.buttonSeat === seat,
    });
  }

  const live = hand ? hand.players.filter(Boolean) : [];
  const inFront = live.reduce((s, p) => s + p.streetCommitted, 0);

  return {
    config: { ...room.config },
    phase: room.phase,
    seats,
    you: me ? {
      seat: me.seat, name: me.name, isHost: me.id === room.hostId,
      seated: me.seat !== null, stack: me.stack, sittingOut: me.sittingOut,
    } : null,
    hand: hand ? {
      handId: hand.handId,
      street: hand.street,
      board: hand.board,
      buttonSeat: hand.buttonSeat,
      currentSeat: hand.currentSeat,
      currentBet: hand.currentBet,
      potCollected: hand.potCollected,
      potTotal: hand.potCollected + inFront,
      pots: hand.pots,
      complete: hand.complete,
      results: hand.complete ? resultsFor(hand) : null,
    } : null,
    toAct: hand && mySeat !== null && hand.currentSeat === mySeat
      ? legalActions(hand, mySeat)
      : null,
    deadline: room.turnEndsAt,
    countdownEndsAt: room.countdownEndsAt,
    spectators: room.spectatorNames(),
    lobby: room.lobbyRoster(),
    maxBots: room.maxBots,
    chat: room.chat.recent(),
    game: gameState(room),
  };
}

/** The blind clock, the game clock, and how it ends. */
function gameState(room) {
  const rising = RISING_BLINDS.has(room.config.mode);
  return {
    mode: room.config.mode,
    level: room.level,
    maxLevel: room.maxLevel,
    structure: room.config.structure,
    structureLabel: STRUCTURES[room.config.structure]?.label ?? '정석',
    rising,
    blinds: { sb: room.config.sb, bb: room.config.bb },
    nextBlinds: rising && room.level < room.maxLevel
      ? blindsForLevel(room.baseBlinds, room.level + 1, room.config.structure)
      : null,
    levelMinutes: room.config.levelMinutes,
    totalMinutes: room.config.totalMinutes,
    rebuys: room.config.rebuys,
    rebuysUnlimited: room.rebuysAreUnlimited,
    startedAt: room.startedAt,
    levelEndsAt: room.levelEndsAt,
    endsAt: room.endsAt,
    finished: room.finished,
    paused: room.paused,
    pausedAt: room.pausedAt,
    results: room.results,
    playersLeft: room.seatedPlayers().filter((p) => p.stack > 0).length,
    eliminated: room.eliminated.length,
  };
}

function visibleCards(hand, seat, mySeat) {
  const hp = hand?.players[seat];
  if (!hp || hp.cards.length === 0) return null;
  if (seat === mySeat) return hp.cards;
  // Everything else stays hidden until it is actually tabled at showdown.
  if (hand.complete && hand.results?.showdown) {
    const shown = hand.results.hands.find((h) => h.seat === seat);
    if (shown) return shown.cards;
  }
  return null;
}

function resultsFor(hand) {
  return {
    showdown: hand.results.showdown,
    awards: hand.results.awards,
    hands: hand.results.hands.map((h) => ({
      seat: h.seat, cards: h.cards, best: h.best, name: h.name,
    })),
  };
}
