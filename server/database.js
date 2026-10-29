// SQLite persistence: player profiles, challenge attempts and completions,
// mission completions, combat stats and an append-only score history.
// Uniqueness constraints in the schema are what make rewards exactly-once.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 3 AND 16),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
  deaths INTEGER NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  hints_used INTEGER NOT NULL DEFAULT 0 CHECK (hints_used >= 0)
);

-- Every scoring event. (player_id, kind, ref) is unique, so the same kill,
-- challenge or mission can never be paid twice even if events repeat.
CREATE TABLE IF NOT EXISTS score_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'combat', 'mission', 'arena', 'bonus')),
  ref TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS challenge_progress (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  first_opened_at INTEGER NOT NULL,
  hints_revealed INTEGER NOT NULL DEFAULT 0,
  draft TEXT,
  draft_updated_at INTEGER,
  verified_code TEXT,
  verified_at INTEGER,
  PRIMARY KEY (player_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS challenge_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  passed_tests INTEGER NOT NULL,
  total_tests INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenge_completions (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  solve_ms INTEGER NOT NULL,
  code TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS mission_completions (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_score_player ON score_events(player_id);
CREATE INDEX IF NOT EXISTS idx_attempts_player ON challenge_attempts(player_id);
`;

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const now = () => Date.now();
  const q = {
    playerByToken: db.prepare('SELECT * FROM players WHERE token_hash = ?'),
    playerByName: db.prepare('SELECT * FROM players WHERE name = ?'),
    playerById: db.prepare('SELECT * FROM players WHERE id = ?'),
    insertPlayer: db.prepare('INSERT INTO players (token_hash, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)'),
    insertStats: db.prepare('INSERT OR IGNORE INTO player_stats (player_id) VALUES (?)'),
    touchPlayer: db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?'),
    insertScore: db.prepare('INSERT OR IGNORE INTO score_events (player_id, kind, ref, amount, created_at) VALUES (?, ?, ?, ?, ?)'),
    totals: db.prepare(`SELECT
        COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(CASE WHEN kind = 'bug' THEN amount END), 0) AS bug,
        COALESCE(SUM(CASE WHEN kind = 'combat' THEN amount END), 0) AS combat,
        COALESCE(SUM(CASE WHEN kind IN ('mission', 'arena', 'bonus') THEN amount END), 0) AS other
      FROM score_events WHERE player_id = ?`),
    history: db.prepare('SELECT kind, ref, amount, created_at FROM score_events WHERE player_id = ? ORDER BY id DESC LIMIT ?'),
    addKill: db.prepare('UPDATE player_stats SET kills = kills + 1 WHERE player_id = ?'),
    addDeath: db.prepare('UPDATE player_stats SET deaths = deaths + 1 WHERE player_id = ?'),
    addHint: db.prepare('UPDATE player_stats SET hints_used = hints_used + 1 WHERE player_id = ?'),
    stats: db.prepare('SELECT * FROM player_stats WHERE player_id = ?'),
    progress: db.prepare('SELECT * FROM challenge_progress WHERE player_id = ? AND challenge_id = ?'),
    openProgress: db.prepare('INSERT OR IGNORE INTO challenge_progress (player_id, challenge_id, first_opened_at) VALUES (?, ?, ?)'),
    saveDraft: db.prepare('UPDATE challenge_progress SET draft = ?, draft_updated_at = ? WHERE player_id = ? AND challenge_id = ?'),
    revealHint: db.prepare('UPDATE challenge_progress SET hints_revealed = hints_revealed + 1 WHERE player_id = ? AND challenge_id = ? AND hints_revealed < ?'),
    setVerified: db.prepare('UPDATE challenge_progress SET verified_code = ?, verified_at = ? WHERE player_id = ? AND challenge_id = ?'),
    insertAttempt: db.prepare('INSERT INTO challenge_attempts (player_id, challenge_id, passed, passed_tests, total_tests, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    attemptStats: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(passed), 0) AS passed FROM challenge_attempts WHERE player_id = ?'),
    insertCompletion: db.prepare('INSERT OR IGNORE INTO challenge_completions (player_id, challenge_id, points, solve_ms, code, completed_at) VALUES (?, ?, ?, ?, ?, ?)'),
    completions: db.prepare('SELECT challenge_id, points, solve_ms, code, completed_at FROM challenge_completions WHERE player_id = ?'),
    insertMission: db.prepare('INSERT OR IGNORE INTO mission_completions (player_id, mission_id, completed_at) VALUES (?, ?, ?)'),
    missions: db.prepare('SELECT mission_id FROM mission_completions WHERE player_id = ?'),
  };

  const leaderboardSql = {
    overall: `SELECT p.id, p.name, COALESCE(SUM(s.amount), 0) AS value FROM players p LEFT JOIN score_events s ON s.player_id = p.id GROUP BY p.id ORDER BY value DESC, p.id ASC LIMIT ?`,
    bugs: `SELECT p.id, p.name, COUNT(c.challenge_id) AS value,
             (SELECT COALESCE(SUM(amount), 0) FROM score_events WHERE player_id = p.id AND kind = 'bug') AS points
           FROM players p LEFT JOIN challenge_completions c ON c.player_id = p.id GROUP BY p.id ORDER BY value DESC, points DESC, p.id ASC LIMIT ?`,
    combat: `SELECT p.id, p.name, COALESCE(SUM(s.amount), 0) AS value FROM players p LEFT JOIN score_events s ON s.player_id = p.id AND s.kind = 'combat' GROUP BY p.id ORDER BY value DESC, p.id ASC LIMIT ?`,
    kd: `SELECT p.id, p.name, st.kills, st.deaths, ROUND(CAST(st.kills AS REAL) / MAX(st.deaths, 1), 2) AS value
         FROM players p JOIN player_stats st ON st.player_id = p.id WHERE st.kills + st.deaths > 0 ORDER BY value DESC, st.kills DESC, p.id ASC LIMIT ?`,
    fastest: `SELECT p.id, p.name, c.challenge_id, c.solve_ms AS value FROM challenge_completions c JOIN players p ON p.id = c.player_id ORDER BY c.solve_ms ASC LIMIT ?`,
  };
  const boards = Object.fromEntries(Object.entries(leaderboardSql).map(([k, sql]) => [k, db.prepare(sql)]));
  const rankStmt = db.prepare(`SELECT COUNT(*) + 1 AS rank FROM (
      SELECT p.id, COALESCE(SUM(s.amount), 0) AS total FROM players p LEFT JOIN score_events s ON s.player_id = p.id GROUP BY p.id
    ) t WHERE t.total > (SELECT COALESCE(SUM(amount), 0) FROM score_events WHERE player_id = ?)`);

  return {
    raw: db,
    close: () => db.close(),

    /** Find or create a player for a client token. Returns { player, token, created } or { error }. */
    authenticate(token, name) {
      if (token) {
        const p = q.playerByToken.get(hashToken(token));
        if (p) {
          q.touchPlayer.run(now(), p.id);
          return { player: p, token, created: false };
        }
      }
      if (!name) return { error: 'Choose a name.' };
      if (q.playerByName.get(name)) return { error: 'That name is already registered on this server. Pick another one.' };
      const t = newToken();
      const info = q.insertPlayer.run(hashToken(t), name, now(), now());
      q.insertStats.run(info.lastInsertRowid);
      return { player: q.playerById.get(info.lastInsertRowid), token: t, created: true };
    },

    getPlayer: (id) => q.playerById.get(id),

    /** Insert a score event. Returns true only if it was new (never pays twice). */
    award(playerId, kind, ref, amount) {
      const info = q.insertScore.run(playerId, kind, String(ref), Math.max(0, Math.round(amount)), now());
      return info.changes === 1;
    },
    totals: (playerId) => q.totals.get(playerId),
    history: (playerId, limit = 20) => q.history.all(playerId, limit),
    addKill: (playerId) => q.addKill.run(playerId),
    addDeath: (playerId) => q.addDeath.run(playerId),
    stats: (playerId) => q.stats.get(playerId) || { kills: 0, deaths: 0, hints_used: 0 },

    openChallenge(playerId, challengeId) {
      q.openProgress.run(playerId, challengeId, now());
      return q.progress.get(playerId, challengeId);
    },
    getProgress: (playerId, challengeId) => q.progress.get(playerId, challengeId),
    saveDraft: (playerId, challengeId, code) => q.saveDraft.run(code, now(), playerId, challengeId).changes === 1,
    revealHint(playerId, challengeId, max) {
      const changed = q.revealHint.run(playerId, challengeId, max).changes === 1;
      if (changed) q.addHint.run(playerId);
      return q.progress.get(playerId, challengeId);
    },
    setVerified: (playerId, challengeId, code) => q.setVerified.run(code, now(), playerId, challengeId),
    recordAttempt: (playerId, challengeId, passed, passedTests, totalTests) =>
      q.insertAttempt.run(playerId, challengeId, passed ? 1 : 0, passedTests, totalTests, now()),
    attemptStats: (playerId) => q.attemptStats.get(playerId),

    /** Mark a challenge solved and pay for it in one transaction. Returns true if new. */
    completeChallenge: db.transaction((playerId, challengeId, points, solveMs, code) => {
      const info = q.insertCompletion.run(playerId, challengeId, points, solveMs, code, now());
      if (info.changes !== 1) return false;
      q.insertScore.run(playerId, 'bug', `challenge:${challengeId}`, points, now());
      return true;
    }),
    completions: (playerId) => q.completions.all(playerId),

    completeMission: db.transaction((playerId, missionId, reward) => {
      const info = q.insertMission.run(playerId, missionId, now());
      if (info.changes !== 1) return false;
      q.insertScore.run(playerId, 'mission', `mission:${missionId}`, reward, now());
      return true;
    }),
    missions: (playerId) => q.missions.all(playerId).map((r) => r.mission_id),

    leaderboard(board, limit = 10) {
      const stmt = boards[board];
      if (!stmt) return null;
      return stmt.all(limit);
    },
    rank: (playerId) => rankStmt.get(playerId).rank,
  };
}
