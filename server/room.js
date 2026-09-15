import { randomUUID } from 'node:crypto';
import { MAX_SEATS, ACTION } from '../engine/constants.js';
import { startHand, applyAction, legalActions, IllegalAction } from '../engine/table.js';
import { decideBotAction, pickBotName, botThinkingTime } from './bots.js';
import { makeProfileDealer } from './bot-profiles.js';
import { blindsForLevel, levelForElapsed, MAX_LEVEL, MODE, RISING_BLINDS } from './blinds.js';
import { snapshotFor } from './view.js';

const DEFAULTS = {
  maxSeats: MAX_SEATS,
  sb: 50,
  bb: 100,
  startingStack: 10000,
  turnSeconds: 30,
  // Must match the option the main menu shows pre-selected. When they differed,
  // a client that omitted `mode` silently opened a cash game while its own UI
  // said tournament, and the blinds never rose.
  mode: MODE.TOURNAMENT,
  levelMinutes: 10,
  totalMinutes: 60,
};

/**
 * Identifies this server process. A page left open across a restart is running
 * the old client, which is how a table once opened in the wrong mode: the stale
 * script never sent one, and the server quietly fell back to its default.
 */
const BUILD_ID = `${Date.now()}`;

const COUNTDOWN_MS = 3000;
const SETTLE_MS = 5000;
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;
/** Miss this many clocks in a row and the table stops waiting for you. */
const TIMEOUTS_BEFORE_SITTING_OUT = 2;

/**
 * One table. One server process, one room — no lobby, no room codes.
 * Owns player identity, seating, the turn clock, the blind clock and the bots;
 * defers every rule question to the engine.
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
    this.phase = 'idle';                 // idle | countdown | playing | settling | finished
    this.buttonSeat = 0;
    this.turnEndsAt = null;
    this.countdownEndsAt = null;
    this.timers = new Map();
    this.nextProfile = makeProfileDealer();
    this.invite = { urls: [], primary: '', qr: null, hasLan: false };

    this.baseBlinds = { sb: DEFAULTS.sb, bb: DEFAULTS.bb };
    this.level = 0;
    this.startedAt = null;
    this.endsAt = null;                  // timed mode only
    this.eliminated = [];                // knocked out, first one out first
    this.results = null;
  }

  /* --------------------------- identity ---------------------------- */

  join({ socketId, token, name }) {
    let player = token && this.tokens.has(token) ? this.players.get(this.tokens.get(token)) : null;

    if (player) {
      player.connected = true;
      player.disconnectedAt = null;
      if (name) player.name = this.uniqueName(sanitizeName(name, player.name), player.id);
      this.clearTimer(`drop:${player.id}`);
    } else {
      const id = randomUUID();
      const newToken = randomUUID();
      player = {
        id, token: newToken,
        name: this.uniqueName(sanitizeName(name, 'Player')),
        seat: null, stack: 0, isBot: false,
        connected: true, sittingOut: false, disconnectedAt: null, timeouts: 0,
      };
      this.players.set(id, player);
      this.tokens.set(newToken, id);
    }

    this.sockets.set(socketId, player.id);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = player.id;

    this.transport.send(socketId, 'identity', {
      token: player.token, name: player.name, seat: player.seat,
      invite: this.invite,
      build: BUILD_ID,
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

  /**
   * Two friends both called 민준 are indistinguishable at the table, so the
   * second one becomes "민준 2". Reconnecting players pass their own id and
   * keep the name they already had.
   */
  uniqueName(name, excludeId = null) {
    const taken = new Set();
    for (const p of this.players.values()) if (p.id !== excludeId) taken.add(p.name);
    if (!taken.has(name)) return name;

    const base = name.slice(0, 13).trimEnd() || 'Player';
    for (let n = 2; n < 100; n++) {
      const candidate = `${base} ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base} ${Date.now() % 1000}`;
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
    if (!player) throw new IllegalAction('알 수 없는 플레이어입니다');
    if (player.seat !== null) throw new IllegalAction('이미 앉아 있습니다');
    if (seat < 0 || seat >= this.config.maxSeats) throw new IllegalAction('그런 자리가 없습니다');
    if (this.playerAtSeat(seat)) throw new IllegalAction('이미 누가 앉은 자리입니다');
    if (this.finished) throw new IllegalAction('게임이 끝났습니다');
    if (this.isTournament() && this.startedAt) {
      throw new IllegalAction('토너먼트가 이미 시작돼서 참가할 수 없습니다');
    }

    if (name) player.name = this.uniqueName(sanitizeName(name, player.name), player.id);
    player.seat = seat;
    player.stack = this.config.startingStack;
    player.sittingOut = false;
    player.timeouts = 0;
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
    this.recordExit(player);
    this.unseat(player);
    this.publish();
  }

  /**
   * Leaving a running tournament is still an exit — rank them where they quit
   * rather than dropping them out of the standings entirely.
   */
  recordExit(player) {
    if (!RISING_BLINDS.has(this.config.mode) || !this.startedAt) return;
    if (player.seat === null) return;
    if (this.eliminated.some((p) => p.id === player.id)) return;
    this.eliminated.push({ id: player.id, name: player.name, isBot: player.isBot });
  }

  unseat(player) {
    player.seat = null;
    player.stack = 0;
    player.leaveAfterHand = false;
    player.sittingOut = false;
    player.timeouts = 0;
  }

  setSittingOut(playerId, value) {
    const player = this.players.get(playerId);
    if (!player || player.seat === null) return;
    player.sittingOut = !!value;
    if (!value) { player.timeouts = 0; this.maybeStartHand(); }
    this.publish();
  }

  /**
   * The host clearing a seat — a bot, or a friend who wandered off and is
   * burning 30 seconds of everyone's time on every turn.
   */
  kick(playerId, seat) {
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 내보낼 수 있습니다');
    const target = this.playerAtSeat(Number(seat));
    if (!target) throw new IllegalAction('그 자리는 비어 있습니다');
    if (target.id === playerId) throw new IllegalAction('자기 자신은 "일어서기"로 나가세요');

    const inLiveHand = this.hand && !this.hand.complete
      && this.hand.players[target.seat] && !this.hand.players[target.seat].folded;

    if (inLiveHand) {
      // Fold them out first so the hand can finish cleanly.
      if (this.hand.currentSeat === target.seat) this.applyPlayerAction(target, { type: ACTION.FOLD });
      target.leaveAfterHand = true;
    } else {
      this.recordExit(target);
      this.unseat(target);
      if (target.isBot) { this.players.delete(target.id); this.tokens.delete(target.token); }
    }
    this.maybeStartHand();
    this.publish();
  }

  /* ------------------------------ bots ----------------------------- */

  addBot(playerId, seat = null) {
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 봇을 추가할 수 있습니다');
    if (this.finished) throw new IllegalAction('게임이 끝났습니다');

    const target = seat === null || seat === undefined ? this.firstFreeSeat() : Number(seat);
    if (target === null) throw new IllegalAction('테이블이 꽉 찼습니다');
    if (!Number.isInteger(target) || target < 0 || target >= this.config.maxSeats) {
      throw new IllegalAction('그런 자리가 없습니다');
    }
    if (this.playerAtSeat(target)) throw new IllegalAction('이미 누가 앉은 자리입니다');
    if (this.isTournament() && this.startedAt) {
      throw new IllegalAction('토너먼트가 이미 시작돼서 봇을 넣을 수 없습니다');
    }

    const id = randomUUID();
    const taken = [...this.players.values()].map((p) => p.name);
    this.players.set(id, {
      id, token: randomUUID(), name: this.uniqueName(pickBotName(taken)),
      seat: target, stack: this.config.startingStack, isBot: true,
      profile: this.nextProfile(),
      connected: true, sittingOut: false, disconnectedAt: null, timeouts: 0,
    });
    this.maybeStartHand();
    this.publish();
  }

  firstFreeSeat() {
    for (let s = 0; s < this.config.maxSeats; s++) if (!this.playerAtSeat(s)) return s;
    return null;
  }

  /* ---------------------------- settings --------------------------- */

  updateConfig(playerId, patch) {
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 테이블 설정을 바꿀 수 있습니다');
    if (this.hand && !this.hand.complete) throw new IllegalAction('핸드가 끝난 뒤에 바꿀 수 있습니다');
    if (RISING_BLINDS.has(this.config.mode) && (patch.sb || patch.bb)) {
      throw new IllegalAction('블라인드가 오르는 게임에서는 블라인드를 직접 못 바꿉니다');
    }
    this.applyConfig(patch);
    if (!RISING_BLINDS.has(this.config.mode)) {
      this.baseBlinds = { sb: this.config.sb, bb: this.config.bb };
    }
    this.publish();
  }

  applyConfig(patch = {}) {
    const bb = clampInt(patch.bb, 2, 1e9, this.config.bb);
    const sb = clampInt(patch.sb, 1, bb, Math.min(this.config.sb, bb));
    const startingStack = clampInt(patch.startingStack, bb * 5, 1e9, this.config.startingStack);
    const turnSeconds = clampInt(patch.turnSeconds, 5, 300, this.config.turnSeconds);
    const mode = Object.values(MODE).includes(patch.mode) ? patch.mode : this.config.mode;
    const levelMinutes = clampInt(patch.levelMinutes, 1, 120, this.config.levelMinutes);
    const totalMinutes = clampInt(patch.totalMinutes, 5, 600, this.config.totalMinutes);
    this.config = { ...this.config, sb, bb, startingStack, turnSeconds, mode, levelMinutes, totalMinutes };
  }

  /**
   * The main menu's "게임 입장": settings, a seat and the bots in one step.
   * Only works while the table is still empty, so two people pressing it at
   * the same moment cannot both open a table — the server decides, not the UI.
   */
  startTable(playerId, opts = {}) {
    const player = this.players.get(playerId);
    if (!player) throw new IllegalAction('알 수 없는 플레이어입니다');
    if (this.seatedPlayers().length > 0) throw new IllegalAction('이미 열린 테이블이 있습니다');

    this.hostId = playerId;
    this.applyConfig(opts);
    this.baseBlinds = { sb: this.config.sb, bb: this.config.bb };
    this.level = 0;
    this.eliminated = [];
    this.results = null;

    const seat = Number.isInteger(opts.seat) ? opts.seat : 0;
    this.sitDown(playerId, seat, opts.name);

    const bots = clampInt(opts.bots, 0, this.config.maxSeats - 1, 0);
    for (let i = 0; i < bots; i++) {
      if (this.firstFreeSeat() === null) break;
      this.addBot(playerId);
    }
    this.publish();
  }

  /** Back to the main menu for everyone, with nothing carried over. */
  resetTable(playerId) {
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 새 게임을 시작할 수 있습니다');
    this.dispose();

    for (const p of [...this.players.values()]) {
      if (p.isBot) { this.players.delete(p.id); this.tokens.delete(p.token); }
      else this.unseat(p);
    }
    this.hand = null;
    this.phase = 'idle';
    this.level = 0;
    this.startedAt = null;
    this.endsAt = null;
    this.eliminated = [];
    this.results = null;
    this.turnEndsAt = null;
    this.countdownEndsAt = null;
    this.config = { ...this.config, sb: this.baseBlinds.sb, bb: this.baseBlinds.bb };
    this.publish();
  }

  /* --------------------------- game clock -------------------------- */

  isTournament() { return this.config.mode === MODE.TOURNAMENT; }
  get finished() { return this.phase === 'finished'; }
  get levelMs() { return this.config.levelMinutes * 60 * 1000; }

  get levelEndsAt() {
    if (!this.startedAt || !RISING_BLINDS.has(this.config.mode)) return null;
    if (this.level >= MAX_LEVEL) return null;
    return this.startedAt + (this.level + 1) * this.levelMs;
  }

  /**
   * Blinds only move between hands. Raising them mid-hand would change the
   * minimum raise under a player who has already acted.
   */
  applyDueLevel() {
    if (!RISING_BLINDS.has(this.config.mode) || !this.startedAt) return;
    const due = levelForElapsed(Date.now() - this.startedAt, this.levelMs);
    if (due <= this.level) return;
    this.level = due;
    const { sb, bb } = blindsForLevel(this.baseBlinds, this.level);
    this.config = { ...this.config, sb, bb };
  }

  /* -------------------------- hand lifecycle ------------------------ */

  readyPlayers() {
    return this.seatedPlayers().filter((p) => !p.sittingOut && (p.connected || p.isBot));
  }

  maybeStartHand() {
    if (this.finished) return;
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
    if (this.finished) return;

    // A cash table is a practice table: busted players just get a fresh stack.
    if (this.config.mode === MODE.CASH) {
      for (const p of this.seatedPlayers()) {
        if (p.stack <= 0) p.stack = this.config.startingStack;
      }
    }

    if (this.startedAt === null) this.startedAt = Date.now();
    if (this.config.mode === MODE.TIMED && this.endsAt === null) {
      this.endsAt = this.startedAt + this.config.totalMinutes * 60 * 1000;
    }
    this.applyDueLevel();

    const ready = this.readyPlayers().filter((p) => p.stack > 0);
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
    if (!player || player.seat === null) throw new IllegalAction('자리에 앉아 있지 않습니다');
    if (!this.hand || this.hand.complete) throw new IllegalAction('진행 중인 핸드가 없습니다');
    if (this.hand.currentSeat !== player.seat) throw new IllegalAction('아직 차례가 아닙니다');
    player.timeouts = 0;
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
    const bot = this.playerAtSeat(seat);
    let action;
    try {
      action = decideBotAction(this.hand, seat, legal, { profile: bot?.profile });
    } catch {
      action = legal.canCheck ? { type: ACTION.CHECK } : { type: ACTION.FOLD };
    }
    try {
      this.applyPlayerAction(bot, action);
    } catch {
      this.applyPlayerAction(bot, legal.canCheck ? { type: ACTION.CHECK } : { type: ACTION.FOLD });
    }
  }

  /** The clock ran out, or the player is gone: take the free option. */
  autoAct(seat) {
    if (!this.hand || this.hand.complete || this.hand.currentSeat !== seat) return;
    const legal = legalActions(this.hand, seat);
    const player = this.playerAtSeat(seat);
    if (!player) return;

    if (!player.isBot) {
      player.timeouts = (player.timeouts ?? 0) + 1;
      // Somebody who is not answering should not cost everyone else 30s a turn.
      if (!player.connected || player.timeouts >= TIMEOUTS_BEFORE_SITTING_OUT) {
        player.sittingOut = true;
      }
    }
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
        this.recordExit(p);
        this.unseat(p);
        if (p.isBot) { this.players.delete(p.id); this.tokens.delete(p.token); }
      }
    }

    if (RISING_BLINDS.has(this.config.mode)) this.knockOutBustedPlayers();

    this.publish();

    if (this.checkForGameOver()) return;
    this.setTimer('next', SETTLE_MS, () => this.maybeStartHand());
  }

  /** No rebuys outside cash: a dead stack leaves the table and watches. */
  knockOutBustedPlayers() {
    const busted = this.seatedPlayers()
      .filter((p) => p.stack <= 0)
      .sort((a, b) => a.seat - b.seat);

    for (const p of busted) {
      this.eliminated.push({ id: p.id, name: p.name, isBot: p.isBot });
      this.unseat(p);
      if (p.isBot) { this.players.delete(p.id); this.tokens.delete(p.token); }
    }
  }

  checkForGameOver() {
    if (this.config.mode === MODE.CASH) return false;

    const alive = this.seatedPlayers().filter((p) => p.stack > 0);
    if (this.isTournament() && alive.length <= 1 && this.startedAt) {
      this.finish('최후의 1인');
      return true;
    }
    if (this.config.mode === MODE.TIMED && this.endsAt && Date.now() >= this.endsAt) {
      this.finish('시간 종료');
      return true;
    }
    if (alive.length <= 1 && this.startedAt) {
      this.finish('남은 플레이어가 없습니다');
      return true;
    }
    return false;
  }

  finish(reason) {
    this.dispose();
    this.phase = 'finished';
    this.turnEndsAt = null;
    this.countdownEndsAt = null;

    // Survivors ranked by chips, then everyone knocked out, latest first.
    const survivors = this.seatedPlayers()
      .slice()
      .sort((a, b) => b.stack - a.stack)
      .map((p) => ({ name: p.name, isBot: p.isBot, stack: p.stack }));
    const knockedOut = [...this.eliminated].reverse()
      .map((p) => ({ name: p.name, isBot: p.isBot, stack: 0 }));

    this.results = {
      reason,
      standings: [...survivors, ...knockedOut].map((p, i) => ({ ...p, place: i + 1 })),
      hands: this.hand?.handId ?? 0,
      durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
    this.publish();
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

  /** Drop every pending timer so the room stops holding the process open. */
  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
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
