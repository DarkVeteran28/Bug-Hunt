// Runs challenge functions inside the game on THIS client only.
// Before a fix: the seeded buggy starter code (the same code shown in the editor).
// After a verified fix: the player's own verified code, sent back by the server.
// Code runs in the player's own browser and only affects what they see;
// anything competitive or security-relevant is decided by the server.
const compiled = new Map(); // id -> { source, fn }
const starters = new Map(); // id -> { code, entry }
const verified = new Map(); // id -> code
const warned = new Set();
let onError = () => {};

export function setErrorHandler(fn) {
  onError = fn;
}

export function registerChallenges(list) {
  for (const c of list) starters.set(c.id, { code: c.starterCode, entry: c.entry });
}

export function setVerifiedCode(codeById) {
  for (const [id, code] of Object.entries(codeById || {})) {
    if (verified.get(id) !== code) {
      verified.set(id, code);
      compiled.delete(id);
      warned.delete(id);
    }
  }
}

export function isFixed(id) {
  return verified.has(id);
}

function compile(id) {
  const s = starters.get(id);
  if (!s) return null;
  const source = verified.get(id) ?? s.code;
  const cached = compiled.get(id);
  if (cached && cached.source === source) return cached.fn;
  let fn = null;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(`'use strict';\n${source}\n;return ${s.entry};`)();
  } catch (e) {
    fn = null;
    report(id, e);
  }
  compiled.set(id, { source, fn });
  return fn;
}

function report(id, e) {
  if (warned.has(id)) return;
  warned.add(id);
  onError(id, e);
}

/** Call a challenge function. Returns fallback if it is missing or throws. */
export function call(id, args, fallback) {
  const fn = compile(id);
  if (!fn) return fallback;
  try {
    return fn(...args);
  } catch (e) {
    report(id, e);
    return fallback;
  }
}

/** Like call(), but lets the caller see the exception (used by NPC teleport logic). */
export function callRaw(id, args) {
  const fn = compile(id);
  if (!fn) throw new Error('missing function');
  return fn(...args);
}
