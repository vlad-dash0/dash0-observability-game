// The Spot it help ladder, pure (#160; docs/M1-DESIGN.md §4.4): lib/widgets/spot-it-help.mjs.
// Which helps a spot step declares (spotHelps, validateSpotHelps) and the three hint tiers
// (hintFor), all derived from what checkSpot reports for the picks: there is no second grader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { hintFor, SPOT_HELPS, SPOT_RULE, spotHelps, validateSpotHelps } from '../lib/widgets/spot-it-help.mjs';

// The view test's fixture. Deliberately not fault-first: s1 is a decoy before the fault s2,
// so a pair listed fault-first ([s2, s1]) differs from spec order ([s1, s2]).
function bomb(extra = {}) {
  return {
    id: 'bomb',
    target: 'metric',
    lines: [
      { id: 's1', text: 'http_requests_total{route="/cart"}' },
      { id: 's2', text: 'http_requests_total{user_id="8841"}' },
      { id: 's3', text: 'http_requests_total{method="GET"}' },
      { id: 's4', text: 'http_requests_total{trace_id="4bf9"}' },
    ],
    faults: ['s2', 's4'],
    whyNot: { s1: 'A route is a small, fixed set.' },
    explain: '<code>user_id</code> and <code>trace_id</code> explode cardinality.',
    helps: { hints: true },
    ...extra,
  };
}

const identity = (list) => [...list];
const reverse = (list) => [...list].reverse();
/** A state with `selected` exactly as given (not re-sorted), never checked. */
const picks = (...selected) => ({ selected, tried: [], solved: false });
const tier2 = (selected, shuffle = identity, spec = bomb()) => hintFor(spec, picks(...selected), 2, { shuffle, e: escapeHtml });
const code = (id) => `<code>${escapeHtml(bomb().lines.find((l) => l.id === id).text)}</code>`;

// ---- spotHelps / validateSpotHelps ----------------------------------------------------

test('SPOT_HELPS has one help, hints', () => {
  assert.deepEqual(SPOT_HELPS.map(([k, label]) => `${k}:${label}`), ['hints:Hints']);
});

test('spotHelps: hints on only when the step says so; no helps key, or an empty one, is hints off', () => {
  assert.equal(spotHelps(bomb({ helps: { hints: true } })).hints, true);
  assert.equal(spotHelps(bomb({ helps: { hints: false } })).hints, false);
  assert.equal(spotHelps(bomb({ helps: undefined })).hints, false, 'no helps key: hints off');
  assert.equal(spotHelps(bomb({ helps: {} })).hints, false, 'an empty helps object turns nothing on');
});

test('validateSpotHelps: a valid ladder has no problems; a bad key, a non-boolean, a bad hint and a hint with hints off are each named', () => {
  assert.deepEqual(validateSpotHelps(bomb({ helps: undefined })), []);
  assert.deepEqual(validateSpotHelps(bomb()), []);
  assert.deepEqual(validateSpotHelps(bomb({ helps: { hints: false } })), []);
  assert.deepEqual(validateSpotHelps(bomb({ hint: 'Ask whether the value set is bounded.' })), []);

  assert.deepEqual(validateSpotHelps(bomb({ helps: { hints: true, queue: true } })), ['helps: "queue" is not one of hints']);
  assert.deepEqual(validateSpotHelps(bomb({ helps: { hints: 'yes' } })), ['helps: "hints" is not true or false']);
  assert.deepEqual(validateSpotHelps(bomb({ helps: 'all' })), ['helps: not an object']);

  assert.deepEqual(validateSpotHelps(bomb({ hint: '  ' })), ['hint: not non-empty text']);
  assert.deepEqual(validateSpotHelps(bomb({ hint: 7 })), ['hint: not non-empty text']);

  assert.deepEqual(validateSpotHelps(bomb({ helps: { hints: false }, hint: 'Never shown.' })), ['hint: shown only when helps.hints is on']);
  assert.deepEqual(validateSpotHelps(bomb({ helps: undefined, hint: 'Never shown.' })), ['hint: shown only when helps.hints is on'],
    'no helps key is hints off, so a hint is never shown either');
});

// ---- tier 1 ----------------------------------------------------------------------------

test('hintFor tier 1: the authored hint, else the generic rule, in a <p>; the same whatever is picked; outlines and applies nothing', () => {
  assert.equal(typeof SPOT_RULE, 'string');
  assert.ok(SPOT_RULE.trim().length > 20, 'the rule is real text');
  for (const selected of [[], ['s1'], ['s2', 's4'], ['s1', 's2', 's3', 's4']]) {
    const plain = hintFor(bomb(), picks(...selected), 1, { shuffle: identity, e: escapeHtml });
    assert.deepEqual(plain, { html: `<p>${SPOT_RULE}</p>`, hinted: [], apply: null }, JSON.stringify(selected));
    const authored = hintFor(bomb({ hint: 'Ask whether the <b>value set</b> is bounded.' }), picks(...selected), 1, { shuffle: identity, e: escapeHtml });
    assert.deepEqual(authored, { html: '<p>Ask whether the <b>value set</b> is bounded.</p>', hinted: [], apply: null }, JSON.stringify(selected));
  }
});

test('the tier 1 rule says a hint counts as one penalty too, not only a wrong Check', () => {
  assert.match(SPOT_RULE, /hint counts as one penalty/);
  assert.doesNotMatch(SPOT_RULE, /only a wrong Check/);
});

// ---- tier 2 ----------------------------------------------------------------------------

test('hintFor tier 2 with faults unpicked: an unpicked fault and an unpicked decoy, listed in spec order, both drawn through the shuffle', () => {
  const none = tier2([]);
  assert.deepEqual(none.hinted, ['s1', 's2'], 'identity: fault s2 and decoy s1, listed s1 first (spec order, not fault-first)');
  assert.equal(none.apply, null);
  assert.equal(none.html,
    `<p>One of these two outlined lines matches the question and is not picked yet: ${code('s1')} or ${code('s2')}.</p>`);
  assert.deepEqual(tier2([], reverse).hinted, ['s3', 's4'], 'reverse: fault s4 and decoy s3');
});

test('hintFor tier 2: a picked line is never the decoy, and a picked fault is never the fault offered', () => {
  const s1 = tier2(['s1']);
  assert.deepEqual(s1.hinted, ['s2', 's3'], 'decoy s3 (the only unpicked non-fault), not the picked s1');
  for (const shuffle of [identity, reverse]) {
    const h = tier2(['s1'], shuffle);
    assert.equal(h.hinted.includes('s1'), false, 'the picked s1 is never outlined');
  }
  for (const shuffle of [identity, reverse]) {
    const h = tier2(['s2'], shuffle);
    assert.equal(h.hinted.includes('s4'), true, 's4 is the only fault left to name');
    assert.equal(h.hinted.includes('s2'), false, 'the picked fault s2 is not offered');
    assert.equal(h.hinted.length, 2);
  }
});

test('hintFor tier 2 with no unpicked decoy left: only the missing fault, in its own sentence', () => {
  const h = tier2(['s1', 's3']);
  assert.deepEqual(h.hinted, ['s2']);
  assert.equal(h.apply, null);
  assert.equal(h.html, `<p>${code('s2')} matches the question and is not picked yet.</p>`);
  assert.match(h.html, /matches the question and is not picked yet/);
  assert.deepEqual(tier2(['s1', 's3'], reverse).hinted, ['s4']);
});

test('hintFor tier 2 with nothing missing but a wrong pick: one wrong pick and one right pick, spec order, from the shuffle', () => {
  const one = tier2(['s1', 's2', 's4']);
  assert.deepEqual(one.hinted, ['s1', 's2']);
  assert.equal(one.html, `<p>One of these two outlined picks does not match the question: ${code('s1')} or ${code('s2')}.</p>`);
  assert.match(one.html, /does not match the question/);
  assert.deepEqual(tier2(['s1', 's2', 's4'], reverse).hinted, ['s1', 's4']);
  // Two wrong picks: which one is offered also comes from the shuffle.
  assert.deepEqual(tier2(['s1', 's2', 's3', 's4'], identity).hinted, ['s1', 's2']);
  assert.deepEqual(tier2(['s1', 's2', 's3', 's4'], reverse).hinted, ['s3', 's4']);
});

test('hintFor tier 2 when the picks are already the answer: nothing outlined, says to press Check', () => {
  assert.deepEqual(tier2(['s2', 's4']), { html: '<p>Your picks are already the answer. Press Check.</p>', hinted: [], apply: null });
});

// ---- tier 3 ----------------------------------------------------------------------------

test('hintFor tier 3: apply is the answer in spec order, whatever was picked; outlines nothing', () => {
  for (const selected of [[], ['s1', 's2'], ['s4', 's3'], ['s1', 's2', 's3', 's4'], ['s2', 's4']]) {
    const h = hintFor(bomb(), picks(...selected), 3, { shuffle: reverse, e: escapeHtml });
    assert.deepEqual(h.apply, ['s2', 's4'], JSON.stringify(selected));
    assert.deepEqual(h.hinted, []);
    assert.equal(h.html, '<p>Picked for you: every line that matches the question, and nothing else.</p>');
  }
});

// ---- no second grader, escaping ---------------------------------------------------------

test('the help module never reads the answer: no faults token in its code, and it imports checkSpot', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'widgets', 'spot-it-help.mjs');
  const src = readFileSync(file, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  assert.deepEqual(code.match(/\bfaults\b/g) ?? [], [], 'derive from checkSpot extra and missing, not spec.faults');
  assert.match(code, /import\s*\{[^}]*\bcheckSpot\b[^}]*\}\s*from\s*'\.\/spot-it\.mjs'/);
});

test('line text in tier-2 html is escaped', () => {
  const spec = bomb();
  spec.lines[1].text = 'x{a="<img src=x>"}';
  const h = tier2([], identity, spec);
  assert.deepEqual(h.hinted, ['s1', 's2']);
  assert.equal(h.html.includes('<img'), false, 'no live tag');
  assert.equal(h.html.includes(`<code>${escapeHtml('x{a="<img src=x>"}')}</code>`), true);
});
