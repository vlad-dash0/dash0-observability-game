// Stylesheets read as text for the theme and design-system guards (test/theme.test.mjs,
// test/design-system.test.mjs, test/ui.test.mjs): a tiny block parser, var() /
// color-mix() resolution, WCAG contrast, and class scanners for CSS
// selectors and for markup in .mjs and .html sources. Plain JS, no CSS engine.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Repo-relative paths of the files under `dir` ending in one of `exts` (no dotfiles, no node_modules). */
export function walk(dir, exts) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out.sort();
}

/** The stylesheets in styles/, by file name. */
export const styleFiles = () => readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css')).sort();

/**
 * Flat list of {selector, body, at} for every innermost rule; `at` lists the enclosing
 * at-rule preludes (outermost first), e.g. ['@media (prefers-reduced-motion: reduce)'].
 */
export function rules(css) {
  const out = [];
  const walkBlock = (src, at) => {
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
      if (body.includes('{')) walkBlock(body, [...at, selector]);
      else out.push({ selector, body, at });
      i = j;
    }
  };
  walkBlock(stripComments(css), []);
  return out;
}

/** Declarations of a rule body as [prop, value] pairs (order kept). */
export function decls(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const k = d.indexOf(':');
    return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
  });
}

/** Split on commas at parenthesis depth 0. */
export function splitTop(s) {
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
export function call(name, value) {
  const v = value.trim();
  return v.startsWith(`${name}(`) && v.endsWith(')') ? v.slice(name.length + 1, -1) : null;
}

export const tokensCss = read('styles/tokens.css');
export const tokenRules = rules(tokensCss);
const rootRule = tokenRules.find((r) => r.selector === ':root');
export const ROOT_DECLS = rootRule ? decls(rootRule.body) : [];
/** Every custom property tokens.css declares on :root, name -> value. */
export const VARS = Object.fromEntries(ROOT_DECLS.filter(([k]) => k.startsWith('--')));

/** Resolve a value to [r,g,b] (0-255), following var() and color-mix(). The game is dark only (#322). */
export function resolveColor(value, seen = new Set()) {
  const v = value.trim();
  const ref = call('var', v);
  if (ref !== null) {
    const name = splitTop(ref)[0];
    assert.ok(!seen.has(name), `var() cycle at ${name}`);
    assert.ok(name in VARS, `undefined token ${name}`);
    return resolveColor(VARS[name], new Set(seen).add(name));
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
    const A = resolveColor(ca, seen);
    const B = resolveColor(cb, seen);
    return A.map((x, i) => x * wa + B[i] * (1 - wa));
  }
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  assert.ok(hex, `cannot resolve colour value: ${v}`);
  return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
}

/**
 * A see-through token (`color-mix(in srgb, <colour> p%, transparent)`, possibly behind
 * var()) laid over the opaque `under` token, as [r,g,b].
 */
export function overlay(token, under) {
  let v = `var(${token})`;
  for (;;) {
    const ref = call('var', v);
    if (ref !== null) {
      v = VARS[splitTop(ref)[0]];
      continue;
    }
    break;
  }
  const m = /^color-mix\(in srgb, (.+) ([\d.]+)%, transparent\)$/.exec(v.trim());
  assert.ok(m, `${token} is not a tint over transparent: ${v}`);
  const top = resolveColor(m[1]);
  const u = resolveColor(`var(${under})`);
  const a = Number(m[2]) / 100;
  return top.map((c, i) => c * a + u[i] * (1 - a));
}

export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast of two [r,g,b] colours. */
export function ratio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** WCAG contrast of tokens `fg` on `bg`. */
export const contrast = (fg, bg) => ratio(resolveColor(`var(${fg})`), resolveColor(`var(${bg})`));

/** Class names a selector (or selector list) mentions, outside attribute brackets and strings. */
export function classesInSelector(selector) {
  const bare = selector.replace(/"[^"]*"|'[^']*'/g, '').replace(/\[[^\]]*\]/g, '');
  return [...bare.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}

/** Every class some selector in `files` (default: every stylesheet in styles/) mentions. */
export function definedClasses(files = styleFiles().map((f) => `styles/${f}`)) {
  const out = new Set();
  for (const f of files) for (const r of rules(read(f))) for (const c of classesInSelector(r.selector)) out.add(c);
  return out;
}

const CLASS_TOKEN = /^-?[A-Za-z_][\w-]*$/;
/** Literal class tokens of an attribute value: `${...}` parts (nested too) are dropped first. */
function tokensOf(value) {
  let v = value;
  for (let prev = ''; prev !== v;) {
    prev = v;
    v = v.replace(/\$\{[^{}]*\}/g, ' ');
  }
  return v.split(/\s+/).filter((t) => CLASS_TOKEN.test(t));
}

/**
 * Class names a source emits literally: `class="..."` / `class='...'` attributes (not
 * `:class` or `x-bind:class`), `className =` and `setAttribute('class', ...)` string
 * values, and string arguments of `classList.add/toggle/replace`. Parts built from `${...}`
 * are skipped, so a class picked from a variable is not seen (a static scan, not proof).
 */
export function emittedClasses(src) {
  const out = new Set();
  const add = (v) => tokensOf(v).forEach((t) => out.add(t));
  for (const m of src.matchAll(/(?<![\w:.-])class=(?:"([^"]*)"|'([^']*)')/g)) add(m[1] ?? m[2]);
  for (const m of src.matchAll(/\.className\s*=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) add(m[1] ?? m[2] ?? m[3]);
  for (const m of src.matchAll(/setAttribute\(\s*['"]class['"]\s*,\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) add(m[1] ?? m[2] ?? m[3]);
  for (const m of src.matchAll(/classList\.(?:add|toggle|replace)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) add(s[1] ?? s[2] ?? s[3]);
  }
  return out;
}

/**
 * One complex selector (no top-level commas) as its compound selectors, left to right, split
 * on the descendant, child and sibling combinators outside brackets, parens and strings.
 * Each compound is {classes, attrs, pseudos}; an attribute is {name, op, value} with the
 * quotes taken off the value (op and value are null for a bare `[name]`).
 */
export function compounds(selector) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (const ch of selector.trim()) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '[' || ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ']' || ch === ')') {
      depth--;
      cur += ch;
    } else if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (cur) parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((c) => {
    const attrs = [...c.matchAll(/\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(?:[is]\s*)?)?\]/g)]
      .map((m) => ({ name: m[1], op: m[2] ?? null, value: m[3] ?? m[4] ?? m[5] ?? null }));
    const bare = c.replace(/"[^"]*"|'[^']*'/g, '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
    return {
      classes: [...bare.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]),
      attrs,
      pseudos: [...bare.matchAll(/::?(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]),
    };
  });
}
