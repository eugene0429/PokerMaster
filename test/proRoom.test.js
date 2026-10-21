import { describe, it, expect, afterEach, vi } from 'vitest';
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
  vi.useRealTimers();
});

function open(opts) {
  const room = makeRoom();
  const host = room.join({ socketId: 's1', name: 'Host' });
  room.startTable(host.id, { name: 'Host', mode: 'cash', ...opts });
  return { room, host, bots: room.seatedPlayers().filter((p) => p.isBot) };
}

describe('bot modes', () => {
  it('opens casual by default', () => {
    const { room } = open({ bots: 1 });
    expect(room.config.botMode).toBe('casual');
    expect(room.config.botSkill).toBe('normal');
  });

  it('seats only pros at the chosen difficulty on a practice table', () => {
    const { bots } = open({ bots: 6, botMode: 'practice', botSkill: 'hard' });
    expect(bots).toHaveLength(6);
    for (const b of bots) {
      expect(b.brain).toBe('pro');
      expect(b.skill.key).toBe('hard');
    }
    // Four styles in the bag: the first four practice bots are all different.
    expect(new Set(bots.slice(0, 4).map((b) => b.profile.key)).size).toBe(4);
  });

  it('mixes archetypes and pros on a casual table without repeating a personality', () => {
    const { bots } = open({ bots: 9 });
    expect(new Set(bots.map((b) => b.profile.key)).size).toBe(9);
    // Nine out of a bag of seven archetypes and four pros: at least two of each.
    expect(bots.filter((b) => b.brain === 'pro').length).toBeGreaterThanOrEqual(2);
    expect(bots.filter((b) => b.brain === 'casual').length).toBeGreaterThanOrEqual(5);
    for (const b of bots.filter((x) => x.brain === 'pro')) expect(['easy', 'normal', 'hard']).toContain(b.skill.key);
  });

  it('falls back to the defaults for a mode or difficulty it does not know', () => {
    const { room } = open({ bots: 1, botMode: 'godmode', botSkill: 'impossible' });
    expect(room.config.botMode).toBe('casual');
    expect(room.config.botSkill).toBe('normal');
  });

  it('never shows a player which bot is which, or what it knows', () => {
    const { room, host } = open({ bots: 9 });
    const seen = JSON.stringify(snapshotFor(room, host.id));
    for (const word of ['"brain"', '"skill"', '"ledger"', '"samples"', 'pro-solid', 'pro-tight', 'pro-loose', 'pro-tricky', '"vpip"']) {
      expect(seen).not.toContain(word);
    }
  });
});

describe('what the room remembers for the bots', () => {
  it('logs this hand\'s actions and builds session stats as bots play', () => {
    vi.useFakeTimers();
    const { room } = open({ bots: 3, botMode: 'practice', botSkill: 'easy' });
    room.players.get(room.hostId).sittingOut = true;     // bots only, no clock to wait on
    // A long first hand can run close to a minute of thinking time; wait it out.
    for (let i = 0; i < 60 && !(room.hand?.handId > 1); i++) vi.advanceTimersByTime(5000);
    expect(room.hand.handId).toBeGreaterThan(1);
    expect(room.stats.players.size).toBeGreaterThanOrEqual(3);
    for (const a of room.handActions) expect(a.street).toBeDefined();
  });

  it('starts every hand with an empty log', () => {
    vi.useFakeTimers();
    const { room } = open({ bots: 2, botMode: 'practice', botSkill: 'easy' });
    room.players.get(room.hostId).sittingOut = true;
    vi.advanceTimersByTime(3100);                            // the first deal
    expect(room.handActions.every((a) => a.street === 'preflop')).toBe(true);
    expect(room.handActions.length).toBeLessThanOrEqual(1);
  });

  it('forgets everyone\'s tendencies when a new game starts', () => {
    vi.useFakeTimers();
    const { room, host } = open({ bots: 3, botMode: 'practice', botSkill: 'easy' });
    room.players.get(room.hostId).sittingOut = true;
    vi.advanceTimersByTime(60 * 1000);
    room.resetTable(host.id);
    expect(room.stats.players.size).toBe(0);
    expect(room.handActions).toEqual([]);
  });

  it('does not log a click the engine rejects', () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const host = room.join({ socketId: 's1', name: 'Host' });
    room.startTable(host.id, { name: 'Host', mode: 'cash', bots: 1, botMode: 'practice' });
    vi.advanceTimersByTime(3100);
    // Wait until it is the human's turn.
    for (let i = 0; i < 20 && room.hand.currentSeat !== host.seat; i++) vi.advanceTimersByTime(2500);
    expect(room.hand.currentSeat).toBe(host.seat);
    const before = room.handActions.length;
    expect(() => room.act(host.id, { type: 'raise', amount: 1 })).toThrow();
    expect(room.handActions.length).toBe(before);
  });
});
