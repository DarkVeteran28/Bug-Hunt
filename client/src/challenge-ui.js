// The debugging workspace in the right-hand panel: bug board, challenge
// brief, Monaco editor, Run Tests / Apply Fix / Reset / Hint, and test output.
import { CodeEditor } from './code-editor.js';
import { esc } from './combat-ui.js';
import { sfx } from './audio.js';
import { DISTRICTS } from '/shared/world-data.js';

const $ = (id) => document.getElementById(id);
const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

export class ChallengeUI {
  constructor({ net, hud, onApplied, onOpenChanged }) {
    this.net = net;
    this.hud = hud;
    this.onApplied = onApplied;
    this.onOpenChanged = onOpenChanged;
    this.challenges = [];
    this.progress = { solved: [], districts: ['ocean'] };
    this.current = null;
    this.verifiedCode = null;
    this.drafts = new Map();
    this.draftTimer = null;
    this.busy = false;
    this.editor = new CodeEditor($('editor-host'));
    this.editor.onChange((code) => this.onEdit(code));

    $('btn-run').addEventListener('click', () => this.runTests());
    $('btn-apply').addEventListener('click', () => this.applyFix());
    $('btn-reset').addEventListener('click', () => this.resetCode());
    $('btn-hint').addEventListener('click', () => this.hint());
    $('btn-close-challenge').addEventListener('click', () => this.close());
  }

  setChallenges(list) {
    this.challenges = list;
    this.renderBoard();
  }

  setProgress(progress) {
    this.progress = progress;
    this.renderBoard();
    if (this.current) this.renderStatus();
  }

  stateOf(c) {
    if (this.progress.solved.includes(c.id)) return 'solved';
    if (!this.progress.districts.includes(c.district)) return 'locked';
    return 'open';
  }

  renderBoard() {
    const solved = this.challenges.filter((c) => this.progress.solved.includes(c.id)).length;
    $('bug-list').innerHTML = this.challenges.map((c) => {
      const st = this.stateOf(c);
      const icon = st === 'solved' ? '✅' : st === 'locked' ? '🔒' : '🐞';
      return `<li class="${st}"><span>${icon}</span><span><b>${esc(c.title)}</b>${c.mandatory ? ' <span class="diff expert" title="Required to unlock the next district">gate</span>' : ''}<br/><span class="where">${esc(districtName(c.district))} · ${esc(c.summary)}</span></span><span><span class="diff ${c.difficulty}">${c.difficulty}</span><br/><span class="where">${c.reward} pts</span></span></li>`;
    }).join('') + `<li style="grid-template-columns:1fr"><span class="where">${solved} of ${this.challenges.length} bugs fixed</span></li>`;
  }

  async open(id) {
    const r = await this.net.request('challenge:open', { id });
    if (!r || !r.ok) {
      this.hud.toast(r && r.error ? r.error : 'Could not open that challenge.', 'warn');
      return false;
    }
    await this.editor.ready;
    if (this.current && this.current.id !== id) this.saveDraftNow();
    this.current = r.challenge;
    this.verifiedCode = r.verifiedCode || null;
    $('bug-board').hidden = true;
    $('challenge').hidden = false;
    $('ch-title').textContent = r.challenge.title;
    $('ch-meta').innerHTML = `<span class="diff ${r.challenge.difficulty}">${r.challenge.difficulty}</span> <span>Reward: <b>${r.challenge.reward}</b> points</span> <span>${esc(districtName(r.challenge.district))}</span>${r.challenge.mandatory ? ' <span class="diff expert">mandatory gate</span>' : ''}${r.challenge.unlocksWeapon ? ` <span>Unlocks: ${esc(r.challenge.unlocksWeapon.toUpperCase())}</span>` : ''}`;
    $('ch-desc').textContent = r.challenge.description;
    $('ch-repro').innerHTML = r.challenge.reproduce.map((s) => `<li>${esc(s)}</li>`).join('');
    $('ch-consequence').textContent = `When fixed: ${r.challenge.consequence}`;
    const code = this.drafts.get(id) ?? r.solvedCode ?? r.draft ?? r.challenge.starterCode;
    this.editor.setValue(code);
    this.renderHints(r.hints, r.challenge.hintCount);
    $('ch-output').innerHTML = `<div class="muted">Tests: ${r.challenge.testNames.length}. Edit the function, then press Run Tests. Your draft is saved as you type.</div>`;
    this.renderStatus();
    this.onOpenChanged(true, id);
    sfx.click();
    return true;
  }

  renderStatus() {
    if (!this.current) return;
    const solved = this.progress.solved.includes(this.current.id);
    const verified = !solved && this.verifiedCode !== null && this.verifiedCode === this.editor.getValue();
    $('btn-apply').disabled = !verified || this.busy;
    $('btn-run').disabled = this.busy;
    const s = $('ch-status');
    if (solved) s.innerHTML = '<span style="color:var(--green)">✔ Fixed. You can keep experimenting; rewards are paid once.</span>';
    else if (verified) s.innerHTML = '<span style="color:var(--green)">All tests pass. Apply the fix!</span>';
    else if (this.verifiedCode !== null) s.innerHTML = '<span class="muted">Code changed since the last passing run. Run the tests again.</span>';
    else s.innerHTML = '<span class="muted">Not fixed yet</span>';
  }

  renderHints(hints, total) {
    $('ch-hints').innerHTML = hints.map((h, i) => `<p>💡 Hint ${i + 1}: ${esc(h)}</p>`).join('');
    $('btn-hint').disabled = hints.length >= total;
  }

  onEdit(code) {
    if (!this.current) return;
    this.drafts.set(this.current.id, code);
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.saveDraftNow(), 1200);
    this.renderStatus();
  }

  saveDraftNow() {
    clearTimeout(this.draftTimer);
    if (!this.current) return;
    this.net.emit('challenge:draft', { id: this.current.id, code: this.editor.getValue() });
  }

  async runTests() {
    if (!this.current || this.busy) return;
    const id = this.current.id;
    const code = this.editor.getValue();
    this.busy = true;
    this.renderStatus();
    $('ch-output').innerHTML = '<div class="muted">Running your code in the isolated sandbox…</div>';
    const r = await this.net.request('challenge:run', { id, code }, 15000);
    this.busy = false;
    if (!this.current || this.current.id !== id) return;
    if (!r || !r.ok) {
      $('ch-output').innerHTML = `<div class="summary-line fail">${esc(r && r.error ? r.error : 'Test run failed.')}</div>`;
      sfx.fail();
      this.renderStatus();
      return;
    }
    const rep = r.report;
    this.verifiedCode = rep.passed ? code : null;
    let html = '';
    if (rep.fatal || rep.compileError) {
      html += `<div class="summary-line fail">${esc(rep.fatal || rep.compileError)}</div>`;
    } else {
      html += `<div class="summary-line ${rep.passed ? 'pass' : 'fail'}">Tests: ${rep.passedCount} passed, ${rep.total - rep.passedCount} failed${rep.ms ? ` · ${rep.ms} ms` : ''}</div>`;
      for (const t of rep.results) {
        html += `<div class="test ${t.passed ? 'pass' : 'fail'}">${t.passed ? '✔' : '✘'} ${esc(t.name)}`;
        if (!t.passed) {
          const lines = [];
          if (t.error) lines.push(t.error);
          if (t.expected !== undefined) lines.push(`expected: ${t.expected}`);
          if (t.actual !== undefined) lines.push(`received: ${t.actual}`);
          html += `<div class="detail">${esc(lines.join('\n'))}</div>`;
        }
        html += '</div>';
      }
    }
    if (rep.logs && rep.logs.length) html += `<div class="logs">console:\n${esc(rep.logs.join('\n'))}</div>`;
    $('ch-output').innerHTML = html;
    if (rep.passed) {
      sfx.success();
      this.hud.toast('All tests passed. Press Apply Fix to patch the city.', 'good');
    } else sfx.fail();
    this.renderStatus();
  }

  async applyFix() {
    if (!this.current || this.busy) return;
    const id = this.current.id;
    this.busy = true;
    this.renderStatus();
    const r = await this.net.request('challenge:apply', { id });
    this.busy = false;
    if (!r || !r.ok) {
      this.hud.toast(r && r.error ? r.error : 'Could not apply the fix.', 'bad');
      this.renderStatus();
      return;
    }
    this.verifiedCode = null;
    if (r.awarded) {
      this.hud.popup(`BUG FIXED: ${r.title.toUpperCase()}`, `+${r.awarded} BUG POINTS`, 'bug');
      sfx.success();
      this.hud.toast(r.consequence, 'good', 7000);
    }
    this.onApplied(id, r);
    this.renderStatus();
  }

  resetCode() {
    if (!this.current) return;
    if (!window.confirm('Reset the editor to the original buggy code? Your current draft will be replaced.')) return;
    this.editor.setValue(this.current.starterCode);
    this.saveDraftNow();
  }

  async hint() {
    if (!this.current) return;
    const r = await this.net.request('challenge:hint', { id: this.current.id });
    if (r && r.ok) this.renderHints(r.hints, this.current.hintCount);
  }

  close() {
    if (!this.current) return;
    this.saveDraftNow();
    if (document.activeElement && document.getElementById('editor-host').contains(document.activeElement)) document.activeElement.blur();
    this.net.emit('challenge:close', {});
    this.current = null;
    this.verifiedCode = null;
    $('challenge').hidden = true;
    $('bug-board').hidden = false;
    this.onOpenChanged(false, null);
  }
}
