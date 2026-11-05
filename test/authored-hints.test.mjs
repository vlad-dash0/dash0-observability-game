// Authored tier-1 hints (#190): every Sort it and Spot it step with hints on declares its own
// `hint`, tier 1 shows exactly that (not the generic SORT_RULE / SPOT_RULE), the hint does not
// give the answer away, and it is inline HTML, because tier 1 wraps it in a <p>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';
import { SORT_RULE, hintFor as sortHint, sortHelps } from '../lib/widgets/sort-it-help.mjs';
import { newSpotState } from '../lib/widgets/spot-it.mjs';
import { SPOT_RULE, hintFor as spotHint, spotHelps } from '../lib/widgets/spot-it-help.mjs';

// The hints-on steps (test/sort-ladder.test.mjs and test/spot-ladder.test.mjs pin the ladders).
const SORT_ON = ['0.1 mvo-sort', '0.2 sig-ask', '0.2 sig-data', '0.3 otel-parts', '1.1 res-sort', '2.3 status-sort'];
const SPOT_ON = ['3.2 temp-spot', '3.5 cdn-spot', '3.6 exm-spot'];

/** Every { no, spec } of kind 'sort' or 'spot', deduplicated by spec id, from the live registry. */
async function specsOf(kind) {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const byId = new Map();
      for (const s of [...(mod.default.play?.steps ?? []), ...(mod.CONTENT?.steps ?? [])]) if (s?.[kind]) byId.set(s[kind].id, s[kind]);
      for (const spec of byId.values()) out.push({ no: mod.default.no, spec, key: `${mod.default.no} ${spec.id}` });
    }
  }
  return out;
}

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
/** Text as a player reads it out: `_`, `.` and `-` are spaces, so `user_id` and "user id" are one name. */
const spoken = (text) => text.replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `needle` in `hay` as a whole word or phrase, case-insensitive (bounded by anything but a letter, digit, _ or -). */
const mentions = (hay, needle) => new RegExp(`(?<![A-Za-z0-9_-])${escRe(needle)}(?![A-Za-z0-9_-])`, 'i').test(hay);

// Inline HTML only: tier 1 wraps the hint in <p>, and a block element inside a <p> breaks it.
const INLINE = new Set(['code', 'b', 'i', 'em', 'strong', 'span', 'kbd']);
const tagsOf = (html) => [...html.matchAll(/<\/?\s*([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1].toLowerCase());

test('the hints-on Sort and Spot steps are exactly the ones listed here', async () => {
  const sortOn = (await specsOf('sort')).filter(({ spec }) => sortHelps(spec).hints).map((s) => s.key).sort();
  const spotOn = (await specsOf('spot')).filter(({ spec }) => spotHelps(spec).hints).map((s) => s.key).sort();
  assert.deepEqual(sortOn, [...SORT_ON].sort());
  assert.deepEqual(spotOn, [...SPOT_ON].sort());
});

test('every hints-on Sort step declares an authored hint, and tier 1 shows that hint, not the generic rule', async () => {
  const missing = [];
  for (const { key, spec } of await specsOf('sort')) {
    if (!sortHelps(spec).hints) continue;
    if (typeof spec.hint !== 'string' || spec.hint.trim() === '') {
      missing.push(key);
      continue;
    }
    const { html } = sortHint(spec, newSortState(spec), spec.items[0].id, 1);
    assert.equal(html, `<p>${spec.hint}</p>`, key);
    assert.equal(html.includes(SORT_RULE), false, `${key}: not the generic rule`);
  }
  assert.deepEqual(missing, [], 'hints-on Sort steps with no authored hint');
});

test('every hints-on Spot step declares an authored hint, and tier 1 shows that hint, not the generic rule', async () => {
  const missing = [];
  for (const { key, spec } of await specsOf('spot')) {
    if (!spotHelps(spec).hints) continue;
    if (typeof spec.hint !== 'string' || spec.hint.trim() === '') {
      missing.push(key);
      continue;
    }
    const { html } = spotHint(spec, newSpotState(spec), 1);
    assert.equal(html, `<p>${spec.hint}</p>`, key);
    assert.equal(html.includes(SPOT_RULE), false, `${key}: not the generic rule`);
  }
  assert.deepEqual(missing, [], 'hints-on Spot steps with no authored hint');
});

test('the authored hints are inline HTML: no block tags, since tier 1 wraps them in <p>', async () => {
  const bad = {};
  for (const kind of ['sort', 'spot']) {
    for (const { key, spec } of await specsOf(kind)) {
      if (spec.hint === undefined) continue;
      const block = tagsOf(spec.hint).filter((t) => !INLINE.has(t));
      if (block.length) bad[key] = block;
    }
  }
  assert.deepEqual(bad, {});
});

// A Sort hint is for the whole board, so it must not name a bucket (its visible label, or its
// id where the id is not simply a word of that label), use a label word that tells the buckets
// apart (right/wrong in "Status is right"/"Status is wrong"; a word every label shares, like
// "Status", tells nothing), or quote an item.
test('no Sort hint names a bucket, uses a word that tells the bucket labels apart, or quotes an item', async () => {
  const leaks = {};
  for (const { key, spec } of await specsOf('sort')) {
    if (spec.hint === undefined) continue;
    const text = plain(spec.hint);
    const found = [];
    for (const b of spec.buckets) {
      const label = plain(b.label);
      if (mentions(text, label)) found.push(`bucket label "${label}"`);
      const labelWords = label.toLowerCase().split(/[^a-z0-9]+/);
      if (!labelWords.includes(b.id.toLowerCase()) && mentions(text, b.id)) found.push(`bucket id "${b.id}"`);
    }
    const wordsOf = (b) => new Set(spoken(plain(b.label)).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const labelSets = spec.buckets.map(wordsOf);
    for (const w of new Set(labelSets.flatMap((ws) => [...ws]))) {
      if (!labelSets.every((ws) => ws.has(w)) && mentions(spoken(text), w)) found.push(`label word "${w}"`);
    }
    for (const it of spec.items) if (text.toLowerCase().includes(plain(it.label).toLowerCase())) found.push(`item "${plain(it.label)}"`);
    if (found.length) leaks[key] = [...new Set(found)];
  }
  assert.deepEqual(leaks, {});
});

/**
 * What names a line, read out (spoken): its leading token (a timestamp, a metric or pipeline
 * name), its quoted values and its label/attribute keys.
 * `09:14:15 payments.charge.duration{...}` -> 09:14:15; `x{user_id="u-31402"}` -> x, user id, u 31402.
 */
const marks = (text) => [
  text.match(/^[^\s{(\[]+/)?.[0].replace(/[:,]+$/, ''),
  ...[...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  ...[...text.matchAll(/([A-Za-z_][\w.]*)\s*=/g)].map((m) => m[1]),
].filter(Boolean).map(spoken).filter(Boolean);

// A Spot hint must not point at an answer line: not its text, not its id (as written, or with
// _ for -), and not a leading token, quoted value or key that only answer lines have (a
// timestamp, delta, user_id ...), written as in the line or in plain words ("the user id").
test('no Spot hint names an answer line, its id, or a timestamp, name, value or key only the answers carry', async () => {
  const leaks = {};
  for (const { key, spec } of await specsOf('spot')) {
    if (spec.hint === undefined) continue;
    const text = plain(spec.hint);
    const faults = spec.lines.filter((l) => spec.faults.includes(l.id));
    const decoyMarks = new Set(spec.lines.filter((l) => !spec.faults.includes(l.id)).flatMap((l) => marks(l.text)));
    const found = [];
    for (const l of faults) {
      if (text.includes(l.text)) found.push(`line "${l.text}"`);
      for (const id of new Set([l.id, l.id.replaceAll('-', '_')])) if (mentions(text, id)) found.push(`id "${id}"`);
      for (const m of new Set(marks(l.text))) if (!decoyMarks.has(m) && mentions(spoken(text), m)) found.push(`answer-only "${m}"`);
    }
    if (found.length) leaks[key] = [...new Set(found)];
  }
  assert.deepEqual(leaks, {});
});
