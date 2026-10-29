import { openDatabase } from '../server/database.js';
import { Room } from '../server/room-manager.js';

export function memoryDb() {
  return openDatabase(':memory:');
}

/** A room without Socket.IO, with a controllable clock and RNG. */
export function testRoom({ mode = 'freeroam', pvp = true } = {}) {
  const db = memoryDb();
  const clock = { t: 1_000_000 };
  const room = new Room({ code: 'TEST', mode, pvp, isPublic: false, db, io: null, now: () => clock.t, rand: () => 0.5 });
  const sent = [];
  room.send = (p, event, data) => sent.push({ to: p.id, event, data });
  room.broadcast = (event, data) => sent.push({ to: '*', event, data });
  return { room, db, clock, sent };
}

export function addPlayer(ctx, name, pos) {
  const { player } = ctx.db.authenticate(null, name);
  const fakeSocket = { id: name, emit() {}, leave() {}, data: {} };
  const { player: p } = ctx.room.join(player, fakeSocket);
  if (pos) {
    p.pos = [...pos];
    p.lastValidPos = [...pos];
  }
  p.spawnProtectedUntil = 0;
  return p;
}

/** Mark challenges solved for a player through the real completion path. */
export function solve(ctx, p, ids) {
  for (const id of ids) {
    ctx.db.completeChallenge(p.id, id, 1, 1, '// test');
    p.progress.solved.add(id);
    p.progress.code[id] = '// test';
  }
  p.progress.recompute();
}
