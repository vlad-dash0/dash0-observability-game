// Level 9.3 "Connect the game to Dash0": the connect form against a live-shaped session (fake fetch,
// an injected host list) and the practice one, the outcome copy, the mistake rules and the
// token isolation invariants of docs/DASH0-LAB.md. The practice play-through (happy and sloppy,
// the stars) is DRIVERS['connect-to-dash0'] in test/levels-play.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { createTelemetry, PRACTICE_READ_ONLY_TOKEN, PRACTICE_TOKEN } from '../lib/telemetry.mjs';
import level from '../levels/connect-to-dash0.mjs';

const HOST = 'ingress.eu-west-1.aws.dash0.com';
const ENDPOINT = `https://${HOST}`;
const SECRET = 'auth_LIVESECRETvalue0123456789';
const PRACTICE_BANNER = 'Practice: a simulated Dash0, not your account';

const turn = () => new Promise((r) => setImmediate(r));
async function settle(sel, max = 50) {
  for (let i = 0; i < max && !q(sel); i++) await turn();
  assert.ok(q(sel), `never appeared: ${sel}`);
}

const ok = () => ({ status: 200, ok: true, text: async () => '{}' });
const reply = (status, body = '{}') => ({ status, ok: status < 300, text: async () => body });

/** A live-shaped telemetry: `answers` are consumed one per request (a function throws, a value replies). */
function liveTelemetry(answers, { reportError = () => {} } = {}) {
  const sent = [];
  const queue = [...answers];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === 'function') return next(init);
    return next;
  };
  const tele = createTelemetry({
    fetch,
    hosts: [HOST],
    randomBytes: (n) => new Uint8Array(n).fill(3),
    setTimeout,
    clearTimeout,
    reportError,
  });
  return { tele, sent };
}

function practiceTelemetry(opts = {}) {
  const sent = [];
  const tele = createTelemetry({
    fetch: async (...a) => {
      sent.push(a);
      return ok();
    },
    randomBytes: (n) => new Uint8Array(n).fill(3),
    setTimeout,
    clearTimeout,
    ...opts,
  });
  return { tele, sent };
}

function open(telemetry) {
  const dom = makeDom();
  const finished = [];
  const reported = [];
  const abort = new AbortController();
  let mistakes = 0;
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 1767225600000,
    reduceMotion: true,
    onFinish: (id, result) => finished.push({ id, result }),
    signal: abort.signal,
    reportError: (e) => reported.push(e),
    telemetry,
  });
  const mistake = ctx.mistake;
  ctx.mistake = () => {
    mistakes += 1;
    mistake();
  };
  level.run(ctx);
  const page = () => `${dom.body.innerHTML}${dom.actions.innerHTML}`;
  return {
    dom,
    ctx,
    finished,
    reported,
    abort,
    page,
    mistakes: () => mistakes,
    text: () => `${dom.body.textContent} ${dom.actions.textContent}`,
  };
}

const press = (sel) => {
  const el = q(sel);
  assert.ok(el, `expected ${sel}`);
  assert.ok(!el.disabled, `${sel} is disabled`);
  el.onclick({ currentTarget: el, target: el });
};
const fill = (sel, text) => {
  q(sel).value = text;
};

/** Live mode, connect form filled with the secret and pressed. */
async function connectLive(h, { endpoint = ENDPOINT, token = SECRET, dataset = '' } = {}) {
  press('#ctd-live');
  fill('#ctd-endpoint', endpoint);
  fill('#ctd-token', token);
  fill('#ctd-dataset', dataset);
  press('#ctd-connect');
}

test('the first screen offers practice, labels it, and disables live while it is not open', () => {
  const h = open(practiceTelemetry().tele); // no hosts: liveAvailable() is false
  assert.ok(h.text().includes(PRACTICE_BANNER));
  assert.equal(q('#ctd-live').disabled, true);
  assert.match(h.text(), /Your own Dash0 is not open yet/);
  assert.equal(qa('[data-finish]').length, 0);
});

test('with live open, the first screen enables it and says what is sent', () => {
  const h = open(liveTelemetry([ok()]).tele);
  assert.equal(q('#ctd-live').disabled, false);
  assert.match(h.text(), /level-complete span/);
});

test('without a telemetry session the level says so and offers no Finish', () => {
  const h = open(null);
  assert.match(h.text(), /no telemetry session/);
  assert.equal(qa('[data-finish]').length, 0);
});

test('the secret field is a labelled password input with no value attribute', () => {
  const h = open(liveTelemetry([ok()]).tele);
  press('#ctd-live');
  const input = q('#ctd-token');
  assert.equal(input.getAttribute('type'), 'password');
  assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(input.hasAttribute('value'), false);
  assert.equal(q('label[for="ctd-token"]').textContent, 'Auth token');
  assert.ok(h.page().includes('aria-describedby="ctd-token-note"'));
});

test('practice shows its label on every screen and sends nothing to the real fetch', async () => {
  const { tele, sent } = practiceTelemetry();
  const h = open(tele);
  press('#ctd-practice');
  assert.ok(h.text().includes(PRACTICE_BANNER));
  assert.match(h.text(), /Simulated/);
  press('#ctd-scope-ingest');
  press('#ctd-mint');
  fill('#ctd-endpoint', q('#ctd-ep-http').textContent);
  fill('#ctd-token', q('#ctd-minted').textContent);
  press('#ctd-connect');
  await settle('#ctd-finish');
  assert.ok(h.text().includes(PRACTICE_BANNER));
  assert.equal(sent.length, 0, 'practice never calls the real fetch');
  assert.equal(h.mistakes(), 0);
});

// ---- plain-language reasons for a bad form ----

const REASON_CASES = [
  ['ingress.practice.dash0.invalid:4317', PRACTICE_TOKEN, /4317 is the default OTLP\/gRPC port/],
  ['ingress.practice.dash0.invalid', PRACTICE_TOKEN, /no https:\/\//],
  ['http://ingress.practice.dash0.invalid', PRACTICE_TOKEN, /must be https/],
  ['https://ingress.practice.dash0.invalid/v1/traces', PRACTICE_TOKEN, /already ends in \/v1\/traces/],
  ['https://evil.example', PRACTICE_TOKEN, /not a known Dash0 ingress/],
  ['https://ingress.practice.dash0.invalid', 'notauth_abcdefgh', /does not look like a Dash0 token/],
  ['https://ingress.practice.dash0.invalid', `Bearer ${PRACTICE_TOKEN}`, /Paste only the token/],
  ['https://ingress.practice.dash0.invalid', `${PRACTICE_TOKEN} `, /space or a line break/],
];

for (const [endpoint, token, expected] of REASON_CASES) {
  test(`a bad form is explained in plain words and costs one mistake: ${endpoint} / ${token.slice(0, 8)}`, () => {
    const h = open(practiceTelemetry().tele);
    press('#ctd-practice');
    fill('#ctd-endpoint', endpoint);
    fill('#ctd-token', token);
    press('#ctd-connect');
    assert.match(q('#ctd-feedback').textContent, expected);
    assert.match(q('#ctd-feedback').textContent, /Nothing was sent/);
    assert.equal(h.mistakes(), 1);
    assert.equal(q('#ctd-token').value, '', 'the field is cleared even when the form is wrong');
  });
}

test('an empty endpoint or token is a nudge, not a mistake; a bad dataset is a mistake', () => {
  const h = open(practiceTelemetry().tele);
  press('#ctd-practice');
  press('#ctd-connect');
  assert.match(q('#ctd-feedback').textContent, /Enter the endpoint first/);
  fill('#ctd-endpoint', 'https://ingress.practice.dash0.invalid');
  press('#ctd-connect');
  assert.equal(h.mistakes(), 0);
  fill('#ctd-endpoint', 'https://ingress.practice.dash0.invalid');
  fill('#ctd-token', PRACTICE_TOKEN);
  fill('#ctd-dataset', '-bad dataset');
  press('#ctd-connect');
  assert.match(q('#ctd-feedback').textContent, /Dataset: A dataset identifier uses letters/);
  assert.equal(h.mistakes(), 1);
});

// ---- the creating-a-token step ----

test('a permission other than Ingesting costs one mistake, once, and the token still comes out', () => {
  const h = open(practiceTelemetry().tele);
  press('#ctd-practice');
  press('#ctd-mint');
  assert.match(q('#ctd-mint-feedback').textContent, /Pick a permission first/);
  assert.equal(h.mistakes(), 0);
  press('#ctd-scope-read');
  press('#ctd-mint');
  press('#ctd-mint');
  assert.equal(h.mistakes(), 1, 'the same wrong permission twice is one mistake');
  assert.equal(q('#ctd-minted').textContent, PRACTICE_READ_ONLY_TOKEN);
  assert.match(q('#ctd-mint-feedback').textContent, /cannot send telemetry/);
  press('#ctd-scope-all');
  press('#ctd-mint');
  assert.equal(h.mistakes(), 2);
  assert.match(q('#ctd-mint-feedback').textContent, /Dash0 recommends restricting tokens to Ingesting/);
  press('#ctd-scope-ingest');
  press('#ctd-mint');
  assert.equal(h.mistakes(), 2, 'Ingesting is right and free');
  assert.equal(q('#ctd-minted').textContent, PRACTICE_TOKEN);
});

test('practice: the 403 of a read-only token adds no mistake beyond the permission pick', async () => {
  const h = open(practiceTelemetry().tele);
  press('#ctd-practice');
  press('#ctd-scope-read');
  press('#ctd-mint');
  assert.equal(h.mistakes(), 1);
  fill('#ctd-endpoint', q('#ctd-ep-http').textContent);
  fill('#ctd-token', q('#ctd-minted').textContent);
  press('#ctd-connect');
  await settle('#ctd-feedback[data-outcome]');
  assert.match(q('#ctd-feedback').textContent, /knows this token but refused the test span \(403\)/);
  assert.equal(h.mistakes(), 1, 'the pick was the mistake; the practice rejection is the lesson');
  assert.equal(qa('[data-finish]').length, 0);
});

// ---- outcomes, one per OUTCOME shape ----

const OUTCOME_CASES = [
  ['a thrown fetch', () => { throw new TypeError('Failed to fetch'); }, 'unreachable', /never got an answer.*CORS.*Content Security Policy/, { mistakes: 0, retry: true, practice: true }],
  ['no usable response', undefined, 'unreachable', /not with a usable HTTP response/, { mistakes: 0, retry: true, practice: true }],
  ['401', reply(401), 'rejected', /did not accept this token \(401\)/, { mistakes: 1, retry: false, practice: false }],
  ['403', reply(403), 'rejected', /refused the test span \(403\).*permission Ingesting/, { mistakes: 1, retry: false, practice: false }],
  ['500', reply(500, '{"message":"boom"}'), 'rejected', /refused the test span \(HTTP 500\).*Dash0 said: boom/, { mistakes: 0, retry: true, practice: false }],
  ['rejected spans in a 200', reply(200, '{"partialSuccess":{"rejectedSpans":"2"}}'), 'rejected', /refused the test span \(HTTP 200\)/, { mistakes: 0, retry: true, practice: false }],
];

for (const [name, answer, kind, copy, want] of OUTCOME_CASES) {
  test(`live outcome ${name}: the words, the mistake rule and what is offered`, async () => {
    const { tele } = liveTelemetry([answer]);
    const h = open(tele);
    await connectLive(h);
    await settle('#ctd-feedback[data-outcome]');
    assert.equal(q('#ctd-feedback').getAttribute('data-outcome'), kind);
    assert.equal(q('#ctd-feedback').getAttribute('data-tone'), 'error');
    assert.match(q('#ctd-feedback').textContent, copy);
    assert.equal(h.mistakes(), want.mistakes);
    assert.equal(qa('#ctd-retry').length, want.retry ? 1 : 0);
    assert.equal(qa('#ctd-switch').length, want.practice ? 1 : 0);
    assert.equal(qa('[data-finish]').length, 0, 'Finish only after accepted');
    assert.equal(tele.status().state, 'configured');
    assert.equal(q('#ctd-token').value, '');
    assert.ok(!h.page().includes(SECRET));
  });
}

test('a timeout and a cancelled request say so, with no mistake', async () => {
  const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('x'))));
  const sent = [];
  const tele = createTelemetry({
    fetch: (u, init) => (sent.push(u), hang(init)),
    hosts: [HOST],
    randomBytes: (n) => new Uint8Array(n),
    setTimeout: (fn) => setImmediate(fn) && 1,
    clearTimeout() {},
  });
  const h = open(tele);
  await connectLive(h);
  await settle('#ctd-feedback[data-outcome]');
  assert.match(q('#ctd-feedback').textContent, /no answer within 10 seconds/);
  assert.equal(h.mistakes(), 0);
});

test('accepted live: Finish appears, only then, and the result names Dash0', async () => {
  const { tele, sent } = liveTelemetry([ok()]);
  const h = open(tele);
  assert.equal(qa('[data-finish]').length, 0);
  await connectLive(h, { dataset: 'default' });
  await settle('#ctd-finish');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `${ENDPOINT}/v1/traces`);
  assert.equal(sent[0].init.headers['Dash0-Dataset'], 'default');
  assert.match(h.text(), new RegExp(`Connected to ${HOST.replaceAll('.', '\\.')}`));
  assert.ok(h.text().includes(tele.sessionId));
  assert.equal(h.finished.length, 0, 'showing the screen does not finish');
  press('#ctd-finish');
  assert.equal(h.finished.length, 1);
  assert.equal(h.finished[0].result.stars, 5);
  assert.match(h.finished[0].result.text, /connected to your Dash0/);
});

test('after unreachable, retry sends again with no token typed, then Finish scores five stars', async () => {
  const { tele, sent } = liveTelemetry([() => { throw new TypeError('Failed to fetch'); }, ok()]);
  const h = open(tele);
  await connectLive(h);
  await settle('#ctd-retry');
  assert.equal(q('#ctd-token').value, '');
  press('#ctd-retry');
  await settle('#ctd-finish');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].init.headers.Authorization, `Bearer ${SECRET}`, 'the held token went out again');
  press('#ctd-finish');
  assert.equal(h.finished[0].result.stars, 5);
});

test('a rejected live token costs one mistake; a new token then connects', async () => {
  const { tele } = liveTelemetry([reply(401), ok()]);
  const h = open(tele);
  await connectLive(h);
  await settle('#ctd-feedback[data-outcome]');
  fill('#ctd-token', `${SECRET}2`);
  press('#ctd-connect');
  await settle('#ctd-finish');
  press('#ctd-finish');
  assert.equal(h.finished[0].result.stars, 4);
});

test('unreachable offers practice, and practice then completes', async () => {
  const { tele } = liveTelemetry([() => { throw new TypeError('Failed to fetch'); }]);
  const h = open(tele);
  await connectLive(h);
  await settle('#ctd-switch');
  press('#ctd-switch');
  assert.ok(h.text().includes(PRACTICE_BANNER));
  press('#ctd-scope-ingest');
  press('#ctd-mint');
  fill('#ctd-endpoint', q('#ctd-ep-http').textContent);
  fill('#ctd-token', q('#ctd-minted').textContent);
  press('#ctd-connect');
  await settle('#ctd-finish');
  press('#ctd-finish');
  assert.equal(h.finished[0].result.stars, 5);
  assert.match(h.finished[0].result.text, /simulated Dash0/);
});

test('a second press while the test span is in flight sends nothing more', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tele, sent } = liveTelemetry([() => gate.then(ok)]);
  const h = open(tele);
  press('#ctd-live');
  fill('#ctd-endpoint', ENDPOINT);
  fill('#ctd-token', SECRET);
  const stale = q('#ctd-connect');
  press('#ctd-connect');
  assert.equal(q('#ctd-connect').disabled, true, 'Connect is disabled while sending');
  stale.onclick({ currentTarget: stale, target: stale }); // a double click on the old button
  assert.equal(h.mistakes(), 0, 'the emptied field is a nudge, not a mistake');
  release();
  await settle('#ctd-finish');
  assert.equal(sent.length, 1);
});

test('closing the level while the request is out renders nothing further and does not throw', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tele } = liveTelemetry([() => gate.then(ok)]);
  const h = open(tele);
  await connectLive(h);
  const before = h.page();
  h.abort.abort();
  release();
  for (let i = 0; i < 5; i++) await turn();
  assert.equal(h.page(), before, 'the closed level is left alone');
  assert.equal(h.finished.length, 0);
});

// ---- token isolation (docs/DASH0-LAB.md invariants) ----

test('the token is in no part of the page, at any step, success or failure', async () => {
  const stages = [];
  for (const answer of [ok(), reply(401), reply(500), () => { throw new TypeError(`Failed to fetch ${SECRET}`); }]) {
    const { tele } = liveTelemetry([answer], { reportError: () => {} });
    const h = open(tele);
    press('#ctd-live');
    fill('#ctd-endpoint', ENDPOINT);
    fill('#ctd-token', SECRET);
    press('#ctd-connect');
    stages.push(h.page()); // pending
    await settle('#ctd-feedback[data-outcome], #ctd-finish');
    stages.push(h.page(), h.text());
  }
  for (const s of stages) assert.ok(!s.includes('LIVESECRET'), 'the token reached the DOM');
});

test('a token that fails validation is cleared and never echoed either', () => {
  for (const bad of ['LIVESECRET', `Bearer ${SECRET}`, `${SECRET} x`, `x${SECRET}`]) {
    const h = open(liveTelemetry([ok()]).tele);
    press('#ctd-live');
    fill('#ctd-endpoint', ENDPOINT);
    fill('#ctd-token', bad);
    press('#ctd-connect');
    assert.equal(q('#ctd-token').value, '');
    assert.ok(!h.page().includes('LIVESECRET'), bad);
  }
});

test('the token reaches no error report, no status, no result and no hint to ctx', async () => {
  const reported = [];
  const { tele } = liveTelemetry([() => { throw new Error(`boom ${SECRET}`); }], { reportError: (e) => reported.push(e.message) });
  const h = open(tele);
  await connectLive(h);
  await settle('#ctd-feedback[data-outcome]');
  assert.ok(!JSON.stringify([reported, tele.status(), h.reported.map(String)]).includes('LIVESECRET'));
  assert.ok(!Object.keys(tele).includes('token'));
});

test('the practice token shown after Create token is gone from the page once Connect is pressed', async () => {
  const { tele } = practiceTelemetry();
  const h = open(tele);
  press('#ctd-practice');
  press('#ctd-scope-ingest');
  press('#ctd-mint');
  assert.ok(h.page().includes(PRACTICE_TOKEN), 'shown once, as a copyable value');
  fill('#ctd-endpoint', q('#ctd-ep-http').textContent);
  fill('#ctd-token', PRACTICE_TOKEN);
  press('#ctd-connect');
  assert.ok(!h.page().includes(PRACTICE_TOKEN), 'gone while the request is out');
  await settle('#ctd-finish');
  assert.ok(!h.page().includes(PRACTICE_TOKEN), 'and after');
  assert.equal(qa('#ctd-token').length, 0, 'the form is gone on the connected screen');
});

test('the level file never touches storage, the URL, the console or the cookie jar', () => {
  const src = readFileSync(new URL('../levels/connect-to-dash0.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  for (const banned of [/localStorage/, /sessionStorage/, /document\.cookie/, /\blocation\b/, /\bhistory\b/, /console\./, /indexedDB/, /reportError/, /fetch\(/, /innerHTML\s*=\s*[^;]*token/i]) {
    assert.doesNotMatch(code, banned);
  }
});
