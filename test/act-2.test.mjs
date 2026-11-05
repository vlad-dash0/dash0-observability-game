// Act 2 levels 2.1 to 2.7 beyond the play-through: the answer tables pinned to
// docs/M1-DESIGN.md §6, reference solvability through the widgets' own checkers (I7),
// one penalty per run from a clean start, outcomes stated in words, the "Map edges"
// line from serviceEdges, and a focus walk that ends on Finish. Spec: docs/M1-DESIGN.md
// §6 Act 2 and §7 P6, P7, P8, P9. The happy and sloppy runs live in test/levels-play.test.mjs.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { checkBuild, newBuildState, setKind, setParent, setStatus, toggleLink, validateBuildSpec } from '../lib/widgets/build-it.mjs';
import { serviceEdges } from '../lib/widgets/trace.mjs';
import { isComplete, newSortState, place, validateSortSpec } from '../lib/widgets/sort-it.mjs';
import { liveRegistry } from '../app.mjs';
import { DECK } from '../cards/deck.mjs';
import sat, { CONTENT as SAT } from '../levels/spans-and-traces.mjs';
import kinds, { CONTENT as KINDS } from '../levels/span-kinds.mjs';
import status, { CONTENT as STATUS } from '../levels/status-and-errors.mjs';
import baggage, { CONTENT as BAGGAGE } from '../levels/baggage.mjs';
import prop, { CONTENT as PROP } from '../levels/context-propagation.mjs';
import evl, { CONTENT as EVL } from '../levels/events-and-links.mjs';
import avm, { CONTENT as AVM } from '../levels/auto-vs-manual.mjs';
import { b1Spec } from './fixtures/build-b1.mjs';

const LIVE = liveRegistry();
const SPEC_HOSTS = ['opentelemetry.io', 'www.w3.org'];
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>');
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ---- content pin: docs/M1-DESIGN.md §6 Act 2 ---------------------------------------

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

// Per level: its fields, and per step (play order) either the choice's keys, its right
// key and words its labels carry, the Sort spec's buckets, item -> bucket and words each
// item label carries, or the Build spec's edit and its spans. A span is
// `service name` -> [kind, startMs, endMs, trace, given parent, expected parent,
// expected kind, expected links, given status, expected status]; parents and links are
// named the same way, a trace by its first four hex digits. Spans that share a service
// and name are told apart by their trace: `service name trace`.
const PIN = {
  'spans-and-traces': {
    prefix: 'sat',
    level: { no: '2.1', mechanics: ['build'], cards: ['no-trace-object'], lights: ['storefront', 'api-gateway'], scoring: { parMs: null } },
    steps: [
      {
        choice: 'sat',
        question: 'What makes these spans one trace?',
        keys: ['trace-id', 'trace-object'],
        right: 'trace-id',
        says: { 'trace-id': 'trace ID', 'trace-object': 'The SDK sends a trace object at the end' },
      },
      {
        build: 'sat-tree',
        edit: ['parent'],
        spans: {
          'storefront POST /checkout': ['SERVER', 0, 100, '4bf9', null, null, 'SERVER', [], 'UNSET', 'UNSET'],
          'storefront POST': ['CLIENT', 10, 90, '4bf9', null, 'storefront POST /checkout', 'CLIENT', [], 'UNSET', 'UNSET'],
          'api-gateway POST /checkout': ['SERVER', 15, 85, '4bf9', null, 'storefront POST', 'SERVER', [], 'UNSET', 'UNSET'],
          'api-gateway validate cart': ['INTERNAL', 20, 30, '4bf9', null, 'api-gateway POST /checkout', 'INTERNAL', [], 'UNSET', 'UNSET'],
          'storefront GET /products': ['SERVER', 40, 60, '0af7', null, null, 'SERVER', [], 'UNSET', 'UNSET'],
        },
      },
      {
        choice: 'sat-e',
        keys: ['late-child', 'lost-parent', 'other-request'],
        right: 'other-request',
        says: { 'other-request': 'another request' },
      },
    ],
  },
  'span-kinds': {
    prefix: 'kinds',
    level: { no: '2.2', mechanics: ['build'], cards: ['span-kind-edges'], lights: ['payments'], scoring: { parMs: null } },
    steps: [
      {
        build: 'kinds-map',
        edit: ['kind'],
        spans: {
          'checkout POST /checkout': ['INTERNAL', 0, 120, 'c4e1', null, null, 'SERVER', [], 'UNSET', 'UNSET'],
          'checkout POST payments': ['INTERNAL', 20, 100, 'c4e1', 'checkout POST /checkout', 'checkout POST /checkout', 'CLIENT', [], 'UNSET', 'UNSET'],
          'payments POST /charge': ['INTERNAL', 25, 95, 'c4e1', 'checkout POST payments', 'checkout POST payments', 'SERVER', [], 'UNSET', 'UNSET'],
          'payments POST provider/charges': ['INTERNAL', 30, 90, 'c4e1', 'payments POST /charge', 'payments POST /charge', 'CLIENT', [], 'UNSET', 'UNSET'],
          'checkout compute totals': ['INTERNAL', 5, 15, 'c4e1', 'checkout POST /checkout', 'checkout POST /checkout', 'INTERNAL', [], 'UNSET', 'UNSET'],
          'orders orders publish': ['INTERNAL', 130, 135, 'a1b2', null, null, 'PRODUCER', [], 'UNSET', 'UNSET'],
          'shipping orders process': ['INTERNAL', 150, 170, '7d3e', null, null, 'CONSUMER', ['orders orders publish'], 'UNSET', 'UNSET'],
        },
      },
      {
        choice: 'kinds',
        keys: ['loses-edge', 'nothing', 'provider'],
        right: 'loses-edge',
        says: { 'loses-edge': 'checkout → payments' },
      },
    ],
  },
  'status-and-errors': {
    prefix: 'status',
    level: { no: '2.3', mechanics: ['sort'], cards: ['span-status'], lights: ['catalog'], scoring: { parMs: null } },
    steps: [
      {
        sort: 'status-sort',
        buckets: ['ok', 'wrong'],
        // a storefront CLIENT 404 ERROR ok; b catalog SERVER 404 ERROR wrong (SERVER 4xx
        // stays Unset); c checkout SERVER 500 UNSET wrong; d inventory SERVER 200 UNSET ok;
        // e payments SERVER 503 ERROR ok (a 5xx is Error on a SERVER span).
        items: { a: 'ok', b: 'wrong', c: 'wrong', d: 'ok', e: 'ok' },
        says: {
          a: ['storefront CLIENT', 'GET /products/999', '404', 'status Error'],
          b: ['catalog SERVER', '404', 'status Error'],
          c: ['checkout SERVER', '500', 'status Unset'],
          d: ['inventory SERVER', '200', 'status Unset'],
          e: ['payments SERVER', 'POST /v1/charge', '503', 'status Error'],
        },
      },
      {
        choice: 'status',
        keys: ['error', 'stays-ok', 'unset'],
        right: 'stays-ok',
        says: { 'stays-ok': 'Ok' },
      },
    ],
  },
  baggage: {
    prefix: 'bag',
    level: { no: '2.5', mechanics: ['sort'], cards: ['baggage-leaks'], lights: [], scoring: { parMs: null } },
    steps: [
      {
        sort: 'bag-sort',
        buckets: ['ok', 'never'],
        items: { variant: 'ok', tier: 'ok', email: 'never', token: 'never', last4: 'never' },
        says: {
          variant: ['experiment.variant=redesign-B'],
          tier: ['tenant.tier=gold'],
          email: ['user.email'],
          token: ['session.token'],
          last4: ['card.last4'],
        },
      },
      {
        choice: 'bag',
        keys: ['only-if-copied', 'root-only', 'yes-auto'],
        right: 'only-if-copied',
        says: { 'only-if-copied': 'only if', 'yes-auto': 'Yes' },
      },
    ],
  },
  'context-propagation': {
    prefix: 'prop',
    level: { no: '2.4', mechanics: ['build'], cards: ['broken-propagation'], lights: ['orders'], scoring: { parMs: null } },
    steps: [
      {
        choice: 'prop',
        question: 'Where did the trace break?',
        keys: ['checkout', 'proxy', 'storefront'],
        right: 'proxy',
        says: { proxy: 'nginx', checkout: 'checkout', storefront: 'storefront' },
      },
      {
        choice: 'prop-tp',
        question: 'Which traceparent would checkout accept?',
        keys: ['short-parent', 'uppercase', 'valid', 'zero-trace'],
        right: 'valid',
        says: {
          valid: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          'zero-trace': '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
          uppercase: '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01',
          'short-parent': '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-01',
        },
      },
      {
        build: 'prop-tree',
        edit: ['parent'],
        spans: {
          'storefront POST /checkout': ['SERVER', 0, 100, '4bf9', null, null, 'SERVER', [], 'UNSET', 'UNSET'],
          'storefront POST checkout': ['CLIENT', 10, 90, '4bf9', 'storefront POST /checkout', 'storefront POST /checkout', 'CLIENT', [], 'UNSET', 'UNSET'],
          'checkout POST /checkout': ['SERVER', 15, 85, '4bf9', null, 'storefront POST checkout', 'SERVER', [], 'UNSET', 'UNSET'],
          'checkout POST orders': ['CLIENT', 30, 60, '4bf9', 'checkout POST /checkout', 'checkout POST /checkout', 'CLIENT', [], 'UNSET', 'UNSET'],
          'orders POST /orders': ['SERVER', 32, 58, '4bf9', 'checkout POST orders', 'checkout POST orders', 'SERVER', [], 'UNSET', 'UNSET'],
        },
      },
    ],
  },
  'events-and-links': {
    prefix: 'evl',
    level: { no: '2.6', mechanics: ['build'], cards: ['exception-no-status', 'batch-links'], lights: [], scoring: { parMs: null } },
    steps: [
      {
        choice: 'evl',
        question: 'What status does the span end with?',
        keys: ['error', 'event-only', 'unset'],
        right: 'unset',
        says: { unset: 'Unset', error: 'Error', 'event-only': 'span event' },
      },
      {
        build: 'evl-errors',
        edit: ['status'],
        spans: {
          'payments charge': ['INTERNAL', 0, 80, 'c9f0', null, null, 'INTERNAL', [], 'UNSET', 'ERROR'],
          'payments charge with retry': ['INTERNAL', 10, 40, 'd3d9', null, null, 'INTERNAL', [], 'ERROR', 'UNSET'],
          'inventory GET /stock': ['SERVER', 50, 60, 'e4da', null, null, 'SERVER', [], 'UNSET', 'UNSET'],
        },
      },
      {
        build: 'evl-batch',
        edit: ['links'],
        spans: {
          'orders orders publish 6512': ['PRODUCER', 0, 5, '6512', null, null, 'PRODUCER', [], 'UNSET', 'UNSET'],
          'orders orders publish c20a': ['PRODUCER', 10, 15, 'c20a', null, null, 'PRODUCER', [], 'UNSET', 'UNSET'],
          'orders orders publish c51c': ['PRODUCER', 20, 25, 'c51c', null, null, 'PRODUCER', [], 'UNSET', 'UNSET'],
          'notifications send batch': ['CONSUMER', 40, 70, 'aab3', null, null, 'CONSUMER', ['orders orders publish 6512', 'orders orders publish c20a', 'orders orders publish c51c'], 'UNSET', 'UNSET'],
        },
      },
    ],
  },
  'auto-vs-manual': {
    prefix: 'avm',
    level: { no: '2.7', mechanics: ['sort'], cards: ['double-instrumentation'], lights: ['cart'], scoring: { parMs: null } },
    steps: [
      {
        sort: 'avm-sort',
        buckets: ['auto', 'manual'],
        items: { server: 'auto', redis: 'auto', client: 'auto', loyalty: 'manual', coupon: 'manual', 'item-count': 'manual' },
        says: {
          server: ['SERVER spans', 'express route'],
          redis: ['Redis'],
          client: ['fetch', 'CLIENT spans'],
          loyalty: ['applyLoyaltyDiscount()'],
          coupon: ['app.coupon.code'],
          'item-count': ['app.cart.item_count'],
        },
      },
      {
        choice: 'avm-why',
        keys: ['collector', 'retries', 'two-setups'],
        right: 'two-setups',
        says: { 'two-setups': 'Two setups', retries: 'retries', collector: 'Collector' },
      },
      {
        choice: 'avm-fix',
        keys: ['dedupe', 'keep-one', 'sample'],
        right: 'keep-one',
        says: { 'keep-one': 'one', sample: '50%', dedupe: 'Collector' },
      },
    ],
  },
};

const LEVELS = {
  'spans-and-traces': [sat, SAT],
  'span-kinds': [kinds, KINDS],
  'status-and-errors': [status, STATUS],
  baggage: [baggage, BAGGAGE],
  'context-propagation': [prop, PROP],
  'events-and-links': [evl, EVL],
  'auto-vs-manual': [avm, AVM],
};

// The card fronts in docs/M1-DESIGN.md §6.
const FRONTS = {
  'no-trace-object': 'There is no trace object: a trace is just the spans that share a trace ID, each exported on its own.',
  'span-kind-edges': 'Span kind is not cosmetic: service maps draw edges from CLIENT to SERVER and PRODUCER to CONSUMER pairs.',
  'span-status': 'Status starts Unset. A 4xx is Error on the CLIENT span but stays Unset on the SERVER span. Ok is a final override.',
  'baggage-leaks': 'Baggage is not copied onto spans for you, and it travels in plain headers to every downstream, third parties too.',
  'broken-propagation': 'When a hop drops the traceparent header, one request becomes two traces: look for unexpected root spans.',
  'exception-no-status': 'An exception record and the span status are separate fields: recording one never sets the other. Set Error when the operation fails.',
  'batch-links': 'A span has at most one parent. A consumer handling a batch from many traces links to each message\'s context.',
  'double-instrumentation': 'Instrument the same library twice, say an injected agent plus your own SDK setup, and each call can appear twice.',
};

/** A span's pin key: `service name`, plus its trace's first four hex digits when another span shares both. */
const keyOf = (spans, s) => {
  const twin = spans.some((x) => x !== s && x.service === s.service && x.name === s.name);
  return `${s.service} ${s.name}${twin ? ` ${s.traceId.slice(0, 4)}` : ''}`;
};
const nameOf = (spans, id) => {
  const s = spans.find((x) => x.spanId === id);
  return s ? keyOf(spans, s) : null;
};

/** The reference answer applied to the spec's spans (fresh copies). */
function answered(spec) {
  return spec.spans.map((s) => ({ ...s, links: [...s.links], ...spec.answer[s.spanId] }));
}

/** A step of CONTENT as the pin's plain shape (strings, numbers, booleans only). */
function shape(step) {
  if (step.build) {
    const spec = step.build;
    const want = answered(spec);
    const spans = Object.fromEntries(
      spec.spans.map((s, i) => {
        const w = want[i];
        return [
          keyOf(spec.spans, s),
          [s.kind, s.startMs, s.endMs, s.traceId.slice(0, 4), nameOf(spec.spans, s.parentId), nameOf(spec.spans, w.parentId), w.kind, w.links.map((l) => nameOf(spec.spans, l)), s.status, w.status],
        ];
      }),
    );
    return { build: spec.id, edit: spec.edit, spans };
  }
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
    says: Object.fromEntries(step.choices.map((c) => [c.key, plain(c.label)])),
    question: step.question,
  };
}

for (const [id, [level, content]] of Object.entries(LEVELS)) {
  test(`${id}: answer tables match docs/M1-DESIGN.md §6`, () => {
    const pin = PIN[id];
    assert.equal(content.steps.length, pin.steps.length, 'step count');
    content.steps.forEach((step, i) => {
      const got = shape(step);
      const want = pin.steps[i];
      if (want.build) {
        assert.deepEqual(got, { build: want.build, edit: want.edit, spans: want.spans }, `step ${i + 1} build`);
        return;
      }
      if (want.sort) {
        assert.deepEqual({ sort: got.sort, buckets: got.buckets, items: got.items }, { sort: want.sort, buckets: want.buckets, items: want.items }, `step ${i + 1} sort`);
        for (const [item, words] of Object.entries(want.says)) {
          for (const w of words) assert.equal(got.says[item].includes(w), true, `${item} label "${got.says[item]}" says "${w}"`);
        }
        return;
      }
      assert.deepEqual({ choice: got.choice, keys: got.keys, right: got.right }, { choice: want.choice, keys: want.keys, right: want.right }, `step ${i + 1} choice`);
      if (want.question) assert.equal(got.question, want.question, `step ${i + 1} question`);
      for (const [key, words] of Object.entries(want.says)) {
        assert.equal(got.says[key].includes(words), true, `${key} label "${got.says[key]}" says "${words}"`);
      }
    });
  });

  test(`${id}: level fields (Act 2, scoring.parMs null, lights)`, () => {
    const p = PIN[id].level;
    assert.deepEqual(
      { no: level.no, mechanics: level.mechanics, cards: level.cards, lights: level.lights, scoring: level.scoring },
      p,
    );
    const built = LIVE.levels[id];
    assert.equal(built.actId, 'act-2');
    assert.equal(built.scored, true);
    assert.equal(built.scoring.parMs, null);
  });

  test(`${id}: the reference answers pass the widgets' own checkers (I7)`, () => {
    for (const step of content.steps) {
      if (step.build) {
        const spec = step.build;
        assert.deepEqual(validateBuildSpec(spec), [], `${spec.id} is a valid BuildSpec`);
        assert.equal(checkBuild(spec, newBuildState(spec)).ok, false, `${spec.id}: the given state is not already right`);
        const st = newBuildState(spec);
        const outcomes = [];
        for (const [sid, want] of Object.entries(spec.answer)) {
          if (Object.hasOwn(want, 'parentId')) outcomes.push(setParent(spec, st, sid, want.parentId));
          if (Object.hasOwn(want, 'kind')) outcomes.push(setKind(spec, st, sid, want.kind));
          if (Object.hasOwn(want, 'status')) outcomes.push(setStatus(spec, st, sid, want.status));
          for (const l of want.links ?? []) if (!st.spans[sid].links.includes(l)) outcomes.push(toggleLink(spec, st, sid, l) === 'linked' ? 'set' : 'unlinked');
        }
        assert.deepEqual([...new Set(outcomes)], ['set'], `${spec.id}: every reference edit is accepted`);
        assert.deepEqual(checkBuild(spec, st), { ok: true, issues: [] }, `${spec.id}: the reference passes checkBuild`);
      } else if (step.sort) {
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

test('spans-and-traces: the trace is 4bf9..., and the overlapping span sits in another trace', () => {
  const spec = SAT.steps[1].build;
  const ids = spec.spans.map((s) => s.traceId);
  assert.equal(ids.slice(0, 4).every((t) => t === TRACE), true);
  assert.equal(ids[4].startsWith('0af7'), true);
  // Parenting the other trace's span under api-gateway's POST /checkout is a cross-trace parent.
  const [, , c, , e] = spec.spans.map((s) => s.spanId);
  const st = newBuildState(spec);
  setParent(spec, st, e, c);
  assert.deepEqual(checkBuild(spec, st).issues.filter((i) => i.spanId === e).map((i) => i.code), ['cross-trace-parent']);
});

test('fixture B1 (test/fixtures/build-b1.mjs) is level 2.1\'s trace: same spans, same answer', () => {
  const spec = SAT.steps[1].build;
  const b1 = b1Spec();
  assert.equal(JSON.stringify(b1.spans), JSON.stringify(spec.spans));
  assert.equal(JSON.stringify(b1.answer), JSON.stringify(spec.answer));
  assert.equal(JSON.stringify(b1.edit), JSON.stringify(spec.edit));
});

test('span-kinds: the map edges come from serviceEdges, and /charge as INTERNAL loses checkout → payments', () => {
  const spec = KINDS.steps[0].build;
  const edges = (spans) => serviceEdges(spans).map((x) => `${x.from}>${x.to}:${x.via}`);
  assert.deepEqual(edges(spec.spans), [], 'all INTERNAL: no edges');
  const right = answered(spec);
  assert.deepEqual(edges(right), ['checkout>payments:client-server', 'orders>shipping:producer-consumer']);
  const charge = right.map((s) => (s.name === 'POST /charge' ? { ...s, kind: 'INTERNAL' } : s));
  assert.deepEqual(edges(charge), ['orders>shipping:producer-consumer']);
});

test('Act 2 card fronts match docs/M1-DESIGN.md §6 and fit a card (<=140)', () => {
  for (const [id, front] of Object.entries(FRONTS)) {
    const card = DECK.find((c) => c.id === id);
    assert.equal(card?.front, front, id);
    assert.equal(front.length <= 140, true, `${id} front is ${front.length} characters`);
    assert.equal(SPEC_HOSTS.includes(new URL(card.specUrl).host), true, `${id} specUrl ${card.specUrl}`);
  }
});

/** The level files of Act 2, from the live registry (never a hand list). */
const ACT2_FILES = LIVE.acts.find((a) => a.id === 'act-2').levelIds.map((id) => `levels/${id}.mjs`);

test('span-kinds copy says "backends derive", and no Act 2 level file says "the spec says"', () => {
  const text = read('levels/span-kinds.mjs') + JSON.stringify(DECK.find((c) => c.id === 'span-kind-edges'));
  assert.equal(/backends derive/i.test(text), true);
  assert.equal(ACT2_FILES.length, Object.keys(LEVELS).length, 'every Act 2 level file is scanned');
  for (const f of ACT2_FILES) {
    assert.equal(/the spec says/i.test(read(f)), false, f);
  }
});

test('baggage copy never calls baggage encrypted or private, and names the baggage span processor', () => {
  const text = read('levels/baggage.mjs') + JSON.stringify(DECK.find((c) => c.id === 'baggage-leaks'));
  assert.equal(/encrypt|private to|is secret/i.test(text), false);
  assert.equal(/baggage span processor/i.test(JSON.stringify(BAGGAGE)), true, 'the right answer names it');
});

test('status-and-errors: the sort follows the HTTP rule (4xx Error only on CLIENT, 5xx Error, 2xx Unset)', () => {
  // The status the HTTP semantic conventions give each span, from the kind and code in its label.
  const rule = (kind, code) => (code >= 500 || (code >= 400 && kind === 'CLIENT') ? 'Error' : 'Unset');
  for (const it of STATUS.steps[0].sort.items) {
    const label = plain(it.label);
    const [, kind] = label.match(/\b(CLIENT|SERVER)\b/);
    const [, code] = label.match(/\b([1-5]\d\d)\b/);
    const [, given] = label.match(/status (Error|Unset|Ok)\b/);
    assert.equal(it.bucket, given === rule(kind, Number(code)) ? 'ok' : 'wrong', `${it.id}: ${label}`);
  }
});

/** W3C Trace Context traceparent, version 00: lowercase hex, IDs not all zero. */
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

test('context-propagation: only the right traceparent is valid, and its parent-id is checkout\'s parent', () => {
  const choices = PROP.steps[1].choices;
  const valid = choices.filter((c) => TRACEPARENT.test(plain(c.label))).map((c) => c.key);
  assert.deepEqual(valid, ['valid']);
  const [, traceId, parentId] = plain(choices.find((c) => c.right).label).split('-');
  const spec = PROP.steps[2].build;
  const checkout = spec.spans.find((s) => s.service === 'checkout' && s.kind === 'SERVER');
  assert.equal(spec.answer[checkout.spanId].parentId, parentId, 'the parent named by parent-id');
  assert.equal(spec.spans.every((s) => s.traceId === traceId), true, 'every span carries the header\'s trace ID');
  assert.equal(checkout.parentId, null, 'checkout starts as a root');
});

test('context-propagation: the hops show nginx dropping traceparent, and the break makes two roots', () => {
  const hops = PROP.steps[0].hops;
  assert.deepEqual(hops.map((h) => `${h.from}>${h.to}`), ['storefront>nginx', 'nginx>checkout']);
  assert.equal(TRACEPARENT.test(hops[0].traceparent), true, 'storefront sends a valid traceparent');
  assert.equal(hops[1].traceparent, null, 'nginx forwards none');
  const roots = PROP.steps[0].roots;
  assert.equal(roots.length, 2);
  assert.notEqual(roots[0].traceId, roots[1].traceId, 'two traces');
});

test('events-and-links: an exception record never decides the status; a failed charge is Error, a retried one that went through Unset', () => {
  const spec = EVL.steps[1].build;
  const want = Object.fromEntries(answered(spec).map((s) => [s.name, s.status]));
  assert.deepEqual(want, { charge: 'ERROR', 'charge with retry': 'UNSET', 'GET /stock': 'UNSET' });
  const charge = spec.spans.find((s) => s.name === 'charge');
  assert.deepEqual(charge.events.map((e) => e.name), ['exception'], 'charge recorded its exception');
  assert.equal(charge.status, 'UNSET', 'and the record left its status Unset');
  for (const s of spec.spans.filter((x) => x.name !== 'charge')) {
    assert.deepEqual(s.events, [], `${s.name}: nothing recorded`);
  }
  const why = plain(EVL.steps[0].choices.find((c) => c.right).why);
  assert.equal(/span event/.test(why) && /log record/.test(why), true, 'however it is recorded');
});

test('events-and-links: the batch consumer is a root that links one publish from each of three traces', () => {
  const spec = EVL.steps[2].build;
  const send = spec.spans.find((s) => s.name === 'send batch');
  assert.equal(send.kind, 'CONSUMER');
  assert.equal(send.parentId, null);
  const linked = spec.answer[send.spanId].links.map((id) => spec.spans.find((s) => s.spanId === id));
  assert.deepEqual(linked.map((s) => `${s.kind} ${s.name}`), ['PRODUCER orders publish', 'PRODUCER orders publish', 'PRODUCER orders publish']);
  assert.equal(new Set([send.traceId, ...linked.map((s) => s.traceId)]).size, 4, 'four traces');
  const edges = serviceEdges(answered(spec)).map((x) => `${x.from}>${x.to}:${x.via}`);
  assert.deepEqual(edges, ['orders>notifications:producer-consumer']);
});

test('events-and-links: the exception card names the semconv deprecation and the Stable Trace API', () => {
  const back = DECK.find((c) => c.id === 'exception-no-status')?.back ?? '';
  assert.equal(/log record/.test(back) && /Deprecated/.test(back) && /Stable/.test(back), true, back);
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

/** The Build spec of `id`'s step `i`, and its span ids by `service name`. */
function buildOf(id, i) {
  const spec = LEVELS[id][1].steps[i].build;
  const ids = Object.fromEntries(spec.spans.map((s) => [keyOf(spec.spans, s), s.spanId]));
  return { spec, ids };
}

const put = (item, bucket) => {
  click(`[data-item="${item}"]`);
  click(`[data-bucket="${bucket}"]`);
};
/** Sort every pinned item of `step` into its bucket. */
const sortStep = (step) => {
  for (const [item, bucket] of Object.entries(step.items)) put(item, bucket);
};

/**
 * Make the pinned edits of build step `i` in the DOM (parents, kinds, statuses, links), then
 * Check when the step has a Check button (with instant feedback the last right edit completes
 * it, #146). With the arrival queue, the span arriving now is placed even when its parent stays
 * the given one (a root); pins list spans in arrival order.
 */
function solveBuild(id, i) {
  const pin = PIN[id].steps[i];
  const { ids } = buildOf(id, i);
  for (const [name, [kind, , , , given, parent, wantKind, links, status, wantStatus]] of Object.entries(pin.spans)) {
    const edits = [];
    const arriving = qa('[data-arriving]').some((r) => r.dataset.span === ids[name]);
    if (pin.edit.includes('parent') && (parent !== given || arriving)) edits.push(`[data-parent="${parent === null ? 'none' : ids[parent]}"]`);
    if (pin.edit.includes('kind') && wantKind !== kind) edits.push(`[data-kind="${wantKind}"]`);
    if (pin.edit.includes('status') && wantStatus !== status) edits.push(`[data-status="${wantStatus}"]`);
    if (pin.edit.includes('links')) for (const l of links) edits.push(`[data-link="${ids[l]}"]`);
    if (edits.length === 0) continue;
    click(`[data-span="${ids[name]}"]`);
    // A link already pressed (by an earlier slip) stays: clicking it again would unlink it.
    for (const sel of edits) {
      const linked = sel.startsWith('[data-link') && q(sel).getAttribute('aria-pressed') === 'true';
      if (!linked) click(sel);
    }
  }
  if (qa(`#${pin.build}-check`).length) click(`#${pin.build}-check`);
}

/**
 * Play `id` through from a clean start; `slips[i]` (a function) runs at the start of
 * step i, before the right answers. Returns the stars earned.
 */
function runWith(id, slips = {}) {
  const { finished } = start(id);
  const { prefix, steps } = PIN[id];
  steps.forEach((step, i) => {
    slips[i]?.();
    if (step.build) solveBuild(id, i);
    else if (step.sort) sortStep(step);
    else click(`[data-pick="${step.right}"]`);
    click(i === steps.length - 1 ? '[data-finish]' : `#${prefix}-next`);
  });
  assert.equal(finished.length, 1, 'finished once');
  return finished[0];
}

const SAT_IDS = () => buildOf('spans-and-traces', 1).ids;

const SLIPS = {
  'spans-and-traces': {
    'a wrong pick in the first question': { 0: () => click('[data-pick="trace-object"]') },
    // 2.1 has instant feedback and the arrival queue (#146): no Check button, and GET /products waits.
    'a wrong drop (the arriving CLIENT span made a root)': {
      1: () => {
        click(`[data-span="${SAT_IDS()['storefront POST']}"]`);
        click('[data-parent="none"]');
      },
    },
    'one hint tier': { 1: () => click('#sat-tree-hint') },
    'a wrong pick in the last question': { 2: () => click('[data-pick="lost-parent"]') },
  },
  'span-kinds': {
    // 2.2 has instant feedback (#146): a wrong kind costs at once.
    'a wrong kind (POST /charge called CLIENT)': {
      0: () => {
        click(`[data-span="${buildOf('span-kinds', 0).ids['payments POST /charge']}"]`);
        click('[data-kind="CLIENT"]');
      },
    },
    'a wrong pick in the question': { 1: () => click('[data-pick="nothing"]') },
  },
  'status-and-errors': {
    'a wrong placement (the SERVER 404 called right)': { 0: () => put('b', 'ok') },
    'a wrong placement (the SERVER 200 called wrong)': { 0: () => put('d', 'wrong') },
    'a wrong pick in the question (the last call wins)': { 1: () => click('[data-pick="error"]') },
  },
  baggage: {
    'a wrong placement (an email in baggage)': { 0: () => put('email', 'ok') },
    'a wrong placement (the experiment arm kept out)': { 0: () => put('variant', 'never') },
    'a wrong pick in the question (copied for you)': { 1: () => click('[data-pick="yes-auto"]') },
  },
  'context-propagation': {
    'a wrong pick in the first question (storefront blamed)': { 0: () => click('[data-pick="storefront"]') },
    'a wrong pick in the traceparent question (uppercase hex)': { 1: () => click('[data-pick="uppercase"]') },
    'a wrong pick in the traceparent question (all-zero trace ID)': { 1: () => click('[data-pick="zero-trace"]') },
    'a failed check (checkout left a root)': { 2: () => click('#prop-tree-check') },
  },
  'events-and-links': {
    'a wrong pick in the question (the event sets Error)': { 0: () => click('[data-pick="error"]') },
    'a failed check (charge fixed, the retried charge left Error)': {
      1: () => {
        const ids = buildOf('events-and-links', 1).ids;
        click(`[data-span="${ids['payments charge']}"]`);
        click('[data-status="ERROR"]');
        click('#evl-errors-check');
      },
    },
    'a failed check (two of the three links)': {
      2: () => {
        const ids = buildOf('events-and-links', 2).ids;
        click(`[data-span="${ids['notifications send batch']}"]`);
        click(`[data-link="${ids['orders orders publish 6512']}"]`);
        click(`[data-link="${ids['orders orders publish c20a']}"]`);
        click('#evl-batch-check');
      },
    },
  },
  'auto-vs-manual': {
    'a wrong placement (the Redis spans called manual)': { 0: () => put('redis', 'manual') },
    'a wrong placement (the loyalty span called automatic)': { 0: () => put('loyalty', 'auto') },
    'a wrong pick in the first question (retries blamed)': { 1: () => click('[data-pick="retries"]') },
    'a wrong pick in the fix question (sample 50%)': { 2: () => click('[data-pick="sample"]') },
  },
};


for (const [id, slips] of Object.entries(SLIPS)) {
  test(`${id}: a clean run earns 5 stars and its card, and each penalty alone costs one`, () => {
    const clean = runWith(id);
    assert.equal(clean.stars, 5, 'a clean run');
    assert.deepEqual(clean.cards, PIN[id].level.cards);
    for (const [name, slip] of Object.entries(slips)) {
      assert.equal(runWith(id, slip).stars, 4, name);
    }
  });
}

test('context-propagation: an identical failed recheck is free (one slip, 4 stars)', () => {
  const slip = {
    2: () => {
      click('#prop-tree-check');
      click('#prop-tree-check');
    },
  };
  assert.equal(runWith('context-propagation', slip).stars, 4);
});

test('spans-and-traces: the same wrong drop twice costs once (one slip, 4 stars)', () => {
  const slip = {
    1: () => {
      for (let k = 0; k < 2; k++) {
        click(`[data-span="${SAT_IDS()['storefront POST']}"]`);
        click('[data-parent="none"]');
      }
    },
  };
  assert.equal(runWith('spans-and-traces', slip).stars, 4);
});

test('every Act 2 step waits for its answer and states each outcome in words', () => {
  for (const id of Object.keys(PIN)) {
    start(id);
    const { prefix, steps } = PIN[id];
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      const gate = () => q(last ? '[data-finish]' : `#${prefix}-next`).disabled;
      assert.equal(gate(), true, `${id} step ${i + 1}: gated before the answer`);
      if (step.build) {
        const fb = () => q(`#${step.build}-feedback`).textContent;
        if (qa(`#${step.build}-check`).length) {
          click(`#${step.build}-check`);
          assert.match(fb(), /^Not yet: \d+ problems?\./, `${id}: a failed check says so`);
        } else {
          // Instant feedback (#146): a wrong move is named in the status line at once.
          if (step.edit.includes('kind')) {
            const [name, pinned] = Object.entries(step.spans).find(([, p]) => p[6] !== p[0]);
            click(`[data-span="${buildOf(id, i).ids[name]}"]`);
            click(`[data-kind="${['SERVER', 'CLIENT', 'PRODUCER'].find((k) => k !== pinned[6] && k !== pinned[0])}"]`);
          } else {
            click('[data-arriving]'); // the arriving span made a root; its parent is a placed span
            click('[data-parent="none"]');
          }
          assert.match(q(`#${step.build}-status`).textContent, /but not quite\./, `${id}: a wrong move says so`);
        }
        assert.equal(gate(), true);
        solveBuild(id, i);
        assert.equal(fb(), 'Right. Every span checks out.', `${id}: a passing check says so`);
      } else if (step.sort) {
        const fb = () => q(`#${step.sort}-feedback`).textContent;
        const [item, bucket] = Object.entries(step.items)[0];
        put(item, step.buckets.find((b) => b !== bucket));
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

test('spans-and-traces: the cross-trace parent is named in words, with both trace ids', () => {
  start('spans-and-traces');
  click('[data-pick="trace-id"]');
  click('#sat-next');
  const ids = SAT_IDS();
  for (const [span, parent] of [['storefront POST', 'storefront POST /checkout'], ['api-gateway POST /checkout', 'storefront POST'], ['api-gateway validate cart', 'api-gateway POST /checkout']]) {
    click(`[data-span="${ids[span]}"]`);
    click(`[data-parent="${ids[parent]}"]`);
  }
  click(`[data-span="${ids['storefront GET /products']}"]`);
  click(`[data-parent="${ids['api-gateway POST /checkout']}"]`);
  assert.equal(q('#sat-tree-status').textContent.includes('GET /products (storefront) carries trace id 0af76519, POST /checkout (api-gateway) carries 4bf92f35. Different trace ids'), true);
});

test('span-kinds: the "Map edges" line is a status region, from serviceEdges before and after', () => {
  start('span-kinds');
  const line = () => q('#kinds-edges');
  assert.equal(line().getAttribute('role'), 'status');
  assert.equal(line().textContent, 'Map edges: none.');
  solveBuild('span-kinds', 0);
  assert.equal(line().textContent, 'Map edges: checkout → payments, orders → shipping.');
});

test('focus walk: each step starts on its first control, moves on, and ends on Finish', () => {
  for (const id of Object.keys(PIN)) {
    const { focus } = start(id);
    const { prefix, steps } = PIN[id];
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      if (step.build) {
        // With the arrival queue the arriving span takes focus (#146), else the first row.
        const firstRow = (qa('[data-arriving]')[0] ?? qa('[data-span]')[0]).dataset.span;
        assert.equal(focus.last(), `span:${firstRow}`, `${id} step ${i + 1} starts on its first span`);
        solveBuild(id, i);
        // A solved Build it step focuses its success heading; its Next or Finish is open.
        assert.equal(focus.last(), `#${step.build}-win-title`, `${id} step ${i + 1} announces the success card`);
        assert.equal(q(last ? `#${prefix}-finish` : `#${prefix}-next`).disabled, false);
        if (!last) click(`#${prefix}-next`);
        return;
      } else if (step.sort) {
        const firstItem = qa('[data-item]')[0].dataset.item;
        assert.equal(focus.last(), `item:${firstItem}`, `${id} step ${i + 1} starts on its first item`);
        sortStep(step);
      } else {
        assert.equal(focus.last().startsWith('pick:'), true, `${id} step ${i + 1} starts on a choice`);
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

test('auto-vs-manual: the card back says duplicates depend on the instrumentation, with fetch client spans as today\'s case', () => {
  const card = DECK.find((c) => c.id === 'double-instrumentation');
  assert.equal(/depend/i.test(card.back), true, 'duplicates depend on the instrumentation');
  assert.equal(/fetch/i.test(card.back) && /undici/i.test(card.back), true, 'fetch/undici client spans are named');
  assert.equal(/every (request|span)/i.test(card.back), false, 'no claim that everything doubles');
  assert.equal(/zero-code\/js/.test(read('levels/auto-vs-manual.mjs')), true, 'the level cites the zero-code JS page');
});

test('auto-vs-manual: step 2 names the fetch CLIENT spans and both setups, not doubled requests', () => {
  const src = read('levels/auto-vs-manual.mjs');
  for (const w of ['fetch', 'CLIENT', 'NODE_OPTIONS', 'tracing.js', 'getNodeAutoInstrumentations()']) {
    assert.equal(src.includes(w), true, w);
  }
  assert.equal(/every request twice/i.test(src), false);
});
