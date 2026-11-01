// lib/widgets/configure-it.mjs: the Configure it core (spec validation and grading).
// Spec: docs/M1-DESIGN.md §4.9. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMAS, newConfigureState, normalizeConfig, runConfigure, validateConfigureSpec,
} from '../lib/widgets/configure-it.mjs';

const REF = `receivers:
  otlp:
exporters:
  otlp/dash0:
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp/dash0]
`;
const GIVEN = REF.replace('[otlp/dash0]', '[otlp/dash0x]');

const spec = (extra = {}) => ({
  id: 'cfg', schema: 'collector', given: GIVEN, reference: REF, target: ['traces'], explain: 'The name must match.', ...extra,
});

test('a good spec has no problems; SCHEMAS names the collector schema', () => {
  assert.deepEqual(validateConfigureSpec(spec()), []);
  assert.deepEqual(validateConfigureSpec(spec({ target: undefined, hint: 'Look at the exporter.' })), []);
  assert.deepEqual(Object.keys(SCHEMAS), ['collector']);
});

test('validateConfigureSpec names every problem and never throws', () => {
  const cases = [
    [{ id: 'Bad Id' }, 'spec id "Bad Id" is not kebab-case'],
    [{ explain: ' ' }, 'explain is not non-empty text'],
    [{ hint: 3 }, 'hint is not non-empty text'],
    [{ schema: 'nope' }, 'unknown schema "nope" (one of collector)'],
    [{ given: undefined }, 'given is not non-empty text'],
    [{ reference: '' }, 'reference is not non-empty text'],
    [{ target: [] }, 'target must be a non-empty list of pipeline names'],
    [{ target: ['traces', 'traces'] }, 'target names "traces" twice'],
    [{ target: [3] }, 'target must be a non-empty list of pipeline names'],
    [{ reference: GIVEN }, 'reference: service.pipelines.traces.exporters[0]: "otlp/dash0x" is not defined under exporters or connectors'],
    [{ given: REF }, 'given: already passes the checker, so there is nothing to fix'],
    [{ target: ['metrics'] }, 'target "metrics": the reference has no flowing pipeline with that name'],
    [{ reference: 'a: [' }, 'reference: line 1, column 5: unexpected end of the stream within a flow collection'],
  ];
  for (const [edit, want] of cases) {
    const got = validateConfigureSpec(spec(edit));
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
  for (const v of [undefined, null, 4, 'x', [], { id: 'a', get given() { throw new Error('boom'); } }]) {
    assert.ok(validateConfigureSpec(v).length > 0, String(v));
  }
});

test('normalizeConfig: line endings, trailing spaces and outer blank lines do not make a different config', () => {
  assert.equal(normalizeConfig('a: 1  \r\nb: 2\r\n\r\n'), normalizeConfig('\na: 1\nb: 2'));
  assert.notEqual(normalizeConfig('a:\n  b: 1'), normalizeConfig('a:\n b: 1'));
});

test('blank text is free and not remembered', () => {
  const s = newConfigureState();
  const r = runConfigure(spec(), s, '  \n ');
  assert.equal(r.outcome, 'blank');
  assert.deepEqual(r.state, { tried: [], solved: false });
});

test('the reference is right and locks the state; a solved state changes nothing', () => {
  const r = runConfigure(spec(), newConfigureState(), REF);
  assert.equal(r.outcome, 'right');
  assert.equal(r.state.solved, true);
  assert.equal(runConfigure(spec(), r.state, GIVEN).outcome, 'solved');
});

test('an equivalent config written differently is right too', () => {
  const alt = REF.replace('[otlp]', '\n      - otlp').replace('[otlp/dash0]', '[ otlp/dash0 ]');
  assert.equal(runConfigure(spec(), newConfigureState(), alt).outcome, 'right');
});

test('a config with schema errors is wrong (reason invalid), remembered, and carries the errors', () => {
  const r = runConfigure(spec(), newConfigureState(), GIVEN);
  assert.equal(r.outcome, 'wrong');
  assert.equal(r.reason, 'invalid');
  assert.equal(r.result.errors[0].kind, 'unknown-ref');
  assert.deepEqual(r.state.tried, [normalizeConfig(GIVEN)]);
});

test('a valid config that does not meet the target is wrong (reason target) with the unmet names', () => {
  const other = REF.replace('traces:', 'metrics:');
  const r = runConfigure(spec(), newConfigureState(), other);
  assert.equal(r.outcome, 'wrong');
  assert.equal(r.reason, 'target');
  assert.deepEqual(r.unmet, ['traces']);
  const none = runConfigure(spec({ target: undefined }), newConfigureState(), other);
  assert.equal(none.outcome, 'right');
});

test('the same failing text again is a free repeat; a different failing one is wrong again', () => {
  let r = runConfigure(spec(), newConfigureState(), GIVEN);
  r = runConfigure(spec(), r.state, `${GIVEN}\n\n`);
  assert.equal(r.outcome, 'repeat');
  assert.equal(r.result.errors.length, 1);
  assert.equal(r.state.tried.length, 1);
  r = runConfigure(spec(), r.state, `${GIVEN}zz: 1\n`);
  assert.equal(r.outcome, 'wrong');
  assert.equal(r.state.tried.length, 2);
});

test('a file-level error is free (outcome parse), never remembered, however often', () => {
  let r = runConfigure(spec(), newConfigureState(), 'a: b: c');
  assert.equal(r.outcome, 'parse');
  assert.equal(r.result.errors[0].kind, 'parse');
  assert.deepEqual(r.state.tried, []);
  r = runConfigure(spec(), r.state, '- 1');
  assert.equal(r.outcome, 'parse');
  assert.equal(r.result.errors[0].kind, 'root');
});

test('a checker that throws is a free "crash", whatever it throws, and is not remembered', () => {
  for (const boom of [new Error('boom'), new TypeError('x'), 'a string', null]) {
    const check = () => { throw boom; };
    const r = runConfigure(spec(), newConfigureState(), GIVEN, { check });
    assert.equal(r.outcome, 'crash');
    assert.deepEqual(r.state, { tried: [], solved: false });
  }
});

test('the checker is called with the text and the spec schema', () => {
  const seen = [];
  const check = (text, schema) => { seen.push([text, schema === SCHEMAS.collector]); return { ok: false, errors: [], doc: null, verdict: null }; };
  runConfigure(spec(), newConfigureState(), REF, { check });
  assert.deepEqual(seen, [[REF, true]]);
});

// `uses` (#97): components a pipeline must list.
const USES_REF = `receivers:
  otlp:
processors:
  batch:
exporters:
  otlp/dash0:
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/dash0]
`;
// Valid and flowing, but the traces pipeline no longer lists batch.
const NO_BATCH = USES_REF.replace('      processors: [batch]\n', '').replace('processors:\n  batch:\n', '');
const USES_GIVEN = USES_REF.replace('[otlp/dash0]', '[otlp/dash0x]');
const usesSpec = (extra = {}) => spec({ given: USES_GIVEN, reference: USES_REF, uses: { traces: ['batch'] }, ...extra });

test('a spec with uses is valid; uses on its own also names the pipelines that must flow', () => {
  assert.deepEqual(validateConfigureSpec(usesSpec()), []);
  assert.deepEqual(validateConfigureSpec(usesSpec({ target: undefined })), []);
  assert.deepEqual(validateConfigureSpec(usesSpec({ uses: { traces: ['otlp', 'batch', 'otlp/dash0'] } })), []);
});

test('uses is checked at load: its shape, the reference (I7), and that given does not already pass', () => {
  const cases = [
    [{ uses: [] }, 'uses must be a mapping of pipeline names to non-empty lists of component ids'],
    [{ uses: {} }, 'uses must be a mapping of pipeline names to non-empty lists of component ids'],
    [{ uses: 'batch' }, 'uses must be a mapping of pipeline names to non-empty lists of component ids'],
    [{ uses: { traces: [] } }, 'uses "traces" must be a non-empty list of component ids'],
    [{ uses: { traces: 'batch' } }, 'uses "traces" must be a non-empty list of component ids'],
    [{ uses: { traces: [3] } }, 'uses "traces" must be a non-empty list of component ids'],
    [{ uses: { traces: [' '] } }, 'uses "traces" must be a non-empty list of component ids'],
    [{ uses: { traces: ['batch', 'batch'] } }, 'uses "traces" names "batch" twice'],
    [{ uses: { traces: ['memory_limiter'] } }, 'uses "traces": the reference does not list "memory_limiter"'],
    [{ uses: { metrics: ['batch'] } }, 'uses "metrics": the reference has no flowing pipeline with that name'],
    [{ given: NO_BATCH }, 'given: already passes the checker, so there is nothing to fix'],
  ];
  for (const [edit, want] of cases) {
    const got = validateConfigureSpec(usesSpec(edit));
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
});

test('a config that flows but leaves a required component out is wrong (reason uses) with the pipeline, not the ids', () => {
  const r = runConfigure(usesSpec(), newConfigureState(), NO_BATCH);
  assert.equal(r.outcome, 'wrong');
  assert.equal(r.reason, 'uses');
  assert.deepEqual(r.unmet, ['traces']);
  assert.deepEqual(r.state.tried, [normalizeConfig(NO_BATCH)]);
  assert.equal(JSON.stringify(r.unmet).includes('batch'), false);
});

test('any stage counts, and the ids match exactly', () => {
  const exporter = usesSpec({ uses: { traces: ['otlp/dash0'] } });
  assert.equal(runConfigure(exporter, newConfigureState(), USES_REF).outcome, 'right');
  const receiver = usesSpec({ uses: { traces: ['otlp'] } });
  assert.equal(runConfigure(receiver, newConfigureState(), USES_REF).outcome, 'right');
  const wrongId = usesSpec({ uses: { traces: ['batch'] } });
  const renamed = USES_REF.replaceAll('batch', 'batch/2');
  assert.equal(runConfigure(wrongId, newConfigureState(), renamed).reason, 'uses');
});

test('every listed component is needed, and the reference passes', () => {
  const both = usesSpec({ uses: { traces: ['batch', 'otlp'] } });
  assert.equal(runConfigure(both, newConfigureState(), USES_REF).outcome, 'right');
  const half = USES_REF.replace('receivers: [otlp]', 'receivers: [otlp2]').replace('  otlp:\n', '  otlp2:\n');
  assert.equal(runConfigure(both, newConfigureState(), half).reason, 'uses');
});

test('a failing uses config again is a free repeat; a pipeline named only in uses must flow (reason target)', () => {
  let r = runConfigure(usesSpec(), newConfigureState(), NO_BATCH);
  r = runConfigure(usesSpec(), r.state, `${NO_BATCH}\n\n`);
  assert.equal(r.outcome, 'repeat');
  const metricsOnly = USES_REF.replace('traces:', 'metrics:');
  const t = runConfigure(usesSpec({ target: undefined }), newConfigureState(), metricsOnly);
  assert.equal(t.reason, 'target');
  assert.deepEqual(t.unmet, ['traces']);
});

test('a config with schema errors stays invalid, before uses is considered', () => {
  assert.equal(runConfigure(usesSpec(), newConfigureState(), USES_GIVEN).reason, 'invalid');
});
