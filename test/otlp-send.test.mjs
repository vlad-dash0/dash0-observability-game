// The OTLP/HTTP sender and the one response classifier (lib/otlp/send.mjs).
// Spec: docs/DASH0-LAB.md §Sender. Fake fetch and fake timers, except the last two tests, which use Node's real fetch
// against a server on loopback (127.0.0.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BODY_CAP, DATASET_HEADER, MESSAGE_CAP, TIMEOUT_MS, classifyResponse, sendTraces } from '../lib/otlp/send.mjs';

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
  // End to end through sendTraces too. 401 and 403 never surface server text: the game's own
  // copy explains an auth failure, and an auth error body is where a server echoes the token.
  for (const status of [401, 403]) {
    const { fetch } = fakeFetch(() => res(status, '{"message":"no ingest permission"}'));
    assert.deepEqual(await send(fetch).out, { kind: 'rejected', status, auth: true }, String(status));
    assert.deepEqual(await classifyResponse(res(status, 'plain text reason'), { token: T }), { kind: 'rejected', status, auth: true });
  }
  // The same body on a non-auth status does surface (so the drop above is about the status).
  const { fetch } = fakeFetch(() => res(400, '{"message":"no ingest permission"}'));
  assert.deepEqual(await send(fetch).out, { kind: 'rejected', status: 400, auth: false, message: 'no ingest permission' });
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
  assert.deepEqual(auth, { kind: 'rejected', status: 401, auth: true });

  // A message that carries the token is dropped whole, not patched.
  const plain = await classifyResponse(res(500, `upstream saw ${T}`), { token: T });
  assert.deepEqual(plain, { kind: 'rejected', status: 500, auth: false });

  const long = await classifyResponse(res(500, 'x'.repeat(5000)), { token: T });
  assert.equal(long.message.length, MESSAGE_CAP);
  assert.equal(MESSAGE_CAP, 200);

  for (const o of [network, auth, plain, long]) assert.ok(!JSON.stringify(o).includes(T), JSON.stringify(o));
});

// Every form a server can echo the token in. Each one, sent on a non-auth status (where a
// message would otherwise surface), must drop the message; a clean message on the same status
// still surfaces, so the drop is about the echo and not the status.
test('an echoed token in any form (verbatim, URL-encoded, JSON-escaped, an 8+ character run) never reaches the outcome', async () => {
  // A token with a " or \\ in every 8-character window, characters both URL-encoding and
  // JSON-escaping change: no raw 8-character run survives either encoding, so only a check of
  // the encoded form itself catches the encoded echo.
  const TK = 'auth_Q7"x/w\\9+Zr"Lm4\\Kp2';
  for (let i = 0; i + 8 <= TK.length; i += 1) assert.match(TK.slice(i, i + 8), /["\\]/, `window ${i}`);
  assert.notEqual(encodeURIComponent(TK), TK);
  assert.notEqual(JSON.stringify(TK).slice(1, -1), TK);
  const run = TK.slice(9, 17); // 8 characters from the middle, no prefix
  assert.equal(run.length, 8);
  const forms = [
    ['verbatim, plain text', `upstream saw ${TK} and refused`],
    ['verbatim in a message key', JSON.stringify({ message: `bad ${TK}` })],
    ['URL-encoded, plain text', `GET /v1/traces?t=${encodeURIComponent(TK)} refused`],
    ['URL-encoded in a message key', JSON.stringify({ message: `t=${encodeURIComponent(TK)}` })],
    ['JSON body with no message key (escaped " and \\)', JSON.stringify({ error: { detail: `got ${TK}` } })],
    ['JSON-escaped run inside plain text', `echo ${JSON.stringify(TK).slice(1, -1)} end`],
    ['an 8-character run of the token', `token starting ...${run}... unknown`],
    ['an 8-character run in a message key', JSON.stringify({ message: `prefix ${run}` })],
  ];
  for (const status of [400, 404, 429, 500]) {
    for (const [what, body] of forms) {
      const out = await classifyResponse(res(status, body), { token: TK });
      assert.deepEqual(out, { kind: 'rejected', status, auth: false }, `${status} ${what}: ${JSON.stringify(out)}`);
    }
    for (const [what, body] of forms) {
      const { fetch } = fakeFetch(() => res(status, body));
      const out = await send(fetch, { token: TK }).out;
      assert.deepEqual(out, { kind: 'rejected', status, auth: false }, `send ${status} ${what}`);
    }
  }
  // In a 2xx partialSuccess.errorMessage too.
  const partial = JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: `for ${encodeURIComponent(TK)}` } });
  assert.deepEqual(await classifyResponse(res(200, partial), { token: TK }), { kind: 'rejected', status: 200, auth: false });
  // A 7-character run is not a match: ordinary words must still get through.
  const seven = TK.slice(9, 16);
  assert.deepEqual(await classifyResponse(res(400, `near ${seven} miss`), { token: TK }), {
    kind: 'rejected', status: 400, auth: false, message: `near ${seven} miss`,
  });
  assert.deepEqual(await classifyResponse(res(400, 'span too old'), { token: TK }), {
    kind: 'rejected', status: 400, auth: false, message: 'span too old',
  });
});

// The same search runs on a normalised haystack: case, whitespace, HTML entities, \u escapes
// and base64 of the token or of "Bearer " + token cannot get a message past it.
test('a token echoed in a normalised form (case, whitespace, entities, \\u escapes, base64) drops the message', async () => {
  const TK = 'auth_Q7xKw9ZrLm4Kp2Vb8Nd3';
  const b64 = (s) => Buffer.from(s).toString('base64');
  const chunk = (s, n, sep) => s.match(new RegExp(`.{1,${n}}`, 'g')).join(sep);
  const entities = [...TK].map((c) => `&#${c.charCodeAt(0)};`).join('');
  const hexEntities = [...TK].map((c) => `&#x${c.charCodeAt(0).toString(16)};`).join('');
  const uEscaped = [...TK].map((c) => `\\u00${c.charCodeAt(0).toString(16)}`).join('');
  const forms = [
    ['upper-cased', `saw ${TK.toUpperCase()} here`],
    ['lower-cased', `saw ${TK.toLowerCase()} here`],
    ['split in 4-character pieces by spaces', chunk(TK, 4, ' ')],
    ['split in 7-character pieces by newlines', chunk(TK, 7, '\n')],
    ['split in 4-character pieces by newlines', JSON.stringify({ message: chunk(TK, 4, '\n') })],
    ['\\u-escaped JSON without a message key', `{"error":{"detail":"${uEscaped}"}}`],
    ['decimal entities', `saw ${entities}`],
    ['hex entities', `saw ${hexEntities}`],
    ['entity-escaped quote around the token', `&quot;${TK}&quot; &amp; more`],
    ['base64 of the token', `x ${b64(TK)} y`],
    ['base64 of Bearer + token', `x ${b64(`Bearer ${TK}`)} y`],
    ['base64 of the token, wrapped', chunk(b64(TK), 6, '\n')],
  ];
  // The three byte alignments: the token sits at offset 0, 1 and 2 inside a longer base64 string.
  for (const pad of ['', 'a', 'ab']) {
    forms.push([`base64 of the token at alignment ${pad.length}`, `h ${b64(pad + TK)} t`]);
    forms.push([`base64 of Bearer + token at alignment ${pad.length}`, `h ${b64(`${pad}Bearer ${TK}`)} t`]);
    forms.push([`base64 of the token at alignment ${pad.length}, mid-string`, `h ${b64(`${pad}${TK}zz`)} t`]);
  }
  for (const status of [400, 500, 502]) {
    for (const [what, body] of forms) {
      const out = await classifyResponse(res(status, body), { token: TK });
      assert.deepEqual(out, { kind: 'rejected', status, auth: false }, `${status} ${what}: ${JSON.stringify(out)}`);
    }
  }
  // \u escapes live in the JSON text itself, so this one is written into the raw body.
  const rawPartial = `{"partialSuccess":{"rejectedSpans":1,"errorMessage":"${uEscaped}"}}`;
  assert.deepEqual(await classifyResponse(res(200, rawPartial), { token: TK }), { kind: 'rejected', status: 200, auth: false }, 'partial \\u-escaped');
  for (const [what, em] of forms.filter(([w]) => !w.startsWith('\\u'))) {
    const partial = JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: em } });
    assert.deepEqual(await classifyResponse(res(200, partial), { token: TK }), { kind: 'rejected', status: 200, auth: false }, `partial ${what}`);
  }
  // Clean messages still pass, and so does a 7-character run of the token.
  const seven = TK.slice(8, 15);
  for (const msg of ['span too old', `near ${seven} miss`]) {
    assert.deepEqual(await classifyResponse(res(400, msg), { token: TK }), { kind: 'rejected', status: 400, auth: false, message: msg });
    const partial = JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: msg } });
    assert.deepEqual(await classifyResponse(res(200, partial), { token: TK }), { kind: 'rejected', status: 200, auth: false, message: msg });
  }
});

// A body read that fails is the connection failing, not an empty (accepted) body.
test('a body read that throws is unreachable: timeout when the timer fired, aborted when the caller aborted, network otherwise', { timeout: 5000 }, async () => {
  const bodyHangs = (init, onRead) => ({
    status: 200,
    text: () => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      onRead?.();
    }),
  });

  // Timeout during the read.
  let reading;
  const t = send(async (url, init) => bodyHangs(init, () => reading()));
  await new Promise((r) => { reading = r; });
  t.timers.fire();
  assert.deepEqual(await t.out, { kind: 'unreachable', cause: 'timeout' });
  assert.equal(t.timers.pending.size, 0);

  // Caller abort during the read.
  const ac = new AbortController();
  let readInit;
  const a = send(async (url, init) => { readInit = init; return bodyHangs(init, () => reading()); }, { signal: ac.signal });
  await new Promise((r) => { reading = r; });
  ac.abort();
  // Checked before awaiting, so a missing abort wiring fails here instead of hanging.
  assert.equal(readInit.signal.aborted, true, 'the caller abort reaches the body read');
  assert.deepEqual(await a.out, { kind: 'unreachable', cause: 'aborted' });

  // The stream breaking on its own.
  const broken = fakeFetch(() => ({ status: 200, text: async () => { throw new TypeError('network error'); } }));
  assert.deepEqual(await send(broken.fetch).out, { kind: 'unreachable', cause: 'network' });
  // Same for a non-2xx: a failed read is never a rejection with a guessed body.
  const broken500 = fakeFetch(() => ({ status: 500, text: async () => { throw new TypeError('network error'); } }));
  assert.deepEqual(await send(broken500.fetch).out, { kind: 'unreachable', cause: 'network' });
});

test('a 2xx body must be empty, whitespace or a JSON object: null, a string, an array and HTML are unreadable', async () => {
  for (const body of ['null', '"x"', '[1]', '[]', '42', 'true', '<html><body>ok</body></html>', '{"partialSuccess":']) {
    assert.deepEqual(await classifyResponse(res(200, body), { token: T }), {
      kind: 'rejected', status: 200, auth: false, message: 'Unreadable response body',
    }, body);
  }
  for (const body of ['', ' ', '\n\t  ', '{}']) {
    assert.deepEqual(await classifyResponse(res(200, body), { token: T }), { kind: 'accepted' }, JSON.stringify(body));
  }
});

test('the caller aborting mid-flight aborts the request: unreachable/aborted, timer cleared, listener removed', { timeout: 5000 }, async () => {
  let seen;
  const hung = async (url, init) => {
    seen = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };
  const ac = new AbortController();
  const added = [];
  const removed = [];
  const signal = ac.signal;
  const origAdd = signal.addEventListener.bind(signal);
  const origRemove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, fn, o) => { added.push([type, fn]); return origAdd(type, fn, o); };
  signal.removeEventListener = (type, fn, o) => { removed.push([type, fn]); return origRemove(type, fn, o); };

  const h = send(hung, { signal });
  await Promise.resolve();
  assert.equal(seen.aborted, false);
  assert.notEqual(seen, signal, 'fetch gets the combined signal, not the caller one');
  ac.abort();
  assert.equal(seen.aborted, true, 'the caller abort reaches the request');
  assert.deepEqual(await h.out, { kind: 'unreachable', cause: 'aborted' });
  assert.equal(h.timers.pending.size, 0, 'the timer is cleared');
  assert.deepEqual(h.timers.cleared, [1]);
  assert.equal(added.length, 1);
  assert.equal(added[0][0], 'abort');
  assert.deepEqual(removed, added, 'the same listener is removed');
});

test('missing setTimeout or clearTimeout throws before any listener is attached or request sent', async () => {
  const { fetch, calls } = fakeFetch(() => res(200));
  for (const missing of ['setTimeout', 'clearTimeout']) {
    const added = [];
    const signal = { aborted: false, addEventListener: (...a) => added.push(a), removeEventListener: () => {} };
    const timers = fakeTimers();
    const args = { fetch, tracesUrl: URL_, token: T, body: BODY, signal, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout };
    delete args[missing];
    await assert.rejects(async () => sendTraces(args), TypeError, missing);
    assert.deepEqual(added, [], `no listener when ${missing} is missing`);
    assert.equal(timers.delays.length, 0, `no timer armed when ${missing} is missing`);
  }
  assert.equal(calls.length, 0);
});

test('a response over 64 KiB is never inspected: no message on an error status, unreadable on a 2xx; just under the cap still surfaces a clean message', async () => {
  assert.equal(BODY_CAP, 65_536);
  // Pathological body: unpatched escape stripping is quadratic on this.
  const started = performance.now();
  const slow = await classifyResponse(res(500, '\\'.repeat(200 * 1024)), { token: T });
  assert.ok(performance.now() - started < 1000, `took ${performance.now() - started} ms`);
  assert.deepEqual(slow, { kind: 'rejected', status: 500, auth: false });

  const over = JSON.stringify({ message: 'clean words', pad: 'x'.repeat(BODY_CAP) });
  assert.ok(over.length > BODY_CAP);
  assert.deepEqual(await classifyResponse(res(400, over), { token: T }), { kind: 'rejected', status: 400, auth: false });
  assert.deepEqual(await classifyResponse(res(200, over), { token: T }), {
    kind: 'rejected',
    status: 200,
    auth: false,
    message: 'Unreadable response body',
  });

  const pad = BODY_CAP - JSON.stringify({ message: 'clean words', pad: '' }).length;
  const under = JSON.stringify({ message: 'clean words', pad: 'x'.repeat(pad) });
  assert.equal(under.length, BODY_CAP);
  assert.deepEqual(await classifyResponse(res(400, under), { token: T }), {
    kind: 'rejected',
    status: 400,
    auth: false,
    message: 'clean words',
  });
});

// Node's own fetch (undici) against a real local server: the init options the sender passes
// (for example credentials, referrerPolicy, cache, redirect) must be accepted outside a browser too.
async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("sendTraces over Node's own fetch: accepted, with the headers on the wire", async () => {
  let seen;
  await withServer(
    (req, resp) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen = { method: req.method, headers: req.headers, body: data };
        resp.writeHead(200, { 'content-type': 'application/json' });
        resp.end('{}');
      });
    },
    async (base) => {
      const out = await sendTraces({
        fetch: globalThis.fetch,
        tracesUrl: `${base}/v1/traces`,
        token: 'auth_x12345678',
        dataset: 'ds',
        body: { a: 1 },
        setTimeout,
        clearTimeout,
      });
      assert.deepEqual(out, { kind: 'accepted' });
    },
  );
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.authorization, 'Bearer auth_x12345678');
  assert.equal(seen.headers['dash0-dataset'], 'ds');
  assert.equal(seen.headers['content-type'], 'application/json');
  assert.equal(seen.body, '{"a":1}');
});

test("sendTraces over Node's own fetch: a redirect fails the send", async () => {
  let hits = 0;
  await withServer(
    (req, resp) => {
      if (req.url === '/elsewhere') {
        hits += 1;
        resp.writeHead(200).end('{}');
      } else {
        resp.writeHead(302, { location: '/elsewhere' }).end();
      }
    },
    async (base) => {
      const out = await sendTraces({
        fetch: globalThis.fetch,
        tracesUrl: `${base}/v1/traces`,
        token: 'auth_x12345678',
        body: { a: 1 },
        setTimeout,
        clearTimeout,
      });
      assert.deepEqual(out, { kind: 'unreachable', cause: 'network' });
    },
  );
  assert.equal(hits, 0);
});
