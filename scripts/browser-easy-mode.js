// Headless check of Easy mode: guide notes, line highlights, Show Fix at half reward.
// Run: NODE_PATH=$(npm root -g) node scripts/browser-easy-mode.js
import { createGameServer } from '../server/index.js';
import { STATIONS } from '../shared/world-data.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import os from 'node:os';
import path from 'node:path';
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'vc-easy-'));
const dbFile = path.join(out, 'easy.db');
fs.rmSync(dbFile, { force: true });
const game = createGameServer({ dbFile: dbFile });
const port = await game.listen(0, '127.0.0.1');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(`http://127.0.0.1:${port}/`);
await page.fill('#lobby-name', 'Learner');
await page.click('#btn-freeroam');
await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 30000 });
const room = [...game.rooms.rooms.values()].find((r) => r.players.size);
const p = [...room.players.values()][0];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'ok:' : 'FAIL:', m); };
for (const id of ['broken-car', 'ghost-wall']) {
  const st = STATIONS.find((s) => s.challengeId === id);
  p.pos = [st.pos[0] + 1, 0, st.pos[2]]; p.lastValidPos = [...p.pos];
  await page.evaluate((pos) => window.__game.player.teleport(pos), [st.pos[0] + 1, 0.1, st.pos[2]]);
  await page.waitForTimeout(300);
  p.pos = [st.pos[0] + 1, 0, st.pos[2]]; p.lastValidPos = [...p.pos];
  ok(await page.evaluate((id) => window.__game.challengeUI.open(id), id), `${id} opens`);
  await page.waitForTimeout(800);
  const guide = await page.evaluate(() => ({ hidden: document.getElementById('ch-guide').hidden, text: document.getElementById('ch-guide').innerText, marks: document.querySelectorAll('#editor-host .bug-line').length, fixBtn: !document.getElementById('btn-solution').hidden }));
  ok(!guide.hidden && guide.marks > 0 && guide.fixBtn, `${id}: guide shown with ${guide.marks} highlighted line(s), Show Fix visible`);
  console.log('   ', guide.text.split('\n').slice(0, 3).join(' | '));
  await page.screenshot({ path: `${out}/easy-${id}.png` });
  if (id === 'broken-car') {
    // fix by hand: edit the buggy line, the note should switch to "Edited"
    await page.evaluate(() => { const ui = window.__game.challengeUI; ui.editor.setValue(ui.editor.getValue().replace('vehicle.driver !== null && distance > range', 'vehicle.driver === null && distance <= range')); });
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => document.getElementById('ch-guide').innerText);
    ok(/Edited/.test(t), 'editing the buggy line marks the note as edited');
    await page.click('#btn-run');
    await page.waitForFunction(() => !document.getElementById('btn-apply').disabled, null, { timeout: 15000 });
    await page.click('#btn-apply');
    await page.waitForTimeout(800);
  } else {
    await page.click('#btn-solution');
    await page.waitForTimeout(800);
    const meta = await page.evaluate(() => document.getElementById('ch-meta').innerText);
    ok(/50/.test(meta), `reward shows half after Show Fix (${meta})`);
    await page.click('#btn-run');
    await page.waitForFunction(() => !document.getElementById('btn-apply').disabled, null, { timeout: 15000 });
    await page.click('#btn-apply');
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => window.__game.challengeUI.close());
}
const totals = game.db.totals(p.id);
ok(totals.bug === 150, `bug points: 100 (own fix) + 50 (Show Fix) = ${totals.bug}`);
ok(errors.length === 0, `no browser errors ${errors.slice(0, 3).join(' / ')}`);
await browser.close(); await game.close(); process.exit(failed ? 1 : 0);
