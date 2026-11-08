// Theme tokens, base styles and the theme helper. Spec: docs/FOUNDATION.md §6 F2.
// The CSS is read as text: the block parser, var() and color-mix() resolution and WCAG
// contrast live in test/helpers/css.mjs (plain JS, no CSS engine dependency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTheme, resolveTheme, writeTheme } from '../lib/theme.mjs';
import {
  call, contrast, decls, luminance, read, resolveColor, ROOT, ROOT_DECLS, rules, splitTop, stripComments,
  tokenRules, tokensCss, VARS,
} from './helpers/css.mjs';

test('brand primitives are the exact dash0.com values', () => {
  const brand = {
    '--d0-red': '#f8494d',
    '--d0-orange': '#fd6f40',
    '--d0-orange-soft': '#fd8c66',
    '--d0-grey-900': '#101010',
    '--d0-grey-800': '#212121',
    '--d0-grey-700': '#2c2c2c',
    '--d0-grey-600': '#424242',
    '--d0-grey-400': '#9e9e9e',
    '--d0-white': '#ffffff',
    '--d0-mint': '#a8fbbe',
    '--d0-purple': '#ad46ff',
  };
  for (const [name, hex] of Object.entries(brand)) {
    assert.equal(VARS[name]?.toLowerCase(), hex, name);
  }
});

test('every --color-* is light-dark(); dark by default, light by data-theme only', () => {
  const colors = ROOT_DECLS.filter(([k]) => k.startsWith('--color-'));
  assert.ok(colors.length >= 17, `expected the semantic set, got ${colors.length}`);
  for (const [name, value] of colors) {
    const inner = call('light-dark', value);
    assert.ok(inner !== null, `${name} is not light-dark(): ${value}`);
    assert.equal(splitTop(inner).length, 2, `${name} needs exactly <light>, <dark>`);
  }
  assert.deepEqual(ROOT_DECLS.filter(([k]) => k === 'color-scheme'), [['color-scheme', 'dark']]);
  const light = tokenRules.filter((r) => r.selector.includes('[data-theme="light"]'));
  assert.equal(light.length, 1, 'one [data-theme="light"] rule');
  assert.deepEqual(decls(light[0].body), [['color-scheme', 'light']]);
});

test('primary is red on both sides, success mint, error purple (not red, not primary)', () => {
  assert.equal(VARS['--color-primary'], 'light-dark(var(--d0-red), var(--d0-red))');
  // Success is mint on dark; on light it is mint darkened for contrast, still from mint.
  const [lightSuccess] = splitTop(call('light-dark', VARS['--color-success']));
  assert.match(lightSuccess, /var\(--d0-mint\)/);
  assert.equal(resolveColor('var(--color-success)', 'dark').join(), resolveColor('var(--d0-mint)', 'dark').join());
  for (const theme of ['light', 'dark']) {
    const at = (name) => resolveColor(`var(${name})`, theme).join();
    assert.equal(at('--color-error'), resolveColor('var(--d0-purple)', theme).join(), theme);
    assert.notEqual(at('--color-error'), at('--color-primary'), theme);
    assert.notEqual(at('--color-error'), resolveColor('var(--d0-red)', theme).join(), theme);
  }
});

test('WCAG AA: text and muted text on bg and surfaces, button text on primary, focus ring', () => {
  for (const theme of ['light', 'dark']) {
    for (const bg of ['--color-bg', '--color-surface', '--color-surface-2', '--color-code-bg']) {
      for (const fg of ['--color-text', '--color-text-muted']) {
        const r = contrast(fg, bg, theme);
        assert.ok(r >= 4.5, `${theme}: ${fg} on ${bg} is ${r.toFixed(2)}, needs 4.5`);
      }
    }
    const btn = contrast('--color-primary-contrast', '--color-primary', theme);
    assert.ok(btn >= 4.5, `${theme}: primary-contrast on primary is ${btn.toFixed(2)}`);
    const ring = contrast('--color-focus', '--color-bg', theme);
    assert.ok(ring >= 3, `${theme}: focus on bg is ${ring.toFixed(2)}, needs 3 (non-text)`);
  }
});

test('WCAG 1.4.11: success and error borders reach 3:1 on bg and surface, both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (const fg of ['--color-success', '--color-error']) {
      for (const bg of ['--color-bg', '--color-surface']) {
        const r = contrast(fg, bg, theme);
        assert.ok(r >= 3, `${theme}: ${fg} on ${bg} is ${r.toFixed(2)}, needs 3`);
      }
    }
  }
});

// base.css then widgets.css, in cascade order (the waterfall's .wf-* rules moved there, #158).
const baseRules = rules(read('styles/base.css') + read('styles/widgets.css'));
/** Declarations, in cascade order, of every base.css / widgets.css rule whose selector list has `sel`. */
const declsFor = (...sels) => sels.flatMap((sel) => baseRules
  .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(sel))
  .flatMap((r) => decls(r.body)));
const last = (list, prop) => list.filter(([k]) => k === prop).at(-1)?.[1];
const px = (v) => Number(/([\d.]+)px/.exec(v ?? '')?.[1] ?? NaN);
const SIDES = ['top', 'right', 'bottom', 'left'];

/** Padding and border width per side ({top, right, bottom, left}) after the cascade. */
function box(list) {
  const pad = {};
  const border = {};
  const four = (v) => {
    const [t, r = t, b = t, l = r] = v.split(/\s+/).map(px);
    return { top: t, right: r, bottom: b, left: l };
  };
  for (const [k, v] of list) {
    if (k === 'padding') Object.assign(pad, four(v));
    else if (k.startsWith('padding-')) pad[k.slice(8)] = px(v);
    else if (k === 'border') for (const s of SIDES) border[s] = px(v);
    else if (k === 'border-width') Object.assign(border, four(v));
    else if (/^border-\w+-width$/.test(k)) border[k.split('-')[1]] = px(v);
  }
  return Object.fromEntries(SIDES.map((s) => [s, pad[s] + border[s]]));
}

// The Choice cards and feedback are the kit's since #158 P1b (kit.css): an answered card is
// marked by data-state, the feedback tone by data-tone.
const kitRules = rules(read('styles/kit.css'));
/** Declarations, in cascade order, of every kit.css rule whose selector list has `sel`. */
const kitDecls = (...sels) => sels.flatMap((sel) => kitRules
  .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(sel))
  .flatMap((r) => decls(r.body)));
const CARD = ['.ui-option', '.ui-option--choice'];
const STATES = [['.ui-option[data-state="correct"]', '✓', 'Correct'], ['.ui-option[data-state="wrong"]', '✗', 'Wrong']];
const decode = (s) => s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

test('marking a choice does not move its content: padding + border is the same per side', () => {
  const plain = box(kitDecls(...CARD));
  for (const s of SIDES) assert.ok(plain[s] > 0, `.ui-option ${s} has padding and border`);
  for (const [sel] of STATES) {
    assert.deepEqual(box(kitDecls(...CARD, sel)), plain, `${sel} keeps the card's box`);
  }
});

test('correct and wrong choices carry non-colour cues: a spoken marker, and a ring or a strike', () => {
  for (const [sel, glyph, alt] of STATES) {
    const content = kitDecls(`${sel}::after`).filter(([k]) => k === 'content').map(([, v]) => decode(v));
    // Fallback first (browsers without alt text drop the second), then glyph / alt text.
    assert.deepEqual(content, [`"${glyph}"`, `"${glyph}" / "${alt}"`], `${sel}::after marker`);
  }
  // Second cues: correct gets an inset ring in the success colour, wrong a struck-through label.
  assert.match(last(kitDecls(STATES[0][0]), 'box-shadow') ?? '', /^inset 0 0 0 1px var\(--color-success\)$/);
  assert.equal(last(kitDecls(`${STATES[1][0]} .ui-option-label`), 'text-decoration'), 'line-through');
  // The success feedback says it with its icon (glyph and alt text), in the unmixed 3:1 token.
  const ico = '.ui-feedback[data-tone="success"] .ui-feedback-ico';
  assert.equal(last(kitDecls(ico), 'color'), 'var(--color-success)');
  assert.deepEqual(kitDecls(`${ico}::before`).filter(([k]) => k === 'content').map(([, v]) => decode(v)), ['"✓"', '"✓" / "Correct"']);
  assert.equal(last(kitDecls('.ui-feedback[data-tone="error"] .ui-feedback-ico'), 'color'), 'var(--color-error)');
});

test('the markers are visible and reach 3:1 over the answered card, both themes', () => {
  for (const [sel] of STATES) {
    const marker = kitDecls(`${sel}::after`);
    assert.notEqual(last(marker, 'display'), 'none', `${sel}::after is displayed`);
    for (const prop of ['visibility', 'opacity']) {
      assert.equal(last(marker, prop), undefined, `${sel}::after does not set ${prop}`);
    }
    const color = last(marker, 'color') ?? '';
    assert.match(color, /^var\(--color-[\w-]+\)$/, `${sel}::after colour is a token, not transparent`);
    // The card keeps its surface (palette rule 4: no tint over 8%); the marker sits on it.
    const fill = last(kitDecls(...CARD, sel), 'background') ?? '';
    assert.match(fill, /^var\(--color-[\w-]+\)$/, `${sel} background is an opaque token`);
    for (const theme of ['light', 'dark']) {
      const a = luminance(resolveColor(color, theme));
      const b = luminance(resolveColor(fill, theme));
      const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(r >= 3, `${theme}: ${sel} marker on its card is ${r.toFixed(2)}, needs 3`);
    }
  }
});

test('tokens live only in tokens.css: one :root rule plus the light rule', () => {
  const selectors = tokenRules.map((r) => r.selector).filter((s) => s !== '@font-face');
  assert.deepEqual(selectors, [':root', ':root[data-theme="light"]']);
  for (const f of readdirSync(join(ROOT, 'styles')).filter((n) => n.endsWith('.css'))) {
    if (f === 'tokens.css') continue;
    const hits = stripComments(read(`styles/${f}`)).match(/--(color|d0)-[\w-]+\s*:/g) ?? [];
    assert.deepEqual(hits, [], `styles/${f} declares tokens`);
  }
});

test('every color-mix() in tokens.css gives at most one percentage', () => {
  // Every color-mix( occurrence, nested ones included, cut at its balanced paren.
  const css = stripComments(tokensCss);
  const mixes = [...css.matchAll(/color-mix\(/g)].map(({ index }) => {
    let depth = 0;
    for (let i = index + 'color-mix'.length; i < css.length; i++) {
      if (css[i] === '(') depth++;
      else if (css[i] === ')' && --depth === 0) return css.slice(index, i + 1);
    }
    assert.fail(`unbalanced color-mix at ${index}`);
  });
  assert.ok(mixes.length > 0);
  for (const m of mixes) {
    const pcts = splitTop(call('color-mix', m)).filter((p) => /\s[\d.]+%$/.test(p));
    assert.ok(pcts.length <= 1, `two percentages need normalising, give one: ${m}`);
  }
});

test('no hex colours in styles/*.css outside tokens.css', () => {
  const files = readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css'));
  assert.ok(files.includes('base.css'));
  for (const f of files.filter((name) => name !== 'tokens.css')) {
    const hits = stripComments(read(`styles/${f}`)).match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    assert.deepEqual(hits, [], `hex in styles/${f}`);
  }
});

test('code, pre, kbd use Martian Mono, served from local /fonts/ files', () => {
  const resolveText = (value) =>
    value.replace(/var\((--[\w-]+)\)/g, (_, name) => resolveText(VARS[name] ?? ''));
  const mono = rules(read('styles/base.css')).find(
    (r) => r.selector.split(',').map((s) => s.trim()).sort().join() === 'code,kbd,pre',
  );
  assert.ok(mono, 'base.css has a `code, pre, kbd` rule');
  const family = Object.fromEntries(decls(mono.body))['font-family'] ?? '';
  assert.match(resolveText(family), /^"Martian Mono"/);

  const faces = rules(tokensCss + read('styles/base.css'))
    .filter((r) => r.selector === '@font-face')
    .map((r) => Object.fromEntries(decls(r.body)));
  assert.equal(faces.length, 2, 'exactly the regular and bold faces');
  const byWeight = Object.fromEntries(faces.map((f) => {
    assert.equal(f['font-family'], '"Martian Mono"');
    assert.equal(f['font-style'], 'normal');
    return [f['font-weight'], f.src];
  }));
  assert.deepEqual(byWeight, {
    400: 'url("/fonts/MartianMono-1.1.0-Regular.woff2") format("woff2")',
    700: 'url("/fonts/MartianMono-1.1.0-Bold.woff2") format("woff2")',
  });
  for (const file of ['MartianMono-1.1.0-Regular.woff2', 'MartianMono-1.1.0-Bold.woff2', 'OFL.txt']) {
    assert.ok(existsSync(join(ROOT, 'fonts', file)), `fonts/${file} exists`);
  }
});

test('resolveTheme: only "light" is light; anything else is dark', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  for (const v of [null, 'blue', undefined, 'LIGHT', 1]) assert.equal(resolveTheme(v), 'dark');
});

test('readTheme / writeTheme: storage round trip, and safe when storage fails', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readTheme(() => storage), 'dark');
  assert.equal(writeTheme(() => storage, 'light'), true);
  assert.equal(readTheme(() => storage), 'light');
  assert.equal(writeTheme(() => storage, 'blue'), true);
  assert.deepEqual([...store.values()], ['dark'], 'only a resolved theme is stored');
  store.set([...store.keys()][0], 'blue');
  assert.equal(readTheme(() => storage), 'dark', 'a bad stored value reads as dark');

  const boom = () => { throw new Error('SecurityError'); };
  assert.equal(readTheme(boom), 'dark');
  assert.equal(readTheme(() => ({ getItem: boom })), 'dark');
  assert.equal(writeTheme(() => ({ setItem: boom }), 'light'), false);
  assert.equal(writeTheme(boom, 'light'), false);
});

test('globe: legend text reaches 4.5:1 and the lit and pulse colours 3:1 on its night sky, both themes', () => {
  for (const theme of ['light', 'dark']) {
    assert.ok(contrast('--color-globe-text', '--color-globe-sky', theme) >= 4.5, `legend text, ${theme}`);
    for (const role of ['lit', 'pulse']) {
      assert.ok(contrast(`--color-globe-${role}`, '--color-globe-sky', theme) >= 3, `${role} on sky, ${theme}`);
    }
  }
  // The pulse must read apart from the lit glow, and not as brand red (an alarm).
  const [lit, pulse, red] = ['var(--color-globe-lit)', 'var(--color-globe-pulse)', 'var(--d0-red)'].map((v) => resolveColor(v, 'dark'));
  assert.notDeepEqual(pulse, lit);
  assert.notDeepEqual(pulse, red);
});

test('trace waterfall (#146): bar text on every service fill, trace chips, hint text and the success card reach AA, both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (let i = 0; i < 6; i++) {
      const r = contrast('--color-text', `--color-svc-${i}`, theme);
      assert.ok(r >= 4.5, `${theme}: text on --color-svc-${i} is ${r.toFixed(2)}, needs 4.5`);
    }
    for (const t of [0, 1]) {
      const r = contrast('--color-text', `--color-trace-${t}`, theme);
      assert.ok(r >= 4.5, `${theme}: text on --color-trace-${t} is ${r.toFixed(2)}, needs 4.5`);
    }
    for (const bg of ['--color-surface', '--color-bg']) {
      const hint = contrast('--color-hint', bg, theme);
      assert.ok(hint >= 4.5, `${theme}: hint text on ${bg} is ${hint.toFixed(2)}, needs 4.5`);
      // Used as text in styles/widgets.css (the "its parent" tag, the queue heading, the muted copy): 4.5.
      for (const fg of ['--color-parent', '--color-text-muted']) {
        const r = contrast(fg, bg, theme);
        assert.ok(r >= 4.5, `${theme}: text in ${fg} on ${bg} is ${r.toFixed(2)}, needs 4.5`);
      }
      // Marker only (the failed tick glyph): 3.
      const note = contrast('--color-note', bg, theme);
      assert.ok(note >= 3, `${theme}: --color-note on ${bg} is ${note.toFixed(2)}, needs 3 (markers and borders)`);
    }
    for (const fg of ['--color-win-text', '--color-win-muted']) {
      const r = contrast(fg, '--color-win-bg', theme);
      assert.ok(r >= 4.5, `${theme}: ${fg} on the success card is ${r.toFixed(2)}, needs 4.5`);
    }
  }
  // Six service fills, each its own colour, in each theme.
  for (const theme of ['light', 'dark']) {
    const fills = Array.from({ length: 6 }, (_, i) => resolveColor(`var(--color-svc-${i})`, theme).join());
    assert.equal(new Set(fills).size, 6, theme);
  }
});

test('parent-coloured text (the "its parent" tag, the queue heading) reaches 4.5:1 on the unfaded row fills (plain, hover, pressed, likely, valid, arriving), both themes', () => {
  for (const [sel, prop] of [['.wf-tag[data-tag="par"]', 'color'], ['.wf-queue-head strong', 'color']]) {
    assert.equal(last(declsFor(sel), prop), 'var(--color-parent)', `${sel} is set in --color-parent`);
  }
  // Each row state's background, read from widgets.css: a flat token or a token tint over transparent.
  const rowFills = ['.wf-row:hover', '.wf-row[aria-pressed="true"]', '.wf-row[data-mark="likely"]', '.wf-row[data-mark="valid"]', '.wf-row[data-arriving]']
    .map((sel) => [sel, last(declsFor(sel), 'background') ?? '']);
  for (const theme of ['light', 'dark']) {
    const fg = luminance(resolveColor('var(--color-parent)', theme));
    for (const under of ['--color-surface', '--color-bg']) {
      const u = resolveColor(`var(${under})`, theme);
      const fills = [[under, u], ['--color-surface-2', resolveColor('var(--color-surface-2)', theme)]];
      for (const [sel, bg] of rowFills) {
        const tint = /^color-mix\(in srgb, (var\(--color-[\w-]+\)) ([\d.]+)%, transparent\)$/.exec(bg);
        if (tint) fills.push([`${sel} on ${under}`, resolveColor(tint[1], theme).map((c, i) => c * tint[2] / 100 + u[i] * (1 - tint[2] / 100))]);
        else {
          assert.match(bg, /^var\(--color-[\w-]+\)$/, `${sel} background is a token or a token tint`);
          fills.push([sel, resolveColor(bg, theme)]);
        }
      }
      for (const [name, rgb] of fills) {
        const b = luminance(rgb);
        const r = (Math.max(fg, b) + 0.05) / (Math.min(fg, b) + 0.05);
        assert.ok(r >= 4.5, `${theme}: --color-parent text on ${name} is ${r.toFixed(2)}, needs 4.5`);
      }
    }
  }
});

test('reward stars (#178): the glyph colour comes from a token and reaches 3:1 on the card, both themes', () => {
  const rule = rules(read('styles/hub.css')).find((r) => r.selector.split(',').map((s) => s.trim()).includes('.reward-card .reward-stars'));
  assert.ok(rule, '.reward-card .reward-stars rule');
  const colour = decls(rule.body).filter(([k]) => k === 'color').at(-1)?.[1];
  const token = /^var\((--color-[\w-]+)\)$/.exec(colour ?? '')?.[1];
  assert.ok(token, `the stars take a --color-* token, not ${colour}`);
  for (const theme of ['light', 'dark']) {
    for (const bg of ['--color-surface', '--color-bg']) {
      const r = contrast(token, bg, theme);
      assert.ok(r >= 3, `${theme}: reward stars (${token}) on ${bg} are ${r.toFixed(2)}, need 3`);
    }
  }
});

test('every star display (#221): each star rule takes a --color-* token and reaches 3:1 on its background, both themes', () => {
  // Every rule in styles/ whose selector names a star, except the win-card star line: that is
  // muted text on the success card, held to 4.5 in the trace-waterfall test above.
  const all = readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css')).flatMap((f) => rules(read(`styles/${f}`)));
  const starRules = all.filter((r) => r.selector.split(',').some((s) => /star/.test(s) && !/win-stars/.test(s)));
  const sels = starRules.map((r) => r.selector);
  for (const want of ['.star-count span:first-child', '.level-stars', '.reward-card .reward-stars', '.ui-star path']) {
    assert.ok(sels.some((s) => s.split(',').map((x) => x.trim()).includes(want)), `${want} is checked`);
  }
  let checked = 0;
  for (const r of starRules) {
    for (const [prop, value] of decls(r.body).filter(([k]) => ['color', 'fill', 'stroke'].includes(k))) {
      if (value === 'none' || value === 'currentColor') continue;
      const tint = /^color-mix\(in srgb, (var\(--color-[\w-]+\)) ([\d.]+)%, transparent\)$/.exec(value);
      assert.ok(tint || /^var\(--color-[\w-]+\)$/.test(value), `${r.selector} ${prop} is a token, not ${value}`);
      for (const theme of ['light', 'dark']) {
        for (const bg of ['--color-surface', '--color-bg']) {
          const u = resolveColor(`var(${bg})`, theme);
          const fg = tint ? resolveColor(tint[1], theme).map((c, i) => c * tint[2] / 100 + u[i] * (1 - tint[2] / 100)) : resolveColor(value, theme);
          const [a, b] = [luminance(fg), luminance(u)];
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          assert.ok(ratio >= 3, `${theme}: ${r.selector} ${prop} ${value} on ${bg} is ${ratio.toFixed(2)}, needs 3`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 20, `expected the star rules, checked ${checked}`);
});
