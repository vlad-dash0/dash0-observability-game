// The guide function (api/guide.mjs, #17 P2) and its limiter, driven with a fake fetch, a fixed clock and a
// log spy. No network, no key. Spec: docs/FOUNDATION.md §2.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveRegistry } from '../app.mjs';
import { createGuide } from '../api/guide.mjs';
import { createLimiter } from '../lib/guide/limit.mjs';

const KEY = 'sk-ant-test-key-0123456789';
const IP = '203.0.113.77';
const URL_ = 'https://game.test/api/guide';
const REG = liveRegistry();
// A choice step the guide may speak on, a step that has no hint ladder, and a level that runs its own code.
const LEVEL = 'resources';
const STEP = 'res-pod';
const RIGHT = REG.levels[LEVEL].play.steps.map((s) => s.choice).find((c) => c?.id === STEP).choices.find((c) => c.right).label;
const HINTLESS = ['auto-vs-manual', 'avm-sort'];
const RUN_LEVEL = 'the-signals';
const NEUTRAL = 'Re-read what the question asks.';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}
const textReply = (text) => async () => Response.json({ content: [{ type: 'text', text }] });

function setup({ env = { ANTHROPIC_API_KEY: KEY }, fetch = fakeFetch(textReply(NEUTRAL)), now = () => 1_000_000, limiter } = {}) {
  const logs = [];
  const guide = createGuide({ env, fetch, now, log: (line) => logs.push(line), limiter: limiter ?? createLimiter({ now }), registry: REG });
  return { guide, fetch, logs };
}

const body = (over = {}) => ({ v: 1, levelId: LEVEL, stepId: STEP, question: 'What does a resource describe?', ...over });
function post(payload, { headers = {}, raw } = {}) {
  const text = raw ?? JSON.stringify(payload);
  return new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': IP, ...headers }, body: text });
}
const read = async (res) => ({ status: res.status, headers: res.headers, json: await res.json() });

test('GET reports configured only for a non-empty key, uncached', async () => {
  for (const [env, want] of [[{}, false], [{ ANTHROPIC_API_KEY: '' }, false], [{ ANTHROPIC_API_KEY: KEY }, true]]) {
    const res = await read(await setup({ env }).guide.GET(new Request(URL_)));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { v: 1, configured: want });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('POST without a key is 503 and never calls the model', async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: '' }]) {
    const { guide, fetch } = setup({ env });
    const res = await read(await guide.POST(post(body())));
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'not-configured' });
    assert.equal(fetch.calls.length, 0);
  }
});

test('a good question calls Messages once with the key, version and model, and returns the reply', async () => {
  const { guide, fetch } = setup();
  const res = await read(await guide.POST(post(body())));
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, hint: NEUTRAL });
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], KEY);
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.ok(init.signal instanceof AbortSignal);
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.equal(sent.max_tokens, 300);
  assert.match(sent.system, /Option: /, 'the step as the player sees it');
  assert.deepEqual(sent.messages, [{ role: 'user', content: '<question>What does a resource describe?</question>' }]);
});

test('a reply that states the answer is withheld and never sent', async () => {
  const { guide } = setup({ fetch: fakeFetch(textReply(`The answer is: ${RIGHT}`)) });
  const res = await read(await guide.POST(post(body())));
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: false, error: 'withheld' });
  assert.ok(!JSON.stringify(res.json).includes(RIGHT));
});

test('the question is validated: 1 to 300 chars, no control characters, only the listed fields', async () => {
  const bad = async (payload, field, opts) => {
    const { guide, fetch } = setup();
    const res = await read(await guide.POST(post(payload, opts)));
    assert.equal(res.status, 400, field);
    assert.deepEqual(res.json, { ok: false, error: 'bad-request', field });
    assert.equal(fetch.calls.length, 0);
  };
  await bad(body({ question: '' }), 'question');
  await bad(body({ question: '   ' }), 'question');
  await bad(body({ question: 'x'.repeat(301) }), 'question');
  await bad(body({ question: 'two\nlines' }), 'question');
  await bad(body({ question: 7 }), 'question');
  await bad(body({ v: 2 }), 'v');
  await bad(body({ levelId: 'Not An Id' }), 'levelId');
  await bad(body({ stepId: '' }), 'stepId');
  await bad(body({ pick: 'x' }), 'body');
  await bad(null, 'body', { raw: '{not json' });
  await bad(null, 'body', { raw: '[]' });
  const { guide } = setup();
  assert.equal((await guide.POST(post(body({ question: 'x'.repeat(300) })))).status, 200);
  assert.equal((await guide.POST(post(body({ question: '  padded  ' })))).status, 200);
});

test('size, content type and method are refused', async () => {
  const { guide, fetch } = setup();
  const big = await read(await guide.POST(post(body({ question: 'x'.repeat(2100) }))));
  assert.equal(big.status, 413);
  const declared = await read(await guide.POST(post(body(), { headers: { 'content-length': '5000' } })));
  assert.equal(declared.status, 413);
  const type = await read(await guide.POST(post(body(), { headers: { 'content-type': 'text/plain' } })));
  assert.equal(type.status, 415);
  const put = await read(await guide.POST(new Request(URL_, { method: 'PUT', body: '{}' })));
  assert.equal(put.status, 405);
  const getPost = await read(await guide.GET(new Request(URL_, { method: 'POST', body: '{}' })));
  assert.equal(getPost.status, 405);
  assert.equal(fetch.calls.length, 0);
});

test('a run level or an unknown step is 404 unknown-step; a step without a hint ladder is 404 unavailable', async () => {
  for (const payload of [body({ levelId: RUN_LEVEL }), body({ levelId: 'no-such-level' }), body({ stepId: 'no-such-step' })]) {
    const { guide, fetch } = setup();
    const res = await read(await guide.POST(post(payload)));
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: 'unknown-step' });
    assert.equal(fetch.calls.length, 0);
  }
  const { guide, fetch } = setup();
  const res = await read(await guide.POST(post(body({ levelId: HINTLESS[0], stepId: HINTLESS[1] }))));
  assert.equal(res.status, 404);
  assert.deepEqual(res.json, { error: 'unavailable' });
  assert.equal(fetch.calls.length, 0);
});

test('an upstream failure is 502 with no hint, whatever the failure', async () => {
  const cases = {
    'status 500': async () => new Response('boom', { status: 500 }),
    timeout: async () => { throw new DOMException('timed out', 'TimeoutError'); },
    'not json': async () => new Response('<html>', { status: 200 }),
    'no content array': async () => Response.json({ error: 'x' }),
    'empty text': textReply(''),
    'blank text': textReply('  \n'),
    'no text block': async () => Response.json({ content: [{ type: 'tool_use' }] }),
  };
  for (const [name, handler] of Object.entries(cases)) {
    const { guide } = setup({ fetch: fakeFetch(handler) });
    const res = await read(await guide.POST(post(body())));
    assert.equal(res.status, 502, name);
    assert.deepEqual(res.json, { error: 'upstream' }, name);
  }
});

test('the reply is the joined text blocks, trimmed and capped at 600 characters', async () => {
  const two = fakeFetch(async () => Response.json({ content: [{ type: 'text', text: ' Look at ' }, { type: 'text', text: 'the question. ' }] }));
  assert.equal((await read(await setup({ fetch: two }).guide.POST(post(body())))).json.hint, 'Look at the question.');
  const long = fakeFetch(textReply('a '.repeat(500)));
  assert.equal((await read(await setup({ fetch: long }).guide.POST(post(body())))).json.hint.length, 600);
});

test('the limiter allows 6 per client per 10 minutes, then 429 with Retry-After', async () => {
  let t = 1_000_000;
  const { guide } = setup({ now: () => t, limiter: createLimiter({ now: () => t }) });
  for (let i = 0; i < 6; i++) assert.equal((await guide.POST(post(body()))).status, 200, `request ${i + 1}`);
  const res = await read(await guide.POST(post(body())));
  assert.equal(res.status, 429);
  assert.equal(res.json.error, 'rate-limited');
  assert.equal(res.json.retryAfterS, 600);
  assert.equal(res.headers.get('retry-after'), '600');
  const other = await guide.POST(post(body(), { headers: { 'x-forwarded-for': '198.51.100.9' } }));
  assert.equal(other.status, 200, 'another client is unaffected');
  t += 599_000;
  assert.equal((await read(await guide.POST(post(body())))).json.retryAfterS, 1);
  t += 1_000;
  assert.equal((await guide.POST(post(body()))).status, 200, 'a new window');
});

test('a refused or invalid request does not use up the limit', async () => {
  const { guide } = setup();
  for (let i = 0; i < 10; i++) await guide.POST(post(body({ question: '' })));
  for (let i = 0; i < 6; i++) assert.equal((await guide.POST(post(body()))).status, 200);
});

test('the limiter also caps the instance at 60 a minute across clients', () => {
  let t = 5_000;
  const limiter = createLimiter({ now: () => t });
  for (let i = 0; i < 60; i++) assert.equal(limiter.take(`c${i}`).ok, true);
  assert.deepEqual(limiter.take('c61'), { ok: false, retryAfterS: 60 });
  t += 60_000;
  assert.equal(limiter.take('c61').ok, true);
});

test('the limiter keeps at most 2000 keys and forgets the oldest', () => {
  const limiter = createLimiter({ now: () => 1, instanceMax: Infinity });
  for (let i = 0; i < 6; i++) limiter.take('k0');
  assert.equal(limiter.take('k0').ok, false);
  for (let i = 1; i <= 1999; i++) limiter.take(`k${i}`);
  assert.equal(limiter.take('k0').ok, false, 'still known at 2000 keys');
  limiter.take('k2000'); // the 2001st key
  assert.equal(limiter.take('k0').ok, true, 'k0 was evicted, so it starts over');
  assert.equal(limiter.take('k2000').ok, true);
});

test('a cross-origin request is 403, a same-origin or origin-less one is not', async () => {
  const { guide, fetch } = setup();
  for (const origin of ['https://evil.test', 'https://game.test.evil.test', 'null', 'not a url']) {
    const res = await read(await guide.POST(post(body(), { headers: { origin } })));
    assert.equal(res.status, 403, origin);
    assert.deepEqual(res.json, { error: 'forbidden' });
  }
  assert.equal(fetch.calls.length, 0);
  assert.equal((await guide.POST(post(body(), { headers: { origin: 'https://game.test' } }))).status, 200);
  assert.equal((await guide.POST(post(body()))).status, 200);
});

test('no response and no log line carries the key, the question or the address', async () => {
  const QUESTION = 'zq-secret-question-text about resources';
  const { guide, logs } = setup({ fetch: fakeFetch(textReply(NEUTRAL)) });
  const out = [];
  const send = async (payload, opts) => out.push(await (await guide.POST(post(payload, opts))).text());
  await send(body({ question: QUESTION }));
  await send(body({ question: QUESTION, stepId: 'nope' }));
  await send(body({ question: QUESTION, levelId: 'BAD' }));
  await send(body({ question: QUESTION }), { headers: { origin: 'https://evil.test' } });
  const down = setup({ fetch: fakeFetch(async () => new Response(`${KEY} ${QUESTION}`, { status: 500 })), env: { ANTHROPIC_API_KEY: KEY } });
  out.push(await (await down.guide.POST(post(body({ question: QUESTION })))).text());
  logs.push(...down.logs);
  const withheld = setup({ fetch: fakeFetch(textReply(`${RIGHT} ${QUESTION}`)) });
  out.push(await (await withheld.guide.POST(post(body({ question: QUESTION })))).text());
  logs.push(...withheld.logs);
  assert.ok(logs.length >= 6, 'every request logs one line');
  const seen = JSON.stringify([out, logs]);
  for (const secret of [KEY, QUESTION, IP]) assert.ok(!seen.includes(secret), `leaked ${secret.slice(0, 8)}`);
  for (const line of logs) assert.deepEqual(Object.keys(line), ['msg', 'levelId', 'stepId', 'outcome', 'status', 'ms']);
});
