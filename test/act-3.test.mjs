// Act 3 levels 3.1 Instruments and 3.2 Temporality beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): the act's place in the
// registry, unlock and map; level fields and lights; card fronts and backs; the facts the copy
// states (docs/OUTLINE.md §4 Act 3), each checked from the level's own data. Asserts strings,
// numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { isActUnlocked, levelState, lockReason } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const idsOf = (actId) => {
  const act = LIVE.acts.find((a) => a.id === actId);
  return [...act.levelIds, ...(act.bossId ? [act.bossId] : [])];
};
const stepOf = (levelId, key, widgetId) =>
  LIVE.levels[levelId].play.steps.find((s) => s[key] && s[key].id === widgetId)[key];
const choiceOf = (levelId, widgetId) => stepOf(levelId, 'choice', widgetId).choices;
const rightOf = (levelId, widgetId) => choiceOf(levelId, widgetId).find((c) => c.right);

// ---- the act ------------------------------------------------------------------------

test('act-3 "Metrics" holds 3.1 and 3.2, after Act 2, with no boss yet', () => {
  const index = LIVE.acts.findIndex((a) => a.id === 'act-3');
  assert.equal(index, 3, 'act-3 follows act-0, act-1 and act-2');
  const act = LIVE.acts[index];
  assert.deepEqual(
    { no: act.no, name: act.name, sub: act.sub, levelIds: [...act.levelIds], bossId: act.bossId },
    { no: 3, name: 'Metrics', sub: 'How much, how often', levelIds: ['instruments', 'temporality'], bossId: null },
  );
});

test('act-3 unlocks like act-2 did: every earlier act complete, or entered', () => {
  const before = [...idsOf('act-0'), ...idsOf('act-1')];
  assert.equal(isActUnlocked(3, progressOf(before), LIVE), false, 'act-2 not complete');
  assert.deepEqual(lockReason('instruments', progressOf(before), LIVE), { kind: 'act', actId: 'act-2' });
  assert.equal(levelState('instruments', emptyProgress(), LIVE), 'locked');

  const all = [...before, ...idsOf('act-2')];
  assert.equal(isActUnlocked(3, progressOf(all), LIVE), true);
  assert.equal(levelState('instruments', progressOf(all), LIVE), 'open');
  assert.equal(levelState('temporality', progressOf(all), LIVE), 'open', 'levels open in any order');

  // Entered: one completed level opens its act, and that holds when earlier acts are not done.
  assert.equal(levelState('temporality', progressOf(['instruments']), LIVE), 'open');
  assert.equal(levelState('instruments', progressOf(['temporality']), LIVE), 'open');
});

test('act-3 levels are scored with no par time, and belong to act-3', () => {
  for (const id of ['instruments', 'temporality']) {
    const level = LIVE.levels[id];
    assert.equal(level.actId, 'act-3', id);
    assert.equal(level.kind, 'level', id);
    assert.equal(level.scored, true, id);
    assert.equal(level.scoring.parMs, null, id);
  }
});

// ---- level fields and lights --------------------------------------------------------

const FIELDS = {
  instruments: { no: '3.1', name: 'Instruments', mechanics: ['sort'], cards: ['gauge-not-count'], lights: ['kafka'] },
  temporality: { no: '3.2', name: 'Temporality', mechanics: ['spot'], cards: ['delta-needs-converting'], lights: ['notifications'] },
};

for (const [id, want] of Object.entries(FIELDS)) {
  test(`${id}: level fields, derived mechanics, cards and lights`, () => {
    const level = LIVE.levels[id];
    assert.deepEqual(
      { no: level.no, name: level.name, mechanics: [...level.mechanics], cards: [...level.cards], lights: [...level.lights] },
      want,
    );
    assert.equal(level.run.length, 1, 'a play level gets its run from the registry');
    assert.equal(typeof level.play.finish, 'string');
  });
}

test('lights: 3.1 lights Kafka and 3.2 Notifications, so the order pipeline fills in and its edge lights', () => {
  const lit = (done) => {
    const s = nodeStates(LIVE, progressOf(done), NODES, EDGES);
    return {
      nodes: NODES.filter((n) => s.nodes[n.id].lit).map((n) => n.id).sort(),
      edge: s.edges.find((e) => e.from === 'kafka' && e.to === 'notifications').lit,
    };
  };
  assert.deepEqual(lit([]), { nodes: [], edge: false });
  assert.deepEqual(lit(['instruments']), { nodes: ['kafka'], edge: false });
  assert.deepEqual(lit(['temporality']), { nodes: ['notifications'], edge: false });
  assert.deepEqual(lit(['instruments', 'temporality']), { nodes: ['kafka', 'notifications'], edge: true });
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'gauge-not-count': {
    front:
      'A Gauge is a reading, not a count: report a running total with one and the backend gets samples, not a sum it can take a rate of.',
    back:
      'Pick the instrument by what the number means. A Counter only goes up. An UpDownCounter goes up and down, and its ' +
      'values add up across sources, like active requests or queue length. A Gauge is a current value that makes no ' +
      'sense to sum, like a temperature. A Histogram records many values where the spread matters, like durations. ' +
      'Synchronous instruments are called where the event happens; asynchronous (observable) ones take a callback the ' +
      'SDK runs at each collection. A gauge point is only a sampled value, with no aggregation semantic. A monotonic ' +
      'Sum also carries a start time, which is what lets a backend compute a rate that notices restarts, so a running ' +
      'total belongs in a Counter.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/api/#instrument',
    dash0Angle: null,
  },
  'delta-needs-converting': {
    front:
      'Prometheus-style backends need cumulative sums: convert delta series first, and expect a restart to reset a cumulative counter.',
    back:
      'Temporality says whether a point holds the total since the process started (cumulative) or only the change since ' +
      'the last report (delta). SDKs default to cumulative. Prometheus is the textbook cumulative system, and ' +
      "OpenTelemetry's data model notes that the time series model it targets has no delta counters. So a delta sum has " +
      'to be turned into a cumulative one before it reaches such a backend, and an exporter either converts a delta ' +
      "histogram or drops it. The Collector's deltatocumulative processor does the conversion, but it is stateful: it " +
      'keeps every series in memory, so all the points of one series must reach the same instance. A cumulative counter ' +
      'lives in the process, so a restart starts it again from zero with a new start time, which a backend that reads ' +
      'start times treats as a reset, not as a drop.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/metrics/data-model/#temporality',
    dash0Angle:
      'Dash0 accepts both temporalities and you query metrics with PromQL, so the conversion is for Prometheus-style ' +
      'backends, not for Dash0.',
  },
};

test('Act 3 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    const card = DECK.find((c) => c.id === id);
    assert.deepEqual(card, { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 3.1 Instruments ----------------------------------------------------------------

const instr = () => stepOf('instruments', 'sort', 'instr-sort');

test('instruments: the four instruments are the buckets, two measurements each', () => {
  const sort = instr();
  assert.deepEqual(
    sort.buckets.map((b) => `${b.id}=${b.label}`),
    ['counter=Counter', 'up-down-counter=UpDownCounter', 'gauge=Gauge', 'histogram=Histogram'],
  );
  for (const b of sort.buckets) assert.equal(sort.items.filter((it) => it.bucket === b.id).length, 2, b.id);
});

test('instruments: every wrong-bucket hint that exists is for a bucket the item is not in, and a count never fits a Gauge', () => {
  for (const it of instr().items) {
    for (const key of Object.keys(it.whyNot ?? {})) assert.notEqual(key, it.bucket, `${it.id} whyNot ${key}`);
  }
  const counts = instr().items.filter((it) => it.bucket === 'counter');
  assert.equal(counts.length, 2);
  for (const it of counts) assert.equal(/\bgauge\b/i.test(it.whyNot?.gauge ?? ''), true, `${it.id} says why not a Gauge`);
});

test('instruments: sync vs async is graded: a snapshot you can read is an asynchronous UpDownCounter, not a Gauge', () => {
  const right = rightOf('instruments', 'instr-async');
  assert.equal(right.key, 'async-updown');
  const text = plain(right.label + right.why);
  for (const w of ['asynchronous', 'UpDownCounter', 'callback']) assert.equal(text.includes(w), true, w);
  const gauge = choiceOf('instruments', 'instr-async').find((c) => /Gauge/.test(c.label));
  assert.equal(/add up|sum/i.test(gauge.why), true, 'the Gauge option is wrong because heap sizes add up');
});

test('instruments: the nuance is graded: a Gauge used for a count loses the sum and the start time a rate needs', () => {
  const right = rightOf('instruments', 'instr-gauge');
  assert.equal(right.key, 'sampled-not-sum');
  const text = plain(right.label + right.why);
  for (const w of ['sampled', 'start time', 'Counter']) assert.equal(text.includes(w), true, w);
  const lost = choiceOf('instruments', 'instr-gauge').find((c) => c.key === 'lost-between');
  assert.equal(/nothing is lost|no order is lost|still includes/i.test(lost.why), true, 'the running total keeps every earlier order');
});

// ---- 3.2 Temporality ----------------------------------------------------------------

test('temporality: the spotted series are exactly the delta ones; gauges and cumulative series are not', () => {
  const spot = stepOf('temporality', 'spot', 'temp-spot');
  assert.equal(spot.target, 'metric');
  const delta = (l) => /temporality="delta"/.test(l.text);
  assert.deepEqual(spot.lines.filter(delta).map((l) => l.id), spot.faults);
  assert.equal(spot.lines.some((l) => !/temporality=/.test(l.text)), true, 'a gauge line has no temporality at all');
  for (const l of spot.lines.filter((x) => !delta(x))) {
    assert.equal(typeof spot.whyNot[l.id], 'string', `${l.id} says why it needs no conversion`);
  }
});

test('temporality: the Prometheus-style rule, the deltatocumulative processor and its statefulness are graded', () => {
  const right = rightOf('temporality', 'temp-convert');
  assert.equal(right.key, 'deltatocumulative');
  assert.equal(right.label.includes('<code>deltatocumulative</code>'), true);
  assert.equal(/stateful|same instance/i.test(right.why), true, 'the cost is stated');
  const explain = stepOf('temporality', 'spot', 'temp-spot').explain;
  assert.equal(/Prometheus/.test(explain) && /convert/i.test(explain), true);
});

test('temporality: a restart resets a cumulative counter, and the new start time says so', () => {
  const right = rightOf('temporality', 'temp-restart');
  assert.equal(right.key, 'reset');
  assert.equal(/start time/.test(right.why) && /zero/.test(right.why), true);
  const wrong = choiceOf('temporality', 'temp-restart').filter((c) => !c.right);
  assert.deepEqual(wrong.map((c) => c.key).sort(), ['negative', 'survives']);
});

test('temporality: Dash0 accepts both temporalities and you query with PromQL (no conversion needed for Dash0)', () => {
  const right = rightOf('temporality', 'temp-dash0');
  assert.equal(right.key, 'both');
  assert.equal(/both/.test(right.label) && /PromQL/.test(right.label), true);
  for (const c of choiceOf('temporality', 'temp-dash0').filter((x) => !x.right)) {
    assert.equal(/Dash0 accepts both/.test(c.why), true, `${c.key} is corrected with what Dash0 does`);
  }
});

// ---- both levels --------------------------------------------------------------------

test('the Act 3 level files cite the metrics spec pages their facts come from', () => {
  const urls = (f) => read(`levels/${f}.mjs`).split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(urls('instruments').some((u) => u.startsWith('https://opentelemetry.io/docs/specs/otel/metrics/api/')), true);
  assert.equal(urls('temporality').some((u) => u.startsWith('https://opentelemetry.io/docs/specs/otel/metrics/data-model/')), true);
  for (const f of ['instruments', 'temporality']) {
    const src = read(`levels/${f}.mjs`);
    assert.equal(/\bthe spec says\b/i.test(src), false, f);
  }
});
