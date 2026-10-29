import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './helpers.js';

test('a score event with the same reference is only paid once', () => {
  const db = memoryDb();
  const { player } = db.authenticate(null, 'Alice');
  assert.equal(db.award(player.id, 'combat', 'kill:1', 100), true);
  assert.equal(db.award(player.id, 'combat', 'kill:1', 100), false);
  assert.equal(db.totals(player.id).combat, 100);
});

test('challenge completion pays exactly once and is recorded separately', () => {
  const db = memoryDb();
  const { player } = db.authenticate(null, 'Bob');
  assert.equal(db.completeChallenge(player.id, 'ghost-wall', 100, 5000, 'code'), true);
  assert.equal(db.completeChallenge(player.id, 'ghost-wall', 100, 5000, 'code'), false);
  const t = db.totals(player.id);
  assert.equal(t.bug, 100);
  assert.equal(t.combat, 0);
  assert.equal(t.total, 100);
});

test('negative amounts are rejected by the schema', () => {
  const db = memoryDb();
  const { player } = db.authenticate(null, 'Neg');
  assert.equal(db.award(player.id, 'bug', 'x', -500), true); // clamped to 0
  assert.equal(db.totals(player.id).total, 0);
});

test('tokens identify players and names are unique', () => {
  const db = memoryDb();
  const a = db.authenticate(null, 'Carol');
  assert.ok(a.token);
  const again = db.authenticate(a.token, 'ignored');
  assert.equal(again.player.id, a.player.id);
  const clash = db.authenticate(null, 'carol');
  assert.ok(clash.error);
  const unknown = db.authenticate('not-a-real-token', null);
  assert.ok(unknown.error);
});

test('leaderboards keep bug fixing and combat separate', () => {
  const db = memoryDb();
  const coder = db.authenticate(null, 'Coder').player;
  const shooter = db.authenticate(null, 'Shooter').player;
  db.completeChallenge(coder.id, 'ghost-wall', 100, 3000, 'c');
  db.completeChallenge(coder.id, 'broken-car', 100, 9000, 'c');
  for (let i = 0; i < 5; i++) db.award(shooter.id, 'combat', `kill:${i}`, 100);
  db.addKill(shooter.id);
  db.addDeath(coder.id);
  assert.equal(db.leaderboard('bugs')[0].name, 'Coder');
  assert.equal(db.leaderboard('combat')[0].name, 'Shooter');
  assert.equal(db.leaderboard('overall')[0].name, 'Shooter');
  assert.equal(db.leaderboard('fastest')[0].value, 3000);
  assert.equal(db.leaderboard('kd')[0].name, 'Shooter');
  assert.equal(db.rank(shooter.id), 1);
  assert.equal(db.rank(coder.id), 2);
  assert.equal(db.leaderboard('nope'), null);
});

test('accuracy counts passing versus total test runs', () => {
  const db = memoryDb();
  const p = db.authenticate(null, 'Acc').player;
  db.recordAttempt(p.id, 'ghost-wall', false, 2, 8);
  db.recordAttempt(p.id, 'ghost-wall', false, 5, 8);
  db.recordAttempt(p.id, 'ghost-wall', true, 8, 8);
  assert.deepEqual(db.attemptStats(p.id), { total: 3, passed: 1 });
});
