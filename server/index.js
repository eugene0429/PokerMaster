import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room } from './room.js';
import { buildInvite } from './invite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const room = new Room({
  send: (socketId, channel, payload) => io.to(socketId).emit(channel, payload),
});

io.on('connection', (socket) => {
  const guard = (fn) => (payload) => {
    const playerId = room.playerIdForSocket(socket.id);
    if (!playerId) return socket.emit('errorMsg', { message: '아직 접속 중입니다' });
    try {
      fn(playerId, payload ?? {});
    } catch (err) {
      socket.emit('errorMsg', { message: err.message });
      // Whatever the client thought was true, resync it to the server's truth.
      room.publish();
    }
  };

  socket.on('join', ({ token, name } = {}) => {
    try {
      room.join({ socketId: socket.id, token, name });
    } catch (err) {
      socket.emit('errorMsg', { message: err.message });
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

const invite = await buildInvite(PORT);
room.invite = invite;

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  \x1b[1m\x1b[32mPokerMaster\x1b[0m 실행 중');
  console.log('');
  console.log(`  이 컴퓨터    \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  for (const url of invite.urls) {
    console.log(`  같은 와이파이  \x1b[1m\x1b[36m${url}\x1b[0m  ← 친구들에게 알려주세요`);
  }
  if (!invite.hasLan) {
    console.log('  네트워크에 연결되어 있지 않아 LAN 주소를 찾지 못했습니다.');
  }
  console.log('');
  console.log('  게임 화면의 "친구 초대"를 누르면 QR 코드로도 부를 수 있습니다.');
  console.log('  종료하려면 Ctrl+C');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    room.dispose();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
