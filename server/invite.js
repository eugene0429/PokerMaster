import os from 'node:os';
import QRCode from 'qrcode';

/** IPv4 addresses a friend on the same router could actually reach. */
export function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      // 169.254.x is a link-local address a machine assigns itself when DHCP
      // fails. Nobody else can reach it, so it is not an invite.
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        out.push(a.address);
      }
    }
  }
  // Private ranges first — that is what the friend on the same wifi will use.
  return out.sort((x, y) => Number(isPrivate(y)) - Number(isPrivate(x)));
}

function isPrivate(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/**
 * Everything the invite dialog needs, computed once at boot: the addresses to
 * hand out and a QR of the best one so a friend can just point a phone at it.
 */
export async function buildInvite(port) {
  const urls = lanAddresses().map((ip) => `http://${ip}:${port}`);
  const primary = urls[0] ?? `http://localhost:${port}`;

  let qr = null;
  try {
    qr = await QRCode.toString(primary, {
      type: 'svg',
      margin: 1,
      width: 208,
      color: { dark: '#0b0f14', light: '#ffffff' },
    });
  } catch {
    qr = null;   // no QR is survivable; the URL still works
  }

  return { urls, primary, qr, hasLan: urls.length > 0 };
}
