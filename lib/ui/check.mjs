// Argument checks shared by the kit helpers (lib/ui, docs/DESIGN-SYSTEM.md). Every bad input
// throws a TypeError whose message starts with the helper's name. Text is escaped with
// escapeHtml; `*Html` values are trusted authored HTML and must be strings. DOM-free.

import { escapeHtml } from '../lesson-kit.mjs';

export const esc = escapeHtml;

/** A plain token: an element id, a data-* value used as a hook, a radio name. */
export const TOKEN = /^[A-Za-z][\w-]*$/;

export function fail(helper, msg) {
  throw new TypeError(`${helper}: ${msg}`);
}

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

/** `args` as an object with only the `allowed` keys (a typo is a bug, not a no-op). */
export function opts(helper, args, allowed) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) fail(helper, 'expects an options object');
  for (const k of Object.keys(args)) if (!allowed.includes(k)) fail(helper, `unknown option "${k}"`);
  return args;
}

/** ` id="..."` for a token id; '' when absent and `optional`. */
export function idAttr(helper, id, { optional = false } = {}) {
  if (id === undefined && optional) return '';
  return ` id="${token(helper, id, 'id')}"`;
}

/** A token, checked. */
export function token(helper, v, name) {
  if (typeof v !== 'string' || !TOKEN.test(v)) fail(helper, `${name} must be a plain token, got ${show(v)}`);
  return v;
}

/** Trusted authored HTML: a string (may be empty); undefined allowed when `optional`. */
export function html(helper, v, name, { optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string') fail(helper, `${name} must be an HTML string, got ${show(v)}`);
  return v;
}

/** Escaped text from a non-empty string or a finite number; undefined allowed when `optional`. */
export function text(helper, v, name, { optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  const ok = (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));
  if (!ok) fail(helper, `${name} must be non-empty text, got ${show(v)}`);
  return esc(v);
}

export function bool(helper, v, name) {
  if (typeof v !== 'boolean') fail(helper, `${name} must be true or false, got ${show(v)}`);
  return v;
}

export function oneOf(helper, v, list, name) {
  if (!list.includes(v)) fail(helper, `${name} must be one of ${list.join(', ')}, got ${show(v)}`);
  return v;
}

/** An integer in [min, max]. */
export function int(helper, v, name, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(v) || v < min || v > max) fail(helper, `${name} must be an integer from ${min}${max === Number.MAX_SAFE_INTEGER ? '' : ` to ${max}`}, got ${show(v)}`);
  return v;
}
