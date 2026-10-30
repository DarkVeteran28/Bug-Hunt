import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress } from '../engine/progression.js';
import { getWorld, districtCenterX } from '../shared/world-data.js';

test('only Ocean Drive is unlocked at the start', () => {
  const p = new Progress();
  assert.deepEqual(p.districts, ['ocean']);
  assert.deepEqual(p.weapons, ['pistol']);
  assert.equal(p.vaultOpen, false);
});

test('districts unlock in order through their mandatory challenges', () => {
  assert.deepEqual(new Progress(['invisible-gate']).districts, ['ocean', 'downtown']);
  // Solving a later gate without the earlier one does not skip ahead.
  assert.deepEqual(new Progress(['flying-car']).districts, ['ocean']);
  assert.deepEqual(new Progress(['invisible-gate', 'broken-mission', 'flying-car', 'double-score']).districts, ['ocean', 'downtown', 'port', 'neon', 'industrial']);
});

test('locked districts and the vault are not valid positions', () => {
  const p = new Progress();
  assert.equal(p.positionAllowed([districtCenterX(0), 0, 0]), true);
  assert.equal(p.positionAllowed([districtCenterX(1), 0, 0]), false);
  const all = new Progress(['invisible-gate', 'broken-mission', 'flying-car', 'double-score']);
  const vault = getWorld().vault.area;
  const inside = [(vault.min[0] + vault.max[0]) / 2, 0, (vault.min[2] + vault.max[2]) / 2];
  assert.equal(all.positionAllowed(inside), false);
});

test('the vault needs the final fix AND real progress', () => {
  const gates = ['invisible-gate', 'broken-mission', 'flying-car', 'double-score'];
  const onlyFix = new Progress([...gates, 'broken-final-gate'], []);
  assert.equal(onlyFix.vaultOpen, false, 'needs missions too');
  assert.deepEqual(onlyFix.vaultMissing, ['missions']);
  const done = new Progress([...gates, 'broken-final-gate'], ['m-ocean', 'm-downtown']);
  assert.equal(done.vaultOpen, true);
  const noFix = new Progress(gates, ['m-ocean', 'm-downtown']);
  assert.equal(noFix.vaultOpen, false);
});

test('weapons unlock from their challenges', () => {
  assert.deepEqual(new Progress(['infinite-ammo', 'broken-reload', 'faulty-checkpoint']).weapons.sort(), ['pistol', 'rifle', 'shotgun', 'smg']);
});
