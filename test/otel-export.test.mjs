// lib/otel/export.mjs: the budgeted export shared by server.mjs and api/events.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportWithinBudget, FLUSH_BUDGET_MS } from '../lib/otel/export.mjs';
import { timers } from './helpers/otel.mjs';

const body = { resourceSpans: [] };
const size = JSON.stringify(body).length;

test('a body over the byte cap is dropped as too-large and never sent', async () => {
  const tm = timers();
  let sent = 0;
  const send = async () => { sent += 1; return { kind: 'accepted' }; };
  const run = (maxBytes) => exportWithinBudget({ body, spans: 3, send, maxBytes, ...tm });
  assert.deepEqual(await run(size - 1), { kind: 'dropped', reason: 'too-large', spans: 3 });
  assert.equal(sent, 0);
  assert.deepEqual(await run(size), { kind: 'exported', spans: 3 }, 'exactly at the cap is sent');
});

test('a stalled send is dropped as budget, and no timer stays armed', async () => {
  const tm = timers();
  const p = exportWithinBudget({ body, spans: 1, send: () => new Promise(() => {}), ...tm });
  await new Promise((r) => setImmediate(r));
  tm.fire(FLUSH_BUDGET_MS);
  assert.deepEqual(await p, { kind: 'dropped', reason: 'budget', spans: 1 });
  assert.equal(tm.active(), 0);
});

test('every send outcome maps to one result', async () => {
  const tm = timers();
  const run = (sent) => exportWithinBudget({ body, spans: 2, send: async () => sent, ...tm });
  assert.deepEqual(await run({ kind: 'rejected', status: 401, auth: true }), { kind: 'dropped', reason: 'auth', spans: 2 });
  assert.deepEqual(await run({ kind: 'rejected', status: 500 }), { kind: 'dropped', reason: 'rejected', spans: 2, ingressStatus: 500 });
  assert.deepEqual(await run({ kind: 'unreachable', cause: 'timeout' }), { kind: 'dropped', reason: 'timeout', spans: 2 });
  assert.deepEqual(await run({ kind: 'weird' }), { kind: 'dropped', reason: 'internal', spans: 2 });
  assert.deepEqual(await exportWithinBudget({ body, spans: 2, send: async () => { throw new Error('x'); }, ...tm }), { kind: 'dropped', reason: 'internal', spans: 2 });
});

test('a won export leaves no timer armed', async () => {
  const tm = timers();
  assert.deepEqual(await exportWithinBudget({ body, spans: 1, send: async () => ({ kind: 'accepted' }), ...tm }), { kind: 'exported', spans: 1 });
  assert.equal(tm.active(), 0);
});
