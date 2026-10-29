// Player settings persisted per browser (conveniences only).
const KEY = 'vcbh-settings';
const DEFAULTS = { sensitivity: 1, invertY: false, volume: 0.6, muted: false, graphics: 'high', lighting: 'sunset', showFps: false, leftWidth: 60, debugVisible: true };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();
const listeners = new Set();

export function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch { /* storage may be unavailable */ }
  for (const l of listeners) l(settings, patch);
}

export function onSettings(fn) {
  listeners.add(fn);
}

/** Per-name identity tokens, so two tabs with different names are two players. */
export function tokenFor(name) {
  try {
    const all = JSON.parse(localStorage.getItem('vcbh-tokens') || '{}');
    return all[name.toLowerCase()] || null;
  } catch {
    return null;
  }
}

export function storeToken(name, token) {
  try {
    const all = JSON.parse(localStorage.getItem('vcbh-tokens') || '{}');
    all[name.toLowerCase()] = token;
    localStorage.setItem('vcbh-tokens', JSON.stringify(all));
    localStorage.setItem('vcbh-last-name', name);
  } catch { /* ignore */ }
}

export function lastName() {
  try {
    return localStorage.getItem('vcbh-last-name') || '';
  } catch {
    return '';
  }
}
