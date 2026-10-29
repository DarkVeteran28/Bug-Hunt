// Server-authoritative combat. Clients only say "I pulled the trigger with
// weapon W, aiming along direction D". The server decides the origin (from
// the player's validated position), enforces ownership, cooldown, ammo,
// reload, range, line of sight and spawn protection, and applies damage.
import { WEAPONS, PLAYER, SCORING } from '../shared/config.js';
import { getWorld, rayAabb, SPAWNS, districtIndexAt, DISTRICTS } from '../shared/world-data.js';

const HITBOX_HALF = 0.45;
const HITBOX_HEIGHT = 1.85;
const VEHICLE_HALF = 1.4;

export function freshLoadout() {
  const out = {};
  for (const w of Object.values(WEAPONS)) out[w.id] = { ammo: w.magSize, reserve: w.reserve, reloadUntil: 0 };
  return out;
}

export function playerHitbox(p) {
  const [x, y, z] = p.pos;
  if (p.vehicleId) return { min: [x - VEHICLE_HALF, y, z - VEHICLE_HALF], max: [x + VEHICLE_HALF, y + 1.7, z + VEHICLE_HALF] };
  return { min: [x - HITBOX_HALF, y, z - HITBOX_HALF], max: [x + HITBOX_HALF, y + HITBOX_HEIGHT, z + HITBOX_HALF] };
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-6)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function jitter(dir, spread, rand) {
  if (!spread) return dir;
  // Random cone around dir.
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * spread;
  // Build an orthonormal basis.
  const up = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize([dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]]);
  const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
  return normalize([
    dir[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
    dir[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
    dir[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
  ]);
}

/** Distance to the first solid (building, wall, gate) along the ray, or Infinity. */
export function firstSolidHit(origin, dir, maxDist) {
  let best = Infinity;
  for (const s of getWorld().solids) {
    const t = rayAabb(origin, dir, s.min, s.max, maxDist);
    if (t < best) best = t;
  }
  // Ground plane.
  if (dir[1] < 0) {
    const t = -origin[1] / dir[1];
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

export class CombatManager {
  /**
   * @param {object} room   Room with players Map, mode settings and broadcast helpers.
   * @param {object} deps   { db, now(), rand(), onKill?(killer, victim) }
   */
  constructor(room, deps) {
    this.room = room;
    this.db = deps.db;
    this.now = deps.now || Date.now;
    this.rand = deps.rand || Math.random;
    this.killSeq = 0;
    this.recentKills = new Map(); // `${killer}:${victim}` -> timestamps
  }

  weaponState(p, weaponId) {
    const st = p.loadout[weaponId];
    const w = WEAPONS[weaponId];
    if (st.reloadUntil && this.now() >= st.reloadUntil) {
      const taken = Math.max(0, Math.min(w.magSize - st.ammo, st.reserve));
      st.ammo += taken;
      st.reserve -= taken;
      st.reloadUntil = 0;
    }
    return st;
  }

  ammoView(p, weaponId) {
    const st = this.weaponState(p, weaponId);
    return { weapon: weaponId, ammo: st.ammo, reserve: st.reserve, reloading: st.reloadUntil > 0, reloadUntil: st.reloadUntil };
  }

  canBeDamaged(target) {
    const t = this.now();
    if (!target.alive || !target.connected) return false;
    if (target.spawnProtectedUntil > t) return false;
    if (this.room.isShielded(target)) return false;
    return true;
  }

  /**
   * Validate and resolve a shot. Returns { ok, reason?, hits?, tracers? }.
   * msg: { weapon: string, dir: [x, y, z] }
   */
  fire(shooter, msg) {
    const t = this.now();
    if (!msg || typeof msg !== 'object') return { ok: false, reason: 'malformed' };
    const w = WEAPONS[msg.weapon];
    if (!w) return { ok: false, reason: 'unknown-weapon' };
    if (!shooter.alive) return { ok: false, reason: 'dead' };
    if (shooter.vehicleId) return { ok: false, reason: 'in-vehicle' };
    if (!shooter.progress.weapons.includes(w.id)) return { ok: false, reason: 'weapon-locked' };
    if (shooter.equipped !== w.id) return { ok: false, reason: 'not-equipped' };
    if (this.room.isShielded(shooter)) return { ok: false, reason: 'debugging' };
    if (!Array.isArray(msg.dir) || msg.dir.length !== 3 || !msg.dir.every(Number.isFinite)) return { ok: false, reason: 'malformed' };
    const dir = normalize(msg.dir);
    if (!dir) return { ok: false, reason: 'malformed' };

    // Cooldown with a small allowance for network jitter. The average gap
    // over the last five shots must still match the weapon's fire rate, so
    // the jitter allowance cannot be used to shoot faster over time.
    const last = shooter.lastShotAt[w.id] || 0;
    if (t - last < w.fireIntervalMs * 0.8) return { ok: false, reason: 'cooldown' };
    const log = (shooter.shotLog = (shooter.shotLog || []).filter((s) => t - s < 10_000));
    if (log.length >= 5 && t - log[log.length - 5] < 5 * w.fireIntervalMs * 0.95) return { ok: false, reason: 'rate' };

    const st = this.weaponState(shooter, w.id);
    if (st.reloadUntil) return { ok: false, reason: 'reloading' };
    if (st.ammo <= 0) return { ok: false, reason: 'empty' };

    st.ammo -= 1;
    shooter.lastShotAt[w.id] = t;
    log.push(t);
    if (log.length > 8) log.shift();
    shooter.lastCombatAt = t;
    // Firing ends spawn protection.
    shooter.spawnProtectedUntil = 0;

    const origin = [shooter.pos[0], shooter.pos[1] + PLAYER.eyeHeight, shooter.pos[2]];
    const damageByTarget = new Map();
    const tracers = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = jitter(dir, w.spread, this.rand);
      const wallDist = firstSolidHit(origin, d, w.range);
      let hitPlayer = null;
      let hitDist = Math.min(wallDist, w.range);
      for (const target of this.room.players.values()) {
        if (target === shooter || !target.alive || !target.connected) continue;
        const hb = playerHitbox(target);
        const td = rayAabb(origin, d, hb.min, hb.max, w.range);
        if (td < hitDist) {
          hitDist = td;
          hitPlayer = target;
        }
      }
      tracers.push([origin[0] + d[0] * hitDist, origin[1] + d[1] * hitDist, origin[2] + d[2] * hitDist]);
      if (hitPlayer && this.room.settings.pvp && this.canBeDamaged(hitPlayer)) {
        damageByTarget.set(hitPlayer, (damageByTarget.get(hitPlayer) || 0) + w.damage);
      }
    }

    const hits = [];
    for (const [target, dmg] of damageByTarget) {
      hits.push(this.applyDamage(shooter, target, dmg, w.id));
    }
    return { ok: true, origin, tracers, hits, ammo: this.ammoView(shooter, w.id) };
  }

  applyDamage(attacker, target, amount, weaponId) {
    target.health = Math.max(0, target.health - amount);
    target.lastCombatAt = this.now();
    const result = { targetId: target.id, damage: amount, health: target.health, killed: false };
    if (target.health <= 0) {
      result.killed = true;
      result.kill = this.registerKill(attacker, target, weaponId);
    }
    return result;
  }

  registerKill(killer, victim, weaponId) {
    const t = this.now();
    victim.alive = false;
    victim.respawnAt = t + this.room.settings.respawnDelayMs;
    if (victim.vehicleId) this.room.releaseVehicle(victim);
    victim.session.deaths++;
    this.db.addDeath(victim.id);

    const kill = { id: `${this.room.code}-${t}-${++this.killSeq}`, killer: killer.id, killerName: killer.name, victim: victim.id, victimName: victim.name, weapon: weaponId, points: 0 };
    if (killer === victim) return kill;

    killer.session.kills++;
    this.db.addKill(killer.id);

    // Anti-farming: cap rewarded kills per victim per window.
    const key = `${killer.id}:${victim.id}`;
    const recent = (this.recentKills.get(key) || []).filter((x) => t - x < SCORING.combat.farmWindowMs);
    const farmed = recent.length >= SCORING.combat.farmCapPerVictim;
    recent.push(t);
    this.recentKills.set(key, recent);
    if (!farmed && this.db.award(killer.id, 'combat', `kill:${kill.id}`, SCORING.combat.elimination)) {
      kill.points = SCORING.combat.elimination;
      killer.session.combatPoints += kill.points;
    }
    kill.farmed = farmed;
    return kill;
  }

  reload(p, weaponId) {
    const w = WEAPONS[weaponId];
    if (!w || !p.alive || !p.progress.weapons.includes(weaponId)) return { ok: false };
    const st = this.weaponState(p, weaponId);
    if (st.reloadUntil || st.ammo >= w.magSize || st.reserve <= 0) return { ok: false, ammo: this.ammoView(p, weaponId) };
    st.reloadUntil = this.now() + w.reloadMs;
    return { ok: true, ammo: this.ammoView(p, weaponId) };
  }

  /** Pick the spawn point (inside the player's unlocked districts) farthest from living enemies. */
  chooseSpawn(p) {
    const allowed = SPAWNS.filter((s) => p.progress.districts.includes(DISTRICTS[districtIndexAt(s[0])].id));
    const pool = allowed.length ? allowed : SPAWNS.slice(0, 1);
    const enemies = [...this.room.players.values()].filter((o) => o !== p && o.alive && o.connected);
    if (!enemies.length) return [...pool[Math.floor(this.rand() * pool.length)]];
    let best = pool[0];
    let bestScore = -1;
    for (const s of pool) {
      let nearest = Infinity;
      for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.pos[0] - s[0], e.pos[2] - s[2]));
      // Small random term so the same spot is not always chosen.
      const score = nearest + this.rand() * 4;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return [...best];
  }

  respawn(p) {
    const t = this.now();
    p.alive = true;
    p.health = PLAYER.maxHealth;
    p.loadout = freshLoadout();
    p.lastShotAt = {};
    p.pos = this.chooseSpawn(p);
    p.lastValidPos = [...p.pos];
    p.lastMoveAt = t;
    p.spawnProtectedUntil = t + this.room.settings.spawnProtectionMs;
    p.respawnAt = 0;
    return p.pos;
  }
}
