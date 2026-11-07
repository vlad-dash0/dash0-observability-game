// Design-system guards (#158, docs/DESIGN-SYSTEM.md "Guards"): T1-T7, T13, T14 and the
// no-glow rule. Stylesheets and sources are read as text (test/helpers/css.mjs). Allow lists
// and LEGACY only shrink: each migration deletes its entries, the last asserts them empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classesInSelector, compounds, contrast, decls, emittedClasses, overlay, ratio, read, resolveColor, rules,
  splitTop, styleFiles, stripComments, VARS, walk,
} from './helpers/css.mjs';

const SHEETS = styleFiles();
const sheetRules = (f) => rules(read(`styles/${f}`));
const NOT_TOKENS = SHEETS.filter((f) => f !== 'tokens.css');
/** Every .mjs that ships or builds markup, outside the kit and the tests. */
const APP_MODULES = walk('', ['.mjs']).filter((f) => !/^(test|vendor|lib\/ui)\//.test(f));

test('the stylesheets are the expected set, linked from index.html in cascade order', () => {
  assert.deepEqual(SHEETS, ['base.css', 'hub.css', 'kit.css', 'tokens.css', 'widgets.css']);
  const links = [...read('index.html').matchAll(/<link rel="stylesheet" href="\/styles\/([\w-]+\.css)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ['tokens.css', 'base.css', 'kit.css', 'widgets.css', 'hub.css']);
});

// ---- T1 no colour literal outside tokens.css ------------------------------------------

const CSS_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/gi;
const MARKUP_COLOUR = /\b(?:fill|stroke|color|stop-color)=["']#|rgba?\(/;
// lib/globe-view.mjs parseColor reads computed colours (rgb()) back from the browser.
const MARKUP_COLOUR_ALLOW = ['lib/globe-view.mjs'];

test('T1 scanner: finds hex and functional colour literals, not tokens', () => {
  for (const s of ['a{color:#fff}', 'a{color: rgba(1,2,3,.5)}', 'a{background:oklch(0.5 0.1 70)}', 'a{color:hsl(1 2% 3%)}']) {
    assert.ok((stripComments(s).match(CSS_COLOUR) ?? []).length > 0, s);
  }
  assert.deepEqual('a{color:var(--color-text); background: color-mix(in srgb, var(--color-success) 8%, transparent)}'.match(CSS_COLOUR), null);
  assert.ok(MARKUP_COLOUR.test('<path fill="#f00"/>'));
  assert.ok(MARKUP_COLOUR.test("el.style.color = 'rgb(0,0,0)'"));
  assert.equal(MARKUP_COLOUR.test('<path fill="currentColor"/>'), false);
});

test('T1 no colour literal in styles/*.css outside tokens.css', () => {
  for (const f of NOT_TOKENS) {
    assert.deepEqual(stripComments(read(`styles/${f}`)).match(CSS_COLOUR) ?? [], [], `colour literal in styles/${f}`);
  }
});

test('T1 no colour literal in lib/ and levels/ markup (one allowed reader)', () => {
  const files = walk('lib', ['.mjs']).concat(walk('levels', ['.mjs']));
  assert.ok(files.includes('lib/play.mjs') && files.includes('levels/index.mjs'));
  const hitFiles = new Set();
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (!MARKUP_COLOUR.test(line)) return;
      hitFiles.add(f);
      assert.ok(MARKUP_COLOUR_ALLOW.includes(f), `${f}:${i + 1} has a colour literal; use a --color-* token via a class: ${line.trim()}`);
    });
  }
  for (const f of MARKUP_COLOUR_ALLOW) assert.ok(hitFiles.has(f), `stale MARKUP_COLOUR_ALLOW entry ${f}`);
});

// ---- T2 primitives only via semantic tokens -----------------------------------------

const PRIMITIVE = /var\(\s*--(?:d0|wf|globe|kit)-/;

test('T2 primitives (--d0-, --wf-, --globe-, --kit-) are used only in tokens.css; no custom properties declared elsewhere', () => {
  let confetti = 0;
  for (const f of NOT_TOKENS) {
    for (const r of sheetRules(f)) {
      for (const [prop, value] of decls(r.body)) {
        assert.ok(!prop.startsWith('--'), `styles/${f} ${r.selector} declares ${prop}; tokens live in tokens.css`);
        if (!PRIMITIVE.test(value)) continue;
        // The confetti pieces are brand colours on purpose (hub.css).
        const ok = f === 'hub.css' && /^\.confetti\.c\d$/.test(r.selector);
        if (ok) confetti++;
        assert.ok(ok, `styles/${f} ${r.selector} { ${prop}: ${value} } uses a primitive; use a --color-* token`);
      }
    }
  }
  assert.equal(confetti, 6, 'the confetti exception is the six .confetti.cN rules');
});

// ---- T3 every var() resolves ------------------------------------------------------------

test('T3 every var(--x) in styles/ is a token declared in tokens.css', () => {
  for (const f of SHEETS) {
    const names = [...stripComments(read(`styles/${f}`)).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    assert.ok(names.length > 0, f);
    for (const n of names) assert.ok(n in VARS, `styles/${f}: var(${n}) is not declared in tokens.css`);
  }
});

// ---- T4 kit classes are owned by kit.css ------------------------------------------------

test('T4 no stylesheet but kit.css names a ui- class', () => {
  for (const f of SHEETS.filter((n) => n !== 'kit.css')) {
    for (const r of sheetRules(f)) {
      const kit = classesInSelector(r.selector).filter((c) => c.startsWith('ui-'));
      assert.deepEqual(kit, [], `styles/${f} restyles a kit class in "${r.selector}"; kit CSS lives in kit.css`);
      // Attribute selectors on class ([class^="ui-btn"], [class~="ui-chip"]) reach kit classes too.
      assert.ok(!/\[class[^\]]*ui-/.test(r.selector), `styles/${f} targets a kit class by attribute in "${r.selector}"`);
    }
  }
});

test('T4 kit.css selectors use only ui- classes, elements and attributes (no ids)', () => {
  const list = sheetRules('kit.css').filter((r) => !r.at.some((a) => a.startsWith('@keyframes')));
  assert.ok(list.length > 50, 'kit.css holds the kit');
  for (const r of list) {
    const bare = r.selector.replace(/"[^"]*"|'[^']*'/g, '').replace(/\[[^\]]*\]/g, '');
    assert.ok(!/#[\w-]/.test(bare), `kit.css "${r.selector}" uses an id`);
    for (const c of classesInSelector(r.selector)) assert.ok(c.startsWith('ui-'), `kit.css "${r.selector}" names .${c}, not a kit class`);
    // Scoped: the kit never styles a bare element, so it cannot change anything outside it.
    for (const sel of splitTop(r.selector)) {
      assert.ok(classesInSelector(sel).some((c) => c.startsWith('ui-')), `kit.css "${sel}" styles elements outside the kit`);
    }
  }
});

// ---- T5 no :has() and no !important ------------------------------------------------------

// P1b deleted the last one (.overlay:has(.build)); the step type now decides the width (T12).
test('T5 no :has() and no !important outside reduced motion and [x-cloak]', () => {
  for (const f of SHEETS) {
    for (const r of sheetRules(f)) {
      assert.ok(!r.selector.includes(':has('), `styles/${f} ${r.selector}: no :has(); give the element a class or a data-* state`);
      const reduced = r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a));
      for (const [prop, value] of decls(r.body)) {
        if (!value.includes('!important')) continue;
        assert.ok(reduced || r.selector === '[x-cloak]', `styles/${f} ${r.selector} { ${prop}: ${value} } uses !important`);
      }
    }
  }
});

// ---- T12 the generic layout: one container, named by the kit ------------------------------

// The legacy hand-written step's stage is the one other `level` container (base.css, until
// #165 moves those levels onto the kit step). Only shrinks.
const CONTAINER_ALLOW = ['base.css .lesson-stage'];

test('T12 the split shows its side column from 960px of the level container: minmax(0, 1fr) and a 300px side', () => {
  const at = sheetRules('kit.css').filter((r) => r.at.includes('@container level (min-width: 960px)'));
  const split = at.find((r) => r.selector === '.ui-split');
  assert.ok(split, 'kit.css has @container level (min-width: 960px) { .ui-split { ... } }');
  assert.equal(Object.fromEntries(decls(split.body))['grid-template-columns'], 'minmax(0, 1fr) var(--side-width)');
  assert.equal(VARS['--side-width'], '300px');
  const kitStep = sheetRules('kit.css').find((r) => r.selector === '.ui-step');
  assert.equal(Object.fromEntries(decls(kitStep.body)).container, 'level / inline-size', 'every kit step is the level container');
});

/** `file .class` when the selector is that one class alone (no ancestor, attribute or state), else null. */
const containerKey = (f, selector) => {
  const cs = splitTop(selector).length === 1 ? compounds(selector) : [];
  const [c] = cs;
  return cs.length === 1 && c.classes.length === 1 && !c.attrs.length && !c.pseudos.length && selector.trim() === `.${c.classes[0]}`
    ? `${f} .${c.classes[0]}` : null;
};
const CONTAINER_PROP = /^container(?:-name|-type)?$/;

test('T12 harness: a container is keyed only by a lone class, and its declaration is read with its value', () => {
  assert.equal(containerKey('base.css', '.lesson-stage'), 'base.css .lesson-stage');
  for (const sel of ['.x .lesson-stage', '.lesson-stage:hover', '.lesson-stage[data-x]', '.lesson-stage, .y', '.lesson-stage.y']) {
    assert.equal(containerKey('base.css', sel), null, sel);
  }
  const [r] = rules('.lesson-stage { container: other / size; }');
  assert.deepEqual(decls(r.body).filter(([p]) => CONTAINER_PROP.test(p)), [['container', 'other / size']]);
});

test('T12 every container query names level; only the kit step (and the listed legacy stage) declares a container, as level / inline-size', () => {
  const seen = new Set();
  let queries = 0;
  for (const f of SHEETS) {
    for (const r of sheetRules(f)) {
      for (const a of r.at.filter((x) => x.startsWith('@container'))) {
        queries++;
        assert.match(a, /^@container level \(/, `styles/${f} "${a}": query the step's level container`);
      }
      for (const [prop, value] of decls(r.body)) {
        if (!CONTAINER_PROP.test(prop)) continue;
        const key = containerKey(f, r.selector) ?? `${f} ${r.selector}`;
        assert.ok(key === 'kit.css .ui-step' || CONTAINER_ALLOW.includes(key),
          `${key} declares a container; the step type decides the layout (STEP_TYPES[*].wide)`);
        assert.equal(`${prop}: ${value}`, 'container: level / inline-size', `${key} must be the level container, by the container shorthand`);
        seen.add(key);
      }
    }
  }
  assert.ok(queries >= 2, 'kit.css and widgets.css query the level container');
  assert.ok(seen.has('kit.css .ui-step'), 'the kit step declares the container');
  for (const key of CONTAINER_ALLOW) assert.ok(seen.has(key), `stale CONTAINER_ALLOW entry: ${key}`);
});

test('a chip never overflows its container: capped at the container width, and its text may wrap', () => {
  const chip = Object.fromEntries(sheetRules('kit.css').filter((r) => r.selector === '.ui-chip').flatMap((r) => decls(r.body)));
  assert.equal(chip['max-width'], '100%');
  assert.notEqual(chip['white-space'], 'nowrap', 'a long chip must be able to wrap');
  assert.equal(chip['overflow-wrap'], 'anywhere', 'and break inside a long word');
});

test('lesson code breaks inside a long token: the lesson card clips, so an unbreakable token would be cut off', () => {
  const pick = (sel) => Object.fromEntries(sheetRules('kit.css').filter((r) => r.selector === sel).flatMap((r) => decls(r.body)));
  assert.equal(pick('.ui-lesson').overflow, 'hidden', 'premise: the card clips');
  assert.equal(pick('.ui-lesson code')['overflow-wrap'], 'anywhere');
  assert.equal(pick('.ui-panel').overflow, 'hidden', 'premise: the panel clips too');
  assert.equal(pick('.ui-panel code')['overflow-wrap'], 'anywhere', 'a long trace id in a panel breaks instead of clipping');
});

test('palette rule 5: kit.css puts no shadow or glow on anything, only inset rings', () => {
  let rings = 0;
  for (const r of sheetRules('kit.css')) {
    for (const [prop, value] of decls(r.body)) {
      assert.ok(!/drop-shadow\(/.test(value), `kit.css ${r.selector} uses drop-shadow`);
      if (prop !== 'box-shadow' && prop !== 'text-shadow') continue;
      assert.equal(prop, 'box-shadow', `kit.css ${r.selector} uses text-shadow`);
      for (const part of splitTop(value)) {
        assert.ok(part === 'none' || part.startsWith('inset '), `kit.css ${r.selector} box-shadow "${part}" is not an inset ring`);
      }
      rings++;
    }
  }
  assert.ok(rings > 0, 'the pressed option ring is an inset box-shadow');
});

test('palette rule 7: a disabled toggle option fades (its only cue); answered choice cards do not', () => {
  const list = sheetRules('kit.css');
  const declsOf = (sel) => list.filter((r) => splitTop(r.selector).includes(sel)).flatMap((r) => decls(r.body));
  const toggle = Object.fromEntries(declsOf('.ui-option--toggle:disabled'));
  assert.equal(toggle.opacity, 'var(--opacity-disabled)', '.ui-option--toggle:disabled fades');
  assert.equal(toggle.cursor, 'not-allowed');
  for (const sel of ['.ui-option:disabled', '.ui-option--choice:disabled']) {
    assert.equal(declsOf(sel).some(([p]) => p === 'opacity'), false, `${sel} must not fade an answered card`);
  }
});

// ---- T6 only lib/ui emits ui- classes ----------------------------------------------------

test('class scanner: class attributes, className, setAttribute and classList; not :class or ${...}', () => {
  const src = [
    '`<b class="a ${x ? \'skip\' : \'\'} b">`',
    "`<i :class=\"open ? 'no' : ''\" x-bind:class=\"'no2'\" data-class=\"no3\">`",
    'el.className = `feedback ${cls} show`;',
    "el.classList.add('c1', 'c2'); el.classList.toggle(\"c3\", on);",
    "el.setAttribute('class', 'c4');",
  ].join('\n');
  assert.deepEqual([...emittedClasses(src)].sort(), ['a', 'b', 'c1', 'c2', 'c3', 'c4', 'feedback', 'show']);
});

const UI_LITERAL = /['"`]ui-[a-z][\w-]*/;

test('T6 only lib/ui/*.mjs emits ui- classes (index.html is the one static exception)', () => {
  assert.ok(APP_MODULES.includes('lib/play.mjs') && APP_MODULES.includes('lib/widgets/choice.mjs'));
  for (const f of APP_MODULES) {
    const src = read(f);
    const kit = [...emittedClasses(src)].filter((c) => c.startsWith('ui-'));
    assert.deepEqual(kit, [], `${f} writes kit classes by hand; build the markup with lib/ui helpers`);
    src.split('\n').forEach((line, i) => {
      assert.ok(!UI_LITERAL.test(line), `${f}:${i + 1} has a ui- class string; build it with lib/ui helpers: ${line.trim()}`);
    });
  }
});

// ---- T7 retired-class ratchet ------------------------------------------------------------

// Classes the kit replaces (docs/DESIGN-SYSTEM.md "Retired classes"). No new file may emit
// them; LEGACY lists what each file still emits today. A migration deletes its own entries
// (a stale entry fails), and the last phase asserts LEGACY is empty and deletes the CSS.
const RETIRED = [
  'back-btn', 'btn', 'bubble', 'build', 'build-btn', 'build-editing', 'build-group-title', 'build-layout',
  'build-log', 'build-logs', 'build-main', 'build-opt', 'build-pick', 'build-status', 'choice', 'choices', 'configure-inactive',
  'configure-input', 'configure-label', 'configure-more', 'configure-note', 'env-editor', 'env-label', 'env-note',
  'feedback', 'ghost', 'good', 'help-btn', 'help-chip', 'help-chips', 'help-chips-title', 'help-cost', 'help-count',
  'help-counts', 'help-h', 'help-hint-head', 'help-hint-row', 'help-hint-text', 'help-pips', 'help-rule',
  'help-score', 'help-side', 'help-star', 'help-stars', 'help-swirl', 'help-tier', 'help-win', 'help-win-closing',
  'help-win-stars', 'help-win-text', 'help-win-title', 'info', 'lesson-intro', 'lesson-stage', 'primary', 'q',
  'query-data', 'query-input', 'query-label', 'query-note', 'show', 'small', 'sort-bucket-btn', 'sort-hint',
  'sort-item', 'speech', 'spot-line', 'tradeoff-keeps', 'tradeoff-option',
];

const LEGACY = {
  'levels/baggage.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/checkout-is-slow.mjs': ['btn', 'lesson-intro', 'lesson-stage'],
  'levels/context-propagation.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/events-and-links.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/monitoring-vs-observability.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/naming-your-service.mjs': ['btn', 'env-editor', 'env-label', 'env-note', 'feedback', 'ghost', 'info', 'lesson-intro', 'lesson-stage', 'q', 'show', 'small'],
  'levels/span-kinds.mjs': ['btn', 'feedback', 'info', 'lesson-intro', 'lesson-stage', 'q', 'show'],
  'levels/spans-and-traces.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/status-and-errors.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/the-pager.mjs': ['btn', 'choice', 'choices', 'feedback', 'info', 'lesson-intro', 'lesson-stage', 'q', 'show'],
  'levels/the-signals.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'levels/why-opentelemetry.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'lib/widgets/configure-it-view.mjs': ['btn', 'configure-inactive', 'configure-input', 'configure-label', 'configure-more', 'configure-note', 'feedback', 'ghost', 'info', 'show', 'small'],
  'lib/widgets/trade-off-view.mjs': ['btn', 'feedback', 'show', 'tradeoff-keeps', 'tradeoff-option'],
};

test('T7 retired classes: only LEGACY files emit them, and LEGACY has no stale entry', () => {
  assert.deepEqual([...RETIRED].sort(), RETIRED, 'RETIRED stays sorted');
  assert.deepEqual(Object.keys(LEGACY).sort(), Object.keys(LEGACY), 'LEGACY stays sorted by file');
  const files = ['index.html', ...APP_MODULES];
  for (const f of Object.keys(LEGACY)) assert.ok(files.includes(f), `LEGACY names ${f}, which is not scanned or does not exist`);
  for (const f of files) {
    const emits = [...emittedClasses(read(f))].filter((c) => RETIRED.includes(c)).sort();
    const allowed = LEGACY[f] ?? [];
    for (const c of emits) assert.ok(allowed.includes(c), `${f} emits retired class "${c}"; use the kit (lib/ui)`);
    for (const c of allowed) assert.ok(emits.includes(c), `stale LEGACY entry: ${f} no longer emits "${c}"; delete it`);
  }
});

// ---- T13 contrast of the kit tokens, both themes ------------------------------------------

test('T13 lesson text, muted text and the eyebrow reach 4.5:1 on the card and its glow corner; lesson code on code-bg', () => {
  for (const theme of ['light', 'dark']) {
    const surface = resolveColor('var(--color-surface)', theme);
    const glow = overlay('--color-lesson-glow', '--color-surface', theme);
    for (const fg of ['--color-lesson', '--color-text-muted', '--color-lesson-eyebrow']) {
      const c = resolveColor(`var(${fg})`, theme);
      for (const [name, bg] of [['surface', surface], ['glow corner', glow]]) {
        const r = ratio(c, bg);
        assert.ok(r >= 4.5, `${theme}: ${fg} on the lesson ${name} is ${r.toFixed(2)}, needs 4.5`);
      }
    }
    const code = contrast('--color-lesson-code', '--color-code-bg', theme);
    assert.ok(code >= 4.5, `${theme}: --color-lesson-code on --color-code-bg is ${code.toFixed(2)}, needs 4.5`);
  }
  // The prototype's light eyebrow (#a8650f) fails, which is why the kit has its own ink.
  const proto = ratio([0xa8, 0x65, 0x0f], resolveColor('var(--color-surface)', 'light'));
  assert.ok(proto < 4.5, `prototype eyebrow is ${proto.toFixed(2)}`);
});

test('T13 meter cells left and the alert red reach 3:1 (non-text) on surface and bg, both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (const fg of ['--color-meter-left', '--color-alert']) {
      for (const bg of ['--color-surface', '--color-bg']) {
        const r = contrast(fg, bg, theme);
        assert.ok(r >= 3, `${theme}: ${fg} on ${bg} is ${r.toFixed(2)}, needs 3`);
      }
    }
  }
  // D1: the alert is red, apart from the purple error.
  for (const theme of ['light', 'dark']) {
    assert.notDeepEqual(resolveColor('var(--color-alert)', theme), resolveColor('var(--color-error)', theme), theme);
  }
});

// A row is matched by its compound selector (class wf-row plus the attribute test), in any
// quote or value form and under any ancestor, so `.wf .wf-row[data-other='true']` counts.
const FADED_ROWS = {
  overflow: (c) => c.classes.includes('wf-row') && c.attrs.some((a) => a.name === 'data-mark' && a.value === 'overflow'),
  other: (c) => c.classes.includes('wf-row') && c.attrs.some((a) => a.name === 'data-other'),
};
const subjects = (list) => list.flatMap((r) => splitTop(r.selector).map((s) => ({ cs: compounds(s), body: r.body })));
/** The lowest opacity a rule puts on the matched row itself (its last compound), so on every word in it. */
const rowAlpha = (list, isRow) => Math.min(1, ...subjects(list)
  .filter(({ cs }) => isRow(cs.at(-1)))
  .flatMap(({ body }) => decls(body)).filter(([p]) => p === 'opacity').map(([, v]) => Number(v)));
// The row parts that carry no text (styles/widgets.css, lib/widgets/build-it-view.mjs rowHtml
// and trackHtml): bars, connector lines, swatches, the grip, the elbow, grid lines and the
// verdict icon. Anything else inside a row may hold its words (.wf-txt, .wf-name, .wf-svc,
// .wf-track with its .wf-bar-label), so a fade on it fades text.
const NON_TEXT = ['wf-bar', 'wf-conn', 'wf-sw', 'wf-grip', 'wf-elbow', 'wf-grid', 'wf-mark'];
/**
 * The opacity possibly-text elements inside the matched row (row as a non-last compound) put on
 * its words. Opacity stacks, so a .wf-txt fade inside a .wf-name fade draws at their product:
 * this multiplies every such rule. Siblings that do not nest (.wf-txt and .wf-name side by side)
 * are over-counted, so the result can be lower than any real word, never higher: a nested fade
 * is never missed.
 */
const innerAlpha = (list, isRow) => subjects(list)
  .filter(({ cs }) => cs.slice(0, -1).some(isRow) && !cs.at(-1).classes.some((c) => NON_TEXT.includes(c)))
  .flatMap(({ body }) => decls(body)).filter(([p]) => p === 'opacity')
  .reduce((a, [, v]) => a * Number(v), 1);
/** What the row's text is drawn at: the row's own fade times the stacked fades on its text-bearing children. */
const textAlpha = (list, isRow) => rowAlpha(list, isRow) * innerAlpha(list, isRow);
/** Opacities put on a .wf-bar inside the matched row. */
const barOpacities = (list, isRow) => subjects(list)
  .filter(({ cs }) => cs.at(-1).classes.includes('wf-bar') && cs.slice(0, -1).some(isRow))
  .flatMap(({ body }) => decls(body)).filter(([p]) => p === 'opacity').map(([, v]) => Number(v));

test('T13 harness: a row fade is found in any quote, value or ancestor form; a fade on text inside the row counts; a bar fade does not', () => {
  for (const css of ['.wf-row[data-other="true"] { opacity: .35 }', ".wf-row[data-other='true'] { opacity: .35 }",
    '.wf .wf-row[data-other] { opacity: .35 }', '.wf-row[data-other]:hover { opacity: .35 }', '.wf-row[ data-other = true ] { opacity: .35 }']) {
    assert.equal(rowAlpha(rules(css), FADED_ROWS.other), 0.35, css);
  }
  for (const css of ['.wf-row[data-mark="overflow"] { opacity: .4 }', ".wf-row[data-mark='overflow'] { opacity: .4 }",
    '.wf-row[data-mark=overflow] { opacity: .4 }', '.wf > .wf-row[data-mark="overflow"] { opacity: .4 }', 'a, .wf-row[data-mark="overflow"] { opacity: .4 }']) {
    assert.equal(rowAlpha(rules(css), FADED_ROWS.overflow), 0.4, css);
  }
  for (const css of ['.wf-row[data-other] .wf-bar { opacity: .35 }', '.wf-row[data-mark="invalid"] { opacity: .3 }', '.wf-root[data-other] { opacity: .3 }']) {
    assert.equal(rowAlpha(rules(css), FADED_ROWS.other), 1, css);
    assert.equal(rowAlpha(rules(css), FADED_ROWS.overflow), 1, css);
  }
  // A fade on the text inside the row is a text fade, alone or on a shared rule with the marks.
  for (const css of ['.wf-row[data-other] .wf-bar, .wf-row[data-other] .wf-txt { opacity: .35 }',
    '.wf-row[data-other] .wf-name { opacity: .35 }', '.wf .wf-row[data-other] > .wf-track { opacity: .35 }']) {
    assert.equal(textAlpha(rules(css), FADED_ROWS.other), 0.35, css);
  }
  assert.equal(textAlpha(rules('.wf-row[data-mark="overflow"] { opacity: .5 } .wf-row[data-mark="overflow"] .wf-txt { opacity: .5 }'), FADED_ROWS.overflow), 0.25);
  // Nested fades stack: .9 on the text inside .9 on the name is drawn at .81, not the lower .9.
  assert.equal(textAlpha(rules('.wf-row[data-other] .wf-txt { opacity: .9 } .wf-row[data-other] .wf-name { opacity: .9 }'), FADED_ROWS.other), 0.81);
  for (const css of ['.wf-row[data-other] .wf-bar, .wf-row[data-other] .wf-conn, .wf-row[data-other] .wf-sw, .wf-row[data-other] .wf-grip { opacity: .35 }',
    '.wf-row[data-other] .wf-elbow, .wf-row[data-other] .wf-mark { opacity: .35 }', '.wf-txt { opacity: .35 }', '.wf-row[data-mark="invalid"] .wf-txt { opacity: .3 }']) {
    assert.equal(textAlpha(rules(css), FADED_ROWS.other), 1, css);
  }
  assert.deepEqual(barOpacities(rules(".wf .wf-row[data-other='1'] .wf-bar { opacity: .35 }"), FADED_ROWS.other), [0.35]);
  assert.deepEqual(barOpacities(rules('.wf-row[data-other] { opacity: .35 }'), FADED_ROWS.other), []);
});

// Deferred from the PR #164 review: a faded waterfall row (the overflow mark, another trace)
// faded the whole row, so its "its parent" text fell to about 2.2:1. The fade goes on the
// marks and bars; the row's text keeps 4.5:1 in both themes.
test('T13 faded waterfall rows fade the bars, not the text: row text keeps 4.5:1 on the board, both themes', () => {
  const list = sheetRules('widgets.css');
  for (const [row, isRow] of Object.entries(FADED_ROWS)) {
    const alpha = textAlpha(list, isRow);
    for (const theme of ['light', 'dark']) {
      for (const bg of ['--color-surface', '--color-bg']) {
        const under = resolveColor(`var(${bg})`, theme);
        for (const fg of ['--color-text', '--color-text-muted', '--color-parent']) {
          const seen = resolveColor(`var(${fg})`, theme).map((c, i) => c * alpha + under[i] * (1 - alpha));
          const r = ratio(seen, under);
          assert.ok(r >= 4.5, `${theme}: ${fg} in the ${row} row on ${bg} is ${r.toFixed(2)} (text opacity ${alpha}), needs 4.5`);
        }
      }
    }
    const bar = barOpacities(list, isRow);
    assert.ok(bar.length && Math.min(...bar) < 1, `the ${row} row still fades its bars, the non-text cue`);
  }
});

// ---- T14 tone colours never colour text -----------------------------------------------

const TONE = /var\(--color-(?:success|error|parent|note|alert)\)/;
const MARKER = /::?(?:before|after)\b|-ico\b|-mark\b/;

test('T14 kit.css sets color to a tone token only on markers (::before/::after, -ico, -mark)', () => {
  let markers = 0;
  for (const r of sheetRules('kit.css')) {
    for (const [prop, value] of decls(r.body)) {
      if (prop !== 'color' || !TONE.test(value)) continue;
      for (const sel of splitTop(r.selector)) {
        assert.ok(MARKER.test(sel), `kit.css "${sel}" colours text with ${value}; tone colours go on borders, icons and markers`);
      }
      markers++;
    }
  }
  assert.ok(markers > 0, 'the kit colours its markers by tone');
});

// ---- Prose evidence scrolls inside its card (#143) ---------------------------------------

test('prose tables scroll in the kit wrap, regions and the prose column can shrink', () => {
  const kit = sheetRules('kit.css');
  const props = (sel) => Object.fromEntries(kit.filter((r) => splitTop(r.selector).includes(sel)).flatMap((r) => decls(r.body)));
  assert.equal(props('.ui-table-wrap')['overflow-x'], 'auto', 'a wide evidence table scrolls instead of being clipped by the card');
  assert.equal(props('.ui-table-wrap')['max-width'], '100%');
  assert.notEqual(props('.ui-prose table').display, 'block', 'the table stays display: table at full width; prose() wraps it');
  assert.equal(props('.ui-prose table')['inline-size'], '100%');
  assert.equal(props('.ui-prose')['grid-template-columns'], 'minmax(0, 1fr)', 'a grid item would otherwise grow to the table width');
  assert.equal(props('.ui-prose')['min-width'], '0');
  assert.equal(props('.ui-table code')['overflow-wrap'], 'break-word', 'a token breaks only when it would overflow; anywhere would shrink the column min-content and split short tokens');
  assert.equal(props('.ui-prose table code')['overflow-wrap'], 'break-word');
  assert.equal(props('.ui-prose pre')['overflow-x'], 'auto');
  assert.equal(props('.ui-prose pre')['max-inline-size'], '100%');
  for (const sel of ['.ui-panel-sec > [data-region]', '.ui-panel-sec', '.ui-meter']) {
    assert.equal(props(sel)['grid-template-columns'], 'minmax(0, 1fr)', `${sel}: an implicit auto column grows to min-content and clips at 320px`);
  }
  assert.equal(props('.ui-meter-cells')['grid-auto-columns'], 'minmax(0, 1fr)');
});

test('a code input never soft-wraps: it keeps its lines and scrolls sideways', () => {
  const p = Object.fromEntries(sheetRules('kit.css').filter((r) => splitTop(r.selector).includes('.ui-input--code')).flatMap((r) => decls(r.body)));
  assert.equal(p['white-space'], 'pre');
  assert.equal(p['overflow-x'], 'auto');
  assert.equal(p['overflow-wrap'], 'normal', 'the card-wide anywhere rule must not break its lines');
});

// ---- Kit follow-ups (#176) ---------------------------------------------------------------

test('waiting and invalid waterfall rows fade bars and marks, never the row text', () => {
  const wf = sheetRules('widgets.css');
  const withOpacity = (r) => decls(r.body).some(([p]) => p === 'opacity');
  for (const state of ['[data-mark="invalid"]', '[data-waiting]']) {
    const row = `.wf-row${state}`;
    const own = wf.filter((r) => splitTop(r.selector).includes(row));
    assert.ok(own.length > 0, `${row} rule exists`);
    assert.ok(!own.some(withOpacity), `${row} must not set opacity on the row (text would drop below 4.5:1)`);
    const fade = wf.find((r) => withOpacity(r) && splitTop(r.selector).includes(`${row} .wf-bar`));
    assert.ok(fade, `${row} fades its bar`);
    for (const part of ['.wf-conn', '.wf-sw']) assert.ok(splitTop(fade.selector).includes(`${row} ${part}`), `${row} fades ${part}`);
  }
});

test('disabled legacy controls use the disabled-opacity token, not a literal', () => {
  const dis = sheetRules('base.css').filter((r) => /:disabled/.test(r.selector) && decls(r.body).some(([p]) => p === 'opacity'));
  assert.ok(dis.length >= 2, 'base.css still styles disabled controls');
  for (const r of dis) {
    assert.equal(decls(r.body).find(([p]) => p === 'opacity')[1], 'var(--opacity-disabled)', r.selector);
  }
});

test('the swirl ring and canvas do not depend on the legacy .help-swirl block', () => {
  assert.ok(!/help-swirl-ring/.test(stripComments(read('styles/base.css'))), 'base.css no longer styles the ring');
  const ring = sheetRules('widgets.css').find((r) => splitTop(r.selector).includes('.help-swirl-ring circle'));
  assert.ok(ring, 'widgets.css styles the ring dots');
  assert.deepEqual(decls(ring.body).find(([p]) => p === 'fill'), ['fill', 'currentColor']);
  assert.ok(!/help-swirl-canvas/.test(read('lib/swirl-render.mjs')), 'the unstyled canvas class is gone');
});
