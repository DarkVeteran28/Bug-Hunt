// Runs a player's code against a challenge's tests in a Web Worker, so the
// page stays responsive and an infinite loop can be stopped by terminating
// the worker. Results are posted back one test at a time.
import { compileEntry, runOneTest } from '../../engine/challenge-tests.js';

self.onmessage = (ev) => {
  const { code, entry, tests } = ev.data;
  const logs = [];
  const compiled = compileEntry(code, entry, logs);
  if (compiled.error) {
    self.postMessage({ type: 'done', compileError: compiled.error, logs });
    return;
  }
  self.postMessage({ type: 'compiled' });
  for (let i = 0; i < tests.length; i++) {
    self.postMessage({ type: 'start', i });
    self.postMessage({ type: 'result', i, row: runOneTest(compiled.fn, tests[i]) });
  }
  self.postMessage({ type: 'done', compileError: null, logs });
};
