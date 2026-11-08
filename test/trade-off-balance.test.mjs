// Trade-off balance (#265): no board is solved by a rule that does not know the concept, and each has exactly one
// passing plan and a tempting wrong plan whose failure shows in the numbers. The probe
// (test/helpers/trade-off-probe.mjs) runs every plan and every per-knob rule through the real evaluatePlan; a
// rule "passes" when any plan it can produce passes (a tie never hides a win). The cards hide what an option keeps
// until a Check, so the BLIND rules (cost rank, position, label length) are what a player has without the concept,
// and none may pass any board. The KEEPS rules (a player who has seen the Keeps) are pinned too; the few that do
// pass are listed below and pinned exactly, because the board's structure forbids a strict superset there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveRegistry } from '../app.mjs';
import { evaluatePlan } from '../lib/widgets/trade-off.mjs';
import { BLIND_RULES, KEEPS_RULES, RULES, probe } from './helpers/trade-off-probe.mjs';

const LIVE = liveRegistry();
const board = (level, id) => LIVE.levels[level].play.steps.find((s) => s.tradeoff?.id === id).tradeoff;
const plain = (html) => html.replace(/<[^>]+>/g, '');

// The tempting wrong plan of each board: the plan a player who reads the numbers but not the concept would pick.
const BOARDS = [
  ['cardinality', 'cdn-budget', { requests: 'route-status-tier', served: 'none', customer: 'span-attribute' }, { total: 379, over: 239, lost: [] }],
  ['head-sampling', 'hs-plan', { checkout: 'always-on', payments: 'follow' }, { total: 2120, over: 1680, lost: [] }],
  ['tail-sampling', 'ts-budget', { wait: 'wait-30s', policies: 'errors-slow-baseline' }, { total: 600, over: 50, lost: [] }],
  ['what-costs-money', 'wcm-gb', { traces: 'tail', logs: 'half' }, { total: 65, over: 5, lost: [] }],
  ['what-costs-money', 'wcm-signal', { interval: 's60', records: 'per-line-trimmed', spans: 'tail' }, { total: 57, over: 27, lost: [] }],
  ['the-34-percent-error-rate', 'ser-plan', { sampler: 'errors-10pct', rate: 'stored-spans' }, { total: 145, over: 0, lost: ['true-rate'] }],
];

// Keeps rules that pass because the structure allows no strict superset: hs-plan and ts-budget (the plan's one need
// that only a wait or a root setting meets, with every other option on the knob free or equal).
const KEEPS_EXEMPT = {
  'hs-plan': ['most-keeps-then-cheapest', 'most-keeps'],
  'ts-budget': ['cheapest-keeper', 'most-keeps-then-cheapest', 'most-keeps'],
};

for (const [level, id, tempting, shown] of BOARDS) {
  test(`${id}: one passing plan, no blind rule passes, and the tempting plan fails in the numbers`, () => {
    const spec = board(level, id);
    const r = probe(spec);
    assert.deepEqual(r.passing, [spec.answer], 'exactly one plan passes, and it is the answer');
    assert.deepEqual(Object.keys(r.strategies).sort(), Object.keys(RULES).sort());
    const passing = (family) => Object.keys(family).filter((rule) => r.strategies[rule]);
    assert.deepEqual(passing(BLIND_RULES), [], 'no cost-rank, position or label-length rule passes');
    assert.deepEqual(passing(KEEPS_RULES), KEEPS_EXEMPT[id] ?? [], 'the Keeps rules that pass are exactly the pinned ones');
    const e = evaluatePlan(spec, tempting);
    assert.deepEqual({ total: e.total, over: e.over, lost: e.lost }, shown);
    // The failure is explained: the tempting plan's wrong option has a whyNot line (or its knob does).
    const wrong = Object.entries(tempting).filter(([knob, option]) => spec.answer[knob] !== option);
    assert.equal(wrong.length >= 1 && wrong.every(([knob, option]) => typeof spec.whyNot[`${knob}:${option}`] === 'string'), true, 'every wrong option of the tempting plan has a whyNot');
  });
}

test('no hint is a winning heuristic: none says cheapest, most or fewest', () => {
  for (const [level, id] of BOARDS) {
    const spec = board(level, id);
    if (spec.hint === undefined) continue;
    assert.equal(/\b(cheapest|most keeps|fewest|lowest|middle)\b/i.test(plain(spec.hint)), false, `${id}: ${plain(spec.hint)}`);
  }
});

test('no label argues its own wrongness or echoes the answer: the answer option is never the longest on a knob of sentences', () => {
  for (const [level, id] of BOARDS) {
    const spec = board(level, id);
    for (const k of spec.knobs) {
      const lens = k.options.map((o) => plain(o.label).length);
      const right = plain(k.options.find((o) => o.id === spec.answer[k.id]).label).length;
      if (k.options.length > 2 && Math.max(...lens) > 30) assert.equal(right < Math.max(...lens), true, `${id}/${k.id}: the answer's label is not the longest`);
    }
  }
});

test('the probe catches a board a heuristic solves', () => {
  const easy = {
    id: 'easy', unit: 'x', cap: 10,
    knobs: [{ id: 'a', label: 'A', options: [{ id: 'cheap', label: 'c', cost: 1, keeps: ['n'] }, { id: 'dear', label: 'd', cost: 20 }] }],
    needs: [{ id: 'n', label: 'n' }], answer: { a: 'cheap' },
  };
  const r = probe(easy);
  assert.equal(r.strategies['cheapest-keeper'], true);
  assert.equal(r.strategies.priciest, false);
});
