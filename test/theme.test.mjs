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
  for (const theme of ['light', 'dark']) {
    const at = (name) => resolveColor(`var(${name})`, theme).join();
    assert.equal(at('--color-success'), resolveColor('var(--d0-mint)', theme).join(), theme);
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

  const faces = rules(tokensCss + read('styles/base.css')).filter((r) =>
    /font-family:\s*"Martian Mono"/.test(r.body) && /\bsrc:/.test(r.body));
  assert.ok(faces.length >= 2, 'regular and bold @font-face');
  for (const face of faces) {
    const urls = [...face.body.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
    assert.ok(urls.length > 0);
    for (const url of urls) {
      assert.match(url, /^\/fonts\/MartianMono-[\w-]+\.woff2$/);
      assert.ok(existsSync(join(ROOT, url)), `${url} exists`);
    }
  }
  assert.ok(existsSync(join(ROOT, 'fonts/OFL.txt')), 'OFL licence ships with the fonts');
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
