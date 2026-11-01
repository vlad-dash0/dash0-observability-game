// The answer key of every declarative level, spelled out here a second time so a wrong key in
// a level file fails a test in another file (docs/DECLARATIVE-LEVELS.md §4). One line per step,
// in play order, in the format of test/helpers/step-drivers.mjs answerKey. Adding a play level:
// add its ANSWERS entry; the gap test fails until it exists (and for an id that is not a play level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsOf } from './helpers/step-drivers.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';
import { liveRegistry } from '../app.mjs';
import { playFixture, FIXTURE_CARD } from './fixtures/play-level.mjs';

const ANSWERS = {
  'auto-vs-manual': [
    'sort avm-sort: server=auto loyalty=manual redis=auto coupon=manual client=auto item-count=manual',
    'choice avm-why: two-setups',
    'choice avm-fix: keep-one',
  ],
  resources: [
    'sort res-sort: service-name=resource http-method=signal pod-name=resource http-route=signal host-name=resource status-code=signal cloud-region=resource url-path=signal',
    'choice res-pod: set-once',
    'choice res-dash0: resource-attributes',
  ],
  'detectors-and-kubernetes': [
    'choice det-when: at-start',
    'choice det-where: collector',
    'configure det-config: receivers: otlp: protocols: grpc: processors: k8sattributes: extract: metadata: - k8s.namespace.name - k8s.pod.name - k8s.pod.uid - k8s.deployment.name - k8s.node.name batch: exporters: otlp/dash0: endpoint: ${env:DASH0_ENDPOINT} service: pipelines: traces: receivers: [otlp] processors: [k8sattributes, batch] exporters: [otlp/dash0]',
    'choice det-rbac: pods-namespaces',
    'choice det-dash0: operator-adds',
  ],
  instruments: [
    'sort instr-sort: orders-placed=counter warehouse-temp=gauge queue-length=up-down-counter checkout-duration=histogram payment-declines=counter cache-hit-ratio=gauge active-requests=up-down-counter response-bytes=histogram',
    'choice instr-async: async-updown',
    'choice instr-gauge: sampled-not-sum',
  ],
  temporality: [
    'spot temp-spot: emails-sent,checkout-duration,payments-declined',
    'choice temp-convert: deltatocumulative',
    'choice temp-restart: reset',
    'choice temp-dash0: both',
  ],
  histograms: [
    'choice hist-kind: exponential',
    'query hist-avg: checkout-http@3600 sum(rate(http_server_request_duration_seconds_sum{route="/pay"}[5m])) / sum(rate(http_server_request_duration_seconds_count{route="/pay"}[5m]))',
    'query hist-p99: checkout-http@3600 histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{route="/pay"}[5m])))',
    'choice hist-buckets: top-bucket',
    'query hist-p95: checkout-http@3600 histogram_quantile(0.95, sum by (service, le) (rate(http_server_request_duration_seconds_bucket[5m])))',
  ],
  'promql-basics': [
    'choice pql-unit: seconds-bucket',
    'choice pql-total: total',
    'query pql-rate: checkout-http@3600 sum by (route) (rate(http_server_requests_total{service="checkout", status="500"}[5m]))',
    'query pql-increase: checkout-http@2700 sum(increase(http_server_requests_total{route="/pay"}[10m]))',
    'choice pql-dash0: both-names',
  ],
  cardinality: [
    'choice cdn-combos: product',
    'spot cdn-spot: url-path,user-id,request-id',
    'tradeoff cdn-budget: requests=route-status served=tier customer=span-attribute',
    'choice cdn-dash0: fix-source',
  ],
  'red-and-use': [
    'choice ru-methods: red-services-use-resources',
    'choice ru-saturation: saturation',
    'choice ru-connector: spanmetrics',
    'query ru-rate: checkout-spanmetrics@3600 sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[5m]))',
    'query ru-errors: checkout-spanmetrics@3600 sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER", status_code="STATUS_CODE_ERROR"}[5m])) / sum by (service_name) (rate(traces_span_metrics_calls_total{span_kind="SPAN_KIND_SERVER"}[5m]))',
    'query ru-duration: checkout-spanmetrics@3600 histogram_quantile(0.95, sum by (service_name, le) (rate(traces_span_metrics_duration_milliseconds_bucket{span_kind="SPAN_KIND_SERVER"}[5m])))',
    'choice ru-dash0: derived',
  ],
  'structured-logs': [
    'sort sl-sort: msg-declined=body order-id=attributes severity-text=severity service-name=resource trace-id=trace msg-retry=body payment-method=attributes severity-number=severity pod-name=resource span-id=trace retry-attempt=attributes trace-flags=trace',
    'choice sl-attrs: short-message',
    'choice sl-severity: number',
    'choice sl-bridge: keep-logger',
  ],
  correlation: [
    'spot cor-spot: checkout-startup,payments-worker,notifications-email',
    'choice cor-why: no-active-span',
    'choice cor-fix: run-in-span',
    'choice cor-dash0: resource-mode',
  ],
  pipelines: [
    'choice pipe-connector: connector',
    'configure pipe-config: extensions: health_check: receivers: otlp: protocols: grpc: processors: memory_limiter: check_interval: 1s limit_mib: 400 spike_limit_mib: 100 batch: exporters: otlp/dash0: endpoint: ${env:DASH0_ENDPOINT} service: extensions: [health_check] pipelines: traces: receivers: [otlp] processors: [memory_limiter, batch] exporters: [otlp/dash0] metrics: receivers: [otlp] processors: [memory_limiter, batch] exporters: [otlp/dash0]',
    'choice pipe-extension: service-extensions',
  ],
  'order-matters': [
    'spot order-spot: metrics,traces-checkout,logs-audit,logs-noisy',
    'choice order-why: refuse-early',
    'choice order-batch: late',
  ],
  'play-fixture': [
    'choice fx-pick: trace',
    'sort fx-sort: server=auto loyalty=manual',
    'build fx-tree: aaaaaaaaaaaaaaa2.parent=aaaaaaaaaaaaaaa1',
    'incident checkout-slow: traces,db-metrics > slow-query',
    'spot fx-spot: user',
    'tradeoff fx-budget: sampling=tail attrs=tier',
    'query fx-query: checkout-http@3000 sum by (service) (rate(http_server_requests_total[5m]))',
    'configure fx-config: receivers: otlp: processors: batch: exporters: otlp/dash0: service: pipelines: traces: receivers: [otlp] processors: [batch] exporters: [otlp/dash0]',
  ],
};

const FX = buildRegistry(
  [{ id: 'a', no: 0, levels: [playFixture()], boss: null }],
  { deck: [FIXTURE_CARD], nodeIds: [], play: { validatePlay, runPlay } },
).levels;
const PLAY_LEVELS = [...Object.values(liveRegistry().levels).filter((l) => l.play), ...Object.values(FX)];

/** Play levels without an ANSWERS entry, and entries that are not play levels. */
function answerGaps(ids, answers) {
  const keys = Object.keys(answers);
  return { missing: ids.filter((id) => !Object.hasOwn(answers, id)), extra: keys.filter((id) => !ids.includes(id)) };
}

test('every play level has an answer key and every key is a play level', () => {
  assert.deepEqual(answerGaps(PLAY_LEVELS.map((l) => l.id), ANSWERS), { missing: [], extra: [] });
});

test('answerGaps catches a missing key and a key without a play level', () => {
  assert.deepEqual(answerGaps(['a', 'b'], { a: [], c: [] }), { missing: ['b'], extra: ['c'] });
  assert.deepEqual(answerGaps([], {}), { missing: [], extra: [] });
});

for (const level of PLAY_LEVELS) {
  test(`${level.id}: the level's answers are the pinned answers`, () => {
    assert.deepEqual(stepsOf(level).map(({ driver, spec }) => driver.answerKey(spec)), ANSWERS[level.id]);
  });
}
