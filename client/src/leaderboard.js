// Tab overlay: this room's session standings plus persistent leaderboards
// (overall, bugs fixed, combat, K/D, fastest fix) and the player's profile.
import { esc } from './combat-ui.js';

const $ = (id) => document.getElementById(id);

export class Leaderboard {
  constructor({ net }) {
    this.net = net;
    this.board = 'session';
    this.roster = [];
    this.myId = null;
    this.visible = false;
    for (const b of document.querySelectorAll('#lb-tabs button')) {
      b.addEventListener('click', () => {
        this.board = b.dataset.board;
        for (const x of document.querySelectorAll('#lb-tabs button')) x.classList.toggle('active', x === b);
        this.render();
      });
    }
    $('leaderboard').addEventListener('click', (e) => {
      if (e.target.id === 'leaderboard') this.toggle(false);
    });
  }

  setRoster(r) {
    this.roster = r;
    if (this.visible && this.board === 'session') this.render();
  }

  toggle(force) {
    this.visible = force === undefined ? !this.visible : force;
    $('leaderboard').hidden = !this.visible;
    if (this.visible) this.render();
  }

  sessionRank() {
    const sorted = [...this.roster].sort((a, b) => (b.bugPoints + b.combatPoints + b.otherPoints) - (a.bugPoints + a.combatPoints + a.otherPoints));
    return sorted.findIndex((r) => r.id === this.myId) + 1;
  }

  async render() {
    const body = $('lb-body');
    if (this.board === 'session') {
      const rows = [...this.roster].sort((a, b) => (b.bugPoints + b.combatPoints + b.otherPoints) - (a.bugPoints + a.combatPoints + a.otherPoints));
      body.innerHTML = `<table class="lb"><tr><th>#</th><th>PLAYER</th><th>BUG PTS</th><th>COMBAT PTS</th><th>MISSION PTS</th><th>BUGS FIXED</th><th>K</th><th>D</th></tr>${rows.map((r, i) => `<tr class="${r.id === this.myId ? 'me' : ''}"><td>${i + 1}</td><td><span style="color:${esc(r.color)}">●</span> ${esc(r.name)}${r.connected ? '' : ' <span class="muted">(reconnecting)</span>'}</td><td>${r.bugPoints}</td><td>${r.combatPoints}</td><td>${r.otherPoints}</td><td>${r.bugsFixed}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('')}</table><p class="muted small">Session points reset each arena round. Bug-fixing and combat are scored separately.</p>`;
    } else {
      body.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const res = await fetch(`/api/leaderboard?board=${encodeURIComponent(this.board)}`);
        const data = await res.json();
        const cols = {
          overall: ['TOTAL POINTS', (r) => r.value.toLocaleString()],
          bugs: ['BUGS FIXED', (r) => `${r.value} (${r.points} pts)`],
          combat: ['COMBAT POINTS', (r) => r.value.toLocaleString()],
          kd: ['K/D', (r) => `${r.value} (${r.kills}/${r.deaths})`],
          fastest: ['FASTEST FIX', (r) => `${(r.value / 1000).toFixed(1)}s · ${esc(r.challenge_id)}`],
        }[this.board];
        body.innerHTML = data.rows.length
          ? `<table class="lb"><tr><th>#</th><th>PLAYER</th><th>${cols[0]}</th></tr>${data.rows.map((r, i) => `<tr class="${r.id === this.myId ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${cols[1](r)}</td></tr>`).join('')}</table>`
          : '<p class="muted">No entries yet.</p>';
      } catch {
        body.innerHTML = '<p class="error">Could not load the leaderboard.</p>';
      }
    }
    const p = await this.net.request('profile', {});
    if (p && p.totals) {
      $('lb-profile').innerHTML = `<b>Your profile</b> · Total ${p.totals.total.toLocaleString()} (bugs ${p.totals.bug}, combat ${p.totals.combat}, missions ${p.totals.other}) · Rank #${p.rank} · Bugs fixed ${p.bugsFixed}/${p.bugsTotal} · Accuracy ${p.accuracy === null ? '-' : `${p.accuracy}%`} (${p.attempts} runs) · K/D ${p.kd} (${p.kills}/${p.deaths}) · Missions ${p.missionsCompleted}${p.fastestMs !== null ? ` · Fastest fix ${(p.fastestMs / 1000).toFixed(1)}s` : ''}`;
    }
  }
}
