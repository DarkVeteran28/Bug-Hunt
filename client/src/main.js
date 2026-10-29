// Entry point: lobby, connection, then the game.
import { Network } from './multiplayer.js';
import { Game } from './game.js';
import { tokenFor, storeToken, lastName } from './settings.js';
import { unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const NAME_RE = /^[A-Za-z0-9_ -]{3,16}$/;

function showError(msg) {
  $('lobby-error').textContent = msg;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function start(options) {
  const name = $('lobby-name').value.trim();
  if (!NAME_RE.test(name)) return showError('Names must be 3-16 letters, numbers, spaces, - or _.');
  if (!webglAvailable()) return showError('Your browser does not support WebGL, which the 3D city needs.');
  showError('');
  unlockAudio();
  for (const b of document.querySelectorAll('#lobby button')) b.disabled = true;
  const net = new Network();
  try {
    const welcome = await net.connect({ name, token: tokenFor(name) });
    storeToken(welcome.name, welcome.token);
    $('lobby').hidden = true;
    $('app').hidden = false;
    const game = new Game(net, welcome);
    window.__game = game; // handy for debugging in the console
    await game.init();
    await game.join(options);
    game.start();
  } catch (e) {
    console.error(e);
    net.leave();
    $('lobby').hidden = false;
    $('app').hidden = true;
    showError(e.message || 'Could not connect.');
    for (const b of document.querySelectorAll('#lobby button')) b.disabled = false;
  }
}

$('lobby-name').value = lastName();
$('btn-freeroam').addEventListener('click', () => start({ mode: 'freeroam' }));
$('btn-arena').addEventListener('click', () => start({ mode: 'arena' }));
$('btn-create').addEventListener('click', () => start({ create: { mode: $('create-mode').value, pvp: $('create-pvp').checked } }));
$('btn-join').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) return showError('Enter a room code.');
  start({ code });
});
$('lobby-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') start({ mode: 'freeroam' });
});
window.addEventListener('error', (e) => {
  if (String(e.message).includes('WebGL')) {
    $('fatal-text').textContent = 'WebGL failed. Try the Low graphics setting or another browser.';
    $('fatal').hidden = false;
  }
});
