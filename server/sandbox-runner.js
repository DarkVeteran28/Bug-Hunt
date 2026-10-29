// Runs untrusted challenge submissions in a separate, locked-down Node
// process (see sandbox/worker.js). The multiplayer server only ever sees the
// JSON test report that comes back.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SANDBOX } from '../shared/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(here, '../sandbox/worker.js');

const MAX_CONCURRENT = 3;
let running = 0;
const queue = [];

function nodeFlags() {
  return [
    '--permission',
    `--allow-fs-read=${WORKER}`,
    `--max-old-space-size=${SANDBOX.memoryLimitMb}`,
    '--stack-size=900',
    '--no-warnings',
    '--disallow-code-generation-from-strings',
    WORKER,
  ];
}

function runOnce(job) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, nodeFlags(), {
      env: {},
      cwd: path.dirname(WORKER),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let killedForTime = false;
    const timer = setTimeout(() => {
      killedForTime = true;
      child.kill('SIGKILL');
    }, SANDBOX.processTimeoutMs);
    child.stdout.on('data', (c) => {
      out += c;
      if (out.length > 300_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (c) => {
      if (err.length < 10_000) err += c;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ fatal: `Sandbox failed to start: ${e.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (killedForTime) return resolve({ fatal: `Your submission ran too long and was stopped after ${SANDBOX.processTimeoutMs} ms.`, ms });
      if (/heap out of memory|Allocation failed/i.test(err)) return resolve({ fatal: `Your submission used more than ${SANDBOX.memoryLimitMb} MB of memory and was stopped.`, ms });
      try {
        const parsed = JSON.parse(out);
        parsed.ms = ms;
        return resolve(parsed);
      } catch {
        return resolve({ fatal: `The sandbox crashed (exit ${code ?? signal}).`, ms });
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(job));
  });
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const { job, resolve } = queue.shift();
    running++;
    runOnce(job).then((r) => {
      running--;
      resolve(r);
      pump();
    });
  }
}

/**
 * Evaluate player code against a challenge's tests.
 * Resolves to { passed, total, passedCount, results, logs, compileError?, fatal? }.
 */
export function runSubmission(challenge, code) {
  if (typeof code !== 'string') return Promise.resolve({ passed: false, fatal: 'Code must be text.' });
  if (Buffer.byteLength(code, 'utf8') > SANDBOX.maxCodeBytes) {
    return Promise.resolve({ passed: false, fatal: `Code is larger than ${SANDBOX.maxCodeBytes} bytes.` });
  }
  if (queue.length > 50) return Promise.resolve({ passed: false, fatal: 'The test runner is busy. Try again in a moment.' });
  const job = {
    code,
    entry: challenge.entry,
    tests: challenge.tests.map((t) => ({ name: t.name, args: t.args, expected: t.expected, tolerance: t.tolerance, checkArgsUnchanged: !!t.checkArgsUnchanged, hidden: !!t.hidden })),
    perTestTimeoutMs: SANDBOX.perTestTimeoutMs,
  };
  return new Promise((resolve) => {
    queue.push({ job, resolve });
    pump();
  }).then((r) => {
    const results = Array.isArray(r.results) ? r.results : [];
    const passedCount = results.filter((x) => x.passed === true).length;
    const total = challenge.tests.length;
    // Every expected test must be present and passing; the runner cannot
    // shorten the list.
    const passed = !r.fatal && !r.compileError && results.length === total && passedCount === total;
    return { passed, total, passedCount, results, logs: r.logs || [], compileError: r.compileError || null, fatal: r.fatal || null, ms: r.ms };
  });
}
