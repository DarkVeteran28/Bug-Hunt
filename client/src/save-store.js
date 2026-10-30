// Where saves live: IndexedDB in this browser, with localStorage as a
// fallback when IndexedDB is unavailable (some private windows).
//
// Two slots: "manual" (Save Game in the pause menu) and "auto" (autosave).
// Writing a slot first copies the old save to "<slot>-backup", so one bad
// write never loses everything. Continue loads the newest save that passes
// engine/save.js validation; damaged ones are reported, never loaded.
import { parseSave } from '../../engine/save.js';

const DB_NAME = 'vice-city-bughunt';
const STORE = 'saves';
const LS_PREFIX = 'vcbh-save-';
export const SLOTS = ['manual', 'auto'];
const ALL_KEYS = SLOTS.flatMap((s) => [s, `${s}-backup`]);

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      if (!('indexedDB' in window)) return resolve(null);
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save cancelled'));
  });
}

/** The backend in use, for the settings screen and tests. */
export async function backend() {
  return (await openDb()) ? 'IndexedDB' : 'localStorage';
}

async function readRaw(key) {
  const db = await openDb();
  if (db) {
    try {
      return (await idb(db, 'readonly', (s) => s.get(key))) ?? null;
    } catch { /* fall through */ }
  }
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

async function writeRaw(key, text) {
  const db = await openDb();
  if (db) {
    await idb(db, 'readwrite', (s) => s.put(text, key));
    return;
  }
  localStorage.setItem(LS_PREFIX + key, text);
}

async function deleteRaw(key) {
  const db = await openDb();
  if (db) {
    try {
      await idb(db, 'readwrite', (s) => s.delete(key));
    } catch { /* ignore */ }
  }
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch { /* ignore */ }
}

/** Write a save object to a slot (old copy kept as the backup). */
export async function writeSave(slot, save) {
  if (!SLOTS.includes(slot)) throw new Error(`Unknown save slot ${slot}`);
  const text = JSON.stringify(save);
  // Never store something we could not load back.
  const check = parseSave(text);
  if (!check.ok) throw new Error(`Save failed its own check: ${check.error}`);
  const previous = await readRaw(slot);
  if (previous && parseSave(previous).ok) await writeRaw(`${slot}-backup`, previous);
  await writeRaw(slot, text);
  return { slot, savedAt: save.savedAt, bytes: text.length };
}

/**
 * Every stored save with its check result:
 * [{ key, ok, save?, state?, error? }], newest valid first.
 */
export async function listSaves() {
  const out = [];
  for (const key of ALL_KEYS) {
    const raw = await readRaw(key);
    if (raw === null || raw === undefined) continue;
    const r = parseSave(raw);
    out.push(r.ok ? { key, ok: true, save: r.save, state: r.state } : { key, ok: false, error: r.error });
  }
  out.sort((a, b) => (b.ok - a.ok) || ((b.save ? b.save.savedAt : 0) - (a.save ? a.save.savedAt : 0)));
  return out;
}

/** The newest save that passes every check, plus any damaged ones found. */
export async function latestValidSave() {
  const all = await listSaves();
  return { latest: all.find((s) => s.ok) || null, damaged: all.filter((s) => !s.ok) };
}

export async function deleteAllSaves() {
  for (const key of ALL_KEYS) await deleteRaw(key);
}

/** For tests and support: put arbitrary text in a slot. */
export async function writeRawForTest(key, text) {
  await writeRaw(key, text);
}
