import { describe, it, expect, afterEach, vi } from 'vitest';
import { Room } from '../server/room.js';
import { blindsForLevel, levelForElapsed, MAX_LEVEL, MODE } from '../server/blinds.js';

const rooms = [];
function makeRoom() {
  const room = new Room({ send: () => {} });
  rooms.push(room);
  return room;
}
afterEach(() => {
  while (rooms.length) rooms.pop().dispose();
  vi.useRealTimers();
});

const MINUTE = 60 * 1000;

describe('the blind ladder', () => {
  it('escalates the way a tournament clock does', () => {
    const base = { sb: 50, bb: 100 };
    expect(blindsForLevel(base, 0)).toEqual({ sb: 50, bb: 100 });
    expect(blindsForLevel(base, 1)).toEqual({ sb: 100, bb: 200 });
    expect(blindsForLevel(base, 2)).toEqual({ sb: 150, bb: 300 });
    expect(blindsForLevel(base, 3)).toEqual({ sb: 200, bb: 400 });
    expect(blindsForLevel(base, 4)).toEqual({ sb: 300, bb: 600 });
  });

  it('scales off whatever blinds the host chose', () => {
    expect(blindsForLevel({ sb: 25, bb: 50 }, 3)).toEqual({ sb: 100, bb: 200 });
  });

  it('stops climbing at the top of the ladder', () => {
    const base = { sb: 50, bb: 100 };
    expect(blindsForLevel(base, 99)).toEqual(blindsForLevel(base, MAX_LEVEL));
  });

  it('reads the level off the clock', () => {
    expect(levelForElapsed(0, 10 * MINUTE)).toBe(0);
    expect(levelForElapsed(9.9 * MINUTE, 10 * MINUTE)).toBe(0);
    expect(levelForElapsed(10 * MINUTE, 10 * MINUTE)).toBe(1);
    expect(levelForElapsed(25 * MINUTE, 10 * MINUTE)).toBe(2);
    expect(levelForElapsed(9999 * MINUTE, 10 * MINUTE)).toBe(MAX_LEVEL);
  });
});

describe('raising the blinds', () => {
  function tournamentRoom() {
    const room = makeRoom();
    room.config = { ...room.config, mode: MODE.TOURNAMENT, levelMinutes: 10, sb: 50, bb: 100 };
    room.baseBlinds = { sb: 50, bb: 100 };
    return room;
  }

  it('catches up to whatever the clock says, even after a long hand', () => {
    const room = tournamentRoom();
    room.startedAt = Date.now() - 25 * MINUTE;
    room.applyDueLevel();
    expect(room.level).toBe(2);
    expect(room.config).toMatchObject({ sb: 150, bb: 300 });
  });

  it('leaves the blinds alone before the first level is up', () => {
    const room = tournamentRoom();
    room.startedAt = Date.now() - 3 * MINUTE;
    room.applyDueLevel();
    expect(room.level).toBe(0);
    expect(room.config).toMatchObject({ sb: 50, bb: 100 });
  });

  it('never raises them in a cash game', () => {
    const room = tournamentRoom();
    room.config = { ...room.config, mode: MODE.CASH };
    room.startedAt = Date.now() - 60 * MINUTE;
    room.applyDueLevel();
    expect(room.level).toBe(0);
    expect(room.config).toMatchObject({ sb: 50, bb: 100 });
  });

  it('knows when the next level is due', () => {
    const room = tournamentRoom();
    room.startedAt = 1_000_000;
    expect(room.levelEndsAt).toBe(1_000_000 + 10 * MINUTE);
    room.level = 3;
    expect(room.levelEndsAt).toBe(1_000_000 + 40 * MINUTE);
    room.level = MAX_LEVEL;
    expect(room.levelEndsAt).toBeNull();
  });
});

describe('knocking players out', () => {
  function seatedRoom(mode) {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 3, mode, startingStack: 1000 });
    return { room, host };
  }

  it('removes a dead stack and remembers the order they went out', () => {
    const { room } = seatedRoom(MODE.TOURNAMENT);
    const [a, b] = room.seatedPlayers().filter((p) => p.isBot);
    a.stack = 0;
    room.knockOutBustedPlayers();
    b.stack = 0;
    room.knockOutBustedPlayers();

    expect(room.eliminated.map((p) => p.name)).toEqual([a.name, b.name]);
    expect(room.seatedPlayers()).toHaveLength(2);
  });

  it('ranks the survivors by chips and the rest in reverse knockout order', () => {
    const { room, host } = seatedRoom(MODE.TOURNAMENT);
    const bots = room.seatedPlayers().filter((p) => p.isBot);
    room.startedAt = Date.now();

    bots[0].stack = 0; room.knockOutBustedPlayers();
    bots[1].stack = 0; room.knockOutBustedPlayers();
    host.stack = 2500;
    bots[2].stack = 1500;

    room.finish('최후의 1인');
    expect(room.results.standings.map((s) => s.name)).toEqual([
      host.name, bots[2].name, bots[1].name, bots[0].name,
    ]);
    expect(room.results.standings.map((s) => s.place)).toEqual([1, 2, 3, 4]);
  });

  it('hands a busted cash player a fresh stack instead', () => {
    const { room } = seatedRoom(MODE.CASH);
    const bot = room.seatedPlayers().find((p) => p.isBot);
    bot.stack = 0;
    room.beginHand();
    expect(bot.stack).toBe(1000);
    expect(room.eliminated).toHaveLength(0);
  });
});

describe('leaving a tournament early', () => {
  it('still ranks someone who quits rather than dropping them from the results', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots: 2, mode: MODE.TOURNAMENT, startingStack: 1000,
    });
    room.sitDown(guest.id, 5);
    room.startedAt = Date.now();

    room.standUp(guest.id);
    expect(room.eliminated.map((p) => p.name)).toContain('Guest');

    room.finish('최후의 1인');
    expect(room.results.standings.map((s) => s.name)).toContain('Guest');
    expect(room.results.standings).toHaveLength(4);
  });

  it('does not record an exit in a cash game', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 1, mode: MODE.CASH });
    room.sitDown(guest.id, 5);
    room.standUp(guest.id);
    expect(room.eliminated).toHaveLength(0);
  });

  it('does not double-count someone kicked after they already busted', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 2, mode: MODE.TOURNAMENT });
    room.startedAt = Date.now();
    const bot = room.seatedPlayers().find((p) => p.isBot);
    const seat = bot.seat;

    bot.stack = 0;
    room.knockOutBustedPlayers();
    expect(room.eliminated).toHaveLength(1);
    expect(room.playerAtSeat(seat)).toBeNull();
  });
});

describe('a tournament played to the end', () => {
  it('finishes with one survivor and a full ranking', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots: 4, mode: MODE.TOURNAMENT,
      levelMinutes: 1, startingStack: 600, sb: 25, bb: 50,
    });
    room.standUp(host.id);           // leave it to the bots

    const chips = room.seatedPlayers().reduce((sum, p) => sum + p.stack, 0);
    vi.advanceTimersByTime(60 * MINUTE);

    expect(room.phase).toBe('finished');
    expect(room.results.reason).toBe('최후의 1인');
    expect(room.results.standings).toHaveLength(4);
    expect(room.results.standings.map((s) => s.place)).toEqual([1, 2, 3, 4]);
    expect(room.results.standings[0].stack).toBe(chips);   // the winner has them all
  });

  it('raises the blinds while the game is running', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots: 4, mode: MODE.TOURNAMENT,
      // Deep enough that it cannot possibly bust out before the clock matters.
      levelMinutes: 1, startingStack: 400000, sb: 25, bb: 50,
    });
    room.standUp(host.id);

    vi.advanceTimersByTime(3.5 * MINUTE);

    expect(room.phase).not.toBe('finished');
    // Level 3 is due; a hand that started before the boundary holds it at 2.
    expect(room.level).toBeGreaterThanOrEqual(2);
    expect(room.level).toBeLessThanOrEqual(3);
    expect(room.config.bb).toBe(blindsForLevel({ sb: 25, bb: 50 }, room.level).bb);
  });

  it('stops a timed game when the clock runs out and ranks by chips', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots: 4, mode: MODE.TIMED,
      levelMinutes: 5, totalMinutes: 6, startingStack: 20000, sb: 25, bb: 50,
    });
    room.standUp(host.id);

    vi.advanceTimersByTime(30 * MINUTE);

    expect(room.phase).toBe('finished');
    expect(room.results.reason).toBe('시간 종료');
    const stacks = room.results.standings.map((s) => s.stack);
    expect([...stacks].sort((a, b) => b - a)).toEqual(stacks);   // ranked by chips
  });
});

describe('a player who stops answering', () => {
  it('is sat out after missing the clock twice, so the table moves on', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots: 2, mode: MODE.CASH, turnSeconds: 5, startingStack: 10000,
    });

    // Nobody answers for the host; the bots keep playing.
    vi.advanceTimersByTime(3 * MINUTE);

    expect(host.timeouts).toBeGreaterThanOrEqual(2);
    expect(host.sittingOut).toBe(true);
  });

  it('comes back the moment they act again', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 2 });
    host.timeouts = 5;
    host.sittingOut = true;

    room.setSittingOut(host.id, false);
    expect(host.sittingOut).toBe(false);
    expect(host.timeouts).toBe(0);
  });
});

describe('clearing a seat', () => {
  function opened() {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 0 });
    return { room, host };
  }

  it('lets the host remove a friend who wandered off, not just a bot', () => {
    const { room, host } = opened();
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    room.sitDown(guest.id, 4);
    expect(room.playerAtSeat(4)).not.toBeNull();

    room.kick(host.id, 4);
    expect(room.playerAtSeat(4)).toBeNull();
    expect(room.players.has(guest.id)).toBe(true);   // still connected, now watching
  });

  it('removes a bot from the table entirely', () => {
    const { room, host } = opened();
    room.addBot(host.id, 6);
    const bot = room.playerAtSeat(6);
    room.kick(host.id, 6);
    expect(room.playerAtSeat(6)).toBeNull();
    expect(room.players.has(bot.id)).toBe(false);
  });

  it('refuses to let the host kick themselves', () => {
    const { room, host } = opened();
    expect(() => room.kick(host.id, 0)).toThrow(/일어서기/);
  });

  it('refuses anyone who is not the host', () => {
    const { room, host } = opened();
    room.addBot(host.id, 2);
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    expect(() => room.kick(guest.id, 2)).toThrow(/호스트만/);
  });
});

describe('starting over', () => {
  it('puts everyone back at the main menu with nothing carried over', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 3, mode: MODE.TOURNAMENT });
    room.sitDown(guest.id, 5);
    room.level = 4;
    room.startedAt = Date.now() - 40 * MINUTE;

    room.resetTable(host.id);

    expect(room.seatedPlayers()).toHaveLength(0);
    expect(room.players.has(guest.id)).toBe(true);
    expect([...room.players.values()].some((p) => p.isBot)).toBe(false);
    expect(room.level).toBe(0);
    expect(room.startedAt).toBeNull();
    expect(room.phase).toBe('idle');
  });
});
