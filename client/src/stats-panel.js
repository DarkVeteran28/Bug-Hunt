// Tab panel: inventory (weapons, ammo, data chips) and this game's records.
import { WEAPONS } from '../../shared/config.js';
import { DISTRICTS } from '../../shared/world-data.js';
import { esc, formatTime } from './combat-ui.js';

import { CHALLENGES } from '../../challenges/index.js';
import { MISSIONS } from '../../shared/world-data.js';

const $ = (id) => document.getElementById(id);

function rewardLabel(h) {
  const [what, id] = h.ref.split(':');
  if (what === 'challenge' && CHALLENGES[id]) return `Fixed ${CHALLENGES[id].title}`;
  if (what === 'mission') return `Mission: ${(MISSIONS.find((m) => m.id === id) || {}).title || id}`;
  if (what === 'kill') return 'Stopped a glitch bot';
  if (what === 'collect') return 'Data chip';
  if (h.ref === 'city-cleared') return 'City cleared bonus';
  return h.ref;
}

export class StatsPanel {
  constructor({ session, playTime }) {
    this.session = session;
    this.playTime = playTime;
    this.el = $('stats');
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(force) {
    this.el.hidden = force === undefined ? !this.el.hidden : !force;
    if (!this.el.hidden) this.render();
  }

  render() {
    const s = this.session;
    const st = s.statsView();
    const p = s.player;
    const owned = p.progress.weapons;
    const weapons = Object.values(WEAPONS).map((w) => {
      const a = s.weapons.view(p, w.id);
      const have = owned.includes(w.id);
      return `<tr class="${have ? '' : 'locked'}"><td>${w.slot}</td><td><b>${esc(w.name)}</b>${p.equipped === w.id ? ' <span class="tag">equipped</span>' : ''}</td><td>${have ? `${a.ammo} / ${a.reserve}` : 'locked'}</td><td>${w.damage}${w.pellets > 1 ? ` × ${w.pellets}` : ''}</td></tr>`;
    }).join('');
    const prog = p.progress.toJSON();
    const missions = s.missionsView().map((m) => `<li class="${m.done ? 'done' : prog.districts.includes(m.district) ? '' : 'locked'}">${m.done ? '✅' : prog.districts.includes(m.district) ? '▶' : '🔒'} ${esc(m.title)}</li>`).join('');
    const districts = DISTRICTS.map((d) => `<span class="chip ${prog.districts.includes(d.id) ? 'on' : ''}">${esc(d.name)}</span>`).join('');
    const history = st.history.map((h) => `<li><b>+${h.amount}</b> ${esc(rewardLabel(h))}</li>`).join('') || '<li class="muted">Nothing yet.</li>';
    this.el.querySelector('.stats-body').innerHTML = `
      <div class="stats-grid">
        <section>
          <h3>Inventory</h3>
          <table class="inv"><thead><tr><th>#</th><th>Weapon</th><th>Ammo</th><th>Damage</th></tr></thead><tbody>${weapons}</tbody></table>
          <p>Data chips: <b>${st.chips} / ${st.chipsTotal}</b> <span class="muted">(blue diamonds on the streets, +25 each)</span></p>
          <p>Health: <b>${Math.round(p.health)}</b> / 100</p>
        </section>
        <section>
          <h3>Progress</h3>
          <p>Score: <b>${st.totals.total.toLocaleString()}</b> <span class="muted">(bugs ${st.totals.bug} · combat ${st.totals.combat} · other ${st.totals.other})</span></p>
          <p>Bugs fixed: <b>${st.bugsFixed} / ${st.bugsTotal}</b>${st.assistedFixes ? ` <span class="muted">(${st.assistedFixes} with Show Fix)</span>` : ''}</p>
          <p>Missions: <b>${st.missionsCompleted} / ${st.missionsTotal}</b></p>
          <ul class="mlist">${missions}</ul>
          <div class="chips">${districts}</div>
        </section>
        <section>
          <h3>Records</h3>
          <p>Glitch bots stopped: <b>${st.kills}</b> · Times down: <b>${st.deaths}</b></p>
          <p>Test runs: <b>${st.testRuns}</b>${st.accuracy === null ? '' : ` (${st.accuracy}% passed)`} · Hints: <b>${st.hintsUsed}</b></p>
          <p>Play time: <b>${formatTime(this.playTime())}</b></p>
          <h3>Recent rewards</h3>
          <ul class="hist">${history}</ul>
        </section>
      </div>`;
  }
}
