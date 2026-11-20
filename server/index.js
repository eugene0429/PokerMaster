import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room } from './room.js';
import { buildInvite } from './invite.js';
import { admits, makeInviteKey } from './access.js';
import { openTunnel } from './tunnel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// `npm run share` puts the table on the internet through a tunnel. A key in
// the link then keeps out whoever else stumbles on the address.
const SHARE = !!process.env.SHARE;
let tunnel = null;
let shareError = null;
if (SHARE) {
  try {
    tunnel = await openTunnel(PORT);
  } catch (err) {
    shareError = err.message;
  }
}

// With a key set, only links that carry it get a seat — see access.js.
const INVITE_KEY = process.env.INVITE_KEY || (tunnel ? makeInviteKey() : null);
io.use((socket, next) => {
  const { address, headers, auth } = socket.handshake;
  if (admits({ address, headers, auth }, INVITE_KEY)) return next();
  next(new Error('bad-invite'));
});

/** The message, plus a code the client can translate when the room gave one. */
function errorPayload(err) {
  return { message: err.message, code: err.code ?? null, params: err.params ?? null };
}

const room = new Room({
  send: (socketId, channel, payload) => io.to(socketId).emit(channel, payload),
});

io.on('connection', (socket) => {
  const guard = (fn) => (payload) => {
    const playerId = room.playerIdForSocket(socket.id);
    if (!playerId) return socket.emit('errorMsg', { message: 'Still connecting', code: 'connecting' });
    try {
      fn(playerId, payload ?? {});
    } catch (err) {
      socket.emit('errorMsg', errorPayload(err));
      // Whatever the client thought was true, resync it to the server's truth.
      room.publish();
    }
  };

  socket.on('join', ({ token, name } = {}) => {
    try {
      room.join({ socketId: socket.id, token, name });
    } catch (err) {
      socket.emit('errorMsg', errorPayload(err));
    }
  });

  socket.on('startTable', guard((id, opts) => room.startTable(id, opts)));
  socket.on('sit', guard((id, { seat, name }) => room.sitDown(id, Number(seat), name)));
  socket.on('stand', guard((id) => room.standUp(id)));
  socket.on('sitOut', guard((id, { value }) => room.setSittingOut(id, value)));
  socket.on('addBot', guard((id, { seat } = {}) => room.addBot(id, seat ?? null)));
  socket.on('kick', guard((id, { seat }) => room.kick(id, Number(seat))));
  socket.on('reset', guard((id) => room.resetTable(id)));
  socket.on('pause', guard((id) => room.pause(id)));
  socket.on('resume', guard((id) => room.resume(id)));
  socket.on('chat', guard((id, { text }) => room.postChat(id, text)));
  socket.on('rename', guard((id, { name }) => room.renamePlayer(id, name)));
  socket.on('config', guard((id, patch) => room.updateConfig(id, patch)));
  socket.on('action', guard((id, action) => room.act(id, action)));

  socket.on('disconnect', () => room.leave(socket.id));
});

const invite = await buildInvite(PORT, { publicUrl: tunnel?.url ?? null, key: INVITE_KEY });
room.invite = invite;

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  \x1b[1m\x1b[32mPokerMaster\x1b[0m is running');
  console.log('');
  console.log(`  This computer  \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  for (const url of invite.urls) {
    const label = tunnel && url === invite.primary ? 'Anywhere     ' : 'Same Wi-Fi   ';
    console.log(`  ${label}  \x1b[1m\x1b[36m${url}\x1b[0m  ← share this with your friends`);
  }
  if (tunnel) {
    console.log('');
    console.log('  Anyone with the link can join. Only send it to people you trust.');
  }
  if (shareError) {
    console.log('');
    console.log(`  \x1b[33mCould not open a public link:\x1b[0m ${shareError}`);
    console.log('  The same-Wi-Fi address still works.');
  }
  if (!invite.hasLan) {
    console.log('  Not connected to a network, so there is no LAN address to share.');
  }
  console.log('');
  console.log('  Press "Invite" in the game for a QR code your friends can scan.');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});

// However the process ends — even a crash — take cloudflared down with it.
process.on('exit', () => tunnel?.close());

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    room.dispose();
    tunnel?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
