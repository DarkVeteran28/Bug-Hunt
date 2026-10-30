// A small in-page confirm box (used instead of window.confirm, which blocks
// the game loop and breaks pointer lock).
const $ = (id) => document.getElementById(id);

export function confirmDialog(text, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const box = $('confirm');
    $('confirm-text').textContent = text;
    const okBtn = $('confirm-ok');
    const cancelBtn = $('confirm-cancel');
    okBtn.textContent = ok;
    cancelBtn.textContent = cancel;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    box.hidden = false;
    okBtn.focus();
    const done = (v) => {
      box.hidden = true;
      okBtn.onclick = cancelBtn.onclick = null;
      window.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      }
    };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    window.addEventListener('keydown', onKey, true);
  });
}
