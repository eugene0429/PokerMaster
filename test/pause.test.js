import { describe, it, expect, afterEach, vi } from 'vitest';
import { Room } from '../server/room.js';
import { snapshotFor } from '../server/view.js';
import { MODE } from '../server/blinds.js';

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

function table({ mode = MODE.CASH, bots = 2, ...rest } = {}) {
  const room = makeRoom();
  const host = room.join({ socketId: 's1', name: 'Host' });
  room.startTable(host.id, { name: 'Host', bots, mode, startingStack: 10000, ...rest });
  return { room, host };
}

describe('pausing the game', () => {
  it('is nobody but the host to call', () => {
    const { room } = table();
    const guest = room.join({ socketId: 's2', name: 'Guest' });
    expect(() => room.pause(guest.id)).toThrow(/Only the host/);
    expect(room.paused).toBe(false);
  });

  it('stops every pending timer', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    vi.advanceTimersByTime(3500);          // a hand is running
    expect(room.timers.size).toBeGreaterThan(0);

    room.pause(host.id);
    expect(room.paused).toBe(true);
    expect(room.timers.size).toBe(0);
    expect(room.suspended.length).toBeGreaterThan(0);
  });

  it('does not deal the next hand while it is stopped', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    room.pause(host.id);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(room.hand).toBeNull();
  });

  it('puts the turn clock back where it was', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    vi.advanceTimersByTime(3500);
    room.turnEndsAt = Date.now() + 20000;

    room.pause(host.id);
    expect(room.turnEndsAt).toBeNull();     // nothing is counting down

    vi.advanceTimersByTime(5 * MINUTE);     // stood around for five minutes
    room.resume(host.id);
    expect(room.turnEndsAt - Date.now()).toBe(20000);
  });

  it('holds the blind clock, so a break costs nobody a level', () => {
    vi.useFakeTimers();
    const { room, host } = table({
      mode: MODE.TOURNAMENT, levelMinutes: 10, sb: 50, bb: 100,
    });
    vi.advanceTimersByTime(3500);
    room.startedAt = Date.now() - 9 * MINUTE;   // one minute to the next level

    room.pause(host.id);
    vi.advanceTimersByTime(30 * MINUTE);        // a long break
    room.resume(host.id);

    room.applyDueLevel();
    expect(room.level).toBe(0);                 // still a minute short

    vi.advanceTimersByTime(90 * 1000);
    room.applyDueLevel();
    expect(room.level).toBe(1);                 // and it arrives on schedule
  });

  it('holds the game clock in a timed game too', () => {
    vi.useFakeTimers();
    const { room, host } = table({ mode: MODE.TIMED, totalMinutes: 30 });
    vi.advanceTimersByTime(3500);
    const endsAt = room.endsAt;

    room.pause(host.id);
    vi.advanceTimersByTime(7 * MINUTE);
    room.resume(host.id);

    expect(room.endsAt - endsAt).toBe(7 * MINUTE);
  });

  it('refuses an action while stopped', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    vi.advanceTimersByTime(3500);
    room.pause(host.id);

    room.hand.currentSeat = host.seat;
    expect(() => room.act(host.id, { type: 'check' })).toThrow(/paused/);
  });

  it('keeps the bots quiet', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    vi.advanceTimersByTime(3500);
    const handId = room.hand.handId;
    const before = room.hand.board.length;

    room.pause(host.id);
    vi.advanceTimersByTime(5 * MINUTE);

    expect(room.hand.handId).toBe(handId);
    expect(room.hand.board.length).toBe(before);
  });

  it('picks up where it left off', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    vi.advanceTimersByTime(3500);
    const handId = room.hand.handId;

    room.pause(host.id);
    vi.advanceTimersByTime(2 * MINUTE);
    room.resume(host.id);
    expect(room.paused).toBe(false);
    expect(room.timers.size).toBeGreaterThan(0);

    vi.advanceTimersByTime(3 * MINUTE);
    expect(room.hand.handId).toBeGreaterThan(handId);   // hands are being dealt again
  });

  it('tells everyone, through the snapshot and the chat', () => {
    vi.useFakeTimers();
    const { room, host } = table();
    vi.advanceTimersByTime(3500);

    room.pause(host.id);
    expect(snapshotFor(room, host.id).game.paused).toBe(true);
    expect(room.chat.recent().some((m) => m.text.includes('paused'))).toBe(true);

    room.resume(host.id);
    expect(snapshotFor(room, host.id).game.paused).toBe(false);
    expect(room.chat.recent().some((m) => m.text.includes('resumed'))).toBe(true);
  });

  it('shrugs at pausing twice or resuming when nothing is stopped', () => {
    const { room, host } = table();
    room.resume(host.id);
    expect(room.paused).toBe(false);
    room.pause(host.id);
    room.pause(host.id);
    expect(room.paused).toBe(true);
    expect(room.suspended.length).toBeGreaterThanOrEqual(0);
  });
});
