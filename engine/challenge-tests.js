// Runs a challenge's tests against a piece of code and builds the report the
// debugger shows. In the browser this runs inside a Web Worker
// (client/src/sandbox-worker.js), so an infinite loop in player code can be
// stopped by terminating the worker without freezing the game.

const parse = JSON.parse;
const stringify = JSON.stringify;
const MAX_LOG_LINES = 40;

export function deepEqual(a, b, tol) {
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

export function describe(v) {
  try {
    const s = stringify(v);
    return s === undefined ? 'undefined' : s.length > 400 ? `${s.slice(0, 400)}…` : s;
  } catch {
    return String(v);
  }
}

function errorText(e) {
  try {
    return `${e && e.name ? `${e.name}: ` : ''}${String(e && e.message !== undefined ? e.message : e)}`.slice(0, 500);
  } catch {
    return 'Unprintable error';
  }
}

/** Compile the player's code and return the entry function, or { error }. */
export function compileEntry(code, entry, logs) {
  if (!/^[A-Za-z_$][\w$]*$/.test(entry)) return { error: 'Bad entry name.' };
  const fmt = (v) => {
    try {
      return typeof v === 'string' ? v : stringify(v);
    } catch {
      return String(v);
    }
  };
  const push = (...args) => {
    if (logs.length < MAX_LOG_LINES) logs.push(args.map(fmt).join(' ').slice(0, 300));
  };
  const consoleShim = { log: push, info: push, warn: push, error: push, debug: push };
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('console', `'use strict';\n${code}\n;return typeof ${entry} === 'function' ? ${entry} : undefined;`)(consoleShim);
    if (typeof fn !== 'function') return { error: `Your code must define a function named ${entry}.` };
    return { fn };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Run one test. Returns the result row for the report. */
export function runOneTest(fn, t) {
  const r = { name: t.hidden ? `Hidden test: ${t.name}` : t.name, passed: false };
  const argsJson = stringify(t.args);
  try {
    const args = parse(argsJson);
    const out = fn(...args);
    if (out && typeof out.then === 'function') {
      r.error = 'The function must return its result directly, not a Promise.';
      return r;
    }
    // Round-trip through JSON, as a save file or the game would see it.
    let clean;
    try {
      clean = out === undefined ? undefined : parse(stringify(out));
    } catch {
      r.error = 'Return value could not be serialised (circular structure?)';
      return r;
    }
    const ok = deepEqual(clean, t.expected, t.tolerance ?? 1e-6);
    if (ok && t.checkArgsUnchanged && stringify(args) !== argsJson) {
      r.error = 'The function modified its input. Return a new object instead.';
    } else if (ok) {
      r.passed = true;
    } else if (!t.hidden) {
      r.expected = describe(t.expected);
      r.actual = describe(clean);
    } else {
      r.error = 'Hidden test failed (its inputs are not shown, so check edge cases).';
    }
  } catch (e) {
    r.error = errorText(e);
  }
  return r;
}

/** Run every test synchronously (used by the worker and by Node tests). */
export function runTests({ code, entry, tests }) {
  const started = Date.now();
  const logs = [];
  const compiled = compileEntry(code, entry, logs);
  if (compiled.error) return finish({ compileError: compiled.error, results: [], logs }, tests, started);
  const results = tests.map((t) => runOneTest(compiled.fn, t));
  return finish({ compileError: null, results, logs }, tests, started);
}

export function finish(raw, tests, started) {
  const passedCount = raw.results.filter((r) => r.passed).length;
  return {
    ...raw,
    total: tests.length,
    passedCount,
    passed: !raw.compileError && !raw.fatal && passedCount === tests.length,
    ms: Date.now() - started,
  };
}
