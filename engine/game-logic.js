// Game rules backed by challenge code. Both versions compiled here are the
// game's own code (the seeded buggy starter and the approved reference),
// never player submissions; player code runs in the test sandbox and, once
// verified, in the visual effects (client/src/challenge-runtime.js).
//
// Rule of thumb: a buggy rule may make the game more restrictive for a player
// who has not fixed it yet, but it can never grant something the approved
// rule would refuse. So an unsolved check is `buggy(...) && approved(...)`.
import { CHALLENGES } from '../challenges/index.js';

const compiled = new Map();

function compile(source, entry) {
  // eslint-disable-next-line no-new-func
  return new Function(`'use strict';\n${source}\nreturn ${entry};`)();
}

function impls(id) {
  if (!compiled.has(id)) {
    const c = CHALLENGES[id];
    if (!c) throw new Error(`unknown challenge ${id}`);
    compiled.set(id, { buggy: compile(c.starterCode, c.entry), approved: compile(c.solutionCode, c.entry) });
  }
  return compiled.get(id);
}

export function approved(id) {
  return impls(id).approved;
}

export function buggy(id) {
  return impls(id).buggy;
}

/** Boolean rule: approved when solved, otherwise buggy AND approved. */
export function rule(id, solved, ...args) {
  const { buggy: b, approved: a } = impls(id);
  if (solved) return !!a(...args);
  let buggyResult = false;
  try {
    buggyResult = !!b(...args);
  } catch {
    buggyResult = false;
  }
  return buggyResult && !!a(...args);
}

/** State-machine rule (courier mission). Unsolved players get the buggy transition. */
export function transition(id, solved, state, event) {
  const { buggy: b, approved: a } = impls(id);
  const next = solved ? a(state, event) : b(state, event);
  // Never let the buggy machine reach a state the approved one would not.
  if (!solved && next !== a(state, event)) return state;
  return next;
}
