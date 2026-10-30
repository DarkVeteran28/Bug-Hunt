// Player weapons: ownership, cooldown, ammo, reload, spread, range and line
// of sight, resolved against the city geometry and the enemies.
import { WEAPONS, PLAYER } from '../shared/config.js';
import { getWorld, rayAabb } from '../shared/world-data.js';

const HITBOX_HALF = 0.45;
const HITBOX_HEIGHT = 1.85;

export function freshLoadout() {
  const out = {};
  for (const w of Object.values(WEAPONS)) out[w.id] = { ammo: w.magSize, reserve: w.reserve, reloadUntil: 0 };
  return out;
}

export function bodyHitbox(pos) {
  const [x, y, z] = pos;
  return { min: [x - HITBOX_HALF, y, z - HITBOX_HALF], max: [x + HITBOX_HALF, y + HITBOX_HEIGHT, z + HITBOX_HALF] };
}

export function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-6)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function jitter(dir, spread, rand) {
  if (!spread) return dir;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * spread;
  const up = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize([dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]]);
  const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
  return normalize([
    dir[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
    dir[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
    dir[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
  ]);
}

/**
 * Distance to the first solid (building, wall, closed gate) along the ray,
 * or Infinity. `openGates` lists gate ids that should not block.
 */
export function firstSolidHit(origin, dir, maxDist, openGates = null) {
  let best = Infinity;
  for (const s of getWorld().solids) {
    if (openGates && s.id && openGates.includes(s.id)) continue;
    const t = rayAabb(origin, dir, s.min, s.max, maxDist);
    if (t < best) best = t;
  }
  if (dir[1] < 0) {
    const t = -origin[1] / dir[1];
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/** Is the straight line between two points free of buildings? */
export function clearLine(a, b, openGates = null) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-3) return true;
  const dir = [d[0] / len, d[1] / len, d[2] / len];
  let best = Infinity;
  for (const s of getWorld().solids) {
    if (openGates && s.id && openGates.includes(s.id)) continue;
    const t = rayAabb(a, dir, s.min, s.max, len);
    if (t < best) best = t;
  }
  return best >= len;
}

export class Weapons {
  constructor({ now, rand = Math.random }) {
    this.now = now;
    this.rand = rand;
  }

  state(p, weaponId) {
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

  view(p, weaponId) {
    const st = this.state(p, weaponId);
    return { weapon: weaponId, ammo: st.ammo, reserve: st.reserve, reloading: st.reloadUntil > 0, reloadUntil: st.reloadUntil };
  }

  /**
   * Fire the equipped weapon along `dir` from the player's eye.
   * targets: [{ id, pos, alive }] (enemies). Returns { ok, reason?, origin, tracers, hits, ammo }.
   */
  fire(p, { weapon, dir: rawDir }, targets, openGates) {
    const t = this.now();
    const w = WEAPONS[weapon];
    if (!w) return { ok: false, reason: 'unknown-weapon' };
    if (!p.alive) return { ok: false, reason: 'dead' };
    if (p.vehicleId) return { ok: false, reason: 'in-vehicle' };
    if (!p.progress.weapons.includes(w.id)) return { ok: false, reason: 'weapon-locked' };
    if (p.equipped !== w.id) return { ok: false, reason: 'not-equipped' };
    const dir = Array.isArray(rawDir) && rawDir.length === 3 && rawDir.every(Number.isFinite) ? normalize(rawDir) : null;
    if (!dir) return { ok: false, reason: 'malformed' };
    const last = p.lastShotAt[w.id];
    if (last !== undefined && t - last < w.fireIntervalMs) return { ok: false, reason: 'cooldown' };
    const st = this.state(p, w.id);
    if (st.reloadUntil) return { ok: false, reason: 'reloading' };
    if (st.ammo <= 0) return { ok: false, reason: 'empty' };

    st.ammo -= 1;
    p.lastShotAt[w.id] = t;
    p.lastCombatAt = t;
    p.spawnProtectedUntil = 0;

    const origin = [p.pos[0], p.pos[1] + PLAYER.eyeHeight, p.pos[2]];
    const damageByTarget = new Map();
    const tracers = [];
    for (let i = 0; i < w.pellets; i++) {
      const d = jitter(dir, w.spread, this.rand);
      const wallDist = firstSolidHit(origin, d, w.range, openGates);
      let hit = null;
      let hitDist = Math.min(wallDist, w.range);
      for (const target of targets) {
        if (!target.alive) continue;
        const hb = bodyHitbox(target.pos);
        const td = rayAabb(origin, d, hb.min, hb.max, w.range);
        if (td < hitDist) {
          hitDist = td;
          hit = target;
        }
      }
      tracers.push([origin[0] + d[0] * hitDist, origin[1] + d[1] * hitDist, origin[2] + d[2] * hitDist]);
      if (hit) damageByTarget.set(hit, (damageByTarget.get(hit) || 0) + w.damage);
    }
    return { ok: true, origin, tracers, damageByTarget, ammo: this.view(p, w.id) };
  }

  reload(p, weaponId) {
    const w = WEAPONS[weaponId];
    if (!w || !p.alive || !p.progress.weapons.includes(weaponId)) return { ok: false };
    const st = this.state(p, weaponId);
    if (st.reloadUntil || st.ammo >= w.magSize || st.reserve <= 0) return { ok: false, ammo: this.view(p, weaponId) };
    st.reloadUntil = this.now() + w.reloadMs;
    return { ok: true, ammo: this.view(p, weaponId) };
  }
}
