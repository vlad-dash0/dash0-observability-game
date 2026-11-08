// The save code dialog's behaviour (#18). `host` is the dialog body in the hub; this renders
// the lib/save-view.mjs screens into it and wires the buttons with el.onclick (no Alpine,
// no inline handlers; the markup is kit helpers only). It never touches storage: an import
// hands the merged record to `commit`, which saves it. In debug mode nothing is exported or
// imported. deps: { registry, host, doc, debug, getProgress() → progress,
// commit(merged) → {saved, reason?}, copy(text) → Promise<boolean> | boolean, close() }.
import { REFUSALS, decodeProgress, encodeProgress, previewImport } from './save-code.mjs';
import { doneText, doneView, homeView, previewView } from './save-view.mjs';
import { setFeedback } from './ui/index.mjs';

const SAVE_FAILED = {
  future: 'Your progress was saved by a newer version of the game, so nothing was saved. Reload the page to get it.',
  unavailable: 'Imported for now, but this browser is not letting the game save.',
};

export function createSaveDialog({ registry, host, doc, debug = false, getProgress, commit, copy, close }) {
  let pending = null; // the preview waiting for Import
  const byId = (id) => doc.getElementById(id);
  const wire = (id, fn) => {
    const el = byId(id);
    if (el) el.onclick = fn;
  };
  // Shows `text` in the message region and moves focus to it, so it is read out.
  const say = (tone, text) => {
    const el = byId('save-msg');
    setFeedback(el, tone, text);
    el.focus?.();
  };

  function home(pasted = '') {
    pending = null;
    const progress = getProgress();
    const empty = Object.keys(progress.levels).length === 0 && progress.cards.length === 0;
    host.innerHTML = homeView({ code: empty ? '' : encodeProgress(progress, registry), pasted });
    wire('save-copy', onCopy);
    wire('save-check', onCheck);
    wire('save-close', () => close());
  }

  async function onCopy() {
    let ok = false;
    try {
      ok = (await copy(byId('save-code-out').value.replace(/\s+/g, ''))) === true;
    } catch {
      ok = false;
    }
    if (ok) say('success', 'Copied.');
    else {
      byId('save-code-out').select?.();
      say('neutral', 'Could not copy. The code is selected: press Ctrl+C or Cmd+C.');
    }
  }

  function onCheck() {
    const pasted = byId('save-code-in').value;
    const got = decodeProgress(pasted, registry);
    if (!got.ok) {
      home(pasted);
      say('error', REFUSALS[got.reason]);
      return;
    }
    const preview = previewImport(getProgress(), got.progress, registry);
    pending = preview;
    host.innerHTML = previewView(registry, preview);
    wire('save-apply', onApply);
    wire('save-back', () => home(pasted));
    if (got.dropped > 0) say('neutral', 'Some levels or cards in this code are not in this version of the game. They are skipped.');
    else byId(preview.changed ? 'save-apply' : 'save-back').focus?.();
  }

  function onApply() {
    if (pending === null) return;
    const preview = pending;
    pending = null;
    const res = commit(preview.merged);
    host.innerHTML = doneView();
    wire('save-close', () => close());
    if (res.saved) say('success', doneText(preview));
    else say('neutral', SAVE_FAILED[res.reason] ?? SAVE_FAILED.unavailable);
  }

  return {
    // Draws the home screen. False in debug mode, which never exports or imports.
    open() {
      if (debug) return false;
      home();
      return true;
    },
    // The dialog is closing: forget any preview.
    reset() {
      pending = null;
      host.innerHTML = '';
    },
  };
}
