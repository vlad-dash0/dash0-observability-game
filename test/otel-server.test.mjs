// lib/otel/server.mjs: one export per api/ invocation, flushed before the response, dormant unless configured.
// Spec: the epic #18 design contract; semconv http-spans; OTel SDK ForceFlush.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reply } from '../lib/http.mjs';
import { createServerTelemetry, consoleExporter } from '../lib/otel/server.mjs';
import { ENV_ON, bytes, clock, h, ingress, resourceOf, spansOf, timers } from './helpers/otel.mjs';

// Pinned here on purpose: a test that imported these would move with a mutation of them.
const EXPORT_TIMEOUT_MS = 450;
const FLUSH_BUDGET_MS = 500;
const URL_ = 'https://game.example/api/progress';
const TRACE = '11'.repeat(16);
const SPAN = '22'.repeat(8);
const INSTANCE = '33333333-3333-4333-b333-333333333333';
const RESOURCE_KEYS = ['service.name', 'service.version', 'service.instance.id', 'deployment.environment.name', 'faas.name', 'telemetry.sdk.name', 'telemetry.sdk.language', 'telemetry.sdk.version'];
const SERVER_KEYS = ['http.request.method', 'http.route', 'url.path', 'url.scheme', 'http.response.status_code', 'error.type', 'game.api.outcome', 'game.level.id', 'game.step.id'];
const CLIENT_KEYS = ['http.request.method', 'server.address', 'server.port', 'url.full', 'http.response.status_code', 'error.type'];

const post = (url = URL_, init = {}) => new Request(url, { method: 'POST', ...init });

// A telemetry over a fake ingress. Defaults pin the clock and the random bytes.
function rig(over = {}) {
  const ing = over.ing ?? ingress();
  const tm = over.tm ?? timers();
  const logs = [];
  const exports = [];
  const t = createServerTelemetry({
    name: 'progress',
    env: ENV_ON,
    fetch: ing.fetch,
    now: clock([1000.5, 1042.25]),
    random: bytes(0x11, 0x22, 0x33),
    setTimeout: tm.setTimeout,
    clearTimeout: tm.clearTimeout,
    log: (line) => logs.push(line),
    onExport: (o) => exports.push(o),
    ...over.opts,
  });
  return { t, ing, tm, logs, exports };
}
const run = (t, handler, request = post()) => t.instrument({ POST: handler }).POST(request);
const telemetryLogs = (logs) => logs.filter((l) => l.msg === 'telemetry');
const flush = () => new Promise((r) => setImmediate(r));

test('1 dormant without env: the same handlers, fetch and log, and no request', async () => {
  const ing = ingress();
  const logs = [];
  const log = (l) => logs.push(l);
  const t = createServerTelemetry({ name: 'progress', env: {}, fetch: ing.fetch, log });
  const handlers = { POST: async () => reply(200, {}) };
  assert.equal(t.state, 'off');
  assert.equal(t.log, log);
  assert.equal(t.instrument(handlers), handlers);
  assert.equal(t.trace(ing.fetch), ing.fetch);
  await handlers.POST();
  assert.equal(ing.calls.length, 0);
  assert.deepEqual(logs, []);
});

test('2 invalid config is dormant and logs its reason once per instance, never the host', async () => {
  const { DASH0_AUTH_TOKEN: _t, ...env } = ENV_ON;
  const { t, ing, logs } = rig({ opts: { env } });
  assert.equal(t.state, 'invalid');
  assert.equal(t.trace(ing.fetch), ing.fetch);
  const handler = t.instrument({ POST: h(t, 201, 'write') }).POST;
  const a = await handler(post());
  await handler(post());
  assert.equal(a.status, 201);
  assert.equal(ing.calls.length, 0);
  assert.deepEqual(telemetryLogs(logs), [{ msg: 'telemetry', outcome: 'not-configured', reason: 'token:empty' }]);
  assert.ok(!JSON.stringify(logs).includes('ingress'));
});

test('3 one export per invocation, shaped as the contract says', async () => {
  const { t, ing, logs } = rig();
  const res = await run(t, h(t, 201, 'write'));
  assert.equal(res.status, 201);
  assert.equal(ing.calls.length, 1);
  const [call] = ing.calls;
  assert.equal(call.url, 'https://ingress.eu-west-1.aws.dash0.com/v1/traces');
  assert.equal(call.init.headers.Authorization, 'Bearer auth_TOKENCANARY123456');
  assert.equal(call.init.headers['Dash0-Dataset'], 'oncall-api');
  const [span, ...more] = spansOf(call.body);
  assert.equal(more.length, 0);
  assert.equal(span.name, 'POST /api/progress');
  assert.equal(span.kind, 2);
  assert.equal(span.startTimeUnixNano, '1000500000');
  assert.equal(span.endTimeUnixNano, '1042250000');
  assert.equal(span.traceId, TRACE);
  assert.equal(span.spanId, SPAN);
  assert.equal('status' in span, false);
  assert.equal('parentSpanId' in span, false);
  assert.deepEqual(span.attrs, {
    'http.request.method': 'POST',
    'http.route': '/api/progress',
    'url.path': '/api/progress',
    'url.scheme': 'https',
    'http.response.status_code': 201,
    'game.api.outcome': 'write',
  });
  assert.deepEqual(telemetryLogs(logs), []);
});

test('4 the player gets the very same Response, with both set-cookie values', async () => {
  const { t } = rig();
  const original = reply(200, {}, { 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
  const out = await run(t, async () => original);
  assert.equal(out, original);
  assert.deepEqual(out.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
});

test('5 only a server fault marks the span: 404 and 499 stay unset, 500 and 502 are errors', async () => {
  for (const [status, error] of [[404, false], [499, false], [500, true], [502, true]]) {
    const { t, ing } = rig();
    await run(t, h(t, status, 'x'));
    const [span] = spansOf(ing.calls[0].body);
    if (error) {
      assert.deepEqual(span.status, { code: 2 }, String(status));
      assert.equal(span.attrs['error.type'], String(status));
    } else {
      assert.equal('status' in span, false, String(status));
      assert.equal('error.type' in span.attrs, false);
    }
  }
});

test('6 a throwing handler: same error rethrown after the export, class name only', async () => {
  const order = [];
  const ing = ingress();
  const fetch = (...a) => { order.push('export'); return ing.fetch(...a); };
  const { t } = rig({ opts: { fetch } });
  const boom = new RangeError('sk-ant-CANARY');
  await assert.rejects(
    run(t, async () => { throw boom; }).catch((e) => { order.push('rejected'); throw e; }),
    (e) => e === boom,
  );
  assert.deepEqual(order, ['export', 'rejected']);
  const [span] = spansOf(ing.calls[0].body);
  assert.equal(span.attrs['error.type'], 'RangeError');
  assert.deepEqual(span.status, { code: 2 });
  assert.ok(!JSON.stringify(ing.calls[0].body).toLowerCase().includes('canary'));
});

test('7 a valid traceparent: the span joins that trace as its child', async () => {
  const { t, ing } = rig({ opts: { random: bytes(0x22) } });
  const parent = 'aa'.repeat(8);
  await run(t, h(t, 200, 'read'), post(URL_, { headers: { traceparent: `00-${'bb'.repeat(16)}-${parent}-01` } }));
  const [span] = spansOf(ing.calls[0].body);
  assert.equal(span.traceId, 'bb'.repeat(16));
  assert.equal(span.parentSpanId, parent);
  assert.equal(span.spanId, SPAN);
});

test('8 an invalid traceparent starts a new trace', async () => {
  const { t, ing } = rig();
  await run(t, h(t, 200, 'read'), post(URL_, { headers: { traceparent: `00-${'0'.repeat(32)}-${'aa'.repeat(8)}-01` } }));
  const [span] = spansOf(ing.calls[0].body);
  assert.equal(span.traceId, TRACE);
  assert.equal('parentSpanId' in span, false);
});

test('9 an unsampled parent: nothing is sent or logged, onExport says so', async () => {
  const { t, ing, logs, exports } = rig();
  const res = await run(t, h(t, 200, 'read'), post(URL_, { headers: { traceparent: `00-${'bb'.repeat(16)}-${'aa'.repeat(8)}-00` } }));
  assert.equal(res.status, 200);
  assert.equal(ing.calls.length, 0);
  assert.deepEqual(telemetryLogs(logs), []);
  assert.deepEqual(exports, [{ kind: 'dropped', reason: 'not-sampled', spans: 1 }]);
});

test('10 a traced fetch is a CLIENT child span and the inner call is untouched', async () => {
  for (const [status, type] of [[503, '503'], [404, '404']]) {
    const { t, ing } = rig({ opts: { now: clock([1000, 1001, 1002, 1003]) } });
    const inner = [];
    const upstream = async (...args) => { inner.push(args); return new Response('{}', { status }); };
    const traced = t.trace(upstream);
    const init = { method: 'POST', headers: { 'x-api-key': 'k' }, body: 'q' };
    const input = 'https://api.anthropic.com/v1/messages?secret=Q#frag';
    await run(t, async () => { await traced(input, init); return reply(200, {}); });
    assert.equal(inner.length, 1);
    assert.equal(inner[0][0], input);
    assert.equal(inner[0][1], init);
    assert.equal(inner[0].length, 2);
    const spans = spansOf(ing.calls[0].body);
    assert.equal(spans.length, 2);
    const client = spans.find((s) => s.kind === 3);
    const server = spans.find((s) => s.kind === 2);
    assert.equal(client.parentSpanId, server.spanId);
    assert.equal(client.traceId, server.traceId);
    assert.equal(client.name, 'POST');
    assert.deepEqual(client.attrs, {
      'http.request.method': 'POST',
      'server.address': 'api.anthropic.com',
      'server.port': 443,
      'url.full': 'https://api.anthropic.com/v1/messages',
      'http.response.status_code': status,
      'error.type': type,
    });
    assert.deepEqual(client.status, { code: 2 });
    assert.equal('status' in server, false);
  }
});

test('11 a failing client call is rethrown as it was, typed by class name', async () => {
  const { t, ing } = rig();
  const err = new DOMException('timed out', 'TimeoutError');
  const traced = t.trace(async () => { throw err; });
  await assert.rejects(run(t, async () => { await traced('https://api.anthropic.com/v1/messages'); return reply(200, {}); }), (e) => e === err);
  const client = spansOf(ing.calls[0].body).find((s) => s.kind === 3);
  assert.equal(client.attrs['error.type'], 'TimeoutError');
  assert.deepEqual(client.status, { code: 2 });
});

test('12 no client calls: one span, and the export transport is never traced', async () => {
  // now() and random() serve only the telemetry steps (start, end, flush clock; trace id, span id,
  // instance id). A traced transport call would draw a client span id and read the clock again.
  const now = clock([1000, 1001]);
  const rnd = bytes(0x11, 0x22, 0x33);
  const { t, ing } = rig({ opts: { now, random: rnd } });
  await run(t, h(t, 200, 'read'));
  assert.equal(ing.calls.length, 1);
  assert.equal(spansOf(ing.calls[0].body).length, 1);
  assert.equal(rnd.calls, 3);
  assert.equal(now.calls, 3);
});

test('13 concurrent invocations export separately', async () => {
  const { t, ing } = rig({ opts: { random: bytes([1], [2], [3], [4], [5], [6], [7], [8], [9]), now: clock([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) } });
  let release;
  const gate = new Promise((r) => { release = r; });
  const upstream = async (url) => new Response('{}', { status: String(url).endsWith('/a') ? 200 : 201 });
  const traced = t.trace(upstream);
  const handler = t.instrument({
    POST: async (request) => {
      await gate;
      await traced(`https://api.anthropic.com${new URL(request.url).pathname}`);
      return reply(200, {});
    },
  }).POST;
  const a = handler(post('https://game.example/api/a'));
  const b = handler(post('https://game.example/api/b'));
  await flush();
  release();
  await Promise.all([a, b]);
  assert.equal(ing.calls.length, 2);
  const urls = ing.calls.map((c) => spansOf(c.body).filter((s) => s.kind === 3).map((s) => s.attrs['url.full']));
  assert.deepEqual(urls.map((u) => u.length), [1, 1]);
  assert.deepEqual(urls.flat().sort(), ['https://api.anthropic.com/api/a', 'https://api.anthropic.com/api/b']);
  assert.notEqual(spansOf(ing.calls[0].body)[0].traceId, spansOf(ing.calls[1].body)[0].traceId);
});

test('14 a traced fetch outside a request passes through without a span', async () => {
  const { t, ing } = rig();
  const res = await t.trace(async () => new Response('x', { status: 200 }))('https://api.anthropic.com/v1/messages');
  assert.equal(res.status, 200);
  assert.equal(ing.calls.length, 0);
});

test('15 a stalled exporter costs at most the flush budget, then the player gets the response', { timeout: 2000 }, async () => {
  const { t, tm, logs, exports } = rig({ ing: ingress({ mode: 'stall' }), opts: { now: clock([1000, 1010, 1510]) } });
  let settled = null;
  const original = reply(200, {});
  const p = run(t, async () => original).then((r) => { settled = r; });
  await flush();
  const ms = tm.pending().map((x) => x.ms);
  assert.ok(ms.includes(EXPORT_TIMEOUT_MS) && ms.includes(FLUSH_BUDGET_MS), ms.join());
  tm.fire(EXPORT_TIMEOUT_MS);
  await flush();
  assert.equal(settled, null);
  tm.fire(FLUSH_BUDGET_MS);
  await p;
  assert.equal(settled, original);
  assert.deepEqual(telemetryLogs(logs), [{ msg: 'telemetry', outcome: 'dropped', reason: 'budget', spans: 1, ms: 500 }]);
  assert.deepEqual(exports, [{ kind: 'dropped', reason: 'budget', spans: 1 }]);
  assert.equal(tm.active(), 0);
});

test('16 a stalled exporter on the real clock delays the response by about the budget', { timeout: 3000 }, async () => {
  const { t } = rig({ ing: ingress({ mode: 'stall' }), opts: { setTimeout, clearTimeout, now: undefined, random: undefined } });
  const started = performance.now();
  await run(t, async () => reply(200, {}));
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 450 && elapsed < 900, String(elapsed));
});

test('17 the export finishes before the response is returned', async () => {
  const order = [];
  const ing = ingress();
  const fetch = async (...a) => { await flush(); order.push('export'); return ing.fetch(...a); };
  const { t } = rig({ opts: { fetch } });
  await run(t, async () => reply(200, {})).then(() => order.push('response'));
  assert.deepEqual(order, ['export', 'response']);
});

test('18 every ingress outcome maps to one reason and leaks nothing', async () => {
  const cases = [
    [{ status: 200, text: '{}' }, null, null],
    [{ status: 200, text: JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: 'bad auth_TOKENCANARY123456' } }) }, 'rejected', 200],
    [{ status: 401, text: 'nope auth_TOKENCANARY123456' }, 'auth', undefined],
    [{ status: 403 }, 'auth', undefined],
    [{ status: 500, text: JSON.stringify({ message: 'INGRESSMESSAGE' }) }, 'rejected', 500],
    [{ mode: 'throw' }, 'network', undefined],
    [{ mode: 'abort' }, 'timeout', undefined],
  ];
  for (const [ingOpts, reason, ingressStatus] of cases) {
    const { t, tm, logs, exports } = rig({ ing: ingress(ingOpts) });
    const p = run(t, async () => reply(200, {}));
    if (ingOpts.mode === 'abort') { await flush(); tm.fire(EXPORT_TIMEOUT_MS); }
    await p;
    const lines = telemetryLogs(logs);
    if (reason === null) {
      assert.deepEqual(lines, []);
      assert.deepEqual(exports, [{ kind: 'exported', spans: 1 }]);
      continue;
    }
    assert.equal(lines.length, 1, reason);
    const expectedKeys = ['msg', 'outcome', 'reason', 'spans', 'ms', ...(ingressStatus ? ['ingressStatus'] : [])];
    assert.deepEqual(Object.keys(lines[0]).sort(), expectedKeys.sort());
    assert.equal(lines[0].reason, reason);
    assert.equal(lines[0].outcome, 'dropped');
    assert.equal(lines[0].spans, 1);
    assert.equal(lines[0].ingressStatus, ingressStatus);
    const json = JSON.stringify(logs).toLowerCase();
    assert.ok(!json.includes('tokencanary') && !json.includes('ingressmessage'));
  }
});

test('19 telemetry failures never fail the request', async () => {
  const original = () => reply(201, {});
  const cases = [
    ['internal', { random: () => { throw new Error('rng'); } }],
    ['internal', { now: (() => { let n = 0; return () => { n += 1; if (n === 2) throw new Error('clock'); return 1000 + n; }; })() }],
    ['network', { fetch: () => { throw new TypeError('sync'); } }],
  ];
  for (const [reason, opts] of cases) {
    const { t, logs } = rig({ opts });
    const res = await run(t, async () => original());
    assert.equal(res.status, 201);
    assert.equal(telemetryLogs(logs)[0]?.reason, reason);
  }
});

test('20 privacy: nothing about the player or the secrets reaches the export', async () => {
  const env = { ...ENV_ON, ANTHROPIC_API_KEY: 'sk-ant-CANARY', VERCEL_ENV: 'preview' };
  const { t, ing } = rig({ opts: { env, now: clock([1000, 1001, 1002, 1003]) } });
  const traced = t.trace(async () => new Response('{}', { status: 200 }));
  const request = new Request(`${URL_}?code=CODE_CANARY&state=STATE_CANARY`, {
    method: 'POST',
    headers: { cookie: '__Host-oc-session=SESS_CANARY', 'x-forwarded-for': '203.0.113.77', 'user-agent': 'UA_CANARY', authorization: 'Bearer AUTHZ_CANARY', 'content-type': 'application/json' },
    body: JSON.stringify({ nick: 'NICK_CANARY', email: 'ada.lovelace@dash0.com' }),
  });
  await run(t, async () => {
    t.log({ msg: 'guide', levelId: 'lvl-1', stepId: 's1', outcome: 'answered', status: 200, ms: 5, question: 'QUESTION_CANARY', nick: 'NICK_CANARY' });
    await traced('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': 'sk-ant-CANARY' }, body: 'QUESTION_CANARY' });
    return reply(200, {});
  }, request);
  const text = JSON.stringify(ing.calls[0].body).toLowerCase();
  for (const bad of ['sess_canary', '203.0.113.77', 'ua_canary', 'code_canary', 'state_canary', 'authz_canary', 'nick_canary', 'ada.lovelace', 'question_canary', 'sk-ant-canary', 'tokencanary', '__host-']) {
    assert.ok(!text.includes(bad), bad);
  }
  const spans = spansOf(ing.calls[0].body);
  assert.ok(Object.keys(resourceOf(ing.calls[0].body)).every((k) => RESOURCE_KEYS.includes(k)));
  for (const s of spans) {
    const allowed = s.kind === 2 ? SERVER_KEYS : CLIENT_KEYS;
    assert.ok(Object.keys(s.attrs).every((k) => allowed.includes(k)), Object.keys(s.attrs).join());
  }
  const server = spans.find((s) => s.kind === 2);
  assert.equal(server.attrs['game.level.id'], 'lvl-1');
  assert.equal(server.attrs['game.step.id'], 's1');
  assert.equal(server.attrs['game.api.outcome'], 'answered');
  assert.equal(server.attrs['url.path'], '/api/progress');
});

test('21 the outcome attribute keeps only short tokens', async () => {
  for (const [outcome, kept] of [['has space', false], ['x'.repeat(41), false], ['x'.repeat(40), true], ['id-token-expired', true]]) {
    const { t, ing } = rig();
    await run(t, h(t, 200, outcome));
    const attrs = spansOf(ing.calls[0].body)[0].attrs;
    assert.equal('game.api.outcome' in attrs, kept, outcome);
    if (kept) assert.equal(attrs['game.api.outcome'], outcome);
  }
});

test('22 an all-zero id draw is redrawn', async () => {
  const { t, ing } = rig({ opts: { random: bytes(0, 0x11, 0x22, 0x33) } });
  await run(t, h(t, 200, 'read'));
  const [span] = spansOf(ing.calls[0].body);
  assert.equal(span.traceId, TRACE);
  assert.equal(span.spanId, SPAN);
});

test('23 the resource comes from env and omits what is absent', async () => {
  const env = { ...ENV_ON, VERCEL_GIT_COMMIT_SHA: 'abc1234def', VERCEL_ENV: 'preview' };
  const on = rig({ opts: { env } });
  await run(on.t, h(on.t, 200, 'read'));
  assert.deepEqual(resourceOf(on.ing.calls[0].body), {
    'service.name': 'oncall-game-api',
    'service.version': 'abc1234def',
    'service.instance.id': INSTANCE,
    'deployment.environment.name': 'preview',
    'faas.name': 'progress',
    'telemetry.sdk.name': 'oncall-game-otlp',
    'telemetry.sdk.language': 'nodejs',
    'telemetry.sdk.version': '0.1.0',
  });
  const off = rig({ opts: { env: { ...ENV_ON, VERCEL_ENV: 'staging', VERCEL_GIT_COMMIT_SHA: 'XYZ' } } });
  await run(off.t, h(off.t, 200, 'read'));
  const res = resourceOf(off.ing.calls[0].body);
  assert.equal('service.version' in res, false);
  assert.equal('deployment.environment.name' in res, false);
});

test('24 an export over the byte cap is not sent', async () => {
  const { t, ing, logs } = rig({ opts: { maxExportBytes: 100 } });
  const res = await run(t, h(t, 200, 'read'));
  assert.equal(res.status, 200);
  assert.equal(ing.calls.length, 0);
  assert.equal(telemetryLogs(logs)[0].reason, 'too-large');
});

test('25 at most 16 spans per export; the rest are counted and reported', async () => {
  const { t, ing, logs } = rig({ opts: { random: bytes(0x11, 0x22, 0x44, 0x55) } });
  const traced = t.trace(async () => new Response('{}', { status: 200 }));
  await run(t, async () => {
    for (let i = 0; i < 20; i += 1) await traced('https://api.anthropic.com/v1/messages');
    return reply(200, {});
  });
  assert.equal(spansOf(ing.calls[0].body).length, 16);
  const lines = telemetryLogs(logs);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].reason, 'overflow');
  assert.equal(lines[0].spans, 5);
});

test('26 consoleExporter prints one line per span and accepts', async () => {
  const lines = [];
  const { t } = rig({ opts: { exporter: consoleExporter((l) => lines.push(l)) } });
  await run(t, h(t, 201, 'write'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^span POST \/api\/progress 2 0 42ms \{.*"http\.response\.status_code":201/);
});
