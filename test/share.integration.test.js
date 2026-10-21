import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3790;
const URL = `http://127.0.0.1:${PORT}`;
const KEY = 'test-key';

// INVITE_KEY turns the gate on without a tunnel, so this runs offline.
let server;

beforeAll(async () => {
  server = spawn('node', [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), INVITE_KEY: KEY, SHARE: '' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { await fetch(URL); break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server never came up');
    await new Promise((r) => setTimeout(r, 50));
  }
}, 30000);

afterAll(() => { server?.kill(); });

/** Resolves with 'identity' when let in, or the refusal message when turned away. */
function knock({ key, forwarded }) {
  const socket = io(URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: key ? { key } : {},
    // What cloudflared adds to every request it carries in from outside.
    extraHeaders: forwarded ? { 'cf-connecting-ip': '203.0.113.9' } : {},
  });
  return new Promise((resolve) => {
    socket.on('identity', () => { socket.close(); resolve('identity'); });
    socket.on('connect', () => socket.emit('join', { name: 'Tester' }));
    socket.on('connect_error', (err) => { socket.close(); resolve(err.message); });
  });
}

describe('sharing through a tunnel', () => {
  it('turns away an outsider without the key', async () => {
    expect(await knock({ forwarded: true })).toBe('bad-invite');
  });

  it('turns away an outsider with the wrong key', async () => {
    expect(await knock({ forwarded: true, key: 'guess' })).toBe('bad-invite');
  });

  it('lets in an outsider who has the link', async () => {
    expect(await knock({ forwarded: true, key: KEY })).toBe('identity');
  });

  it('lets the host machine in without one', async () => {
    expect(await knock({})).toBe('identity');
  });
});
