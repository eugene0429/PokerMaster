import { spawn } from 'node:child_process';

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 30000;

/** The public address in a line of cloudflared's output, if this is the line. */
export function parseTunnelUrl(line) {
  return line.match(TUNNEL_URL)?.[0] ?? null;
}

/**
 * Opens a Cloudflare quick tunnel to this server: a public https address, no
 * account, gone when the process ends. Resolves with { url, close } or throws
 * with a message fit to print — the caller falls back to LAN-only.
 */
export function openTunnel(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', [
      'tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let settled = false;
    let closing = false;
    const close = () => {
      closing = true;
      if (child.exitCode === null) child.kill();
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      close();
      reject(new Error(message));
    };

    const timer = setTimeout(() => fail('cloudflared did not hand out an address within 30 seconds.'), START_TIMEOUT_MS);

    // cloudflared logs to stderr; watch both in case that ever changes.
    let buffered = '';
    const onData = (chunk) => {
      if (settled) return;
      buffered += chunk;
      const url = parseTunnelUrl(buffered);
      if (url) {
        settled = true;
        clearTimeout(timer);
        resolve({ url, close });
      }
      buffered = buffered.slice(-500);
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', onData);

    child.on('error', (err) => fail(err.code === 'ENOENT'
      ? 'cloudflared is not installed. Run: brew install cloudflared'
      : `Could not run cloudflared: ${err.message}`));
    child.on('exit', (code) => {
      if (!settled) fail(`cloudflared exited (code ${code}).`);
      else if (!closing) console.log('\n  \x1b[33mThe public link dropped.\x1b[0m The same-Wi-Fi address still works.\n');
    });
  });
}
