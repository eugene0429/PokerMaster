import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// A server process per test. One room lives for the life of the process, so
// sharing it between tests would leak a finished or locked table into the next.
let nextPort = 3600;
let server;
let URL;

beforeEach(async () => {
  const port = nextPort++;
  URL = `http://127.0.0.1:${port}`;
  server = spawn('node', [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  await waitFor(async () => {
    try { await fetch(URL); return true; } catch { return false; }
  }, 20000);
}, 30000);

afterEach(() => { server?.kill(); });

/* ------------------------------ helpers ----------------------------- */

function waitFor(predicate, timeout = 20000, interval = 40) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out waiting'));
      setTimeout(tick, interval);
    };
    tick();
  });
}

function client(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { socket, name, snapshot: null, events: [], errors: [] };

  socket.on('update', ({ snapshot, events }) => {
    c.snapshot = snapshot;
    c.events.push(...events);
  });
  socket.on('errorMsg', ({ message }) => c.errors.push(message));

  c.ready = new Promise((resolve) => socket.on('identity', resolve));
  socket.emit('join', { name });
  c.send = (channel, payload) => socket.emit(channel, payload ?? {});
  c.close = () => socket.close();
  return c;
}

/**
 * Two humans at a cash table, the way the main menu opens one: both wait in
 * the lobby and the host's start seats everybody at once.
 */
async function twoPlayerTable(hostName, guestName) {
  // Whoever's socket lands first becomes the host, and two sockets opened at
  // once do not arrive in the order they were created. Let the host settle in
  // before the guest knocks.
  const host = client(hostName);
  await host.ready;
  const guest = client(guestName);
  await guest.ready;
  await waitFor(() => host.snapshot?.lobby?.length === 2);

  host.send('startTable', { name: hostName, bots: 0, mode: 'cash' });
  // Beware `x !== null` on an optional chain: it is true while the snapshot is
  // still undefined, and the wait passes before anything has happened.
  await waitFor(() => !!host.snapshot?.seats?.[0] && !!host.snapshot?.seats?.[1])
    .catch(() => {
      // Say what the server actually objected to, instead of just "timed out".
      throw new Error(`table never opened; server said: ${host.errors.join(' / ') || '(nothing)'}`);
    });

  return { host, guest, hostSeat: 0, guestSeat: 1 };
}

/** Every chip on the table: in stacks, bet in front, or sitting in the pot. */
function totalChips(snapshot) {
  const seats = snapshot.seats.filter(Boolean);
  const stacks = seats.reduce((sum, s) => sum + s.stack, 0);
  const inFront = seats.reduce((sum, s) => sum + s.committed, 0);
  const pot = snapshot.hand && !snapshot.hand.complete ? snapshot.hand.potCollected : 0;
  return stacks + inFront + pot;
}

/* ------------------------------- tests ------------------------------ */

describe('two players over the network', () => {
  it('deals a hand, hides the other hand, and plays it to the end', async () => {
    const { host: a, guest: b } = await twoPlayerTable('Ann', 'Ben');

    await waitFor(() => a.snapshot?.hand?.handId >= 1, 25000);

    // Each player sees their own two cards and nothing of the other's.
    expect(a.snapshot.seats[0].cards).toHaveLength(2);
    expect(a.snapshot.seats[1].cardCount).toBe(2);
    expect(a.snapshot.seats[1].cards).toBeNull();

    // Nor does the event stream carry them.
    expect(a.events.filter((e) => e.type === 'holeCards' && e.seat !== 0)).toEqual([]);
    expect(totalChips(a.snapshot)).toBe(20000);

    // Play it out: whoever is to act checks or calls until the hand is over.
    const players = { 0: a, 1: b };
    await waitFor(() => {
      for (const [seat, c] of Object.entries(players)) {
        const act = c.snapshot?.toAct;
        if (act && c.snapshot.hand.currentSeat === Number(seat)) {
          c.send('action', { type: act.canCheck ? 'check' : 'call' });
        }
      }
      return a.snapshot?.hand?.complete === true;
    }, 30000, 60);

    expect(a.snapshot.hand.board).toHaveLength(5);
    expect(a.snapshot.hand.results.showdown).toBe(true);
    expect(totalChips(a.snapshot)).toBe(20000);

    // Showdown tables the cards, so now both hands are visible to both players.
    expect(a.snapshot.seats[1].cards).toHaveLength(2);
    expect(b.snapshot.seats[0].cards).toHaveLength(2);

    a.close();
    b.close();
  }, 90000);

  it('refuses an action from a player who is not to act', async () => {
    const { host: a, guest: b } = await twoPlayerTable('Cal', 'Dee');

    await waitFor(() => a.snapshot?.hand && !a.snapshot.hand.complete, 25000);

    const waiting = a.snapshot.hand.currentSeat === 0 ? b : a;
    waiting.errors.length = 0;
    waiting.send('action', { type: 'fold' });

    await waitFor(() => waiting.errors.length > 0, 10000);
    expect(waiting.errors[0]).toMatch(/차례|turn/);

    a.close();
    b.close();
  }, 90000);

  it('locks a started tournament so a latecomer can only watch', async () => {
    const host = client('Eve');
    await host.ready;

    host.send('startTable', { name: 'Eve', bots: 2, mode: 'tournament', levelMinutes: 10 });
    await waitFor(() => typeof host.snapshot?.game?.startedAt === 'number', 25000);

    // Fin shows up after the tournament is already running.
    const watcher = client('Fin');
    await watcher.ready;
    watcher.errors.length = 0;
    watcher.send('sit', { seat: 8 });
    await waitFor(() => watcher.errors.length > 0, 10000);
    expect(watcher.errors[0]).toMatch(/토너먼트/);

    // Watching still works — the snapshot keeps flowing.
    expect(watcher.snapshot.seats.filter(Boolean).length).toBe(3);
    expect(watcher.snapshot.game.mode).toBe('tournament');

    host.close();
    watcher.close();
  }, 90000);
});
