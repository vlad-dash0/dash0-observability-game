// The Configure it help ladder core (#159 C1): lib/widgets/configure-it-help.mjs.
// Helps and validation, and the three hint tiers, derived from the answer through the
// checker's one reader (pipelineStages) and the player's run through runConfigure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pipelines from '../levels/pipelines.mjs';
import { SCHEMAS, newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';
import { checkConfig, pipelineStages } from '../lib/configure/check.mjs';
import {
  CONFIGURE_HELPS, CONFIGURE_RULE, configureHelps, hintFor, validateConfigureHelps,
} from '../lib/widgets/configure-it-help.mjs';

const BASE = pipelines.play.steps[1].configure; // uses memory_limiter in traces and metrics
const spec = (extra = {}) => ({ ...BASE, helps: { hints: true }, ...extra });
const REF = BASE.reference;
const state = () => newConfigureState();
const tier2 = (s, text, st = state()) => hintFor(s, st, text, 2).html;

// ---- helps / validation -------------------------------------------------------------------

test('CONFIGURE_HELPS has one help, hints', () => {
  assert.deepEqual(CONFIGURE_HELPS.map(([k, l]) => `${k}:${l}`), ['hints:Hints']);
});

test('configureHelps: hints on only when the step says so', () => {
  assert.equal(configureHelps(spec()).hints, true);
  assert.equal(configureHelps(spec({ helps: { hints: false } })).hints, false);
  assert.equal(configureHelps(spec({ helps: undefined })).hints, false);
  assert.equal(configureHelps(spec({ helps: {} })).hints, false);
});

test('validateConfigureHelps names a bad key, a non-boolean, a bad hint and a hint with hints off', () => {
  assert.deepEqual(validateConfigureHelps(spec()), []);
  assert.deepEqual(validateConfigureHelps(spec({ helps: undefined, hint: undefined })), []);
  assert.deepEqual(validateConfigureHelps(spec({ helps: { hints: true, queue: true } })), ['helps: "queue" is not one of hints']);
  assert.deepEqual(validateConfigureHelps(spec({ helps: { hints: 'yes' } })), ['helps: "hints" is not true or false']);
  assert.deepEqual(validateConfigureHelps(spec({ hint: ' ' })), ['hint: not non-empty text']);
  assert.deepEqual(validateConfigureHelps(spec({ helps: { hints: false } })), ['hint: shown only when helps.hints is on']);
  assert.deepEqual(validateConfigureHelps(spec({ helps: undefined })), ['hint: shown only when helps.hints is on']);
});

// ---- tier 1 --------------------------------------------------------------------------------

test('hintFor tier 1: the authored hint, else the rule, in a <p>; no apply', () => {
  assert.equal(CONFIGURE_RULE, 'Follow each signal from its receiver to its exporter: every name a pipeline lists must be defined, under exactly that id, in its section.');
  assert.deepEqual(hintFor(spec({ hint: 'Look <b>here</b>.' }), state(), '', 1), { html: '<p>Look <b>here</b>.</p>' });
  assert.deepEqual(hintFor(spec({ hint: undefined }), state(), 'x: 1', 1), { html: `<p>${CONFIGURE_RULE}</p>` });
});

// ---- tier 2 --------------------------------------------------------------------------------

const without = (text, id) => text.replace(`[memory_limiter, ${id}]`, `[${id}]`).replace(`[${id}, memory_limiter]`, `[${id}]`);

test('tier 2 reads the answer counts, not the player: uses batch, player lacks batch in traces', () => {
  const s = spec({ uses: { traces: ['batch'] }, target: undefined });
  const player = REF.replace('      processors: [memory_limiter, batch]', '      processors: [memory_limiter]'); // first (traces) only
  assert.equal(runConfigure(s, state(), player).reason, 'uses');
  assert.equal(tier2(s, player),
    '<p>In the answer, the traces pipeline lists 1 receiver, 2 processors and 1 exporter; yours lists 1 receiver, 1 processor and 1 exporter. One component the task needs belongs under processors.</p>');
});

test('tier 2 picks the first unmet pipeline: metrics when only metrics is stalled; invalid uses the first required pipeline not flowing', () => {
  const player = REF.replace(/(metrics:\n {6}receivers: \[otlp\]\n {6}processors: \[memory_limiter, batch\]\n {6}exporters: )\[otlp_grpc\/dash0\]/, '$1[otlp_grpc/dash0x]');
  assert.equal(runConfigure(spec(), state(), player).reason, 'invalid');
  assert.match(tier2(spec(), player), /the metrics pipeline lists 1 receiver, 2 processors and 1 exporter; yours lists 1 receiver, 2 processors and 1 exporter\.<\/p>$/);
});

test('tier 2 with no such pipeline in the player config', () => {
  const player = REF.replace(/ {4}metrics:[\s\S]*$/, '');
  assert.equal(tier2(spec({ uses: { metrics: ['memory_limiter'] }, target: undefined }), player),
    '<p>In the answer, the metrics pipeline lists 1 receiver, 2 processors and 1 exporter. Yours has no metrics pipeline yet.</p>');
});

test('tier 2 with text that does not read, or none', () => {
  const unread = '<p>In the answer, the traces pipeline lists 1 receiver, 2 processors and 1 exporter. Yours cannot be read yet.</p>';
  assert.equal(tier2(spec(), 'a: [unclosed'), unread);
  assert.equal(tier2(spec(), ''), unread);
});

test('tier 2 when the player already passes', () => {
  assert.equal(tier2(spec(), REF), '<p>Yours already passes: press Check.</p>');
});

test('tier 2 never names a component id from the answer, for any pipeline', () => {
  const ids = new Set();
  const ref = checkConfig(REF, SCHEMAS.collector);
  for (const name of ['traces', 'metrics', 'logs']) {
    for (const { items } of pipelineStages(ref, SCHEMAS.collector, name)) for (const [, id] of items) ids.add(id);
  }
  assert.ok(ids.has('memory_limiter') && ids.has('batch'));
  const texts = [BASE.given, '', 'a: [', without(REF, 'batch'), REF.replace(/ {4}metrics:[\s\S]*$/, ''), REF];
  for (const text of texts) {
    for (const s of [spec(), spec({ uses: { traces: ['batch'] }, target: undefined })]) {
      const html = tier2(s, text);
      for (const id of ids) assert.equal(html.includes(id), false, `${id} in ${html}`);
    }
  }
});

test('hintFor does not touch the state: deep-equal, tried does not grow', () => {
  const st = { tried: ['a: 1'], solved: false };
  const copy = structuredClone(st);
  for (const text of [BASE.given, 'b: 2', '', 'a: [', REF]) {
    for (const tier of [1, 2, 3]) hintFor(spec(), st, text, tier);
  }
  assert.deepEqual(st, copy);
  assert.equal(st.tried.length, 1);
});

test('tier 2 escapes pipeline names', () => {
  const s = spec({ target: ['t<b>'], uses: undefined });
  assert.equal(s.target[0], 't<b>');
  const html = hintFor(s, state(), '', 2, { e: (v) => `[${v}]` }).html;
  assert.match(html, /the \[t<b>\] pipeline/);
});

// ---- tier 3 --------------------------------------------------------------------------------

test('tier 3: apply is the reference and runs as right; outlines nothing', () => {
  const h = hintFor(spec(), state(), 'junk', 3);
  assert.equal(h.html, '<p>Filled in for you: a config that passes.</p>');
  assert.equal(runConfigure(spec(), newConfigureState(), h.apply).outcome, 'right');
});
