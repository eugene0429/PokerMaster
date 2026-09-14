import { describe, it, expect, afterEach } from 'vitest';
import { Room } from '../server/room.js';

const rooms = [];
function makeRoom() {
  const room = new Room({ send: () => {} });
  rooms.push(room);
  return room;
}
afterEach(() => {
  while (rooms.length) rooms.pop().dispose();
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
