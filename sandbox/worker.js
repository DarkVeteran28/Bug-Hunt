// Challenge sandbox worker. The main server never runs player code itself:
// it spawns this file as a separate Node process with the permission model on
// (no file writes, no child processes, no worker threads), an empty
// environment, a small heap, and a hard wall-clock kill timer.
//
// Inside this process the player's code runs in a fresh V8 realm created with
// vm.constants.DONT_CONTEXTIFY, so it has no reference to host objects such as
// `process` or `require`. String code generation (eval / new Function) is
// disabled. Arguments go in as JSON text and results come out as JSON text,
// so no host object is ever handed to player code.
import vm from 'node:vm';

const MAX_LOG_LINES = 40;
const MAX_LOG_CHARS = 4000;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('job too large'));
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function deepEqual(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return Math.abs(a - b) <= tol;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i], tol));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual(a[k], b[k], tol));
}

// Top-level consts in the prelude live in the realm's global lexical scope:
// later scripts can read them, but player code cannot reassign or redeclare
// them, so the harness keeps using the original JSON functions even if the
// player overwrites JSON.parse / JSON.stringify.
const PRELUDE = `
  'use strict';
  const __parse = JSON.parse;
  const __stringify = JSON.stringify;
  globalThis.__logs = [];
  globalThis.console = (() => {
    const fmt = (v) => {
      try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
    };
    const push = (...args) => {
      if (globalThis.__logs.length < ${MAX_LOG_LINES}) globalThis.__logs.push(args.map(fmt).join(' ').slice(0, 300));
    };
    return { log: push, info: push, warn: push, error: push, debug: push };
  })();
`;

function makeCallScript(entry, argsJson) {
  // Runs entirely inside the sandbox realm and returns a primitive string.
  return `(() => {
    let payload;
    try {
      const args = __parse(${JSON.stringify(argsJson)});
      const before = __stringify(args);
      const out = ${entry}(...args);
      if (out && typeof out.then === 'function') {
        payload = { error: 'The function must return its result directly, not a Promise.' };
      } else {
        const mutated = __stringify(args) !== before;
        payload = { out: out === undefined ? { __undefined: true } : out, mutated };
      }
    } catch (e) {
      let msg = 'Error';
      try { msg = (e && e.name ? e.name + ': ' : '') + String(e && e.message !== undefined ? e.message : e); } catch { msg = 'Unprintable error'; }
      payload = { error: msg.slice(0, 500) };
    }
    try { return __stringify(payload); } catch (e) { return '{"error":"Return value could not be serialised (circular structure?)"}'; }
  })()`;
}

function describe(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? 'undefined' : s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch {
    return String(v);
  }
}

// Errors that reach the host come from vm itself (timeouts) or from top-level
// player code. Inspect them defensively; the parent's wall-clock timer is
// the final backstop if anything misbehaves.
function isTimeout(e) {
  try { return !!e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'; } catch { return false; }
}

function safeMessage(e) {
  try {
    if (e && typeof e === 'object') return `${String(e.name || 'Error')}: ${String(e.message)}`.slice(0, 500);
    return String(e).slice(0, 500);
  } catch {
    return 'Your code threw while loading.';
  }
}

async function main() {
  const job = JSON.parse(await readStdin());
  const { code, entry, tests, perTestTimeoutMs } = job;
  if (!/^[A-Za-z_$][\w$]*$/.test(entry)) throw new Error('bad entry name');

  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    name: 'challenge-sandbox',
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  vm.runInContext(PRELUDE, context, { timeout: 200 });

  const result = { compileError: null, results: [], logs: [] };
  try {
    const script = new vm.Script(code, { filename: 'solution.js' });
    script.runInContext(context, { timeout: perTestTimeoutMs, breakOnSigint: false });
    const kind = vm.runInContext(`typeof ${entry}`, context, { timeout: 50 });
    if (kind !== 'function') {
      result.compileError = `Your code must define a function named ${entry}.`;
    }
  } catch (e) {
    result.compileError = isTimeout(e)
      ? 'Your code took too long to load (infinite loop at the top level?).'
      : safeMessage(e);
  }

  if (!result.compileError) {
    let timedOut = false;
    for (const t of tests) {
      const argsJson = JSON.stringify(t.args);
      const r = { name: t.hidden ? `Hidden test: ${t.name}` : t.name, passed: false };
      if (timedOut) {
        r.error = 'Skipped because an earlier test timed out.';
        result.results.push(r);
        continue;
      }
      try {
        const raw = vm.runInContext(makeCallScript(entry, argsJson), context, { timeout: perTestTimeoutMs });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : { error: 'Sandbox returned an unexpected value.' };
        if (parsed.error) {
          r.error = parsed.error;
        } else {
          const out = parsed.out && parsed.out.__undefined === true ? undefined : parsed.out;
          const ok = deepEqual(out, t.expected, t.tolerance ?? 1e-6);
          if (ok && t.checkArgsUnchanged && parsed.mutated) {
            r.error = 'The function modified its input. Return a new object instead.';
          } else if (ok) {
            r.passed = true;
          } else if (!t.hidden) {
            r.expected = describe(t.expected);
            r.actual = describe(out);
          } else {
            r.error = 'Hidden test failed (inputs are not shown, so hard-coding answers does not work).';
          }
        }
      } catch (e) {
        timedOut = isTimeout(e);
        r.error = timedOut ? `Timed out after ${perTestTimeoutMs} ms (infinite loop?)` : 'The sandbox stopped this test.';
      }
      result.results.push(r);
    }
  }

  try {
    const rawLogs = vm.runInContext('JSON.stringify(globalThis.__logs)', context, { timeout: 50 });
    if (typeof rawLogs === 'string') {
      const logs = JSON.parse(rawLogs);
      let budget = MAX_LOG_CHARS;
      for (const l of logs) {
        if (typeof l !== 'string' || budget <= 0) break;
        result.logs.push(l.slice(0, budget));
        budget -= l.length;
      }
    }
  } catch { /* ignore log failures */ }

  process.stdout.write(JSON.stringify(result));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ fatal: String(e && e.message) }));
  process.exitCode = 1;
});
