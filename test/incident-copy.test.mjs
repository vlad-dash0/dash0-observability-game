// Copy rules for the six incident bosses (#182): each boss has its own scenario line, which does
// not repeat what the generic lesson card says; a panel with a table, list or code block is the
// evidence plus at most one more sentence; and the cause labels give nothing away by their shape:
// the right one is neither the longest nor the shortest, and no length or word count, digit count,
// comma count, quote count or count of code-like words picks it out (the tell rules of
// test/spot-tells.test.mjs, here over four labels). Hints: test/authored-hints.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { incidentLesson } from '../lib/widgets/incident-view.mjs';

const BOSSES = ['who-is-talking', 'checkout-is-slow', 'the-bill', 'the-3am-errors', 'silence', 'errors-tripled'];

/** { id, intro, scenario } for every level that plays an incident, from the live registry. */
async function incidentBosses() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const step = (mod.default.play?.steps ?? []).find((s) => s.incident);
      if (step) out.push({ id: level.id, intro: step.intro, scenario: step.incident });
      else if (mod.CONTENT?.scenario) out.push({ id: level.id, intro: mod.CONTENT.intro, scenario: mod.CONTENT.scenario });
    }
  }
  return out;
}

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&times;/g, 'x').replace(/\s+/g, ' ').trim();

test('the incident bosses are exactly the six this file covers', async () => {
  assert.deepEqual((await incidentBosses()).map((b) => b.id).sort(), [...BOSSES].sort());
});

// ---- scenario line ------------------------------------------------------------------

// The generic lesson card already says that views cost error budget and that you pick the cause.
const REPEATS = [/every look/i, /costs? minutes/i, /error budget/i, /open what you need/i, /name the cause/i];

test('every boss has its own scenario line, and it does not repeat the generic lesson card', async () => {
  const seen = new Set();
  for (const { id, intro } of await incidentBosses()) {
    assert.equal(typeof intro, 'string', `${id}: the scenario line`);
    const text = plain(intro);
    assert.equal(text.length > 40, true, `${id}: a line, not a stub`);
    assert.equal(seen.has(text), false, `${id}: its own line`);
    seen.add(text);
    for (const re of REPEATS) assert.equal(re.test(text), false, `${id}: repeats the lesson card (${re})`);
    assert.equal(/—/.test(intro), false, `${id}: no em dash`);
  }
  const card = plain(incidentLesson('X'));
  for (const re of [REPEATS[1], REPEATS[2], REPEATS[4]]) assert.equal(re.test(card), true, `the lesson card does say ${re}`);
});

// ---- panels -------------------------------------------------------------------------

const BLOCK = /<table[\s\S]*?<\/table>|<pre[\s\S]*?<\/pre>|<ul[\s\S]*?<\/ul>/g;
/** Sentences of `html`, split at a full stop, "?" or "!" followed by a space. */
const sentences = (html) => plain(html).split(/(?<=[.?!])\s+/).filter(Boolean);
/** The paragraphs after the last table, list or code block of a panel (none when it has no block). */
const afterBlock = (html) => {
  const blocks = [...html.matchAll(BLOCK)];
  if (blocks.length === 0) return null;
  const last = blocks[blocks.length - 1];
  return html.slice(last.index + last[0].length);
};

const MOST_SENTENCES_AFTER_EVIDENCE = 2; // one note on the evidence, one sentence of interpretation
const MOST_SENTENCES_IN_PROSE = 3;

test('a panel is the evidence plus at most one sentence of interpretation: few sentences around the table, and in a prose panel', async () => {
  const long = {};
  for (const { id, scenario } of await incidentBosses()) {
    for (const v of scenario.views) {
      const tail = afterBlock(v.html);
      const n = tail === null ? sentences(v.html).length : sentences(tail).length;
      const most = tail === null ? MOST_SENTENCES_IN_PROSE : MOST_SENTENCES_AFTER_EVIDENCE;
      if (n > most) long[`${id}/${v.id}`] = `${n} sentences, at most ${most}`;
    }
  }
  assert.deepEqual(long, {});
});

// ---- cause labels -------------------------------------------------------------------

/** Words that look like a name in code: they hold `_`, `/`, `:`, a digit, or a dot between letters. */
const CODE_LIKE = /[A-Za-z0-9]*(?:[_/:][A-Za-z0-9_/:.-]*|\d[A-Za-z0-9.]*|[A-Za-z]\.[A-Za-z][A-Za-z0-9._-]*)/g;
const count = (re) => (text) => (text.match(re) ?? []).length;

/** Measures of a label: name -> (plain text) -> number. Same rules as the Spot tells' text measures. */
const MEASURES = {
  length: (t) => t.length,
  words: count(/\w+/g),
  digits: count(/\d/g),
  commas: count(/,/g),
  quotes: count(/"/g),
  'code-like words': count(CODE_LIKE),
};

const TELL_SHARE = 0.5;

/**
 * The share of tie-break orders in which "take the one with the most (or the fewest) `name`" picks
 * `rightIndex`: 0 when the right one is not in the top group, else 1 / the size of that group.
 */
function pickShare(values, rightIndex, direction) {
  const best = direction === 'most' ? Math.max(...values) : Math.min(...values);
  const top = values.filter((v) => v === best).length;
  return values[rightIndex] === best ? 1 / top : 0;
}

/** { "<boss> <rule>": share } for every rule that picks the right cause on more than TELL_SHARE of its tie-breaks. */
function tellsOf(id, labels, rightIndex) {
  const found = {};
  for (const [name, f] of Object.entries(MEASURES)) {
    const values = labels.map(f);
    for (const direction of ['most', 'fewest']) {
      const share = pickShare(values, rightIndex, direction);
      if (share > TELL_SHARE) found[`${id}: ${direction} ${name}`] = share;
    }
  }
  return found;
}

const labelsOf = (scenario) => scenario.hypotheses.map((h) => plain(h.label));

test('no length, word, digit, comma, quote or code-name count picks the right cause on any incident boss', async () => {
  const all = {};
  for (const { id, scenario } of await incidentBosses()) {
    Object.assign(all, tellsOf(id, labelsOf(scenario), scenario.hypotheses.findIndex((h) => h.right)));
  }
  assert.deepEqual(all, {});
});

test('the right cause is neither the longest nor the shortest label, in characters, on any incident boss', async () => {
  for (const { id, scenario } of await incidentBosses()) {
    const labels = labelsOf(scenario);
    const right = labels[scenario.hypotheses.findIndex((h) => h.right)];
    assert.equal(labels.some((l) => l.length > right.length), true, `${id}: a longer label than "${right}"`);
    assert.equal(labels.some((l) => l.length < right.length), true, `${id}: a shorter label than "${right}"`);
  }
});

test('the label tell rules have teeth: they flag a longest or fewest-words answer and let a middle one pass', () => {
  const labels = ['aaaa bbbb cccc', 'aa', 'aaaa bbbb', 'aaaaaa bbbbbb cccccc dddddd'];
  assert.deepEqual(Object.keys(tellsOf('x', labels, 3)).sort(), ['x: most length', 'x: most words'].sort());
  assert.deepEqual(Object.keys(tellsOf('x', labels, 1)).sort(), ['x: fewest length', 'x: fewest words'].sort());
  assert.deepEqual(tellsOf('x', labels, 0), {});
  assert.deepEqual(Object.keys(tellsOf('x', ['a user_id one', 'a plain words', 'one plain bit', 'two plain bit'], 0)), ['x: most code-like words']);
  assert.equal(pickShare([3, 3, 1, 1], 0, 'most'), 0.5, 'a tie of two is a coin flip, not a tell');
});

test('no cause label carries a clock time: a time in a label can contradict the alert and rule that cause out before any view is opened', async () => {
  const CLOCK = /\b\d{1,2}:\d{2}\b/;
  for (const b of await incidentBosses()) {
    for (const h of b.scenario.hypotheses) {
      assert.equal(CLOCK.test(plain(h.label)), false, `${b.id}/${h.id}: "${plain(h.label)}" has a time; keep times in the views and the why`);
    }
  }
});
