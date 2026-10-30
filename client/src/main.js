// Entry point: main menu (New Game, Continue, Load, Settings, Controls),
// then one single-player game. Everything runs in this page; nothing is
// sent to a server.
//
// Restart and Exit to Main Menu reload the page (with a one-time flag for
// Restart). A reload frees every GPU buffer, physics body and listener of the
// old game, which is simpler and safer than tearing each one down by hand.
import { GameSession } from '../../engine/session.js';
import { Game } from './game.js';
import { runSubmission } from './sandbox-runner.js';
import { latestValidSave, listSaves, backend, deleteAllSaves } from './save-store.js';
import { settings, saveSettings, onSettings, applySavedSettings, GRAPHICS } from './settings.js';
import { unlockAudio } from './audio.js';
import { confirmDialog } from './dialog.js';
import { formatTime, esc } from './combat-ui.js';

const $ = (id) => document.getElementById(id);
const BOOT_KEY = 'vcbh-boot';
const SLOT_NAMES = { manual: 'Saved game', auto: 'Autosave', 'manual-backup': 'Saved game (previous)', 'auto-backup': 'Autosave (previous)' };

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function fatal(msg) {
  $('fatal-text').textContent = msg;
  $('fatal').hidden = false;
}

// --- Settings screen (shared by the main menu and the pause menu) ------------

let settingsBack = null;

function setupSettings() {
  $('set-gfx').innerHTML = Object.entries(GRAPHICS).map(([k, g]) => `<option value="${k}">${g.label}${k === 'high' ? ' (shadows)' : k === 'low' ? ' (older computers)' : ''}</option>`).join('');
  const sync = () => {
    $('set-sens').value = settings.sensitivity;
    $('sens-val').textContent = Number(settings.sensitivity).toFixed(1);
    $('set-invert').checked = settings.invertY;
    $('set-vol').value = settings.volume;
    $('vol-val').textContent = `${Math.round(settings.volume * 100)}%`;
    $('set-mute').checked = settings.muted;
    $('set-gfx').value = settings.graphics;
    $('set-light').value = settings.lighting;
    $('set-fps').checked = settings.showFps;
  };
  sync();
  onSettings(sync);
  $('set-sens').addEventListener('input', (e) => saveSettings({ sensitivity: Number(e.target.value) }));
  $('set-invert').addEventListener('change', (e) => saveSettings({ invertY: e.target.checked }));
  $('set-vol').addEventListener('input', (e) => saveSettings({ volume: Number(e.target.value) }));
  $('set-mute').addEventListener('change', (e) => saveSettings({ muted: e.target.checked }));
  $('set-gfx').addEventListener('change', (e) => {
    saveSettings({ graphics: e.target.value });
    $('gfx-note').hidden = !window.__game;
  });
  $('set-light').addEventListener('change', (e) => saveSettings({ lighting: e.target.value }));
  $('set-fps').addEventListener('change', (e) => saveSettings({ showFps: e.target.checked }));
  $('btn-settings-back').addEventListener('click', () => {
    $('settings').hidden = true;
    if (settingsBack) settingsBack();
  });
  $('btn-delete-saves').addEventListener('click', async () => {
    if (!(await confirmDialog('Delete every saved game in this browser? This cannot be undone.', { ok: 'Delete saves', danger: true }))) return;
    await deleteAllSaves();
    $('saves-info').textContent = 'All saves deleted.';
    if (!window.__game) refreshMenu();
  });
}

async function openSettings(onBack) {
  settingsBack = onBack;
  $('gfx-note').hidden = true;
  $('settings').hidden = false;
  $('saves-info').textContent = `Saves are stored in this browser (${await backend()}). Clearing site data deletes them.`;
}

// --- Main menu -----------------------------------------------------------------

let latest = null;

function describeSave(save) {
  const s = save.summary || {};
  return `${new Date(save.savedAt).toLocaleString()} · score ${Number(s.score || 0).toLocaleString()} · ${s.bugsFixed || 0}/12 bugs · play time ${formatTime(save.playTimeMs || 0)}`;
}

async function refreshMenu() {
  const { latest: found, damaged } = await latestValidSave();
  latest = found;
  $('btn-continue').disabled = !latest;
  $('btn-load').disabled = !latest;
  $('continue-info').textContent = latest ? `${SLOT_NAMES[latest.key]} · ${describeSave(latest.save)}` : 'No saved game in this browser yet.';
  $('save-warning').hidden = damaged.length === 0;
  if (damaged.length) {
    $('save-warning').textContent = `${damaged.length === 1 ? 'One save is' : `${damaged.length} saves are`} damaged and will not be loaded (${damaged.map((d) => `${SLOT_NAMES[d.key]}: ${d.error}`).join(' ')})${latest ? ' Continue uses the newest save that is intact.' : ''}`;
  }
}

async function showLoadList() {
  const all = await listSaves();
  $('load-list').innerHTML = all.map((s, i) => s.ok
    ? `<li><button class="btn" data-i="${i}">${esc(SLOT_NAMES[s.key])}</button><span class="muted">${esc(describeSave(s.save))}</span></li>`
    : `<li><button class="btn" disabled>${esc(SLOT_NAMES[s.key])}</button><span class="bad-text">Damaged: ${esc(s.error)}</span></li>`).join('') || '<li class="muted">No saves.</li>';
  $('load-list').querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => startGame(all[Number(b.dataset.i)])));
  $('load-panel').hidden = false;
}

function setMenuBusy(busy) {
  for (const b of document.querySelectorAll('#main-menu button')) b.disabled = busy || (!latest && (b.id === 'btn-continue' || b.id === 'btn-load'));
}

// --- Starting a game -------------------------------------------------------------

async function startGame(entry) {
  if (!webglAvailable()) {
    $('menu-error').textContent = 'Your browser does not support WebGL, which the 3D city needs.';
    return;
  }
  unlockAudio();
  setMenuBusy(true);
  $('main-menu').hidden = true;
  $('loading').hidden = false;
  let session;
  try {
    if (entry) applySavedSettings(entry.save.settings);
    session = new GameSession({ state: entry ? entry.state : null, runner: runSubmission });
  } catch (e) {
    // validateSave passed but the engine could not use it: report, do not crash.
    console.error(e);
    $('loading').hidden = true;
    $('main-menu').hidden = false;
    $('menu-error').textContent = `That save could not be loaded (${e.message}). Start a new game or pick another save.`;
    setMenuBusy(false);
    return;
  }
  const game = new Game({
    session,
    playTimeMs: entry ? entry.save.playTimeMs : 0,
    menus: {
      openSettings,
      restart() {
        sessionStorage.setItem(BOOT_KEY, 'new');
        location.reload();
      },
      exitToMenu() {
        location.reload();
      },
    },
  });
  window.__game = game; // used by the browser tests and handy in the console
  try {
    $('app').hidden = false;
    await game.init();
    game.start();
    $('loading').hidden = true;
  } catch (e) {
    console.error(e);
    fatal(`The city failed to load: ${e.message}. Try the Low graphics setting or another browser.`);
  }
}

async function boot() {
  setupSettings();
  $('btn-new').addEventListener('click', async () => {
    if (latest && !(await confirmDialog('Start a new game? Your saves stay in this browser, but the next autosave will replace the autosave slot.', { ok: 'New game' }))) return;
    startGame(null);
  });
  $('btn-continue').addEventListener('click', () => latest && startGame(latest));
  $('btn-load').addEventListener('click', showLoadList);
  $('btn-load-close').addEventListener('click', () => {
    $('load-panel').hidden = true;
  });
  $('btn-settings').addEventListener('click', () => {
    $('main-menu').hidden = true;
    openSettings(() => {
      $('main-menu').hidden = false;
    });
  });
  $('btn-controls').addEventListener('click', () => {
    $('controls').hidden = !$('controls').hidden;
  });
  if (!webglAvailable()) $('menu-error').textContent = 'Your browser does not support WebGL, which the 3D city needs.';

  let flag = null;
  try {
    flag = sessionStorage.getItem(BOOT_KEY);
    sessionStorage.removeItem(BOOT_KEY);
  } catch { /* storage unavailable */ }
  try {
    await refreshMenu();
  } catch (e) {
    console.error(e);
    $('save-warning').hidden = false;
    $('save-warning').textContent = `Saved games could not be read: ${e.message}`;
  }
  setMenuBusy(false);
  if (flag === 'new') startGame(null);
}

window.addEventListener('error', (e) => {
  if (String(e.message).includes('WebGL')) fatal('WebGL failed. Try the Low graphics setting or another browser.');
});
boot();
