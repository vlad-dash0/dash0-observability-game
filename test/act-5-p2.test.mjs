// Act 5 levels 5.3 OTLP endpoints and 5.4 Agent vs gateway beyond the generated play-through
// (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs): level fields and lights,
// card fronts and backs, the shortcuts through the real runConfigure, the env-var and port
// nuances the Choice steps grade, and the facts the copy states (docs/OUTLINE.md §4 Act 5), each
// checked from the level's own data. The act's place in the registry is in test/act-5.test.mjs.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { EDGES, NODES } from '../hub/map-data.mjs';
import { liveRegistry } from '../app.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { nodeStates } from '../lib/map.mjs';
import { levelState } from '../lib/unlock.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};
const stepOf = (levelId, key, widgetId) =>
  LIVE.levels[levelId].play.steps.find((s) => s[key] && s[key].id === widgetId)[key];
const choiceOf = (levelId, widgetId) => stepOf(levelId, 'choice', widgetId).choices;
const rightOf = (levelId, widgetId) => choiceOf(levelId, widgetId).find((c) => c.right);
const keysOf = (levelId, widgetId) => choiceOf(levelId, widgetId).map((c) => c.key).sort();
const textOf = (c) => plain(c.label + c.why);

// ---- level fields, scoring and lights -----------------------------------------------

const FIELDS = {
  'otlp-endpoints': { no: '5.3', name: 'OTLP endpoints', mechanics: ['configure'], cards: ['otlp-ports-and-paths'], lights: [] },
  'agent-vs-gateway': { no: '5.4', name: 'Agent vs gateway', mechanics: ['configure'], cards: ['tail-sampling-needs-one-collector'], lights: [] },
};

for (const [id, want] of Object.entries(FIELDS)) {
  test(`${id}: level fields, derived mechanics, cards, lights, scored with no par time`, () => {
    const level = LIVE.levels[id];
    assert.deepEqual(
      { no: level.no, name: level.name, mechanics: [...level.mechanics], cards: [...level.cards], lights: [...level.lights] },
      want,
    );
    assert.equal(level.actId, 'act-5');
    assert.equal(level.scored, true);
    assert.equal(level.scoring.parMs, null);
    assert.equal(level.run.length, 1, 'a play level gets its run from the registry');
    assert.equal(typeof level.play.finish, 'string');
    assert.equal(level.play.steps.length, 4);
  });
}

test('star totals: 28 scored levels, max 84, and the two new levels add 6', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: 84 });
  assert.deepEqual(starTotals(progressOf(['otlp-endpoints', 'agent-vs-gateway']), LIVE), { earned: 6, max: 84 });
});

test('5.3 and 5.4 open in any order once Act 5 is entered; they stay locked on a fresh save', () => {
  assert.equal(levelState('otlp-endpoints', emptyProgress(), LIVE), 'locked');
  assert.equal(levelState('agent-vs-gateway', progressOf(['pipelines']), LIVE), 'open');
  assert.equal(levelState('otlp-endpoints', progressOf(['agent-vs-gateway']), LIVE), 'open');
});

test('lights: the map has no Collector node, so 5.3 and 5.4 light nothing, like 5.1 and 5.2', () => {
  const s = nodeStates(LIVE, progressOf(['otlp-endpoints', 'agent-vs-gateway']), NODES, EDGES);
  assert.equal(NODES.filter((n) => s.nodes[n.id].lit).length, 0);
  assert.equal(s.edges.filter((e) => e.lit).length, 0);
});

// ---- cards --------------------------------------------------------------------------

const CARDS = {
  'otlp-ports-and-paths': {
    front:
      'OTLP/gRPC is port 4317, OTLP/HTTP 4318. A general HTTP endpoint gets /v1/traces added; a per-signal one is used as is.',
    back:
      'OTLP has two transports with their own default ports: OTLP/gRPC on 4317 and OTLP/HTTP on 4318. A gRPC endpoint is a ' +
      'host and a port with no path. For OTLP/HTTP, OTEL_EXPORTER_OTLP_ENDPOINT is a base URL: the exporter adds /v1/traces, ' +
      '/v1/metrics or /v1/logs to it. The per-signal variables, such as OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, are used as they ' +
      'are, with no path added: set to http://collector:4318 it sends traces to the root path, so it has to carry /v1/traces ' +
      'itself. The Collector\'s otlphttp exporter follows the same rule: endpoint is a base URL that gets the signal path, ' +
      'traces_endpoint is used as is.',
    specUrl: 'https://opentelemetry.io/docs/specs/otel/protocol/exporter/#endpoint-urls-for-otlphttp',
    dash0Angle:
      'Dash0 takes OTLP over gRPC and over HTTP. The Collector example in the Dash0 docs uses the OTLP/gRPC ingress endpoint ' +
      'of your organization, whose URL shows your region, with your auth token in an Authorization: Bearer header, read from ' +
      'an environment variable so the token is not written into the file.',
  },
  'tail-sampling-needs-one-collector': {
    front:
      'Tail sampling needs every span of a trace in one Collector: put a load_balancing exporter on traceID in front of the gateways.',
    back:
      'An agent Collector runs next to the workload, as a sidecar or as a DaemonSet pod on each node. A gateway is a standalone ' +
      'Collector service, such as a Kubernetes Deployment, that apps or agents send to: one OTLP endpoint per cluster, data ' +
      'center or region. The tail_sampling processor keeps spans in memory until it can decide on the whole trace, so all spans ' +
      'of a trace must reach the same Collector instance, and several gateway replicas behind an ordinary load balancer split ' +
      'a trace between them. A first tier, the agents or a Collector that only routes, uses the load_balancing exporter with ' +
      'routing_key: traceID, so every span of a trace goes to the same second-tier replica, where tail_sampling runs. ' +
      'routing_key: service would keep a service together but split its traces. The exporter was renamed from loadbalancing, ' +
      'and the old name still works as a deprecated alias.',
    specUrl: 'https://opentelemetry.io/docs/collector/deployment/gateway/#load-balancing-exporter',
    dash0Angle: null,
  },
};

test('5.3 and 5.4 cards: front, back, spec URL and Dash0 angle are pinned; fronts fit a card (<=140)', () => {
  for (const [id, want] of Object.entries(CARDS)) {
    assert.deepEqual(DECK.find((c) => c.id === id), { id, ...want });
    assert.equal(want.front.length <= 140, true, `${id} front is ${want.front.length} characters`);
  }
});

// ---- 5.3 OTLP endpoints: Choice steps -----------------------------------------------

test('otlp-endpoints: OTLP/HTTP listens on 4318 and 4317 is the gRPC port; a gRPC endpoint has no path', () => {
  const right = rightOf('otlp-endpoints', 'otlp-port');
  assert.equal(right.key, 'http-port');
  const text = textOf(right);
  for (const w of ['4318', '4317', 'gRPC', 'HTTP']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf('otlp-endpoints', 'otlp-port'), ['http-port', 'needs-path', 'same-port']);
  const wrongText = choiceOf('otlp-endpoints', 'otlp-port').filter((c) => !c.right).map(textOf).join(' ');
  assert.equal(/own default port|each has its own/.test(wrongText), true, 'the same-port option is corrected');
  assert.equal(/no path/.test(wrongText + text), true, 'the gRPC endpoint has no path');
});

test('otlp-endpoints: the nuance is graded: a per-signal variable is used as is, the general one gets /v1/traces', () => {
  const step = stepOf('otlp-endpoints', 'choice', 'otlp-signal');
  const question = plain(LIVE.levels['otlp-endpoints'].play.steps.find((s) => s.choice === step).intro);
  assert.equal(question.includes('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'), true, 'the step is about the per-signal variable');
  const right = rightOf('otlp-endpoints', 'otlp-signal');
  assert.equal(right.key, 'as-is');
  const text = textOf(right);
  for (const w of ['as is', 'OTEL_EXPORTER_OTLP_ENDPOINT', '/v1/traces', 'root path']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf('otlp-endpoints', 'otlp-signal'), ['adds-path', 'as-is', 'rejected']);
  const adds = choiceOf('otlp-endpoints', 'otlp-signal').find((c) => c.key === 'adds-path');
  assert.equal(adds.right, undefined);
  assert.equal(/only the general|only .*OTEL_EXPORTER_OTLP_ENDPOINT/.test(plain(adds.why)), true, 'the wrong option says where /v1/traces is added');
});

test('otlp-endpoints: the auth token goes in an Authorization: Bearer header, not in the URL or on the Resource', () => {
  const right = rightOf('otlp-endpoints', 'otlp-token');
  assert.equal(right.key, 'header');
  const text = textOf(right);
  for (const w of ['Authorization', 'Bearer', 'OTEL_EXPORTER_OTLP_HEADERS', 'auth_token_example', 'headers_setter']) {
    assert.equal(text.includes(w), true, w);
  }
  assert.deepEqual(keysOf('otlp-endpoints', 'otlp-token'), ['header', 'resource', 'url']);
});

// ---- 5.3 OTLP endpoints: the config -------------------------------------------------

const otlp = () => stepOf('otlp-endpoints', 'configure', 'otlp-config');
const OT_REF = () => otlp().reference;
const runOt = (text, state = newConfigureState()) => runConfigure(otlp(), state, text);
const verdictOf = (r) => ({ outcome: r.outcome, reason: r.reason, unmet: r.unmet });
const errorsOf = (r) => r.result.errors.map((e) => `${e.kind} ${e.path}`);
const replaced = (text, from, to) => { assert.equal(text.includes(from), true, from); return text.replace(from, to); };
const DEFINED = '  otlp/dash0:\n    endpoint: ${env:DASH0_ENDPOINT}\n    auth:\n      authenticator: headers_setter\n';

test('otlp config: the given does not start (metrics names an exporter nobody defined) and leaves otlp/dash0 unused', () => {
  const given = checkConfig(otlp().given, COLLECTOR_SCHEMA);
  assert.equal(given.ok, false);
  assert.deepEqual(given.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.pipelines.metrics.exporters[0]']);
  assert.deepEqual(given.verdict.inactive, [{ section: 'exporters', id: 'otlp/dash0' }], 'defined, in no pipeline');
  assert.deepEqual(given.doc.service.pipelines.traces.exporters, ['debug']);
  assert.deepEqual(given.doc.service.pipelines.metrics.exporters, ['otlphttp/dash0']);
});

test('otlp config: the reference starts, wires otlp/dash0 into traces and metrics, enables the auth extension, leaves nothing unused', () => {
  const ref = checkConfig(OT_REF(), COLLECTOR_SCHEMA);
  assert.equal(ref.ok, true);
  assert.equal(ref.verdict.flowing, true);
  assert.deepEqual(ref.verdict.pipelines.map((p) => `${p.name}=${p.flowing}`), ['traces=true', 'metrics=true']);
  assert.deepEqual(ref.verdict.inactive, []);
  assert.deepEqual(ref.doc.service.pipelines.traces.exporters, ['debug', 'otlp/dash0']);
  assert.deepEqual(ref.doc.service.pipelines.metrics.exporters, ['otlp/dash0']);
  assert.deepEqual(ref.doc.service.extensions, ['headers_setter']);
  assert.deepEqual(otlp().uses, { traces: ['otlp/dash0'], metrics: ['otlp/dash0'] });
  assert.equal(Object.hasOwn(otlp(), 'target'), false, '`uses` names both pipelines, so they are also the target');
  assert.deepEqual(verdictOf(runOt(OT_REF())), { outcome: 'right', reason: undefined, unmet: undefined });
});

test('otlp config: the reference shows both ports and the token read from the environment, never written in the file', () => {
  const ref = checkConfig(OT_REF(), COLLECTOR_SCHEMA).doc;
  assert.equal(ref.receivers.otlp.protocols.grpc.endpoint, '0.0.0.0:4317');
  assert.equal(ref.receivers.otlp.protocols.http.endpoint, '0.0.0.0:4318');
  assert.equal(ref.exporters['otlp/dash0'].endpoint, '${env:DASH0_ENDPOINT}');
  assert.equal(ref.exporters['otlp/dash0'].auth.authenticator, 'headers_setter');
  const header = ref.extensions.headers_setter.headers[0];
  assert.deepEqual({ key: header.key, value: header.value }, { key: 'Authorization', value: 'Bearer ${env:DASH0_TOKEN}' });
  assert.equal(OT_REF().includes('auth_'), false, 'no token-shaped text in the config');
});

test('otlp config: leaving metrics on the undefined HTTP exporter is invalid: the Collector would not start', () => {
  const r = runOt(replaced(OT_REF(), '      exporters: [otlp/dash0]\n', '      exporters: [otlphttp/dash0]\n'));
  assert.deepEqual(verdictOf(r), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
  assert.deepEqual(errorsOf(r), ['unknown-ref service.pipelines.metrics.exporters[0]']);
});

test('otlp config: defining the HTTP exporter and keeping metrics on it starts the Collector but `uses` refuses it', () => {
  const http = replaced(OT_REF(), DEFINED, `${DEFINED}  otlphttp/dash0:\n    endpoint: \${env:DASH0_ENDPOINT}\n`);
  const text = replaced(http, '    metrics:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlp/dash0]\n', '    metrics:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlphttp/dash0]\n');
  assert.equal(checkConfig(text, COLLECTOR_SCHEMA).ok, true, 'a valid config, so only `uses` can refuse it');
  const wrong = runOt(text);
  assert.deepEqual(verdictOf(wrong), { outcome: 'wrong', reason: 'uses', unmet: ['metrics'] });
  assert.equal(runOt(text, wrong.state).outcome, 'repeat', 'the same text again is free');
  assert.equal(runOt(OT_REF(), wrong.state).outcome, 'right');
});

test('otlp config: traces left on the debug exporter alone (the given) never reaches Dash0: `uses` names traces', () => {
  const text = replaced(OT_REF(), '      exporters: [debug, otlp/dash0]\n', '      exporters: [debug]\n');
  assert.equal(checkConfig(text, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(runOt(text)), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
});

test('otlp config: debug in both pipelines and no Dash0 exporter at all is valid and refused by `uses` for both', () => {
  const noDash0 = replaced(OT_REF(), DEFINED, '').split('exporters: [otlp/dash0]').join('exporters: [debug]').replace('exporters: [debug, otlp/dash0]', 'exporters: [debug]');
  assert.equal(noDash0.includes('otlp/dash0'), false);
  assert.equal(checkConfig(noDash0, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(runOt(noDash0)), { outcome: 'wrong', reason: 'uses', unmet: ['traces', 'metrics'] });
});

test('otlp config: renaming otlp/dash0 (a new id used everywhere) is a different component, so `uses` refuses it', () => {
  const renamed = OT_REF().split('otlp/dash0').join('otlp/backend');
  assert.equal(checkConfig(renamed, COLLECTOR_SCHEMA).ok, true, 'a valid config under another name');
  assert.deepEqual(verdictOf(runOt(renamed)), { outcome: 'wrong', reason: 'uses', unmet: ['traces', 'metrics'] });
});

test('otlp config: deleting the metrics pipeline leaves a required pipeline that does not flow', () => {
  const noMetrics = replaced(OT_REF(), '    metrics:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlp/dash0]\n', '');
  assert.equal(noMetrics.includes('metrics:'), false);
  assert.equal(checkConfig(noMetrics, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(runOt(noMetrics)), { outcome: 'wrong', reason: 'target', unmet: ['metrics'] });
});

test('otlp config: enabling the auth extension without defining it never passes', () => {
  const noDef = replaced(OT_REF(), 'extensions:\n  headers_setter:\n    headers:\n      - action: insert\n        key: Authorization\n        value: "Bearer ${env:DASH0_TOKEN}"\n', '');
  assert.deepEqual(verdictOf(runOt(noDef)), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
});

test('otlp config: the explain says a second Dash0 exporter under another name is a different component, not that it leaves a pipeline without Dash0', () => {
  const text = plain(otlp().explain);
  assert.equal(text.includes('leave one pipeline'), false, 'a second Dash0 exporter in both pipelines does reach Dash0');
  assert.equal(text.includes('a second Dash0 exporter under another name would be a different component'), true);
  assert.equal(text.includes('this task asks for otlp/dash0 in both'), true);
});

test('otlp config: settings are not graded here (auth, headers, endpoints), the wiring is; the explain says so and names the Choice step', () => {
  const noAuth = replaced(replaced(OT_REF(), '    auth:\n      authenticator: headers_setter\n', ''), '  extensions: [headers_setter]\n', '');
  const noExt = noAuth.replace(/extensions:\n {2}headers_setter:\n {4}headers:\n(?: {6,}.*\n)+/, '');
  assert.equal(noExt.includes('headers_setter'), false);
  assert.equal(runOt(noExt).outcome, 'right', 'the wiring is what counts');
  const text = plain(otlp().explain);
  for (const w of ['wiring', 'not the settings', 'Authorization', 'gRPC', 'no path', 'otlphttp']) assert.equal(text.includes(w), true, w);
});

// ---- 5.4 Agent vs gateway: Choice steps ---------------------------------------------

test('agent-vs-gateway: a gateway is a standalone Collector service that apps or agents send to; an agent runs beside the workload', () => {
  const right = rightOf('agent-vs-gateway', 'agw-pattern');
  assert.equal(right.key, 'gateway');
  const text = textOf(right);
  for (const w of ['standalone', 'Deployment', 'cluster', 'region']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf('agent-vs-gateway', 'agw-pattern'), ['agent', 'embedded', 'gateway']);
  const agent = choiceOf('agent-vs-gateway', 'agw-pattern').find((c) => c.key === 'agent');
  assert.equal(/DaemonSet/.test(agent.label) && /sidecar/.test(agent.label), true, 'the agent option is the DaemonSet or sidecar description');
});

test('agent-vs-gateway: tail sampling needs all spans of a trace in one Collector instance, which a plain load balancer breaks', () => {
  const right = rightOf('agent-vs-gateway', 'agw-why');
  assert.equal(right.key, 'same-instance');
  const text = textOf(right);
  for (const w of ['all spans', 'same Collector', 'tail', 'load balancer']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf('agent-vs-gateway', 'agw-why'), ['same-instance', 'unsupported', 'wait']);
});

test('agent-vs-gateway: the exporter routes by trace ID; service keeps a service together but splits traces; it hashes, it does not round-robin', () => {
  const right = rightOf('agent-vs-gateway', 'agw-key');
  assert.equal(right.key, 'trace-id');
  const text = textOf(right);
  for (const w of ['routing_key', 'traceID', 'default']) assert.equal(text.includes(w), true, w);
  assert.deepEqual(keysOf('agent-vs-gateway', 'agw-key'), ['round-robin', 'service', 'trace-id']);
  const byService = choiceOf('agent-vs-gateway', 'agw-key').find((c) => c.key === 'service');
  assert.equal(/split/.test(plain(byService.why)), true);
  const rr = choiceOf('agent-vs-gateway', 'agw-key').find((c) => c.key === 'round-robin');
  assert.equal(/hash|key/.test(plain(rr.why)), true);
});

// ---- 5.4 Agent vs gateway: the config -----------------------------------------------

const agw = () => stepOf('agent-vs-gateway', 'configure', 'agw-config');
const AG_REF = () => agw().reference;
const runAg = (text, state = newConfigureState()) => runConfigure(agw(), state, text);
const LB_DEF = '  load_balancing:\n    routing_key: traceID\n    protocol:\n      otlp:\n        tls:\n          insecure: true\n    resolver:\n      dns:\n        hostname: gateway-collector-headless\n';
const TRACES_LB = '      processors: [memory_limiter, batch]\n      exporters: [load_balancing]\n';
const TRACES_GW = '      processors: [memory_limiter, batch]\n      exporters: [otlp/gateway]\n';

test('agent config: the given does not start (traces names a load_balancing exporter nobody defined)', () => {
  const given = checkConfig(agw().given, COLLECTOR_SCHEMA);
  assert.equal(given.ok, false);
  assert.deepEqual(given.errors.map((e) => `${e.kind} ${e.path}`), ['unknown-ref service.pipelines.traces.exporters[0]']);
  assert.deepEqual(given.doc.service.pipelines.traces.exporters, ['load_balancing']);
  assert.deepEqual(given.doc.service.pipelines.metrics.exporters, ['otlp/gateway']);
  assert.deepEqual(given.verdict.inactive, []);
});

test('agent config: the reference sends traces through load_balancing keyed by traceID and metrics straight to the gateway', () => {
  const ref = checkConfig(AG_REF(), COLLECTOR_SCHEMA);
  assert.equal(ref.ok, true);
  assert.deepEqual(ref.verdict.pipelines.map((p) => `${p.name}=${p.flowing}`), ['traces=true', 'metrics=true']);
  assert.deepEqual(ref.verdict.inactive, []);
  assert.deepEqual(ref.doc.service.pipelines.traces.exporters, ['load_balancing']);
  assert.deepEqual(ref.doc.service.pipelines.metrics.exporters, ['otlp/gateway']);
  assert.equal(ref.doc.exporters.load_balancing.routing_key, 'traceID');
  assert.equal(ref.doc.exporters.load_balancing.resolver.dns.hostname, 'gateway-collector-headless');
  assert.deepEqual(agw().uses, { traces: ['load_balancing'] });
  assert.equal(Object.hasOwn(agw(), 'target'), false);
  assert.deepEqual(verdictOf(runAg(AG_REF())), { outcome: 'right', reason: undefined, unmet: undefined });
});

test('agent config: pointing traces at the gateway Service (the usual shortcut) starts the Collector but `uses` refuses it', () => {
  const text = replaced(replaced(AG_REF(), LB_DEF, ''), TRACES_LB, TRACES_GW);
  assert.equal(text.includes('load_balancing'), false);
  assert.equal(checkConfig(text, COLLECTOR_SCHEMA).ok, true, 'a valid config, so only `uses` can refuse it');
  const wrong = runAg(text);
  assert.deepEqual(verdictOf(wrong), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
  assert.equal(runAg(text, wrong.state).outcome, 'repeat');
  assert.equal(runAg(AG_REF(), wrong.state).outcome, 'right');
});

test('agent config: defining load_balancing but leaving traces on otlp/gateway is refused: defined is not wired', () => {
  const text = replaced(AG_REF(), TRACES_LB, TRACES_GW);
  const r = runAg(text);
  assert.deepEqual(verdictOf(r), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
  assert.deepEqual(r.result.verdict.inactive, [{ section: 'exporters', id: 'load_balancing' }]);
});

test('agent config: only naming it in traces, without defining it, never passes', () => {
  const text = replaced(AG_REF(), LB_DEF, '');
  const r = runAg(text);
  assert.deepEqual(verdictOf(r), { outcome: 'wrong', reason: 'invalid', unmet: undefined });
  assert.deepEqual(errorsOf(r), ['unknown-ref service.pipelines.traces.exporters[0]']);
});

test('agent config: the exporter\'s old name (loadbalancing) is another component id here, so `uses` refuses it', () => {
  const old = AG_REF().split('load_balancing').join('loadbalancing');
  assert.equal(checkConfig(old, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(runAg(old)), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
  assert.equal(/deprecated alias/.test(plain(agw().explain)), true, 'the explain tells the learner why the old name is not accepted');
});

test('agent config: renaming the exporter id is a different component, so `uses` refuses it', () => {
  const renamed = AG_REF().split('load_balancing').join('load_balancing/traces');
  assert.equal(checkConfig(renamed, COLLECTOR_SCHEMA).ok, true);
  assert.deepEqual(verdictOf(runAg(renamed)), { outcome: 'wrong', reason: 'uses', unmet: ['traces'] });
});

test('agent config: deleting the traces pipeline leaves a required pipeline that does not flow', () => {
  const noTraces = replaced(AG_REF(), `    traces:\n      receivers: [otlp]\n${TRACES_LB}`, '');
  assert.equal(noTraces.includes('traces:'), false);
  assert.deepEqual(verdictOf(runAg(noTraces)), { outcome: 'wrong', reason: 'target', unmet: ['traces'] });
});

test('agent config: the routing key is a setting the schema does not model, so this step grades the wiring and the Choice step grades the key', () => {
  const byService = replaced(AG_REF(), 'routing_key: traceID', 'routing_key: service');
  assert.equal(runAg(byService).outcome, 'right', 'not graded here: the schema keeps component settings as any');
  const text = plain(agw().explain);
  for (const w of ['wiring', 'not the settings', 'routing_key', 'traceID', 'tail']) assert.equal(text.includes(w), true, w);
});

// ---- both levels --------------------------------------------------------------------

const urls = (f, prefix) =>
  read(`levels/${f}.mjs`).split('\n').filter((l) => l.startsWith(prefix)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);

test('the 5.3 and 5.4 level files cite the pages their facts come from, on Spec lines for opentelemetry.io and Docs lines for the rest', () => {
  const ep = urls('otlp-endpoints', '// Spec: ');
  for (const u of [
    'https://opentelemetry.io/docs/specs/otel/protocol/exporter/',
    'https://opentelemetry.io/docs/specs/otlp/',
  ]) assert.equal(ep.includes(u), true, u);
  const ag = urls('agent-vs-gateway', '// Spec: ');
  for (const u of [
    'https://opentelemetry.io/docs/collector/deployment/agent/',
    'https://opentelemetry.io/docs/collector/deployment/gateway/',
  ]) assert.equal(ag.includes(u), true, u);
  for (const f of ['otlp-endpoints', 'agent-vs-gateway']) {
    for (const u of urls(f, '// Spec: ')) assert.equal(new URL(u).host, 'opentelemetry.io', `${f} Spec line ${u}`);
    const src = read(`levels/${f}.mjs`);
    assert.equal(/\bthe spec says\b/i.test(src), false, f);
  }
  const docs = [...urls('otlp-endpoints', '// Docs'), ...urls('otlp-endpoints', '// Dash0 docs'), ...urls('agent-vs-gateway', '// Docs')].join(' ');
  for (const u of [
    'https://www.dash0.com/docs/dash0/monitoring/websites/proxying-the-ingestion-endpoint',
    'https://www.dash0.com/docs/dash0/opentelemetry/distributions/python/exporters',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/loadbalancingexporter/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md',
  ]) assert.equal(docs.includes(u), true, u);
});

test('the fake-token rule: the only token-shaped text in the level files and cards is auth_token_example', () => {
  const text = [read('levels/otlp-endpoints.mjs'), read('levels/agent-vs-gateway.mjs'), JSON.stringify(DECK.filter((c) => Object.keys(CARDS).includes(c.id)))].join('\n');
  const tokens = [...text.matchAll(/\bauth_[A-Za-z0-9_]+/g)].map((m) => m[0]);
  assert.equal(tokens.length > 0, true, 'the fake token is shown');
  assert.deepEqual([...new Set(tokens)], ['auth_token_example']);
  const bearers = [...text.matchAll(/Bearer ([^\s<"'`,;)\\]+)/g)].map((m) => m[1].replace(/[.]+$/, ''));
  for (const b of bearers) assert.equal(/^(auth_token_example|\$\{env:DASH0_TOKEN\}|header)$/.test(b), true, `Bearer ${b}`);
});
