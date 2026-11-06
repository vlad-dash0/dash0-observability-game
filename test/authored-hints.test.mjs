// Authored tier-1 hints (#190): every Sort it and Spot it step with hints on declares its own
// `hint`, tier 1 shows exactly that (not the generic SORT_RULE / SPOT_RULE), the hint does not
// give the answer away, and it is inline HTML, because tier 1 wraps it in a <p>. The six incident
// bosses (#182) author theirs too: one paragraph, shown as written by tier 1, naming neither a clue
// view nor the cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { newSortState } from '../lib/widgets/sort-it.mjs';
import { SORT_RULE, hintFor as sortHint, sortHelps } from '../lib/widgets/sort-it-help.mjs';
import { newSpotState } from '../lib/widgets/spot-it.mjs';
import { SPOT_RULE, hintFor as spotHint, spotHelps } from '../lib/widgets/spot-it-help.mjs';
import { newIncident } from '../lib/widgets/incident.mjs';
import { GENERIC_HINT, hintFor as incidentHint } from '../lib/widgets/incident-help.mjs';

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

// ---- incident bosses (#182) -----------------------------------------------------------

/** Every incident scenario, as { id, scenario }, from the live registry. */
async function incidentScenarios() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const step = (mod.default.play?.steps ?? []).find((st) => st.incident);
      const scenario = step?.incident ?? mod.CONTENT?.scenario;
      if (scenario) out.push({ id: level.id, scenario });
    }
  }
  return out;
}

test('there are six incident bosses, and each declares an authored hint that tier 1 shows as written, not the generic rule', async () => {
  const all = await incidentScenarios();
  assert.equal(all.length, 6);
  for (const { id, scenario } of all) {
    assert.equal(typeof scenario.hint, 'string', `${id}: a hint`);
    assert.notEqual(scenario.hint.trim(), '', id);
    const { html } = incidentHint(scenario, newIncident(scenario), 1);
    assert.equal(html, scenario.hint, id);
    assert.equal(html.includes(GENERIC_HINT), false, `${id}: not the generic rule`);
  }
});

test('an incident hint is one paragraph of inline HTML (the board adds only its "Hint 1 of 3" line)', async () => {
  for (const { id, scenario } of await incidentScenarios()) {
    assert.equal(/^<p>[^<]+(?:<(?:code|b|i)>[^<]*<\/(?:code|b|i)>[^<]*)*<\/p>$/.test(scenario.hint), true, `${id}: ${scenario.hint}`);
  }
});

/** Words that carry no meaning of their own, so no hint leaks one. */
const FUNCTION_WORDS = new Set(['the', 'and', 'that', 'one', 'for', 'with', 'are', 'was', 'not', 'its', 'from', 'but', 'all', 'any', 'has', 'this', 'than', 'then', 'what']);
/** A word's root, so "changed" and "change", "logs" and "log" are one word. */
const stem = (w) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s|e)$/, '') : w);
const wordsOfText = (text) =>
  new Set(spoken(plain(text)).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FUNCTION_WORDS.has(w)).map(stem));

/**
 * What `hint` gives away on `scenario`: the label of the cause or of a clue view, or a word that
 * only that label carries. A word the alert says, or that a wrong cause or a neutral or misleading
 * view's label also has, tells nothing.
 */
function incidentLeaks(scenario, hint) {
  const text = plain(hint);
  const right = scenario.hypotheses.find((h) => h.right);
  const clues = scenario.views.filter((v) => v.kind === 'clue');
  const elsewhere = new Set([
    ...wordsOfText(`${scenario.alert.title} ${scenario.alert.html}`),
    ...scenario.hypotheses.filter((h) => !h.right).flatMap((h) => [...wordsOfText(h.label)]),
    ...scenario.views.filter((v) => v.kind !== 'clue').flatMap((v) => [...wordsOfText(v.label)]),
  ]);
  const found = [];
  for (const label of [right.label, ...clues.map((v) => v.label)]) if (mentions(text, plain(label))) found.push(`label "${plain(label)}"`);
  const mine = wordsOfText(text);
  for (const [what, label] of [['cause', right.label], ...clues.map((v) => ['clue view', v.label])]) {
    for (const w of wordsOfText(label)) if (!elsewhere.has(w) && mine.has(w)) found.push(`${what} word "${w}"`);
  }
  return [...new Set(found)];
}

// A hint teaches the method. It must not name the cause or a clue view.
test('no incident hint names the cause or a clue view: not their labels, not a word only they carry', async () => {
  const leaks = {};
  for (const { id, scenario } of await incidentScenarios()) {
    const found = incidentLeaks(scenario, scenario.hint);
    if (found.length) leaks[id] = found;
  }
  assert.deepEqual(leaks, {});
});

test('the incident leak guard has teeth: it flags a cause label, a clue view label and a word only they carry', () => {
  const scenario = {
    alert: { title: 'Checkout is slow', html: '<p>The p95 is high.</p>' },
    views: [
      { id: 'a', label: 'Slow traces', kind: 'clue' },
      { id: 'b', label: 'Gateway load', kind: 'neutral' },
    ],
    hypotheses: [
      { id: 'r', label: 'A runaway cron job', right: true },
      { id: 'w', label: 'The gateway is overloaded', right: false },
    ],
  };
  assert.deepEqual(incidentLeaks(scenario, 'Look for a cron schedule.'), ['cause word "cron"']);
  assert.deepEqual(incidentLeaks(scenario, 'Open the traces.'), ['clue view word "trac"']);
  assert.deepEqual(incidentLeaks(scenario, 'Is it a runaway cron job?'), ['label "A runaway cron job"', 'cause word "runaway"', 'cause word "cron"', 'cause word "job"']);
  assert.deepEqual(incidentLeaks(scenario, 'Find where the time goes, and what the gateway does.'), []);
});
