import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../engine/session.js';
import { buildSave, parseSave, validateSave, checksum } from '../engine/save.js';
import { CHALLENGES } from '../challenges/index.js';
import { STATIONS, MISSIONS } from '../shared/world-data.js';

async function playABit() {
  const s = new GameSession({});
  const st = STATIONS.find((x) => x.challengeId === 'ghost-wall');
  s.player.pos = [...st.pos];
  s.openChallenge('ghost-wall');
  await s.runTests('ghost-wall', CHALLENGES['ghost-wall'].solutionCode);
  s.applyFix('ghost-wall');
  s.closeChallenge();
  s.store.collect('chip-ocean-1', 25);
  s.player.health = 64;
  s.player.pos = [12.5, 0, -40.25];
  s.player.lastValidPos = [12.5, 0, -40.25];
  s.player.missionState['m-ocean'].step = 0;
  return s;
}

test('a save restores position, health, inventory, progress and score', async () => {
  const s = await playABit();
  const save = buildSave(s, { playTimeMs: 90_000, settings: { volume: 0.5 } });
  const text = JSON.stringify(save);
  const parsed = parseSave(text);
  assert.equal(parsed.ok, true, parsed.error);
  const r = new GameSession({ state: parsed.state });
  assert.deepEqual(r.player.pos, [12.5, 0, -40.25]);
  assert.equal(r.player.health, 64);
  assert.ok(r.progressView().solved.includes('ghost-wall'));
  assert.equal(r.statsView().chips, 1);
  assert.equal(r.scoreView().totals.total, s.scoreView().totals.total);
  assert.equal(r.store.award(null, 'bug', 'challenge:ghost-wall', 100), false, 'rewards stay paid after loading');
  assert.equal(parsed.save.playTimeMs, 90_000);
  assert.equal(parsed.save.settings.volume, 0.5);
});

test('damaged, edited or foreign saves are rejected with a reason', async () => {
  const s = await playABit();
  const good = buildSave(s);
  assert.equal(parseSave('{"format":').ok, false);
  assert.match(parseSave('{"format":').error, /not valid JSON/);
  assert.match(parseSave(JSON.stringify({ hello: 1 })).error, /Not a Vice City/);
  const edited = JSON.parse(JSON.stringify(good));
  edited.state.player.health = 100000;
  assert.match(validateSave(edited).error, /checksum/);
  // Re-sign an invalid state: validation still catches it.
  const resigned = JSON.parse(JSON.stringify(good));
  resigned.state.player.pos = [1e9, 0, 0];
  resigned.checksum = checksum(JSON.stringify(resigned.state));
  assert.match(validateSave(resigned).error, /outside the city/);
  const unknown = JSON.parse(JSON.stringify(good));
  unknown.state.store.completions['not-a-bug'] = { points: 1, code: '' };
  unknown.checksum = checksum(JSON.stringify(unknown.state));
  assert.equal(validateSave(unknown).ok, false);
  const future = { ...good, version: 99 };
  assert.match(validateSave(future).error, /not supported/);
});

test('a save made while down restores a living player', async () => {
  const s = await playABit();
  s.playerDown(null);
  const parsed = parseSave(JSON.stringify(buildSave(s)));
  assert.equal(parsed.ok, true, parsed.error);
  const r = new GameSession({ state: parsed.state });
  assert.equal(r.player.alive, true);
  assert.equal(r.player.health, 100);
});

test('mission progress and enemy deaths survive a save', async () => {
  const s = await playABit();
  s.player.missionState['m-downtown'] = { step: 1, courier: 'delivering' };
  s.enemies.enemies[0].alive = false;
  s.enemies.enemies[0].respawnAt = s.clockMs + 10_000;
  const r = new GameSession({ state: parseSave(JSON.stringify(buildSave(s))).state });
  assert.deepEqual(r.player.missionState['m-downtown'], { step: 1, courier: 'delivering' });
  assert.equal(r.enemies.enemies[0].alive, false);
  assert.equal(MISSIONS.length, Object.keys(r.player.missionState).length);
});

test('parked car positions are saved and checked', async () => {
  const s = await playABit();
  s.vehiclePoses = [[10.123, 0, 5, 1.5]];
  const p = parseSave(JSON.stringify(buildSave(s)));
  assert.equal(p.ok, true, p.error);
  assert.deepEqual(new GameSession({ state: p.state }).vehiclePoses, [[10.12, 0, 5, 1.5]]);
  const bad = buildSave(s);
  bad.state.vehicles = [[1, 2, 'x', 4]];
  bad.checksum = checksum(JSON.stringify(bad.state));
  assert.match(validateSave(bad).error, /vehicle/);
});
