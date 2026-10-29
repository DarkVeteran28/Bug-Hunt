// Headless browser end-to-end test. Starts the server on a random port with a
// temporary database, plays the game in Chromium (two players), and checks
// that fixes change real game behaviour and that combat works between
// browsers. Usage: node scripts/browser-smoke.js [--screenshots dir]
//
// Playwright is not a runtime dependency: install it with `npm i -D playwright`
// (plus `npx playwright install chromium`), or point NODE_PATH at a global install.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { Room } from '../server/room-manager.js';
import { CHALLENGES } from '../challenges/index.js';
import { VEHICLE_SPAWNS, districtCenterX } from '../shared/world-data.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const shotsDir = process.argv.includes('--screenshots') ? process.argv[process.argv.indexOf('--screenshots') + 1] : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vcbh-'));
const corrections = [];
const origCorrection = Room.prototype.correction;
Room.prototype.correction = function (p, reason) {
  corrections.push(reason);
  return origCorrection.call(this, p, reason);
};
const game = createGameServer({ dbFile: path.join(tmp, 'smoke.db') });
const port = await game.listen(0, '127.0.0.1');
const url = `http://127.0.0.1:${port}/`;
const errors = [];
let browser;
let failed = false;

function check(cond, msg) {
  if (!cond) {
    failed = true;
    console.error(`FAIL: ${msg}`);
  } else console.log(`ok: ${msg}`);
}

async function shot(page, name) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
}

async function openPlayer(name, options = { mode: 'freeroam' }) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`);
  });
  await page.goto(url);
  await page.fill('#lobby-name', name);
  if (options.code) {
    await page.click('.lobby-more summary');
    await page.fill('#join-code', options.code);
    await page.click('#btn-join');
  } else {
    await page.click('#btn-freeroam');
  }
  await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}

/** Walk in small steps (server movement validation accepts them). */
async function walkTo(page, x, z, maxSteps = 4000) {
  await page.evaluate(async ([tx, tz, max]) => {
    const g = window.__game;
    for (let i = 0; i < max; i++) {
      const p = g.player.position;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) break;
      const step = Math.min(d, 0.35);
      g.player.teleport([p.x + (dx / d) * step, 0.05, p.z + (dz / d) * step]);
      await new Promise((r) => setTimeout(r, 50));
      g.sendState(true);
    }
  }, [x, z, maxSteps]);
  await page.waitForTimeout(300);
}

async function walkToStation(page, id) {
  const pos = await page.evaluate((cid) => window.__game.world.stations.get(cid).data.pos, id);
  await walkTo(page, pos[0] + 1, pos[2] + 1.5);
}

/** Open a challenge at its station, submit the reference fix through the UI and apply it. */
async function fixThroughUi(page, id) {
  await walkToStation(page, id);
  const opened = await page.evaluate((cid) => window.__game.challengeUI.open(cid), id);
  if (!opened) return false;
  await page.waitForTimeout(300);
  await page.evaluate((code) => window.__game.challengeUI.editor.setValue(code), CHALLENGES[id].solutionCode);
  await page.click('#btn-run');
  await page.waitForFunction(() => /0 failed/.test(document.querySelector('#ch-output .summary-line')?.textContent || ''), null, { timeout: 15000 });
  await page.click('#btn-apply');
  await page.waitForFunction((cid) => window.__game.progress.solved.includes(cid), id, { timeout: 10000 });
  await page.evaluate(() => window.__game.challengeUI.close());
  return true;
}

try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await openPlayer('SmokeTester');
  await page.waitForTimeout(1500);
  await shot(page, '1-start');
  const state = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player.position;
    return {
      canvas: !!document.querySelector('#canvas-host canvas'),
      draws: g.view.renderer.info.render.calls,
      pos: [p.x, p.y, p.z],
      bugs: document.getElementById('b-bugs').textContent,
      stations: g.world.stations.size,
    };
  });
  check(state.canvas, '3D canvas present');
  check(state.draws > 5, `scene renders (${state.draws} draw calls)`);
  check(state.pos[1] > -1 && state.pos[1] < 3, `player stands on the ground (y=${state.pos[1].toFixed(2)})`);
  check(state.bugs === '0/12', 'bug counter shows 0/12');
  check(state.stations === 12, '12 debugging stations built');

  // --- Ghost Wall, step by step through the UI ---------------------------
  await walkToStation(page, 'ghost-wall');
  check(await page.evaluate(() => window.__game.challengeUI.open('ghost-wall')), 'challenge opens at its station');
  await page.waitForTimeout(800);
  check(await page.evaluate(() => window.__game.challengeUI.editor.isMonaco), 'Monaco editor loaded');
  check(await page.isVisible('#challenge'), 'debugger panel shows the challenge');
  check(await page.isVisible('#canvas-host canvas'), 'game stays visible beside the editor');

  const before = await page.evaluate(() => { const p = window.__game.player.position; return [p.x, p.z]; });
  await page.click('#editor-host .view-lines');
  await page.keyboard.type('wwwwdddd ');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => { const p = window.__game.player.position; return [p.x, p.z]; });
  check(Math.hypot(after[0] - before[0], after[1] - before[1]) < 0.05, 'typing WASD in the editor does not move the player');

  // Before the fix the hotel can be walked into.
  await walkTo(page, 17, -28, 120);
  const ghostBefore = await page.evaluate(() => window.__game.player.inHotel);
  check(ghostBefore, 'before the fix the player can stand inside the Sunset Hotel');
  await walkToStation(page, 'ghost-wall');

  await page.evaluate(() => window.__game.challengeUI.editor.setValue(window.__game.challengeUI.current.starterCode));
  await page.click('#btn-run');
  await page.waitForSelector('#ch-output .summary-line', { timeout: 15000 });
  const failText = await page.textContent('#ch-output .summary-line');
  check(/failed/.test(failText) && !/ 0 failed/.test(failText), `buggy code fails tests (${failText.trim()})`);
  check(await page.isDisabled('#btn-apply'), 'Apply Fix disabled after failing tests');
  check(await page.textContent('#top-score') === '0', 'failed tests award no points');

  await page.evaluate((code) => window.__game.challengeUI.editor.setValue(code), CHALLENGES['ghost-wall'].solutionCode);
  await page.click('#btn-run');
  await page.waitForFunction(() => /0 failed/.test(document.querySelector('#ch-output .summary-line')?.textContent || ''), null, { timeout: 15000 });
  check(!(await page.isDisabled('#btn-apply')), 'Apply Fix enabled after all tests pass');
  await shot(page, '2-tests-pass');
  await page.click('#btn-apply');
  await page.waitForFunction(() => document.getElementById('b-bugs').textContent === '1/12', null, { timeout: 10000 });
  check(true, 'bug counter updates to 1/12');
  await page.waitForTimeout(400);
  const score = await page.textContent('#top-score');
  check(score.replace(/,/g, '') === '100', `score shows 100 after the fix (got ${score})`);
  await shot(page, '3-fixed');
  await page.evaluate(() => window.__game.challengeUI.close());
  await walkTo(page, 17, -45);
  await walkTo(page, 17, -28, 80);
  const hotel = await page.evaluate(() => window.__game.player.inHotel);
  check(!hotel, 'after the fix the Sunset Hotel pushes the player out');
  await page.evaluate(() => window.__game.challengeUI.close());

  // --- Broken Car ----------------------------------------------------------
  const car = VEHICLE_SPAWNS[0];
  await walkTo(page, car.pos[0] - 1, car.pos[2] - 2.5);
  await page.evaluate(() => window.__game.enterVehicle(window.__game.vehicles.byId.get('car-1')));
  await page.waitForTimeout(500);
  check(!(await page.evaluate(() => !!window.__game.vehicles.driving)), 'before the Broken Car fix the door is jammed');
  check(await fixThroughUi(page, 'broken-car'), 'Broken Car fixed through the editor');
  await walkTo(page, car.pos[0] - 1, car.pos[2] - 2.5);
  await page.evaluate(() => window.__game.enterVehicle(window.__game.vehicles.byId.get('car-1')));
  await page.waitForTimeout(500);
  check(await page.evaluate(() => !!window.__game.vehicles.driving), 'after the fix the player can enter the car');
  const start = await page.evaluate(() => window.__game.vehicles.driving.v.pos.x);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.down('KeyW');
  await page.waitForFunction((x0) => Math.abs(window.__game.vehicles.driving.v.pos.x - x0) > 3, start, { timeout: 15000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const end = await page.evaluate(() => window.__game.vehicles.driving.v.pos.x);
  check(Math.abs(end - start) > 3, `the car drives (moved ${Math.abs(end - start).toFixed(1)} units)`);
  await shot(page, '4-driving');
  await page.waitForTimeout(1500); // let the car coast to a stop and the last update arrive
  const settled = await page.evaluate(() => window.__game.vehicles.driving.v.pos.x);
  const serverCar = [...game.rooms.rooms.values()].find((r) => r.players.size).vehicles.get('car-1');
  check(Math.abs(serverCar.pos[0] - settled) < 3, `the server accepted the car movement (server x=${serverCar.pos[0].toFixed(1)}, client x=${settled.toFixed(1)}, corrections: ${corrections.join(',') || 'none'})`);
  await page.evaluate(() => window.__game.exitVehicle());
  await page.waitForTimeout(500);
  check(!(await page.evaluate(() => !!window.__game.vehicles.driving)), 'the player can leave the car');

  // --- Invisible Gate ------------------------------------------------------
  const gateX = districtCenterX(0) + 90;
  await walkTo(page, gateX - 4, -10);
  await page.evaluate(() => window.__game.demos.run('invisible-gate', window.__game.progress));
  await page.waitForFunction(() => window.__game.gates.state.get('gate-downtown').progress > 0.95, null, { timeout: 20000 }).catch(() => {});
  const cycle = await page.evaluate(() => window.__game.gates.state.get('gate-downtown'));
  check(cycle.progress > 0.9 && cycle.solid === true, `gate test cycle: door opens but stays solid (the bug) (${JSON.stringify(cycle)})`);
  await walkTo(page, gateX + 5, -10);
  check(await page.evaluate(() => window.__game.player.position.x) < gateX + 1, 'locked gate blocks the player');
  check(await fixThroughUi(page, 'invisible-gate'), 'Invisible Gate fixed through the editor');
  await page.waitForFunction(() => window.__game.gates.state.get('gate-downtown').progress >= 1, null, { timeout: 20000 }).catch(() => {});
  const gate = await page.evaluate(() => window.__game.gates.state.get('gate-downtown'));
  check(gate.solid === false, 'after the fix the Downtown gate is passable');
  await walkTo(page, gateX + 6, -10);
  await page.waitForTimeout(400);
  const px = await page.evaluate(() => window.__game.player.position.x);
  check(px > gateX + 3, `the player walked into Downtown (x=${px.toFixed(1)})`);
  await shot(page, '5-downtown');

  // --- Teleporting NPCs are visibly broken before their fix ---------------
  const teleports = await page.evaluate(() => window.__game.npcs.teleports);
  check(teleports > 0, `buggy pedestrian code makes NPCs teleport (${teleports} teleports so far)`);

  // --- Second player: multiplayer and combat between browsers -------------
  const roomCode = await page.evaluate(() => window.__game.room.code);
  const page2 = await openPlayer('SecondPlayer', { mode: 'freeroam' });
  check(await page2.evaluate(() => window.__game.room.code) === roomCode, 'second browser joined the same public room');
  // Bring both players to the Ocean Drive beach road, facing each other.
  await walkTo(page, districtCenterX(0) + 60, -85);
  await walkTo(page2, districtCenterX(0) + 60, -75);
  await page.waitForTimeout(1200);
  const sees = await page.evaluate(() => [...window.__game.remotes.values()].some((r) => r.ch && r.ch.root.visible));
  check(sees, 'player 1 sees player 2 in the 3D world');
  const dmg = await page.evaluate(async () => {
    const g = window.__game;
    g.camCtl.yaw = Math.PI; // look north toward +z
    g.camCtl.pitch = -0.05;
    await new Promise((r) => setTimeout(r, 400));
    let shots = 0;
    for (let i = 0; i < 8; i++) {
      if (g.weapons.tryFire(g.player.position, g.lastRemoteBoxes)) shots++;
      await new Promise((r) => setTimeout(r, 360));
    }
    return shots;
  });
  check(dmg >= 4, `player 1 fired ${dmg} shots`);
  await page.waitForTimeout(800);
  const p2 = await page2.evaluate(() => ({ health: window.__game.health, alive: window.__game.alive, feed: document.getElementById('killfeed').textContent }));
  check(p2.health < 100, `player 2 took server-validated damage (health ${p2.health})`);
  check(!p2.alive && /SmokeTester/.test(p2.feed), 'player 2 was eliminated and the kill feed shows it');
  await shot(page2, '6-eliminated');
  const score1 = Number((await page.textContent('#top-score')).replace(/,/g, ''));
  check(score1 >= 100 + 100 + 250 + 100, `player 1 score includes the elimination (${score1})`);
  await page2.waitForTimeout(3500);
  check(await page2.evaluate(() => window.__game.alive && window.__game.health === 100), 'player 2 respawned with full health');
  await shot(page, '7-after-fight');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  if (errors.length) {
    console.error('Browser errors:');
    for (const e of errors) console.error('  ' + e);
  }
  check(errors.length === 0, 'no browser errors');
  if (browser) await browser.close();
  await game.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
