import { describe, it, expect, afterEach } from 'vitest';
import { Room } from '../server/room.js';
import { snapshotFor } from '../server/view.js';

const rooms = [];
function makeRoom() {
  const room = new Room({ send: () => {} });
  rooms.push(room);
  return room;
}
afterEach(() => {
  while (rooms.length) rooms.pop().dispose();
});

describe('opening a table from the main menu', () => {
  it('applies the settings, seats the host and deals in the bots in one step', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'guest' });
    room.startTable(host.id, {
      name: '유진', seat: 0, sb: 100, bb: 200, startingStack: 20000, bots: 4,
    });

    expect(room.config.sb).toBe(100);
    expect(room.config.bb).toBe(200);
    expect(room.config.startingStack).toBe(20000);
    expect(host.name).toBe('유진');
    expect(host.seat).toBe(0);
    expect(room.isHost(host.id)).toBe(true);

    const bots = room.seatedPlayers().filter((p) => p.isBot);
    expect(bots).toHaveLength(4);
    expect(bots.every((b) => b.stack === 20000)).toBe(true);
  });

  it('gives every bot its own hidden personality', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 5 });

    const bots = room.seatedPlayers().filter((p) => p.isBot);
    expect(bots.every((b) => b.profile?.key)).toBe(true);
    expect(new Set(bots.map((b) => b.profile.key)).size).toBe(5);
  });

  it('never leaks a bot personality into what a player can see', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 3 });
    const seen = JSON.stringify(snapshotFor(room, host.id));
    for (const key of ['nit', 'rock', 'tag', 'lag', 'station', 'maniac', 'tricky']) {
      expect(seen).not.toContain(`"${key}"`);
    }
    expect(seen).not.toContain('aggression');
  });

  it('refuses to open a table that someone already opened', () => {
    const room = makeRoom();
    const first = room.join({ socketId: 's1', name: 'First' });
    room.startTable(first.id, { name: 'First', seat: 0, bots: 1 });

    const second = room.join({ socketId: 's2', name: 'Second' });
    expect(() => room.startTable(second.id, { name: 'Second', seat: 3, bots: 5 }))
      .toThrow(/이미 열린/);
    expect(room.isHost(first.id)).toBe(true);
  });

  it('stops adding bots when the seats run out', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 9 });
    expect(room.seatedPlayers()).toHaveLength(10);
    expect(room.firstFreeSeat()).toBeNull();
  });
});

describe('dropping a bot into a chosen seat', () => {
  const opened = () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 0 });
    return { room, host };
  };

  it('seats the bot exactly where you clicked', () => {
    const { room, host } = opened();
    room.addBot(host.id, 7);
    expect(room.playerAtSeat(7)?.isBot).toBe(true);
    expect(room.playerAtSeat(1)).toBeNull();
  });

  it('still falls back to the first free seat when no seat is given', () => {
    const { room, host } = opened();
    room.addBot(host.id);
    expect(room.playerAtSeat(1)?.isBot).toBe(true);
  });

  it('refuses a seat that is taken', () => {
    const { room, host } = opened();
    expect(() => room.addBot(host.id, 0)).toThrow(/이미 누가 앉은/);
  });

  it('refuses a seat that does not exist', () => {
    const { room, host } = opened();
    expect(() => room.addBot(host.id, 99)).toThrow(/그런 자리가 없습니다/);
  });

  it('refuses anyone who is not the host', () => {
    const { room } = opened();
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    expect(() => room.addBot(guest.id, 4)).toThrow(/호스트만/);
  });
});

describe('what a seat says about itself', () => {
  it('does not claim everyone is waiting when no hand is running', () => {
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', seat: 0, bots: 2 });
    const seats = snapshotFor(room, host.id).seats.filter(Boolean);
    expect(seats.every((s) => s.waiting === false)).toBe(true);
  });
});

describe('names at the table', () => {
  it('numbers a duplicate name so two people are told apart', () => {
    const room = makeRoom();
    const a = room.join({ socketId: 's1', name: '유진' });
    const b = room.join({ socketId: 's2', name: '유진' });
    expect(a.name).toBe('유진');
    expect(b.name).toBe('유진 2');
  });

  it('keeps numbering past the second duplicate', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Sam' });
    room.join({ socketId: 's2', name: 'Sam' });
    const c = room.join({ socketId: 's3', name: 'Sam' });
    expect(c.name).toBe('Sam 3');
  });

  it('does not rename you when you reconnect with your own token', () => {
    const room = makeRoom();
    const a = room.join({ socketId: 's1', name: '유진' });
    room.sitDown(a.id, 0, '유진');
    room.leave('s1');

    const again = room.join({ socketId: 's2', token: a.token, name: '유진' });
    expect(again.id).toBe(a.id);
    expect(again.name).toBe('유진');
    expect(again.seat).toBe(0);
  });

  it('disambiguates a name supplied when sitting down too', () => {
    const room = makeRoom();
    room.join({ socketId: 's1', name: 'Kim' });
    const b = room.join({ socketId: 's2', name: 'guest' });
    room.sitDown(b.id, 3, 'Kim');
    expect(b.name).toBe('Kim 2');
  });

  it('never hands a bot a name a human is already using', () => {
    const room = makeRoom();
    const a = room.join({ socketId: 's1', name: 'Phil' });
    room.sitDown(a.id, 0, 'Phil');
    for (let i = 0; i < 9; i++) room.addBot(a.id);
    const names = [...room.players.values()].map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
