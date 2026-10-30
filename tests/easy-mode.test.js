import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../engine/session.js';
import { CHALLENGES, CHALLENGE_LIST, publicChallenge } from '../challenges/index.js';
import { GUIDES } from '../challenges/guides.js';
import { STATIONS } from '../shared/world-data.js';
import { SCORING } from '../shared/config.js';

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

test('the public challenge view carries the guide but not the solution or tests', () => {
  const v = publicChallenge(CHALLENGES['ghost-wall'], 100);
  assert.equal(v.guide.length, 3);
  assert.equal(v.assistedReward, 50);
  assert.equal(v.solutionCode, undefined);
  assert.equal(v.tests, undefined);
});

function atStation(id) {
  const s = new GameSession({});
  const st = STATIONS.find((x) => x.challengeId === id);
  s.player.pos = [...st.pos];
  return s;
}

test('Show Fix needs the challenge open, and pays half the reward once', async () => {
  const s = atStation('ghost-wall');
  assert.equal(s.solution('ghost-wall').ok, false, 'must open the challenge first');
  assert.equal(s.openChallenge('ghost-wall').solutionRevealed, false);
  const sol = s.solution('ghost-wall');
  assert.equal(sol.ok, true);
  assert.equal(sol.code, CHALLENGES['ghost-wall'].solutionCode);
  assert.equal(s.applyFix('ghost-wall').ok, false, 'revealing the fix does not skip the tests');
  assert.equal(s.openChallenge('ghost-wall').solutionRevealed, true, 'remembered across reopen');
  const r = await s.runTests('ghost-wall', sol.code);
  assert.equal(r.report.passed, true);
  const a = s.applyFix('ghost-wall');
  assert.equal(a.awarded, SCORING.bug.easy * SCORING.assistedFactor);
  assert.equal(a.assisted, true);
  assert.equal(s.applyFix('ghost-wall').awarded, 0);
  assert.equal(s.scoreView().totals.bug, SCORING.bug.easy * SCORING.assistedFactor);
  assert.equal(s.solution('ghost-wall').ok, false, 'no fix needed once solved');
});

test('fixing a bug yourself pays the full reward', async () => {
  const s = atStation('ghost-wall');
  s.openChallenge('ghost-wall');
  await s.runTests('ghost-wall', CHALLENGES['ghost-wall'].solutionCode);
  assert.equal(s.applyFix('ghost-wall').awarded, SCORING.bug.easy);
  assert.equal(s.statsView().assistedFixes, 0);
});
