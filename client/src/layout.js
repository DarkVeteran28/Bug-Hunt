// Split-screen layout: draggable divider (horizontal on wide screens,
// vertical when stacked on small screens) and a debugger toggle.
import { settings, saveSettings } from './settings.js';

export function initLayout(onResize) {
  const split = document.getElementById('split');
  const divider = document.getElementById('divider');
  const toggle = document.getElementById('btn-toggle-debug');
  const stacked = () => window.matchMedia('(max-width: 900px)').matches;

  const apply = () => {
    if (stacked()) {
      split.style.gridTemplateRows = `${settings.leftWidth}% 6px 1fr`;
      split.style.removeProperty('--left');
    } else {
      split.style.gridTemplateRows = '';
      split.style.setProperty('--left', `${settings.leftWidth}%`);
    }
    split.classList.toggle('debug-hidden', !settings.debugVisible);
    onResize();
  };

  let dragging = false;
  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    divider.classList.add('dragging');
    divider.setPointerCapture(e.pointerId);
  });
  divider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = split.getBoundingClientRect();
    const pct = stacked() ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100;
    settings.leftWidth = Math.max(25, Math.min(80, pct));
    apply();
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    saveSettings({ leftWidth: settings.leftWidth });
  };
  divider.addEventListener('pointerup', stop);
  divider.addEventListener('pointercancel', stop);
  divider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') saveSettings({ leftWidth: Math.max(25, settings.leftWidth - 2) });
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') saveSettings({ leftWidth: Math.min(80, settings.leftWidth + 2) });
    else return;
    apply();
  });
  toggle.addEventListener('click', () => {
    saveSettings({ debugVisible: !settings.debugVisible });
    apply();
  });
  window.addEventListener('resize', apply);
  apply();
  return {
    showDebugger() {
      if (!settings.debugVisible) {
        saveSettings({ debugVisible: true });
        apply();
      }
    },
  };
}
