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
    'configure det-config: receivers: otlp: protocols: grpc: processors: k8sattributes: extract: metadata: - k8s.namespace.name - k8s.pod.name - k8s.pod.uid - k8s.deployment.name - k8s.node.name batch: exporters: otlp_grpc/dash0: endpoint: ${env:DASH0_ENDPOINT} service: pipelines: traces: receivers: [otlp] processors: [k8sattributes, batch] exporters: [otlp_grpc/dash0]',
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
  exemplars: [
    'spot exm-spot: pay-0914-15,pay-0914-30,pay-0915-00',
    'choice exm-why: unsampled-or-no-span',
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
    'build cor-build: startup=none cart=00f067aa0ba902b7 other-order=b7ad6b7169203331 provider-slow=3ee05e5bb0f1ae0c retry-worker=none email=none',
    'choice cor-why: no-active-span',
    'choice cor-fix: run-in-span',
    'choice cor-dash0: resource-mode',
  ],
  pipelines: [
    'choice pipe-connector: connector',
    'configure pipe-config: extensions: health_check: receivers: otlp: protocols: grpc: processors: memory_limiter: check_interval: 1s limit_mib: 400 spike_limit_mib: 100 batch: exporters: otlp_grpc/dash0: endpoint: ${env:DASH0_ENDPOINT} service: extensions: [health_check] pipelines: traces: receivers: [otlp] processors: [memory_limiter, batch] exporters: [otlp_grpc/dash0] metrics: receivers: [otlp] processors: [memory_limiter, batch] exporters: [otlp_grpc/dash0]',
    'choice pipe-extension: service-extensions',
  ],
  'order-matters': [
    'spot order-spot: metrics,traces-checkout,logs-audit,logs-noisy',
    'choice order-why: refuse-early',
    'choice order-batch: late',
  ],
  'otlp-endpoints': [
    'choice otlp-port: http-port',
    'choice otlp-signal: as-is',
    'configure otlp-config: extensions: headers_setter: headers: - action: insert key: Authorization value: "Bearer ${env:DASH0_TOKEN}" receivers: otlp: protocols: grpc: endpoint: 0.0.0.0:4317 http: endpoint: 0.0.0.0:4318 processors: batch: exporters: debug: otlp_grpc/dash0: endpoint: ${env:DASH0_ENDPOINT} auth: authenticator: headers_setter service: extensions: [headers_setter] pipelines: traces: receivers: [otlp] processors: [batch] exporters: [debug, otlp_grpc/dash0] metrics: receivers: [otlp] processors: [batch] exporters: [otlp_grpc/dash0]',
    'choice otlp-token: header',
  ],
  'agent-vs-gateway': [
    'choice agw-pattern: gateway',
    'choice agw-why: same-instance',
    'configure agw-config: receivers: otlp: protocols: grpc: endpoint: 0.0.0.0:4317 processors: memory_limiter: check_interval: 1s limit_mib: 400 batch: exporters: otlp_grpc/gateway: endpoint: gateway-collector:4317 load_balancing: routing_key: traceID protocol: otlp: tls: insecure: true resolver: dns: hostname: gateway-collector-headless service: pipelines: traces: receivers: [otlp] processors: [memory_limiter, batch] exporters: [load_balancing] metrics: receivers: [otlp] processors: [memory_limiter, batch] exporters: [otlp_grpc/gateway]',
    'choice agw-key: trace-id',
  ],
  'collecting-logs': [
    'choice col-route: otlp-appender',
    'configure col-config: receivers: otlp: protocols: grpc: filelog/shipping: include: [/var/log/shipping/agent.log] start_at: beginning multiline: line_start_pattern: ^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} operators: - type: regex_parser regex: \'(?s)^(?P<time>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) (?P<sev>[A-Z]+) (?P<msg>.*)$\' severity: parse_from: attributes.sev processors: batch: exporters: otlp_grpc/dash0: endpoint: ${env:DASH0_ENDPOINT} service: pipelines: traces: receivers: [otlp] processors: [batch] exporters: [otlp_grpc/dash0] logs: receivers: [filelog/shipping] processors: [batch] exporters: [otlp_grpc/dash0]',
    'choice col-multiline: line-start',
    'choice col-parse: collector-regex',
    'choice col-dash0: log-ai',
  ],
  'the-3am-errors': [
    'incident the-3am-errors: error-patterns,trace-of-error > inventory-reply',
    'choice tae-link: trace-and-resource',
  ],
  silence: [
    'incident silence: arrival-by-cluster,collector-pods,collector-log > exporter-renamed',
    'choice sil-rule: listed-must-be-defined',
  ],
  'head-sampling': [
    'tradeoff hs-plan: checkout=follow payments=follow',
    'choice hs-why: own-decision',
  ],
  'tail-sampling': [
    'tradeoff ts-budget: wait=wait-25s policies=errors-slow-baseline',
    'spot ts-spot: traces-processors,traces-exporters',
  ],
  'good-alerts': ['spot ga-spot: counter-value,cause-cpu,no-for', 'choice ga-fix: increase'],
  'slis-and-slos': [
    'choice sl-sli: good-over-valid',
    'query sl-sli-query: checkout-spanmetrics@3600 sum(rate(traces_span_metrics_calls_total{service_name="checkout", span_kind="SPAN_KIND_SERVER", status_code!="STATUS_CODE_ERROR"}[5m])) / sum(rate(traces_span_metrics_calls_total{service_name="checkout", span_kind="SPAN_KIND_SERVER"}[5m]))',
    'choice sl-budget: thousand',
    'choice sl-edge: load-balancer',
  ],
  'burn-rate-alerts': [
    'query br-burn: checkout-http@3600 sum(rate(http_server_requests_total{service="checkout", status="500"}[1h])) / sum(rate(http_server_requests_total{service="checkout"}[1h])) / 0.001',
    'choice br-rule: both',
  ],
  'synthetic-checks': [
    'sort sc-sort: handler-throws=spans tls-expired=probe payment-dns=spans slow-query=spans dns-dropout=probe inventory-loop=spans dns-stale=probe payment-tls=spans cdn-stale=probe bad-deploy=spans lb-no-targets=probe',
    'choice sc-alert: probe',
  ],
  'everything-is-green': [
    'incident everything-is-green: span-numbers,who-calls,outside-request > expired-certificate',
    'choice eig-page: outside-check',
  ],
  'dashboards-as-code': ['spot dac-spot: metadata,item-errors,item-latency', 'choice dac-deploy: terraform'],
  'frontend-rum': ['build frum-tree: 4d5e6f708192a3b4.parent=3c4d5e6f708192a3', 'choice frum-cors: page-origin-api-header'],
  'ai-assisted-debugging': [
    'incident ai-assisted-debugging: failures-by-version,failing-trace,request-rate > inventory-failing',
    'choice aad-why: old-name',
  ],
  'semantic-convention-versions': ['spot scv-spot: http-target,net-host-port,http-status-code', 'choice scv-switch: move-queries'],
  'migrating-vendors': [
    'sort mv-sort: p95-chart=approximated ratio-alert=translated agent-panel=skipped anomaly-chart=manual memory-chart=translated p99-alert=approximated retired-alert=skipped failed-count=approximated paging-alert=manual unused-dashboard=skipped disk-alert=translated logs-panel=manual',
    'choice mv-fix: boundary',
  ],
  'filter-or-sampler': ['choice fos-verdict: wrong', 'sort fos-sort: errors-whole=tail healthz=filter slow-no-cache=both slow=tail debug-logs=filter many-spans=tail production-only=filter via-payments=tail errors-no-keepalive=both'],
  'the-34-percent-error-rate': ['choice ser-verdict: wrong', 'tradeoff ser-plan: sampler=errors-10pct rate=red-before'],
  'the-trace-that-starts-in-the-middle': ['choice ttsm-verdict: rewritten', 'build ttsm-tree: 4b9e2c6a0d8f1573.parent=9c3e1a7d4b6f2085 a5f1b9d3c7e20468.parent=e0a4c8f2b6d19375'],
  'lost-in-translation': ['choice lit-verdict: wrong', 'spot lit-spot: orders-placed,cpu-time,checkout-duration'],
  'errors-tripled': [
    'incident errors-tripled: rate-vs-lb,error-count,collector-diff > metrics-after-sampling',
    'choice eto-ratio: counted-after-sampling',
  ],
  'who-is-talking': [
    'incident who-is-talking: alert-resource,deploy-history > name-dropped',
    'choice wit-fix: env-var',
  ],
  'the-bill': [
    'incident the-bill: volume-by-metric,label-breakdown > user-id-label',
    'choice tbl-fix: drop-the-label',
  ],
  'ottl-and-transforms': [
    'choice ottl-rename: set-then-delete',
    'spot ottl-spot: resource-map,copy-only,admin-only,typo-key',
    'configure ottl-config: receivers: otlp: protocols: grpc: processors: memory_limiter: check_interval: 1s limit_mib: 400 spike_limit_mib: 100 transform/pii: error_mode: ignore trace_statements: - delete_key(span.attributes, "user.email") log_statements: - delete_key(log.attributes, "user.email") batch: exporters: otlp_grpc/dash0: endpoint: ${env:DASH0_ENDPOINT} service: pipelines: traces: receivers: [otlp] processors: [memory_limiter, transform/pii, batch] exporters: [otlp_grpc/dash0] logs: receivers: [otlp] processors: [memory_limiter, transform/pii, batch] exporters: [otlp_grpc/dash0]',
    'choice ottl-backend: pipeline',
  ],
  distributions: [
    'choice dist-unknown: refuses-to-start',
    'sort dist-sort: k8sattributes=contrib-k8s batch=all-three awss3-exporter=contrib-only memory-limiter=all-three redaction=contrib-k8s acme-scrubber=none tail-sampling=contrib-k8s otlp-exporter=all-three awsxray-exporter=contrib-only',
    'choice dist-build: ocb',
  ],
  'what-costs-money': [
    'choice wcm-host: fewer-hosts',
    'tradeoff wcm-gb: traces=tail logs=trimmed',
    'tradeoff wcm-signal: interval=s60 records=per-request spans=tail',
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
    'build fx-logs: l-boot=none l-cart=aaaaaaaaaaaaaaa2 l-other=ccccccccccccccc4 l-charge=ddddddddddddddd3 l-worker=none',
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
