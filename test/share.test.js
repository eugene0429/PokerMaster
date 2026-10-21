import { describe, it, expect } from 'vitest';
import { admits } from '../server/access.js';
import { buildInvite } from '../server/invite.js';
import { parseTunnelUrl } from '../server/tunnel.js';

const loopback = (extra = {}) => ({ address: '127.0.0.1', headers: {}, auth: {}, ...extra });

describe('invite key gate', () => {
  it('lets everyone in when no key is set (plain LAN mode)', () => {
    expect(admits(loopback({ address: '192.168.0.7' }), null)).toBe(true);
  });

  it('lets the host machine in without a key', () => {
    expect(admits(loopback(), 'k1')).toBe(true);
    expect(admits(loopback({ address: '::1' }), 'k1')).toBe(true);
    expect(admits(loopback({ address: '::ffff:127.0.0.1' }), 'k1')).toBe(true);
  });

  it('treats tunnelled traffic as outside, even though it arrives on loopback', () => {
    const viaTunnel = loopback({ headers: { 'cf-connecting-ip': '203.0.113.9' } });
    expect(admits(viaTunnel, 'k1')).toBe(false);
    expect(admits({ ...viaTunnel, auth: { key: 'k1' } }, 'k1')).toBe(true);
    expect(admits(loopback({ headers: { 'x-forwarded-for': '203.0.113.9' } }), 'k1')).toBe(false);
  });

  it('asks a LAN guest for the key too, and refuses a wrong one', () => {
    const lan = loopback({ address: '192.168.0.7' });
    expect(admits(lan, 'k1')).toBe(false);
    expect(admits({ ...lan, auth: { key: 'nope' } }, 'k1')).toBe(false);
    expect(admits({ ...lan, auth: { key: 'k1' } }, 'k1')).toBe(true);
  });
});

describe('tunnel url', () => {
  it('finds the quick-tunnel address in cloudflared output', () => {
    const line = '2026-09-27T10:00:00Z INF |  https://brave-otter-lake-sun.trycloudflare.com  |';
    expect(parseTunnelUrl(line)).toBe('https://brave-otter-lake-sun.trycloudflare.com');
  });

  it('ignores the other lines', () => {
    expect(parseTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
    expect(parseTunnelUrl('see https://www.cloudflare.com/website-terms/')).toBeNull();
  });
});

describe('invite with a public link', () => {
  it('puts the public link first and carries the key on every address', async () => {
    const invite = await buildInvite(3000, { publicUrl: 'https://a-b.trycloudflare.com', key: 'k1' });
    expect(invite.isPublic).toBe(true);
    expect(invite.primary).toBe('https://a-b.trycloudflare.com/?k=k1');
    for (const url of invite.urls) expect(url).toMatch(/\?k=k1$/);
    expect(invite.qr).toContain('<svg');
  });

  it('stays a LAN invite without one', async () => {
    const invite = await buildInvite(3000);
    expect(invite.isPublic).toBe(false);
    for (const url of invite.urls) expect(url).not.toContain('?k=');
  });
});
