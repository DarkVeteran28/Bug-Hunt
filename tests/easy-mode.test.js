import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRoom, addPlayer } from './helpers.js';
import { ChallengeManager } from '../server/challenge-manager.js';
import { CHALLENGES, CHALLENGE_LIST, publicChallenge } from '../challenges/index.js';
import { GUIDES } from '../challenges/guides.js';
import { STATIONS } from '../shared/world-data.js';
import { SCORING } from '../shared/config.js';
import { runSubmission } from '../server/sandbox-runner.js';

test('every challenge has an easy-mode guide that points at real buggy lines', () => {
  for (const c of CHALLENGE_LIST) {
    const guide = GUIDES[c.id];
    assert.ok(guide && guide.length > 0, `${c.id} has a guide`);
    for (const g of guide) {
      assert.ok(c.starterCode.includes(g.find), `${c.id}: "${g.find}" is in the starter code`);
      assert.ok(g.say.length > 10);
    }
  }
});

test('the public challenge view carries the guide but never the solution or tests', () => {
  const v = publicChallenge(CHALLENGES['ghost-wall'], 100);
  assert.equal(v.guide.length, 3);
  assert.equal(v.assistedReward, 50);
  assert.equal(v.solutionCode, undefined);
  assert.equal(v.tests, undefined);
});

async function setup(name) {
  const ctx = testRoom();
  const cm = new ChallengeManager(ctx.db, { runner: runSubmission, now: () => ctx.clock.t });
  const st = STATIONS.find((s) => s.challengeId === 'ghost-wall');
  const p = addPlayer(ctx, name, [st.pos[0], 0, st.pos[2]]);
  return { ctx, cm, p };
}

test('Show Fix needs the challenge open, and pays half the reward once', async () => {
  const { ctx, cm, p } = await setup('Learner');
  assert.equal(cm.solution(p, 'ghost-wall').ok, false, 'must open the challenge first');
  assert.equal(cm.open(p, 'ghost-wall').solutionRevealed, false);
  const s = cm.solution(p, 'ghost-wall');
  assert.equal(s.ok, true);
  assert.equal(s.code, CHALLENGES['ghost-wall'].solutionCode);
  assert.equal(cm.apply(p, 'ghost-wall').ok, false, 'revealing the fix does not skip the tests');
  assert.equal(cm.open(p, 'ghost-wall').solutionRevealed, true, 'remembered across reopen');
  const r = await cm.run(p, 'ghost-wall', s.code);
  assert.equal(r.report.passed, true);
  const a = cm.apply(p, 'ghost-wall');
  assert.equal(a.awarded, SCORING.bug.easy * SCORING.assistedFactor);
  assert.equal(a.assisted, true);
  assert.equal(cm.apply(p, 'ghost-wall').awarded, 0);
  assert.equal(ctx.db.totals(p.id).bug, SCORING.bug.easy * SCORING.assistedFactor);
  assert.equal(cm.solution(p, 'ghost-wall').ok, false, 'no fix needed once solved');
});

test('assisted fixes are left out of the fastest-fix leaderboard', async () => {
  const { ctx, cm, p } = await setup('Helped');
  cm.open(p, 'ghost-wall');
  const s = cm.solution(p, 'ghost-wall');
  await cm.run(p, 'ghost-wall', s.code);
  cm.apply(p, 'ghost-wall');
  assert.equal(ctx.db.leaderboard('fastest').length, 0);
  const st = STATIONS.find((x) => x.challengeId === 'ghost-wall');
  const q = addPlayer(ctx, 'Solo', [st.pos[0], 0, st.pos[2]]);
  cm.open(q, 'ghost-wall');
  ctx.clock.t += 60_000;
  await cm.run(q, 'ghost-wall', CHALLENGES['ghost-wall'].solutionCode);
  assert.equal(cm.apply(q, 'ghost-wall').awarded, SCORING.bug.easy, 'full reward without Show Fix');
  const board = ctx.db.leaderboard('fastest');
  assert.equal(board.length, 1);
  assert.equal(board[0].name, 'Solo');
});
