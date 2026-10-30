// Headless browser test of the single-player game: the 14 checks from the
// spec, run in Chromium against the static site.
//   node scripts/browser-test.js            test the source tree
//   node scripts/browser-test.js --dist     test the built dist/ folder
//   add --screenshots <dir> to save screenshots, --report <file> for JSON
//
// Playwright is not a dependency of the game. Install it separately
// (npm i -g playwright && npx playwright install chromium) or point
// NODE_PATH at an existing install.
//
// The test drives the real page. To keep runs repeatable it moves the player
// by teleporting in small steps (as the old tests did) and, outside the combat
// check, keeps the glitch bots away; everything else goes through the UI.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from './serve.js';
import { CHALLENGES } from '../challenges/index.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const shotsDir = arg('--screenshots');
const reportFile = arg('--report');

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/`;

const results = [];
const errors = [];
const foreignRequests = [];
const sockets = [];
let current = null;
let browser;

function section(n, title) {
  current = { n, title, checks: [], ok: true };
  results.push(current);
  console.log(`\n${n}. ${title}`);
}

function check(cond, msg, detail = '') {
  current.checks.push({ ok: !!cond, msg, detail });
  if (!cond) current.ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}${detail ? ` (${detail})` : ''}`);
}

async function shot(page, name) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}

// GPU driver performance notes from software rendering are not game errors.
const IGNORE = [/GPU stall due to ReadPixels/, /deprecated parameters for the initialization function/, /Automatic fallback to software WebGL/];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.some((r) => r.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreignRequests.push(r.url());
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('dialog', (d) => d.dismiss());
}

const g = (page, fn, a) => page.evaluate(fn, a);

async function waitForGame(page) {
  await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 90_000 });
  await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 30_000 });
}

/** Let the world run (headless pointer lock is unreliable, so start it directly). */
async function play(page) {
  await g(page, () => {
    window.__game.started = true;
  });
}

/** Keep the glitch bots out of the way (all down for 10 minutes of game time). */
async function parkBots(page) {
  await g(page, () => {
    const s = window.__game.session;
    for (const e of s.enemies.enemies) {
      e.alive = false;
      e.respawnAt = s.clockMs + 600_000;
    }
  });
}

async function walkTo(page, x, z) {
  await g(page, async ([tx, tz]) => {
    const game = window.__game;
    for (let i = 0; i < 3000; i++) {
      const p = game.player.position;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) break;
      const step = Math.min(d, 1.2);
      game.player.teleport([p.x + (dx / d) * step, 0.05, p.z + (dz / d) * step]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  }, [x, z]);
  await page.waitForTimeout(250);
}

async function fixThroughDebugger(page, id) {
  const pos = await g(page, (cid) => window.__game.world.stations.get(cid).data.pos, id);
  await walkTo(page, pos[0] + 1, pos[2] + 1.5);
  // Open it the way a player does: stand at the station and press E.
  await page.keyboard.press('KeyE');
  await page.waitForFunction((cid) => window.__game.challengeUI.current && window.__game.challengeUI.current.id === cid, id, { timeout: 10_000 });
  await g(page, (code) => window.__game.challengeUI.editor.setValue(code), CHALLENGES[id].solutionCode);
  await page.click('#btn-run');
  await page.waitForFunction(() => /0 failed/.test(document.querySelector('#ch-output .summary-line')?.textContent || ''), null, { timeout: 20_000 });
  await page.click('#btn-apply');
  await page.waitForFunction((cid) => window.__game.progress.solved.includes(cid), id, { timeout: 10_000 });
  await page.click('#btn-close-challenge');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

async function heapMb(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return usedSize / 1024 / 1024;
}

const notes = {};

try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  let page = await context.newPage();
  watch(page);

  // 1 ----------------------------------------------------------------------------------
  section(1, 'The game loads');
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForSelector('#main-menu:not([hidden])');
  check(await page.isVisible('#btn-new'), 'main menu is shown');
  check(await page.title() === 'Vice City: Bug Hunt 3D', 'page title');
  await shot(page, '01-main-menu');

  // 2 ----------------------------------------------------------------------------------
  section(2, 'The main menu works');
  check(await page.isDisabled('#btn-continue'), 'Continue is disabled when there is no save');
  check(/No saved game/.test(await page.textContent('#continue-info')), 'menu says there is no save yet');
  await page.click('#btn-controls');
  check(await page.isVisible('#controls'), 'Controls opens');
  await page.click('#btn-settings');
  check(await page.isVisible('#settings') && !(await page.isVisible('#main-menu')), 'Settings opens');
  check((await page.$$eval('#set-gfx option', (o) => o.map((x) => x.value))).join(',') === 'high,medium,low', 'graphics quality has High, Medium and Low');
  await page.selectOption('#set-gfx', 'low');
  check(await g(page, () => JSON.parse(localStorage.getItem('vcbh-settings')).graphics) === 'low', 'settings are stored');
  await page.click('#btn-settings-back');
  check(await page.isVisible('#main-menu'), 'Back returns to the main menu');

  // 3 ----------------------------------------------------------------------------------
  section(3, 'New Game starts correctly');
  await page.click('#btn-new');
  await waitForGame(page);
  notes.loadSeconds = (Date.now() - t0) / 1000;
  const fresh = await g(page, () => {
    const s = window.__game.session;
    return { pos: s.player.pos, health: s.player.health, score: s.statsView().totals.total, solved: s.progressView().solved.length, districts: s.progressView().districts, weapons: s.progressView().weapons, chips: s.statsView().chips, bots: s.enemiesView().length, alive: s.enemiesView().filter((e) => e.alive).length };
  });
  check(JSON.stringify(fresh.pos) === JSON.stringify([30, 0, -40]), 'player starts at the Ocean Drive spawn', JSON.stringify(fresh.pos));
  check(fresh.health === 100 && fresh.score === 0 && fresh.solved === 0 && fresh.chips === 0, 'health 100, score 0, no bugs fixed, no chips');
  check(fresh.districts.join() === 'ocean' && fresh.weapons.join() === 'pistol', 'only Ocean Drive and the pistol are unlocked');
  check(fresh.bots === 15 && fresh.alive === 15, '15 glitch bots are in the city');
  check(await page.isVisible('#click-to-play'), '"Click the game to start" is shown and the world waits');
  const clockBefore = await g(page, () => window.__game.session.clockMs);
  await page.waitForTimeout(500);
  check(await g(page, () => window.__game.session.clockMs) === clockBefore, 'the game clock does not run before the first click');
  await page.mouse.click(400, 400);
  await page.waitForTimeout(300);
  notes.pointerLockInHeadless = await g(page, () => !!document.pointerLockElement);
  await play(page);
  await page.waitForTimeout(400);
  check(await g(page, () => window.__game.session.clockMs) > clockBefore, 'the game clock runs once playing');
  await parkBots(page);
  await shot(page, '03-new-game');

  // 4 ----------------------------------------------------------------------------------
  section(4, 'Movement works');
  // Speeds are per second of game time (software rendering runs slower than real time).
  const where = () => g(page, () => { const p = window.__game.player.position; return [p.x, p.y, p.z, window.__game.playTimeMs]; });
  const toSpawn = () => g(page, () => { window.__game.player.teleport([30, 0.05, -40]); window.__game.camCtl.yaw = Math.PI; });
  // Steady-state speed: start moving, then measure over one second of game time.
  async function speedWith(keys) {
    await toSpawn();
    await page.waitForTimeout(300);
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(300);
    const a = await where();
    await page.waitForTimeout(1000);
    const b = await where();
    for (const k of keys) await page.keyboard.up(k);
    return Math.hypot(b[0] - a[0], b[2] - a[2]) / ((b[3] - a[3]) / 1000);
  }
  const walked = await speedWith(['KeyW']);
  check(walked > 4 && walked < 6, 'W walks forward', `${walked.toFixed(1)} m/s (walk speed 5)`);
  const ran = await speedWith(['ShiftLeft', 'KeyW']);
  check(ran > 7 && ran < 10, 'Shift sprints', `${ran.toFixed(1)} m/s (sprint speed 8.5)`);
  const p2 = await where();
  await page.keyboard.down('Space');
  let peak = 0;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(50);
    peak = Math.max(peak, await g(page, () => window.__game.player.position.y));
  }
  await page.keyboard.up('Space');
  await page.waitForTimeout(1200);
  const landed = await g(page, () => ({ y: window.__game.player.position.y, grounded: window.__game.player.grounded }));
  check(peak > 0.5, 'Space jumps', `peak ${peak.toFixed(2)} m`);
  check(landed.grounded && landed.y < peak - 0.4, 'gravity brings the player back down', `${landed.y.toFixed(2)} m, on the ground`);
  const enginePos = await g(page, () => window.__game.session.player.pos);
  check(Math.hypot(enginePos[0] - p2[0], enginePos[2] - p2[2]) < 3, 'the game engine tracks the player position');

  // 5 ----------------------------------------------------------------------------------
  section(5, 'The camera works');
  const cam0 = await g(page, () => { const c = window.__game.view.camera; return { yaw: window.__game.camCtl.yaw, dir: window.__game.camCtl.forward().toArray() }; });
  await g(page, () => window.__game.camCtl.look(300, 0));
  await page.waitForTimeout(200);
  const cam1 = await g(page, () => ({ yaw: window.__game.camCtl.yaw, dir: window.__game.camCtl.forward().toArray() }));
  check(Math.abs(cam1.yaw - cam0.yaw) > 0.1, 'mouse movement turns the camera', `yaw ${cam0.yaw.toFixed(2)} → ${cam1.yaw.toFixed(2)}`);
  const follow = await g(page, () => window.__game.view.camera.position.distanceTo(window.__game.player.position));
  check(follow > 1 && follow < 12, 'the camera follows behind the player', `${follow.toFixed(1)} m away`);
  await g(page, () => window.__game.camCtl.look(0, -200));
  check(await g(page, () => window.__game.camCtl.pitch) !== 0, 'the camera tilts up and down');

  // 6 ----------------------------------------------------------------------------------
  section(6, 'Collision works');
  // The block north of the spawn street: face it from the south and walk into it.
  const solid = await page.evaluate(async () => {
    const mod = await import('./shared/world-data.js');
    const p = window.__game.player.position;
    let best = null;
    for (const s of mod.getWorld().solids) {
      if (!s.id || !s.id.startsWith('b-') || s.id === 'b-ghost-hotel') continue;
      if (s.max[1] < 3 || s.min[2] < p.z) continue;
      if (p.x < s.min[0] + 1 || p.x > s.max[0] - 1) continue;
      if (!best || s.min[2] < best.min[2]) best = s;
    }
    if (!best) {
      for (const s of mod.getWorld().solids) {
        if (!s.id || !s.id.startsWith('b-') || s.id === 'b-ghost-hotel' || s.max[1] < 3 || s.max[0] - s.min[0] < 4) continue;
        if (!best || Math.hypot((s.min[0] + s.max[0]) / 2 - p.x, s.min[2] - p.z) < Math.hypot((best.min[0] + best.max[0]) / 2 - p.x, best.min[2] - p.z)) best = s;
      }
    }
    return best;
  });
  const fx = (solid.min[0] + solid.max[0]) / 2;
  await walkTo(page, fx, solid.min[2] - 3);
  await g(page, () => {
    window.__game.camCtl.yaw = Math.PI; // face +z
    window.__game.camCtl.pitch = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const stop = await g(page, () => { const p = window.__game.player.position; return [p.x, p.z]; });
  check(stop[1] < solid.min[2] + 0.05, 'walking into a building stops at its wall', `wall at z=${solid.min[2].toFixed(1)}, player at z=${stop[1].toFixed(2)}`);
  check(stop[1] > solid.min[2] - 2.5, 'the player did reach the wall', `${(solid.min[2] - stop[1]).toFixed(2)} m short`);
  await shot(page, '06-collision');

  // 7 ----------------------------------------------------------------------------------
  section(7, 'NPCs and interactions work');
  const peds0 = await g(page, () => window.__game.npcs.peds.slice(0, 4).map((p) => [p.npc.position.x, p.npc.position.z]));
  await page.waitForTimeout(1000);
  const peds1 = await g(page, () => window.__game.npcs.peds.slice(0, 4).map((p) => [p.npc.position.x, p.npc.position.z]));
  check(peds0.some((a, i) => Math.hypot(a[0] - peds1[i][0], a[1] - peds1[i][1]) > 0.3), 'pedestrians walk their routes');
  const loop = await g(page, async () => {
    const { runSubmission } = await import('./client/src/sandbox-runner.js');
    const { CHALLENGES: C } = await import('./challenges/index.js');
    const t = performance.now();
    const r = await runSubmission(C['ghost-wall'], `function ${C['ghost-wall'].entry}(a, b) { while (true) {} }`);
    return { passed: r.passed, first: r.results[0] && r.results[0].error, ms: performance.now() - t, alive: window.__game.running };
  });
  check(!loop.passed && /Timed out/.test(loop.first || '') && loop.ms < 5000 && loop.alive, 'an infinite loop in player code is stopped and reported; the game keeps running', `${Math.round(loop.ms)} ms`);
  await fixThroughDebugger(page, 'ghost-wall');
  check(await g(page, () => window.__game.session.scoreView().totals.bug) === 100, 'fixing Ghost Wall in the debugger pays 100 points');
  await shot(page, '07-debugger');
  // The Broken Car door: jammed before its fix, opens after.
  const carPos = await g(page, () => { const v = window.__game.vehicles.byId.get('car-1'); return [v.pos.x, v.pos.z]; });
  await walkTo(page, carPos[0], carPos[1] - 2.5);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  check(!(await g(page, () => !!window.__game.vehicles.driving)), 'before the Broken Car fix the car door is jammed');
  await fixThroughDebugger(page, 'broken-car');
  await walkTo(page, carPos[0], carPos[1] - 2.5);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  check(await g(page, () => !!window.__game.vehicles.driving), 'after the fix, E enters the car');
  const car0 = await g(page, () => window.__game.vehicles.driving.v.pos.toArray());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const car1 = await g(page, () => window.__game.vehicles.driving.v.pos.toArray());
  check(Math.hypot(car1[0] - car0[0], car1[2] - car0[2]) > 3, 'the car drives', `${Math.hypot(car1[0] - car0[0], car1[2] - car0[2]).toFixed(1)} m`);
  check(await page.isVisible('#vehicle-box'), 'the HUD shows vehicle info while driving');
  await shot(page, '07-driving');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  check(!(await g(page, () => !!window.__game.vehicles.driving)), 'E leaves the car');
  // Talk to Rico (Downtown needs the Invisible Gate fix first).
  await fixThroughDebugger(page, 'invisible-gate');
  const rico = await g(page, () => window.__game.npcs.missionNpcs.find((n) => n.id === 'npc-rico').pos);
  await walkTo(page, rico[0] + 1.5, rico[2] + 1.5);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  check(await g(page, () => window.__game.session.player.missionState['m-downtown'].step) === 1, 'pressing E next to Rico starts the courier mission');
  // Enemy AI: a bot patrols, notices the player and shoots; the player can stop it.
  const combat = await g(page, async () => {
    const game = window.__game;
    const s = game.session;
    const bot = s.enemies.enemies[0];
    bot.alive = true;
    bot.health = 60;
    bot.respawnAt = 0;
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Watch it patrol while the player is far away.
    game.player.teleport([30, 0.05, -40]);
    const start = [...bot.pos];
    for (let i = 0; i < 30; i++) await frames();
    const moved = Math.hypot(bot.pos[0] - start[0], bot.pos[2] - start[2]);
    // Then meet it on the beach avenue (z = -70): bot at x = 14, player at x = 0.
    bot.pos = [14, 0, -70];
    bot.mode = 'patrol';
    game.player.teleport([0, 0.05, -70]);
    for (let i = 0; i < 10; i++) await frames();
    let shotAt = 0;
    s.on('enemy-shot', () => shotAt++);
    for (let i = 0; i < 200 && !shotAt; i++) await frames();
    let shots = 0;
    for (let i = 0; i < 400 && bot.alive; i++) {
      const me = game.player.position;
      const dx = bot.pos[0] - me.x;
      const dz = bot.pos[2] - me.z;
      game.camCtl.yaw = Math.atan2(-dx, -dz);
      game.camCtl.pitch = -0.05;
      await frames();
      if (game.weapons.tryFire(me, game.enemyView.boxes(), true)) shots++;
      await new Promise((r) => setTimeout(r, 340));
    }
    return { moved, shotAt, shots, killed: !bot.alive, kills: s.statsView().kills, combat: s.scoreView().totals.combat, health: s.player.health };
  });
  check(combat.moved > 0.5, 'glitch bots patrol', `${combat.moved.toFixed(1)} m in 30 frames`);
  check(combat.shotAt > 0, 'a bot that sees the player shoots at them');
  check(combat.killed && combat.kills >= 1 && combat.combat >= 50, 'the player can stop a bot and earns combat points', `${combat.shots} shots`);
  notes.combat = combat;
  await parkBots(page);
  await shot(page, '07-combat');

  // 8 ----------------------------------------------------------------------------------
  section(8, 'Missions can be completed');
  const before8 = await g(page, () => window.__game.session.scoreView().totals.total);
  const pier = await g(page, async () => (await import('./shared/world-data.js')).MISSIONS[0].steps[0].pos);
  await walkTo(page, pier[0], pier[2]);
  await page.waitForTimeout(300);
  const m8 = await g(page, () => window.__game.session.missionsView().find((m) => m.id === 'm-ocean'));
  check(m8.done, 'walking to the end of the pier completes "Welcome to Vice"');
  check(await g(page, () => window.__game.session.scoreView().totals.total) - before8 === 150, 'the mission pays 150 points');
  // A data chip on the way back.
  const chip = await g(page, () => window.__game.session.pickupsView().find((p) => p.kind === 'chip' && p.visible).pos);
  await walkTo(page, chip[0], chip[2]);
  await page.waitForTimeout(300);
  check(await g(page, () => window.__game.session.statsView().chips) === 1, 'walking over a data chip collects it');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  check(await page.isVisible('#stats') && /Data chips: 1 \/ 15/.test(await page.textContent('#stats')), 'Tab shows inventory and stats');
  await shot(page, '08-stats');
  await page.keyboard.press('Tab');

  // 9 ----------------------------------------------------------------------------------
  section(9, 'Pause and resume work');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(await page.isVisible('#pause'), 'Esc opens the pause menu');
  check((await page.$$eval('#pause button', (b) => b.map((x) => x.textContent))).join('|') === 'Resume|Save Game|Restart|Settings|Exit to Main Menu', 'pause menu has Resume, Save Game, Restart, Settings, Exit to Main Menu');
  const frozen0 = await g(page, () => ({ clock: window.__game.session.clockMs, play: window.__game.playTimeMs, peds: window.__game.npcs.peds[0].npc.position.x }));
  await page.waitForTimeout(1000);
  const frozen1 = await g(page, () => ({ clock: window.__game.session.clockMs, play: window.__game.playTimeMs, peds: window.__game.npcs.peds[0].npc.position.x }));
  check(frozen0.clock === frozen1.clock && frozen0.play === frozen1.play && frozen0.peds === frozen1.peds, 'while paused the game clock, play time and pedestrians stand still');
  await shot(page, '09-paused');
  await page.click('#btn-resume');
  await page.waitForTimeout(400);
  check(!(await page.isVisible('#pause')), 'Resume closes the menu');
  check(await g(page, () => window.__game.session.clockMs) > frozen1.clock, 'the game runs again after Resume');

  // 10 ---------------------------------------------------------------------------------
  section(10, 'Save and load work');
  await page.keyboard.press('Escape');
  await page.click('#btn-save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('save-status').textContent), null, { timeout: 10_000 });
  const saved = await g(page, () => {
    const s = window.__game.session;
    return { pos: s.player.lastValidPos.map((v) => Math.round(v * 100) / 100), health: s.player.health, score: s.statsView().totals.total, solved: s.progressView().solved, chips: s.statsView().chips, missions: s.statsView().missionsCompleted, courier: s.player.missionState['m-downtown'].step, play: Math.round(window.__game.playTimeMs / 1000) };
  });
  check(true, 'Save Game writes the save', `score ${saved.score}`);
  const stored = await g(page, async () => {
    const m = await import('./client/src/save-store.js');
    return { backend: await m.backend(), list: (await m.listSaves()).map((x) => [x.key, x.ok]) };
  });
  check(stored.backend === 'IndexedDB' && stored.list.some(([k, ok]) => k === 'manual' && ok), 'the save is in IndexedDB and passes its checks', JSON.stringify(stored.list));
  // Change things after saving, then load the save.
  await page.click('#btn-resume');
  await walkTo(page, saved.pos[0] + 6, saved.pos[2]);
  await page.reload();
  await page.waitForSelector('#main-menu:not([hidden])');
  await page.waitForFunction(() => !document.getElementById('btn-continue').disabled, null, { timeout: 10_000 });
  check(/score/.test(await page.textContent('#continue-info')), 'after a reload, Continue shows the saved game', (await page.textContent('#continue-info')).trim());
  await page.click('#btn-load');
  await page.waitForSelector('#load-panel:not([hidden])', { timeout: 5000 }).catch(() => {});
  check(await page.isVisible('#load-panel') && (await page.$$('#load-list button[data-i]')).length >= 1, 'Load Game lists the saves', `${(await page.$$('#load-list button[data-i]')).length} loadable`);
  await page.click('#btn-load-close');
  await page.click('#btn-continue');
  await waitForGame(page);
  const loaded = await g(page, () => {
    const s = window.__game.session;
    return { pos: s.player.pos.map((v) => Math.round(v * 100) / 100), health: s.player.health, score: s.statsView().totals.total, solved: s.progressView().solved, chips: s.statsView().chips, missions: s.statsView().missionsCompleted, courier: s.player.missionState['m-downtown'].step, play: Math.round(window.__game.playTimeMs / 1000) };
  });
  // Exit to the menu autosaved too, so the newest save may be a little later than the manual one.
  check(loaded.score === saved.score && JSON.stringify(loaded.solved) === JSON.stringify(saved.solved), 'score and fixed bugs are restored', `${loaded.score} points, ${loaded.solved.length} bugs`);
  check(loaded.chips === saved.chips && loaded.missions === saved.missions && loaded.courier === saved.courier, 'chips, missions and the courier step are restored');
  check(Math.hypot(loaded.pos[0] - saved.pos[0], loaded.pos[2] - saved.pos[2]) < 8, 'position is restored', JSON.stringify(loaded.pos));
  check(await g(page, () => window.__game.progress.gates.includes('gate-downtown')), 'unlocked gates are open again');
  check(await g(page, () => window.__game.challengeUI.progress.solved.length) === saved.solved.length, 'the debugger shows the fixes');
  check(loaded.play >= saved.play, 'play time carries over');
  // A damaged save is reported and skipped.
  await g(page, async () => {
    const m = await import('./client/src/save-store.js');
    await m.writeRawForTest('manual', '{"format":"vice-city-bughunt-save","version":1,"state":{"trunc');
  });
  await page.reload();
  await page.waitForSelector('#main-menu:not([hidden])');
  await page.waitForFunction(() => !document.getElementById('save-warning').hidden, null, { timeout: 10_000 });
  check(/damaged/.test(await page.textContent('#save-warning')), 'a damaged save is reported on the menu', (await page.textContent('#save-warning')).slice(0, 90));
  check(!(await page.isDisabled('#btn-continue')), 'Continue still offers the newest intact save');
  await shot(page, '10-damaged-save');
  await page.click('#btn-continue');
  await waitForGame(page);
  check(await g(page, () => window.__game.session.statsView().bugsFixed) === saved.solved.length, 'Continue loads the intact save');

  // 11 ---------------------------------------------------------------------------------
  section(11, 'Restart works');
  await play(page);
  await page.keyboard.press('Escape');
  await page.click('#btn-restart');
  check(await page.isVisible('#confirm'), 'Restart asks first');
  await page.click('#confirm-ok');
  await page.waitForLoadState('load');
  await waitForGame(page);
  const restarted = await g(page, () => {
    const s = window.__game.session;
    return { pos: s.player.pos, score: s.statsView().totals.total, solved: s.progressView().solved.length, chips: s.statsView().chips, clock: s.clockMs };
  });
  check(JSON.stringify(restarted.pos) === '[30,0,-40]' && restarted.score === 0 && restarted.solved === 0 && restarted.chips === 0, 'Restart returns to the starting state');
  const afterRestart = await g(page, async () => (await (await import('./client/src/save-store.js')).listSaves()).filter((x) => x.ok).length);
  check(afterRestart >= 1, 'saved games are kept after Restart');

  // 12 ---------------------------------------------------------------------------------
  section(12, 'No multiplayer errors or network dependencies remain');
  check(sockets.length === 0, 'no WebSocket connections were opened', sockets.join(', '));
  check(foreignRequests.length === 0, 'every request stayed on the static site (no CDN, no API)', foreignRequests.slice(0, 3).join(', '));
  const leftovers = await g(page, () => ['io', 'Network', 'socket'].filter((k) => k in window));
  check(leftovers.length === 0, 'no networking globals on the page', leftovers.join(','));

  // 13 ---------------------------------------------------------------------------------
  section(13, 'The game works after a refresh');
  await play(page);
  await parkBots(page);
  await fixThroughDebugger(page, 'ghost-wall');
  await page.waitForTimeout(2500); // the fix triggers an autosave
  await page.reload();
  await page.waitForSelector('#main-menu:not([hidden])');
  await page.waitForFunction(() => /Autosave/.test(document.getElementById('continue-info').textContent), null, { timeout: 10_000 });
  check(true, 'after a refresh the autosave is offered', (await page.textContent('#continue-info')).trim());
  await page.click('#btn-continue');
  await waitForGame(page);
  check(await g(page, () => window.__game.session.progressView().solved.includes('ghost-wall')), 'the fix made just before the refresh is still there');
  await play(page);
  await page.waitForTimeout(500);
  check(await g(page, () => window.__game.running && window.__game.session.clockMs > 0), 'the game runs after the refresh');

  // 14 ---------------------------------------------------------------------------------
  section(14, 'No major console errors or memory leaks');
  await parkBots(page);
  await g(page, () => window.__game.weapons.equip('pistol'));
  // Shooting for 300 frames per round. The first rounds warm up the pooled
  // effects (each is uploaded to the GPU the first time it is drawn, and the
  // pool holds 64 tracers); later rounds must not add anything.
  const round = () => g(page, async () => {
    const game = window.__game;
    const frames = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 300; i++) {
      game.session.player.loadout.pistol.ammo = 12; // keep shooting without reload pauses
      game.weapons.tryFire(game.player.position, game.enemyView.boxes(), true);
      await frames();
    }
  });
  await round();
  await round();
  await round();
  await page.waitForTimeout(300);
  const objects = () => g(page, () => { let n = 0; window.__game.view.scene.traverse(() => n++); return n; });
  const objects0 = await objects();
  const mem0 = { heap: await heapMb(page), gpu: await g(page, () => ({ ...window.__game.view.renderer.info.memory })) };
  await round();
  await round();
  await page.waitForTimeout(300);
  const objects1 = await objects();
  check(objects1 === objects0, 'firing adds no objects to the scene (pooled effects)', `${objects0} → ${objects1}`);
  const mem1 = { heap: await heapMb(page), gpu: await g(page, () => ({ ...window.__game.view.renderer.info.memory })) };
  notes.memory = { before: mem0, after: mem1 };
  check(mem1.gpu.geometries <= mem0.gpu.geometries + 2 && mem1.gpu.textures <= mem0.gpu.textures + 2, 'after warm-up, firing hundreds more shots creates no new GPU buffers', `geometries ${mem0.gpu.geometries} → ${mem1.gpu.geometries}, textures ${mem0.gpu.textures} → ${mem1.gpu.textures}`);
  check(mem1.heap - mem0.heap < 15, 'JavaScript heap stays flat', `${mem0.heap.toFixed(1)} → ${mem1.heap.toFixed(1)} MB after garbage collection`);
  notes.fps = await g(page, () => window.__game.lastFps);
  check(errors.length === 0, 'no console errors or uncaught exceptions during the whole run', errors.slice(0, 5).join(' | '));
  await shot(page, '14-end');
} catch (e) {
  console.error(e);
  if (!current) section(0, 'Setup');
  check(false, `test crashed: ${e.message.split('\n')[0]}`);
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} sections passed. Notes: ${JSON.stringify(notes)}`);
if (errors.length) console.log(`Console: ${errors.join('\n')}`);
if (reportFile) fs.writeFileSync(reportFile, JSON.stringify({ when: new Date().toISOString(), target: process.argv.includes('--dist') ? 'dist' : 'source', results, notes, errors }, null, 2));
process.exit(failed.length ? 1 : 0);
