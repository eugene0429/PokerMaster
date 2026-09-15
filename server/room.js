import { randomUUID } from 'node:crypto';
import { MAX_SEATS, ACTION } from '../engine/constants.js';
import { startHand, applyAction, legalActions, IllegalAction } from '../engine/table.js';
import { decideBotAction, pickBotName, botThinkingTime } from './bots.js';
import { makeProfileDealer } from './bot-profiles.js';
import {
  blindsForLevel, levelForElapsed, maxLevelFor, DEFAULT_STRUCTURE, MODE, RISING_BLINDS,
} from './blinds.js';
import { ChatLog } from './chat.js';
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
  rebuys: 0,          // -1 means unlimited
  structure: DEFAULT_STRUCTURE,
};

const UNLIMITED_REBUYS = -1;
const STRUCTURE_KEYS = new Set(['standard', 'turbo']);

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
    this.chat = new ChatLog();
    this.invite = { urls: [], primary: '', qr: null, hasLan: false };

    this.baseBlinds = { sb: DEFAULTS.sb, bb: DEFAULTS.bb };
    this.level = 0;
    this.startedAt = null;
    this.endsAt = null;                  // timed mode only
    this.eliminated = [];                // knocked out, first one out first
    this.results = null;
    this.pausedAt = null;
    this.suspended = [];
    this.pausedTurnRemaining = null;
  }

  get paused() { return this.pausedAt !== null; }

  /**
   * Stop everything that runs on a clock: the turn timer, the hand countdown,
   * the blind level and the game clock. Anything that kept moving would make
   * the pause cost somebody something.
   */
  pause(playerId) {
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 일시정지할 수 있습니다');
    if (this.paused) return;
    if (this.finished) throw new IllegalAction('이미 끝난 게임입니다');

    const now = Date.now();
    this.pausedAt = now;
    this.pausedTurnRemaining = this.turnEndsAt === null ? null : Math.max(0, this.turnEndsAt - now);
    this.turnEndsAt = null;

    this.suspended = [...this.timers.entries()].map(([key, t]) => ({
      key, fn: t.fn, remaining: Math.max(0, t.fireAt - now),
    }));
    for (const t of this.timers.values()) clearTimeout(t.handle);
    this.timers.clear();

    this.chat.system('게임이 일시정지되었습니다');
    this.publish();
  }

  resume(playerId) {
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 재개할 수 있습니다');
    if (!this.paused) return;

    // Push every clock forward by however long we stood still.
    const stoppedFor = Date.now() - this.pausedAt;
    if (this.startedAt !== null) this.startedAt += stoppedFor;
    if (this.endsAt !== null) this.endsAt += stoppedFor;
    if (this.countdownEndsAt !== null) this.countdownEndsAt += stoppedFor;
    this.pausedAt = null;

    for (const { key, remaining, fn } of this.suspended) this.setTimer(key, remaining, fn);
    this.suspended = [];

    if (this.pausedTurnRemaining !== null) {
      this.turnEndsAt = Date.now() + this.pausedTurnRemaining;
      this.pausedTurnRemaining = null;
    }

    this.chat.system('게임이 재개되었습니다');
    this.publish();
  }

  /* --------------------------- identity ---------------------------- */

  join({ socketId, token, name }) {
    let player = token && this.tokens.has(token) ? this.players.get(this.tokens.get(token)) : null;

    const returning = !!player;
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

    const alreadyOpen = [...this.sockets.values()].includes(player.id);
    this.sockets.set(socketId, player.id);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = player.id;
    if (!alreadyOpen) {
      this.chat.system(returning ? `${player.name} 님이 돌아왔습니다` : `${player.name} 님이 들어왔습니다`);
    }

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
    this.chat.system(`${player.name} 님이 나갔습니다`);

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
    this.chat.forget(player.id);
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
    return this.lobbyPlayers().map((p) => p.name);
  }

  /** Connected, not seated — waiting in the main menu. */
  lobbyPlayers() {
    return [...this.players.values()].filter((p) => p.seat === null && p.connected && !p.isBot);
  }

  lobbyRoster() {
    return this.lobbyPlayers().map((p) => ({
      name: p.name, isHost: p.id === this.hostId, id: p.id,
    }));
  }

  /** How many bots still fit once everyone waiting has a chair. */
  get maxBots() {
    const taken = this.seatedPlayers().length > 0
      ? this.seatedPlayers().length
      : this.lobbyPlayers().length;
    return Math.max(0, this.config.maxSeats - taken);
  }

  renamePlayer(playerId, name) {
    const player = this.players.get(playerId);
    if (!player) throw new IllegalAction('알 수 없는 플레이어입니다');
    const next = this.uniqueName(sanitizeName(name, player.name), player.id);
    if (next === player.name) return;
    this.chat.system(`${player.name} 님이 이름을 ${next} 로 바꿨습니다`);
    player.name = next;
    this.publish();
  }

  postChat(playerId, text) {
    const player = this.players.get(playerId);
    if (!player) throw new IllegalAction('알 수 없는 플레이어입니다');
    const result = this.chat.post(player, text);
    if (!result.ok) throw new IllegalAction(result.reason);
    this.publish();
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
    this.seatPlayerAt(player, seat);
    this.maybeStartHand();
    this.publish();
  }

  seatPlayerAt(player, seat) {
    player.seat = seat;
    player.stack = this.config.startingStack;
    player.sittingOut = false;
    player.timeouts = 0;
    player.rebuysUsed = 0;
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
    this.eliminated.push({
      id: player.id, name: player.name, isBot: player.isBot, rebuysUsed: player.rebuysUsed ?? 0,
    });
  }

  unseat(player) {
    player.seat = null;
    player.stack = 0;
    player.leaveAfterHand = false;
    player.sittingOut = false;
    player.timeouts = 0;
    player.bustedOut = false;
    player.pendingRebuy = false;
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
      profile: this.nextProfile(), rebuysUsed: 0,
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
    const rebuys = clampInt(patch.rebuys, UNLIMITED_REBUYS, 99, this.config.rebuys);
    const structure = maxLevelFor(patch.structure) && STRUCTURE_KEYS.has(patch.structure)
      ? patch.structure : this.config.structure;
    this.config = {
      ...this.config,
      sb, bb, startingStack, turnSeconds, mode, levelMinutes, totalMinutes, rebuys, structure,
    };
  }

  /**
   * The host pressing 게임 시작: settings, a chair for everyone waiting in the
   * lobby, and the bots — in one step, so the table starts together rather
   * than filling up one person at a time.
   */
  startTable(playerId, opts = {}) {
    const player = this.players.get(playerId);
    if (!player) throw new IllegalAction('알 수 없는 플레이어입니다');
    if (this.seatedPlayers().length > 0) throw new IllegalAction('이미 열린 테이블이 있습니다');
    if (!this.isHost(playerId)) throw new IllegalAction('호스트만 게임을 시작할 수 있습니다');

    this.applyConfig(opts);
    this.baseBlinds = { sb: this.config.sb, bb: this.config.bb };
    this.level = 0;
    this.eliminated = [];
    this.results = null;

    if (opts.name) player.name = this.uniqueName(sanitizeName(opts.name, player.name), player.id);

    // The host takes the first chair, then everyone else in the order they arrived.
    const waiting = [player, ...this.lobbyPlayers().filter((p) => p.id !== playerId)];
    let seat = 0;
    for (const p of waiting) {
      if (seat >= this.config.maxSeats) break;
      this.seatPlayerAt(p, seat++);
    }

    const room = this.config.maxSeats - seat;
    const bots = clampInt(opts.bots, 0, room, 0);
    for (let i = 0; i < bots; i++) this.addBot(playerId);

    this.chat.system(`게임 시작 — ${waiting.length}명 + 봇 ${bots}명`);
    this.maybeStartHand();
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
    this.pausedAt = null;
    this.suspended = [];
    this.pausedTurnRemaining = null;
    this.chat.system('게임이 끝났습니다 — 메인 메뉴로 돌아갑니다');
    this.publish();
  }

  /* --------------------------- game clock -------------------------- */

  isTournament() { return this.config.mode === MODE.TOURNAMENT; }
  get finished() { return this.phase === 'finished'; }
  get levelMs() { return this.config.levelMinutes * 60 * 1000; }
  get maxLevel() { return maxLevelFor(this.config.structure); }

  get levelEndsAt() {
    if (!this.startedAt || !RISING_BLINDS.has(this.config.mode)) return null;
    if (this.level >= this.maxLevel) return null;
    return this.startedAt + (this.level + 1) * this.levelMs;
  }

  /**
   * Blinds only move between hands. Raising them mid-hand would change the
   * minimum raise under a player who has already acted.
   */
  applyDueLevel() {
    if (!RISING_BLINDS.has(this.config.mode) || !this.startedAt) return;
    const due = levelForElapsed(Date.now() - this.startedAt, this.levelMs, this.maxLevel);
    if (due <= this.level) return;
    this.level = due;
    const { sb, bb } = blindsForLevel(this.baseBlinds, this.level, this.config.structure);
    this.config = { ...this.config, sb, bb };
  }

  /* -------------------------- hand lifecycle ------------------------ */

  readyPlayers() {
    return this.seatedPlayers()
      .filter((p) => !p.sittingOut && !p.bustedOut && (p.connected || p.isBot));
  }

  maybeStartHand() {
    if (this.finished || this.paused) return;
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
    if (this.finished || this.paused) return;
    this.clearFinishedPlayers();

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
    if (this.paused) throw new IllegalAction('일시정지 중입니다');
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
    if (!this.hand || this.hand.complete || this.paused) return;

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
    // One scratchpad per bot per hand, so a bluff can carry across streets.
    if (bot && (!bot.memory || bot.memory.handId !== this.hand.handId)) {
      bot.memory = { handId: this.hand.handId, streets: [] };
    }
    let action;
    try {
      action = decideBotAction(this.hand, seat, legal, {
        profile: bot?.profile, memory: bot?.memory,
      });
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
      if (p.leaveAfterHand) this.recordExit(p);
    }

    this.publish(this.handleBustedPlayers());

    if (this.checkForGameOver()) return;
    this.setTimer('next', SETTLE_MS, () => this.maybeStartHand());
  }

  get rebuysAreUnlimited() {
    return this.config.rebuys === UNLIMITED_REBUYS;
  }

  rebuysLeft(player) {
    if (this.rebuysAreUnlimited) return Infinity;
    return Math.max(0, this.config.rebuys - (player.rebuysUsed ?? 0));
  }

  /**
   * A dead stack either buys back in or leaves — the same rule in every mode.
   * Bots get no exemption. With unlimited rebuys nobody ever leaves, which is
   * what makes a cash table endless.
   *
   * This decides; it does not clear the chair. Emptying seats here would make
   * the losers vanish while the table is still turning the cards over, so they
   * keep their seat until the next hand is dealt (`clearFinishedPlayers`).
   */
  handleBustedPlayers() {
    const events = [];
    const busted = this.seatedPlayers()
      .filter((p) => p.stack <= 0 && !p.bustedOut)
      .sort((a, b) => a.seat - b.seat);

    for (const p of busted) {
      if (this.rebuysLeft(p) > 0) {
        p.rebuysUsed = (p.rebuysUsed ?? 0) + 1;
        p.pendingRebuy = true;
        events.push({
          type: 'rebuy', seat: p.seat, name: p.name,
          stack: this.config.startingStack, used: p.rebuysUsed,
          remaining: this.rebuysAreUnlimited ? null : this.rebuysLeft(p),
        });
        continue;
      }
      p.bustedOut = true;
      this.eliminated.push({
        id: p.id, name: p.name, isBot: p.isBot, rebuysUsed: p.rebuysUsed ?? 0,
      });
      events.push({ type: 'knockOut', seat: p.seat, name: p.name });
    }
    return events;
  }

  /**
   * Clear out last hand's casualties. Runs as the next hand is dealt, which is
   * the first moment nobody is still looking at the finished one.
   */
  clearFinishedPlayers() {
    for (const p of [...this.players.values()]) {
      if (p.pendingRebuy) {
        p.pendingRebuy = false;
        p.stack = this.config.startingStack;
      }
      if (!p.bustedOut && !p.leaveAfterHand) continue;
      this.unseat(p);
      if (p.isBot) { this.players.delete(p.id); this.tokens.delete(p.token); }
    }
  }

  checkForGameOver() {
    if (this.config.mode === MODE.TIMED && this.endsAt && Date.now() >= this.endsAt) {
      this.finish('시간 종료');
      return true;
    }
    // With unlimited rebuys nobody is ever knocked out, so this cannot fire.
    const alive = this.seatedPlayers().filter((p) => p.stack > 0);
    if (this.startedAt && alive.length <= 1 && !this.rebuysAreUnlimited) {
      this.finish('최후의 1인');
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
      .filter((p) => !p.bustedOut)
      .sort((a, b) => b.stack - a.stack)
      .map((p) => ({ name: p.name, isBot: p.isBot, stack: p.stack, rebuysUsed: p.rebuysUsed ?? 0 }));
    const knockedOut = [...this.eliminated].reverse()
      .map((p) => ({ name: p.name, isBot: p.isBot, stack: 0, rebuysUsed: p.rebuysUsed ?? 0 }));

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
    const handle = setTimeout(() => {
      this.timers.delete(key);
      try { fn(); } catch (err) { console.error(`[room] timer ${key}:`, err.message); }
    }, ms);
    // The deadline and the callback are kept so a pause can put them back.
    this.timers.set(key, { handle, fireAt: Date.now() + ms, fn });
  }

  clearTimer(key) {
    const t = this.timers.get(key);
    if (t) { clearTimeout(t.handle); this.timers.delete(key); }
  }

  /** Drop every pending timer so the room stops holding the process open. */
  dispose() {
    for (const t of this.timers.values()) clearTimeout(t.handle);
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
