import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Room } from '../server/room.js';
import {
  blindsForLevel, levelForElapsed, maxLevelFor, STRUCTURES, MODE,
} from '../server/blinds.js';

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

describe('the default game mode', () => {
  it('matches the option the main menu shows pre-selected', () => {
    const menu = readFileSync(new URL('../public/js/menu.js', import.meta.url), 'utf8');
    const preselected = /gameMode:\s*'([a-z]+)'/.exec(menu)?.[1];
    expect(preselected).toBeTruthy();
    expect(new Room({ send: () => {} }).config.mode).toBe(preselected);
  });

  it('opens a tournament when the client forgets to say which mode', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 2 });   // no mode
    expect(room.config.mode).toBe(MODE.TOURNAMENT);
    expect(room.levelEndsAt).toBeNull();      // clock starts with the first hand
  });
});

describe('the blind ladder', () => {
  const BASE = { sb: 25, bb: 50 };

  it('climbs about 1.5x a level on the standard ladder, like a casino clock', () => {
    const seen = [0, 1, 2, 3, 4, 5, 6].map((l) => blindsForLevel(BASE, l, 'standard').bb);
    expect(seen).toEqual([50, 100, 150, 200, 300, 400, 600]);
  });

  it('doubles every level on the turbo ladder', () => {
    const seen = [0, 1, 2, 3, 4, 5].map((l) => blindsForLevel(BASE, l, 'turbo').bb);
    expect(seen).toEqual([50, 100, 200, 400, 800, 1600]);

    for (let level = 1; level <= maxLevelFor('turbo'); level++) {
      const prev = blindsForLevel(BASE, level - 1, 'turbo');
      expect(blindsForLevel(BASE, level, 'turbo')).toEqual({ sb: prev.sb * 2, bb: prev.bb * 2 });
    }
  });

  it('keeps the small blind at half the big blind on both ladders', () => {
    for (const key of Object.keys(STRUCTURES)) {
      for (let level = 0; level <= maxLevelFor(key); level++) {
        const b = blindsForLevel(BASE, level, key);
        expect(b.bb).toBe(b.sb * 2);
      }
    }
  });

  it('scales off whatever blinds the host chose', () => {
    expect(blindsForLevel({ sb: 50, bb: 100 }, 3, 'standard')).toEqual({ sb: 200, bb: 400 });
    expect(blindsForLevel({ sb: 50, bb: 100 }, 3, 'turbo')).toEqual({ sb: 400, bb: 800 });
  });

  it('falls back to the standard ladder for an unknown structure', () => {
    expect(blindsForLevel(BASE, 4, 'nonsense')).toEqual(blindsForLevel(BASE, 4, 'standard'));
  });

  it('stops climbing at the top of each ladder', () => {
    for (const key of Object.keys(STRUCTURES)) {
      expect(blindsForLevel(BASE, 99, key)).toEqual(blindsForLevel(BASE, maxLevelFor(key), key));
    }
  });

  it('reads the level off the clock', () => {
    const max = maxLevelFor('standard');
    expect(levelForElapsed(0, 10 * MINUTE, max)).toBe(0);
    expect(levelForElapsed(9.9 * MINUTE, 10 * MINUTE, max)).toBe(0);
    expect(levelForElapsed(10 * MINUTE, 10 * MINUTE, max)).toBe(1);
    expect(levelForElapsed(25 * MINUTE, 10 * MINUTE, max)).toBe(2);
    expect(levelForElapsed(9999 * MINUTE, 10 * MINUTE, max)).toBe(max);
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
    expect(room.config).toMatchObject({ sb: 150, bb: 300 });   // standard ladder
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

  it('uses the turbo ladder when the host picked it', () => {
    const room = tournamentRoom();
    room.config = { ...room.config, structure: 'turbo' };
    room.startedAt = Date.now() - 25 * MINUTE;
    room.applyDueLevel();
    expect(room.level).toBe(2);
    expect(room.config).toMatchObject({ sb: 200, bb: 400 });
  });

  it('carries the structure through startTable', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots: 1, mode: MODE.TOURNAMENT, structure: 'turbo',
    });
    expect(room.config.structure).toBe('turbo');
    expect(room.maxLevel).toBe(maxLevelFor('turbo'));
  });

  it('knows when the next level is due', () => {
    const room = tournamentRoom();
    room.startedAt = 1_000_000;
    expect(room.levelEndsAt).toBe(1_000_000 + 10 * MINUTE);
    room.level = 3;
    expect(room.levelEndsAt).toBe(1_000_000 + 40 * MINUTE);
    room.level = room.maxLevel;
    expect(room.levelEndsAt).toBeNull();
  });
});

describe('knocking players out', () => {
  function seatedRoom(mode, rebuys = 0) {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 3, mode, startingStack: 1000, rebuys });
    return { room, host };
  }

  it('removes a dead stack and remembers the order they went out', () => {
    const { room } = seatedRoom(MODE.TOURNAMENT);
    const [a, b] = room.seatedPlayers().filter((p) => p.isBot);
    a.stack = 0;
    room.handleBustedPlayers();
    b.stack = 0;
    room.handleBustedPlayers();

    expect(room.eliminated.map((p) => p.name)).toEqual([a.name, b.name]);
    expect(room.seatedPlayers()).toHaveLength(2);
  });

  it('ranks the survivors by chips and the rest in reverse knockout order', () => {
    const { room, host } = seatedRoom(MODE.TOURNAMENT);
    const bots = room.seatedPlayers().filter((p) => p.isBot);
    room.startedAt = Date.now();

    bots[0].stack = 0; room.handleBustedPlayers();
    bots[1].stack = 0; room.handleBustedPlayers();
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
    room.config = { ...room.config, rebuys: -1 };
    const bot = room.seatedPlayers().find((p) => p.isBot);
    bot.stack = 0;
    room.handleBustedPlayers();
    expect(bot.stack).toBe(1000);
    expect(room.eliminated).toHaveLength(0);
  });
});

describe('leaving a tournament early', () => {
  it('still ranks someone who quits rather than dropping them from the results', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    // Starting seats the whole lobby, so the guest is already in.
    room.startTable(host.id, {
      name: 'Host', bots: 2, mode: MODE.TOURNAMENT, startingStack: 1000,
    });
    expect(guest.seat).not.toBeNull();
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
    room.startTable(host.id, { name: 'Host', bots: 1, mode: MODE.CASH });
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
    room.handleBustedPlayers();
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
    room.startTable(host.id, { name: 'Host', bots: 3, mode: MODE.TOURNAMENT });
    expect(guest.seat).not.toBeNull();
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

describe('rebuys', () => {
  function table({ rebuys, mode = MODE.TOURNAMENT, bots = 3 }) {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, {
      name: 'Host', seat: 0, bots, mode, startingStack: 1000, rebuys,
    });
    room.startedAt = Date.now();
    return { room, host };
  }

  it('buys a busted player back in until the allowance runs out', () => {
    const { room } = table({ rebuys: 2 });
    const bot = room.seatedPlayers().find((p) => p.isBot);

    for (let i = 1; i <= 2; i++) {
      bot.stack = 0;
      const events = room.handleBustedPlayers();
      expect(events.find((e) => e.type === 'rebuy')).toMatchObject({ used: i, remaining: 2 - i });
      expect(bot.stack).toBe(1000);
      expect(room.playerAtSeat(bot.seat)).toBe(bot);
    }

    // Third bust: no allowance left, so they are out.
    const seat = bot.seat;
    bot.stack = 0;
    const events = room.handleBustedPlayers();
    expect(events.find((e) => e.type === 'knockOut')).toBeTruthy();
    expect(room.playerAtSeat(seat)).toBeNull();
    expect(room.eliminated.map((p) => p.name)).toContain(bot.name);
  });

  it('knocks a player out on the first bust when rebuys are off', () => {
    const { room } = table({ rebuys: 0 });
    const bot = room.seatedPlayers().find((p) => p.isBot);
    const seat = bot.seat;
    bot.stack = 0;
    room.handleBustedPlayers();
    expect(room.playerAtSeat(seat)).toBeNull();
  });

  it('never knocks anyone out when rebuys are unlimited', () => {
    const { room } = table({ rebuys: -1, mode: MODE.CASH });
    const bot = room.seatedPlayers().find((p) => p.isBot);
    for (let i = 0; i < 25; i++) {
      bot.stack = 0;
      room.handleBustedPlayers();
    }
    expect(bot.stack).toBe(1000);
    expect(room.eliminated).toHaveLength(0);
    expect(room.checkForGameOver()).toBe(false);
  });

  it('gives bots exactly the same allowance as people', () => {
    const { room, host } = table({ rebuys: 1 });
    const bot = room.seatedPlayers().find((p) => p.isBot);

    host.stack = 0;
    bot.stack = 0;
    room.handleBustedPlayers();
    expect(host.stack).toBe(1000);
    expect(bot.stack).toBe(1000);

    const botSeat = bot.seat;
    const hostSeat = host.seat;
    host.stack = 0;
    bot.stack = 0;
    room.handleBustedPlayers();
    expect(room.playerAtSeat(hostSeat)).toBeNull();
    expect(room.playerAtSeat(botSeat)).toBeNull();
  });

  it('restores exactly the starting stack, not the current blind level', () => {
    const { room } = table({ rebuys: 3 });
    room.config = { ...room.config, sb: 400, bb: 800 };   // blinds climbed
    const bot = room.seatedPlayers().find((p) => p.isBot);
    bot.stack = 0;
    room.handleBustedPlayers();
    expect(bot.stack).toBe(room.config.startingStack);
  });

  it('lets a capped cash game finish', () => {
    const { room, host } = table({ rebuys: 0, mode: MODE.CASH, bots: 1 });
    const bot = room.seatedPlayers().find((p) => p.isBot);
    bot.stack = 0;
    room.handleBustedPlayers();
    expect(room.checkForGameOver()).toBe(true);
    expect(room.results.reason).toBe('최후의 1인');
  });

  it('records how many rebuys each player used in the standings', () => {
    const { room, host } = table({ rebuys: 1 });
    const bot = room.seatedPlayers().find((p) => p.isBot);
    bot.stack = 0;
    room.handleBustedPlayers();        // bot rebuys once
    bot.stack = 0;
    room.handleBustedPlayers();        // and is out
    host.stack = 3000;

    room.finish('최후의 1인');
    const byName = Object.fromEntries(room.results.standings.map((r) => [r.name, r.rebuysUsed]));
    expect(byName[bot.name]).toBe(1);
    expect(byName[host.name]).toBe(0);
  });

  it('gives a new player at the same seat a fresh allowance', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', bots: 1, mode: MODE.CASH, rebuys: 1 });
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    room.sitDown(guest.id, 4);
    guest.rebuysUsed = 1;

    room.standUp(guest.id);
    room.sitDown(guest.id, 4);
    expect(guest.rebuysUsed).toBe(0);
  });
});
