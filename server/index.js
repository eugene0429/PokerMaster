import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Room } from './room.js';

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

  socket.on('sit', guard((id, { seat, name }) => room.sitDown(id, Number(seat), name)));
  socket.on('stand', guard((id) => room.standUp(id)));
  socket.on('sitOut', guard((id, { value }) => room.setSittingOut(id, value)));
  socket.on('addBot', guard((id) => room.addBot(id)));
  socket.on('removeBot', guard((id, { seat }) => room.removeBot(id, Number(seat))));
  socket.on('config', guard((id, patch) => room.updateConfig(id, patch)));
  socket.on('action', guard((id, action) => room.act(id, action)));

  socket.on('disconnect', () => room.leave(socket.id));
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log('');
  console.log('  \x1b[1m\x1b[32mPokerMaster\x1b[0m 실행 중');
  console.log('');
  console.log(`  이 컴퓨터    \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  for (const ip of lan) {
    console.log(`  같은 와이파이  \x1b[1m\x1b[36mhttp://${ip}:${PORT}\x1b[0m  ← 친구들에게 알려주세요`);
  }
  if (lan.length === 0) {
    console.log('  네트워크에 연결되어 있지 않아 LAN 주소를 찾지 못했습니다.');
  }
  console.log('');
  console.log('  종료하려면 Ctrl+C');
  console.log('');
});

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // Private ranges first — that's what a friend on the same router will use.
  return out.sort((x, y) => Number(isPrivate(y)) - Number(isPrivate(x)));
}

function isPrivate(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
