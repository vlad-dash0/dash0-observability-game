// Kit side column (docs/DESIGN-SYSTEM.md "Components"), generalised from #146's help-ladder
// markup: the helps chips row, the stars, and the column beside a board with the success card
// (hidden until success), the score card and the hint tools. lib/widgets/help-ladder.mjs keeps
// the behaviour (validateHelps, hintCost, starsLabel, mountSide) and its DOM ids, which this
// markup keeps too. Pure string builders; DOM-free.

import { MAX_STARS } from '../scoring.mjs';
import { bool, fail, html, idAttr, int, opts, text, token } from './check.mjs';
import { button } from './button.mjs';

/** The chips row `#<id>-helps`: one chip per help, "<label> on" or "<label> off" in words. */
export function helpChips(id, rows) {
  idAttr('helpChips', id);
  if (!Array.isArray(rows)) fail('helpChips', 'rows must be an array');
  const chips = rows.map((r) => {
    const { key, label, on } = opts('helpChips', r, ['key', 'label', 'on']);
    token('helpChips', key, 'key');
    const l = text('helpChips', label, 'label');
    bool('helpChips', on, 'on');
    return `<span class="ui-chip" data-tone="${on ? 'success' : 'neutral'}" data-help="${key}" data-on="${on}">` +
      `<i class="ui-chip-dot" aria-hidden="true"></i>${l} ${on ? 'on' : 'off'}</span>`;
  });
  return `<p class="ui-help-chips" id="${id}-helps"><span class="ui-help-chips-title">Helps:</span> ${chips.join(' ')}</p>`;
}

const STAR =
  '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.2 10 5.6l4.8.5-3.6 3.2 1 4.7L8 11.6 3.8 14l1-4.7L1.2 6.1 6 5.6Z"></path></svg>';

/** Five stars: the first `n` "possible" (outlines) before success, "earned" (filled) after; the rest "lost". */
export function stars(n, done) {
  int('stars', n, 'n', 0, MAX_STARS);
  bool('stars', done, 'done');
  return Array.from({ length: MAX_STARS }, (_, i) =>
    `<span class="ui-star" data-star="${i >= n ? 'lost' : done ? 'earned' : 'possible'}">${STAR}</span>`).join('');
}

/**
 * The column for widget `id`: `#<id>-win` (hidden; `[data-swirl]`, `#<id>-win-title` with
 * `titleHtml`, `#<id>-win-stars`, `#<id>-win-closing`), the score card (per count `#<id>-<key>`
 * and `#<id>-<key>-label`, then `#<id>-hints`, `#<id>-stars` and `ruleHtml`) and, with
 * `hints`, `#<id>-hint`, `#<id>-hint-cost`, `#<id>-hint-tier`, `#<id>-hint-text`; without,
 * the tier line says there are none.
 */
export function sideColumn(args) {
  const { id, titleHtml, counts, hints = false, ruleHtml } = opts('sideColumn', args, ['id', 'titleHtml', 'counts', 'hints', 'ruleHtml']);
  idAttr('sideColumn', id);
  html('sideColumn', titleHtml, 'titleHtml');
  if (!Array.isArray(counts)) fail('sideColumn', 'counts must be an array');
  bool('sideColumn', hints, 'hints');
  html('sideColumn', ruleHtml, 'ruleHtml', { optional: true });
  const keys = new Set(['hints']);
  const countHtml = counts.map((c) => {
    const { key, label } = opts('sideColumn', c, ['key', 'label']);
    token('sideColumn', key, 'count key');
    if (keys.has(key)) fail('sideColumn', `count key "${key}" is taken`);
    keys.add(key);
    const l = label === '' ? '' : text('sideColumn', label, 'count label');
    return `<span class="ui-score-count"><b id="${id}-${key}">0</b> <span id="${id}-${key}-label">${l}</span></span>`;
  }).join('');
  const tools = hints
    ? `<div class="ui-hints-row">${button({ id: `${id}-hint`, label: 'Hint', variant: 'hint' })}` +
      `<span class="ui-hints-cost" id="${id}-hint-cost"></span></div>` +
      `<p class="ui-hints-tier" id="${id}-hint-tier"></p>` +
      `<div class="ui-hints-text" id="${id}-hint-text" tabindex="-1"></div>`
    : `<p class="ui-hints-tier" id="${id}-hint-tier">No hints on this level.</p>`;
  return (
    `<aside class="ui-side" aria-label="Result, score and hints">` +
    `<section class="ui-win" id="${id}-win" aria-labelledby="${id}-win-title" hidden>` +
    `<div class="ui-win-swirl" data-swirl aria-hidden="true"></div>` +
    `<div class="ui-win-text"><h3 class="ui-win-title" id="${id}-win-title" tabindex="-1">${titleHtml}</h3>` +
    `<p class="ui-win-stars" id="${id}-win-stars"></p><p class="ui-win-closing" id="${id}-win-closing"></p></div>` +
    `</section>` +
    `<div class="ui-score">` +
    `<p class="ui-score-counts">${countHtml}<span class="ui-score-count"><b id="${id}-hints">0</b> hints</span></p>` +
    `<p class="ui-score-stars" id="${id}-stars" role="img" aria-label=""></p>` +
    `${ruleHtml === undefined ? '' : `<p class="ui-score-rule">${ruleHtml}</p>`}` +
    `</div>` +
    `<div class="ui-hints"><h3 class="ui-hints-head">Hints</h3>${tools}</div>` +
    `</aside>`
  );
}
