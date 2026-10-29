import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRoom, addPlayer, solve } from './helpers.js';
import { WEAPONS, SCORING, PLAYER } from '../shared/config.js';
import { getWorld, STATIONS } from '../shared/world-data.js';

// Open plaza on Ocean Drive with a clear line of fire along +z.
const A = [30, 0, -60];
const B = [30, 0, -50];
const aimAt = (from, to) => [to[0] - from[0], to[1] + 1.2 - (from[1] + PLAYER.eyeHeight), to[2] - from[2]];

function setup(opts) {
  const ctx = testRoom(opts);
  const a = addPlayer(ctx, 'Shooter', A);
  const b = addPlayer(ctx, 'Target', B);
  return { ...ctx, a, b };
}

test('a valid pistol shot damages the target and uses one round', () => {
  const { room, a, b } = setup();
  const r = room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) });
  assert.equal(r.ok, true);
  assert.equal(r.hits.length, 1);
  assert.equal(b.health, 100 - WEAPONS.pistol.damage);
  assert.equal(a.loadout.pistol.ammo, WEAPONS.pistol.magSize - 1);
});

test('the client cannot choose damage, target or origin', () => {
  const { room, a, b } = setup();
  const r = room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B), damage: 9999, target: b.id, origin: [30, 1, -50.5] });
  assert.equal(r.ok, true);
  assert.equal(b.health, 100 - WEAPONS.pistol.damage);
  assert.deepEqual(r.origin, [A[0], A[1] + PLAYER.eyeHeight, A[2]]);
});

test('fire rate is enforced on the server', () => {
  const { room, a, clock } = setup();
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).ok, true);
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).reason, 'cooldown');
  clock.t += WEAPONS.pistol.fireIntervalMs;
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).ok, true);
});

test('bunched packets cannot raise the sustained fire rate', () => {
  const { room, a, clock } = setup();
  a.loadout.pistol.ammo = 1000;
  const accepted = [];
  for (let i = 0; i < 40; i++) {
    clock.t += Math.ceil(WEAPONS.pistol.fireIntervalMs * 0.8);
    if (room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).ok) accepted.push(clock.t);
  }
  const span = accepted[accepted.length - 1] - accepted[0];
  const rate = (accepted.length - 1) / (span / 1000);
  assert.ok(rate <= (1000 / WEAPONS.pistol.fireIntervalMs) * 1.08, `sustained ${rate.toFixed(2)} shots/s`);
});

test('ammo runs out and reloading is timed by the server', () => {
  const { room, a, clock } = setup();
  a.loadout.pistol.ammo = 1;
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).ok, true);
  clock.t += 1000;
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).reason, 'empty');
  assert.equal(room.combat.reload(a, 'pistol').ok, true);
  clock.t += 100;
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).reason, 'reloading');
  clock.t += WEAPONS.pistol.reloadMs;
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).ok, true);
  assert.equal(a.loadout.pistol.ammo, WEAPONS.pistol.magSize - 1);
  assert.equal(a.loadout.pistol.reserve, WEAPONS.pistol.reserve - WEAPONS.pistol.magSize);
});

test('locked or unequipped weapons cannot fire', () => {
  const { room, a } = setup();
  a.equipped = 'smg';
  assert.equal(room.combat.fire(a, { weapon: 'smg', dir: [0, 0, 1] }).reason, 'weapon-locked');
  a.equipped = 'pistol';
  assert.equal(room.combat.fire(a, { weapon: 'rifle', dir: [0, 0, 1] }).reason, 'weapon-locked');
});

test('malformed shots are rejected', () => {
  const { room, a } = setup();
  for (const msg of [null, {}, { weapon: 'pistol' }, { weapon: 'pistol', dir: [NaN, 0, 1] }, { weapon: 'pistol', dir: [0, 0, 0] }, { weapon: 'laser', dir: [0, 0, 1] }, { weapon: 'pistol', dir: 'up' }]) {
    assert.equal(room.combat.fire(a, msg).ok, false, JSON.stringify(msg));
  }
});

test('targets beyond weapon range are not hit', () => {
  const { room, a, b } = setup();
  b.pos = [30, 0, -60 + WEAPONS.pistol.range + 5];
  const r = room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, b.pos) });
  assert.equal(r.ok, true);
  assert.equal(b.health, 100);
});

test('walls block shots (server line of sight)', () => {
  const { room, a, b } = setup();
  const bld = getWorld().buildings.find((x) => x.district === 'ocean' && x.kind === 'building' && !x.ghost && x.max[0] - x.min[0] < 40);
  const z = (bld.min[2] + bld.max[2]) / 2;
  a.pos = [bld.min[0] - 2, 0, z];
  b.pos = [bld.max[0] + 2, 0, z];
  const r = room.combat.fire(a, { weapon: 'pistol', dir: aimAt(a.pos, b.pos) });
  assert.equal(r.ok, true);
  assert.equal(b.health, 100);
});

test('players cannot damage themselves', () => {
  const { room, a } = setup();
  const r = room.combat.fire(a, { weapon: 'pistol', dir: [0, -1, 0.01] });
  assert.equal(r.ok, true);
  assert.equal(a.health, 100);
});

test('spawn protection blocks damage', () => {
  const { room, a, b, clock } = setup();
  b.spawnProtectedUntil = clock.t + 1000;
  room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) });
  assert.equal(b.health, 100);
});

test('private rooms can turn PvP off', () => {
  const { room, a, b } = setup({ pvp: false });
  room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) });
  assert.equal(b.health, 100);
});

test('safe debugging shield in Free Roam: no damage taken, no shots fired', () => {
  const { room, a, b } = setup();
  const st = STATIONS.find((s) => s.challengeId === 'broken-car');
  b.pos = [st.pos[0], 0, st.pos[2] + 1];
  b.debugging = 'broken-car';
  b.debugStation = st.pos;
  room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, b.pos) });
  assert.equal(b.health, 100);
  assert.equal(room.combat.fire(b, { weapon: 'pistol', dir: [0, 0, 1] }).reason, 'debugging');
  // Walking away from the station drops the shield.
  b.pos = [st.pos[0], 0, st.pos[2] + 15];
  assert.equal(room.isShielded(b), false);
});

test('in Bug Hunt Arena debugging players can still be shot', () => {
  const { room, a, b } = setup({ mode: 'arena' });
  b.debugging = 'broken-car';
  b.debugStation = B;
  room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) });
  assert.equal(b.health, 100 - WEAPONS.pistol.damage);
});

test('a kill is confirmed once, rewarded once, and the victim respawns after the delay', () => {
  const { room, a, b, clock, db } = setup();
  let kill = null;
  for (let i = 0; i < 10 && !kill; i++) {
    clock.t += 1000;
    const r = room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) });
    const h = r.hits.find((x) => x.killed);
    if (h) kill = h.kill;
  }
  assert.ok(kill);
  assert.equal(kill.points, SCORING.combat.elimination);
  assert.equal(b.alive, false);
  assert.equal(db.totals(a.id).combat, SCORING.combat.elimination);
  assert.equal(db.stats(a.id).kills, 1);
  assert.equal(db.stats(b.id).deaths, 1);
  // Shooting the body does nothing more.
  clock.t += 1000;
  const r = room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) });
  assert.equal(r.hits.length, 0);
  assert.equal(db.totals(a.id).combat, SCORING.combat.elimination);
  // Respawn after the configured delay with full health and spawn protection.
  clock.t += PLAYER.respawnDelayMs;
  room.tick();
  assert.equal(b.alive, true);
  assert.equal(b.health, 100);
  assert.ok(b.spawnProtectedUntil > clock.t);
});

test('repeatedly killing the same player stops paying (anti-farming)', () => {
  const { room, a, b, clock, db } = setup();
  let paid = 0;
  for (let k = 0; k < SCORING.combat.farmCapPerVictim + 2; k++) {
    b.alive = true;
    b.health = 100;
    b.pos = [...B];
    b.spawnProtectedUntil = 0;
    a.loadout.pistol.ammo = 12;
    for (let i = 0; i < 6 && b.alive; i++) {
      clock.t += 400;
      for (const h of room.combat.fire(a, { weapon: 'pistol', dir: aimAt(A, B) }).hits) if (h.killed) paid += h.kill.points;
    }
  }
  assert.equal(paid, SCORING.combat.farmCapPerVictim * SCORING.combat.elimination);
  assert.equal(db.totals(a.id).combat, paid);
});

test('dead players cannot shoot', () => {
  const { room, a } = setup();
  a.alive = false;
  assert.equal(room.combat.fire(a, { weapon: 'pistol', dir: [0, 0, 1] }).reason, 'dead');
});

test('respawn points avoid living enemies', () => {
  const { room, a, b } = setup();
  solve({ db: room.db }, b, []);
  const spot = room.combat.chooseSpawn(b);
  const d = Math.hypot(spot[0] - a.pos[0], spot[2] - a.pos[2]);
  assert.ok(d > 20, `spawned ${d.toFixed(1)} units from the enemy`);
});
