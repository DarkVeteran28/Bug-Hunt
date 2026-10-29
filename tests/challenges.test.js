import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGE_LIST, CHALLENGES, publicChallenge } from '../challenges/index.js';
import { STATIONS, DISTRICTS } from '../shared/world-data.js';
import { runSubmission } from '../server/sandbox-runner.js';

test('there are at least twelve distinct challenges', () => {
  assert.ok(CHALLENGE_LIST.length >= 12);
  assert.equal(new Set(CHALLENGE_LIST.map((c) => c.id)).size, CHALLENGE_LIST.length);
  assert.equal(new Set(CHALLENGE_LIST.map((c) => c.starterCode)).size, CHALLENGE_LIST.length);
});

test('every challenge has a station, tests, hints and a valid difficulty', () => {
  for (const c of CHALLENGE_LIST) {
    assert.ok(STATIONS.some((s) => s.challengeId === c.id), `${c.id} has a station`);
    assert.ok(c.tests.length >= 5, `${c.id} has at least 5 tests`);
    assert.ok(c.tests.some((t) => t.hidden), `${c.id} has hidden tests`);
    assert.ok(c.hints.length >= 2);
    assert.ok(['easy', 'medium', 'hard', 'expert'].includes(c.difficulty));
  }
});

test('every district has its mandatory challenge in that district', () => {
  for (const d of DISTRICTS) {
    const c = CHALLENGES[d.mandatory];
    assert.ok(c, `${d.id} mandatory exists`);
    assert.equal(c.district, d.id);
    assert.equal(c.mandatory, true);
  }
});

test('the public view never leaks tests, hints or solutions', () => {
  for (const c of CHALLENGE_LIST) {
    const pub = publicChallenge(c, 100);
    const json = JSON.stringify(pub);
    assert.equal(pub.tests, undefined);
    assert.equal(pub.solutionCode, undefined);
    assert.equal(pub.hints, undefined);
    assert.ok(!json.includes(c.solutionCode.trim().slice(0, 60)) || c.starterCode.includes(c.solutionCode.trim().slice(0, 60)));
    for (const t of c.tests.filter((x) => x.hidden)) assert.ok(!json.includes(t.name));
  }
});

for (const c of CHALLENGE_LIST) {
  test(`${c.id}: reference solution passes and the seeded bug fails`, async () => {
    const good = await runSubmission(c, c.solutionCode);
    assert.equal(good.passed, true, JSON.stringify(good.results.filter((r) => !r.passed)));
    const bad = await runSubmission(c, c.starterCode);
    assert.equal(bad.passed, false);
    assert.ok(bad.passedCount < bad.total);
  });
}
