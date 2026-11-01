// lib/widgets/spot-it.mjs: the Spot it widget core (validate, select, check).
// Spec: docs/M1-DESIGN.md §4.4. All three target types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpot, newSpotState, toggleLine, validateSpotSpec } from '../lib/widgets/spot-it.mjs';

const deepFreeze = (v) => {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
};

const SPECS = {
  config: {
    id: 'bad-sampler',
    target: 'config',
    lines: [
      { id: 'l1', text: 'receivers: [otlp]' },
      { id: 'l2', text: 'sampler: always_off' },
      { id: 'l3', text: 'exporters: [otlp/dash0]' },
    ],
    faults: ['l2'],
    whyNot: { l1: 'The receiver is fine.' },
    explain: 'always_off drops every trace.',
  },
  span: {
    id: 'bad-attr',
    target: 'span',
    lines: [
      { id: 'a1', text: 'http.route=/cart' },
      { id: 'a2', text: 'user.id=8841' },
      { id: 'a3', text: 'http.status_code=200' },
    ],
    faults: ['a2'],
    explain: 'A user id has unbounded values.',
  },
  metric: {
    id: 'bomb',
    target: 'metric',
    lines: [
      { id: 's1', text: 'http_requests_total{route="/cart"}' },
      { id: 's2', text: 'http_requests_total{user_id="8841"}' },
      { id: 's3', text: 'http_requests_total{method="GET"}' },
      { id: 's4', text: 'http_requests_total{trace_id="4bf9"}' },
    ],
    faults: ['s2', 's4'],
    explain: 'Per-user and per-trace labels explode cardinality.',
  },
};
const has = (problems, text) => problems.some((p) => p.includes(text));
const pick = (spec, ids) => ids.reduce((st, id) => toggleLine(spec, st, id).state, newSpotState(spec));

for (const [target, raw] of Object.entries(SPECS)) {
  const spec = deepFreeze(structuredClone(raw));

  test(`${target}: the spec is valid`, () => {
    assert.deepEqual(validateSpotSpec(spec), []);
  });

  test(`${target}: exactly the fault set is right`, () => {
    assert.equal(checkSpot(spec, pick(spec, spec.faults)).outcome, 'right');
  });

  test(`${target}: every other selection is wrong, subsets and supersets included`, () => {
    const ids = spec.lines.map((l) => l.id);
    const subsets = ids.reduce((all, id) => [...all, ...all.map((s) => [...s, id])], [[]]).filter((s) => s.length);
    for (const s of subsets) {
      const same = s.length === spec.faults.length && s.every((id) => spec.faults.includes(id));
      assert.equal(checkSpot(spec, pick(spec, s)).outcome, same ? 'right' : 'wrong', s.join());
    }
  });
}

test('toggleLine selects, unselects, ignores unknown ids and locks after solving; never mutates', () => {
  const spec = deepFreeze(structuredClone(SPECS.metric));
  const st0 = deepFreeze(newSpotState(spec));
  const a = toggleLine(spec, st0, 's2');
  assert.equal(a.outcome, 'selected');
  assert.deepEqual(a.state.selected, ['s2']);
  assert.deepEqual(st0.selected, []);
  const b = toggleLine(spec, a.state, 's2');
  assert.equal(b.outcome, 'unselected');
  assert.deepEqual(b.state.selected, []);
  assert.equal(toggleLine(spec, st0, 'nope').outcome, 'unknown');
  assert.equal(toggleLine(spec, st0, 'constructor').outcome, 'unknown');
  const solved = checkSpot(spec, pick(spec, ['s4', 's2'])).state;
  assert.equal(solved.solved, true);
  assert.equal(toggleLine(spec, solved, 's1').outcome, 'solved');
  assert.equal(checkSpot(spec, solved).outcome, 'solved');
});

test('selection order does not matter and the selection is kept in spec order', () => {
  const spec = SPECS.metric;
  assert.deepEqual(pick(spec, ['s4', 's2']).selected, ['s2', 's4']);
});

test('checkSpot: empty, wrong with extra/missing, and a repeat of the same wrong set', () => {
  const spec = SPECS.metric;
  assert.equal(checkSpot(spec, newSpotState(spec)).outcome, 'empty');
  const w = checkSpot(spec, pick(spec, ['s1', 's2']));
  assert.equal(w.outcome, 'wrong');
  assert.deepEqual(w.extra, ['s1']);
  assert.deepEqual(w.missing, ['s4']);
  const again = checkSpot(spec, toggleLine(spec, pick(spec, ['s2']), 's1').state);
  assert.equal(again.outcome, 'wrong');
  const r1 = checkSpot(spec, pick(spec, ['s1']));
  assert.equal(r1.outcome, 'wrong');
  assert.equal(checkSpot(spec, r1.state).outcome, 'repeat');
  assert.deepEqual(checkSpot(spec, r1.state).extra, ['s1']);
  assert.equal(checkSpot(spec, toggleLine(spec, r1.state, 's2').state).outcome, 'wrong');
});

test('validateSpotSpec reports every problem at once', () => {
  const bad = {
    id: 'Bad Id',
    target: 'log',
    lines: [{ id: 'x', text: '' }, { id: 'x', text: 'y' }, { id: 'Z', text: 'z' }],
    faults: [],
    explain: ' ',
  };
  const p = validateSpotSpec(bad);
  for (const want of ['not kebab-case', 'target', 'duplicate line id "x"', 'text', 'faults: needs at least 1', 'explain']) {
    assert.ok(has(p, want), `${want}\n${JSON.stringify(p)}`);
  }
  assert.deepEqual(validateSpotSpec(null), ['spec: not an object']);
});

test('validateSpotSpec: faults and whyNot rules', () => {
  const m = (edit) => {
    const s = structuredClone(SPECS.metric);
    edit(s);
    return validateSpotSpec(s);
  };
  assert.ok(has(m((s) => { s.faults = ['s2', 's2']; }), 'duplicate fault "s2"'));
  assert.ok(has(m((s) => { s.faults = ['s9']; }), 'unknown line "s9"'));
  assert.ok(has(m((s) => { s.faults = ['s1', 's2', 's3', 's4']; }), 'every line'));
  assert.ok(has(m((s) => { s.whyNot = { s2: 'x' }; }), 'is a fault'));
  assert.ok(has(m((s) => { s.whyNot = { s9: 'x' }; }), 'unknown line "s9"'));
  assert.ok(has(m((s) => { s.whyNot = { s1: '' }; }), 'whyNot "s1"'));
  assert.ok(has(m((s) => { s.lines = [s.lines[0]]; s.faults = ['s1']; }), 'lines: 1, expected'));
});

test('validateSpotSpec: line text must fit the target', () => {
  const m = (target, text) => {
    const s = structuredClone(SPECS[target]);
    s.lines[0].text = text;
    return validateSpotSpec(s);
  };
  assert.ok(has(m('span', 'no equals sign'), 'key=value'));
  assert.ok(has(m('metric', 'http_requests_total'), 'name{labels}'));
  assert.deepEqual(m('config', 'anything at all'), []);
});
