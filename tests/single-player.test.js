import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSession, START_POS } from '../engine/session.js';
import { enemySpawns, ENEMY } from '../engine/enemies.js';
import { pickupSpawns, PICKUP } from '../engine/pickups.js';
import { CHALLENGES } from '../challenges/index.js';
import { STATIONS, MISSIONS, MISSION_NPCS, VEHICLE_SPAWNS, getWorld, pointInBox, districtCenterX } from '../shared/world-data.js';
import { WEAPONS, PLAYER, SCORING } from '../shared/config.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function newSession(state = null) {
  return new GameSession({ state, rand: seeded(7) });
}

function advance(s, secs) {
  for (let t = 0; t < secs; t += 0.05) s.update(Math.min(0.05, secs - t));
}

/** Take every enemy except `keep` out of play, so a test controls the fight. */
function parkEnemies(s, keep = null) {
  for (const e of s.enemies.enemies) {
    if (e === keep) continue;
    e.alive = false;
    e.respawnAt = Infinity;
  }
}

/** Walk in small steps, like the page does, so missions and pickups trigger. */
function walk(s, to, step = 0.5) {
  for (let i = 0; i < 10_000; i++) {
    const p = s.player.pos;
    const dx = to[0] - p[0];
    const dz = to[2] - p[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    const k = Math.min(1, step / d);
    const r = s.setPosition([p[0] + dx * k, to[1] ?? 0, p[2] + dz * k]);
    if (!r.ok) return false;
  }
  return false;
}

async function fix(s, id) {
  const st = STATIONS.find((x) => x.challengeId === id);
  s.player.pos = [...st.pos];
  s.player.lastValidPos = [...st.pos];
  const opened = s.openChallenge(id);
  assert.equal(opened.ok, true, `open ${id}: ${opened.error}`);
  const r = await s.runTests(id, CHALLENGES[id].solutionCode);
  assert.equal(r.report.passed, true, `${id} passes`);
  const a = s.applyFix(id);
  assert.equal(a.ok, true);
  s.closeChallenge();
  return a;
}

test('a new game starts in Ocean Drive with full health and a pistol', () => {
  const s = newSession();
  assert.deepEqual(s.player.pos, [...START_POS]);
  assert.equal(s.player.health, PLAYER.maxHealth);
  assert.deepEqual(s.progressView().weapons, ['pistol']);
  assert.deepEqual(s.progressView().districts, ['ocean']);
  assert.equal(s.scoreView().totals.total, 0);
});

test('locked districts refuse the player until the gate bug is fixed', async () => {
  const s = newSession();
  const inside = [districtCenterX(1) - 80, 0, -10];
  const r = s.setPosition(inside);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
  await fix(s, 'invisible-gate');
  assert.ok(s.progressView().districts.includes('downtown'));
  assert.equal(s.setPosition(inside).ok, true);
});

test('walking to the end of the pier completes the first mission once', () => {
  const s = newSession();
  const events = [];
  s.on('mission', (e) => events.push(e));
  const pier = MISSIONS[0].steps[0].pos;
  assert.ok(walk(s, [pier[0], 0, -70]));
  assert.ok(walk(s, [pier[0], 0.2, pier[2]]));
  assert.ok(events.some((e) => e.type === 'mission-complete' && e.missionId === 'm-ocean'));
  assert.equal(s.scoreView().totals.other, MISSIONS[0].reward);
  walk(s, [pier[0], 0.2, pier[2] + 5]);
  walk(s, [pier[0], 0.2, pier[2]]);
  assert.equal(s.scoreView().totals.other, MISSIONS[0].reward, 'paid once');
});

test('the courier mission stays stuck until Broken Mission is fixed', async () => {
  const s = newSession();
  await fix(s, 'invisible-gate');
  const [rico, vera] = MISSION_NPCS;
  const stand = (npc) => {
    s.player.pos = [npc.pos[0] + 1, 0, npc.pos[2]];
  };
  stand(rico);
  s.talk('npc-rico');
  stand(vera);
  s.talk('npc-vera');
  assert.equal(s.store.missions().includes('m-downtown'), false, 'buggy state machine blocks delivery');
  await fix(s, 'broken-mission');
  stand(vera);
  s.talk('npc-vera');
  assert.equal(s.store.missions().includes('m-downtown'), true);
});

test('car doors are jammed until Broken Car is fixed', async () => {
  const s = newSession();
  const car = VEHICLE_SPAWNS[0];
  s.player.pos = [car.pos[0] - 1, 0, car.pos[2] - 2];
  const v = { id: car.id, pos: car.pos, driver: null };
  assert.equal(s.enterVehicle(v).ok, false);
  await fix(s, 'broken-car');
  s.player.pos = [car.pos[0] - 1, 0, car.pos[2] - 2];
  assert.equal(s.enterVehicle(v).ok, true);
  assert.equal(s.player.vehicleId, car.id);
  s.exitVehicle();
  assert.equal(s.player.vehicleId, null);
});

test('weapons respect cooldown, ammo and reload, and new weapons unlock from bug fixes', async () => {
  const s = newSession();
  parkEnemies(s);
  const dir = [1, 0, 0];
  assert.equal(s.fire({ weapon: 'pistol', dir }).ok, true);
  assert.equal(s.fire({ weapon: 'pistol', dir }).reason, 'cooldown');
  for (let i = 0; i < 20; i++) {
    advance(s, WEAPONS.pistol.fireIntervalMs / 1000 + 0.01);
    s.fire({ weapon: 'pistol', dir });
  }
  assert.equal(s.weapons.view(s.player, 'pistol').ammo, 0);
  advance(s, 0.5);
  assert.equal(s.fire({ weapon: 'pistol', dir }).reason, 'empty');
  assert.equal(s.reload('pistol').ok, true);
  advance(s, WEAPONS.pistol.reloadMs / 1000 + 0.1);
  assert.equal(s.weapons.view(s.player, 'pistol').ammo, WEAPONS.pistol.magSize);
  assert.equal(s.fire({ weapon: 'smg', dir }).reason, 'weapon-locked');
  for (const id of ['invisible-gate', 'broken-mission', 'flying-car', 'infinite-ammo']) await fix(s, id);
  assert.ok(s.progressView().weapons.includes('smg'));
  assert.equal(s.equip('smg'), true);
});

test('shooting an enemy damages it, a kill pays combat points, and it respawns later', () => {
  const s = newSession();
  const e = s.enemies.enemies[0];
  parkEnemies(s, e);
  e.pos = [s.player.pos[0] + 8, 0, s.player.pos[2]];
  let kills = 0;
  s.on('kill', (k) => {
    if (k.victimName === e.name) kills++;
  });
  for (let i = 0; i < 10 && e.alive; i++) {
    advance(s, WEAPONS.pistol.fireIntervalMs / 1000 + 0.01);
    e.pos = [s.player.pos[0] + 8, 0, s.player.pos[2]];
    const r = s.fire({ weapon: 'pistol', dir: [1, (1.0 - PLAYER.eyeHeight) / 8, 0] });
    assert.equal(r.ok, true);
  }
  assert.equal(e.alive, false);
  assert.equal(kills, 1);
  assert.equal(s.scoreView().totals.combat, ENEMY.points);
  assert.equal(s.statsView().kills, 1);
  for (let i = 0; i < ENEMY.respawnMs / 100 + 5; i++) s.enemies.update(0.1, { ...s.player, pos: [9999, 0, 9999] }), (s.clockMs += 100);
  assert.equal(e.alive, true);
});

test('enemies that see the player shoot back; dying respawns the player after the delay', () => {
  const s = newSession();
  s.player.spawnProtectedUntil = 0;
  // Put one ocean bot on the avenue facing the player, with a clear view.
  const e = s.enemies.enemies[0];
  parkEnemies(s, e);
  s.player.pos = [0, 0, -70];
  s.player.lastValidPos = [0, 0, -70];
  e.pos = [12, 0, -70];
  let downs = 0;
  let damaged = 0;
  s.on('damaged', () => damaged++);
  s.on('player-down', () => downs++);
  for (let i = 0; i < 4000 && downs === 0; i++) s.update(0.05);
  assert.ok(damaged > 0, 'took damage');
  assert.equal(downs, 1, 'went down');
  assert.equal(s.player.alive, false);
  assert.equal(s.statsView().deaths, 1);
  let respawned = null;
  s.on('respawn', (r) => (respawned = r));
  for (let i = 0; i < 80; i++) s.update(0.05);
  assert.ok(respawned, 'respawned');
  assert.equal(s.player.health, PLAYER.maxHealth);
});

test('enemies ignore a player who is debugging at a station (safe-debugging shield)', () => {
  const s = newSession();
  s.player.spawnProtectedUntil = 0;
  const st = STATIONS.find((x) => x.challengeId === 'ghost-wall');
  s.player.pos = [...st.pos];
  assert.equal(s.openChallenge('ghost-wall').ok, true);
  const e = s.enemies.enemies[0];
  e.pos = [st.pos[0] + 6, 0, st.pos[2]];
  let damaged = 0;
  s.on('damaged', () => damaged++);
  for (let i = 0; i < 200; i++) {
    s.update(0.05);
    e.pos = [st.pos[0] + 6, 0, st.pos[2]];
  }
  assert.equal(damaged, 0);
});

test('enemy patrol routes and pickups are on streets, clear of buildings', () => {
  const solids = getWorld().solids;
  const blocked = (x, z) => solids.some((b) => pointInBox([x, 1, z], b, 0.5));
  for (const spec of enemySpawns()) {
    for (let i = 0; i < spec.route.length; i++) {
      const [ax, az] = spec.route[i];
      const [bx, bz] = spec.route[(i + 1) % spec.route.length];
      for (let k = 0; k <= 50; k++) {
        const x = ax + ((bx - ax) * k) / 50;
        const z = az + ((bz - az) * k) / 50;
        assert.equal(blocked(x, z), false, `${spec.id} route crosses a building at ${x.toFixed(1)},${z.toFixed(1)}`);
      }
    }
  }
  for (const p of pickupSpawns()) assert.equal(blocked(p.pos[0], p.pos[2]), false, `${p.id} is inside a building`);
});

test('walking over a data chip collects it once; med kits heal', () => {
  const s = newSession();
  const chip = pickupSpawns().find((p) => p.kind === 'chip' && p.district === 'ocean');
  s.player.pos = [chip.pos[0] + 3, 0, chip.pos[2]];
  walk(s, chip.pos);
  assert.equal(s.statsView().chips, 1);
  assert.equal(s.scoreView().totals.other, PICKUP.chipPoints);
  walk(s, [chip.pos[0] + 3, 0, chip.pos[2]]);
  walk(s, chip.pos);
  assert.equal(s.statsView().chips, 1, 'only once');
  const med = pickupSpawns().find((p) => p.kind === 'medkit' && p.district === 'ocean');
  s.player.health = 30;
  s.player.pos = [med.pos[0], 0, med.pos[2] + 3];
  walk(s, med.pos);
  assert.equal(s.player.health, 30 + PICKUP.medkitHeal);
});

test('falling out of the world respawns without counting a death', () => {
  const s = newSession();
  const r = s.setPosition([0, -50, 0]);
  assert.equal(r.respawned, true);
  assert.equal(s.player.alive, true);
  assert.equal(s.statsView().deaths, 0);
});

test('the full city can be cleared: every gate bug, two missions, then the vault', async () => {
  const s = newSession();
  for (const id of ['invisible-gate', 'broken-mission', 'flying-car', 'double-score']) await fix(s, id);
  assert.equal(s.progressView().districts.length, 5);
  const pier = MISSIONS[0].steps[0].pos;
  s.player.pos = [pier[0], 0.2, pier[2] + 3];
  walk(s, [pier[0], 0.2, pier[2]]);
  await fix(s, 'faulty-checkpoint');
  for (const step of MISSIONS[3].steps) {
    s.player.pos = [step.pos[0] + 3, 0, step.pos[2]];
    walk(s, [step.pos[0], 0, step.pos[2]]);
  }
  assert.ok(s.store.missions().includes('m-neon'));
  await fix(s, 'broken-final-gate');
  assert.equal(s.progressView().vaultOpen, true);
  let cleared = false;
  s.on('mission', (e) => {
    if (e.type === 'city-cleared') cleared = true;
  });
  const vault = MISSIONS[4].steps[0].pos;
  s.player.pos = [vault[0], 0, vault[2] - 10];
  s.player.lastValidPos = [...s.player.pos];
  s.setPosition([vault[0], 0, vault[2]]);
  assert.equal(cleared, true);
  assert.ok(s.scoreView().totals.other >= SCORING.cityCleared);
});
