// The UI kit helpers, lib/ui/*.mjs (#158, docs/DESIGN-SYSTEM.md): T10 the helper contract
// (exact markup, escaping, trusted *Html, TypeError on bad input, CSP-safe attributes, every
// emitted class defined in kit.css) and T11 setFeedback / clearFeedback. Outputs are
// compared as strings; the DOM checks compare strings and booleans, never nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { decls, definedClasses, read, ROOT, rules, splitTop } from './helpers/css.mjs';
import * as ui from '../lib/ui/index.mjs';

const {
  actions, button, buttonRow, checkbox, chip, clearFeedback, codeBlock, dots, eyebrow, feedback, field, finishButton, fold, hintHead,
  helpChips, lesson, linkButton, meter, nextButton, note, option, options, panel, prose, question, radio, radioGroup, reason, setFeedback,
  sideColumn, split, stars, stats, step, stepHead, table,
  BUTTON_VARIANTS, DOTS_TONES, FEEDBACK_TONES, LINK_VARIANTS, OPTION_KINDS, OPTION_STATES, OPTIONS_LAYOUTS, PANEL_VARIANTS, TONES,
} = ui;

const BAD = '<b>"&';
const ESCAPED = '&lt;b&gt;&quot;&amp;';

// ---- T10 exact markup, one helper family at a time ------------------------------------

test('layout: step, split, actions', () => {
  assert.equal(step({ bodyHtml: '<p>x</p>' }), '<div class="ui-step"><p>x</p></div>');
  assert.equal(step({ wide: true, bodyHtml: 'b' }), '<div class="ui-step ui-step--wide">b</div>');
  assert.equal(split({ mainHtml: 'm', sideHtml: 's' }),
    '<div class="ui-split"><div class="ui-split-main">m</div><div class="ui-split-side">s</div></div>');
  assert.equal(actions({ buttonsHtml: 'b' }), '<div class="ui-actions">b</div>');
  // The footer is one width on every step (#331): wide is accepted, and the markup is the same.
  assert.equal(actions({ wide: true, buttonsHtml: 'b' }), '<div class="ui-actions">b</div>');
});

test('reason, buttonRow: a muted line before a disabled button, and a row that keeps buttons pills (#321)', () => {
  assert.equal(reason({ id: 'x-why', text: 'Pick <one>.' }), '<p class="ui-reason" id="x-why">Pick &lt;one&gt;.</p>');
  assert.equal(buttonRow('b'), '<div class="ui-btn-row">b</div>');
  const next = nextButton('lv-next', 'Pick an answer to continue.');
  assert.equal(next, '<button type="button" class="ui-btn ui-btn--primary" id="lv-next" disabled>Next</button>' +
    '<p class="ui-reason" id="lv-next-why">Pick an answer to continue.</p>');
  assert.match(finishButton('lv-finish', 'Why.'), /<\/button><p class="ui-reason" id="lv-finish-why">Why\.<\/p>$/);
  assert.throws(() => reason({ id: 'x', text: '' }), /reason/);
});

test('text: lesson, question, eyebrow, stepHead, note, prose, codeBlock', () => {
  assert.equal(lesson('Spans <code>nest</code>.'), '<section class="ui-lesson"><div class="ui-lesson-body">Spans <code>nest</code>.</div></section>');
  assert.equal(question({ id: 'q1', html: 'Which <b>one</b>?' }), '<h3 class="ui-question" id="q1">Which <b>one</b>?</h3>');
  assert.equal(question({ html: 'Why?' }), '<h3 class="ui-question">Why?</h3>');
  assert.equal(eyebrow('Error budget'), '<p class="ui-eyebrow">Error budget</p>');
  assert.equal(stepHead({ step: 2, titleHtml: 'Pick a <b>cause</b>' }),
    '<div class="ui-step-head"><p class="ui-eyebrow">Step 2</p><h3 class="ui-step-title">Pick a <b>cause</b></h3></div>');
  assert.equal(stepHead({ step: 1, titleHtml: 'T', noteHtml: 'n' }),
    '<div class="ui-step-head"><p class="ui-eyebrow">Step 1</p><h3 class="ui-step-title">T</h3><p class="ui-step-note">n</p></div>');
  assert.equal(note('Costs <b>2</b> min'), '<p class="ui-note">Costs <b>2</b> min</p>');
  assert.equal(prose('<ul><li>a</li></ul>'), '<div class="ui-prose"><ul><li>a</li></ul></div>');
  assert.equal(prose('<p>x</p><table><tr><td>1</td></tr></table><pre>t</pre><table class="k"><tr><td>2</td></tr></table>'),
    '<div class="ui-prose"><p>x</p><div class="ui-table-wrap"><table><tr><td>1</td></tr></table></div><pre>t</pre>' +
    '<div class="ui-table-wrap"><table class="k"><tr><td>2</td></tr></table></div></div>', 'each table sits in the kit scroller; nothing else is wrapped');
  assert.equal(hintHead('Hint 1 of 3'), '<p class="ui-eyebrow">Hint 1 of 3</p>');
  assert.equal(hintHead('Hint 2 of 3', '"Cart" <x>'), '<p class="ui-eyebrow">Hint 2 of 3</p><p><b>&quot;Cart&quot; &lt;x&gt;</b></p>', '#332 the subject is escaped and outside the upper-cased eyebrow');
  assert.equal(codeBlock('a', { wrap: true }), '<pre class="ui-code" data-wrap><code>a</code></pre>', '#332 wrap soft-wraps an env block');
  assert.equal(codeBlock('a < b && "c"'), '<pre class="ui-code"><code>a &lt; b &amp;&amp; &quot;c&quot;</code></pre>');
});

test('panel: plain, variants, head and sections', () => {
  assert.equal(panel({ sections: ['a'] }), '<section class="ui-panel"><div class="ui-panel-sec">a</div></section>');
  assert.equal(panel({ id: 'page', variant: 'alert', headHtml: 'H', sections: ['a', 'b'] }),
    '<section class="ui-panel ui-panel--alert" id="page"><div class="ui-panel-head">H</div>' +
    '<div class="ui-panel-sec">a</div><div class="ui-panel-sec">b</div></section>');
  for (const variant of ['inset', 'drop']) assert.match(panel({ variant, sections: ['x'] }), new RegExp(`class="ui-panel ui-panel--${variant}"`));
});

test('chip: tone as data-tone, dot, swatch, dashed', () => {
  assert.equal(chip({ text: 'Firing' }), '<span class="ui-chip" data-tone="neutral">Firing</span>');
  assert.equal(chip({ text: 'Firing', tone: 'error', dot: true, dashed: true }),
    '<span class="ui-chip ui-chip--dashed" data-tone="error"><i class="ui-chip-dot" aria-hidden="true"></i>Firing</span>');
  assert.equal(chip({ text: 'checkout', swatch: 3 }),
    '<span class="ui-chip" data-tone="neutral"><i class="ui-chip-swatch" data-svc="3" aria-hidden="true"></i>checkout</span>');
  for (const tone of ['success', 'hint', 'attention']) assert.match(chip({ text: 't', tone }), new RegExp(`data-tone="${tone}"`));
});

test('button: variants are exclusive modifiers; next and finish start disabled; finish carries data-finish', () => {
  assert.equal(button({ label: 'Check' }), '<button type="button" class="ui-btn ui-btn--ghost">Check</button>');
  assert.equal(button({ id: 'go', label: 'Go', variant: 'primary', disabled: true, type: 'submit' }),
    '<button type="submit" class="ui-btn ui-btn--primary" id="go" disabled>Go</button>');
  assert.equal(button({ id: 'h', label: 'Hint', variant: 'hint' }), '<button type="button" class="ui-btn ui-btn--hint" id="h">Hint</button>');
  assert.equal(button({ id: 'back', label: 'Back to the map', variant: 'icon', icon: '←' }),
    '<button type="button" class="ui-btn ui-btn--icon" id="back" aria-label="Back to the map"><span aria-hidden="true">←</span></button>');
  assert.equal(nextButton('lv-next'), '<button type="button" class="ui-btn ui-btn--primary" id="lv-next" disabled>Next</button>' +
    '<p class="ui-reason" id="lv-next-why">Finish this step to continue.</p>');
  assert.equal(finishButton('lv-finish'), '<button type="button" class="ui-btn ui-btn--primary" id="lv-finish" disabled data-finish>Finish</button>' +
    '<p class="ui-reason" id="lv-finish-why">Finish this step to complete the level.</p>');
  for (const variant of ['primary', 'ghost', 'hint']) {
    const mods = button({ label: 'x', variant }).match(/ui-btn--[a-z]+/g);
    assert.deepEqual(mods, [`ui-btn--${variant}`], 'one variant modifier, never two');
  }
});

test('option and options: kinds as modifiers, states as attributes, radio as a labelled input', () => {
  assert.equal(option({ attr: 'pick', value: 'a', labelHtml: 'A <code>x</code>' }),
    '<button type="button" class="ui-option ui-option--choice" data-pick="a"><span class="ui-option-label">A <code>x</code></span></button>');
  assert.equal(option({ attr: 'view', value: 'logs', labelHtml: 'Logs', metaHtml: 'm', kind: 'tile', pressed: true, hinted: true }),
    '<button type="button" class="ui-option ui-option--tile" data-view="logs" aria-pressed="true" data-hinted>' +
    '<span class="ui-option-label">Logs</span><span class="ui-option-meta">m</span></button>');
  assert.equal(option({ attr: 'pick', value: 'b', labelHtml: 'B', state: 'wrong', disabled: true }),
    '<button type="button" class="ui-option ui-option--choice" data-pick="b" data-state="wrong" disabled><span class="ui-option-label">B</span></button>');
  assert.equal(option({ attr: 'hyp', value: 'h1', labelHtml: 'H', kind: 'hypothesis', state: 'locked' }),
    '<button type="button" class="ui-option ui-option--hypothesis" data-hyp="h1" data-state="locked" aria-disabled="true"><span class="ui-option-label">H</span></button>');
  assert.equal(option({ attr: 'opt', value: 'o1', labelHtml: 'Keep 10%', kind: 'radio', name: 'sampling', pressed: true }),
    '<label class="ui-option ui-option--radio" data-opt="o1" data-picked><input type="radio" class="ui-option-input" name="sampling" value="o1" checked>' +
    '<span class="ui-option-label">Keep 10%</span></label>');
  // The picked radio card carries data-picked (the CSS has no :has), an unpicked one does not.
  assert.equal(option({ attr: 'opt', value: 'o1', labelHtml: 'K', kind: 'radio', name: 's', pressed: true }).includes(' data-picked'), true);
  assert.equal(option({ attr: 'opt', value: 'o1', labelHtml: 'K', kind: 'radio', name: 's', pressed: false }).includes('data-picked'), false);
  assert.equal(option({ attr: 'opt', value: 'o1', labelHtml: 'K', kind: 'radio', name: 's' }).includes('data-picked'), false);
  for (const [state, want] of [['correct', 'correct'], ['opened', 'opened']]) {
    assert.match(option({ attr: 'x', value: 'v', labelHtml: 'l', state }), new RegExp(`data-state="${want}"`));
  }
  for (const kind of ['toggle', 'line']) assert.match(option({ attr: 'x', value: 'v', labelHtml: 'l', kind }), new RegExp(`ui-option--${kind}"`));
  assert.equal(options({ labelledBy: 'q1', itemsHtml: 'I' }), '<div class="ui-options ui-options--list" role="group" aria-labelledby="q1">I</div>');
  assert.equal(options({ id: 'views', layout: 'grid', itemsHtml: 'I' }), '<div class="ui-options ui-options--grid" id="views">I</div>');
  assert.match(options({ layout: 'wrap', itemsHtml: '' }), /ui-options--wrap/);
  assert.match(options({ layout: 'drops', itemsHtml: '' }), /ui-options--drops/);
  assert.match(option({ attr: 'x', value: 'v', labelHtml: 'l', drop: true }), /class="ui-option ui-option--choice ui-option--drop"/);
  assert.doesNotMatch(option({ attr: 'x', value: 'v', labelHtml: 'l' }), /ui-option--drop/);
  assert.throws(() => option({ attr: 'x', value: 'v', labelHtml: 'l', kind: 'toggle', drop: true }), /drop is only for the choice kind/);
});

test('feedback: a hidden live region with an icon and a text slot; bar variant', () => {
  assert.equal(feedback({ id: 'q1-feedback' }),
    '<div class="ui-feedback" id="q1-feedback" role="status" aria-live="polite" tabindex="-1" hidden>' +
    '<span class="ui-feedback-ico"></span><div class="ui-feedback-text" data-feedback-text></div></div>');
  assert.match(feedback({ id: 'f', bar: true }), /^<div class="ui-feedback ui-feedback--bar" id="f"/);
});

test('meter: 20 cells by default, spent then preview then left; the text line is the value', () => {
  const html = meter({ id: 'budget', label: 'Error budget', value: 5, max: 20, unit: 'min', previewCells: 2 });
  const cells = [...html.matchAll(/<i data-cell="(\w+)"><\/i>/g)].map((m) => m[1]);
  assert.deepEqual(cells, [...Array(5).fill('spent'), 'preview', 'preview', ...Array(13).fill('left')]);
  assert.ok(html.startsWith('<div class="ui-meter" id="budget"><p class="ui-meter-head"><span class="ui-meter-label">Error budget</span> ' +
    '<span class="ui-meter-value" id="budget-value">5 of 20 min</span></p><div class="ui-meter-cells" aria-hidden="true">'));
  assert.ok(html.endsWith('</div></div>'));
  const over = meter({ id: 'cost', label: 'Cost', value: 12, max: 10, cells: 5, over: true });
  assert.deepEqual([...over.matchAll(/data-cell="(\w+)"/g)].map((m) => m[1]), Array(5).fill('over'));
  assert.match(over, /12 of 10<\/span>/);
  assert.match(meter({ id: 'big', label: 'B', value: 4800, max: 600, unit: 'spans/s', cells: 4 }), /4,800 of 600 spans\/s<\/span>/, 'en-US grouping, as an option card writes it');
  const half = meter({ id: 'h', label: 'H', value: 1, max: 4, cells: 4, previewCells: 9 });
  assert.deepEqual([...half.matchAll(/data-cell="(\w+)"/g)].map((m) => m[1]), ['spent', 'preview', 'preview', 'preview'], 'preview stops at the end');
});

test('U1 fold: a native details evidence card; open and fresh are attributes; the title is an h4 that takes focus by script', () => {
  const caret = '<svg class="ui-fold-caret" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M5 3l4 4-4 4"></path></svg>';
  assert.equal(fold({ value: 'traces', titleHtml: 'Traces', bodyHtml: '<p>Slow spans.</p>' }),
    '<details class="ui-fold" data-fold="traces">' +
    `<summary class="ui-fold-summary">${caret}<h4 class="ui-fold-title" tabindex="-1" data-heading="traces">Traces</h4></summary>` +
    '<div class="ui-fold-body"><p>Slow spans.</p></div></details>');
  const full = fold({ value: 'deploys', titleHtml: 'Deploy log', metaHtml: '6 min', bodyHtml: 'b', open: true, fresh: true });
  assert.ok(full.startsWith('<details class="ui-fold" data-fold="deploys" open data-fresh><summary'), full);
  assert.ok(full.includes('</h4><span class="ui-fold-meta">6 min</span></summary>'), full);
  assert.equal(/\sopen[\s>]/.test(fold({ value: 'a', titleHtml: 't', bodyHtml: 'b', fresh: true })), false, 'closed unless open');
  assert.equal(fold({ value: 'a', titleHtml: 't', bodyHtml: 'b', open: true }).includes('data-fresh'), false, 'fresh only when asked');
  const { document } = parseHTML(`<!doctype html><html><body>${full}</body></html>`);
  const d = document.querySelector('details');
  assert.equal(d.hasAttribute('open'), true);
  assert.equal(d.querySelector('summary [data-heading="deploys"]').getAttribute('tabindex'), '-1');
});

test('field, radio, checkbox', () => {
  assert.equal(field({ id: 'svc', label: 'Service name' }),
    '<div class="ui-field"><label class="ui-field-label" for="svc">Service name</label>' +
    '<input type="text" class="ui-input" id="svc" value=""></div>');
  assert.equal(field({ id: 'cfg', label: 'Config', kind: 'code', rows: 6, value: 'a: "1"', readonly: true, noteHtml: 'Read <b>only</b>' }),
    '<div class="ui-field"><label class="ui-field-label" for="cfg">Config</label>' +
    '<textarea class="ui-input ui-input--code" id="cfg" rows="6" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" readonly aria-describedby="cfg-note">a: &quot;1&quot;</textarea>' +
    '<p class="ui-note" id="cfg-note">Read <b>only</b></p></div>');
  assert.equal(radio({ name: 'k', value: 'v', labelHtml: 'V', checked: true }),
    '<label class="ui-check"><input type="radio" class="ui-check-input" name="k" value="v" checked><span class="ui-check-label">V</span></label>');
  assert.equal(checkbox({ id: 'c1', labelHtml: 'C', disabled: true }),
    '<label class="ui-check"><input type="checkbox" class="ui-check-input" id="c1" disabled><span class="ui-check-label">C</span></label>');
});

test('radioGroup legendHtml: the legend is trusted HTML (a question with code); exactly one of legend and legendHtml', () => {
  assert.equal(radioGroup({ legendHtml: 'The <code>x</code> knob', itemsHtml: '' }),
    '<fieldset class="ui-group"><legend class="ui-group-legend">The <code>x</code> knob</legend></fieldset>');
  assert.throws(() => radioGroup({ legend: 'a', legendHtml: 'b', itemsHtml: '' }), { name: 'TypeError', message: /exactly one of legend and legendHtml/ });
  assert.throws(() => radioGroup({ itemsHtml: '' }), { name: 'TypeError', message: /exactly one/ });
});

test('radioGroup: a fieldset named by its legend; legend escaped, rows trusted', () => {
  assert.equal(radioGroup({ legend: 'Which <one>?', itemsHtml: radio({ name: 'k', value: 'v', labelHtml: 'V' }) }),
    '<fieldset class="ui-group"><legend class="ui-group-legend">Which &lt;one&gt;?</legend>' +
    '<label class="ui-check"><input type="radio" class="ui-check-input" name="k" value="v"><span class="ui-check-label">V</span></label></fieldset>');
});

test('button describedBy: names the explanation of a disabled button; absent by default', () => {
  assert.equal(button({ id: 'go', label: 'Go', disabled: true, describedBy: 'why' }),
    '<button type="button" class="ui-btn ui-btn--ghost" id="go" aria-describedby="why" disabled>Go</button>');
  assert.equal(button({ id: 'go', label: 'Go' }).includes('aria-describedby'), false);
});

test('table and prose: a captioned table scrolls in a labelled region; an uncaptioned one is not labelled', () => {
  assert.ok(table({ caption: 'Endpoints "x" & <b>', head: ['a'], rows: [['1']] })
    .startsWith('<div class="ui-table-wrap" role="region" aria-label="Endpoints &quot;x&quot; &amp; &lt;b&gt;" tabindex="0"><table'));
  assert.equal(table({ head: ['a'], rows: [] }).includes('role='), false);
  assert.equal(prose('<table><caption>Ends <code>x</code></caption><tr><td>1</td></tr></table>'),
    '<div class="ui-prose"><div class="ui-table-wrap" role="region" aria-label="Ends x" tabindex="0"><table><caption>Ends <code>x</code></caption><tr><td>1</td></tr></table></div></div>');
  assert.equal(prose('<table><caption>Say "hi"</caption></table>').includes('aria-label="Say &quot;hi&quot;"'), true);
});

test('a captioned table region takes focus so the keyboard can scroll it; an uncaptioned one does not (#178)', () => {
  const tab = (html) => /<div class="ui-table-wrap"([^>]*)>/.exec(html)[1];
  assert.match(tab(table({ caption: 'Errors', head: ['a'], rows: [['1']] })), /\btabindex="0"/);
  assert.match(tab(prose('<table><caption>Ends</caption><tr><td>1</td></tr></table>')), /\btabindex="0"/);
  assert.doesNotMatch(tab(table({ head: ['a'], rows: [] })), /tabindex/);
  const ring = rules(read('styles/kit.css')).find((r) => r.selector.split(',').map((s) => s.trim()).includes('.ui-table-wrap:focus-visible'));
  assert.ok(ring, 'the kit styles the focused scroll region');
  assert.deepEqual(decls(ring.body).filter(([k]) => k === 'outline').map(([, v]) => v), ['2px solid var(--color-focus)']);
});

test('field kind secret: a labelled password input that never carries a value', () => {
  const html = field({ id: 'tok', label: 'Token', kind: 'secret', noteHtml: 'Kept in memory' });
  assert.equal(html,
    '<div class="ui-field"><label class="ui-field-label" for="tok">Token</label>' +
    '<input type="password" class="ui-input" id="tok" autocomplete="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" aria-describedby="tok-note">' +
    '<p class="ui-note" id="tok-note">Kept in memory</p></div>');
  assert.ok(!/\svalue=/.test(html), 'no value attribute');
  const plain = field({ id: 'ep', label: 'Endpoint', autocompleteOff: true });
  assert.ok(plain.includes('type="text"') && plain.includes(' autocomplete="off"'), 'a text field can opt out of autofill');
  assert.ok(!field({ id: 'ep', label: 'Endpoint' }).includes('autocomplete'), 'and does not by default');
  assert.throws(() => field({ id: 'tok', label: 'Token', kind: 'secret', value: 'auth_x' }), /field: .*secret/);
  assert.throws(() => field({ id: 'tok', label: 'Token', kind: 'secret', readonly: true }), /field: .*secret/);
});

test('table: escaped cells, scoped headings, numeric columns', () => {
  assert.equal(table({ caption: 'Errors', head: ['service', 'count'], rows: [['a<b', 3]], numeric: [1] }),
    '<div class="ui-table-wrap" role="region" aria-label="Errors" tabindex="0"><table class="ui-table"><caption>Errors</caption><thead><tr><th scope="col">service</th>' +
    '<th scope="col" data-num>count</th></tr></thead><tbody><tr><td>a&lt;b</td><td data-num>3</td></tr></tbody></table></div>');
  assert.equal(table({ head: ['a'], rows: [] }),
    '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th scope="col">a</th></tr></thead><tbody></tbody></table></div>');
});

test('stats and dots', () => {
  assert.equal(stats([{ label: 'Spans', value: 4 }, { label: 'Window', value: '-120 to 130 ms' }]),
    '<dl class="ui-stats"><div><dt>Spans</dt><dd>4</dd></div><div><dt>Window</dt><dd>-120 to 130 ms</dd></div></dl>');
  assert.equal(dots({ total: 3, on: 1, label: '1 of 3 clues found' }),
    '<span class="ui-dots" role="img" aria-label="1 of 3 clues found"><i data-on="true"></i><i data-on="false"></i><i data-on="false"></i></span>');
  // Beside a text line that already says it (the hint pips): hidden from screen readers, hint tone.
  assert.equal(dots({ total: 2, on: 1, decorative: true, tone: 'hint' }),
    '<span class="ui-dots" aria-hidden="true" data-tone="hint"><i data-on="true"></i><i data-on="false"></i></span>');
  assert.equal(dots({ total: 1, on: 0, label: 'x', tone: 'success' }),
    '<span class="ui-dots" role="img" aria-label="x" data-tone="success"><i data-on="false"></i></span>');
});

test('side: help chips say on or off in words; stars; the column keeps the help-ladder ids', () => {
  assert.equal(helpChips('b1', [{ key: 'tint', label: 'Trace tint', on: false }, { key: 'hints', label: 'Hints', on: true }]),
    '<p class="ui-help-chips" id="b1-helps"><span class="ui-help-chips-title">Helps:</span> ' +
    '<span class="ui-chip" data-tone="neutral" data-help="tint" data-on="false"><i class="ui-chip-dot" aria-hidden="true"></i>Trace tint <span data-state>off</span></span> ' +
    '<span class="ui-chip" data-tone="success" data-help="hints" data-on="true"><i class="ui-chip-dot" aria-hidden="true"></i>Hints <span data-state>on</span></span></p>');
  const s = stars(3, false);
  assert.deepEqual([...s.matchAll(/data-star="(\w+)"/g)].map((m) => m[1]), ['possible', 'possible', 'possible', 'lost', 'lost']);
  assert.deepEqual([...stars(2, true).matchAll(/data-star="(\w+)"/g)].map((m) => m[1]), ['earned', 'earned', 'lost', 'lost', 'lost']);
  assert.equal((s.match(/<svg /g) ?? []).length, 5);
  const col = sideColumn({ id: 'b1', titleHtml: 'Trace <b>rebuilt</b>', counts: [{ key: 'wrong', label: 'failed Checks' }], hints: true, ruleHtml: 'R' });
  const ids = [...col.matchAll(/ id="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['b1-win', 'b1-win-title', 'b1-win-stars', 'b1-win-closing', 'b1-wrong', 'b1-wrong-label', 'b1-hints', 'b1-hints-label',
    'b1-stars', 'b1-hint', 'b1-hint-cost', 'b1-hint-tier', 'b1-hint-text']);
  assert.ok(col.startsWith('<aside class="ui-side" aria-label="Result, score and hints"><section class="ui-win" id="b1-win" aria-labelledby="b1-win-title" hidden>'));
  assert.ok(col.includes('<div class="ui-win-swirl" data-swirl aria-hidden="true"></div>'));
  assert.ok(col.includes('<h3 class="ui-win-title" id="b1-win-title" tabindex="-1">Trace <b>rebuilt</b></h3>'));
  assert.ok(col.includes('<span class="ui-score-count"><b id="b1-wrong">0</b> <span id="b1-wrong-label">failed Checks</span></span>'));
  assert.ok(col.includes('<p class="ui-score-rule">R</p>'));
  assert.ok(col.includes('<button type="button" class="ui-btn ui-btn--hint" id="b1-hint">Hint</button>'));
  const none = sideColumn({ id: 's1', titleHtml: 'T', counts: [] });
  assert.ok(none.includes('<p class="ui-hints-tier" id="s1-hint-tier">No hints on this level.</p>'));
  assert.equal(none.includes('id="s1-hint"'), false);
  assert.equal(none.includes('ui-score-rule'), false);
  // The guide panel's slot (#17): one empty div, last in the column, with or without hints; no id, class or style.
  for (const c of [col, none]) {
    assert.equal(c.split('<div data-guide-slot></div>').length - 1, 1);
    assert.ok(c.endsWith('<div data-guide-slot></div></aside>'));
  }
});

// ---- T10 the contract across every helper --------------------------------------------

// [name, call with a text param set to `t` (or null), call with an *Html param set to `h` (or null)]
const CASES = [
  ['step', null, (h) => step({ bodyHtml: h })],
  ['split', null, (h) => split({ mainHtml: h, sideHtml: h })],
  ['actions', null, (h) => actions({ buttonsHtml: h })],
  ['lesson', null, (h) => lesson(h)],
  ['question', null, (h) => question({ id: 'q', html: h })],
  ['eyebrow', (t) => eyebrow(t), null],
  ['hintHead', (t) => hintHead(t, t), null],
  ['stepHead', null, (h) => stepHead({ step: 1, titleHtml: h, noteHtml: h })],
  ['note', null, (h) => note(h)],
  ['prose', null, (h) => prose(h)],
  ['codeBlock', (t) => codeBlock(t), null],
  ['panel', null, (h) => panel({ headHtml: h, sections: [h] })],
  ['chip', (t) => chip({ text: t, dot: true }), null],
  ['button', (t) => button({ label: t }), null],
  ['linkButton', (t) => linkButton({ label: t, href: '/x' }), null],
  ['reason', (t) => reason({ id: 'r', text: t }), null],
  ['buttonRow', null, (h) => buttonRow(h)],
  ['nextButton', null, null, () => nextButton('n')],
  ['finishButton', null, null, () => finishButton('f')],
  ['option', (t) => option({ attr: 'pick', value: t, labelHtml: 'l' }), (h) => option({ attr: 'pick', value: 'v', labelHtml: h, metaHtml: h })],
  ['options', null, (h) => options({ itemsHtml: h })],
  ['feedback', null, null, () => feedback({ id: 'f', bar: true })],
  ['meter', (t) => meter({ id: 'm', label: t, value: 1, max: 2, unit: t }), null],
  ['field', (t) => field({ id: 'f', label: t, value: t }), (h) => field({ id: 'f', label: 'l', noteHtml: h })],
  ['radio', (t) => radio({ name: 'r', value: t, labelHtml: 'l' }), (h) => radio({ name: 'r', value: 'v', labelHtml: h })],
  ['checkbox', (t) => checkbox({ value: t, labelHtml: 'l' }), (h) => checkbox({ labelHtml: h })],
  ['table', (t) => table({ caption: t, head: [t], rows: [[t]] }), null],
  ['radioGroup', (t) => radioGroup({ legend: t, itemsHtml: '' }), (h) => radioGroup({ legend: 'l', itemsHtml: h })],
  ['stats', (t) => stats([{ label: t, value: t }]), null],
  ['dots', (t) => dots({ total: 2, on: 1, label: t }), null],
  ['helpChips', (t) => helpChips('h', [{ key: 'k', label: t, on: true }]), null],
  ['sideColumn', (t) => sideColumn({ id: 's', titleHtml: 't', counts: [{ key: 'wrong', label: t }] }), (h) => sideColumn({ id: 's', titleHtml: h, counts: [], hints: true, ruleHtml: h })],
  ['stars', null, null, () => stars(5, true)],
  ['fold', null, (h) => fold({ value: 'v', titleHtml: h, metaHtml: h, bodyHtml: h })],
];

// Every static variant: each value of the exported enums and each boolean modifier, so a
// variant class missing from kit.css is caught, not just the defaults.
const VARIANTS = () => [
  ...OPTION_KINDS.map((kind) => option({ attr: 'a', value: 'v', labelHtml: 'l', metaHtml: 'm', kind, ...(kind === 'radio' ? { name: 'n' } : {}) })),
  ...OPTIONS_LAYOUTS.map((layout) => options({ layout, itemsHtml: '' })),
  ...PANEL_VARIANTS.map((variant) => panel({ variant, headHtml: 'h', sections: ['s'] })),
  ...LINK_VARIANTS.map((variant) => linkButton({ label: 'l', href: '/x', variant })),
  ...BUTTON_VARIANTS.map((variant) => button({ label: 'l', variant, ...(variant === 'icon' ? { icon: 'x' } : {}) })),
  ...TONES.map((tone) => chip({ text: 't', tone, dot: true, swatch: 0, dashed: true })),
  ...DOTS_TONES.map((tone) => dots({ total: 2, on: 1, decorative: true, tone })),
  step({ wide: true, bodyHtml: '' }), actions({ wide: true, buttonsHtml: '' }), feedback({ id: 'f', bar: true }),
  field({ id: 'f', label: 'l', kind: 'code', noteHtml: 'n' }), field({ id: 'f', label: 'l' }),
  radio({ name: 'r', value: 'v', labelHtml: 'l' }), checkbox({ labelHtml: 'l' }), radioGroup({ legend: 'l', itemsHtml: '' }),
  fold({ value: 'v', titleHtml: 't', metaHtml: 'm', bodyHtml: 'b', open: true, fresh: true }),
];

const outputs = () => CASES.flatMap(([, t, h, plain]) => [t?.('x'), h?.('<i>x</i>'), plain?.()].filter((o) => o !== undefined)).concat(VARIANTS());

test('T10 every exported helper is covered by the contract table', () => {
  const exported = Object.keys(ui).filter((k) => typeof ui[k] === 'function' && !['setFeedback', 'clearFeedback'].includes(k)).sort();
  assert.deepEqual(CASES.map(([n]) => n).sort(), exported);
});

test('T10 text params are escaped and *Html params pass through untouched', () => {
  for (const [name, t, h] of CASES) {
    if (t) {
      const out = t(BAD);
      assert.ok(out.includes(ESCAPED), `${name} escapes text`);
      assert.equal(out.includes(BAD), false, `${name} leaks raw text`);
    }
    if (h) assert.ok(h(BAD).includes(BAD), `${name} passes trusted HTML through`);
  }
});

test('T10 no style attribute and no on* handler in any helper output (CSP)', () => {
  for (const out of outputs()) {
    assert.equal(/\sstyle=/i.test(out), false, out);
    assert.equal(/\son[a-z]+=/i.test(out), false, out);
  }
});

test('T10 every class a helper emits is a ui- class with its own rule in styles/kit.css', () => {
  const kit = definedClasses(['styles/kit.css']);
  // Own rule: a compound that is exactly `.c` (not only `.c:disabled` or `.c[data-x]`), so a
  // renamed base rule fails even when a state rule still mentions the class.
  const own = new Set(rules(read('styles/kit.css')).flatMap((r) => splitTop(r.selector))
    .flatMap((s) => s.split(/\s*[\s>+~]\s*/)).filter((c) => /^\.[\w-]+$/.test(c)).map((c) => c.slice(1)));
  const used = new Set(outputs().flatMap((o) => [...o.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))));
  assert.ok(used.size > 70, `expected every variant class, got ${used.size}`);
  for (const c of used) {
    assert.ok(c.startsWith('ui-'), `helpers emit only ui- classes, got ${c}`);
    assert.ok(kit.has(c), `.${c} is emitted but kit.css does not define it`);
    assert.ok(own.has(c), `.${c} is emitted but kit.css has no rule of its own for it`);
  }
});

test('T10 every runtime state and tone value has its own rule in kit.css', () => {
  const sels = rules(read('styles/kit.css')).flatMap((r) => splitTop(r.selector));
  const groups = [
    ['.ui-option', 'data-state', OPTION_STATES],
    ['.ui-chip', 'data-tone', TONES],
    ['.ui-feedback', 'data-tone', FEEDBACK_TONES],
    ['.ui-dots', 'data-tone', DOTS_TONES],
  ];
  for (const [base, attr, values] of groups) {
    assert.ok(values.length > 0, base);
    for (const v of values) {
      const head = `${base}[${attr}="${v}"]`;
      assert.ok(sels.some((s) => s.startsWith(head)), `kit.css has no ${head} rule`);
    }
  }
});

test('T10 each tone and coloured state is pinned by the declaration that renders it', () => {
  const list = rules(read('styles/kit.css'));
  /** Values of `prop` in every kit.css rule whose selector list contains exactly `sel`. */
  const valuesOf = (sel, prop) => list.filter((r) => splitTop(r.selector).includes(sel))
    .flatMap((r) => decls(r.body)).filter(([p]) => p === prop).map(([, v]) => v);
  const token = (name) => `var(--color-${name})`;
  const CHIP = { neutral: 'text-muted', success: 'success', error: 'error', hint: 'hint', attention: 'parent' };
  // [enum, value -> [selector, property, expected value]]
  const pins = [
    [TONES, (v) => [`.ui-chip[data-tone="${v}"] .ui-chip-dot`, 'background', token(CHIP[v])]],
    [DOTS_TONES, (v) => [`.ui-dots[data-tone="${v}"] i[data-on="true"]`, 'background', token(v)]],
    // Neutral feedback has no colour: its cue is the glyph and its alt text.
    [FEEDBACK_TONES, (v) => (v === 'neutral'
      ? ['.ui-feedback[data-tone="neutral"] .ui-feedback-ico::before', 'content', '"i" / "Note"']
      : [`.ui-feedback[data-tone="${v}"] .ui-feedback-ico`, 'color', token(v)])],
    // States carried by colour: the marker and the border. locked and opened are carried by
    // the dashed border and the muted title (the prefix check above covers their rules).
    [['correct', 'wrong'], (v) => [`.ui-option[data-state="${v}"]::after`, 'color', token(v === 'correct' ? 'success' : 'error')]],
    [['correct'], () => ['.ui-option[data-state="correct"]', 'border-color', token('success')]],
  ];
  assert.deepEqual(Object.keys(CHIP), [...TONES], 'every chip tone has a colour');
  assert.ok(['correct', 'wrong'].every((s) => OPTION_STATES.includes(s)));
  for (const [values, pin] of pins) {
    for (const v of values) {
      const [sel, prop, want] = pin(v);
      assert.ok(valuesOf(sel, prop).includes(want), `kit.css: "${sel}" must set ${prop}: ${want}`);
    }
  }
});

// [name, thunk] that must throw a TypeError whose message starts with `<name>:`.
const INVALID = [
  ['step', () => step()],
  ['step', () => step({ bodyHtml: 1 })],
  ['step', () => step({ bodyHtml: '', wide: 'yes' })],
  ['step', () => step({ bodyHtml: '', narrow: true })],
  ['split', () => split({ mainHtml: 'm' })],
  ['actions', () => actions({ buttonsHtml: null })],
  ['lesson', () => lesson()],
  ['question', () => question({ id: '1q', html: 'x' })],
  ['question', () => question({ id: 'a b', html: 'x' })],
  ['eyebrow', () => eyebrow('')],
  ['hintHead', () => hintHead('Hint 1 of 3', '')],
  ['stepHead', () => stepHead({ step: 0, titleHtml: 'x' })],
  ['stepHead', () => stepHead({ step: 1.5, titleHtml: 'x' })],
  ['note', () => note(5)],
  ['prose', () => prose(undefined)],
  ['codeBlock', () => codeBlock({})],
  ['panel', () => panel({ sections: [] })],
  ['panel', () => panel({ variant: 'dashed', sections: ['x'] })],
  ['panel', () => panel({ sections: [1] })],
  ['chip', () => chip({ text: 'x', tone: 'red' })],
  ['chip', () => chip({})],
  ['chip', () => chip({ text: 'x', swatch: 6 })],
  ['button', () => button({ label: '' })],
  ['linkButton', () => linkButton({ label: 'x', href: 'javascript:alert(1)' })],
  ['button', () => button({ label: 'x', variant: 'danger' })],
  ['button', () => button({ label: 'x', type: 'reset' })],
  ['button', () => button({ label: 'x', id: '"x"' })],
  ['button', () => button({ label: 'x', variant: 'icon' })],
  ['button', () => button({ label: 'x', icon: '<' })],
  ['button', () => button({ label: 'x', disable: true })],
  ['reason', () => reason({ id: 'r', text: '' })],
  ['buttonRow', () => buttonRow(5)],
  ['nextButton', () => nextButton()],
  ['finishButton', () => finishButton('fin ish')],
  ['option', () => option({ attr: 'Pick', value: 'v', labelHtml: 'l' })],
  ['option', () => option({ attr: 'pick', labelHtml: 'l' })],
  ['option', () => option({ attr: 'pick', value: 'v', labelHtml: 'l', state: 'right' })],
  ['option', () => option({ attr: 'pick', value: 'v', labelHtml: 'l', kind: 'card' })],
  ['option', () => option({ attr: 'pick', value: 'v', labelHtml: 'l', pressed: 'true' })],
  ['option', () => option({ attr: 'pick', value: 'v', labelHtml: 'l', kind: 'radio' })],
  ['options', () => options({ layout: 'columns', itemsHtml: '' })],
  ['options', () => options({ labelledBy: 'x y', itemsHtml: '' })],
  ['feedback', () => feedback({})],
  ['feedback', () => feedback({ id: 'f', bar: 1 })],
  ['meter', () => meter({ id: 'm', label: 'L', value: Number.NaN, max: 10 })],
  ['meter', () => meter({ id: 'm', label: 'L', value: 1, max: 0 })],
  ['meter', () => meter({ id: 'm', label: 'L', value: -1, max: 10 })],
  ['meter', () => meter({ id: 'm', label: 'L', value: 1, max: Infinity })],
  ['meter', () => meter({ id: 'm', label: 'L', value: 1, max: 10, cells: 0 })],
  ['meter', () => meter({ id: 'm', value: 1, max: 10 })],
  ['meter', () => meter({ id: 'm', label: 'L', value: 1, max: 10, previewCells: -1 })],
  ['field', () => field({ id: 'f', label: 'L', kind: 'number' })],
  ['field', () => field({ id: 'f', label: 'L', rows: 0, kind: 'code' })],
  ['field', () => field({ label: 'L' })],
  ['radio', () => radio({ value: 'v', labelHtml: 'l' })],
  ['radioGroup', () => radioGroup({ itemsHtml: '' })],
  ['button', () => button({ label: 'x', describedBy: 'not an id' })],
  ['checkbox', () => checkbox({ labelHtml: 'l', checked: 'yes' })],
  ['table', () => table({ head: [], rows: [] })],
  ['table', () => table({ head: ['a', 'b'], rows: [['1']] })],
  ['table', () => table({ head: ['a'], rows: [], numeric: [1] })],
  ['stats', () => stats([])],
  ['stats', () => stats([{ label: 'a' }])],
  ['dots', () => dots({ total: 3, on: 4, label: 'x' })],
  ['dots', () => dots({ total: 3, on: 1 })],
  ['dots', () => dots({ total: 3, on: 1, decorative: true, label: 'x' })],
  ['dots', () => dots({ total: 3, on: 1, decorative: 'yes' })],
  ['dots', () => dots({ total: 3, on: 1, label: 'x', tone: 'error' })],
  ['helpChips', () => helpChips('h', [{ key: 'a b', label: 'x', on: true }])],
  ['helpChips', () => helpChips('h', [{ key: 'a', label: 'x', on: 'yes' }])],
  ['sideColumn', () => sideColumn({ id: 's', titleHtml: 't', counts: [{ key: 'hints', label: 'x' }] })],
  ['sideColumn', () => sideColumn({ id: 's', titleHtml: 't', counts: [{ key: 'a', label: 'x' }, { key: 'a', label: 'y' }] })],
  ['sideColumn', () => sideColumn({ id: 's', counts: [] })],
  ['stars', () => stars(Number.NaN, false)],
  ['stars', () => stars(6, true)],
  ['stars', () => stars(2, 'yes')],
  ['fold', () => fold()],
  ['fold', () => fold({ value: 'Not a token!', titleHtml: 't', bodyHtml: 'b' })],
  ['fold', () => fold({ value: 'v', titleHtml: '', bodyHtml: 'b' })],
  ['fold', () => fold({ value: 'v', titleHtml: 't', bodyHtml: 1 })],
  ['fold', () => fold({ value: 'v', titleHtml: 't', bodyHtml: 'b', open: 'yes' })],
  ['fold', () => fold({ value: 'v', titleHtml: 't', bodyHtml: 'b', fresh: 1 })],
  ['fold', () => fold({ value: 'v', titleHtml: 't', bodyHtml: 'b', colour: 'red' })],
];

test('T10 bad input throws a TypeError naming the helper', () => {
  for (const [name, thunk] of INVALID) {
    assert.throws(thunk, (err) => err instanceof TypeError && err.message.startsWith(`${name}: `), `${name}: ${thunk}`);
  }
  // Every helper has at least one rejected input.
  const named = new Set(INVALID.map(([n]) => n));
  for (const [name] of CASES) assert.ok(named.has(name), `${name} has no invalid-input case`);
});

test('T10 lib/ui is DOM-free at import and never reaches for a global document or window', () => {
  const files = readdirSync(join(ROOT, 'lib', 'ui')).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = read(`lib/ui/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/\b(?:window|document|localStorage|globalThis)\b/.test(src), false, `lib/ui/${f} touches a global`);
  }
});

// ---- T11 setFeedback / clearFeedback ------------------------------------------------------

function region() {
  const { document } = parseHTML(`<!doctype html><html><body>${feedback({ id: 'fb' })}</body></html>`);
  return document.getElementById('fb');
}

test('T11 setFeedback sets the tone, shows the region and fills its text; a new tone replaces the old', () => {
  const el = region();
  assert.equal(el.hasAttribute('hidden'), true, 'hidden until set');
  setFeedback(el, 'error', 'Not quite. <b>why</b>');
  assert.equal(el.getAttribute('data-tone'), 'error');
  assert.equal(el.hasAttribute('hidden'), false);
  assert.equal(el.querySelector('[data-feedback-text]').innerHTML, 'Not quite. <b>why</b>');
  setFeedback(el, 'neutral', 'Opened logs.');
  assert.equal(el.getAttribute('data-tone'), 'neutral');
  assert.equal(el.querySelector('[data-feedback-text]').innerHTML, 'Opened logs.');
  setFeedback(el, 'success', 'Right.');
  assert.equal(el.getAttribute('data-tone'), 'success');
});

test('T11 an unknown tone, non-string html or a non-feedback element throws and leaves the element unchanged', () => {
  const el = region();
  setFeedback(el, 'neutral', 'kept');
  const before = el.outerHTML;
  for (const [tone, html] of [['info', 'x'], ['good', 'x'], [undefined, 'x'], ['error', 5]]) {
    assert.throws(() => setFeedback(el, tone, html), (e) => e instanceof TypeError && e.message.startsWith('setFeedback: '));
    assert.equal(el.outerHTML, before, `unchanged after ${tone}`);
  }
  const { document } = parseHTML('<!doctype html><html><body><p id="p">x</p></body></html>');
  const p = document.getElementById('p');
  assert.throws(() => setFeedback(p, 'error', 'x'), (e) => e instanceof TypeError && e.message.startsWith('setFeedback: '));
  assert.equal(p.outerHTML, '<p id="p">x</p>');
  assert.throws(() => setFeedback(null, 'error', 'x'), TypeError);
});

test('T11 clearFeedback hides the region, drops the tone and empties the text', () => {
  const el = region();
  setFeedback(el, 'error', 'x');
  clearFeedback(el);
  assert.equal(el.hasAttribute('hidden'), true);
  assert.equal(el.hasAttribute('data-tone'), false);
  assert.equal(el.querySelector('[data-feedback-text]').innerHTML, '');
  assert.throws(() => clearFeedback({}), (e) => e instanceof TypeError && e.message.startsWith('clearFeedback: '));
});

test('field wrap: a code field soft-wraps (wrap="soft"); without it nothing changes; other kinds refuse it (#321)', () => {
  const on = field({ id: 'q', label: 'Query', kind: 'code', rows: 3, wrap: true });
  assert.match(on, /<textarea class="ui-input ui-input--code" id="q" rows="3" wrap="soft" /);
  assert.doesNotMatch(field({ id: 'q', label: 'Query', kind: 'code', rows: 3 }), /wrap=/);
  assert.throws(() => field({ id: 'q', label: 'Q', wrap: true }), /field: wrap/);
  assert.throws(() => field({ id: 'q', label: 'Q', kind: 'code', wrap: 'yes' }), /field/);
});

test('#331 setFeedback scrolls the region into view by the least distance, once, after it is shown', () => {
  const el = region();
  const calls = [];
  el.scrollIntoView = (o) => calls.push([o, el.hasAttribute('hidden')]);
  setFeedback(el, 'error', 'x');
  assert.deepEqual(calls, [[{ block: 'nearest' }, false]], 'shown before it is scrolled to');
  clearFeedback(el);
  assert.equal(calls.length, 1, 'clearing does not scroll');
  assert.doesNotThrow(() => setFeedback(region(), 'neutral', 'no scrollIntoView in this DOM'));
});

test('#331 the kit feedback keeps a scroll margin so it clears the pinned footer', () => {
  const r = rules(read('styles/kit.css')).find((x) => x.selector === '.ui-feedback' && x.body.includes('scroll-margin-block-end'));
  assert.ok(r, 'scroll-margin-block-end on .ui-feedback');
});

test('#331 the footer bar has one width for every step, so the primary button never moves', () => {
  const r = rules(read('styles/kit.css')).find((x) => x.selector === '.ui-actions');
  assert.equal(Object.fromEntries(decls(r.body))['max-inline-size'], 'var(--layout-wide)');
  assert.equal(rules(read('styles/kit.css')).some((x) => x.selector.includes('ui-actions--wide')), false);
});

test('#331 setFeedback({ scroll: false }) shows the line without scrolling (a step that opens with a line stays at its top)', () => {
  const el = region();
  let n = 0;
  el.scrollIntoView = () => { n += 1; };
  setFeedback(el, 'neutral', 'x', { scroll: false });
  assert.equal(n, 0);
  assert.equal(el.hasAttribute('hidden'), false);
});

test('#331 the sticky side column never outgrows the scrolling body, and the lines above a board stop at its edge', () => {
  const css = read('styles/kit.css');
  assert.match(css, /\.ui-split-side \{[^}]*max-block-size: calc\(100dvh - var\(--overlay-chrome\)\); overflow-y: auto/);
  assert.match(css, /\.ui-step--wide > :is\([^)]*\.ui-lesson[^)]*\.ui-feedback[^)]*\) \{ max-inline-size: calc\(100% - var\(--side-width\) - var\(--space-6\)\)/);
});

test('#331 the lesson text holds the reading width in one body wrapper, whatever its children, while the card fills its column', () => {
  const css = read('styles/kit.css');
  const body = rules(css).find((r) => r.selector === '.ui-lesson-body');
  assert.equal(Object.fromEntries(decls(body.body))['max-inline-size'], 'var(--measure)');
  const card = Object.fromEntries(decls(rules(css).find((r) => r.selector === '.ui-lesson').body));
  assert.equal('max-inline-size' in card, false, 'the card itself is not capped');
  const { document } = parseHTML(`<!doctype html><body>${lesson('a bare text node')}${lesson('<code>x</code>')}</body>`);
  for (const card of document.querySelectorAll('.ui-lesson')) assert.equal(card.querySelectorAll(':scope > .ui-lesson-body').length, 1);
});
