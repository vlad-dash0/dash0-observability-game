// The practice ingress (lib/otlp/practice-ingress.mjs): a fetch-compatible fake Dash0, run
// through the same sendTraces and classifyResponse as live. Spec: docs/DASH0-LAB.md §Practice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_HOSTS, parseEndpoint } from '../lib/dash0/ingress.mjs';
import { encodeTraces } from '../lib/otlp/encode.mjs';
import { createPracticeIngress } from '../lib/otlp/practice-ingress.mjs';
import { classifyResponse, sendTraces } from '../lib/otlp/send.mjs';

const TOKEN = 'practice_ingest_7Hq2';
const READ_ONLY = 'practice_read_9Wm4';
const endpoint = parseEndpoint(`https://${PRACTICE_HOSTS[0]}/`, { hosts: PRACTICE_HOSTS });
const BODY = encodeTraces(
  [{ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', name: 'connection.test', startMs: 1762300800000, endMs: 1762300800005 }],
  { sessionId: 's-7k2m9q' },
);
const noTimers = { setTimeout: () => 1, clearTimeout: () => {} };

const practice = () => createPracticeIngress({ token: TOKEN, readOnlyToken: READ_ONLY });
const send = (over = {}) =>
  sendTraces({ fetch: practice(), tracesUrl: endpoint.tracesUrl, token: TOKEN, body: BODY, ...noTimers, ...over });

test('the practice endpoint validates against PRACTICE_HOSTS only', () => {
  assert.equal(endpoint.ok, true);
  assert.equal(endpoint.tracesUrl, `https://${PRACTICE_HOSTS[0]}/v1/traces`);
  assert.equal(parseEndpoint(`https://${PRACTICE_HOSTS[0]}`).reason, 'unknown-host', 'not a live host');
});

test('one row per practice rule, end to end through sendTraces', async () => {
  const rows = [
    ['the shown token', {}, { kind: 'accepted' }],
    ['the shown token, a dataset', { dataset: 'prod' }, { kind: 'accepted' }],
    ['a wrong token', { token: 'practice_ingest_7Hq3' }, { kind: 'rejected', status: 401, auth: true }],
    ['no token', { token: '' }, { kind: 'rejected', status: 401, auth: true }],
    ['the read-only token', { token: READ_ONLY }, { kind: 'rejected', status: 403, auth: true }],
    ['the wrong signal path', { tracesUrl: `https://${PRACTICE_HOSTS[0]}/v1/metrics` }, { kind: 'rejected', status: 404, auth: false, message: 'Not found' }],
    ['a body that is not JSON', { body: 'resourceSpans' }, { kind: 'rejected', status: 400, auth: false, message: 'Body is not valid JSON' }],
    ['JSON that is not an OTLP request', { body: { spans: [] } }, { kind: 'rejected', status: 400, auth: false, message: 'Body is not an OTLP traces request' }],
    ['a foreign host', { tracesUrl: 'https://ingress.eu-west-1.aws.dash0.com/v1/traces' }, { kind: 'unreachable', cause: 'network' }],
  ];
  for (const [what, over, want] of rows) assert.deepEqual(await send(over), want, what);
});

test('the practice ingress still says why on 401 and 403, but the classifier never surfaces it', async () => {
  const fetch = practice();
  const init = (token) => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(BODY) });
  for (const [token, status, text] of [['practice_ingest_7Hq3', 401, 'Unknown token'], [READ_ONLY, 403, 'This token cannot ingest']]) {
    const r = await fetch(endpoint.tracesUrl, init(token));
    assert.equal(r.status, status);
    assert.equal(JSON.parse(await r.text()).message, text, 'the fake does send a reason');
    const again = await fetch(endpoint.tracesUrl, init(token));
    assert.deepEqual(await classifyResponse(again, { token }), { kind: 'rejected', status, auth: true });
  }
});

test('a wrong content type is 415 and a non-POST is 405, through the same classifier', async () => {
  const fetch = practice();
  const init = { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/x-protobuf' }, body: JSON.stringify(BODY) };
  assert.deepEqual(await classifyResponse(await fetch(endpoint.tracesUrl, init)), {
    kind: 'rejected', status: 415, auth: false, message: 'Unsupported media type; send application/json',
  });
  const ok = { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json; charset=utf-8' } };
  assert.deepEqual(await classifyResponse(await fetch(endpoint.tracesUrl, ok)), { kind: 'accepted' }, 'header names are case-insensitive');
  assert.equal((await fetch(endpoint.tracesUrl, { ...ok, method: 'GET' })).status, 405);
});

test('a foreign host throws TypeError, as an unreachable host does, and the practice token never leaves', async () => {
  await assert.rejects(practice()('https://ingress.eu-west-1.aws.dash0.com/v1/traces', { method: 'POST' }), TypeError);
  await assert.rejects(practice()('https://evil.example/v1/traces', { method: 'POST' }), TypeError);
  assert.throws(() => createPracticeIngress({ token: '' }), TypeError);
  const out = await send({ token: 'practice_ingest_7Hq3' });
  assert.ok(!JSON.stringify(out).includes('practice_ingest'), 'no token in the outcome');
});
