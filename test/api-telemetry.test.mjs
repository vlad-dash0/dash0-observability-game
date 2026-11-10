// The six api/ functions export their traces when Dash0 is configured (epic #18 P3). Each module is imported
// fresh with process.env set, so its own wiring (api/<name>.mjs last lines) is what is under test. No network:
// globalThis.fetch is an ingress recorder plus a canned Anthropic. node --test runs each file in its own
// process, so the env and fetch changes here reach no other file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENV_ON, ingress, spansOf } from './helpers/otel.mjs';

const KEY = 'sk-ant-test-key-0123456789';
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
let n = 0;
const load = (name) => import(`../api/${name}.mjs?otel-${(n += 1)}`);

// Env and fetch set for one test and put back after it.
function rig(t, { env = ENV_ON, anthropic = null, status = 200 } = {}) {
  const savedEnv = process.env;
  const savedFetch = globalThis.fetch;
  const savedLog = console.log;
  console.log = () => {}; // the functions' own JSON log lines
  const rec = ingress({ status });
  process.env = { ...env };
  globalThis.fetch = (url, init) => {
    if (String(url) === ANTHROPIC && anthropic !== null) return Promise.resolve(Response.json(anthropic));
    return rec.fetch(url, init);
  };
  t.after(() => {
    process.env = savedEnv;
    globalThis.fetch = savedFetch;
    console.log = savedLog;
  });
  return rec;
}

const CASES = [
  ['account', 200, 'unconfigured'],
  ['leaderboard', 503, 'not-configured'],
  ['progress', 503, 'not-configured'],
  ['auth-start', 302, 'unconfigured'],
  ['auth-callback', 302, 'unconfigured'],
  ['guide', 200, undefined], // GET does not log
];

test('every api function exports through the wrapper', async (t) => {
  const rec = rig(t);
  for (const [name, status, outcome] of CASES) {
    const before = rec.calls.length;
    const mod = await load(name);
    const res = await mod.GET(new Request(`https://game.test/api/${name}`, { redirect: 'manual' }));
    assert.equal(res.status, status, name);
    assert.equal(rec.calls.length, before + 1, `${name}: one ingress call per request`);
    const body = rec.calls.at(-1).body;
    const spans = spansOf(body);
    assert.equal(spans.length, 1, name);
    assert.equal(spans[0].name, `GET /api/${name}`);
    assert.equal(spans[0].attrs['http.route'], `/api/${name}`);
    assert.equal(spans[0].attrs['http.response.status_code'], status);
    assert.equal(spans[0].attrs['game.api.outcome'], outcome, `${name} outcome`);
    const resource = Object.fromEntries(body.resourceSpans[0].resource.attributes.map((a) => [a.key, a.value.stringValue]));
    assert.equal(resource['faas.name'], name);
  }
});

test("the guide's model call is a CLIENT span", async (t) => {
  const rec = rig(t, { env: { ...ENV_ON, ANTHROPIC_API_KEY: KEY }, anthropic: { content: [{ type: 'text', text: 'Re-read what the question asks.' }] } });
  const { POST } = await load('guide');
  const res = await POST(new Request('https://game.test/api/guide', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ v: 1, levelId: 'resources', stepId: 'res-pod', question: 'What does a resource describe?' }),
  }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(rec.calls.length, 1, 'one export; the model call is not the ingress');
  const spans = spansOf(rec.calls[0].body);
  assert.equal(spans.length, 2);
  const server = spans.find((s) => s.name === 'POST /api/guide');
  const client = spans.find((s) => s.name === 'POST');
  assert.equal(client.attrs['url.full'], ANTHROPIC);
  assert.equal(client.parentSpanId, server.spanId);
  assert.equal(server.attrs['game.level.id'], 'resources');
  assert.equal(server.attrs['game.step.id'], 'res-pod');
});

test('dormant without env: no ingress call from any function', async (t) => {
  const rec = rig(t, { env: {} });
  for (const [name, status] of CASES) {
    const mod = await load(name);
    const res = await mod.GET(new Request(`https://game.test/api/${name}`, { redirect: 'manual' }));
    assert.equal(res.status, status, name);
  }
  assert.equal(rec.calls.length, 0);
});
