// The save code dialog's markup (#18), pure kit helpers only: the home screen (your code,
// paste a code), the import preview and the done screen. Texts are escaped by the helpers.
// lib/save-dialog.mjs puts these into the hub's dialog and wires the buttons.
import { MAX_STARS } from './scoring.mjs';
import { actions, button, eyebrow, feedback, field, note, panel, stats } from './ui/index.mjs';

const stars = (n) => `${n} ${n === 1 ? 'star' : 'stars'}`;

// "1.1 Name" for a level, "Incident: Name" for a boss.
export function levelName(registry, id) {
  const l = registry.levels[id];
  return `${l.kind === 'boss' ? 'Incident' : l.no}: ${l.name}`;
}

const scored = (registry, id) => registry.levels[id].scored === true;

/** The home screen. `code` is '' when there is nothing to save yet; `pasted` refills the input. */
export function homeView({ code, pasted = '' }) {
  // Shown in short lines so a long code wraps inside the box; the decoder ignores the breaks.
  const shown = code.replace(/(.{36})(?=.)/g, '$1\n');
  const mine = code === ''
    ? note('Nothing to save yet. Finish a level first.')
    : field({ id: 'save-code-out', label: 'Your code', kind: 'code', rows: Math.min(8, shown.split('\n').length + 1), value: shown, readonly: true,
        noteHtml: 'Anyone with this code can import your progress. Paste it into the game on another browser.' }) +
      button({ id: 'save-copy', label: 'Copy code' });
  const load = field({ id: 'save-code-in', label: 'Paste a save code from another browser', kind: 'code', rows: 3, value: pasted }) +
    button({ id: 'save-check', label: 'Check code' });
  return panel({
    sections: [
      eyebrow('Save') + mine,
      eyebrow('Load') + load + feedback({ id: 'save-msg' }),
      actions({ buttonsHtml: button({ id: 'save-close', label: 'Close', variant: 'primary' }) }),
    ],
  });
}

/** What importing would change: the preview from previewImport. */
export function previewView(registry, preview) {
  // A label/value list, not a table: a two-column table cannot hold a level name and its change
  // at 320px without breaking words.
  const rows = [
    ...preview.added.map((a) => ({ label: levelName(registry, a.id), value: scored(registry, a.id) ? `New, ${stars(a.stars)}` : 'New' })),
    ...preview.improved.map((i) => ({ label: levelName(registry, i.id), value: `${stars(i.from)} to ${stars(i.to)}` })),
  ];
  const parts = [];
  if (rows.length > 0) parts.push(stats(rows));
  if (preview.newCards > 0) parts.push(note(`${preview.newCards} new ${preview.newCards === 1 ? 'card' : 'cards'}.`));
  if (preview.kept.length > 0) {
    parts.push(note(`Your better stars stay on ${preview.kept.length} ${preview.kept.length === 1 ? 'level' : 'levels'}.`));
  }
  if (!preview.changed) parts.unshift(note('Nothing new in this code. Your progress stays as it is.'));
  const buttons = (preview.changed ? button({ id: 'save-apply', label: 'Import', variant: 'primary' }) : '') +
    button({ id: 'save-back', label: 'Back' });
  return panel({
    sections: [eyebrow('Check before you import') + parts.join('') + feedback({ id: 'save-msg' }), actions({ buttonsHtml: buttons })],
  });
}

/** After an import: the message is set by the dialog; this is the one Close button. */
export function doneView() {
  return panel({
    sections: [feedback({ id: 'save-msg' }), actions({ buttonsHtml: button({ id: 'save-close', label: 'Close', variant: 'primary' }) })],
  });
}

/** The summary line after a merge went through. */
export function doneText(preview) {
  const bits = [];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (preview.added.length > 0) bits.push(`${n(preview.added.length, 'level', 'levels')} added`);
  if (preview.improved.length > 0) bits.push(`${n(preview.improved.length, 'level', 'levels')} improved`);
  if (preview.newCards > 0) bits.push(`${n(preview.newCards, 'new card', 'new cards')}`);
  return `Imported: ${bits.join(', ')}.`;
}
