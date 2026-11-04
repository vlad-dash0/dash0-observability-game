// Theme tokens, base styles and the theme helper. Spec: docs/FOUNDATION.md §6 F2.
// The CSS is read as text: a tiny block parser, var() and color-mix() resolution and
// WCAG contrast are done here in plain JS (no CSS engine dependency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTheme, resolveTheme, writeTheme } from '../lib/theme.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat list of {selector, body} for every innermost rule (at-rule wrappers unwrapped). */
function rules(css) {
  const out = [];
  const walk = (src) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open === -1) break;
      let depth = 1;
      let j = open + 1;
      for (; j < src.length && depth; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
      }
      const selector = src.slice(i, open).replace(/^[\s\S]*;/, '').trim();
      const body = src.slice(open + 1, j - 1);
      if (body.includes('{')) walk(body);
      else out.push({ selector, body });
      i = j;
    }
  };
  walk(stripComments(css));
  return out;
}

/** Declarations of a rule body as [prop, value] pairs (order kept). */
function decls(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const k = d.indexOf(':');
    return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
  });
}

/** Split on commas at parenthesis depth 0. */
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

/** Inner text of a single `name(...)` call spanning the whole value, else null. */
function call(name, value) {
  const v = value.trim();
  return v.startsWith(`${name}(`) && v.endsWith(')') ? v.slice(name.length + 1, -1) : null;
}

const tokensCss = read('styles/tokens.css');
const tokenRules = rules(tokensCss);
const rootRule = tokenRules.find((r) => r.selector === ':root');
const ROOT_DECLS = rootRule ? decls(rootRule.body) : [];
const VARS = Object.fromEntries(ROOT_DECLS.filter(([k]) => k.startsWith('--')));

/** Resolve a value to [r,g,b] (0-255) for one theme, following var() and light-dark(). */
function resolveColor(value, theme, seen = new Set()) {
  const v = value.trim();
  const ref = call('var', v);
  if (ref !== null) {
    const name = splitTop(ref)[0];
    assert.ok(!seen.has(name), `var() cycle at ${name}`);
    assert.ok(name in VARS, `undefined token ${name}`);
    return resolveColor(VARS[name], theme, new Set(seen).add(name));
  }
  const ld = call('light-dark', v);
  if (ld !== null) {
    const [light, dark] = splitTop(ld);
    return resolveColor(theme === 'light' ? light : dark, theme, seen);
  }
  const mix = call('color-mix', v);
  if (mix !== null) {
    const [space, a, b] = splitTop(mix);
    assert.equal(space, 'in srgb', `only srgb color-mix is resolved: ${v}`);
    const part = (p) => {
      const m = p.match(/^(.*?)\s+([\d.]+)%$/);
      return m ? [m[1], Number(m[2]) / 100] : [p, null];
    };
    const [ca, pa] = part(a);
    const [cb, pb] = part(b);
    assert.ok(pa === null || pb === null, `give one percentage only (no normalising): ${v}`);
    const wa = pa ?? (pb === null ? 0.5 : 1 - pb);
    const A = resolveColor(ca, theme, seen);
    const B = resolveColor(cb, theme, seen);
    return A.map((x, i) => x * wa + B[i] * (1 - wa));
  }
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  assert.ok(hex, `cannot resolve colour value: ${v}`);
  return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg, theme) {
  const a = luminance(resolveColor(`var(${fg})`, theme));
  const b = luminance(resolveColor(`var(${bg})`, theme));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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

const baseRules = rules(read('styles/base.css'));
/** Declarations, in cascade order, of every base.css rule whose selector list has `sel`. */
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

test('marking a choice does not move its content: padding + border is the same per side', () => {
  const plain = box(declsFor('.choice'));
  for (const s of SIDES) assert.ok(plain[s] > 0, `.choice ${s} has padding and border`);
  for (const sel of ['.choice.correct', '.choice.wrong']) {
    assert.deepEqual(box(declsFor('.choice', sel)), plain, `${sel} keeps the .choice box`);
  }
});

test('correct and wrong choices carry a non-colour cue: a marker and a thicker border', () => {
  const plain = px(last(declsFor('.choice'), 'border'));
  assert.ok(plain > 0, '.choice has a px border');
  const decode = (s) => s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  for (const [sel, glyph, alt] of [['.choice.correct', '✓', 'correct'], ['.choice.wrong', '✗', 'wrong']]) {
    assert.ok(px(last(declsFor(sel), 'border-width')) > plain, `${sel} border is thicker than .choice`);
    const content = declsFor(`${sel}::after`).filter(([k]) => k === 'content').map(([, v]) => decode(v));
    // Fallback first (browsers without alt text drop the second), then glyph / alt text.
    assert.deepEqual(content, [`"${glyph}"`, `"${glyph}" / "${alt}"`], `${sel}::after marker`);
  }
  // The 3:1 success token only helps if the border uses it unmixed.
  assert.match(last(declsFor('.feedback.good'), 'border') ?? '', /^\d+px solid var\(--color-success\)$/);
});

test('the markers are visible and reach 3:1 over the tinted choice fill, both themes', () => {
  for (const sel of ['.choice.correct', '.choice.wrong']) {
    const marker = declsFor(`${sel}::after`);
    assert.notEqual(last(marker, 'display'), 'none', `${sel}::after is displayed`);
    for (const prop of ['visibility', 'opacity']) {
      assert.equal(last(marker, prop), undefined, `${sel}::after does not set ${prop}`);
    }
    const color = last(marker, 'color') ?? '';
    assert.match(color, /^var\(--color-[\w-]+\)$/, `${sel}::after colour is a token, not transparent`);
    const fill = /^color-mix\(in srgb, (var\(--color-[\w-]+\)) ([\d.]+)%, transparent\)$/
      .exec(last(declsFor('.choice', sel), 'background') ?? '');
    assert.ok(fill, `${sel} background is a token tint over transparent`);
    for (const theme of ['light', 'dark']) {
      for (const under of ['--color-bg', '--color-surface']) {
        const u = resolveColor(`var(${under})`, theme);
        const tint = resolveColor(fill[1], theme).map((c, i) => c * fill[2] / 100 + u[i] * (1 - fill[2] / 100));
        const a = luminance(resolveColor(color, theme));
        const b = luminance(tint);
        const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(r >= 3, `${theme}: ${sel} marker over its fill on ${under} is ${r.toFixed(2)}, needs 3`);
      }
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
      // Used as text in styles/base.css (the "its parent" tag, the queue heading, the muted copy): 4.5.
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
