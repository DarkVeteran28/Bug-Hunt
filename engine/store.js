// The single player's records: score history, stats, challenge progress,
// completed missions and collected items. Plain data, so a save file is just
// JSON.stringify(store.toJSON()). The method names match what the game
// rules (missions.js, challenges.js) call.
//
// Score events are keyed by a reference ("challenge:ghost-wall",
// "mission:m-ocean", ...), so the same reward can never be paid twice.

export function freshStoreData() {
  return {
    scoreEvents: [], // { kind, ref, amount, at }
    stats: { kills: 0, deaths: 0, hintsUsed: 0, shots: 0, hits: 0 },
    attempts: { total: 0, passed: 0 },
    challengeProgress: {}, // id -> { first_opened_at, hints_revealed, draft, verified_code, verified_at, solution_revealed }
    completions: {}, // id -> { points, solve_ms, code, completed_at, assisted }
    missions: {}, // id -> completed_at
    collected: [], // collectible ids
  };
}

export class GameStore {
  constructor(data = freshStoreData(), { now = Date.now } = {}) {
    this.data = data;
    this.now = now;
    this.refs = new Set(data.scoreEvents.map((e) => `${e.kind}|${e.ref}`));
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }

  toJSON() {
    return this.data;
  }

  // ---- Scoring ----------------------------------------------------------------

  /** Pay once per (kind, ref). Returns true if this call paid. */
  award(_playerId, kind, ref, amount) {
    if (!(amount >= 0) || !Number.isFinite(amount)) return false;
    const key = `${kind}|${ref}`;
    if (this.refs.has(key)) return false;
    this.refs.add(key);
    this.data.scoreEvents.push({ kind, ref, amount, at: this.now() });
    this.changed();
    return true;
  }

  totals() {
    const t = { total: 0, bug: 0, combat: 0, other: 0 };
    for (const e of this.data.scoreEvents) {
      t.total += e.amount;
      if (e.kind === 'bug') t.bug += e.amount;
      else if (e.kind === 'combat') t.combat += e.amount;
      else t.other += e.amount;
    }
    return t;
  }

  history(limit = 10) {
    return this.data.scoreEvents.slice(-limit).reverse();
  }

  // ---- Stats --------------------------------------------------------------------

  addKill() {
    this.data.stats.kills++;
  }

  addDeath() {
    this.data.stats.deaths++;
  }

  stats() {
    return this.data.stats;
  }

  // ---- Challenges -----------------------------------------------------------------

  openChallenge(_playerId, id) {
    if (!this.data.challengeProgress[id]) {
      this.data.challengeProgress[id] = { first_opened_at: this.now(), hints_revealed: 0, draft: null, verified_code: null, verified_at: null, solution_revealed: 0 };
    }
    return this.data.challengeProgress[id];
  }

  getProgress(_playerId, id) {
    return this.data.challengeProgress[id] || null;
  }

  saveDraft(_playerId, id, code) {
    const p = this.data.challengeProgress[id];
    if (!p) return false;
    p.draft = code;
    return true;
  }

  revealHint(_playerId, id, max) {
    const p = this.openChallenge(null, id);
    if (p.hints_revealed < max) {
      p.hints_revealed++;
      this.data.stats.hintsUsed++;
    }
    return p;
  }

  revealSolution(_playerId, id) {
    this.openChallenge(null, id).solution_revealed = 1;
  }

  setVerified(_playerId, id, code) {
    const p = this.openChallenge(null, id);
    p.verified_code = code;
    p.verified_at = this.now();
  }

  recordAttempt(_playerId, _id, passed) {
    this.data.attempts.total++;
    if (passed) this.data.attempts.passed++;
  }

  attemptStats() {
    return this.data.attempts;
  }

  /** Mark a challenge solved and pay for it. Returns true if new. */
  completeChallenge(_playerId, id, points, solveMs, code, assisted = false) {
    if (this.data.completions[id]) return false;
    this.data.completions[id] = { points, solve_ms: solveMs, code, completed_at: this.now(), assisted: assisted ? 1 : 0 };
    this.award(null, 'bug', `challenge:${id}`, points);
    return true;
  }

  completions() {
    return Object.entries(this.data.completions).map(([challenge_id, c]) => ({ challenge_id, ...c }));
  }

  // ---- Missions and collectibles --------------------------------------------------

  completeMission(_playerId, id, reward) {
    if (this.data.missions[id]) return false;
    this.data.missions[id] = this.now();
    this.award(null, 'mission', `mission:${id}`, reward);
    return true;
  }

  missions() {
    return Object.keys(this.data.missions);
  }

  collect(id, points) {
    if (this.data.collected.includes(id)) return false;
    this.data.collected.push(id);
    this.award(null, 'bonus', `collect:${id}`, points);
    return true;
  }

  collected() {
    return this.data.collected;
  }
}
