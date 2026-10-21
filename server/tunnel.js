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

    const timer = setTimeout(() => fail('cloudflared가 30초 안에 주소를 주지 않았습니다.'), START_TIMEOUT_MS);

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
      ? 'cloudflared가 설치되어 있지 않습니다 — brew install cloudflared'
      : `cloudflared를 실행하지 못했습니다: ${err.message}`));
    child.on('exit', (code) => {
      if (!settled) fail(`cloudflared가 종료되었습니다 (코드 ${code}).`);
      else if (!closing) console.log('\n  \x1b[33m공개 링크가 끊어졌습니다.\x1b[0m 같은 와이파이 주소는 계속 됩니다.\n');
    });
  });
}
