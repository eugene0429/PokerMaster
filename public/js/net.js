/**
 * Socket plumbing. Identity lives in localStorage so a refresh or a dropped
 * Wi-Fi connection puts you back in the same seat with the same chips.
 */

const TOKEN_KEY = 'pm-token';
const NAME_KEY = 'pm-name';
const BUILD_KEY = 'pm-build';
const INVITE_KEY = 'pm-invite';

/**
 * The invite key from the link (?k=…). Kept for the tab, so a reload of a bare
 * address still gets in; the link always wins over what was kept.
 */
function inviteKey() {
  const fromLink = new URLSearchParams(location.search).get('k');
  if (fromLink) sessionStorage.setItem(INVITE_KEY, fromLink);
  return fromLink ?? sessionStorage.getItem(INVITE_KEY);
}

export function savedName() { return localStorage.getItem(NAME_KEY) ?? ''; }
export function saveName(name) { localStorage.setItem(NAME_KEY, name); }

export function connect({ onUpdate, onIdentity, onError, onStatus }) {
  const key = inviteKey();
  const socket = io({ transports: ['websocket', 'polling'], auth: key ? { key } : {} });

  const sendJoin = () => socket.emit('join', {
    token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    name: savedName() || undefined,
  });

  socket.on('connect', () => { onStatus?.('connected'); sendJoin(); });
  socket.on('disconnect', () => onStatus?.('disconnected'));
  socket.on('connect_error', (err) => {
    onStatus?.('disconnected');
    if (err.message !== 'bad-invite') return;
    // Retrying will not help; the key is not going to change by itself.
    socket.disconnect();
    sessionStorage.removeItem(INVITE_KEY);
    onError?.(null, 'badInvite');
  });

  socket.on('identity', (payload) => {
    localStorage.setItem(TOKEN_KEY, payload.token);
    if (payload.name) saveName(payload.name);

    // The server restarted under us, so this page may be running old code.
    // The seat is held by the token in localStorage, so reloading costs nothing.
    const seen = sessionStorage.getItem(BUILD_KEY);
    if (payload.build && seen && seen !== payload.build) {
      sessionStorage.setItem(BUILD_KEY, payload.build);
      location.reload();
      return;
    }
    if (payload.build) sessionStorage.setItem(BUILD_KEY, payload.build);

    onIdentity?.(payload);
  });
  socket.on('update', onUpdate);
  socket.on('errorMsg', ({ message, code, params }) => onError?.(message, code, params));

  return {
    socket,
    rejoin: sendJoin,
    send: (channel, payload) => socket.emit(channel, payload ?? {}),
  };
}
