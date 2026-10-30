// Player settings, kept in this browser and also written into each save.
const KEY = 'vcbh-settings';
const DEFAULTS = { sensitivity: 1, invertY: false, volume: 0.6, muted: false, graphics: 'medium', lighting: 'sunset', showFps: false, leftWidth: 60, debugVisible: true };
// Settings a save file may carry (layout stays per-browser).
export const SAVED_KEYS = ['sensitivity', 'invertY', 'volume', 'muted', 'graphics', 'lighting', 'showFps'];

// What each graphics level turns on. Changes apply the next time the city loads.
export const GRAPHICS = Object.freeze({
  high: { label: 'High', shadows: true, antialias: true, maxPixelRatio: 1.75, viewDistance: 520, enemyDetailRange: 160 },
  medium: { label: 'Medium', shadows: false, antialias: true, maxPixelRatio: 1.25, viewDistance: 420, enemyDetailRange: 130 },
  low: { label: 'Low', shadows: false, antialias: false, maxPixelRatio: 1, viewDistance: 300, enemyDetailRange: 100 },
});

function load() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (!GRAPHICS[s.graphics]) s.graphics = DEFAULTS.graphics;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();
const listeners = new Set();

export function graphicsProfile() {
  return GRAPHICS[settings.graphics] || GRAPHICS.medium;
}

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

export function savedSettings() {
  return Object.fromEntries(SAVED_KEYS.map((k) => [k, settings[k]]));
}

/** Apply settings that came from a save file, ignoring anything unexpected. */
export function applySavedSettings(s) {
  if (!s || typeof s !== 'object') return;
  const patch = {};
  if (Number.isFinite(s.sensitivity) && s.sensitivity >= 0.2 && s.sensitivity <= 3) patch.sensitivity = s.sensitivity;
  if (typeof s.invertY === 'boolean') patch.invertY = s.invertY;
  if (Number.isFinite(s.volume) && s.volume >= 0 && s.volume <= 1) patch.volume = s.volume;
  if (typeof s.muted === 'boolean') patch.muted = s.muted;
  if (s.lighting === 'sunset' || s.lighting === 'night') patch.lighting = s.lighting;
  if (typeof s.showFps === 'boolean') patch.showFps = s.showFps;
  // Graphics is left alone: it depends on this computer, not on the save.
  saveSettings(patch);
}
