// Act 0 levels 0.1-0.3 beyond the play-through: the answer tables pinned to
// docs/M1-DESIGN.md §6, reference solvability through the widgets' own checkers (I7),
// one penalty per run from a clean start, outcomes stated in words, and a focus walk
// that ends on Finish. Spec: docs/M1-DESIGN.md §6 Act 0 and §7 P3. The happy and sloppy
// runs live in test/levels-play.test.mjs. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { isComplete, newSortState, place, validateSortSpec } from '../lib/widgets/sort-it.mjs';
import { liveRegistry } from '../app.mjs';
import { DECK } from '../cards/deck.mjs';
import mvo, { CONTENT as MVO } from '../levels/monitoring-vs-observability.mjs';
import sig, { CONTENT as SIG } from '../levels/the-signals.mjs';
import otel, { CONTENT as OTEL } from '../levels/why-opentelemetry.mjs';

const LIVE = liveRegistry();
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// ---- content pin: docs/M1-DESIGN.md §6 Act 0 ---------------------------------------

// Per level: its fields, and per step (play order) the sort's buckets and item -> bucket,
// or the choice's keys and its right key. `says` pins words each item label must carry.
const PIN = {
  'monitoring-vs-observability': {
    level: { no: '0.1', mechanics: ['sort'], cards: [], lights: [], scoring: { parMs: null } },
    steps: [
      {
        sort: 'mvo-sort',
        buckets: ['known', 'new'],
        items: { cpu: 'known', '5xx': 'known', disk: 'known', ios: 'new', cust: 'new', coupon: 'new' },
        says: {
          cpu: 'Is CPU on db-1 above 90%?',
          '5xx': 'Has the checkout API 5xx rate stayed under 1% for the last 5 minutes?',
          disk: 'Is the log disk down to 8 GB free space?',
          ios: 'Why are only iOS 5.2 checkouts from Germany slow since 14:05 UTC?',
          cust: 'Is this one user hitting API timeouts?',
          coupon: 'Is the coupon path slowing over 10% of carts with 20+ items?',
        },
      },
      { choice: 'mvo', keys: ['alerts', 'dash', 'retention', 'rich'], right: 'rich' },
    ],
  },
  'the-signals': {
    level: { no: '0.2', mechanics: ['sort'], cards: ['profiles-signal'], lights: [], scoring: { parMs: null } },
    steps: [
      {
        sort: 'sig-data',
        buckets: ['metric', 'log', 'trace', 'profile'],
        items: { duration: 'metric', 'cpu-time': 'metric', declined: 'log', 'checkout-span': 'trace', stacks: 'profile' },
        says: {
          duration: 'http.server.request.duration histogram point',
          'cpu-time': 'process.cpu.time counter',
          declined: '{severity_text:"ERROR", body:"payment declined"}',
          'checkout-span': 'POST /checkout',
          stacks: 'CPU stack samples per function',
        },
      },
      {
        sort: 'sig-ask',
        buckets: ['metric', 'log', 'trace', 'profile'],
        items: { rps: 'metric', 'slow-call': 'trace', provider: 'log', 'cpu-fn': 'profile' },
        says: {
          rps: '30 days',
          'slow-call': 'Which downstream call made this request slow?',
          provider: 'What exactly did the payment provider return?',
          'cpu-fn': 'Which function burns CPU in inventory?',
        },
      },
      { choice: 'sig', keys: ['logs', 'metrics', 'profiles', 'traces'], right: 'profiles' },
    ],
  },
  'why-opentelemetry': {
    level: { no: '0.3', mechanics: ['sort'], cards: ['api-vs-sdk'], lights: [], scoring: { parMs: null } },
    steps: [
      {
        sort: 'otel-parts',
        buckets: ['api', 'sdk', 'otlp', 'collector', 'semconv'],
        items: { 'start-span': 'api', batch: 'sdk', wire: 'otlp', pipeline: 'collector', method: 'semconv' },
        says: {
          'start-span': "tracer.startActiveSpan('charge') in a shared library",
          batch: 'Batch span processor and sampler settings',
          wire: 'port 4318',
          pipeline: 'receives, filters and forwards',
          method: 'http.request.method',
        },
      },
      { choice: 'otel', keys: ['api', 'collector', 'exporter', 'sdk'], right: 'api' },
    ],
  },
};

const LEVELS = { 'monitoring-vs-observability': [mvo, MVO], 'the-signals': [sig, SIG], 'why-opentelemetry': [otel, OTEL] };

// The card fronts in docs/M1-DESIGN.md §6 (verified against opentelemetry.io, 2026-10-30).
const FRONTS = {
  'profiles-signal':
    "Profiles are OTel's fourth and newest signal. The profiles spec is Alpha, and profiles in OTLP are still in Development, so expect changes.",
  'api-vs-sdk':
    'Libraries depend only on the OTel API; only the app installs the SDK. Without an SDK, API calls are no-ops that record nothing.',
};

/** A step of CONTENT as the pin's plain shape (strings only). */
function shape(step) {
  if (step.sort) {
    const s = step.sort;
    return {
      sort: s.id,
      buckets: s.buckets.map((b) => b.id),
      items: Object.fromEntries(s.items.map((it) => [it.id, it.bucket])),
      says: Object.fromEntries(s.items.map((it) => [it.id, plain(it.label)])),
    };
  }
  return {
    choice: step.id,
    keys: step.choices.map((c) => c.key).sort(),
    right: step.choices.filter((c) => c.right).map((c) => c.key).join(','),
  };
}

for (const [id, [level, content]] of Object.entries(LEVELS)) {
  test(`${id}: answer tables match docs/M1-DESIGN.md §6`, () => {
    const pin = PIN[id];
    assert.equal(content.steps.length, pin.steps.length, 'step count');
    content.steps.forEach((step, i) => {
      const got = shape(step);
      const want = pin.steps[i];
      if (want.sort) {
        assert.equal(got.sort, want.sort, `step ${i + 1} sort id`);
        assert.deepEqual(got.buckets, want.buckets, `step ${i + 1} buckets`);
        assert.deepEqual(got.items, want.items, `step ${i + 1} answers`);
        for (const [item, words] of Object.entries(want.says)) {
          assert.equal(got.says[item].includes(words), true, `${item} label "${got.says[item]}" says "${words}"`);
        }
      } else {
        assert.deepEqual(got, want, `step ${i + 1} choice`);
      }
    });
  });

  test(`${id}: level fields (Act 0, scoring.parMs null, no lights)`, () => {
    const p = PIN[id].level;
    assert.deepEqual(
      { no: level.no, mechanics: level.mechanics, cards: level.cards, lights: level.lights, scoring: level.scoring },
      p,
    );
    const built = LIVE.levels[id];
    assert.equal(built.actId, 'act-0');
    assert.equal(built.scored, true);
    assert.equal(built.scoring.parMs, null);
  });

  test(`${id}: the reference answers pass the widgets' own checkers (I7)`, () => {
    for (const step of content.steps) {
      if (step.sort) {
        const spec = step.sort;
        assert.deepEqual(validateSortSpec(spec), [], `${spec.id} is a valid SortSpec`);
        let state = newSortState(spec);
        const outcomes = [];
        for (const it of spec.items) {
          const r = place(spec, state, it.id, it.bucket);
          state = r.state;
          outcomes.push(r.outcome);
        }
        assert.deepEqual([...new Set(outcomes)], ['right'], `${spec.id}: every reference placement is right`);
        assert.equal(isComplete(spec, state), true, `${spec.id} completes`);
      } else {
        assert.equal(step.choices.filter((c) => c.right).length, 1, `${step.id}: exactly one right`);
        for (const c of step.choices) {
          assert.equal(typeof c.why === 'string' && c.why.length > 0, true, `${step.id}/${c.key} has a why`);
        }
      }
    }
  });
}

test('Act 0 card fronts match docs/M1-DESIGN.md §6 and fit a card (<=140)', () => {
  for (const [id, front] of Object.entries(FRONTS)) {
    const card = DECK.find((c) => c.id === id);
    assert.equal(card?.front, front, id);
    assert.equal(front.length <= 140, true, `${id} front is ${front.length} characters`);
  }
});

test('copy never calls process.cpu.time stable (it is Release Candidate)', () => {
  const text = JSON.stringify(SIG) + JSON.stringify(DECK);
  assert.equal(/process\.cpu\.time[^.]{0,80}\bstable\b/i.test(text), false);
});

// ---- play: one penalty per run, words, focus ------------------------------------

/** Start `id` with the real ctx and the registry's level; returns { finished, focus }. */
function start(id) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const finished = [];
  const ctx = createLevelContext({
    level: LIVE.levels[id],
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (_id, r) => finished.push(r),
    signal: new AbortController().signal,
  });
  LIVE.levels[id].run(ctx);
  return { finished, focus };
}

/** A level's DOM id prefix (`mvo`, `sig`, `otel`): its Next and Finish are `#<prefix>-next/-finish`. */
const prefixOf = (id) => PIN[id].steps.at(-1).choice;

const put = (item, bucket) => {
  click(`[data-item="${item}"]`);
  click(`[data-bucket="${bucket}"]`);
};
/** Sort every pinned item of `step` into its bucket. */
const sortStep = (step) => {
  for (const [item, bucket] of Object.entries(step.items)) put(item, bucket);
};

/**
 * Play `id` through from a clean start; `slips[i]` (a function) runs at the start of
 * step i, before the right answers. Returns the stars earned.
 */
function runWith(id, slips = {}) {
  const { finished } = start(id);
  const prefix = prefixOf(id);
  PIN[id].steps.forEach((step, i) => {
    slips[i]?.();
    if (step.sort) sortStep(step);
    else click(`[data-pick="${step.right}"]`);
    click(i === PIN[id].steps.length - 1 ? '[data-finish]' : `#${prefix}-next`);
  });
  assert.equal(finished.length, 1, 'finished once');
  return finished[0].stars;
}

const SLIPS = {
  'monitoring-vs-observability': {
    'a wrong placement in the sort': { 0: () => put('ios', 'known') },
    'a wrong pick in the question': { 1: () => click('[data-pick="dash"]') },
  },
  'the-signals': {
    'a wrong placement sorting telemetry': { 0: () => put('cpu-time', 'profile') },
    'a wrong placement sorting questions': { 1: () => put('provider', 'trace') },
    'a wrong pick in the question': { 2: () => click('[data-pick="metrics"]') },
  },
  'why-opentelemetry': {
    'a wrong placement in the sort': { 0: () => put('start-span', 'sdk') },
    'a wrong pick in the question': { 1: () => click('[data-pick="sdk"]') },
  },
};

for (const [id, slips] of Object.entries(SLIPS)) {
  test(`${id}: a clean run earns 5 stars, and each penalty alone costs one`, () => {
    assert.equal(runWith(id), 5, 'a clean run');
    for (const [name, slip] of Object.entries(slips)) {
      assert.equal(runWith(id, slip), 4, name);
    }
  });
}

test('every Act 0 step waits for its answer and states each outcome in words', () => {
  for (const id of Object.keys(PIN)) {
    start(id);
    const prefix = prefixOf(id);
    PIN[id].steps.forEach((step, i) => {
      const last = i === PIN[id].steps.length - 1;
      const gate = () => q(last ? '[data-finish]' : `#${prefix}-next`).disabled;
      assert.equal(gate(), true, `${id} step ${i + 1}: gated before the answer`);
      if (step.sort) {
        const fb = () => q(`#${step.sort}-feedback`).textContent;
        const [item, bucket] = Object.entries(step.items)[0];
        const wrong = step.buckets.find((b) => b !== bucket);
        put(item, wrong);
        assert.match(fb(), /^Not quite\. /, `${id}: a wrong placement says so`);
        assert.equal(gate(), true);
        sortStep(step);
        assert.match(fb(), /^Right\. /, `${id}: a right placement says so`);
      } else {
        const fb = () => q(`#${step.choice}-feedback`).textContent;
        const wrong = step.keys.find((k) => k !== step.right);
        click(`[data-pick="${wrong}"]`);
        assert.match(fb(), /^Not quite\. /, `${id}: a wrong pick says so`);
        assert.equal(gate(), true);
        click(`[data-pick="${step.right}"]`);
        assert.match(fb(), /^Right\. /, `${id}: the right pick says so`);
      }
      assert.equal(gate(), false, `${id} step ${i + 1}: open after the answer`);
      if (!last) click(`#${prefix}-next`);
    });
  }
});

test('focus walk: each step starts on its first control, moves on, and ends on Finish', () => {
  for (const id of Object.keys(PIN)) {
    const { focus } = start(id);
    const prefix = prefixOf(id);
    PIN[id].steps.forEach((step, i) => {
      const last = i === PIN[id].steps.length - 1;
      const first = step.sort ? `item:${Object.keys(step.items)[0]}` : 'pick:';
      if (step.sort) {
        // The widget focuses its first remaining item, which is the spec's first.
        const firstItem = qa('[data-item]')[0].dataset.item;
        assert.equal(focus.last(), `item:${firstItem}`, `${id} step ${i + 1} starts on its first item`);
        sortStep(step);
        // A solved Sort it step focuses its success heading (#156); its Next or Finish is open.
        assert.equal(focus.last(), `#${step.sort}-win-title`, `${id} step ${i + 1} announces the success card`);
        assert.equal(q(last ? `#${prefix}-finish` : `#${prefix}-next`).disabled, false);
        if (!last) click(`#${prefix}-next`);
        return;
      } else {
        assert.equal(focus.last().startsWith(first), true, `${id} step ${i + 1} starts on a choice`);
        click(`[data-pick="${step.right}"]`);
      }
      const target = last ? `#${prefix}-finish` : `#${prefix}-next`;
      assert.equal(focus.last(), target, `${id} step ${i + 1} hands focus to ${target}`);
      if (!last) click(target);
    });
    assert.equal(q('[data-finish]').id, `${prefix}-finish`, `${id}: the walk ends on [data-finish]`);
    assert.deepEqual(focus.unfocusable(), [], `${id}: focused only enabled, connected controls`);
    assert.equal(focus.names().includes('body'), false);
  }
});
