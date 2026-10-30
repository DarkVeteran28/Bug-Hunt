import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES } from '../challenges/index.js';
import { runTests, deepEqual } from '../engine/challenge-tests.js';

const c = CHALLENGES['ghost-wall'];
const run = (code, ch = c) => runTests({ code, entry: ch.entry, tests: ch.tests });

test('the reference fix passes and the seeded bug fails', () => {
  assert.equal(run(c.solutionCode).passed, true);
  const bad = run(c.starterCode);
  assert.equal(bad.passed, false);
  assert.ok(bad.passedCount < bad.total);
});

test('syntax errors and a missing entry function are reported, not passed', () => {
  const syntax = run('function aabbOverlap( {');
  assert.equal(syntax.passed, false);
  assert.match(syntax.compileError, /SyntaxError/);
  const missing = run('function somethingElse() { return true; }');
  assert.equal(missing.passed, false);
  assert.match(missing.compileError, /must define a function named aabbOverlap/);
});

test('visible failures show expected and received values; hidden ones do not', () => {
  const r = run('function aabbOverlap() { return false; }');
  const visibleFail = r.results.find((x) => !x.passed && !x.name.startsWith('Hidden'));
  assert.ok(visibleFail.expected !== undefined && visibleFail.actual !== undefined);
  const hiddenFail = r.results.find((x) => !x.passed && x.name.startsWith('Hidden'));
  if (hiddenFail) {
    assert.equal(hiddenFail.expected, undefined);
    assert.match(hiddenFail.error, /Hidden test failed/);
  }
});

test('thrown errors and console output are captured per run', () => {
  const r = run('function aabbOverlap() { console.log("hello", 1); throw new TypeError("boom"); }');
  assert.equal(r.passed, false);
  assert.match(r.results[0].error, /TypeError: boom/);
  assert.equal(r.logs[0], 'hello 1');
});

test('a function that returns a Promise is rejected', () => {
  const r = run('async function aabbOverlap() { return true; }');
  assert.equal(r.passed, false);
  assert.match(r.results[0].error, /Promise/);
});

test('mutating the input is caught where a test forbids it', () => {
  const ds = CHALLENGES['double-score'];
  if (!ds.tests.some((t) => t.checkArgsUnchanged)) return;
  const mutating = ds.solutionCode.replace('const completed = [...ledger.completed];', 'const completed = ledger.completed;');
  assert.equal(run(mutating, ds).passed, false);
});

test('deepEqual uses a numeric tolerance and strict structure', () => {
  assert.equal(deepEqual({ a: [1, 2.0000001] }, { a: [1, 2] }, 1e-6), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: undefined }, 1e-6), false);
  assert.equal(deepEqual(NaN, NaN, 1e-6), false);
});
