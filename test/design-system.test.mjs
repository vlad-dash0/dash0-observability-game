// Design-system guards (#158, docs/DESIGN-SYSTEM.md "Guards"): T1-T7, T13, T14 and the
// no-glow rule. Stylesheets and sources are read as text (test/helpers/css.mjs). Allow lists
// and LEGACY only shrink: each migration deletes its entries, the last asserts them empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classesInSelector, contrast, decls, emittedClasses, overlay, ratio, read, resolveColor, rules,
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

// Shrinks only: P1b deletes .overlay:has(.build) and this entry.
const HAS_ALLOW = ['hub.css .overlay:has(.build)'];

test('T5 no :has() (listed legacy only) and no !important outside reduced motion and [x-cloak]', () => {
  const seen = new Set();
  for (const f of SHEETS) {
    for (const r of sheetRules(f)) {
      if (r.selector.includes(':has(')) {
        const key = `${f} ${r.selector}`;
        assert.ok(HAS_ALLOW.includes(key), `${key}: no :has(); give the element a class or a data-* state`);
        seen.add(key);
      }
      const reduced = r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a));
      for (const [prop, value] of decls(r.body)) {
        if (!value.includes('!important')) continue;
        assert.ok(reduced || r.selector === '[x-cloak]', `styles/${f} ${r.selector} { ${prop}: ${value} } uses !important`);
      }
    }
  }
  for (const key of HAS_ALLOW) assert.ok(seen.has(key), `stale HAS_ALLOW entry: ${key}`);
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
  'build-log', 'build-main', 'build-opt', 'build-pick', 'build-status', 'choice', 'choices', 'configure-inactive',
  'configure-input', 'configure-label', 'configure-more', 'configure-note', 'env-editor', 'env-label', 'env-note',
  'feedback', 'ghost', 'good', 'help-btn', 'help-chip', 'help-chips', 'help-chips-title', 'help-cost', 'help-count',
  'help-counts', 'help-h', 'help-hint-head', 'help-hint-row', 'help-hint-text', 'help-pips', 'help-rule',
  'help-score', 'help-side', 'help-star', 'help-stars', 'help-swirl', 'help-tier', 'help-win', 'help-win-closing',
  'help-win-stars', 'help-win-text', 'help-win-title', 'info', 'lesson-intro', 'lesson-stage', 'primary', 'q',
  'query-data', 'query-input', 'query-label', 'query-note', 'show', 'small', 'sort-bucket-btn', 'sort-hint',
  'sort-item', 'speech', 'spot-line', 'tradeoff-keeps', 'tradeoff-option',
];

const LEGACY = {
  'index.html': ['back-btn', 'btn'],
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
  'lib/lesson-kit.mjs': ['bubble', 'speech'],
  'lib/play.mjs': ['btn', 'lesson-intro', 'lesson-stage', 'q'],
  'lib/widgets/build-it-view.mjs': ['build', 'build-btn', 'build-editing', 'build-group-title', 'build-layout', 'build-log', 'build-main', 'build-opt', 'build-pick', 'build-status', 'feedback', 'help-hint-head', 'help-pips', 'primary', 'show'],
  'lib/widgets/choice.mjs': ['choice', 'choices', 'feedback', 'show'],
  'lib/widgets/configure-it-view.mjs': ['btn', 'configure-inactive', 'configure-input', 'configure-label', 'configure-more', 'configure-note', 'feedback', 'ghost', 'info', 'show', 'small'],
  'lib/widgets/help-ladder.mjs': ['help-btn', 'help-chip', 'help-chips', 'help-chips-title', 'help-cost', 'help-count', 'help-counts', 'help-h', 'help-hint-row', 'help-hint-text', 'help-rule', 'help-score', 'help-side', 'help-star', 'help-stars', 'help-swirl', 'help-tier', 'help-win', 'help-win-closing', 'help-win-stars', 'help-win-text', 'help-win-title'],
  'lib/widgets/incident-view.mjs': ['feedback', 'show'],
  'lib/widgets/query-it-view.mjs': ['btn', 'feedback', 'ghost', 'info', 'query-data', 'query-input', 'query-label', 'query-note', 'show', 'small'],
  'lib/widgets/sort-it-view.mjs': ['feedback', 'show', 'sort-bucket-btn', 'sort-hint', 'sort-item'],
  'lib/widgets/spot-it-view.mjs': ['btn', 'feedback', 'show', 'spot-line'],
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
