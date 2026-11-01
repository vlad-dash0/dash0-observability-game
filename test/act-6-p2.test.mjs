// Act 6 level 6.3 What costs money beyond the generated play-through (test/play.test.mjs,
// test/answers.test.mjs, test/levels-play.test.mjs): level fields and lights, the step shapes, the
// shortcuts through the real Trade-off grader, and the facts the copy states (docs/OUTLINE.md §4
// Act 6), each checked against an independent copy of the numbers. Asserts strings, numbers and
// booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { allPlans, checkTradeoff, evaluatePlan, newTradeoffState, pickOption } from '../lib/widgets/trade-off.mjs';

const LIVE = liveRegistry();
const ID = 'what-costs-money';
const LEVEL = LIVE.levels[ID];
const SRC = readFileSync(new URL('../levels/what-costs-money.mjs', import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const steps = LEVEL.play.steps;
const kindOf = (s) => ['choice', 'tradeoff'].find((k) => s[k]);
const gb = () => steps.find((s) => s.tradeoff && s.tradeoff.id === 'wcm-gb').tradeoff;
const signal = () => steps.find((s) => s.tradeoff && s.tradeoff.id === 'wcm-signal').tradeoff;
const host = () => steps.find((s) => s.choice).choice.choices;

const passing = (spec) =>
  allPlans(spec).filter((p) => {
    const r = evaluatePlan(spec, p);
    return r.over === 0 && r.lost.length === 0;
  });
const grade = (spec, picks) => {
  let st = newTradeoffState(spec);
  for (const [k, o] of Object.entries(picks)) st = pickOption(spec, st, k, o).state;
  return checkTradeoff(spec, st);
};

test('6.3: level fields, derived mechanics, no card, the collector lit, no par time, in act-6', () => {
  assert.deepEqual(
    { no: LEVEL.no, name: LEVEL.name, mechanics: [...LEVEL.mechanics], cards: [...LEVEL.cards], lights: [...LEVEL.lights] },
    { no: '6.3', name: 'What costs money', mechanics: ['tradeoff'], cards: [], lights: ['collector'] },
  );
  assert.equal(LEVEL.actId, 'act-6');
  assert.equal(LEVEL.scored, true);
  assert.equal(LEVEL.scoring.parMs, null);
  assert.equal(LEVEL.run.length, 1, 'declarative: the registry supplies run(ctx)');
});

test('6.3: the steps are a Choice for per-host, then a Trade-off for per-GB and one for per-signal', () => {
  assert.deepEqual(steps.map(kindOf), ['choice', 'tradeoff', 'tradeoff']);
  assert.deepEqual(steps.map((s) => (s.choice ?? s.tradeoff).id), ['wcm-host', 'wcm-gb', 'wcm-signal']);
  assert.equal(/host/.test(plain(steps[0].intro)), true);
  assert.equal(/GB/.test(plain(steps[1].intro)), true);
  assert.equal(/signal/.test(plain(steps[2].intro)), true);
});

test('6.3 per host: only consolidating hosts lowers a per-host bill; the three volume or size levers do not', () => {
  assert.deepEqual(host().map((c) => c.key).sort(), ['drop-debug', 'fewer-hosts', 'sample', 'short-keys']);
  assert.equal(host().find((c) => c.right).key, 'fewer-hosts');
  for (const k of ['drop-debug', 'sample', 'short-keys']) {
    assert.equal(host().find((c) => c.key === k).right, undefined, k);
    assert.equal(/per-host|per host|price/.test(plain(host().find((c) => c.key === k).why)), true, `${k} says why the bill does not move`);
  }
  assert.equal(/no extra charge|nothing in the bill/.test(plain(host().find((c) => c.right).why)), true, 'the flip side is stated');
});

test('6.3 per GB: costs and cap are the numbers the copy relies on', () => {
  const spec = gb();
  const cost = (k, o) => spec.knobs.find((x) => x.id === k).options.find((x) => x.id === o).cost;
  assert.deepEqual([spec.unit, spec.cap], ['GB per day', 100]);
  assert.deepEqual(
    [cost('traces', 'all'), cost('traces', 'tail'), cost('traces', 'head'), cost('logs', 'full'), cost('logs', 'trimmed'), cost('logs', 'none')],
    [120, 25, 2, 80, 30, 0],
  );
});

test('6.3 per GB: exactly one plan passes (55 of 100) and each shortcut fails for its own reason', () => {
  const spec = gb();
  assert.deepEqual(passing(spec), [{ traces: 'tail', logs: 'trimmed' }]);
  assert.deepEqual(spec.answer, { traces: 'tail', logs: 'trimmed' });
  assert.equal(evaluatePlan(spec, spec.answer).total, 55);
  const bodies = evaluatePlan(spec, { traces: 'tail', logs: 'full' });
  assert.deepEqual([bodies.total, bodies.over, bodies.lost.length], [105, 5, 0], 'keeping the bodies alone breaks the cap');
  const every = evaluatePlan(spec, { traces: 'all', logs: 'trimmed' });
  assert.deepEqual([every.total, every.over, every.lost.length], [150, 50, 0], 'keeping every span breaks the cap');
  const cheap = evaluatePlan(spec, { traces: 'head', logs: 'none' });
  assert.deepEqual([cheap.total, cheap.over, cheap.lost], [2, 0, ['slow-traces', 'incident-logs']], 'the cheapest plan drops both needs');
  const head = evaluatePlan(spec, { traces: 'head', logs: 'trimmed' });
  assert.deepEqual([head.over, head.lost], [0, ['slow-traces']], 'a fixed 1% loses the slow traces');
});

test('6.3 per GB: the real grader passes the answer and fails a shortcut', () => {
  assert.equal(grade(gb(), gb().answer).outcome, 'right');
  assert.equal(grade(gb(), { traces: 'head', logs: 'trimmed' }).outcome, 'wrong');
  assert.equal(grade(gb(), { traces: 'tail', logs: 'full' }).outcome, 'wrong');
});

test('6.3 per GB: the explain teaches size as a lever, sampling and retention as a multiplier, and labels the numbers made up', () => {
  const t = plain(gb().explain);
  for (const w of ['bytes', 'cutting the bodies', 'one of the most effective ways to reduce the cost of observability', 'three times as long', 'daily volume times the days you keep it', 'made up']) {
    assert.equal(t.includes(w), true, w);
  }
});

test('6.3 per signal: costs and cap are the numbers the copy relies on', () => {
  const spec = signal();
  const cost = (k, o) => spec.knobs.find((x) => x.id === k).options.find((x) => x.id === o).cost;
  assert.deepEqual([spec.unit, spec.cap], ['cost units per day', 40]);
  assert.deepEqual(
    [cost('interval', 's10'), cost('interval', 's60'), cost('interval', 'm5'), cost('records', 'per-line'), cost('records', 'per-line-trimmed'), cost('records', 'per-request'), cost('records', 'none'), cost('spans', 'all'), cost('spans', 'tail'), cost('spans', 'head')],
    [30, 5, 1, 40, 40, 10, 0, 50, 12, 1],
  );
  assert.equal(cost('interval', 's10') / cost('interval', 's60'), 6, 'ten seconds is six times as many points as sixty');
});

test('6.3 per signal: exactly one plan passes (27 of 40) and each shortcut fails for its own reason', () => {
  const spec = signal();
  assert.deepEqual(passing(spec), [{ interval: 's60', records: 'per-request', spans: 'tail' }]);
  assert.deepEqual(spec.answer, { interval: 's60', records: 'per-request', spans: 'tail' });
  assert.equal(evaluatePlan(spec, spec.answer).total, 27);
  const fast = evaluatePlan(spec, { interval: 's10', records: 'per-request', spans: 'tail' });
  assert.deepEqual([fast.total, fast.over, fast.lost.length], [52, 12, 0], 'ten-second metrics break the cap');
  const lines = evaluatePlan(spec, { interval: 's60', records: 'per-line', spans: 'tail' });
  assert.deepEqual([lines.total, lines.over, lines.lost.length], [57, 17, 0], 'a record per line breaks the cap, though the bytes are the same');
  const smaller = evaluatePlan(spec, { interval: 's60', records: 'per-line-trimmed', spans: 'tail' });
  assert.deepEqual([smaller.total, smaller.over, smaller.lost.length], [57, 17, 0], 'cutting the bodies does not move a per-signal bill');
  const slow = evaluatePlan(spec, { interval: 'm5', records: 'per-request', spans: 'tail' });
  assert.deepEqual([slow.over, slow.lost], [0, ['fast-alerts']], 'five-minute metrics miss the alert');
  const none = evaluatePlan(spec, { interval: 's60', records: 'none', spans: 'tail' });
  assert.deepEqual([none.over, none.lost], [0, ['request-detail']], 'dropping logs loses the detail');
  const head = evaluatePlan(spec, { interval: 's60', records: 'per-request', spans: 'head' });
  assert.deepEqual([head.over, head.lost], [0, ['slow-traces']], 'a fixed 1% loses the slow traces');
  assert.equal(grade(spec, spec.answer).outcome, 'right');
  assert.equal(grade(spec, { interval: 's10', records: 'per-request', spans: 'tail' }).outcome, 'wrong');
});

test('6.3: the same lever flips between the two models (bodies cost under per GB, record count costs under per signal)', () => {
  const g = gb();
  const s = signal();
  const gbLog = (id) => g.knobs.find((k) => k.id === 'logs').options.find((o) => o.id === id);
  const sigRec = (id) => s.knobs.find((k) => k.id === 'records').options.find((o) => o.id === id);
  assert.equal(gbLog('trimmed').cost < gbLog('full').cost, true, 'per GB: cutting the bodies costs less');
  assert.equal(plain(gbLog('trimmed').label), 'Every log line, with the bodies cut out');
  assert.equal(sigRec('per-line-trimmed').cost, sigRec('per-line').cost, 'per signal: cutting the bodies costs the same');
  assert.equal(plain(sigRec('per-line-trimmed').label), 'One record for each log line, with the bodies cut out');
  assert.equal(sigRec('per-request').cost < sigRec('per-line').cost, true, 'per signal: fewer records cost less');
  assert.equal(
    plain(s.explain).includes('That reverses the last step: cutting the bodies saves nothing here, because every line is still one record, and packing a request\'s lines into one record does.'),
    true,
  );
  assert.equal(plain(g.explain).includes('takes them from 80 to 30 GB with every line kept, where halving the number of lines would only take them from 80 to 40'), true);
  assert.equal(plain(s.explain).includes('into one record does. A metric makes'), true, 'the sentences are separated by a space');
  assert.equal(gbLog('full').cost, 80);
  assert.equal(gbLog('trimmed').cost, 30);
  assert.equal(plain(s.whyNot['records:per-line-trimmed']), 'Smaller records, same count: the meter counts records, so the bill did not move.');
});

test('6.3 per GB: the meter is GB sent, and retention is the separate multiplier', () => {
  assert.equal(plain(steps[1].intro).includes('per GB sent'), true);
  assert.equal(plain(steps[1].intro).includes('100 GB sent a day'), true);
  assert.equal(/\bstored\b/.test(plain(steps[1].intro)), false, 'the step does not call the meter stored');
  assert.equal(plain(gb().explain).includes('what you store is the daily volume times the days you keep it'), true);
});

test('6.3 per signal: the explain teaches the Dash0 tie-in from the cost-control docs, with no price', () => {
  const t = plain(signal().explain);
  for (const w of [
    'Dash0 meters spans, log records and metric data points',
    'ingest on every signal you send, before any filtering',
    'index on the signals you keep',
    'filtered telemetry still carries the ingest charge',
    'rank services by telemetry volume',
    'cardinality times frequency',
    'made up',
  ]) {
    assert.equal(t.includes(w), true, w);
  }
});

test('6.3: no price, plan name or per-service cost claim is written', () => {
  assert.equal(/\$\s?\d|USD|EUR|per million|per month|\/month/i.test(plain(SRC.replace(/^\/\/.*$/gm, ''))), false, 'no price');
  assert.equal(/cost (is )?(visible )?per service|per-service cost/i.test(SRC.replace(/^\/\/.*$/gm, '')), false, 'per-service cost is not verified');
  assert.equal(/\b(free|team|enterprise|starter) plan\b/i.test(SRC), false, 'no plan name');
});
