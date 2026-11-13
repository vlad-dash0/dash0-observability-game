// The play events function (api/events.mjs, epic #18 P1), driven with a fake send, a fixed clock and a log spy.
// No network. Wire contract: docs/GAME-EVENTS.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvents } from '../api/events.mjs';
import { createLimiter } from '../lib/guide/limit.mjs';
import { gameSpan } from '../lib/otel/attributes.mjs';
import { ENV_ON, resourceOf, spansOf, timers } from './helpers/otel.mjs';

const NOW = 1_800_000_000_000;
const SID = '0123456789abcdef';
const URL_ = 'https://game.test/api/events';
const registry = {
  levels: {
    'lvl-a': { id: 'lvl-a', scored: true, actId: 'act-1' },
    intro: { id: 'intro', scored: false, actId: 'act-0' },
  },
};
const complete = { t: 'play', level: 'lvl-a', outcome: 'complete', durationMs: 61000, agoMs: 1200, stars: 4, mistakes: 1, hints: 0 };
const abandon = { t: 'play', level: 'intro', outcome: 'abandon', durationMs: 5000, agoMs: 10 };
const error = { t: 'error', kind: 'TypeError', agoMs: 0 };
const body = (events = [complete, abandon, error]) => JSON.stringify({ v: 1, sid: SID, events });

function counter() {
  let n = 0;
  return (size) => Uint8Array.from({ length: size }, (_, i) => (i === 0 ? (n += 1) : 1));
}

function setup({ env = ENV_ON, answer = { kind: 'accepted' }, limiter, extra = {} } = {}) {
  const logs = [];
  const sent = [];
  const send = async (b) => {
    sent.push(b);
    return typeof answer === 'function' ? answer() : answer;
  };
  const tm = timers();
  const events = createEvents({
    env, send, registry, now: () => NOW, random: counter(), log: (l) => logs.push(l), setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
    limiter: limiter ?? createLimiter({ now: () => NOW, clientMax: 60, clientWindowMs: 600000, instanceMax: 300, instanceWindowMs: 60000 }),
    ...extra,
  });
  return { events, logs, sent, tm };
}
const post = (payload = body(), { headers = {}, method = 'POST' } = {}) =>
  new Request(URL_, { method, headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers }, body: payload });
const get = () => new Request(URL_);
// The request with a counting `text()` and `clone()` (a clone is another way to read the body): `reads.n` counts both.
const spied = (req) => {
  const reads = { n: 0 };
  const text = req.text.bind(req);
  const clone = req.clone.bind(req);
  req.text = async () => { reads.n += 1; return text(); };
  req.clone = () => { reads.n += 1; return clone(); };
  return { req, reads };
};
const attrKeys = (span) => Object.keys(span.attrs).sort();

test('1 off (no env, or a bad token): GET says off, POST is a 204 that reads nothing and sends nothing', async () => {
  for (const env of [{}, { ...ENV_ON, DASH0_AUTH_TOKEN: 'bad token' }]) {
    const { events, logs, sent } = setup({ env });
    assert.deepEqual(await (await events.GET(get())).json(), { v: 1, on: false });
    let read = 0;
    const req = post();
    req.text = async () => { read += 1; return ''; };
    const res = await events.POST(req);
    assert.equal(res.status, 204);
    assert.equal(read, 0, 'the body is never read');
    assert.equal(sent.length, 0);
    assert.deepEqual(logs.map((l) => [l.msg, l.outcome, l.status]), [['events', 'off', 204]]);
  }
});

test('2 the kill switch: only unset or "on" is on', async () => {
  for (const [value, on] of [['off', false], ['of', false], ['0', false], [undefined, true], ['on', true]]) {
    const env = value === undefined ? ENV_ON : { ...ENV_ON, DASH0_GAME_EVENTS: value };
    assert.equal((await (await setup({ env }).events.GET(get())).json()).on, on, String(value));
  }
});

test('3 GET says on, with no secret and never cached', async () => {
  const { events, logs } = setup();
  const res = await events.GET(get());
  assert.deepEqual(await res.clone().json(), { v: 1, on: true });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.ok(!text.includes('dash0') && !text.includes('TOKENCANARY'));
  assert.equal(logs.length, 0);
});

test('4 a valid batch is one export of three spans with the right times and attributes', async () => {
  const { events, logs, sent, tm } = setup();
  const res = await events.POST(post());
  assert.equal(res.status, 204);
  assert.equal(sent.length, 1);
  assert.equal(tm.active(), 0, 'the export timer is cleared');
  assert.equal(resourceOf(sent[0])['service.name'], 'oncall-game-web');
  assert.ok(!('service.instance.id' in resourceOf(sent[0])));
  const [play, , err] = spansOf(sent[0]);
  assert.equal(play.name, 'level.play');
  assert.equal(BigInt(play.endTimeUnixNano), BigInt(NOW - 1200) * 1_000_000n);
  assert.equal(BigInt(play.startTimeUnixNano), BigInt(NOW - 1200 - 61000) * 1_000_000n);
  assert.deepEqual(play.attrs, {
    'session.id': SID, 'game.level.id': 'lvl-a', 'game.act.id': 'act-1', 'game.play.outcome': 'complete',
    'game.level.stars': 4, 'game.play.mistakes': 1, 'game.play.hints': 0,
  });
  assert.equal(err.name, 'client.error');
  assert.equal(err.status.code, 2);
  assert.equal(err.attrs['error.type'], 'TypeError');
  assert.equal(err.startTimeUnixNano, err.endTimeUnixNano);
  const ids = spansOf(sent[0]).map((s) => s.traceId);
  assert.equal(new Set(ids).size, 3, 'each event is its own trace');
  assert.deepEqual(logs.map(({ ms: _ms, ...l }) => l), [{ msg: 'events', outcome: 'accepted', status: 204, events: 3 }]);
});

test('5 an abandon carries only the four base attributes', async () => {
  const { events, sent } = setup();
  await events.POST(post(body([abandon])));
  const [span] = spansOf(sent[0]);
  assert.deepEqual(attrKeys(span), ['game.act.id', 'game.level.id', 'game.play.outcome', 'session.id']);
  assert.equal(span.attrs['game.act.id'], 'act-0');
});

test('6 refusals send nothing and never echo the input', async () => {
  const bad = body([{ ...complete, level: 'nope' }]);
  const cases = [
    ['PUT 405', post(body(), { method: 'PUT' }), 405],
    ['foreign origin', post(body(), { headers: { origin: 'https://evil.test' } }), 403],
    ['xml', post(body(), { headers: { 'content-type': 'application/xml' } }), 415],
    ['declared 9000', post(body(), { headers: { 'content-length': '9000' } }), 413],
    ['8193 bytes declaring 100', post(`${' '.repeat(8193 - 1)}{`, { headers: { 'content-length': '100' } }), 413],
    ['unknown level', post(bad), 400],
    ['bad json', post('{nope'), 400],
  ];
  for (const [what, req, status] of cases) {
    const { events, sent, logs } = setup();
    const res = await events.POST(req);
    assert.equal(res.status, status, what);
    assert.equal(sent.length, 0, what);
    const text = await res.text();
    assert.ok(!text.includes('nope') && !text.includes('evil'), `${what}: ${text}`);
    assert.ok(!JSON.stringify(logs).includes('nope'), what);
  }
  const { events } = setup();
  assert.deepEqual(await (await events.POST(post(bad))).json(), { error: 'bad-request', field: 'level' });
  assert.deepEqual(await (await events.POST(post('{nope'))).json(), { error: 'bad-request', field: 'body' });
});

test('6a a declared length over the cap is refused before the body is read', async () => {
  const { events } = setup();
  const { req, reads } = spied(post(body(), { headers: { 'content-length': '9000' } }));
  assert.equal((await events.POST(req)).status, 413);
  assert.equal(reads.n, 0);
});

test('6b an Origin of null (a beacon under no-referrer) and the same host are allowed', async () => {
  for (const origin of ['null', 'https://game.test']) {
    const { events, sent } = setup();
    assert.equal((await events.POST(post(body(), { headers: { origin } }))).status, 204, origin);
    assert.equal(sent.length, 1);
  }
});

test('7 text/plain with a charset and application/json are both read', async () => {
  for (const type of ['text/plain;charset=UTF-8', 'application/json']) {
    const { events, sent } = setup();
    assert.equal((await events.POST(post(body(), { headers: { 'content-type': type } }))).status, 204, type);
    assert.equal(sent.length, 1);
  }
});

test('8 the per-client limit answers 429 with retry-after before the export', async () => {
  const limiter = createLimiter({ now: () => NOW, clientMax: 2, clientWindowMs: 600000, instanceMax: 300, instanceWindowMs: 60000 });
  const { events, sent } = setup({ limiter });
  const as = (ip) => post(body(), { headers: { 'x-forwarded-for': ip } });
  assert.equal((await events.POST(as('203.0.113.1'))).status, 204);
  assert.equal((await events.POST(as('203.0.113.1'))).status, 204);
  const third = spied(as('203.0.113.1'));
  const limited = await events.POST(third.req);
  assert.equal(limited.status, 429);
  assert.equal(third.reads.n, 0, 'a limited request is refused before its body is read');
  assert.equal(limited.headers.get('retry-after'), '600');
  assert.equal((await events.POST(as('203.0.113.2'))).status, 204);
  assert.equal(sent.length, 3);
});

test('9 an ingress that refuses the token is a 502 upstream with a reason and no secret in any log', async () => {
  const { events, logs } = setup({ answer: { kind: 'rejected', status: 401, auth: true } });
  const res = await events.POST(post());
  assert.equal(res.status, 502);
  assert.deepEqual(logs.map(({ ms: _ms, ...l }) => l), [{ msg: 'events', outcome: 'upstream', status: 502, reason: 'auth' }]);
  assert.ok(!JSON.stringify(logs).includes('TOKENCANARY') && !(await res.text()).includes('TOKENCANARY'));
});

test('9b a throwing send is a 502, an internal fault is a 500, and neither says anything', async () => {
  const { events, logs } = setup({ extra: { send: async () => { throw new Error('auth_TOKENCANARY123456'); } } });
  const res = await events.POST(post());
  assert.equal(res.status, 502, 'a throwing send is a dropped export, not a crash');
  assert.ok(!JSON.stringify(logs).includes('TOKENCANARY'));
  const broken = setup({ extra: { random: () => { throw new Error('boom'); } } });
  const failed = await broken.events.POST(post());
  assert.equal(failed.status, 500);
  assert.equal(broken.logs[0].outcome, 'error');
});

test('10 nothing about the request reaches the export; a bad id is left out of a span', async () => {
  const { events, sent } = setup();
  await events.POST(post(body(), {
    headers: { cookie: 'session=SECRETCOOKIE', 'user-agent': 'AGENTCANARY', 'x-forwarded-for': '198.51.100.7', referer: 'https://game.test/?secret=REFERERCANARY', origin: 'https://game.test' },
  }));
  const wire = JSON.stringify(sent[0]);
  for (const canary of ['SECRETCOOKIE', 'AGENTCANARY', '198.51.100.7', 'REFERERCANARY', 'game.test']) assert.ok(!wire.includes(canary), canary);
  assert.ok(!('game.level.id' in gameSpan({ name: 'level.play', sid: SID, levelId: 'Bad Id!', outcome: 'abandon' }).attributes));
  assert.ok(!('session.id' in gameSpan({ name: 'level.play', sid: 'ABC', outcome: 'abandon' }).attributes));
  assert.equal(gameSpan({ name: 'level.play', sid: SID, levelId: 'ok-id' }).attributes['game.level.id'], 'ok-id');
});
