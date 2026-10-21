import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Short enough to sit in a link, long enough that nobody guesses it. */
export function makeInviteKey() {
  return randomBytes(9).toString('base64url');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Whether a socket handshake may join. With no key set the table is open, as
 * it always was on the LAN. With one, only the host's own browser skips it.
 *
 * A tunnel delivers outsiders from loopback too — cloudflared runs on this
 * machine — so loopback alone proves nothing. What gives them away is the
 * forwarding header the tunnel adds and a browser opened here never sends.
 */
export function admits({ address, headers = {}, auth = {} }, key) {
  if (!key) return true;
  const forwarded = headers['cf-connecting-ip'] || headers['x-forwarded-for'];
  if (LOOPBACK.has(address) && !forwarded) return true;
  return sameKey(auth.key, key);
}

function sameKey(given, key) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
