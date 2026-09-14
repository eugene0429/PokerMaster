import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3599;
const URL = `http://127.0.0.1:${PORT}`;

let server;

beforeAll(async () => {
  server = spawn('node', [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitFor(async () => {
    try { await fetch(URL); return true; } catch { return false; }
  }, 10000);
}, 20000);

afterAll(() => { server?.kill(); });

/* ------------------------------ helpers ----------------------------- */

function waitFor(predicate, timeout = 8000, interval = 40) {
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
    const a = client('Ann');
    const b = client('Ben');
    await Promise.all([a.ready, b.ready]);

    a.send('sit', { seat: 0 });
    b.send('sit', { seat: 5 });

    await waitFor(() => a.snapshot?.hand?.handId >= 1, 12000);

    // Each player sees their own two cards and nothing of the other's.
    const mine = a.snapshot.seats[0];
    const theirs = a.snapshot.seats[5];
    expect(mine.cards).toHaveLength(2);
    expect(theirs.cardCount).toBe(2);
    expect(theirs.cards).toBeNull();

    // Nor does the event stream carry them.
    const leaked = a.events.filter((e) => e.type === 'holeCards' && e.seat !== 0);
    expect(leaked).toEqual([]);

    expect(totalChips(a.snapshot)).toBe(20000);

    // Play it out: whoever is to act checks or calls until the hand is over.
    const players = { 0: a, 5: b };
    await waitFor(() => {
      for (const [seat, c] of Object.entries(players)) {
        const act = c.snapshot?.toAct;
        if (act && c.snapshot.hand.currentSeat === Number(seat)) {
          c.send('action', { type: act.canCheck ? 'check' : 'call' });
        }
      }
      return a.snapshot?.hand?.complete === true;
    }, 15000, 60);

    expect(a.snapshot.hand.board).toHaveLength(5);
    expect(a.snapshot.hand.results.showdown).toBe(true);
    expect(totalChips(a.snapshot)).toBe(20000);

    // Showdown tables the cards, so now both hands are visible to both players.
    expect(a.snapshot.seats[5].cards).toHaveLength(2);
    expect(b.snapshot.seats[0].cards).toHaveLength(2);

    a.close();
    b.close();
  }, 40000);

  it('refuses an action from a player who is not to act', async () => {
    const a = client('Cal');
    const b = client('Dee');
    await Promise.all([a.ready, b.ready]);
    a.send('sit', { seat: 2 });
    b.send('sit', { seat: 7 });

    await waitFor(() => a.snapshot?.hand && !a.snapshot.hand.complete, 12000);

    const waiting = a.snapshot.hand.currentSeat === 2 ? b : a;
    waiting.errors.length = 0;
    waiting.send('action', { type: 'fold' });

    await waitFor(() => waiting.errors.length > 0, 4000);
    expect(waiting.errors[0]).toMatch(/차례|turn/);

    a.close();
    b.close();
  }, 40000);
});
