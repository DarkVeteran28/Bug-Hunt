// One single-player game: the player, their records, missions, bug
// challenges, weapons, enemies and pickups. Runs entirely in the browser
// (and in Node for tests). The page (client/src/game.js) renders it and
// feeds it input; this module decides what happens.
//
// Time: `clockMs` only advances in update(), so pausing the game pauses
// enemies, respawn timers, reloads and pickups.
import { PLAYER, VEHICLE, WEAPONS, SCORING } from '../shared/config.js';
import { SPAWNS, DISTRICTS, districtIndexAt, dist2D, WORLD } from '../shared/world-data.js';
import { CHALLENGE_LIST, publicChallenge } from '../challenges/index.js';
import { Progress } from './progression.js';
import { MissionManager, freshMissionState } from './missions.js';
import { ChallengeManager, rewardFor, SHIELD_RANGE } from './challenges.js';
import { Weapons, freshLoadout } from './combat.js';
import { EnemyDirector, ENEMY } from './enemies.js';
import { Pickups, PICKUP, CHIP_COUNT } from './pickups.js';
import { GameStore, freshStoreData } from './store.js';
import { rule } from './game-logic.js';

const WEAPON_IDS = Object.keys(WEAPONS);
export const START_POS = Object.freeze([...SPAWNS[0]]);

export function loadProgress(store) {
  const completions = store.completions();
  return new Progress(
    completions.map((c) => c.challenge_id),
    store.missions(),
    Object.fromEntries(completions.map((c) => [c.challenge_id, c.code])),
  );
}

export class GameSession {
  /**
   * @param {object} opts
   *   state   restored game state from engine/save.js (or null for a new game)
   *   runner  challenge test runner (browser: Web Worker)
   *   rand    random source (tests pass a seeded one)
   *   wallNow wall-clock for records (default Date.now)
   */
  constructor({ state = null, runner, rand = Math.random, wallNow = Date.now } = {}) {
    this.rand = rand;
    this.clockMs = state ? state.clockMs : 0;
    this.listeners = new Map();
    this.now = () => this.clockMs;
    this.store = new GameStore(state ? state.store : freshStoreData(), { now: wallNow });
    const progress = loadProgress(this.store);
    const p = state ? state.player : null;
    this.player = {
      id: 1,
      name: 'You',
      pos: p ? [...p.pos] : [...START_POS],
      lastValidPos: p ? [...p.pos] : [...START_POS],
      ry: p ? p.ry : 0,
      speed: 0,
      health: p ? p.health : PLAYER.maxHealth,
      alive: true,
      respawnAt: 0,
      spawnProtectedUntil: p ? 0 : PLAYER.spawnProtectionMs,
      loadout: p ? p.loadout : freshLoadout(),
      equipped: p && progress.weapons.includes(p.equipped) ? p.equipped : 'pistol',
      lastShotAt: {},
      lastCombatAt: 0,
      vehicleId: null,
      debugging: null,
      debugStation: null,
      progress,
      missionState: state ? state.missionState : freshMissionState(),
      session: { kills: 0, deaths: 0, bugPoints: 0, combatPoints: 0, otherPoints: 0 },
      lastBy: null,
    };
    this.missions = new MissionManager(this.store);
    this.challenges = new ChallengeManager(this.store, runner ? { runner, now: wallNow } : { now: wallNow });
    // Combat timestamps use the game clock (it stops while paused).
    this.challenges.combatNow = this.now;
    this.weapons = new Weapons({ now: this.now, rand });
    this.enemies = new EnemyDirector({
      now: this.now,
      rand,
      canTarget: () => this.player.alive && !this.isShielded() && this.player.spawnProtectedUntil <= this.clockMs,
      openGates: () => this.player.progress.toJSON().gates,
      onShootPlayer: (e, hit, damage) => this.enemyShot(e, hit, damage),
    }, state ? state.enemies : null);
    this.pickups = new Pickups({ now: this.now });
    this.killSeq = state ? state.killSeq || 0 : 0;
    // Parked car positions [[x, y, z, ry], ...] in VEHICLE_SPAWNS order. The
    // page drives the cars and keeps this current; it is stored in saves.
    this.vehiclePoses = state && Array.isArray(state.vehicles) ? state.vehicles : null;
  }

  // ---- Events ---------------------------------------------------------------------

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  emit(event, data) {
    for (const fn of this.listeners.get(event) || []) fn(data);
  }

  // ---- Views for the page -----------------------------------------------------------

  challengeList() {
    return CHALLENGE_LIST.map((c) => publicChallenge(c, rewardFor(c)));
  }

  progressView() {
    return this.player.progress.toJSON();
  }

  missionsView() {
    return this.missions.view(this.player);
  }

  scoreView() {
    return { totals: this.store.totals(), session: this.player.session };
  }

  loadoutView() {
    return WEAPON_IDS.map((w) => this.weapons.view(this.player, w));
  }

  statsView() {
    const s = this.store.stats();
    const a = this.store.attemptStats();
    const completions = this.store.completions();
    return {
      totals: this.store.totals(),
      kills: s.kills,
      deaths: s.deaths,
      hintsUsed: s.hintsUsed,
      bugsFixed: completions.length,
      bugsTotal: CHALLENGE_LIST.length,
      assistedFixes: completions.filter((c) => c.assisted).length,
      testRuns: a.total,
      accuracy: a.total ? Math.round((a.passed / a.total) * 100) : null,
      missionsCompleted: this.store.missions().length,
      missionsTotal: this.missions.view(this.player).length,
      chips: this.store.collected().filter((id) => id.startsWith('chip-')).length,
      chipsTotal: CHIP_COUNT,
      history: this.store.history(8),
    };
  }

  enemiesView() {
    return this.enemies.view();
  }

  pickupsView() {
    return this.pickups.view(this.store.collected());
  }

  isShielded() {
    const p = this.player;
    return !!(p.debugging && p.debugStation && dist2D(p.pos, p.debugStation) <= SHIELD_RANGE);
  }

  // ---- Simulation ---------------------------------------------------------------------

  update(dt) {
    dt = Math.max(0, Math.min(0.1, dt));
    this.clockMs += dt * 1000;
    const p = this.player;
    if (!p.alive && this.clockMs >= p.respawnAt) this.respawn();
    this.enemies.update(dt, p);
    // Tell the page when a reload finishes.
    for (const w of WEAPON_IDS) {
      const st = p.loadout[w];
      if (st.reloadUntil && this.clockMs >= st.reloadUntil) this.emit('ammo', this.weapons.view(p, w));
    }
  }

  /**
   * The page moved the player (or the car they drive). Locked districts and
   * the closed vault are refused, like a wall. Returns { ok } or { correction, reason }.
   */
  setPosition(pos, { ry = this.player.ry, speed = 0 } = {}) {
    const p = this.player;
    if (!p.alive || !Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return { ok: false };
    if (pos[1] < WORLD.killY) {
      this.respawn('fell');
      return { ok: false, respawned: true };
    }
    if (!p.progress.positionAllowed(pos)) {
      this.emit('mission', { type: 'error', message: "That area is locked. Fix the district's gate bug first." });
      return { ok: false, correction: [...p.lastValidPos], reason: 'locked' };
    }
    p.pos = [...pos];
    p.lastValidPos = [...pos];
    p.ry = ry;
    p.speed = speed;
    for (const e of this.missions.onPosition(p)) this.missionEvent(e);
    this.checkPickups();
    return { ok: true };
  }

  checkPickups() {
    const p = this.player;
    if (p.vehicleId) return;
    for (const item of this.pickups.touching(p.pos, this.store.collected())) {
      if (item.kind === 'chip') {
        if (this.store.collect(item.id, PICKUP.chipPoints)) {
          p.session.otherPoints += PICKUP.chipPoints;
          this.emit('pickup', { kind: 'chip', id: item.id, points: PICKUP.chipPoints, count: this.statsView().chips, total: CHIP_COUNT });
          this.emit('score', this.scoreView());
          this.emit('autosave', 'chip');
        }
      } else if (item.kind === 'medkit') {
        if (p.health >= PLAYER.maxHealth) continue;
        p.health = Math.min(PLAYER.maxHealth, p.health + PICKUP.medkitHeal);
        this.pickups.take(item);
        this.emit('pickup', { kind: 'medkit', id: item.id, health: p.health });
      } else if (item.kind === 'ammo') {
        let refilled = false;
        for (const w of p.progress.weapons) {
          const st = p.loadout[w];
          const max = WEAPONS[w].reserve;
          if (st.reserve < max) {
            st.reserve = max;
            refilled = true;
          }
        }
        if (!refilled) continue;
        this.pickups.take(item);
        this.emit('pickup', { kind: 'ammo', id: item.id });
        for (const w of p.progress.weapons) this.emit('ammo', this.weapons.view(p, w));
      }
    }
  }

  missionEvent(e) {
    this.emit('mission', e);
    if (e.type === 'mission-complete' || e.type === 'city-cleared') {
      this.emit('progress', this.progressView());
      this.emit('missions', this.missionsView());
      this.emit('score', this.scoreView());
      this.emit('autosave', 'mission');
    } else if (e.type === 'mission-step') {
      this.emit('missions', this.missionsView());
    }
  }

  // ---- Combat ---------------------------------------------------------------------------

  fire(msg) {
    const p = this.player;
    if (this.isShielded()) return { ok: false, reason: 'debugging' };
    const targets = this.enemies.enemies;
    const r = this.weapons.fire(p, msg, targets, p.progress.toJSON().gates);
    if (!r.ok) return r;
    this.store.data.stats.shots++;
    const hits = [];
    for (const [enemy, dmg] of r.damageByTarget) {
      const d = this.enemies.damage(enemy, dmg);
      this.store.data.stats.hits++;
      hits.push({ id: enemy.id, damage: dmg, killed: d.killed, health: d.health });
      if (d.killed) {
        this.killSeq++;
        this.store.addKill();
        p.session.kills++;
        const paid = this.store.award(null, 'combat', `kill:${enemy.id}:${this.killSeq}`, ENEMY.points);
        if (paid) p.session.combatPoints += ENEMY.points;
        this.emit('kill', { killerName: 'You', victimName: enemy.name, weapon: msg.weapon, points: paid ? ENEMY.points : 0, mine: true });
        this.emit('score', this.scoreView());
      }
    }
    return { ok: true, origin: r.origin, tracers: r.tracers, hits, ammo: r.ammo };
  }

  enemyShot(enemy, hit, damage) {
    const p = this.player;
    const origin = [enemy.pos[0], 1.5, enemy.pos[2]];
    const aim = [p.pos[0] + (hit ? 0 : (this.rand() - 0.5) * 3), p.pos[1] + 1.2 + (hit ? 0 : (this.rand() - 0.3) * 2), p.pos[2] + (hit ? 0 : (this.rand() - 0.5) * 3)];
    this.emit('enemy-shot', { id: enemy.id, from: origin, to: aim, hit });
    if (!hit || !p.alive) return;
    p.health = Math.max(0, p.health - damage);
    p.lastCombatAt = this.clockMs;
    this.emit('damaged', { by: enemy.id, byName: enemy.name, damage, health: p.health, from: origin });
    if (p.health <= 0) this.playerDown(enemy);
  }

  playerDown(enemy) {
    const p = this.player;
    p.alive = false;
    p.respawnAt = this.clockMs + PLAYER.respawnDelayMs;
    p.vehicleId = null;
    p.session.deaths++;
    this.store.addDeath();
    this.enemies.calm();
    this.emit('kill', { killerName: enemy ? enemy.name : 'The city', victimName: 'You', weapon: 'pistol', points: 0, victimIsMe: true });
    this.emit('player-down', { by: enemy ? enemy.name : null, respawnInMs: PLAYER.respawnDelayMs });
  }

  /** Respawn at the nearest safe spawn point in an unlocked district. */
  respawn(reason = 'down') {
    const p = this.player;
    const allowed = SPAWNS.filter((s) => p.progress.districts.includes(DISTRICTS[districtIndexAt(s[0])].id));
    const threats = this.enemies.enemies.filter((e) => e.alive);
    const safe = allowed.filter((s) => !threats.some((e) => dist2D(e.pos, s) < 30));
    const pool = safe.length ? safe : allowed;
    let best = pool[0];
    let bestD = Infinity;
    for (const s of pool) {
      const d = dist2D(s, p.pos);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    p.alive = true;
    p.health = PLAYER.maxHealth;
    p.loadout = freshLoadout();
    p.lastShotAt = {};
    p.vehicleId = null;
    p.pos = [...best];
    p.lastValidPos = [...best];
    p.respawnAt = 0;
    p.spawnProtectedUntil = this.clockMs + PLAYER.spawnProtectionMs;
    this.emit('respawn', { p: p.pos, health: p.health, loadout: this.loadoutView(), reason });
    return p.pos;
  }

  reload(weapon) {
    const r = this.weapons.reload(this.player, weapon);
    return r;
  }

  equip(weapon) {
    if (!WEAPONS[weapon] || !this.player.progress.weapons.includes(weapon)) return false;
    this.player.equipped = weapon;
    return true;
  }

  // ---- Vehicles and NPCs ------------------------------------------------------------------

  /** vehicle: { id, pos: [x, y, z], driver: null } as the page sees it. */
  enterVehicle(vehicle) {
    const p = this.player;
    if (!vehicle) return { ok: false, error: 'No such vehicle.' };
    const solved = p.progress.isSolved('broken-car');
    const playerView = { position: { x: p.pos[0], y: p.pos[1], z: p.pos[2] }, alive: p.alive, inVehicle: !!p.vehicleId };
    const vehicleView = { position: { x: vehicle.pos[0], y: vehicle.pos[1], z: vehicle.pos[2] }, driver: vehicle.driver || null };
    if (!rule('broken-car', solved, playerView, vehicleView, VEHICLE.enterRange)) {
      return { ok: false, error: solved ? 'Get closer to the car.' : 'The door is jammed. Debug the Broken Car challenge to fix car doors.' };
    }
    p.vehicleId = vehicle.id;
    return { ok: true };
  }

  exitVehicle() {
    this.player.vehicleId = null;
    return { ok: true };
  }

  talk(npcId) {
    for (const e of this.missions.talk(this.player, npcId)) this.missionEvent(e);
    return { ok: true };
  }

  // ---- Bug challenges ------------------------------------------------------------------------

  openChallenge(id) {
    return this.challenges.open(this.player, String(id));
  }

  closeChallenge() {
    this.challenges.close(this.player);
  }

  saveDraft(id, code) {
    return this.challenges.saveDraft(this.player, String(id), code);
  }

  hint(id) {
    return this.challenges.hint(this.player, String(id));
  }

  solution(id) {
    return this.challenges.solution(this.player, String(id));
  }

  runTests(id, code) {
    return this.challenges.run(this.player, String(id), code);
  }

  applyFix(id) {
    const r = this.challenges.apply(this.player, String(id));
    if (r.ok) {
      this.emit('progress', this.progressView());
      this.emit('missions', this.missionsView());
      this.emit('score', this.scoreView());
      if (r.awarded) this.emit('autosave', 'bug');
    }
    return r;
  }

  // ---- Saving ------------------------------------------------------------------------------------

  /** Everything needed to continue this game later (see engine/save.js). */
  snapshot() {
    const p = this.player;
    // A save made while down puts you back at your respawn point at full health.
    const pos = p.alive ? p.lastValidPos : p.pos;
    const loadout = {};
    for (const w of WEAPON_IDS) {
      const st = this.weapons.state(p, w);
      loadout[w] = { ammo: st.ammo, reserve: st.reserve, reloadUntil: 0 };
    }
    return {
      clockMs: Math.round(this.clockMs),
      killSeq: this.killSeq,
      player: { pos: pos.map((v) => Math.round(v * 100) / 100), ry: Math.round(p.ry * 1000) / 1000, health: p.alive ? p.health : PLAYER.maxHealth, equipped: p.equipped, loadout },
      missionState: JSON.parse(JSON.stringify(p.missionState)),
      store: JSON.parse(JSON.stringify(this.store.toJSON())),
      enemies: this.enemies.serialize(this.clockMs),
      vehicles: this.vehiclePoses ? this.vehiclePoses.map((v) => v.map((n) => Math.round(n * 100) / 100)) : null,
    };
  }
}

export { SCORING };
