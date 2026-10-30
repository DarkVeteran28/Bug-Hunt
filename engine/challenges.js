// Challenge lifecycle: open (with proximity and unlock checks), drafts,
// hints, test runs, and the verified "Apply Fix" that pays out exactly once.
// The test runner is injected: a Web Worker in the browser, in-process in
// Node tests.
import { CHALLENGES, publicChallenge } from '../challenges/index.js';
import { STATIONS, dist2D } from '../shared/world-data.js';
import { SCORING, SANDBOX } from '../shared/config.js';
import { runTests } from './challenge-tests.js';

const inProcessRunner = async (c, code) => runTests({ code, entry: c.entry, tests: c.tests });

export const STATION_RANGE = 6;
export const SHIELD_RANGE = 9;

export function rewardFor(challenge) {
  return SCORING.bug[challenge.difficulty];
}

export function assistedReward(challenge) {
  return Math.floor(rewardFor(challenge) * SCORING.assistedFactor);
}

export class ChallengeManager {
  constructor(db, { runner = inProcessRunner, now = Date.now } = {}) {
    this.db = db;
    this.runner = runner;
    this.now = now;
  }

  station(challengeId) {
    return STATIONS.find((s) => s.challengeId === challengeId);
  }

  open(player, challengeId) {
    const c = CHALLENGES[challengeId];
    if (!c) return { ok: false, error: 'Unknown challenge.' };
    if (!player.progress.districtUnlocked(c.district)) return { ok: false, error: 'That district is still locked.' };
    const st = this.station(challengeId);
    if (!player.alive) return { ok: false, error: 'You are down. Wait for your respawn.' };
    if (dist2D(player.pos, st.pos) > STATION_RANGE) return { ok: false, error: 'Walk up to the debugging station first.' };
    // Cannot dive into the shielded editor in the middle of a fight.
    if (player.lastCombatAt && (this.combatNow || this.now)() - player.lastCombatAt < 4000) return { ok: false, error: 'You were just in a firefight. Break contact for a few seconds first.' };
    const progress = this.db.openChallenge(player.id, challengeId);
    player.debugging = challengeId;
    player.debugStation = st.pos;
    const solved = player.progress.isSolved(challengeId);
    return {
      ok: true,
      challenge: publicChallenge(c, rewardFor(c)),
      draft: progress.draft,
      hints: c.hints.slice(0, progress.hints_revealed),
      solved,
      verifiedCode: solved ? null : progress.verified_code || null,
      solutionRevealed: !!progress.solution_revealed,
      solvedCode: solved ? player.progress.code[challengeId] : null,
    };
  }

  /**
   * Easy mode: reveal the reference fix. The player still has to run the
   * tests and apply it, and the reward for this challenge is reduced.
   */
  solution(player, challengeId) {
    const c = CHALLENGES[challengeId];
    if (!c) return { ok: false, error: 'Unknown challenge.' };
    if (player.debugging !== challengeId) return { ok: false, error: 'Open this challenge at its station first.' };
    if (player.progress.isSolved(challengeId)) return { ok: false, error: 'You already fixed this bug.' };
    this.db.revealSolution(player.id, challengeId);
    return { ok: true, code: c.solutionCode, reward: assistedReward(c) };
  }

  close(player) {
    player.debugging = null;
    player.debugStation = null;
  }

  saveDraft(player, challengeId, code) {
    if (!CHALLENGES[challengeId] || typeof code !== 'string') return false;
    if (new TextEncoder().encode(code).length > SANDBOX.maxCodeBytes) return false;
    return this.db.saveDraft(player.id, challengeId, code);
  }

  hint(player, challengeId) {
    const c = CHALLENGES[challengeId];
    if (!c || player.debugging !== challengeId) return { ok: false, error: 'Open the challenge first.' };
    const progress = this.db.revealHint(player.id, challengeId, c.hints.length);
    return { ok: true, hints: c.hints.slice(0, progress.hints_revealed), remaining: c.hints.length - progress.hints_revealed };
  }


  async run(player, challengeId, code) {
    const c = CHALLENGES[challengeId];
    if (!c) return { ok: false, error: 'Unknown challenge.' };
    if (player.debugging !== challengeId) return { ok: false, error: 'Open this challenge at its station first.' };
    if (typeof code !== 'string' || !code.trim()) return { ok: false, error: 'There is no code to test.' };
    if (new TextEncoder().encode(code).length > SANDBOX.maxCodeBytes) return { ok: false, error: `Code is too large (max ${SANDBOX.maxCodeBytes} bytes).` };
    this.saveDraft(player, challengeId, code);
    const report = await this.runner(c, code);
    this.db.recordAttempt(player.id, challengeId, report.passed, report.passedCount || 0, report.total || c.tests.length);
    if (report.passed) this.db.setVerified(player.id, challengeId, code);
    return { ok: true, report };
  }

  /**
   * Apply a fix. Only a verified submission recorded by the engine counts; the
   * page cannot claim success on its own. Points are paid once per challenge.
   */
  apply(player, challengeId) {
    const c = CHALLENGES[challengeId];
    if (!c) return { ok: false, error: 'Unknown challenge.' };
    const progress = this.db.getProgress(player.id, challengeId);
    if (player.progress.isSolved(challengeId)) return { ok: true, alreadySolved: true, awarded: 0 };
    if (!progress || !progress.verified_code) return { ok: false, error: 'Run the tests and pass all of them before applying the fix.' };
    const assisted = !!progress.solution_revealed;
    const points = assisted ? assistedReward(c) : rewardFor(c);
    const solveMs = Math.max(0, (progress.verified_at || this.now()) - progress.first_opened_at);
    const fresh = this.db.completeChallenge(player.id, challengeId, points, solveMs, progress.verified_code, assisted);
    player.progress.solved.add(challengeId);
    player.progress.code[challengeId] = progress.verified_code;
    player.progress.recompute();
    if (fresh) player.session.bugPoints += points;
    return { ok: true, alreadySolved: !fresh, awarded: fresh ? points : 0, assisted, solveMs, title: c.title, consequence: c.consequence };
  }
}
