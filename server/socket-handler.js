// Socket.IO wiring. Every inbound event is rate limited and shape-checked
// before it reaches game logic. Nothing a client sends is trusted as a
// result: clients send intents (move, fire, open, run tests), the server
// decides outcomes.
import { WEAPONS, MODES } from '../shared/config.js';
import { STATIONS, MISSION_NPCS } from '../shared/world-data.js';
import { CHALLENGE_LIST, publicChallenge } from '../challenges/index.js';
import { STATION_RANGE, rewardFor } from './challenge-manager.js';

const NAME_RE = /^[A-Za-z0-9_ -]{3,16}$/;
const WEAPON_IDS = Object.keys(WEAPONS);

function bucket(ratePerSec, burst) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const t = Date.now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * ratePerSec);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function profileFor(db, playerId) {
  const totals = db.totals(playerId);
  const stats = db.stats(playerId);
  const attempts = db.attemptStats(playerId);
  const completions = db.completions(playerId);
  const missions = db.missions(playerId);
  return {
    totals,
    kills: stats.kills,
    deaths: stats.deaths,
    kd: Math.round((stats.kills / Math.max(1, stats.deaths)) * 100) / 100,
    bugsFixed: completions.length,
    bugsTotal: CHALLENGE_LIST.length,
    accuracy: attempts.total ? Math.round((attempts.passed / attempts.total) * 100) : null,
    attempts: attempts.total,
    fastestMs: completions.length ? Math.min(...completions.map((c) => c.solve_ms)) : null,
    missionsCompleted: missions.length,
    rank: db.rank(playerId),
    history: db.history(playerId, 10),
  };
}

export function attachSocketHandlers(io, { db, rooms, challenges }) {
  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const name = typeof auth.name === 'string' ? auth.name.trim() : '';
    if (!auth.token && !NAME_RE.test(name)) {
      socket.emit('fatal', { error: 'Names must be 3-16 letters, numbers, spaces, - or _.' });
      socket.disconnect(true);
      return;
    }
    const result = db.authenticate(typeof auth.token === 'string' ? auth.token.slice(0, 100) : null, name);
    if (result.error) {
      socket.emit('fatal', { error: result.error });
      socket.disconnect(true);
      return;
    }
    const dbPlayer = result.player;
    socket.data.playerId = dbPlayer.id;
    socket.emit('welcome', { token: result.token, id: dbPlayer.id, name: dbPlayer.name, profile: profileFor(db, dbPlayer.id), rooms: rooms.listPublic(), challenges: CHALLENGE_LIST.map((c) => publicChallenge(c, rewardFor(c))) });

    const limits = {
      state: bucket(30, 40),
      fire: bucket(20, 20),
      action: bucket(10, 20),
      draft: bucket(2, 5),
    };

    const current = () => {
      const room = rooms.get(socket.data.roomCode);
      const p = room && room.players.get(dbPlayer.id);
      if (!room || !p || p.socket !== socket) return [null, null];
      return [room, p];
    };

    const reply = (ack, data) => {
      if (typeof ack === 'function') ack(data);
    };

    socket.on('room:join', (msg, ack) => {
      if (!limits.action()) return reply(ack, { ok: false, error: 'Too many requests.' });
      msg = msg && typeof msg === 'object' ? msg : {};
      let room;
      if (msg.create) {
        room = rooms.createPrivate({ mode: MODES[msg.create.mode] ? msg.create.mode : 'freeroam', pvp: msg.create.pvp !== false });
      } else if (msg.code && msg.code !== 'public') {
        room = rooms.get(msg.code);
        if (!room) return reply(ack, { ok: false, error: 'No room with that code.' });
      } else {
        room = rooms.publicRoom(msg.mode);
      }
      // Leave any previous room.
      const prev = rooms.get(socket.data.roomCode);
      if (prev && prev !== room) {
        const pp = prev.players.get(dbPlayer.id);
        if (pp) {
          prev.remove(pp);
          prev.broadcast('player-left', { id: pp.id, name: pp.name });
        }
        socket.leave(prev.channel);
      }
      const joined = room.join(dbPlayer, socket);
      if (joined.error) return reply(ack, { ok: false, error: joined.error });
      const p = joined.player;
      socket.data.roomCode = room.code;
      socket.join(room.channel);
      reply(ack, {
        ok: true,
        resumed: joined.resumed,
        room: room.info(),
        you: { id: p.id, name: p.name, color: p.color, pos: p.pos, health: p.health, alive: p.alive, equipped: p.equipped, vehicleId: p.vehicleId },
        progress: p.progress.toJSON(),
        missions: room.missions.view(p),
        loadout: WEAPON_IDS.map((w) => room.combat.ammoView(p, w)),
        roster: room.roster(),
        killFeed: room.killFeed.slice(-6),
      });
      room.sendScore(p);
      if (!joined.resumed) room.broadcast('player-joined', { id: p.id, name: p.name, color: p.color });
      room.broadcast('roster', room.roster());
    });

    socket.on('state', (msg) => {
      if (!limits.state()) return;
      const [room, p] = current();
      if (room) room.handleState(p, msg);
    });

    socket.on('fire', (msg) => {
      if (!limits.fire()) return;
      const [room, p] = current();
      if (!room) return;
      const r = room.combat.fire(p, msg);
      if (!r.ok) {
        room.send(p, 'fire-rejected', { reason: r.reason, ammo: WEAPONS[msg && msg.weapon] && p.progress.weapons.includes(msg.weapon) ? room.combat.ammoView(p, msg.weapon) : null });
        return;
      }
      room.send(p, 'ammo', r.ammo);
      room.broadcast('shot', { id: p.id, weapon: msg.weapon, o: r.origin, e: r.tracers });
      for (const h of r.hits) {
        const target = room.players.get(h.targetId);
        room.send(p, 'hit-confirm', { target: h.targetId, damage: h.damage, killed: h.killed });
        room.send(target, 'damaged', { by: p.id, byName: p.name, damage: h.damage, health: h.health, from: r.origin });
        if (h.killed) {
          room.killFeed.push(h.kill);
          if (room.killFeed.length > 20) room.killFeed.shift();
          room.broadcast('kill', h.kill);
          room.sendScore(p);
          room.sendScore(target);
          room.broadcast('roster', room.roster());
        }
      }
    });

    socket.on('reload', (msg) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg || !WEAPONS[msg.weapon]) return;
      const r = room.combat.reload(p, msg.weapon);
      if (r.ammo) room.send(p, 'ammo', r.ammo);
    });

    socket.on('equip', (msg) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg || !WEAPONS[msg.weapon] || !p.progress.weapons.includes(msg.weapon)) return;
      p.equipped = msg.weapon;
      room.send(p, 'ammo', room.combat.ammoView(p, msg.weapon));
    });

    socket.on('vehicle:enter', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false });
      const r = room.enterVehicle(p, String(msg.id));
      reply(ack, r);
    });

    socket.on('vehicle:exit', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room) return reply(ack, { ok: false });
      reply(ack, room.exitVehicle(p));
    });

    socket.on('talk', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg || !MISSION_NPCS.some((n) => n.id === msg.npc)) return reply(ack, { ok: false });
      const events = room.missions.talk(p, msg.npc);
      for (const e of events) room.sendMissionEvent(p, e);
      reply(ack, { ok: true });
    });

    socket.on('challenge:open', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false, error: 'Join a room first.' });
      reply(ack, challenges.open(p, String(msg.id)));
    });

    socket.on('challenge:close', () => {
      const [room, p] = current();
      if (room) challenges.close(p);
    });

    socket.on('challenge:draft', (msg) => {
      if (!limits.draft()) return;
      const [room, p] = current();
      if (room && msg) challenges.saveDraft(p, String(msg.id), msg.code);
    });

    socket.on('challenge:hint', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false });
      reply(ack, challenges.hint(p, String(msg.id)));
    });

    socket.on('challenge:solution', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false, error: 'Join a room first.' });
      reply(ack, challenges.solution(p, String(msg.id)));
    });

    socket.on('challenge:run', async (msg, ack) => {
      if (!limits.action()) return reply(ack, { ok: false, error: 'Too many requests.' });
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false, error: 'Join a room first.' });
      try {
        reply(ack, await challenges.run(p, String(msg.id), msg.code));
      } catch (e) {
        reply(ack, { ok: false, error: 'The test runner failed. Try again.' });
      }
    });

    socket.on('challenge:apply', (msg, ack) => {
      if (!limits.action()) return;
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false, error: 'Join a room first.' });
      const r = challenges.apply(p, String(msg.id));
      reply(ack, r);
      if (r.ok) {
        room.send(p, 'progress', p.progress.toJSON());
        room.send(p, 'missions', room.missions.view(p));
        room.sendScore(p);
        room.broadcast('roster', room.roster());
        if (r.awarded) room.broadcast('announce', { text: `${p.name} fixed ${r.title} (+${r.awarded})` });
      }
    });

    socket.on('station:check', (msg, ack) => {
      // Lets the client ask whether a station is in range (purely informational).
      const [room, p] = current();
      if (!room || !msg) return reply(ack, { ok: false });
      const st = STATIONS.find((s) => s.challengeId === msg.id);
      reply(ack, { ok: !!st, inRange: !!st && Math.hypot(st.pos[0] - p.pos[0], st.pos[2] - p.pos[2]) <= STATION_RANGE });
    });

    socket.on('profile', (msg, ack) => {
      if (!limits.action()) return;
      reply(ack, profileFor(db, dbPlayer.id));
    });

    socket.on('disconnect', () => {
      const [room, p] = current();
      if (room) {
        room.disconnect(p);
        room.broadcast('roster', room.roster());
      }
    });
  });
}

