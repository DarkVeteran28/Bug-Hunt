// Rooms hold independent game state: players, vehicles, combat and rounds.
// Movement from clients is validated here before anything else uses it.
import crypto from 'node:crypto';
import { PLAYER, VEHICLE, NET, MODES, WEAPONS, SCORING } from '../shared/config.js';
import { WORLD, VEHICLE_SPAWNS, dist2D } from '../shared/world-data.js';
import { CombatManager, freshLoadout } from './combat-manager.js';
import { MissionManager, freshMissionState } from './mission-manager.js';
import { Progress } from './progression.js';
import { rule } from './game-logic.js';
import { SHIELD_RANGE } from './challenge-manager.js';

const ANIMS = ['idle', 'walk', 'run', 'jump', 'drive'];
const WEAPON_IDS = Object.keys(WEAPONS);
const MAX_PLAYERS = 16;
const COLORS = ['#ff4fa3', '#4fe3ff', '#ffd23f', '#7dff6b', '#b84dff', '#ff7a2f', '#ffffff', '#ff5e5e'];

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function loadProgress(db, playerId) {
  const completions = db.completions(playerId);
  return new Progress(
    completions.map((c) => c.challenge_id),
    db.missions(playerId),
    Object.fromEntries(completions.map((c) => [c.challenge_id, c.code])),
  );
}

export class Room {
  constructor({ code, mode, pvp, isPublic, db, io, now, rand }) {
    const m = MODES[mode] || MODES.freeroam;
    this.code = code;
    this.isPublic = isPublic;
    this.db = db;
    this.io = io;
    this.now = now || Date.now;
    this.settings = {
      mode: m.id,
      modeName: m.name,
      pvp: pvp !== false,
      safeDebugging: m.safeDebugging,
      respawnDelayMs: PLAYER.respawnDelayMs,
      spawnProtectionMs: PLAYER.spawnProtectionMs,
      roundMs: m.roundMs,
    };
    this.players = new Map();
    this.vehicles = new Map(VEHICLE_SPAWNS.map((v, i) => [v.id, { id: v.id, index: i, pos: [...v.pos], ry: v.ry, driver: null, lastDrivenAt: 0 }]));
    this.combat = new CombatManager(this, { db, now: this.now, rand });
    this.missions = new MissionManager(db);
    this.killFeed = [];
    this.emptySince = this.now();
    this.round = this.settings.roundMs ? { id: 1, endsAt: this.now() + this.settings.roundMs } : null;
  }

  get channel() {
    return `room:${this.code}`;
  }

  broadcast(event, data) {
    if (this.io) this.io.to(this.channel).emit(event, data);
  }

  send(p, event, data) {
    if (p.socket && p.connected) p.socket.emit(event, data);
  }

  isShielded(p) {
    if (!this.settings.safeDebugging || !p.debugging || !p.debugStation) return false;
    return dist2D(p.pos, p.debugStation) <= SHIELD_RANGE;
  }

  info() {
    return {
      code: this.code,
      isPublic: this.isPublic,
      ...this.settings,
      roundEndsAt: this.round ? this.round.endsAt : null,
      players: this.players.size,
    };
  }

  /** Add or resume a player. Returns the player state or an error. */
  join(dbPlayer, socket) {
    const existing = this.players.get(dbPlayer.id);
    if (existing) {
      if (existing.socket && existing.socket !== socket && existing.connected) {
        existing.socket.emit('kicked', { reason: 'You joined from another tab or device.' });
        existing.socket.leave(this.channel);
        existing.socket.data.roomCode = null;
      }
      existing.socket = socket;
      existing.connected = true;
      existing.disconnectedAt = 0;
      return { player: existing, resumed: true };
    }
    if (this.players.size >= MAX_PLAYERS) return { error: 'Room is full.' };
    const t = this.now();
    const progress = loadProgress(this.db, dbPlayer.id);
    const p = {
      id: dbPlayer.id,
      name: dbPlayer.name,
      color: COLORS[dbPlayer.id % COLORS.length],
      socket,
      connected: true,
      disconnectedAt: 0,
      progress,
      pos: [0, 0, 0],
      lastValidPos: [0, 0, 0],
      lastMoveAt: t,
      ry: 0,
      pitch: 0,
      anim: 0,
      health: PLAYER.maxHealth,
      alive: true,
      respawnAt: 0,
      spawnProtectedUntil: 0,
      loadout: freshLoadout(),
      equipped: 'pistol',
      lastShotAt: {},
      lastCombatAt: 0,
      vehicleId: null,
      debugging: null,
      debugStation: null,
      violations: 0,
      missionState: freshMissionState(),
      session: { kills: 0, deaths: 0, bugPoints: 0, combatPoints: 0, otherPoints: 0 },
    };
    this.players.set(p.id, p);
    this.combat.respawn(p);
    p.spawnProtectedUntil = t + this.settings.spawnProtectionMs;
    this.emptySince = 0;
    return { player: p, resumed: false };
  }

  disconnect(p) {
    p.connected = false;
    p.disconnectedAt = this.now();
    if (p.vehicleId) this.releaseVehicle(p);
  }

  remove(p) {
    if (p.vehicleId) this.releaseVehicle(p);
    this.players.delete(p.id);
    if (!this.players.size) this.emptySince = this.now();
  }

  correction(p, reason) {
    p.violations++;
    this.send(p, 'correction', { p: p.lastValidPos, reason });
  }

  /** Validate a client movement update. Returns true if accepted. */
  handleState(p, msg) {
    if (!p.alive || !msg || !Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) return false;
    const t = this.now();
    const dt = Math.min(2, Math.max(0.001, (t - p.lastMoveAt) / 1000));
    const [x, y, z] = msg.p;

    if (y < WORLD.killY) {
      // Fell out of the world: respawn without counting a death.
      const pos = this.combat.respawn(p);
      if (p.vehicleId) this.releaseVehicle(p);
      this.send(p, 'respawn', { p: pos, reason: 'fell' });
      return false;
    }

    const maxSpeed = p.vehicleId ? VEHICLE.maxSpeed * 1.15 : PLAYER.sprintSpeed;
    const horiz = Math.hypot(x - p.lastValidPos[0], z - p.lastValidPos[2]);
    const allowed = maxSpeed * NET.speedTolerance * dt + 1.5;
    if (horiz > allowed) {
      this.correction(p, 'speed');
      return false;
    }
    if (y > 32 || Math.abs(y - p.lastValidPos[1]) > 30 * dt + 2.5) {
      this.correction(p, 'height');
      return false;
    }
    if (x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ) {
      this.correction(p, 'bounds');
      return false;
    }
    const next = [x, y, z];
    if (!p.progress.positionAllowed(next)) {
      this.correction(p, 'locked');
      return false;
    }
    p.pos = next;
    p.lastValidPos = [...next];
    p.lastMoveAt = t;
    if (Number.isFinite(msg.ry)) p.ry = msg.ry;
    if (Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
    const anim = ANIMS.indexOf(msg.anim);
    p.anim = anim < 0 ? 0 : anim;
    if (p.vehicleId) {
      const v = this.vehicles.get(p.vehicleId);
      v.pos = [...next];
      if (Number.isFinite(msg.ry)) v.ry = msg.ry;
      v.lastDrivenAt = t;
    }
    for (const e of this.missions.onPosition(p)) this.sendMissionEvent(p, e);
    return true;
  }

  sendMissionEvent(p, e) {
    this.send(p, 'mission', e);
    if (e.type === 'mission-complete' || e.type === 'city-cleared') {
      this.send(p, 'progress', p.progress.toJSON());
      this.send(p, 'missions', this.missions.view(p));
      this.sendScore(p);
      if (e.type === 'city-cleared') this.broadcast('announce', { text: `${p.name} cleared Vice City!` });
    } else if (e.type === 'mission-step') {
      this.send(p, 'missions', this.missions.view(p));
    }
  }

  enterVehicle(p, vehicleId) {
    const v = this.vehicles.get(vehicleId);
    if (!v) return { ok: false, error: 'No such vehicle.' };
    const solved = p.progress.isSolved('broken-car');
    const playerView = { position: { x: p.pos[0], y: p.pos[1], z: p.pos[2] }, alive: p.alive, inVehicle: !!p.vehicleId };
    const vehicleView = { position: { x: v.pos[0], y: v.pos[1], z: v.pos[2] }, driver: v.driver };
    // Unsolved players run the seeded buggy rule (always refuses), but even a
    // solved player must also pass the approved rule.
    if (!solved) return { ok: false, error: 'The door is jammed. Fix the Broken Car challenge on Ocean Drive.' };
    if (!rule('broken-car', solved, playerView, vehicleView, VEHICLE.enterRange)) {
      return { ok: false, error: v.driver ? 'Someone is already driving that car.' : 'Get closer to the car.' };
    }
    v.driver = p.id;
    v.lastDrivenAt = this.now();
    p.vehicleId = v.id;
    p.debugging = null;
    p.debugStation = null;
    return { ok: true, vehicleId: v.id };
  }

  releaseVehicle(p) {
    const v = this.vehicles.get(p.vehicleId);
    if (v && v.driver === p.id) v.driver = null;
    p.vehicleId = null;
  }

  exitVehicle(p) {
    if (!p.vehicleId) return { ok: false };
    const v = this.vehicles.get(p.vehicleId);
    this.releaseVehicle(p);
    // Step out to the driver side.
    const side = [Math.cos(v.ry) * 2.2, 0, -Math.sin(v.ry) * 2.2];
    const out = [v.pos[0] + side[0], Math.max(0, v.pos[1]), v.pos[2] + side[2]];
    if (p.progress.positionAllowed(out)) {
      p.pos = out;
      p.lastValidPos = [...out];
    }
    return { ok: true, p: p.pos };
  }

  sendScore(p) {
    const totals = this.db.totals(p.id);
    this.send(p, 'score', { totals, session: p.session, rank: this.db.rank(p.id) });
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      kills: p.session.kills,
      deaths: p.session.deaths,
      bugPoints: p.session.bugPoints,
      combatPoints: p.session.combatPoints,
      otherPoints: p.session.otherPoints,
      bugsFixed: p.progress.solved.size,
      weapon: p.equipped,
    }));
  }

  snapshotFor(recipient, entries) {
    const r = NET.interestRadius;
    return entries.filter((e) => e[0] === recipient.id || Math.hypot(e[1] - recipient.pos[0], e[3] - recipient.pos[2]) <= r);
  }

  tick() {
    const t = this.now();
    for (const p of [...this.players.values()]) {
      if (!p.connected && t - p.disconnectedAt > PLAYER.disconnectGraceMs) {
        this.remove(p);
        this.broadcast('player-left', { id: p.id, name: p.name });
        continue;
      }
      if (!p.alive && p.respawnAt && t >= p.respawnAt) {
        const pos = this.combat.respawn(p);
        this.send(p, 'respawn', { p: pos, health: p.health, loadout: WEAPON_IDS.map((w) => this.combat.ammoView(p, w)) });
      }
    }
    for (const v of this.vehicles.values()) {
      const spawn = VEHICLE_SPAWNS[v.index];
      if (!v.driver && v.lastDrivenAt && t - v.lastDrivenAt > 90_000 && dist2D(v.pos, spawn.pos) > 3) {
        v.pos = [...spawn.pos];
        v.ry = spawn.ry;
        v.lastDrivenAt = 0;
      }
    }
    if (this.round && t >= this.round.endsAt) this.endRound();
  }

  endRound() {
    const standings = this.roster()
      .map((r) => ({ ...r, total: r.bugPoints + r.combatPoints + r.otherPoints }))
      .sort((a, b) => b.total - a.total);
    const winner = standings[0] && standings[0].total > 0 ? standings[0] : null;
    if (winner) {
      const paid = this.db.award(winner.id, 'arena', `round:${this.code}:${this.round.id}:${this.round.endsAt}`, SCORING.arenaRoundWin);
      const wp = this.players.get(winner.id);
      if (paid && wp) this.sendScore(wp);
    }
    this.broadcast('round-end', { roundId: this.round.id, winner: winner ? { id: winner.id, name: winner.name, total: winner.total } : null, reward: SCORING.arenaRoundWin, standings: standings.slice(0, 10) });
    for (const p of this.players.values()) p.session = { kills: 0, deaths: 0, bugPoints: 0, combatPoints: 0, otherPoints: 0 };
    this.round = { id: this.round.id + 1, endsAt: this.now() + this.settings.roundMs };
    this.broadcast('room-info', this.info());
  }

  broadcastSnapshot() {
    const t = this.now();
    const entries = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      const flags = (p.alive ? 1 : 0) | (this.isShielded(p) ? 2 : 0) | (p.spawnProtectedUntil > t ? 4 : 0);
      entries.push([p.id, round2(p.pos[0]), round2(p.pos[1]), round2(p.pos[2]), round2(p.ry), round2(p.pitch), flags, p.anim,
        WEAPON_IDS.indexOf(p.equipped), p.vehicleId ? this.vehicles.get(p.vehicleId).index : -1, p.health]);
    }
    const vehicles = [...this.vehicles.values()].map((v) => [v.index, round2(v.pos[0]), round2(v.pos[1]), round2(v.pos[2]), round2(v.ry), v.driver || 0]);
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      this.send(p, 's', { t, p: this.snapshotFor(p, entries), v: vehicles });
    }
  }
}

export class RoomManager {
  constructor({ db, io, now, rand }) {
    this.db = db;
    this.io = io;
    this.now = now || Date.now;
    this.rand = rand;
    this.rooms = new Map();
    for (const mode of Object.keys(MODES)) {
      const code = `PUBLIC-${mode.toUpperCase()}`;
      this.rooms.set(code, new Room({ code, mode, pvp: true, isPublic: true, db, io, now: this.now, rand }));
    }
  }

  publicRoom(mode) {
    return this.rooms.get(`PUBLIC-${(MODES[mode] ? mode : 'freeroam').toUpperCase()}`);
  }

  createPrivate({ mode, pvp }) {
    let code;
    do code = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    while (this.rooms.has(code));
    const room = new Room({ code, mode: MODES[mode] ? mode : 'freeroam', pvp: pvp !== false, isPublic: false, db: this.db, io: this.io, now: this.now, rand: this.rand });
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  listPublic() {
    return [...this.rooms.values()].filter((r) => r.isPublic).map((r) => r.info());
  }

  tick() {
    const t = this.now();
    for (const [code, room] of this.rooms) {
      room.tick();
      if (!room.isPublic && !room.players.size && room.emptySince && t - room.emptySince > 5 * 60_000) this.rooms.delete(code);
    }
  }

  snapshots() {
    for (const room of this.rooms.values()) if (room.players.size) room.broadcastSnapshot();
  }
}
