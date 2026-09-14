import { randomUUID } from 'node:crypto';
import { MAX_SEATS, ACTION } from '../engine/constants.js';
import { startHand, applyAction, legalActions, IllegalAction } from '../engine/table.js';
import { decideBotAction, pickBotName, botThinkingTime } from './bots.js';
import { snapshotFor } from './view.js';

const DEFAULTS = {
  maxSeats: MAX_SEATS,
  sb: 50,
  bb: 100,
  startingStack: 10000,
  turnSeconds: 30,
};

const COUNTDOWN_MS = 3000;
const SETTLE_MS = 5000;
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;

/**
 * One table. One server process, one room — no lobby, no room codes.
 * Owns player identity, seating, the turn clock and the bots; defers every
 * rule question to the engine.
 */
export class Room {
  constructor(transport) {
    this.transport = transport;          // { send(socketId, channel, payload) }
    this.config = { ...DEFAULTS };
    this.players = new Map();            // playerId -> player
    this.tokens = new Map();             // token -> playerId
    this.sockets = new Map();            // socketId -> playerId
    this.hostId = null;
    this.hand = null;
    this.phase = 'idle';                 // idle | countdown | playing | settling
    this.buttonSeat = 0;
    this.turnEndsAt = null;
    this.countdownEndsAt = null;
    this.timers = new Map();
  }

  /* --------------------------- identity ---------------------------- */

  join({ socketId, token, name }) {
    let player = token && this.tokens.has(token) ? this.players.get(this.tokens.get(token)) : null;

    if (player) {
      player.connected = true;
      player.disconnectedAt = null;
      if (name) player.name = sanitizeName(name, player.name);
      this.clearTimer(`drop:${player.id}`);
    } else {
      const id = randomUUID();
      const newToken = randomUUID();
      player = {
        id, token: newToken,
        name: sanitizeName(name, `Player`),
        seat: null, stack: 0, isBot: false,
        connected: true, sittingOut: false, disconnectedAt: null,
      };
      this.players.set(id, player);
      this.tokens.set(newToken, id);
    }

    this.sockets.set(socketId, player.id);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = player.id;

    this.transport.send(socketId, 'identity', {
      token: player.token, name: player.name, seat: player.seat,
    });
    this.publish();
    return player;
  }

  leave(socketId) {
    const playerId = this.sockets.get(socketId);
    this.sockets.delete(socketId);
    if (!playerId) return;
    if ([...this.sockets.values()].includes(playerId)) return; // another tab is still open

    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();

    if (player.seat === null) {
      this.forget(player);
    } else {
      // Hold the seat and the chips for a couple of minutes.
      this.setTimer(`drop:${player.id}`, DISCONNECT_GRACE_MS, () => {
        this.standUp(player.id, { force: true });
        this.forget(player);
        this.publish();
      });
    }

    if (this.hostId === playerId) this.reassignHost();
    // A disconnected player still owes an action — let the clock handle it.
    this.scheduleTurn();
    this.publish();
  }

  forget(player) {
    this.players.delete(player.id);
    this.tokens.delete(player.token);
    if (this.hostId === player.id) this.reassignHost();
  }

  reassignHost() {
    const next = [...this.players.values()].find((p) => !p.isBot && p.connected);
    this.hostId = next ? next.id : null;
  }

  isHost(playerId) {
    return this.hostId === playerId;
  }

  playerIdForSocket(socketId) {
    return this.sockets.get(socketId) ?? null;
  }

  /* ---------------------------- seating ---------------------------- */

  playerAtSeat(seat) {
    for (const p of this.players.values()) if (p.seat === seat) return p;
    return null;
  }

  seatedPlayers() {
    return [...this.players.values()].filter((p) => p.seat !== null);
  }

  spectatorNames() {
    return [...this.players.values()].filter((p) => p.seat === null && p.connected).map((p) => p.name);
  }

  sitDown(playerId, seat, name) {
    const player = this.players.get(playerId);
    if (!player) throw new IllegalAction('unknown player');
    if (player.seat !== null) throw new IllegalAction('already seated');
    if (seat < 0 || seat >= this.config.maxSeats) throw new IllegalAction('no such seat');
    if (this.playerAtSeat(seat)) throw new IllegalAction('seat is taken');

    if (name) player.name = sanitizeName(name, player.name);
    player.seat = seat;
    player.stack = this.config.startingStack;
    player.sittingOut = false;
    this.maybeStartHand();
    this.publish();
  }

  standUp(playerId, { force = false } = {}) {
    const player = this.players.get(playerId);
    if (!player || player.seat === null) return;

    const inLiveHand = this.hand && !this.hand.complete && this.hand.players[player.seat];
    if (inLiveHand && !force) {
      // Fold out of the current hand first, then leave the seat when it ends.
      if (this.hand.currentSeat === player.seat) this.applyPlayerAction(player, { type: ACTION.FOLD });
      player.leaveAfterHand = true;
      this.publish();
      return;
    }
    if (inLiveHand && force && this.hand.currentSeat === player.seat) {
      this.applyPlayerAction(player, { type: ACTION.FOLD });
    }
    player.seat = null;
    player.stack = 0;
    player.leaveAfterHand = false;
    this.publish();
  }

  setSittingOut(playerId, value) {
    const player = this.players.get(playerId);
    if (!player || player.seat === null) return;
    player.sittingOut = !!value;
    if (!value) this.maybeStartHand();
    this.publish();
  }

  /* ------------------------------ bots ----------------------------- */

  addBot(playerId) {
    if (!this.isHost(playerId)) throw new IllegalAction('only the host can add bots');
    const seat = this.firstFreeSeat();
    if (seat === null) throw new IllegalAction('the table is full');

    const id = randomUUID();
    const taken = [...this.players.values()].map((p) => p.name);
    this.players.set(id, {
      id, token: randomUUID(), name: pickBotName(taken),
      seat, stack: this.config.startingStack, isBot: true,
      connected: true, sittingOut: false, disconnectedAt: null,
    });
    this.maybeStartHand();
    this.publish();
  }

  removeBot(playerId, seat) {
    if (!this.isHost(playerId)) throw new IllegalAction('only the host can remove bots');
    const bot = this.playerAtSeat(seat);
    if (!bot || !bot.isBot) throw new IllegalAction('no bot in that seat');
    if (this.hand && !this.hand.complete && this.hand.players[seat] && !this.hand.players[seat].folded) {
      bot.leaveAfterHand = true;
      if (this.hand.currentSeat === seat) this.applyPlayerAction(bot, { type: ACTION.FOLD });
    } else {
      this.players.delete(bot.id);
      this.tokens.delete(bot.token);
    }
    this.publish();
  }

  firstFreeSeat() {
    for (let s = 0; s < this.config.maxSeats; s++) if (!this.playerAtSeat(s)) return s;
    return null;
  }

  /* ---------------------------- settings --------------------------- */

  updateConfig(playerId, patch) {
    if (!this.isHost(playerId)) throw new IllegalAction('only the host can change the table');
    if (this.hand && !this.hand.complete) throw new IllegalAction('wait for the hand to finish');

    const bb = clampInt(patch.bb, 2, 1e9, this.config.bb);
    const sb = clampInt(patch.sb, 1, bb, Math.min(this.config.sb, bb));
    const startingStack = clampInt(patch.startingStack, bb * 5, 1e9, this.config.startingStack);
    const turnSeconds = clampInt(patch.turnSeconds, 5, 300, this.config.turnSeconds);

    this.config = { ...this.config, sb, bb, startingStack, turnSeconds };
    this.publish();
  }

  /* -------------------------- hand lifecycle ------------------------ */

  readyPlayers() {
    return this.seatedPlayers().filter((p) => !p.sittingOut && (p.connected || p.isBot));
  }

  maybeStartHand() {
    if (this.hand && !this.hand.complete) return;
    if (this.phase === 'countdown') return;

    if (this.readyPlayers().length < 2) {
      this.phase = this.hand ? 'settling' : 'idle';
      this.countdownEndsAt = null;
      return;
    }
    this.phase = 'countdown';
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.setTimer('start', COUNTDOWN_MS, () => this.beginHand());
    this.publish();
  }

  beginHand() {
    this.countdownEndsAt = null;

    // Anyone who busted gets a fresh stack — this is a practice table.
    for (const p of this.seatedPlayers()) {
      if (p.stack <= 0) p.stack = this.config.startingStack;
    }

    const ready = this.readyPlayers();
    if (ready.length < 2) {
      this.phase = 'idle';
      this.publish();
      return;
    }

    this.buttonSeat = this.nextButtonSeat(ready.map((p) => p.seat));
    const handId = (this.hand?.handId ?? 0) + 1;

    const { state, events } = startHand({
      seats: ready.map((p) => ({ seat: p.seat, id: p.id, name: p.name, stack: p.stack, isBot: p.isBot })),
      buttonSeat: this.buttonSeat,
      blinds: { sb: this.config.sb, bb: this.config.bb },
      maxSeats: this.config.maxSeats,
      handId,
    });

    this.hand = state;
    this.phase = 'playing';
    this.publish(events);
    this.afterTransition();
  }

  nextButtonSeat(occupied) {
    const sorted = [...occupied].sort((a, b) => a - b);
    for (let i = 1; i <= this.config.maxSeats; i++) {
      const seat = (this.buttonSeat + i) % this.config.maxSeats;
      if (sorted.includes(seat)) return seat;
    }
    return sorted[0];
  }

  /* ----------------------------- actions --------------------------- */

  act(playerId, action) {
    const player = this.players.get(playerId);
    if (!player || player.seat === null) throw new IllegalAction('you are not seated');
    if (!this.hand || this.hand.complete) throw new IllegalAction('no hand in progress');
    if (this.hand.currentSeat !== player.seat) throw new IllegalAction('not your turn');
    this.applyPlayerAction(player, action);
  }

  applyPlayerAction(player, action) {
    const { events } = applyAction(this.hand, {
      seat: player.seat, type: action.type, amount: action.amount,
    });
    this.publish(events);
    this.afterTransition();
  }

  afterTransition() {
    this.clearTimer('turn');
    this.turnEndsAt = null;

    if (this.hand.complete) return this.settleHand();
    this.scheduleTurn();
    this.publish();
  }

  scheduleTurn() {
    this.clearTimer('turn');
    this.turnEndsAt = null;
    if (!this.hand || this.hand.complete) return;

    const seat = this.hand.currentSeat;
    if (seat === null) return;
    const player = this.playerAtSeat(seat);
    if (!player) return;

    if (player.isBot) {
      this.setTimer('turn', botThinkingTime(), () => this.playBot(seat));
      return;
    }
    if (!player.connected || player.sittingOut) {
      this.setTimer('turn', 1200, () => this.autoAct(seat));
      return;
    }
    this.turnEndsAt = Date.now() + this.config.turnSeconds * 1000;
    this.setTimer('turn', this.config.turnSeconds * 1000, () => this.autoAct(seat));
  }

  playBot(seat) {
    if (!this.hand || this.hand.complete || this.hand.currentSeat !== seat) return;
    const legal = legalActions(this.hand, seat);
    let action;
    try {
      action = decideBotAction(this.hand, seat, legal);
    } catch {
      action = legal.canCheck ? { type: ACTION.CHECK } : { type: ACTION.FOLD };
    }
    try {
      this.applyPlayerAction(this.playerAtSeat(seat), action);
    } catch {
      this.applyPlayerAction(this.playerAtSeat(seat), legal.canCheck ? { type: ACTION.CHECK } : { type: ACTION.FOLD });
    }
  }

  /** The clock ran out, or the player is gone: take the free option. */
  autoAct(seat) {
    if (!this.hand || this.hand.complete || this.hand.currentSeat !== seat) return;
    const legal = legalActions(this.hand, seat);
    const player = this.playerAtSeat(seat);
    if (!player) return;
    if (!player.isBot && !player.connected) player.sittingOut = true;
    this.applyPlayerAction(player, legal.canCheck ? { type: ACTION.CHECK } : { type: ACTION.FOLD });
  }

  settleHand() {
    this.phase = 'settling';
    this.turnEndsAt = null;

    for (const p of this.seatedPlayers()) {
      const hp = this.hand.players[p.seat];
      if (hp) p.stack = hp.stack;
    }
    for (const p of [...this.players.values()]) {
      if (p.leaveAfterHand) {
        if (p.isBot) { this.players.delete(p.id); this.tokens.delete(p.token); }
        else { p.seat = null; p.stack = 0; p.leaveAfterHand = false; }
      }
    }
    this.publish();
    this.setTimer('next', SETTLE_MS, () => this.maybeStartHand());
  }

  /* ----------------------------- plumbing -------------------------- */

  setTimer(key, ms, fn) {
    this.clearTimer(key);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      try { fn(); } catch (err) { console.error(`[room] timer ${key}:`, err.message); }
    }, ms));
  }

  clearTimer(key) {
    const t = this.timers.get(key);
    if (t) { clearTimeout(t); this.timers.delete(key); }
  }

  seatOf(playerId) {
    return this.players.get(playerId)?.seat ?? null;
  }

  publish(events = []) {
    for (const [socketId, playerId] of this.sockets) {
      const mySeat = this.seatOf(playerId);
      const visible = events.filter((e) => e.private === undefined || e.private === mySeat);
      this.transport.send(socketId, 'update', {
        snapshot: snapshotFor(this, playerId),
        events: visible,
      });
    }
  }
}

function sanitizeName(name, fallback) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
