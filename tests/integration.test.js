// End-to-end tests over real Socket.IO connections against an in-process
// server with a temporary SQLite database and the real sandbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import { STATIONS } from '../shared/world-data.js';
import { CHALLENGES } from '../challenges/index.js';
import { SCORING, PLAYER } from '../shared/config.js';

let game;
let url;
let tmp;
const sockets = [];

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vcbh-it-'));
  game = createGameServer({ dbFile: path.join(tmp, 'it.db') });
  const port = await game.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await game.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(auth) {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.events = [];
    s.onAny((event, data) => s.events.push({ event, data }));
    s.once('welcome', (w) => resolve({ s, w }));
    s.once('fatal', (e) => reject(new Error(e.error)));
    s.once('connect_error', reject);
  });
}

const ask = (s, event, data) => s.timeout(15000).emitWithAck(event, data);

function nextEvent(s, event, pred = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.off(event, h);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeout);
    const h = (d) => {
      if (pred(d)) {
        clearTimeout(t);
        s.off(event, h);
        resolve(d);
      }
    };
    s.on(event, h);
  });
}

/** Walk in small steps so the server's movement validation accepts every update. */
async function walk(s, from, to) {
  let p = [...from];
  for (let i = 0; i < 3000; i++) {
    const dx = to[0] - p[0];
    const dz = to[2] - p[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const step = Math.min(0.35, d);
    p = [p[0] + (dx / d) * step, 0, p[2] + (dz / d) * step];
    s.emit('state', { p, ry: 0, anim: 'walk' });
    await wait(55);
  }
  await wait(120);
  return p;
}

const serverPlayer = (code, id) => game.rooms.get(code).players.get(id);

test('bad names are refused', async () => {
  await assert.rejects(client({ name: '<b>' }), /Names must be/);
});

test('two players share a room, see each other, and private rooms are isolated', async () => {
  const a = await client({ name: 'Alpha' });
  const b = await client({ name: 'Bravo' });
  const ja = await ask(a.s, 'room:join', { mode: 'freeroam' });
  const jb = await ask(b.s, 'room:join', { mode: 'freeroam' });
  assert.equal(ja.ok, true);
  assert.equal(ja.room.code, jb.room.code);
  assert.ok(Array.isArray(ja.progress.solved));
  const snap = await nextEvent(a.s, 's', (d) => d.p.some((e) => e[0] === b.w.id));
  assert.ok(snap.p.length >= 2);
  // Join notifications and roster.
  assert.ok(a.s.events.some((e) => e.event === 'player-joined' && e.data.name === 'Bravo'));

  const c = await client({ name: 'Charlie' });
  const jc = await ask(c.s, 'room:join', { create: { mode: 'freeroam', pvp: false } });
  assert.equal(jc.ok, true);
  assert.equal(jc.room.isPublic, false);
  assert.equal(jc.room.pvp, false);
  await wait(300);
  const latest = a.s.events.filter((e) => e.event === 's').pop().data;
  assert.ok(!latest.p.some((e) => e[0] === c.w.id), 'private room player is not visible in the public room');
  const d = await client({ name: 'Delta' });
  const jd = await ask(d.s, 'room:join', { code: jc.room.code });
  assert.equal(jd.ok, true);
  assert.equal(jd.room.code, jc.room.code);
  const bad = await ask(d.s, 'room:join', { code: 'ZZZZZ' });
  assert.equal(bad.ok, false);
  for (const x of [a, b, c, d]) x.s.disconnect();
});

test('bug fixing over the network: forged events fail, verified fixes pay once', async () => {
  const { s, w } = await client({ name: 'Coder' });
  const j = await ask(s, 'room:join', { mode: 'freeroam' });
  const code = j.room.code;

  // Forged completion before doing anything.
  const forged = await ask(s, 'challenge:apply', { id: 'ghost-wall' });
  assert.equal(forged.ok, false);
  // Opening from far away is refused.
  const st = STATIONS.find((x) => x.challengeId === 'ghost-wall');
  const p = serverPlayer(code, w.id);
  if (Math.hypot(p.pos[0] - st.pos[0], p.pos[2] - st.pos[2]) > 7) {
    const far = await ask(s, 'challenge:open', { id: 'ghost-wall' });
    assert.equal(far.ok, false);
  }
  await walk(s, p.pos, [st.pos[0] + 1, 0, st.pos[2] + 1]);
  const opened = await ask(s, 'challenge:open', { id: 'ghost-wall' });
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.challenge.tests, undefined, 'tests are not sent to the client');

  const failRun = await ask(s, 'challenge:run', { id: 'ghost-wall', code: opened.challenge.starterCode });
  assert.equal(failRun.ok, true);
  assert.equal(failRun.report.passed, false);
  assert.equal((await ask(s, 'challenge:apply', { id: 'ghost-wall' })).ok, false, 'failed tests cannot be applied');

  const goodRun = await ask(s, 'challenge:run', { id: 'ghost-wall', code: CHALLENGES['ghost-wall'].solutionCode });
  assert.equal(goodRun.report.passed, true);
  const scoreEvt = nextEvent(s, 'score', (d) => d.totals.bug === SCORING.bug.easy);
  const progressEvt = nextEvent(s, 'progress', (d) => d.solved.includes('ghost-wall'));
  const applied = await ask(s, 'challenge:apply', { id: 'ghost-wall' });
  assert.equal(applied.awarded, SCORING.bug.easy);
  const prog = await progressEvt;
  assert.ok(prog.code['ghost-wall'].includes('aabbOverlap'), 'verified code is sent back for the in-game behaviour');
  await scoreEvt;
  const again = await ask(s, 'challenge:apply', { id: 'ghost-wall' });
  assert.equal(again.awarded, 0);
  assert.equal(game.db.totals(w.id).bug, SCORING.bug.easy);

  // Locked-district challenges cannot be opened.
  const locked = await ask(s, 'challenge:open', { id: 'broken-mission' });
  assert.equal(locked.ok, false);
  s.disconnect();
});

test('combat over the network: server-validated hits, kill feed, single reward', async () => {
  const a = await client({ name: 'Gunner' });
  const b = await client({ name: 'Runner' });
  const ja = await ask(a.s, 'room:join', { create: { mode: 'arena', pvp: true } });
  await ask(b.s, 'room:join', { code: ja.room.code });
  const room = game.rooms.get(ja.room.code);
  const pa = room.players.get(a.w.id);
  const pb = room.players.get(b.w.id);
  // Test harness: place both players in the open plaza.
  Object.assign(pa, { pos: [30, 0, -60], lastValidPos: [30, 0, -60], spawnProtectedUntil: 0 });
  Object.assign(pb, { pos: [30, 0, -50], lastValidPos: [30, 0, -50], spawnProtectedUntil: 0 });
  const dir = [0, 1.2 - PLAYER.eyeHeight, 10];

  const damaged = nextEvent(b.s, 'damaged');
  a.s.emit('fire', { weapon: 'pistol', dir, damage: 1000 });
  const d = await damaged;
  assert.equal(d.health, 75, 'damage comes from the server weapon table, not the client');
  const killEvt = nextEvent(a.s, 'kill', (k) => k.victim === b.w.id);
  for (let i = 0; i < 6; i++) {
    await wait(340);
    a.s.emit('fire', { weapon: 'pistol', dir });
  }
  const kill = await killEvt;
  assert.equal(kill.points, SCORING.combat.elimination);
  assert.equal(game.db.totals(a.w.id).combat, SCORING.combat.elimination);
  // Weapon that is still locked.
  const rejected = nextEvent(a.s, 'fire-rejected');
  a.s.emit('fire', { weapon: 'rifle', dir });
  assert.equal((await rejected).reason, 'weapon-locked');
  a.s.disconnect();
  b.s.disconnect();
});

test('a dropped connection resumes the same player state', async () => {
  const first = await client({ name: 'Flaky' });
  const j = await ask(first.s, 'room:join', { mode: 'freeroam' });
  const p = serverPlayer(j.room.code, first.w.id);
  p.session.kills = 7;
  first.s.disconnect();
  await wait(200);
  assert.equal(serverPlayer(j.room.code, first.w.id).connected, false);
  const second = await client({ token: first.w.token });
  assert.equal(second.w.id, first.w.id);
  const j2 = await ask(second.s, 'room:join', { code: j.room.code });
  assert.equal(j2.resumed, true);
  assert.equal(serverPlayer(j.room.code, first.w.id).session.kills, 7);
  second.s.disconnect();
});

test('HTTP API: health and leaderboards', async () => {
  const health = await (await fetch(`${url}/api/health`)).json();
  assert.equal(health.ok, true);
  for (const board of ['overall', 'bugs', 'combat', 'kd', 'fastest']) {
    const r = await fetch(`${url}/api/leaderboard?board=${board}`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.rows));
  }
  const bugs = await (await fetch(`${url}/api/leaderboard?board=bugs`)).json();
  assert.equal(bugs.rows[0].name, 'Coder');
  assert.equal((await fetch(`${url}/api/leaderboard?board=drop%20table`)).status, 400);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  for (const asset of ['/vendor/three/three.module.js', '/vendor/rapier/rapier.mjs', '/vendor/monaco/vs/loader.js', '/vendor/socket.io/socket.io.esm.min.js', '/shared/world-data.js', '/src/main.js']) {
    assert.equal((await fetch(url + asset)).status, 200, asset);
  }
});
