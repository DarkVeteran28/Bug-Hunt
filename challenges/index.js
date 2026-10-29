// Registry of all bug challenges. Tests and reference solutions stay on the
// server; the client only ever receives the public view.
import ghostWall from './easy/ghost-wall.js';
import brokenCar from './easy/broken-car.js';
import invisibleGate from './medium/invisible-gate.js';
import brokenMission from './medium/broken-mission.js';
import teleportingNpc from './medium/teleporting-npc.js';
import frozenPlayer from './medium/frozen-player.js';
import flyingCar from './medium/flying-car.js';
import brokenReload from './hard/broken-reload.js';
import infiniteAmmo from './hard/infinite-ammo.js';
import faultyCheckpoint from './hard/faulty-checkpoint.js';
import doubleScore from './hard/double-score.js';
import brokenFinalGate from './expert/broken-final-gate.js';

export const CHALLENGE_LIST = Object.freeze([
  ghostWall, brokenCar, invisibleGate,
  brokenMission, teleportingNpc, frozenPlayer,
  flyingCar, brokenReload,
  infiniteAmmo, faultyCheckpoint, doubleScore,
  brokenFinalGate,
]);

export const CHALLENGES = Object.freeze(Object.fromEntries(CHALLENGE_LIST.map((c) => [c.id, c])));

export function publicChallenge(c, reward) {
  return {
    id: c.id,
    title: c.title,
    difficulty: c.difficulty,
    district: c.district,
    mandatory: c.mandatory,
    entry: c.entry,
    summary: c.summary,
    description: c.description,
    reproduce: c.reproduce,
    hintCount: c.hints.length,
    consequence: c.consequence,
    unlocksWeapon: c.unlocksWeapon || null,
    starterCode: c.starterCode,
    testNames: c.tests.map((t) => (t.hidden ? 'Hidden test' : t.name)),
    reward,
  };
}
