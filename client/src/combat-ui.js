// HUD: vitals, weapon/ammo, kill feed, toasts, score popups, hit markers,
// damage direction, death screen, prompts and the top/bottom status bars.
import { WEAPONS } from '../../shared/config.js';

const $ = (id) => document.getElementById(id);
const ORDER = Object.keys(WEAPONS);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Hud {
  constructor() {
    this.deathTimer = null;
    this.recentToasts = new Map();
    this.popupQueue = [];
    this.popupBusy = false;
  }

  setHealth(h) {
    $('health-fill').style.width = `${Math.max(0, h)}%`;
    $('health-text').textContent = Math.max(0, Math.round(h));
  }

  setWeapon(id, a, owned) {
    const w = WEAPONS[id];
    $('weapon-name').textContent = w.name.toUpperCase();
    const t = $('ammo-text');
    if (a.reloading) {
      t.textContent = 'RELOADING…';
      t.className = 'reloading';
    } else {
      t.textContent = `${a.ammo} / ${a.reserve}`;
      t.className = a.ammo <= Math.ceil(w.magSize / 4) ? 'low' : '';
    }
    $('weapon-slots').innerHTML = ORDER.map((k, i) => {
      const cls = ['slot', owned.includes(k) ? 'owned' : 'locked', k === id ? 'active' : ''].join(' ');
      return `<span class="${cls}">${i + 1} ${esc(WEAPONS[k].name)}</span>`;
    }).join('');
  }

  toast(text, kind = '', ms = 4200) {
    // The same message within 3 seconds is shown once.
    const now = performance.now();
    if (now - (this.recentToasts.get(text) || -1e9) < 3000) return;
    this.recentToasts.set(text, now);
    if (this.recentToasts.size > 50) this.recentToasts.clear();
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), ms);
  }

  /** Big centred score/unlock notices, shown one after another. */
  popup(title, sub, kind) {
    this.popupQueue.push([title, sub, kind]);
    if (!this.popupBusy) this.nextPopup();
  }

  nextPopup() {
    const item = this.popupQueue.shift();
    if (!item) {
      this.popupBusy = false;
      return;
    }
    this.popupBusy = true;
    const [title, sub, kind] = item;
    setTimeout(() => this.nextPopup(), 1500);
    const box = $('popups');
    const el = document.createElement('div');
    el.className = `popup ${kind}`;
    el.innerHTML = `${esc(title)}<span class="sub">${esc(sub)}</span>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  killFeed(k) {
    const box = $('killfeed');
    const el = document.createElement('div');
    el.className = `kf ${k.mine || k.victimIsMe ? 'me' : ''}`;
    el.innerHTML = `<b>${esc(k.killerName)}</b> <i>[${esc(WEAPONS[k.weapon] ? WEAPONS[k.weapon].name : k.weapon)}]</i> ${esc(k.victimName)}`;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.remove(), 9000);
  }

  hitMarker(kill) {
    const el = $('hitmarker');
    el.classList.toggle('kill', !!kill);
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 90);
  }

  damage(angle) {
    const v = $('damage-vignette');
    v.classList.add('show');
    setTimeout(() => v.classList.remove('show'), 60);
    const a = $('damage-arrow');
    a.style.transform = `rotate(${angle}rad)`;
    a.classList.add('show');
    setTimeout(() => a.classList.remove('show'), 60);
  }

  /** remainingMs(): time left before respawn, on the game clock (stops while paused). */
  showDeath(text, remainingMs) {
    $('death-overlay').hidden = false;
    const detail = $('death-detail');
    clearInterval(this.deathTimer);
    const tick = () => {
      const s = Math.max(0, Math.ceil(remainingMs() / 1000));
      detail.innerHTML = `${esc(text)}<br/>Respawning in ${s}s · your code and drafts are kept`;
    };
    tick();
    this.deathTimer = setInterval(tick, 250);
  }

  hideDeath() {
    clearInterval(this.deathTimer);
    $('death-overlay').hidden = true;
  }

  prompt(html) {
    const el = $('prompt');
    if (!html) {
      el.classList.remove('show');
      return;
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.add('show');
  }

  shield(on) {
    $('shield-badge').hidden = !on;
  }

  crosshair({ visible, aiming }) {
    const c = $('crosshair');
    c.classList.toggle('hidden', !visible);
    c.classList.toggle('aiming', !!aiming);
  }

  clickToPlay(show) {
    $('click-to-play').hidden = !show;
  }

  vehicle(info) {
    const el = $('vehicle-box');
    if (!info) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const kmh = Math.round(Math.abs(info.speed) * 3.6);
    el.innerHTML = `<div class="vb-name">${esc(info.name)}</div><div class="vb-speed"><b>${kmh}</b> km/h</div><div class="muted small">W/S drive · A/D steer · Space brake · E exit</div>`;
  }

  saveStatus(text) {
    $('save-status').textContent = text;
  }

  fps(text) {
    const el = $('fps');
    if (text === null) el.hidden = true;
    else {
      el.hidden = false;
      el.textContent = text;
    }
  }

  drill(html, progress = null) {
    const el = $('drill');
    if (!html) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `${html}${progress === null ? '' : `<div class="drill-bar"><div class="drill-fill" style="width:${Math.round(progress * 100)}%"></div></div>`}`;
  }

  missionTracker(m, distance) {
    const el = $('mission-tracker');
    if (!m) {
      el.innerHTML = '<div class="mt-title">FREE ROAM</div><div class="mt-step">All available missions done. Unlock new districts by fixing bugs.</div>';
      $('bottom-mission').textContent = 'MISSION: explore and fix bugs';
      return;
    }
    const step = m.steps[m.step] || '';
    el.innerHTML = `<div class="mt-title">${esc(m.title.toUpperCase())}</div><div class="mt-step">${esc(step)}</div>${distance !== null ? `<div class="mt-dist">${Math.round(distance)} m away · +${m.reward} on completion</div>` : ''}`;
    $('bottom-mission').textContent = `MISSION: ${m.title.toUpperCase()} - ${step}`;
  }

  topBar({ score, chips, playTime }) {
    if (score !== undefined) $('top-score').textContent = Number(score).toLocaleString();
    if (chips !== undefined) $('top-chips').textContent = chips;
    if (playTime !== undefined) $('top-time').textContent = formatTime(playTime);
  }

  bottomBar({ bugs, kills, deaths, district }) {
    if (bugs !== undefined) $('b-bugs').textContent = bugs;
    if (kills !== undefined) $('b-kills').textContent = kills;
    if (deaths !== undefined) $('b-deaths').textContent = deaths;
    if (district !== undefined) $('b-district').textContent = district;
  }
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

export { esc };
