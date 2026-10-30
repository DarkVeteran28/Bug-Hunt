// Browser test runner for the bug challenges. Each run gets a fresh Web
// Worker. A watchdog terminates the worker if the code loads or runs a test
// for too long (an infinite loop), and the report says which test hung.
import { finish } from '../../engine/challenge-tests.js';
import { SANDBOX } from '../../shared/config.js';

const COMPILE_TIMEOUT_MS = SANDBOX.compileTimeoutMs;
const TEST_TIMEOUT_MS = SANDBOX.testTimeoutMs;

export function runSubmission(challenge, code) {
  const started = Date.now();
  const tests = challenge.tests;
  if (typeof code !== 'string') return Promise.resolve(finish({ fatal: 'Code must be text.', results: [], logs: [] }, tests, started));
  if (new Blob([code]).size > SANDBOX.maxCodeBytes) {
    return Promise.resolve(finish({ fatal: `Code is larger than ${SANDBOX.maxCodeBytes} bytes.`, results: [], logs: [] }, tests, started));
  }
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./sandbox-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      resolve(finish({ fatal: `Could not start the test runner: ${e.message}`, results: [], logs: [] }, tests, started));
      return;
    }
    const results = [];
    let current = -1;
    let timer = null;
    let done = false;
    const end = (raw) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(finish(raw, tests, started));
    };
    const watch = (ms, onTimeout) => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, ms);
    };
    watch(COMPILE_TIMEOUT_MS, () => end({ compileError: 'Your code took too long to load (infinite loop at the top level?).', results: [], logs: [] }));
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'compiled') clearTimeout(timer);
      else if (m.type === 'start') {
        current = m.i;
        watch(TEST_TIMEOUT_MS, () => {
          for (let i = current; i < tests.length; i++) {
            const t = tests[i];
            results[i] = { name: t.hidden ? `Hidden test: ${t.name}` : t.name, passed: false, error: i === current ? `Timed out after ${TEST_TIMEOUT_MS} ms (infinite loop?)` : 'Skipped because an earlier test timed out.' };
          }
          end({ compileError: null, results, logs: [] });
        });
      } else if (m.type === 'result') {
        clearTimeout(timer);
        results[m.i] = m.row;
      } else if (m.type === 'done') end({ compileError: m.compileError, results, logs: m.logs || [] });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      end({ fatal: `The test runner stopped: ${e.message || 'unknown error'}`, results, logs: [] });
    };
    worker.postMessage({ code, entry: challenge.entry, tests });
  });
}
