// HUD: vitals, weapon/ammo, kill feed, toasts, score popups, hit markers,
// damage direction, death screen, prompts and the top/bottom status bars.
import { WEAPONS } from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const ORDER = Object.keys(WEAPONS);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Hud {
  constructor() {
    this.myId = null;
    this.deathTimer = null;
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
    el.className = `kf ${k.killer === this.myId || k.victim === this.myId ? 'me' : ''}`;
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

  showDeath(text, respawnAt) {
    $('death-overlay').hidden = false;
    const detail = $('death-detail');
    clearInterval(this.deathTimer);
    const tick = () => {
      const s = Math.max(0, Math.ceil((respawnAt - performance.now()) / 1000));
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

  netStatus(connected) {
    $('net-status').hidden = connected;
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

  topBar({ name, room, score, rank }) {
    if (name !== undefined) $('top-name').textContent = name;
    if (room !== undefined) $('top-room').textContent = room;
    if (score !== undefined) $('top-score').textContent = Number(score).toLocaleString();
    if (rank !== undefined) $('top-rank').textContent = rank ? `#${rank}` : '-';
  }

  bottomBar({ bugs, kills, deaths, district, roundLeft }) {
    if (bugs !== undefined) $('b-bugs').textContent = bugs;
    if (kills !== undefined) $('b-kills').textContent = kills;
    if (deaths !== undefined) $('b-deaths').textContent = deaths;
    if (district !== undefined) $('b-district').textContent = district;
    if (roundLeft !== undefined) {
      $('b-round').hidden = roundLeft === null;
      if (roundLeft !== null) {
        const s = Math.max(0, Math.floor(roundLeft / 1000));
        $('b-round-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
    }
  }
}

export { esc };
