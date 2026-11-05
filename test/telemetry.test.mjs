// The telemetry session (lib/telemetry.mjs createTelemetry): the in-memory connection to the
// player's Dash0 (or the practice ingress), the span buffer and the facade ctx.telemetry is.
// Spec: docs/DASH0-LAB.md and the #195 plan §4 (invariants I1-I3, I8, concurrency).
// Fake fetch, fixed bytes, fixed clock and fake timers; nothing touches the network.
// INGRESS_HOSTS ships empty, so live mode injects its host list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_HOSTS } from '../lib/dash0/ingress.mjs';
import { BUFFER_CAP, createTelemetry, PRACTICE_TOKEN } from '../lib/telemetry.mjs';

const HOST = 'ingress.eu-west-1.aws.dash0.com';
const ENDPOINT = `https://${HOST}`;
const TRACES = `${ENDPOINT}/v1/traces`;
const TOKEN = 'auth_Tk9secretValue42xyz';
const TOKEN2 = 'auth_Other7secretQ99abc';
const PRACTICE_ENDPOINT = `https://${PRACTICE_HOSTS[0]}`;
const NOW = 1762300800123;

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Bytes from a counter, so every id the session mints is distinct and reproducible.
function counterBytes(start = 1) {
  let k = start;
  const calls = [];
  const randomBytes = (n) => {
    calls.push(n);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = (k++ * 37) & 0xff;
    return out;
  };
  return { randomBytes, calls };
}

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    pending,
  };
}

const res = (status, body = '') => ({ status, ok: status >= 200 && status < 300, text: async () => body });

// A fetch whose responses the test releases by hand: `calls[i].resolve(res)` / `.reject(err)`.
function heldFetch() {
  const calls = [];
  const fetch = (url, init) =>
    new Promise((resolve, reject) => {
      calls.push({ url, init, resolve, reject, body: JSON.parse(init.body) });
    });
  return { fetch, calls };
}

// A fetch that answers at once.
function instantFetch(respond = () => res(200)) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url, init);
  };
  return { fetch, calls };
}

function make({ fetch = instantFetch().fetch, randomBytes = counterBytes().randomBytes, hosts = [HOST], reportError, ...over } = {}) {
  const timers = fakeTimers();
  const errors = [];
  const telemetry = createTelemetry({
    fetch,
    randomBytes,
    now: () => NOW,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    hosts,
    reportError: reportError ?? ((e) => errors.push(e)),
    ...over,
  });
  return { telemetry, timers, errors };
}

const live = (token = TOKEN, extra = {}) => ({ mode: 'live', endpoint: ENDPOINT, token, dataset: '', ...extra });

// Every span name in a recorded request body.
const spanNames = (body) => body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name)));

let seq = 0;
const draft = (name) => {
  seq += 1;
  return {
    traceId: seq.toString(16).padStart(32, '0'),
    spanId: seq.toString(16).padStart(16, '0'),
    name,
    startMs: NOW,
    endMs: NOW + 5,
    attributes: { 'game.level.id': name },
  };
};

// A live session already connected through an accepted test span (instant fetch).
async function connected(opts = {}) {
  const f = instantFetch(opts.respond);
  const made = make({ fetch: f.fetch, ...opts });
  assert.deepEqual(made.telemetry.connect(live()), { ok: true });
  assert.equal((await made.telemetry.sendTest()).kind, 'accepted');
  return { ...made, calls: f.calls };
}

// Everything observable about the session, as text, for the token scans.
function surface(t) {
  return JSON.stringify(t.status()) + JSON.stringify(Object.keys(t)) + String(t.sessionId);
}

// ---- session id -------------------------------------------------------------------

test('sessionId is stable for the session and derived from the injected bytes', () => {
  const a = make({ randomBytes: counterBytes(1).randomBytes }).telemetry;
  const b = make({ randomBytes: counterBytes(1).randomBytes }).telemetry;
  const c = make({ randomBytes: counterBytes(9).randomBytes }).telemetry;
  assert.equal(typeof a.sessionId, 'string');
  assert.ok(a.sessionId.length >= 8, 'long enough to find in Dash0');
  assert.equal(a.sessionId, a.sessionId, 'the same on every read');
  assert.equal(a.sessionId, b.sessionId, 'the same bytes give the same id');
  assert.notEqual(a.sessionId, c.sessionId, 'other bytes give another id');
  const id = a.sessionId;
  a.connect(live());
  a.disconnect();
  assert.equal(a.sessionId, id, 'connecting and disconnecting keep the session id');
});

test('the session id stamps the test span (one id per page session)', async () => {
  const { telemetry, calls } = await connected();
  const attrs = calls[0].body.resourceSpans[0].scopeSpans[0].spans[0].attributes;
  assert.deepEqual(attrs.find((a) => a.key === 'session.id'), { key: 'session.id', value: { stringValue: telemetry.sessionId } });
});

// ---- connect and the token ---------------------------------------------------------

test('connect rejects a bad endpoint or token and status() never exposes the token in any state', async () => {
  const f = heldFetch();
  const { telemetry } = make({ fetch: f.fetch });
  const scan = (when) => {
    const text = surface(telemetry);
    assert.ok(!text.includes(TOKEN), `token visible ${when}`);
    assert.ok(!text.includes(TOKEN.slice(5, 15)), `part of the token visible ${when}`);
  };
  assert.deepEqual(telemetry.status(), { state: 'off', mode: null, host: null });
  scan('off');

  const badEndpoint = telemetry.connect(live(TOKEN, { endpoint: `${ENDPOINT}/v1/traces` }));
  assert.deepEqual(badEndpoint, { ok: false, field: 'endpoint', reason: 'signal-path' });
  const foreign = telemetry.connect(live(TOKEN, { endpoint: 'https://evil.example' }));
  assert.deepEqual(foreign, { ok: false, field: 'endpoint', reason: 'unknown-host' });
  const badToken = telemetry.connect(live(`Bearer ${TOKEN}`));
  assert.deepEqual(badToken, { ok: false, field: 'token', reason: 'bearer-prefix' });
  assert.ok(!JSON.stringify(badToken).includes(TOKEN));
  const badDataset = telemetry.connect(live(TOKEN, { dataset: 'no spaces' }));
  assert.equal(badDataset.ok, false);
  assert.equal(badDataset.field, 'dataset');
  assert.equal(telemetry.status().state, 'off', 'a failed connect configures nothing');
  scan('after failed connects');

  assert.deepEqual(telemetry.connect(live()), { ok: true });
  assert.deepEqual(telemetry.status(), { state: 'configured', mode: 'live', host: HOST });
  assert.equal(f.calls.length, 0, 'connect validates; it never sends');
  scan('configured');

  const sent = telemetry.sendTest();
  scan('sending');
  await tick();
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`, 'the token goes only in the header');
  assert.ok(!f.calls[0].url.includes(TOKEN));
  assert.ok(!f.calls[0].init.body.includes(TOKEN), 'never in a span attribute');
  f.calls[0].resolve(res(200));
  const outcome = await sent;
  assert.deepEqual(outcome, { kind: 'accepted' });
  assert.equal(telemetry.status().state, 'connected');
  scan('connected');

  telemetry.disconnect();
  assert.deepEqual(telemetry.status(), { state: 'off', mode: null, host: null });
  scan('disconnected');
  for (const key of Object.keys(telemetry)) assert.doesNotMatch(key, /token|secret|auth/i, `no token getter: ${key}`);
});

// ---- the test span drives the state -------------------------------------------------

test('test-span outcomes drive state: 200 gives connected; 401, 500 and a throw leave it configured', async () => {
  const rows = [
    ['200', () => res(200), 'accepted', 'connected'],
    ['401', () => res(401), 'rejected', 'configured'],
    ['500', () => res(500, '{"message":"boom"}'), 'rejected', 'configured'],
    ['throw', () => { throw new TypeError('Failed to fetch'); }, 'unreachable', 'configured'],
  ];
  for (const [name, respond, kind, state] of rows) {
    const f = heldFetch();
    const { telemetry } = make({ fetch: f.fetch });
    telemetry.connect(live());
    const sent = telemetry.sendTest();
    await tick();
    assert.equal(telemetry.status().state, 'configured', `${name}: not connected before the outcome`);
    try {
      f.calls[0].resolve(respond());
    } catch (e) {
      f.calls[0].reject(e);
    }
    const outcome = await sent;
    assert.equal(outcome.kind, kind, name);
    assert.equal(telemetry.status().state, state, name);
    if (name === '401') assert.equal(outcome.auth, true);
    assert.deepEqual(spanNames(f.calls[0].body), ['connection.test'], `${name}: one test span`);
    assert.equal(f.calls[0].url, TRACES);
  }
});

test('sendTest is single-flight: two calls, one fetch, the same promise', async () => {
  const f = heldFetch();
  const { telemetry } = make({ fetch: f.fetch });
  telemetry.connect(live());
  const a = telemetry.sendTest();
  const b = telemetry.sendTest();
  assert.equal(a, b, 'the in-flight promise is returned');
  await tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(res(200));
  assert.equal((await a).kind, 'accepted');
  const c = telemetry.sendTest();
  assert.notEqual(c, a, 'a settled send does not pin later ones');
  await tick();
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(res(200));
  await c;
});

// ---- generation: late outcomes ------------------------------------------------------

test('a late accept after disconnect does not reconnect; after reconnecting with a new token, the old accept does not mark the new config connected', async (t) => {
  await t.test('disconnect', async () => {
    const f = heldFetch();
    const { telemetry } = make({ fetch: f.fetch });
    telemetry.connect(live());
    const sent = telemetry.sendTest();
    await tick();
    telemetry.disconnect();
    f.calls[0].resolve(res(200));
    await sent;
    assert.equal(telemetry.status().state, 'off', 'disconnected stays disconnected');
  });
  await t.test('reconnect with a new token', async () => {
    const f = heldFetch();
    const { telemetry } = make({ fetch: f.fetch });
    telemetry.connect(live());
    const old = telemetry.sendTest();
    await tick();
    assert.deepEqual(telemetry.connect(live(TOKEN2)), { ok: true });
    f.calls[0].resolve(res(200));
    await old;
    assert.equal(telemetry.status().state, 'configured', 'the old token was accepted, not the new one');
    const fresh = telemetry.sendTest();
    await tick();
    assert.equal(f.calls.length, 2, 'the new config sends its own test span');
    assert.equal(f.calls[1].init.headers.Authorization, `Bearer ${TOKEN2}`, 'with the token frozen at connect');
    f.calls[1].resolve(res(401));
    await fresh;
    assert.equal(telemetry.status().state, 'configured');
  });
});

// ---- the span buffer ----------------------------------------------------------------

test('emit is a no-op when not connected and never throws', async () => {
  const f = instantFetch();
  const { telemetry } = make({ fetch: f.fetch });
  assert.equal(telemetry.emit(draft('before-connect')), undefined);
  telemetry.connect(live());
  telemetry.emit(draft('configured-only'));
  assert.doesNotThrow(() => telemetry.emit(null));
  assert.doesNotThrow(() => telemetry.emit({ name: 42 }));
  assert.equal(await telemetry.flush(), null, 'nothing buffered, nothing sent');
  assert.equal(f.calls.length, 0);
  await telemetry.sendTest();
  assert.equal(await telemetry.flush(), null, 'spans emitted before connected were never kept');
  assert.equal(f.calls.length, 1, 'only the test span went out');
});

test('a flush after the session fell back to configured sends nothing, even with spans buffered', async () => {
  let status = 200;
  const f = instantFetch(() => res(status));
  const { telemetry } = make({ fetch: f.fetch });
  telemetry.connect(live());
  await telemetry.sendTest();
  telemetry.emit(draft('buffered-while-connected'));
  assert.equal(telemetry.stats().buffered, 1);
  status = 401;
  await telemetry.sendTest();
  assert.equal(telemetry.status().state, 'configured', 'the token was revoked');
  assert.equal(await telemetry.flush(), null);
  assert.equal(f.calls.length, 2, 'two test spans, no flush');
});

test('emits during an in-flight flush land in the next batch exactly once', async () => {
  const f = heldFetch();
  const { telemetry } = make({ fetch: f.fetch });
  telemetry.connect(live());
  const test0 = telemetry.sendTest();
  await tick();
  f.calls[0].resolve(res(200));
  await test0;
  assert.equal(telemetry.status().state, 'connected');
  telemetry.emit(draft('one'));
  telemetry.emit(draft('two'));
  const first = telemetry.flush();
  telemetry.emit(draft('three'));
  await tick();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(spanNames(f.calls[1].body), ['one', 'two']);
  f.calls[1].resolve(res(200));
  assert.deepEqual(await first, { kind: 'accepted' });
  const second = telemetry.flush();
  await tick();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(spanNames(f.calls[2].body), ['three'], 'the late span once, no repeats');
  f.calls[2].resolve(res(200));
  await second;
  assert.equal(await telemetry.flush(), null, 'the buffer is empty now');
  assert.equal(f.calls.length, 3);
});

test('a failed flush drops and counts its snapshot', async () => {
  let fail = true;
  const f = instantFetch(() => (fail ? res(500) : res(200)));
  const made = make({ fetch: f.fetch });
  const { telemetry } = made;
  telemetry.connect(live());
  fail = false;
  await telemetry.sendTest();
  fail = true;
  telemetry.emit(draft('lost-a'));
  telemetry.emit(draft('lost-b'));
  telemetry.emit(draft('lost-c'));
  assert.equal((await telemetry.flush()).kind, 'rejected');
  assert.equal(telemetry.stats().dropped, 3);
  fail = false;
  telemetry.emit(draft('kept'));
  await telemetry.flush();
  assert.deepEqual(spanNames(f.calls.at(-1).body), ['kept'], 'the failed snapshot is not retried');
  assert.equal(telemetry.stats().dropped, 3);
});

test('the buffer cap drops overflow and counts it (cap+5 gives 5 dropped)', async () => {
  const { telemetry, calls } = await connected();
  const f = { calls };
  const CAP = BUFFER_CAP;
  assert.equal(CAP, 200);
  for (let i = 0; i < CAP + 5; i += 1) telemetry.emit(draft(`s${i}`));
  assert.equal(telemetry.stats().dropped, 5);
  await telemetry.flush();
  const names = spanNames(f.calls.at(-1).body);
  assert.equal(names.length, CAP);
  assert.equal(names[0], 's0', 'the oldest are kept');
  assert.equal(names.at(-1), `s${CAP - 1}`, 'the overflow is what is dropped');
});

// ---- practice -----------------------------------------------------------------------

test('practice mode never calls the injected real fetch', async () => {
  const f = instantFetch();
  const { telemetry } = make({ fetch: f.fetch });
  assert.deepEqual(telemetry.connect({ mode: 'practice', endpoint: PRACTICE_ENDPOINT, token: PRACTICE_TOKEN, dataset: '' }), { ok: true });
  assert.deepEqual(telemetry.status(), { state: 'configured', mode: 'practice', host: PRACTICE_HOSTS[0] });
  assert.deepEqual(await telemetry.sendTest(), { kind: 'accepted' }, 'the practice ingress accepted it');
  assert.equal(telemetry.status().state, 'connected');
  telemetry.emit(draft('practice-span'));
  assert.deepEqual(await telemetry.flush(), { kind: 'accepted' });
  assert.equal(f.calls.length, 0, 'the real fetch was never called');
  assert.equal(telemetry.connect({ mode: 'practice', endpoint: ENDPOINT, token: PRACTICE_TOKEN, dataset: '' }).reason, 'unknown-host', 'practice accepts only the practice host');
});

test('a wrong practice token is an auth rejection from the practice ingress, not the network', async () => {
  const f = instantFetch();
  const { telemetry } = make({ fetch: f.fetch });
  telemetry.connect({ mode: 'practice', endpoint: PRACTICE_ENDPOINT, token: TOKEN, dataset: '' });
  const out = await telemetry.sendTest();
  assert.deepEqual(out, { kind: 'rejected', status: 401, auth: true });
  assert.equal(telemetry.status().state, 'configured');
  assert.equal(f.calls.length, 0);
});

test('live mode is unavailable without hosts or without fetch', () => {
  assert.equal(make().telemetry.liveAvailable(), true);
  assert.equal(make({ hosts: [] }).telemetry.liveAvailable(), false);
  assert.equal(make({ fetch: null }).telemetry.liveAvailable(), false);
  const { telemetry } = make({ hosts: [] });
  assert.equal(telemetry.connect(live()).ok, false, 'no live host can be configured while the list is empty');
});

// ---- reportError --------------------------------------------------------------------

const leaks = (e) =>
  `${e?.message ?? ''} ${e?.stack ?? ''} ${JSON.stringify(e) ?? ''} ${String(e)} ${JSON.stringify(e?.cause ?? null)}`.includes(TOKEN);

test('reportError never receives the token', async () => {
  const seen = [];
  // A host whose fetch error and whose broken clearTimeout both echo the Authorization header
  // they saw: the worst case of a dependency that leaks the request into its error text.
  let lastAuth = '';
  let mode = 'ok';
  const fetch = async (url, init) => {
    lastAuth = init.headers.Authorization;
    if (mode === 'throw') throw new TypeError(`Failed to fetch ${url} with ${lastAuth}`);
    if (mode === 'echo') return res(500, `bad token ${lastAuth}`);
    return res(200);
  };
  const { telemetry } = make({ fetch, reportError: (e) => seen.push(e) });
  telemetry.connect(live());
  assert.equal((await telemetry.sendTest()).kind, 'accepted');
  mode = 'echo';
  telemetry.emit(draft('echo'));
  const echoed = await telemetry.flush();
  assert.ok(!JSON.stringify(echoed).includes(TOKEN), 'the outcome carries no token');
  mode = 'throw';
  telemetry.emit(draft('throw'));
  await telemetry.flush();
  telemetry.emit({ name: 'bad', traceId: 'not-hex' });
  const before = seen.length;

  const broken = make({
    fetch: async (url, init) => {
      lastAuth = init.headers.Authorization;
      return res(200);
    },
    reportError: (e) => seen.push(e),
    clearTimeout: () => {
      throw new Error(`clearTimeout failed after ${lastAuth}`);
    },
  });
  broken.telemetry.connect(live());
  const out = await broken.telemetry.sendTest();
  assert.ok(!JSON.stringify(out).includes(TOKEN));
  assert.ok(seen.length > before, 'the broken dependency was reported');
  assert.ok(seen.length >= 2, 'the bad draft was reported too');

  for (const e of seen) assert.ok(!leaks(e), `reported: ${String(e).slice(0, 120)}`);
});

test('reportError never receives the token: a late error after disconnect or reconnect, or a bare string', async () => {
  const seen = [];
  const failures = [];
  // The same leak arriving late: after a disconnect, and after a reconnect with another token;
  // and thrown as a bare string rather than an Error.
  for (const [name, between, thrown] of [
    ['after disconnect', (t) => t.disconnect(), (a) => new Error(`late ${a}`)],
    ['after reconnect', (t) => t.connect(live(TOKEN2)), (a) => new Error(`late ${a}`)],
    ['a bare string', () => {}, (a) => `late ${a}`],
  ]) {
    let release;
    const gate = new Promise((r) => { release = r; });
    let auth = '';
    const late = make({
      fetch: async (url, init) => {
        auth = init.headers.Authorization;
        await gate;
        return res(200);
      },
      reportError: (e) => seen.push(e),
      clearTimeout: () => {
        throw thrown(auth);
      },
    });
    late.telemetry.connect(live());
    const pending = late.telemetry.sendTest();
    await tick();
    between(late.telemetry);
    const n = seen.length;
    release();
    await pending;
    assert.ok(seen.length > n, `${name}: reported`);
    failures.push(...seen.slice(n).filter(leaks).map(() => name));
  }
  assert.deepEqual(failures, [], 'no late report carries the token');
});

test('reportError never receives the token in another shape: URL-encoded, upper-cased or base64 in a thrown message', async () => {
  const SPECIAL = 'auth_Sp+ec/ial=Tok9en#42';
  const forms = {
    'URL-encoded': encodeURIComponent(SPECIAL),
    'upper-cased': SPECIAL.toUpperCase(),
    base64: Buffer.from(SPECIAL).toString('base64'),
    'URL-safe base64': Buffer.from(`Bearer ${SPECIAL}`).toString('base64url'),
  };
  for (const [name, form] of Object.entries(forms)) {
    const seen = [];
    const { telemetry } = make({
      fetch: async () => res(200),
      reportError: (e) => seen.push(e),
      clearTimeout: () => {
        throw new Error(`proxy said no: ${form}`);
      },
    });
    assert.deepEqual(telemetry.connect(live(SPECIAL)), { ok: true });
    await telemetry.sendTest();
    assert.equal(seen.length, 1, name);
    assert.ok(seen[0] instanceof Error, name);
    assert.equal(seen[0].message, 'telemetry error (message withheld)', name);
    assert.equal(seen[0].cause, undefined, name);
  }
});

test('a message with no token in it is forwarded as it is', async () => {
  const seen = [];
  const { telemetry } = make({
    fetch: async () => res(200),
    reportError: (e) => seen.push(e),
    clearTimeout: () => {
      throw new Error('timer table full');
    },
  });
  telemetry.connect(live());
  await telemetry.sendTest();
  assert.deepEqual(seen.map((e) => e.message), ['timer table full']);
});

// ---- a config change while a flush is in flight --------------------------------------

async function heldConnected() {
  const f = heldFetch();
  const made = make({ fetch: f.fetch });
  made.telemetry.connect(live());
  const first = made.telemetry.sendTest();
  await tick();
  f.calls[0].resolve(res(200));
  await first;
  assert.equal(made.telemetry.status().state, 'connected');
  return { ...made, f };
}

test('a reconnect during a flush: the old 500 neither counts as dropped nor touches the new config', async () => {
  const { telemetry, f } = await heldConnected();
  telemetry.emit(draft('one'));
  telemetry.emit(draft('two'));
  const flushing = telemetry.flush();
  await tick();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(telemetry.connect(live(TOKEN2)), { ok: true });
  f.calls[1].resolve(res(500));
  await flushing;
  assert.deepEqual({ ...telemetry.stats() }, { buffered: 0, dropped: 0 });
  assert.equal(telemetry.status().state, 'configured', 'the new config is not connected by the old flush');
  assert.equal(telemetry.status().mode, 'live');
});

test('a flush that finishes after the config changed returns unreachable/aborted, as sendBatch does', async () => {
  for (const settle of [(c) => c.resolve(res(200)), (c) => c.resolve(res(500))]) {
    const { telemetry, f } = await heldConnected();
    telemetry.emit(draft('one'));
    const flushing = telemetry.flush();
    await tick();
    telemetry.disconnect();
    settle(f.calls[1]);
    assert.deepEqual(await flushing, { kind: 'unreachable', cause: 'aborted' });
  }
  const { telemetry, f } = await heldConnected();
  const batching = telemetry.sendBatch([draft('b')]);
  await tick();
  telemetry.disconnect();
  f.calls[1].resolve(res(200));
  assert.deepEqual(await batching, { kind: 'unreachable', cause: 'aborted' });
});

// ---- leaving connected ----------------------------------------------------------------

test('a failed re-test (connected -> configured) clears the buffer and counts it dropped', async () => {
  let status = 200;
  const f = instantFetch(() => res(status));
  const { telemetry } = make({ fetch: f.fetch });
  telemetry.connect(live());
  await telemetry.sendTest();
  telemetry.emit(draft('a'));
  telemetry.emit(draft('b'));
  status = 401;
  await telemetry.sendTest();
  assert.equal(telemetry.status().state, 'configured');
  assert.deepEqual({ ...telemetry.stats() }, { buffered: 0, dropped: 2 });
  status = 200;
  await telemetry.sendTest();
  assert.equal(telemetry.status().state, 'connected');
  assert.equal(await telemetry.flush(), null, 'the old spans did not come back with the connection');
  assert.equal(f.calls.length, 3);
});

test('an aborted re-test also clears the buffer and counts it dropped', async () => {
  const { telemetry } = await connected();
  telemetry.emit(draft('a'));
  const ac = new AbortController();
  ac.abort();
  assert.deepEqual(await telemetry.sendTest({ signal: ac.signal }), { kind: 'unreachable', cause: 'aborted' });
  assert.equal(telemetry.status().state, 'configured');
  assert.deepEqual({ ...telemetry.stats() }, { buffered: 0, dropped: 1 });
});

// ---- drafts are copied ------------------------------------------------------------------

test('mutating a draft after emit cannot change or poison the buffered span', async () => {
  const { telemetry, calls } = await connected();
  const d = {
    name: 'copy',
    attributes: { k: 'v' },
    events: [{ name: 'ev', timeMs: NOW, attributes: { e: 1 } }],
    status: { code: 'ok' },
  };
  telemetry.emit(d);
  d.attributes.k = { not: 'encodable' };
  d.attributes.extra = 'late';
  d.events[0].attributes.e = Symbol('bad');
  d.status.code = 'bogus';
  assert.equal((await telemetry.flush()).kind, 'accepted');
  const [span] = calls.at(-1).body.resourceSpans[0].scopeSpans[0].spans;
  const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(attrs.k, { stringValue: 'v' });
  assert.equal(attrs.extra, undefined);
  assert.deepEqual(span.events[0].attributes, [{ key: 'e', value: { intValue: '1' } }]);
  assert.equal(span.status.code, 1);
});
