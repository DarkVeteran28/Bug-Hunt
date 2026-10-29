// HTTP + Socket.IO entry point.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { openDatabase } from './database.js';
import { RoomManager } from './room-manager.js';
import { ChallengeManager } from './challenge-manager.js';
import { attachSocketHandlers, profileFor } from './socket-handler.js';
import { NET } from '../shared/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const nm = (p) => path.join(root, 'node_modules', p);

export function createGameServer({ dbFile = path.join(root, 'data', 'game.db'), runner } = {}) {
  const db = openDatabase(dbFile);
  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  const rooms = new RoomManager({ db, io });
  const challenges = new ChallengeManager(db, runner ? { runner } : {});
  attachSocketHandlers(io, { db, rooms, challenges });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Static client, shared modules and pinned vendor libraries (no CDN).
  app.use('/', express.static(path.join(root, 'client')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/three', express.static(nm('three/build')));
  app.use('/vendor/three-addons', express.static(nm('three/examples/jsm')));
  app.use('/vendor/rapier', express.static(nm('@dimforge/rapier3d-compat')));
  app.use('/vendor/monaco', express.static(nm('monaco-editor/min')));
  app.use('/vendor/socket.io', express.static(nm('socket.io-client/dist')));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size, players: [...rooms.rooms.values()].reduce((n, r) => n + r.players.size, 0) });
  });

  app.get('/api/rooms', (req, res) => res.json(rooms.listPublic()));

  app.get('/api/leaderboard', (req, res) => {
    const board = String(req.query.board || 'overall');
    const rows = db.leaderboard(board, 10);
    if (!rows) return res.status(400).json({ error: 'Unknown leaderboard.' });
    res.json({ board, rows });
  });

  app.get('/api/profile', (req, res) => {
    const token = req.get('x-player-token');
    if (!token) return res.status(401).json({ error: 'Missing token.' });
    const auth = db.authenticate(token, null);
    if (!auth.player) return res.status(401).json({ error: 'Unknown player.' });
    res.json({ name: auth.player.name, ...profileFor(db, auth.player.id) });
  });

  const tick = setInterval(() => rooms.tick(), 100);
  const snap = setInterval(() => rooms.snapshots(), Math.round(1000 / NET.snapshotHz));

  return {
    app,
    server,
    io,
    db,
    rooms,
    challenges,
    listen(port = 3000, host = '0.0.0.0') {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
    },
    async close() {
      clearInterval(tick);
      clearInterval(snap);
      await new Promise((resolve) => io.close(() => resolve()));
      db.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const game = createGameServer({ dbFile: process.env.DB_FILE || undefined });
  game.listen(port, process.env.HOST || '0.0.0.0').then((p) => {
    console.log(`Vice City: Bug Hunt 3D running at http://localhost:${p}`);
  });
  const shutdown = () => game.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
