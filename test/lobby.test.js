import { describe, it, expect, afterEach } from 'vitest';
import { Room } from '../server/room.js';
import { snapshotFor } from '../server/view.js';
import { ChatLog, MAX_MESSAGES, MAX_LENGTH } from '../server/chat.js';
import { MODE } from '../server/blinds.js';

const rooms = [];
function makeRoom() {
  const room = new Room({ send: () => {} });
  rooms.push(room);
  return room;
}
afterEach(() => { while (rooms.length) rooms.pop().dispose(); });

const names = (room) => room.lobbyRoster().map((p) => p.name);

describe('the lobby roster', () => {
  it('lists everyone who is connected and not yet sitting down', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.join({ socketId: 's3', name: 'Ben' });
    expect(names(room)).toEqual(['Host', 'Ann', 'Ben']);
  });

  it('marks exactly one of them as the host', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    expect(room.lobbyRoster().filter((p) => p.isHost).map((p) => p.name)).toEqual(['Host']);
  });

  it('drops someone who closes the page', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.leave('s2');
    expect(names(room)).toEqual(['Host']);
  });

  it('hands the host over when the host leaves', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.leave('s1');
    expect(room.isHost(host.id)).toBe(false);
    expect(room.lobbyRoster().find((p) => p.isHost).name).toBe('Ann');
  });

  it('lets someone fix their name while waiting', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    const ann = room.join({ socketId: 's2', name: 'Ann' });
    room.renamePlayer(ann.id, '민준');
    expect(names(room)).toEqual(['Host', '민준']);
  });

  it('keeps a renamed player distinct from someone already using that name', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: '민준' });
    const ann = room.join({ socketId: 's2', name: 'Ann' });
    room.renamePlayer(ann.id, '민준');
    expect(ann.name).toBe('민준 2');
  });

  it('empties out once the game starts, because everyone has a chair', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.startTable(host.id, { name: 'Host', bots: 0, mode: MODE.CASH });
    expect(names(room)).toEqual([]);
  });
});

describe('how many bots still fit', () => {
  it('shrinks as friends arrive', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    expect(room.maxBots).toBe(9);
    room.join({ socketId: 's2', name: 'Ann' });
    expect(room.maxBots).toBe(8);
    room.join({ socketId: 's3', name: 'Ben' });
    expect(room.maxBots).toBe(7);
  });

  it('grows back when someone leaves', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.leave('s2');
    expect(room.maxBots).toBe(9);
  });

  it('counts the table once the game is running', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', bots: 3, mode: MODE.CASH });
    expect(room.maxBots).toBe(6);
  });
});

describe('starting the game together', () => {
  it('seats the whole lobby, host first, then the bots', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.join({ socketId: 's3', name: 'Ben' });

    room.startTable(host.id, { name: 'Host', bots: 2, mode: MODE.CASH });

    expect(room.playerAtSeat(0).name).toBe('Host');
    expect(room.playerAtSeat(1).name).toBe('Ann');
    expect(room.playerAtSeat(2).name).toBe('Ben');
    expect(room.playerAtSeat(3).isBot).toBe(true);
    expect(room.playerAtSeat(4).isBot).toBe(true);
    expect(room.seatedPlayers()).toHaveLength(5);
  });

  it('caps the bots at the seats the lobby left over', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    for (let i = 2; i <= 7; i++) room.join({ socketId: `s${i}`, name: `P${i}` });

    room.startTable(host.id, { name: 'Host', bots: 9, mode: MODE.CASH });

    expect(room.seatedPlayers()).toHaveLength(10);
    expect(room.seatedPlayers().filter((p) => p.isBot)).toHaveLength(3);
  });

  it('refuses to start for anyone but the host', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Host' });
    const ann = room.join({ socketId: 's2', name: 'Ann' });
    expect(() => room.startTable(ann.id, { name: 'Ann', bots: 1 })).toThrow(/Only the host/);
  });

  it('gives everyone the same starting stack', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.startTable(host.id, { name: 'Host', bots: 1, startingStack: 20000, mode: MODE.CASH });
    expect(room.seatedPlayers().every((p) => p.stack === 20000)).toBe(true);
  });
});

describe('chat', () => {
  it('carries a message from one player to the shared log', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.postChat(host.id, '다들 준비됐어?');
    const seen = room.chat.recent().filter((m) => !m.system);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'Host', text: '다들 준비됐어?' });
  });

  it('refuses an empty message', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    expect(() => room.postChat(host.id, '    ')).toThrow(/empty message/);
  });

  it('slows down a flood', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.postChat(host.id, '하나');
    expect(() => room.postChat(host.id, '둘')).toThrow(/Slow down/);
  });

  it('announces arrivals, departures and the start of the game', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.leave('s2');
    room.startTable(host.id, { name: 'Host', bots: 1, mode: MODE.CASH });

    const system = room.chat.recent().filter((m) => m.system).map((m) => m.text);
    expect(system.some((t) => t.includes('Ann joined'))).toBe(true);
    expect(system.some((t) => t.includes('Ann left'))).toBe(true);
    expect(system.some((t) => t.startsWith('Game on'))).toBe(true);
  });

  it('tags each notice with a key so every client can word it in its own language', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.join({ socketId: 's2', name: 'Ann' });
    room.startTable(host.id, { name: 'Host', bots: 2, mode: MODE.CASH });

    const notices = room.chat.recent().filter((m) => m.system);
    expect(notices.find((m) => m.key === 'joined' && m.params.name === 'Ann')).toBeTruthy();
    expect(notices.find((m) => m.key === 'started')).toMatchObject({ params: { players: 2, bots: 2 } });
  });

  it('gives each refusal a code the client can translate', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    let caught = null;
    try { room.postChat(host.id, '   '); } catch (err) { caught = err; }
    expect(caught?.code).toBe('chatEmpty');
  });

  it('reaches every client through the snapshot', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    const ann = room.join({ socketId: 's2', name: 'Ann' });
    room.postChat(ann.id, '안녕');
    const seenByHost = snapshotFor(room, host.id).chat.map((m) => m.text);
    expect(seenByHost).toContain('안녕');
  });

  it('stores markup as text, so it can only ever be escaped on screen', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    const attack = '<img src=x onerror=alert(1)>';
    room.postChat(host.id, attack);
    const message = room.chat.recent().find((m) => !m.system);
    expect(message.text).toBe(attack);   // stored verbatim, never pre-rendered
  });

  it('strips control characters that would fake a second line', () => {
    const log = new ChatLog();
    const result = log.post({ id: 'a', name: 'Ann' }, 'hello\n​Host: give me your chips');
    expect(result.message.text).toBe('hello Host: give me your chips');
  });

  it('caps a very long message', () => {
    const log = new ChatLog();
    const result = log.post({ id: 'a', name: 'Ann' }, 'x'.repeat(1000));
    expect(result.message.text).toHaveLength(MAX_LENGTH);
  });

  it('keeps only the most recent messages', () => {
    const log = new ChatLog();
    for (let i = 0; i < MAX_MESSAGES + 40; i++) log.system(`메시지 ${i}`);
    expect(log.recent()).toHaveLength(MAX_MESSAGES);
    expect(log.recent().at(-1).text).toBe(`메시지 ${MAX_MESSAGES + 39}`);
  });
});
