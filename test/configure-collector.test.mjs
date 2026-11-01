// The Collector schema and the pipeline verdict. Spec: docs/M1-DESIGN.md §4.8.
// Config shape: https://opentelemetry.io/docs/collector/configuration/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, referenceProblems } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { validateSchema } from '../lib/configure/schema.mjs';

const check = (text) => checkConfig(text, COLLECTOR_SCHEMA);
const GOOD = `
receivers:
  otlp:
    protocols:
      grpc:
processors:
  batch:
exporters:
  otlp/backend:
    endpoint: collector.example:4317
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/backend]
`;
// The same config with the second exporter name mistyped.
const withExporters = (list) => GOOD.replace('[otlp/backend]', list);

test('the Collector schema is itself valid and frozen', () => {
  assert.deepEqual(validateSchema(COLLECTOR_SCHEMA), []);
  assert.equal(Object.isFrozen(COLLECTOR_SCHEMA), true);
  assert.equal(Object.isFrozen(COLLECTOR_SCHEMA.root.keys.service), true);
});

test('a wired config is ok and its pipeline flows', () => {
  const r = check(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.verdict, {
    flowing: true,
    pipelines: [{ name: 'traces', flowing: true, reasons: [] }],
    inactive: [],
  });
});

test('an exporter name that is not defined stalls that pipeline, by key path', () => {
  const r = check(withExporters('[otlp/backend, otlp/typo]'));
  assert.deepEqual(r.errors, [{
    kind: 'unknown-ref', path: 'service.pipelines.traces.exporters[1]',
    message: '"otlp/typo" is not defined under exporters or connectors', ref: 'otlp/typo', in: ['exporters', 'connectors'],
  }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.verdict.pipelines, [{ name: 'traces', flowing: false, reasons: r.errors }]);
  assert.equal(r.verdict.flowing, false);
});

test('a receiver or processor that is not defined is named at its own index', () => {
  const r = check(GOOD.replace('receivers: [otlp]', 'receivers: [jaeger, otlp]').replace('[batch]', '[memory_limiter, batch]'));
  assert.deepEqual(r.errors.map((e) => [e.path, e.message]), [
    ['service.pipelines.traces.receivers[0]', '"jaeger" is not defined under receivers or connectors'],
    ['service.pipelines.traces.processors[0]', '"memory_limiter" is not defined under processors'],
  ]);
});

test('the pipeline verdict is per pipeline: a healthy one keeps flowing beside a stalled one', () => {
  const text = GOOD + `    logs/slow:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [otlp/backend]
`;
  const r = check(text);
  assert.deepEqual(r.verdict.pipelines.map((p) => [p.name, p.flowing, p.reasons.map((x) => x.path)]), [
    ['traces', true, []],
    ['logs/slow', false, ['service.pipelines.logs/slow.exporters[0]']],
    ['metrics', true, []],
  ]);
  assert.equal(r.verdict.flowing, false);
});

test('a pipeline with no exporters key, or an empty list, is stalled with the reason', () => {
  const noKey = check(GOOD.replace('      exporters: [otlp/backend]\n', ''));
  assert.deepEqual(noKey.errors.map((e) => [e.kind, e.path, e.message]),
    [['missing-key', 'service.pipelines.traces.exporters', 'missing required key "exporters"']]);
  assert.equal(noKey.verdict.pipelines[0].flowing, false);
  const empty = check(withExporters('[]'));
  assert.deepEqual(empty.errors.map((e) => [e.kind, e.path, e.message]),
    [['too-few', 'service.pipelines.traces.exporters', 'needs at least 1 item']]);
  const nothing = check(GOOD.replace('exporters: [otlp/backend]', 'exporters:'));
  assert.deepEqual(nothing.errors.map((e) => [e.kind, e.path, e.message]),
    [['wrong-type', 'service.pipelines.traces.exporters', 'expected a list, got null']]);
});

test('a pipeline needs receivers and an exporter; processors are optional', () => {
  const noReceivers = check(GOOD.replace('receivers: [otlp]\n      ', ''));
  assert.deepEqual(noReceivers.errors.map((e) => e.path), ['service.pipelines.traces.receivers']);
  const noProcessors = check(GOOD.replace('      processors: [batch]\n', ''));
  assert.equal(noProcessors.ok, true);
  assert.equal(noProcessors.verdict.flowing, true);
});

test('a pipeline name must be a signal, optionally with /name', () => {
  const r = check(GOOD.replace('    traces:', '    trace:'));
  assert.deepEqual(r.errors, [{
    kind: 'bad-key', path: 'service.pipelines.trace',
    message: 'invalid key "trace": expected a signal (traces, metrics or logs), optionally followed by /name',
  }]);
  assert.equal(r.verdict.pipelines[0].flowing, false);
  assert.equal(check(GOOD.replace('    traces:', '    traces/eu:')).ok, true);
});

test('an unknown key with an odd name inside a pipeline stalls that pipeline, by quoted path', () => {
  const r = check(GOOD.replace('      processors: [batch]', '      processors: [batch]\n      "odd key": 1'));
  assert.deepEqual(r.errors.map((e) => [e.kind, e.path]), [['unknown-key', 'service.pipelines.traces["odd key"]']]);
  assert.deepEqual(r.verdict.pipelines, [{ name: 'traces', flowing: false, reasons: r.errors }]);
});

test('a pipeline that is not a mapping is stalled', () => {
  const r = check('receivers: {otlp: }\nexporters: {debug: }\nservice:\n  pipelines:\n    traces: [otlp]');
  assert.deepEqual(r.errors.map((e) => [e.path, e.message]), [['service.pipelines.traces', 'expected a mapping, got a list']]);
  assert.deepEqual(r.verdict.pipelines.map((p) => [p.name, p.flowing]), [['traces', false]]);
});

test('no pipelines at all: an error, and the verdict is stalled with an empty list', () => {
  const r = check('service:\n  pipelines: {}');
  assert.deepEqual(r.errors, [{ kind: 'too-few', path: 'service.pipelines', message: 'needs at least 1 entry', min: 1 }]);
  assert.deepEqual(r.verdict, { flowing: false, pipelines: [], inactive: [] });
  assert.deepEqual(check('receivers: {}').errors.map((e) => [e.kind, e.path, e.message]).slice(0, 1),
    [['missing-key', 'service', 'missing required key "service"']]);
  assert.deepEqual(check('receivers: {}').verdict, { flowing: false, pipelines: [], inactive: [] });
});

test('a verdict is not flowing while any other part of the config is wrong, though the wiring is fine', () => {
  const r = check(GOOD.replace('processors:\n  batch:', 'procesors:\n  batch:').replace('processors: [batch]', 'processors: []'));
  assert.deepEqual(r.errors.map((e) => e.path), ['procesors']);
  assert.deepEqual(r.verdict.pipelines.map((p) => p.flowing), [true]);
  assert.equal(r.verdict.flowing, false);
});

test('components defined but never used in a pipeline are reported as inactive', () => {
  const text = `
receivers:
  otlp:
  otlp/second:
  prometheus:
processors:
  batch:
  attributes:
exporters:
  otlp/backend:
  debug:
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/backend]
`;
  const r = check(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.verdict.inactive, [
    { section: 'receivers', id: 'otlp/second' },
    { section: 'receivers', id: 'prometheus' },
    { section: 'processors', id: 'attributes' },
    { section: 'exporters', id: 'debug' },
  ]);
  assert.equal(r.verdict.flowing, true, 'unused components are a warning, not a stall');
});

test('connectors count as receivers and exporters, and extensions are checked too', () => {
  const text = `
receivers: {otlp: }
exporters: {debug: }
connectors: {spanmetrics: }
extensions: {health_check: }
service:
  extensions: [health_check, pprof]
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [spanmetrics]
    metrics:
      receivers: [spanmetrics]
      exporters: [debug]
`;
  const r = check(text);
  assert.deepEqual(r.errors.map((e) => [e.path, e.message]), [
    ['service.extensions[1]', '"pprof" is not defined under extensions'],
  ]);
  assert.deepEqual(r.verdict.pipelines.map((p) => [p.name, p.flowing]), [['traces', true], ['metrics', true]]);
  assert.deepEqual(r.verdict.inactive, [], 'only pipeline components can be inactive');
});

test('a component id must look like type or type/name', () => {
  const r = check(GOOD.replace('  otlp/backend:', '  "OTLP backend":').replace('[otlp/backend]', '[]'));
  assert.deepEqual(r.errors.map((e) => [e.kind, e.path]), [['bad-key', 'exporters["OTLP backend"]'], ['too-few', 'service.pipelines.traces.exporters']]);
  assert.equal(r.errors[0].message, 'invalid key "OTLP backend": expected a component id such as "otlp" or "otlp/2"');
});

test('a top-level key the Collector does not have is unknown', () => {
  const r = check(GOOD + 'receiver: {}\n');
  assert.deepEqual(r.errors.map((e) => [e.kind, e.path]), [['unknown-key', 'receiver']]);
  assert.deepEqual(r.errors[0].allowed, ['connectors', 'exporters', 'extensions', 'processors', 'receivers', 'service']);
});

test('a component with settings or none, and a service.telemetry block, are all accepted', () => {
  assert.equal(check(GOOD.replace('service:', 'service:\n  telemetry:\n    logs:\n      level: debug')).ok, true);
});

test('referenceProblems works with the Collector schema and its verdict', () => {
  assert.deepEqual(referenceProblems(COLLECTOR_SCHEMA, GOOD, withExporters('[otlp/typo]')), []);
  assert.deepEqual(referenceProblems(COLLECTOR_SCHEMA, withExporters('[otlp/typo]')),
    ['reference: service.pipelines.traces.exporters[0]: "otlp/typo" is not defined under exporters or connectors']);
  assert.deepEqual(referenceProblems(COLLECTOR_SCHEMA, GOOD, GOOD), ['given: already passes the checker, so there is nothing to fix']);
});
