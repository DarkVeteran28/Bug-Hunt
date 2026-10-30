// Keyboard and mouse state for gameplay. Keys are ignored whenever a text
// field or the code editor has focus, so typing W/A/S/D/R/Space edits code
// instead of moving or shooting.
const keys = new Set();
const pressed = new Set();
const listeners = new Map();
let mouseDX = 0;
let mouseDY = 0;
let fireDown = false;
let aimDown = false;
let firePressed = false;
let locked = false;
let lockTarget = null;
let intentionalUnlock = false;

export function typingTarget(el = document.activeElement) {
  if (!el) return false;
  if (el.closest && el.closest('.monaco-editor, #editor-host')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function emit(name, ...args) {
  for (const fn of listeners.get(name) || []) fn(...args);
}

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
}

export function initInput(canvasHost) {
  lockTarget = canvasHost;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      // Tab toggles the inventory and stats panel, but only outside text fields.
      if (!typingTarget(e.target)) {
        e.preventDefault();
        if (!e.repeat) emit('tab');
      }
      return;
    }
    if (e.code === 'Escape') {
      if (!typingTarget(e.target)) emit('escape');
      return;
    }
    if (typingTarget(e.target)) return;
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    emit('key', e.code, e);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    fireDown = false;
    aimDown = false;
  });
  // Moving focus into the editor releases movement keys immediately.
  document.addEventListener('focusin', (e) => {
    if (typingTarget(e.target)) {
      keys.clear();
      fireDown = false;
      aimDown = false;
      if (locked) releasePointer();
    }
  });

  canvasHost.addEventListener('mousedown', (e) => {
    if (document.activeElement && typingTarget(document.activeElement)) document.activeElement.blur();
    if (!locked) {
      requestPointer();
      return;
    }
    if (e.button === 0) {
      fireDown = true;
      firePressed = true;
    }
    if (e.button === 2) aimDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) fireDown = false;
    if (e.button === 2) aimDown = false;
  });
  canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    const now = document.pointerLockElement === lockTarget;
    if (locked && !now) {
      fireDown = false;
      aimDown = false;
      if (!intentionalUnlock) emit('lock-lost');
    }
    intentionalUnlock = false;
    locked = now;
    emit('lock', locked);
  });
}

export function requestPointer() {
  if (!lockTarget || !lockTarget.requestPointerLock) return;
  try {
    const r = lockTarget.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* not supported */ }
}

export function releasePointer() {
  if (document.pointerLockElement) {
    intentionalUnlock = true;
    document.exitPointerLock();
  }
}

export const input = {
  down: (code) => keys.has(code),
  /** True once per physical key press. */
  consume(code) {
    if (pressed.has(code)) {
      pressed.delete(code);
      return true;
    }
    return false;
  },
  endFrame() {
    pressed.clear();
    firePressed = false;
  },
  mouseDelta() {
    const d = [mouseDX, mouseDY];
    mouseDX = 0;
    mouseDY = 0;
    return d;
  },
  get fireDown() { return fireDown; },
  get firePressed() { return firePressed; },
  get aimDown() { return aimDown; },
  get locked() { return locked; },
  clear() {
    keys.clear();
    pressed.clear();
    fireDown = false;
    aimDown = false;
  },
};
