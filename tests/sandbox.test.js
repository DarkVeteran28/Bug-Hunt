import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES } from '../challenges/index.js';
import { runSubmission } from '../server/sandbox-runner.js';
import { SANDBOX } from '../shared/config.js';

const c = CHALLENGES['ghost-wall'];
const run = (code) => runSubmission(c, code);

test('infinite loops time out and do not pass', async () => {
  const r = await run('function aabbOverlap() { while (true) {} }');
  assert.equal(r.passed, false);
  assert.match(r.results[0].error, /Timed out/);
});

test('player code cannot reach process, require or the host realm', async () => {
  for (const body of [
    'return typeof process !== "undefined" || typeof require !== "undefined"',
    'return this.constructor.constructor("return process")()',
    'return Object.getPrototypeOf(a).constructor.constructor("return process")()',
    'return eval("1+1") === 2',
    'return (async function(){}).constructor("return process")()',
  ]) {
    const r = await run(`function aabbOverlap(a, b) { ${body}; }`);
    assert.equal(r.passed, false, body);
  }
  const escape = await run('function aabbOverlap(a) { try { return String(a.constructor.constructor("return process")()); } catch (e) { return e.name; } }');
  assert.equal(escape.results[0].actual, '"EvalError"');
  const probe = await run('function aabbOverlap() { return typeof process + "|" + typeof require + "|" + typeof fetch + "|" + typeof setTimeout; }');
  assert.match(probe.results[0].actual, /"undefined\|undefined\|undefined\|undefined"/);
});

test('memory bombs are stopped', async () => {
  const r = await run('function aabbOverlap() { const a = []; while (true) a.push(new Array(1e6).fill(1)); }');
  assert.equal(r.passed, false);
});

test('top-level crashes and syntax errors are reported, not passed', async () => {
  const syntax = await run('function aabbOverlap( {');
  assert.equal(syntax.passed, false);
  assert.match(syntax.compileError, /SyntaxError/);
  const missing = await run('function somethingElse() { return true; }');
  assert.equal(missing.passed, false);
  assert.match(missing.compileError, /aabbOverlap/);
});

test('oversized code is rejected before it runs', async () => {
  const r = await run(`function aabbOverlap() { return true; }\n//${'x'.repeat(SANDBOX.maxCodeBytes)}`);
  assert.equal(r.passed, false);
  assert.match(r.fatal, /larger/);
});

test('overwriting JSON inside the sandbox cannot forge results', async () => {
  const r = await run(`JSON.stringify = () => '{"out":true,"mutated":false}';
JSON.parse = () => [];
function aabbOverlap() { return false; }`);
  assert.equal(r.passed, false);
});

test('hard-coding visible answers does not pass hidden tests', async () => {
  // Answers for the visible tests only, in order.
  const visible = c.tests.filter((t) => !t.hidden).map((t) => JSON.stringify(t.expected));
  const code = `let i = 0; const answers = [${visible.join(',')}]; function aabbOverlap() { return answers[i++ % answers.length]; }`;
  const r = await run(code);
  assert.equal(r.passed, false);
  const hidden = r.results.filter((x) => x.name.startsWith('Hidden test'));
  assert.ok(hidden.length > 0);
  for (const h of hidden.filter((x) => !x.passed)) assert.equal(h.expected, undefined, 'hidden expectations are not revealed');
});

test('console output is captured and returned', async () => {
  const r = await run('function aabbOverlap(a, b) { console.log("checking", a.min.x); return false; }');
  assert.ok(r.logs.some((l) => l.startsWith('checking')));
});
