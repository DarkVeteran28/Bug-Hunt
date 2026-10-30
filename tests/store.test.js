import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../engine/store.js';

test('a reward with the same reference is only paid once', () => {
  const s = new GameStore();
  assert.equal(s.award(null, 'combat', 'kill:1', 50), true);
  assert.equal(s.award(null, 'combat', 'kill:1', 50), false);
  assert.equal(s.totals().combat, 50);
});

test('challenge completions and missions pay once, into the right bucket', () => {
  const s = new GameStore();
  assert.equal(s.completeChallenge(null, 'ghost-wall', 100, 5000, 'code'), true);
  assert.equal(s.completeChallenge(null, 'ghost-wall', 100, 5000, 'code'), false);
  assert.equal(s.completeMission(null, 'm-ocean', 150), true);
  assert.equal(s.completeMission(null, 'm-ocean', 150), false);
  assert.deepEqual(s.totals(), { total: 250, bug: 100, combat: 0, other: 150 });
});

test('negative or invalid amounts are refused', () => {
  const s = new GameStore();
  assert.equal(s.award(null, 'bug', 'x', -500), false);
  assert.equal(s.award(null, 'bug', 'y', NaN), false);
  assert.equal(s.totals().total, 0);
});

test('collectibles are counted once', () => {
  const s = new GameStore();
  assert.equal(s.collect('chip-ocean-1', 25), true);
  assert.equal(s.collect('chip-ocean-1', 25), false);
  assert.deepEqual(s.collected(), ['chip-ocean-1']);
  assert.equal(s.totals().other, 25);
});

test('records survive a JSON round trip', () => {
  const s = new GameStore();
  s.completeChallenge(null, 'broken-car', 100, 1, 'x');
  s.addKill();
  const copy = new GameStore(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(copy.totals().bug, 100);
  assert.equal(copy.stats().kills, 1);
  assert.equal(copy.award(null, 'bug', 'challenge:broken-car', 100), false, 'paid refs are remembered');
});
