const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const WORDS = [
  'apple','airplane','banana','bicycle','camel','camera','castle','cat','chair','clock',
  'cloud','cactus','crown','dolphin','dragon','drum','eagle','falcon','fish','flower',
  'football','ghost','guitar','hamburger','helicopter','house','ice cream','island','key',
  'kite','ladder','lemon','lion','moon','mountain','ninja','octopus','palm tree','pizza',
  'pirate','rainbow','robot','rocket','sandwich','scorpion','shark','skateboard','snowman',
  'spider','sun','sword','teapot','tiger','train','trophy','umbrella','volcano','watermelon',
  'whale','windmill','burj khalifa','desert','dates','headphones','joystick','pyramid',
  'penguin','tornado','treasure','zombie','backpack','controller','lighthouse','parachute'
];

const ROUNDS = 3, DRAW_TIME = 80, PICK_TIME = 15;
const rooms = {};

const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

function makeCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s;
  do {
    s = '';
    for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  } while (rooms[s]);
  return s;
}

function maskedHint(room) {
  return room.word.split('').map((ch, i) =>
    ch === ' ' ? '  ' : (room.revealed.has(i) ? ch : '_')
  ).join(' ');
}

function publicState(room) {
  return {
    code: room.code, state: room.state, round: room.round, maxRounds: ROUNDS,
    hostId: room.hostId, drawerId: room.drawerId, timeLeft: room.timeLeft,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, guessed: p.guessed }))
  };
}

const broadcast = room => io.to(room.code).emit('state', publicState(room));
const say = (room, text, kind = 'system') => io.to(room.code).emit('chat', { text, kind });
const clearTimers = room => { clearInterval(room.interval); clearTimeout(room.timer); };
const allGuessed = room => {
  const g = room.players.filter(p => p.id !== room.drawerId);
  return g.length > 0 && g.every(p => p.guessed);
};

function startGame(room) {
  clearTimers(room);
  room.players.forEach(p => { p.score = 0; });
  room.round = 1;
  room.queue = room.players.map(p => p.id);
  nextTurn(room);
}

function nextTurn(room) {
  clearTimers(room);
  if (room.players.length < 2) { room.state = 'lobby'; broadcast(room); return; }
  room.queue = room.queue.filter(id => room.players.some(p => p.id === id));
  if (!room.queue.length) {
    room.round++;
    if (room.round > ROUNDS) return endGame(room);
    room.queue = room.players.map(p => p.id);
  }
  room.drawerId = room.queue.shift();
  room.state = 'choosing';
  room.word = '';
  room.strokes = [];
  room.guessedCount = 0;
  room.players.forEach(p => { p.guessed = false; });
  room.options = pick(WORDS, 3);
  room.timeLeft = PICK_TIME;
  io.to(room.code).emit('clear');
  io.to(room.drawerId).emit('wordOptions', room.options);
  broadcast(room);
  room.timer = setTimeout(() => chooseWord(room, room.options[0]), PICK_TIME * 1000);
}

function chooseWord(room, word) {
  if (room.state !== 'choosing') return;
  clearTimers(room);
  room.word = word;
  room.revealed = new Set();
  room.state = 'drawing';
  room.timeLeft = DRAW_TIME;
  io.to(room.drawerId).emit('yourWord', word);
  broadcast(room);
  io.to(room.code).emit('tick', { timeLeft: room.timeLeft, hint: maskedHint(room) });
  room.interval = setInterval(() => tick(room), 1000);
}

function revealLetter(room) {
  const idxs = [...room.word].map((c, i) => i)
    .filter(i => room.word[i] !== ' ' && !room.revealed.has(i));
  if (idxs.length > 2) room.revealed.add(idxs[Math.floor(Math.random() * idxs.length)]);
}

function tick(room) {
  room.timeLeft--;
  if (room.timeLeft === Math.floor(DRAW_TIME * 0.5) || room.timeLeft === Math.floor(DRAW_TIME * 0.25)) {
    revealLetter(room);
  }
  io.to(room.code).emit('tick', { timeLeft: room.timeLeft, hint: maskedHint(room) });
  if (room.timeLeft <= 0) endTurn(room);
}

function endTurn(room) {
  if (room.state !== 'drawing') return;
  clearTimers(room);
  const d = room.players.find(p => p.id === room.drawerId);
  if (d) d.score += room.guessedCount * 25;
  room.state = 'reveal';
  io.to(room.code).emit('turnEnd', { word: room.word });
  broadcast(room);
  room.timer = setTimeout(() => nextTurn(room), 4000);
}

function endGame(room) {
  clearTimers(room);
  room.state = 'end';
  broadcast(room);
}

io.on('connection', socket => {
  socket.on('join', ({ name, room: code }, cb) => {
    name = String(name || '').trim().slice(0, 14) || 'Player';
    code = String(code || '').trim().toUpperCase();
    let room;
    if (!code) {
      code = makeCode();
      room = rooms[code] = {
        code, players: [], hostId: null, state: 'lobby', round: 0, drawerId: null,
        word: '', revealed: new Set(), strokes: [], queue: [], options: [],
        timeLeft: 0, guessedCount: 0
      };
    } else {
      room = rooms[code];
      if (!room) return cb({ error: 'Room not found' });
      if (room.players.length >= 10) return cb({ error: 'Room is full' });
    }
    socket.join(code);
    socket.roomCode = code;
    room.players.push({ id: socket.id, name, score: 0, guessed: false });
    if (!room.hostId) room.hostId = socket.id;
    cb({ ok: true, code });
    socket.emit('strokes', room.strokes);
    if (room.state === 'drawing') {
      socket.emit('tick', { timeLeft: room.timeLeft, hint: maskedHint(room) });
    }
    say(room, `${name} joined`);
    broadcast(room);
  });

  socket.on('start', () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.id !== room.hostId) return;
    if ((room.state === 'lobby' || room.state === 'end') && room.players.length >= 2) startGame(room);
  });

  socket.on('pickWord', word => {
    const room = rooms[socket.roomCode];
    if (!room || socket.id !== room.drawerId || !room.options.includes(word)) return;
    chooseWord(room, word);
  });

  socket.on('stroke', s => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'drawing' || socket.id !== room.drawerId) return;
    if (room.strokes.length < 30000) room.strokes.push(s);
    socket.to(room.code).emit('stroke', s);
  });

  socket.on('clear', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.state !== 'drawing' || socket.id !== room.drawerId) return;
    room.strokes = [];
    socket.to(room.code).emit('clear');
  });

  socket.on('guess', text => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const p = room.players.find(q => q.id === socket.id);
    if (!p) return;
    text = String(text || '').trim().slice(0, 60);
    if (!text) return;
    const isDrawer = socket.id === room.drawerId;

    if (room.state === 'drawing' && !isDrawer && !p.guessed &&
        text.toLowerCase() === room.word.toLowerCase()) {
      const pts = Math.round(50 + 150 * room.timeLeft / DRAW_TIME);
      p.score += pts;
      p.guessed = true;
      room.guessedCount++;
      say(room, `${p.name} guessed the word! +${pts}`, 'correct');
      broadcast(room);
      if (allGuessed(room)) endTurn(room);
      return;
    }

    const secret = room.state === 'drawing' && (isDrawer || p.guessed);
    if (secret) {
      room.players.filter(q => q.guessed || q.id === room.drawerId)
        .forEach(q => io.to(q.id).emit('chat', { name: p.name, text: '(guessed) ' + text, kind: 'msg' }));
    } else {
      io.to(room.code).emit('chat', { name: p.name, text, kind: 'msg' });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const leaving = room.players.find(p => p.id === socket.id);
    const wasDrawer = room.drawerId === socket.id;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) { clearTimers(room); delete rooms[room.code]; return; }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (leaving) say(room, `${leaving.name} left`);

    if (room.state === 'lobby' || room.state === 'end') return broadcast(room);
    if (room.players.length < 2) {
      clearTimers(room);
      room.state = 'lobby';
      say(room, 'Not enough players, back to the lobby');
      return broadcast(room);
    }
    if (wasDrawer && room.state === 'drawing') return endTurn(room);
    if (wasDrawer && room.state === 'choosing') return nextTurn(room);
    broadcast(room);
    if (room.state === 'drawing' && allGuessed(room)) endTurn(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Doodle Duel running on port ${PORT}`));
