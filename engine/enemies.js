// Hostile "glitch bots": the enemies of the single-player game.
//
// Each bot patrols a loop of streets in its own district. When it sees the
// player (within sight range, with a clear line of sight) it chases until it
// is close enough, then shoots. It walks back to its patrol along the path it
// took (breadcrumbs), so it never cuts through buildings. Bots only think
// when the player is nearby, and line-of-sight checks are throttled.
import { DISTRICTS, DISTRICT_WIDTH, districtIndexAt, dist2D } from '../shared/world-data.js';
import { PLAYER } from '../shared/config.js';
import { clearLine } from './combat.js';

export const ENEMY = Object.freeze({
  health: 60,
  patrolSpeed: 2.6,
  chaseSpeed: 4.4,
  keepDistance: 11,
  fireIntervalMs: 1300,
  respawnMs: 30_000,
  thinkMs: 200,
  activeRange: 110,
  loseSightMs: 4000,
  points: 50,
});

// Per-district difficulty: sight range, firing range, damage, accuracy at 0 m and at max range.
const TIERS = [
  { sight: 22, range: 18, damage: 5, accNear: 0.6, accFar: 0.2 },
  { sight: 28, range: 22, damage: 6, accNear: 0.65, accFar: 0.25 },
  { sight: 30, range: 24, damage: 7, accNear: 0.7, accFar: 0.25 },
  { sight: 32, range: 26, damage: 8, accNear: 0.72, accFar: 0.3 },
  { sight: 34, range: 28, damage: 9, accNear: 0.75, accFar: 0.3 },
];

// Patrol loops in district-local coordinates. Every segment runs along an
// avenue (z = -70, -10, 50) or a cross street (x = -60, 0, 60), which are
// clear of buildings (checked by tests/single-player.test.js).
const ROUTES = [
  [[-60, -70], [60, -70], [60, -10], [-60, -10]],
  [[-60, -10], [0, -10], [0, 50], [-60, 50]],
  [[0, -10], [60, -10], [60, 50], [0, 50]],
];
const PER_DISTRICT = [[0, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2, 0]];

export function enemySpawns() {
  const list = [];
  let n = 0;
  DISTRICTS.forEach((d, di) => {
    PER_DISTRICT[di].forEach((ri, k) => {
      const route = ROUTES[ri].map(([x, z]) => [di * DISTRICT_WIDTH + x, z]);
      // Spread bots sharing a route around the loop.
      const start = (k * 2) % route.length;
      list.push({ id: `glitch-${++n}`, name: `GLITCH-${String(n).padStart(2, '0')}`, district: d.id, districtIndex: di, route, start });
    });
  });
  return list;
}

export function freshEnemy(spec) {
  const [x, z] = spec.route[spec.start];
  return {
    ...spec,
    pos: [x, 0, z],
    ry: 0,
    health: ENEMY.health,
    alive: true,
    respawnAt: 0,
    mode: 'patrol', // patrol | chase | return
    waypoint: (spec.start + 1) % spec.route.length,
    trail: [],
    lastSeenAt: 0,
    nextThinkAt: 0,
    canSee: false,
    nextShotAt: 0,
    anim: 'walk',
  };
}

function moveToward(e, tx, tz, speed, dt) {
  const dx = tx - e.pos[0];
  const dz = tz - e.pos[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return true;
  const step = Math.min(d, speed * dt);
  e.pos[0] += (dx / d) * step;
  e.pos[2] += (dz / d) * step;
  e.ry = Math.atan2(dx, dz);
  return step >= d - 1e-6;
}

export class EnemyDirector {
  /**
   * deps: { now(), rand(), onShootPlayer(enemy, hit, damage), canTarget() -> bool, openGates() -> [] }
   */
  constructor(deps, saved = null) {
    this.deps = deps;
    this.enemies = enemySpawns().map(freshEnemy);
    if (saved) this.restore(saved);
  }

  byId(id) {
    return this.enemies.find((e) => e.id === id);
  }

  update(dt, player) {
    const t = this.deps.now();
    const playerDistrict = districtIndexAt(player.pos[0]);
    for (const e of this.enemies) {
      if (!e.alive) {
        if (t >= e.respawnAt) Object.assign(e, freshEnemy(e));
        continue;
      }
      const d = dist2D(e.pos, player.pos);
      // Far away or another district: keep patrolling slowly, no thinking.
      if (d > ENEMY.activeRange || e.districtIndex !== playerDistrict || !player.alive) {
        if (e.mode !== 'patrol') {
          e.mode = 'return';
          e.canSee = false;
        }
        this.walk(e, dt);
        continue;
      }
      const tier = TIERS[e.districtIndex];
      if (t >= e.nextThinkAt) {
        e.nextThinkAt = t + ENEMY.thinkMs + this.deps.rand() * 60;
        const eye = [e.pos[0], 1.5, e.pos[2]];
        const target = [player.pos[0], player.pos[1] + 1.2, player.pos[2]];
        e.canSee = d <= (e.mode === 'chase' ? tier.sight * 1.4 : tier.sight) && this.deps.canTarget() && clearLine(eye, target, this.deps.openGates());
        if (e.canSee) {
          e.lastSeenAt = t;
          if (e.mode !== 'chase') {
            e.mode = 'chase';
            e.nextShotAt = Math.max(e.nextShotAt, t + 600 + this.deps.rand() * 400); // a moment to react
          }
        } else if (e.mode === 'chase' && t - e.lastSeenAt > ENEMY.loseSightMs) {
          e.mode = 'return';
        }
      }
      if (e.mode === 'chase') {
        this.chase(e, dt, player, d, tier, t);
      } else {
        this.walk(e, dt);
      }
    }
  }

  chase(e, dt, player, d, tier, t) {
    // Only step toward the player along a clear line (checked in think), and
    // stay inside the home district.
    if (e.canSee && d > ENEMY.keepDistance) {
      const half = DISTRICT_WIDTH / 2 - 5;
      const cx = e.districtIndex * DISTRICT_WIDTH;
      const last = e.trail[e.trail.length - 1];
      if (!last || dist2D(last, e.pos) > 2) e.trail.push([e.pos[0], 0, e.pos[2]]);
      moveToward(e, Math.max(cx - half, Math.min(cx + half, player.pos[0])), player.pos[2], ENEMY.chaseSpeed, dt);
      e.anim = 'run';
    } else {
      e.ry = Math.atan2(player.pos[0] - e.pos[0], player.pos[2] - e.pos[2]);
      e.anim = 'idle';
    }
    if (e.canSee && d <= tier.range && t >= e.nextShotAt) {
      e.nextShotAt = t + ENEMY.fireIntervalMs + this.deps.rand() * 500;
      const k = Math.min(1, d / tier.range);
      const accuracy = tier.accNear + (tier.accFar - tier.accNear) * k;
      const moving = player.speed > PLAYER.walkSpeed + 0.5 ? 0.6 : 1; // sprinting is harder to hit
      const hit = this.deps.rand() < accuracy * moving;
      this.deps.onShootPlayer(e, hit, hit ? tier.damage : 0);
    }
  }

  /** Patrol, or walk back along the breadcrumbs to the patrol loop. */
  walk(e, dt) {
    e.anim = 'walk';
    if (e.mode === 'return' || e.mode === 'chase') {
      const crumb = e.trail[e.trail.length - 1];
      if (!crumb) {
        e.mode = 'patrol';
        return;
      }
      if (moveToward(e, crumb[0], crumb[2], ENEMY.patrolSpeed * 1.3, dt)) e.trail.pop();
      return;
    }
    const [wx, wz] = e.route[e.waypoint];
    if (moveToward(e, wx, wz, ENEMY.patrolSpeed, dt)) e.waypoint = (e.waypoint + 1) % e.route.length;
  }

  /** Damage from the player. Returns { killed }. */
  damage(e, amount) {
    if (!e.alive) return { killed: false, health: 0 };
    e.health = Math.max(0, e.health - amount);
    // Getting shot makes a bot fight back even from beyond its sight range.
    e.mode = 'chase';
    e.lastSeenAt = this.deps.now();
    if (e.health <= 0) {
      e.alive = false;
      e.respawnAt = this.deps.now() + ENEMY.respawnMs;
      e.trail = [];
      e.mode = 'patrol';
      return { killed: true, health: 0 };
    }
    return { killed: false, health: e.health };
  }

  /** Calm every bot (after the player dies, so they do not camp the body). */
  calm() {
    for (const e of this.enemies) if (e.mode === 'chase') e.mode = 'return';
  }

  view() {
    return this.enemies.map((e) => ({ id: e.id, name: e.name, pos: e.pos, ry: e.ry, alive: e.alive, health: e.health, anim: e.alive ? e.anim : 'dead', alert: e.mode === 'chase' }));
  }

  /** Minimal state for a save file: alive bots keep their place on the loop. */
  serialize(now) {
    return this.enemies.map((e) => ({ id: e.id, alive: e.alive, health: e.health, respawnInMs: e.alive ? 0 : Math.max(0, e.respawnAt - now) }));
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    const t = this.deps.now();
    for (const s of list) {
      const e = this.byId(s && s.id);
      if (!e) continue;
      if (s.alive === false) {
        e.alive = false;
        e.health = 0;
        e.respawnAt = t + Math.max(0, Math.min(ENEMY.respawnMs, Number(s.respawnInMs) || 0));
      } else if (Number.isFinite(s.health)) {
        e.health = Math.max(1, Math.min(ENEMY.health, s.health));
      }
    }
  }
}
