import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRoom, addPlayer, solve } from './helpers.js';
import { districtCenterX, MISSIONS, MISSION_NPCS, VEHICLE_SPAWNS } from '../shared/world-data.js';
import { ChallengeManager } from '../server/challenge-manager.js';
import { STATIONS } from '../shared/world-data.js';
import { SCORING } from '../shared/config.js';

function walk(ctx, p, to, stepUnits = 0.4) {
  for (let i = 0; i < 5000; i++) {
    const dx = to[0] - p.pos[0];
    const dz = to[2] - p.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const s = Math.min(stepUnits, d);
    ctx.clock.t += 60;
    if (!ctx.room.handleState(p, { p: [p.pos[0] + (dx / d) * s, to[1], p.pos[2] + (dz / d) * s], ry: 0 })) return false;
  }
  return false;
}

test('normal movement is accepted, teleports are corrected', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Mover', [30, 0, -40]);
  ctx.clock.t += 100;
  assert.equal(ctx.room.handleState(p, { p: [30.5, 0, -40], ry: 0 }), true);
  ctx.clock.t += 50;
  assert.equal(ctx.room.handleState(p, { p: [90, 0, -40], ry: 0 }), false);
  assert.deepEqual(p.pos, [30.5, 0, -40]);
  assert.ok(ctx.sent.some((s) => s.event === 'correction' && s.data.reason === 'speed'));
});

test('malformed state messages are ignored', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Bad', [30, 0, -40]);
  for (const m of [null, {}, { p: [1, 2] }, { p: [NaN, 0, 0] }, { p: 'x' }]) assert.equal(ctx.room.handleState(p, m), false);
});

test('walking into a locked district is refused', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Explorer', [districtCenterX(0) + 85, 0, -10]);
  const ok = walk(ctx, p, [districtCenterX(1) - 80, 0, -10]);
  assert.equal(ok, false);
  assert.ok(p.pos[0] < districtCenterX(0) + 90.5);
  assert.ok(ctx.sent.some((s) => s.event === 'correction' && s.data.reason === 'locked'));
  // After the mandatory fix, the same walk works.
  solve(ctx, p, ['invisible-gate']);
  assert.equal(walk(ctx, p, [districtCenterX(1) - 80, 0, -10]), true);
});

test('falling out of the world respawns without counting a death', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Faller', [30, 0, -95]);
  ctx.clock.t += 100;
  for (let y = -1; y > -25; y -= 2) {
    ctx.clock.t += 100;
    ctx.room.handleState(p, { p: [30, y, -101], ry: 0 });
  }
  assert.ok(ctx.sent.some((s) => s.event === 'respawn' && s.data.reason === 'fell'));
  assert.equal(ctx.db.stats(p.id).deaths, 0);
  assert.ok(p.pos[1] >= 0);
});

test('cars stay jammed until Broken Car is fixed, then follow the approved rule', () => {
  const ctx = testRoom();
  const car = VEHICLE_SPAWNS[0];
  const p = addPlayer(ctx, 'Driver', [car.pos[0] + 2, 0, car.pos[2]]);
  const q = addPlayer(ctx, 'Other', [car.pos[0] - 2, 0, car.pos[2]]);
  assert.match(ctx.room.enterVehicle(p, car.id).error, /jammed/);
  solve(ctx, p, ['broken-car']);
  solve(ctx, q, ['broken-car']);
  assert.equal(ctx.room.enterVehicle(p, car.id).ok, true);
  assert.equal(ctx.room.enterVehicle(q, car.id).ok, false, 'occupied');
  ctx.room.exitVehicle(p);
  q.pos = [car.pos[0] + 40, 0, car.pos[2]];
  assert.equal(ctx.room.enterVehicle(q, car.id).ok, false, 'too far');
});

test('the pier mission completes from validated movement and pays once', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Tourist', [districtCenterX(0) + 30, 0, -80]);
  const m = MISSIONS.find((x) => x.id === 'm-ocean');
  assert.equal(walk(ctx, p, [m.steps[0].pos[0], 0, m.steps[0].pos[2]]), true);
  assert.ok(p.progress.missions.has('m-ocean'));
  assert.equal(ctx.db.totals(p.id).other, m.reward);
  // Coming back again does not pay again.
  walk(ctx, p, [districtCenterX(0) + 30, 0, -90]);
  walk(ctx, p, [m.steps[0].pos[0], 0, m.steps[0].pos[2]]);
  assert.equal(ctx.db.totals(p.id).other, m.reward);
});

test('the courier mission is stuck until Broken Mission is fixed', () => {
  const ctx = testRoom();
  const [rico, vera] = MISSION_NPCS;
  const p = addPlayer(ctx, 'Courier', [rico.pos[0] + 1, 0, rico.pos[2]]);
  solve(ctx, p, ['invisible-gate']);
  ctx.room.missions.talk(p, rico.id);
  p.pos = [vera.pos[0] + 1, 0, vera.pos[2]];
  const ev = ctx.room.missions.talk(p, vera.id);
  assert.ok(ev.some((e) => e.type === 'mission-blocked'));
  assert.equal(p.progress.missions.has('m-downtown'), false);
  solve(ctx, p, ['broken-mission']);
  const ev2 = ctx.room.missions.talk(p, vera.id);
  assert.ok(ev2.some((e) => e.type === 'mission-complete'));
  // Talking from far away does nothing.
  p.pos = [vera.pos[0] + 30, 0, vera.pos[2]];
  assert.equal(ctx.room.missions.talk(p, vera.id)[0].type, 'error');
});

test('Neon Run checkpoints need the Faulty Checkpoint fix', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Runner', [0, 0, 0]);
  solve(ctx, p, ['invisible-gate', 'broken-mission', 'flying-car']);
  const cp = MISSIONS.find((m) => m.id === 'm-neon').steps[0].pos;
  p.pos = [...cp];
  p.lastValidPos = [...cp];
  ctx.room.missions.onPosition(p);
  assert.equal(p.missionState['m-neon'].step, 0, 'buggy detector never triggers');
  solve(ctx, p, ['faulty-checkpoint']);
  ctx.room.missions.onPosition(p);
  assert.equal(p.missionState['m-neon'].step, 1);
});

test('challenge flow: proximity, verification, single payout', async () => {
  const ctx = testRoom();
  let pass = false;
  const runner = async (c) => ({ passed: pass, total: c.tests.length, passedCount: pass ? c.tests.length : 0, results: [] });
  const cm = new ChallengeManager(ctx.db, { runner, now: () => ctx.clock.t });
  const st = STATIONS.find((s) => s.challengeId === 'ghost-wall');
  const p = addPlayer(ctx, 'Debugger', [st.pos[0] + 40, 0, st.pos[2]]);
  assert.equal(cm.open(p, 'ghost-wall').ok, false, 'too far from the station');
  p.pos = [st.pos[0] + 1, 0, st.pos[2]];
  assert.equal(cm.open(p, 'broken-mission').ok, false, 'district locked');
  assert.equal(cm.open(p, 'ghost-wall').ok, true);
  assert.equal(cm.apply(p, 'ghost-wall').ok, false, 'cannot apply without passing tests');
  let r = await cm.run(p, 'ghost-wall', 'function aabbOverlap(){return false}');
  assert.equal(r.report.passed, false);
  assert.equal(cm.apply(p, 'ghost-wall').ok, false);
  assert.equal(ctx.db.totals(p.id).total, 0, 'failed tests award nothing');
  pass = true;
  ctx.clock.t += 30_000;
  r = await cm.run(p, 'ghost-wall', 'function aabbOverlap(){return true}');
  assert.equal(r.report.passed, true);
  const a1 = cm.apply(p, 'ghost-wall');
  assert.equal(a1.awarded, SCORING.bug.easy);
  const a2 = cm.apply(p, 'ghost-wall');
  assert.equal(a2.awarded, 0);
  assert.equal(ctx.db.totals(p.id).bug, SCORING.bug.easy);
  assert.ok(p.progress.isSolved('ghost-wall'));
});

test('test runs are rate limited per player', async () => {
  const ctx = testRoom();
  const runner = async (c) => ({ passed: false, total: c.tests.length, passedCount: 0, results: [] });
  const cm = new ChallengeManager(ctx.db, { runner, now: () => ctx.clock.t });
  const st = STATIONS.find((s) => s.challengeId === 'ghost-wall');
  const p = addPlayer(ctx, 'Spammer', [st.pos[0], 0, st.pos[2]]);
  cm.open(p, 'ghost-wall');
  let limited = false;
  for (let i = 0; i < 10; i++) {
    const r = await cm.run(p, 'ghost-wall', 'function aabbOverlap(){}');
    if (!r.ok && /Slow down/.test(r.error)) limited = true;
  }
  assert.equal(limited, true);
});

test('arena rounds pay the winner once and reset session scores', () => {
  const ctx = testRoom({ mode: 'arena' });
  const a = addPlayer(ctx, 'Winner', [30, 0, -60]);
  addPlayer(ctx, 'Loser', [30, 0, -50]);
  a.session.combatPoints = 300;
  ctx.clock.t = ctx.room.round.endsAt + 1;
  ctx.room.tick();
  assert.equal(ctx.db.totals(a.id).other, SCORING.arenaRoundWin);
  assert.equal(a.session.combatPoints, 0);
  assert.ok(ctx.sent.some((s) => s.event === 'round-end' && s.data.winner.name === 'Winner'));
});

test('disconnected players are kept for the grace period, then removed', () => {
  const ctx = testRoom();
  const p = addPlayer(ctx, 'Flaky', [30, 0, -40]);
  ctx.room.disconnect(p);
  ctx.clock.t += 5000;
  ctx.room.tick();
  assert.ok(ctx.room.players.has(p.id));
  const { player } = ctx.room.join(ctx.db.getPlayer(p.id), { id: 'new', emit() {}, leave() {}, data: {} });
  assert.equal(player, p, 'same state resumed');
  ctx.room.disconnect(p);
  ctx.clock.t += 31_000;
  ctx.room.tick();
  assert.equal(ctx.room.players.has(p.id), false);
});
