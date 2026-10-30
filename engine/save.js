// Save files: building them from a session, checking them, and turning a
// checked save back into the state GameSession expects.
//
// A save is JSON: { format, version, savedAt, playTimeMs, label, state,
// settings, checksum }. The checksum (FNV-1a of the state JSON) catches
// truncated or edited files; validation catches anything malformed. A save
// that fails either check is never loaded: the menu reports it instead.
import { WEAPONS, PLAYER } from '../shared/config.js';
import { WORLD } from '../shared/world-data.js';
import { CHALLENGES } from '../challenges/index.js';
import { MISSIONS, VEHICLE_SPAWNS } from '../shared/world-data.js';

export const SAVE_FORMAT = 'vice-city-bughunt-save';
export const SAVE_VERSION = 1;

export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function buildSave(session, { playTimeMs = 0, settings = null, label = '', savedAt = Date.now() } = {}) {
  const state = session.snapshot();
  const stateJson = JSON.stringify(state);
  const stats = session.statsView();
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt,
    playTimeMs: Math.round(playTimeMs),
    label,
    summary: { score: stats.totals.total, bugsFixed: stats.bugsFixed, missions: stats.missionsCompleted, district: session.player.progress.districts.length },
    settings,
    state,
    checksum: checksum(stateJson),
  };
}

class SaveError extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v) && v >= 0;

function need(cond, msg) {
  if (!cond) throw new SaveError(msg);
}

/**
 * Check a parsed save. Returns { ok: true, state } or { ok: false, error }.
 * Unknown extra fields are ignored; anything required that is missing,
 * out of range or the wrong type rejects the whole save.
 */
export function validateSave(save) {
  try {
    need(isObj(save), 'Not a save file.');
    need(save.format === SAVE_FORMAT, 'Not a Vice City: Bug Hunt save.');
    need(save.version === SAVE_VERSION, `Save version ${save.version} is not supported.`);
    need(isNum(save.savedAt), 'Missing save time.');
    need(isObj(save.state), 'Missing game state.');
    need(save.checksum === checksum(JSON.stringify(save.state)), 'The save is damaged (checksum mismatch).');
    const s = save.state;
    need(isNum(s.clockMs) && s.clockMs >= 0, 'Bad clock.');
    const p = s.player;
    need(isObj(p), 'Missing player.');
    need(Array.isArray(p.pos) && p.pos.length === 3 && p.pos.every(isNum), 'Bad player position.');
    need(p.pos[0] >= WORLD.minX - 5 && p.pos[0] <= WORLD.maxX + 5 && p.pos[2] >= WORLD.minZ - 5 && p.pos[2] <= WORLD.maxZ + 5 && p.pos[1] > WORLD.killY && p.pos[1] < 100, 'Player position is outside the city.');
    need(isNum(p.ry), 'Bad player rotation.');
    need(isNum(p.health) && p.health > 0 && p.health <= PLAYER.maxHealth, 'Bad health.');
    need(typeof p.equipped === 'string' && WEAPONS[p.equipped], 'Bad weapon.');
    need(isObj(p.loadout), 'Bad loadout.');
    for (const w of Object.keys(WEAPONS)) {
      const l = p.loadout[w];
      need(isObj(l) && isInt(l.ammo) && isInt(l.reserve) && l.ammo <= WEAPONS[w].magSize && l.reserve <= WEAPONS[w].reserve, `Bad ammo for ${w}.`);
    }
    need(isObj(s.missionState), 'Bad mission state.');
    for (const m of MISSIONS) {
      const ms = s.missionState[m.id];
      need(isObj(ms) && isInt(ms.step) && ms.step <= m.steps.length && typeof ms.courier === 'string', `Bad mission state for ${m.id}.`);
    }
    const st = s.store;
    need(isObj(st), 'Missing records.');
    need(Array.isArray(st.scoreEvents) && st.scoreEvents.every((e) => isObj(e) && typeof e.kind === 'string' && typeof e.ref === 'string' && isNum(e.amount) && e.amount >= 0), 'Bad score history.');
    need(new Set(st.scoreEvents.map((e) => `${e.kind}|${e.ref}`)).size === st.scoreEvents.length, 'Duplicate rewards in score history.');
    need(isObj(st.stats) && ['kills', 'deaths', 'hintsUsed', 'shots', 'hits'].every((k) => isInt(st.stats[k])), 'Bad stats.');
    need(isObj(st.attempts) && isInt(st.attempts.total) && isInt(st.attempts.passed), 'Bad test-run stats.');
    need(isObj(st.challengeProgress) && Object.keys(st.challengeProgress).every((id) => CHALLENGES[id]), 'Unknown challenge in progress.');
    for (const cp of Object.values(st.challengeProgress)) {
      need(isObj(cp) && isNum(cp.first_opened_at) && isInt(cp.hints_revealed), 'Bad challenge progress.');
      for (const k of ['draft', 'verified_code']) need(cp[k] === null || cp[k] === undefined || typeof cp[k] === 'string', 'Bad challenge code.');
    }
    need(isObj(st.completions), 'Bad completions.');
    for (const [id, c] of Object.entries(st.completions)) {
      need(CHALLENGES[id] && isObj(c) && isNum(c.points) && typeof c.code === 'string', `Bad completion for ${id}.`);
    }
    need(isObj(st.missions) && Object.keys(st.missions).every((id) => MISSIONS.some((m) => m.id === id)), 'Unknown mission in records.');
    need(Array.isArray(st.collected) && st.collected.every((x) => typeof x === 'string'), 'Bad collectibles.');
    need(s.enemies === undefined || Array.isArray(s.enemies), 'Bad enemy list.');
    need(s.vehicles === undefined || s.vehicles === null || (Array.isArray(s.vehicles) && s.vehicles.length <= VEHICLE_SPAWNS.length && s.vehicles.every((v) => Array.isArray(v) && v.length === 4 && v.every(isNum))), 'Bad vehicle list.');
    return { ok: true, state: s };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    return { ok: false, error: `Unreadable save: ${e.message}` };
  }
}

/** Parse save text (from storage or an imported file) and validate it. */
export function parseSave(text) {
  let obj;
  try {
    obj = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return { ok: false, error: 'The save is damaged (not valid JSON).' };
  }
  const v = validateSave(obj);
  return v.ok ? { ok: true, save: obj, state: v.state } : v;
}
