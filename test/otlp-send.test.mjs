// The OTLP/HTTP sender and the one response classifier (lib/otlp/send.mjs).
// Spec: docs/DASH0-LAB.md §Sender. Fake fetch and fake timers; nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATASET_HEADER, MESSAGE_CAP, TIMEOUT_MS, classifyResponse, sendTraces } from '../lib/otlp/send.mjs';

const T = 'auth_Tk9secretValue42';
const URL_ = 'https://ingress.eu-west-1.aws.dash0.com/v1/traces';
const BODY = { resourceSpans: [] };

const res = (status, body = '') => ({ status, text: async () => body });

function fakeTimers() {
  const t = { pending: new Map(), cleared: [], next: 1, delays: [] };
  t.setTimeout = (fn, ms) => {
    const id = t.next++;
    t.pending.set(id, fn);
    t.delays.push(ms);
    return id;
  };
  t.clearTimeout = (id) => {
    t.cleared.push(id);
    t.pending.delete(id);
  };
  t.fire = () => {
    for (const [id, fn] of [...t.pending]) {
      t.pending.delete(id);
      fn();
    }
  };
  return t;
}

function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetch, calls };
}

const send = (fetch, extra = {}) => {
  const timers = fakeTimers();
  return {
    timers,
    out: sendTraces({ fetch, tracesUrl: URL_, token: T, body: BODY, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ...extra }),
  };
};

test('request shape: POST, bearer token, JSON, no credentials, no redirects, no referrer; dataset header only when given', async () => {
  const { fetch, calls } = fakeFetch(() => res(200));
  const a = send(fetch, { dataset: 'prod' });
  assert.deepEqual(await a.out, { kind: 'accepted' });
  const b = send(fetch);
  assert.deepEqual(await b.out, { kind: 'accepted' });
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url, URL_);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, `Bearer ${T}`);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.cache, 'no-store');
    assert.deepEqual(JSON.parse(init.body), BODY);
    assert.ok(init.signal && typeof init.signal.aborted === 'boolean', 'the request carries an abort signal');
  }
  assert.equal(DATASET_HEADER, 'Dash0-Dataset');
  assert.equal(calls[0].init.headers[DATASET_HEADER], 'prod');
  assert.ok(!(DATASET_HEADER in calls[1].init.headers), 'no dataset header for the default dataset');
  assert.deepEqual(Object.keys(calls[1].init.headers).sort(), ['Authorization', 'Content-Type']);
  // The timeout is armed at 10 s and cleared once the response is in.
  assert.deepEqual(a.timers.delays, [TIMEOUT_MS]);
  assert.equal(TIMEOUT_MS, 10_000);
  assert.equal(a.timers.pending.size, 0, 'the timeout is cleared');
});

test('2xx without rejected spans is accepted; partialSuccess.rejectedSpans "2" is rejected; "0" and {} are accepted', async () => {
  const rows = [
    [res(200, ''), { kind: 'accepted' }],
    [res(200, '{}'), { kind: 'accepted' }],
    [res(202, '{}'), { kind: 'accepted' }],
    [res(200, '{"partialSuccess":{}}'), { kind: 'accepted' }],
    [res(200, '{"partialSuccess":{"rejectedSpans":"0"}}'), { kind: 'accepted' }],
    [res(200, '{"partialSuccess":{"rejectedSpans":"2"}}'), { kind: 'rejected', status: 200, auth: false }],
    [res(200, '{"partialSuccess":{"rejectedSpans":2,"errorMessage":"span too old"}}'),
      { kind: 'rejected', status: 200, auth: false, message: 'span too old' }],
  ];
  for (const [r, want] of rows) assert.deepEqual(await classifyResponse(r, { token: T }), want, await r.text());
});

test('401 and 403 are auth rejections; 400 404 415 429 500 are rejected with auth false', async () => {
  for (const status of [401, 403]) {
    assert.deepEqual(await classifyResponse(res(status)), { kind: 'rejected', status, auth: true }, String(status));
  }
  for (const status of [400, 404, 415, 429, 500, 503]) {
    assert.deepEqual(await classifyResponse(res(status)), { kind: 'rejected', status, auth: false }, String(status));
  }
  // End to end through sendTraces too.
  const { fetch } = fakeFetch(() => res(403, '{"message":"no ingest permission"}'));
  assert.deepEqual(await send(fetch).out, { kind: 'rejected', status: 403, auth: true, message: 'no ingest permission' });
});

test('thrown fetch is unreachable/network; the timer aborts and gives unreachable/timeout; status 0 or undefined is unreachable/opaque, never accepted', async () => {
  const thrown = fakeFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  assert.deepEqual(await send(thrown.fetch).out, { kind: 'unreachable', cause: 'network' });

  // A fetch that only settles when its signal aborts, as a hung connection does.
  let seen;
  const hung = async (url, init) => {
    seen = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  const h = send(hung);
  await Promise.resolve();
  assert.equal(seen.aborted, false, 'not aborted before the timer fires');
  h.timers.fire();
  assert.equal(seen.aborted, true, 'the timer aborts the request');
  assert.deepEqual(await h.out, { kind: 'unreachable', cause: 'timeout' });

  for (const r of [res(0), undefined, null, {}]) {
    assert.deepEqual(await classifyResponse(r), { kind: 'unreachable', cause: 'opaque' }, JSON.stringify(r));
  }
  const opaque = fakeFetch(() => undefined);
  assert.deepEqual(await send(opaque.fetch).out, { kind: 'unreachable', cause: 'opaque' });
});

test('an already-aborted caller signal sends nothing and is unreachable/aborted', async () => {
  const { fetch, calls } = fakeFetch(() => res(200));
  const ac = new AbortController();
  ac.abort();
  assert.deepEqual(await send(fetch, { signal: ac.signal }).out, { kind: 'unreachable', cause: 'aborted' });
  assert.equal(calls.length, 0);
});

test('the outcome never contains the token, and server messages are capped', async () => {
  const thrown = fakeFetch(() => {
    throw new TypeError(`Failed to fetch ${URL_} with Bearer ${T}`);
  });
  const network = await send(thrown.fetch).out;
  assert.deepEqual(network, { kind: 'unreachable', cause: 'network' });

  const echo = fakeFetch(() => res(401, JSON.stringify({ message: `token ${T} is not valid` })));
  const auth = await send(echo.fetch).out;
  assert.deepEqual(auth, { kind: 'rejected', status: 401, auth: true, message: 'token [token] is not valid' });

  const plain = await classifyResponse(res(500, `upstream saw ${T}`), { token: T });
  assert.equal(plain.message, 'upstream saw [token]');

  const long = await classifyResponse(res(500, 'x'.repeat(5000)), { token: T });
  assert.equal(long.message.length, MESSAGE_CAP);
  assert.equal(MESSAGE_CAP, 200);

  for (const o of [network, auth, plain, long]) assert.ok(!JSON.stringify(o).includes(T), JSON.stringify(o));
});
