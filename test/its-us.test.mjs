// The lab boss "It's us" (Act 9): the player finds the incident the game sent from their own session
// and answers questions about it. Practice renders the same spans in a simulated Dash0 trace view;
// live sends the incident once and shows no trace at all. Covers the not-connected path, every send
// outcome, the grading and mistake rules, the answer never being rendered where it can be copied,
// the time-rebase decision and the token isolation invariants of docs/DASH0-LAB.md. The practice
// play-through (stars) is DRIVERS['its-us'] in test/levels-play.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { createTelemetry, MODE } from '../lib/telemetry.mjs';
import { answersFrom, FAULT_ATTR, QUESTION } from '../lib/incident-lab.mjs';
import { msToUnixNano } from '../lib/otlp/encode.mjs';
import { PRACTICE_HOSTS } from '../lib/dash0/ingress.mjs';
import level from '../levels/its-us.mjs';

const HOST = 'ingress.eu-west-1.aws.dash0.com';
const ENDPOINT = `https://${HOST}`;
const SECRET = 'auth_LIVESECRETvalue0123456789';
const T0 = 1_800_000_000_000;

const turn = () => new Promise((r) => setImmediate(r));
async function settle(sel, max = 50) {
  for (let i = 0; i < max && !q(sel); i++) await turn();
  assert.ok(q(sel), `never appeared: ${sel}`);
}
const ok = () => ({ status: 200, ok: true, text: async () => '{}' });
const reply = (status, body = '{}') => ({ status, ok: status < 300, text: async () => body });

/** A telemetry session with a fake clock; `answers` are consumed one per request (a function throws/decides). */
function session({ answers = [ok()], live = true, seed = 9, reportError = () => {}, timers = { setTimeout, clearTimeout } } = {}) {
  const sent = [];
  const queue = [...answers];
  const clock = { t: T0 };
  const fetch = async (url, init) => {
    sent.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === 'function' ? next(init) : next;
  };
  const tele = createTelemetry({
    fetch,
    hosts: live ? [HOST] : [],
    randomBytes: (n) => new Uint8Array(n).fill(seed),
    now: () => clock.t,
    ...timers,
    reportError,
  });
  return { tele, sent, clock };
}

/** Incident requests only: the test span of the connect step is not one. */
const incidentSends = (sent) => sent.filter((s) => s.init?.body?.includes('progress.sync'));

async function connectLive(tele) {
  const v = tele.connect({ mode: MODE.live, endpoint: ENDPOINT, token: SECRET, dataset: '' });
  assert.equal(v.ok, true);
  const out = await tele.sendTest();
  assert.equal(out.kind, 'accepted');
}

function open(telemetry) {
  const dom = makeDom();
  const finished = [];
  const abort = new AbortController();
  let mistakes = 0;
  const ctx = createLevelContext({
    level,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => T0,
    reduceMotion: true,
    onFinish: (id, result) => finished.push({ id, result }),
    signal: abort.signal,
    reportError: () => {},
    telemetry,
  });
  const mistake = ctx.mistake;
  ctx.mistake = () => {
    mistakes += 1;
    mistake();
  };
  level.run(ctx);
  return {
    dom, ctx, finished, abort,
    mistakes: () => mistakes,
    page: () => `${dom.body.innerHTML}${dom.actions.innerHTML}`,
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
const field = (key) => `#its-q-${key}`;

/** Type all four answers (the key's own values unless overridden) and press Check. */
function answer(key, over = {}) {
  const a = { ...key, ...over };
  fill(field(QUESTION.operation), String(a.operation));
  fill(field(QUESTION.faultCode), String(a.faultCode));
  fill(field(QUESTION.retryCount), String(a.retryCount));
  fill(field(QUESTION.traceId), String(a.traceId));
  press('#its-check');
}

const failingIndex = (inc) => inc.spans.findIndex((s) => s.status?.code === 'error');
const openSpan = (i) => press(`#its-open-${i}`);

function practiceView() {
  const { tele, sent } = session({ live: false });
  const h = open(tele);
  press('#its-practice');
  return { tele, sent, h, inc: tele.incident(), key: answersFrom(tele.incident().spans) };
}

// ---- not connected ----

test('not connected: the boss says so, offers practice, and the live button is disabled with its reason', () => {
  const { tele, sent } = session({ live: false });
  const h = open(tele);
  assert.ok(h.text().includes('not connected'), 'it explains');
  assert.ok(q('#its-practice') && !q('#its-practice').disabled);
  const live = q('#its-live');
  assert.ok(live.disabled, 'live stays closed until P6');
  const why = live.getAttribute('aria-describedby');
  assert.ok(why && q(`#${why}`) && q(`#${why}`).textContent.length > 10, 'a disabled button points at its reason');
  assert.equal(qa('[data-finish]').filter((b) => !b.disabled).length, 0);
  assert.equal(sent.length, 0);
});

test('without a telemetry session the boss says so and offers no Finish', () => {
  open(null);
  assert.ok(qa('[data-finish]').every((b) => b.disabled));
  assert.equal(qa('button:not([disabled])').length, 0);
});

test('a session connected after 9.3 with live open goes to the send screen, not to practice', async () => {
  const { tele } = session();
  await connectLive(tele);
  open(tele);
  assert.ok(q('#its-send'), 'send the incident');
  assert.ok(!q('#its-practice'));
});

test('a session connected to the practice Dash0 goes straight to the simulated trace view and sends nothing more', async () => {
  const { tele, sent } = session({ live: false });
  assert.equal(tele.connect({ mode: MODE.practice, endpoint: `https://${PRACTICE_HOSTS[0]}`, token: tele.practiceCredential('ingest'), dataset: '' }).ok, true);
  assert.equal((await tele.sendTest()).kind, 'accepted');
  open(tele);
  assert.ok(q('#its-detail'), 'the trace view');
  assert.ok(!q('#its-send'));
  assert.equal(sent.length, 0);
});

// ---- practice: the simulated trace view ----

test('practice: the trace view lists every span of the shared incident and labels itself simulated', () => {
  const { h, inc } = practiceView();
  const t = h.text();
  assert.ok(t.includes('Simulated'), 'labelled');
  for (const s of inc.spans) assert.ok(t.includes(s.name), s.name);
  assert.ok(t.includes(inc.traceId), 'the trace id is in the view header, as in Dash0');
  assert.ok(t.includes(inc.spans.length > 0 ? 'session.id' : ''), 'the filter that finds it');
  assert.equal(qa('[data-finish]').filter((b) => !b.disabled).length, 0, 'no Finish before the answers');
});

test('practice: the fault code is on no screen until the failing span is opened, and then only in its attributes', () => {
  const { h, inc, key } = practiceView();
  assert.ok(!h.page().includes(key.faultCode), 'not in the list');
  for (let i = 0; i < inc.spans.length; i++) {
    if (i === failingIndex(inc)) continue;
    openSpan(i);
    assert.ok(!h.page().includes(key.faultCode), `not in the detail of ${inc.spans[i].name}`);
  }
  openSpan(failingIndex(inc));
  const detail = q('#its-detail');
  assert.ok(detail.textContent.includes(key.faultCode), 'in the failing span detail');
  const row = qa('#its-detail tr').find((tr) => tr.textContent.includes(key.faultCode));
  assert.ok(row.textContent.includes(FAULT_ATTR), 'next to the attribute it belongs to');
  assert.equal(h.page().split(key.faultCode).length - 1, 1, 'exactly once on the page');
  openSpan(0);
  assert.ok(!h.page().includes(key.faultCode), 'gone again when another span is open');
});

test('practice: the failing span shows its retry events and a generic error message', () => {
  const { inc, key } = practiceView();
  openSpan(failingIndex(inc));
  const rows = qa('#its-detail tr').filter((tr) => tr.textContent.includes('retry'));
  assert.equal(rows.length, key.retryCount);
  assert.ok(q('#its-detail').textContent.includes('exception'));
});

test('practice: the view never states the retry count or the failing operation outside the spans', () => {
  const { h, inc, key } = practiceView();
  const t = h.text();
  assert.ok(!/retried\s+\d/i.test(t) && !/\b\d+\s+retries\b/i.test(t), 'no retry total');
  assert.ok(!t.toLowerCase().includes('failing operation:'), 'no label naming it');
  assert.ok(key.operation && inc.spans.some((s) => s.name === key.operation));
});

test('practice sends nothing: the real fetch is never called', async () => {
  const { sent } = practiceView();
  await turn();
  assert.equal(sent.length, 0);
});

// ---- grading and mistakes ----

test('right answers: Finish is enabled only once all four pass, with five stars and the mode in the result', () => {
  const { h, key } = practiceView();
  assert.ok(q('#its-finish').disabled);
  answer(key);
  assert.equal(h.mistakes(), 0);
  assert.ok(!q('#its-finish').disabled);
  press('#its-finish');
  assert.equal(h.finished.length, 1);
  assert.equal(h.finished[0].result.stars, 5);
  assert.match(h.finished[0].result.text, /simulated/i);
});

test('one wrong answer still blocks Finish; fixing it unlocks it', () => {
  const { key, h } = practiceView();
  answer(key, { retryCount: key.retryCount === 2 ? 3 : 2 });
  assert.equal(h.mistakes(), 1);
  assert.ok(q('#its-finish').disabled);
  fill(field(QUESTION.retryCount), String(key.retryCount));
  press('#its-check');
  assert.ok(!q('#its-finish').disabled);
  assert.equal(h.mistakes(), 1, 'a pass costs nothing');
});

test('a well-formed wrong answer is a mistake, once per distinct wrong value', () => {
  const { key, h } = practiceView();
  fill(field(QUESTION.operation), 'progress.serialize'); // a real span, but not the failing one
  press('#its-check');
  assert.equal(h.mistakes(), 1);
  press('#its-check');
  assert.equal(h.mistakes(), 1, 'the same wrong value twice costs once');
  fill(field(QUESTION.operation), 'progress.sync');
  press('#its-check');
  assert.equal(h.mistakes(), 2, 'a different wrong value is another');
  assert.ok(key);
});

test('a malformed or empty answer is a free nudge', () => {
  const { h } = practiceView();
  press('#its-check'); // everything empty
  fill(field(QUESTION.retryCount), 'about three');
  fill(field(QUESTION.traceId), 'not-a-trace-id');
  press('#its-check');
  assert.equal(h.mistakes(), 0);
  assert.ok(q(`${field(QUESTION.retryCount)}-feedback`).textContent.length > 5, 'it says what is missing');
  assert.ok(q('#its-finish').disabled);
});

test('a wrong answer never carries the right one in its feedback', () => {
  const { h, key } = practiceView();
  answer(key, { operation: 'progress.sync', faultCode: 'ZZZZZZ', retryCount: key.retryCount === 4 ? 2 : 4, traceId: 'a'.repeat(32) });
  assert.ok(!h.page().includes(key.faultCode), 'the code is not echoed');
  assert.ok(!q(`${field(QUESTION.operation)}-feedback`).textContent.includes(key.operation));
});

test('a passed answer is locked and a later change cannot cost anything', () => {
  const { key, h } = practiceView();
  answer(key);
  assert.ok(q(field(QUESTION.faultCode)).disabled || q(field(QUESTION.faultCode)).hasAttribute('readonly'));
  assert.equal(h.mistakes(), 0);
});

test('the fault code is checked without regard to case or spaces', () => {
  const { key, h } = practiceView();
  answer(key, { faultCode: `  ${key.faultCode.toLowerCase()} ` });
  assert.equal(h.mistakes(), 0);
  assert.ok(!q('#its-finish').disabled);
});

// ---- live: send once ----

test('live: the incident is sent once, carrying the session id, and the fault code never appears in the DOM', async () => {
  const { tele, sent } = session();
  await connectLive(tele);
  const h = open(tele);
  const key = answersFrom(tele.incident().spans);
  const stages = [h.page()];
  press('#its-send');
  stages.push(h.page());
  await settle('#its-check');
  stages.push(h.page(), h.text());
  assert.equal(incidentSends(sent).length, 1);
  const body = JSON.parse(incidentSends(sent)[0].init.body);
  const spans = body.resourceSpans[0].scopeSpans[0].spans;
  assert.deepEqual(spans.map((s) => s.name), tele.incident().spans.map((s) => s.name));
  const sessionIds = spans.flatMap((s) => s.attributes.filter((a) => a.key === 'session.id').map((a) => a.value.stringValue));
  assert.deepEqual([...new Set(sessionIds)], [tele.sessionId]);
  assert.ok(h.text().includes(tele.sessionId), 'the session id to filter by is shown');
  answer(key);
  stages.push(h.page());
  for (const s of stages.slice(0, -1)) {
    assert.ok(!s.includes(key.faultCode), 'the code is not on the page');
    assert.ok(!s.includes(key.traceId), 'nor the trace id');
    assert.ok(!s.includes(key.operation), 'nor the failing operation');
  }
  assert.equal(qa('#its-detail').length, 0, 'live renders no trace view');
});

test('live: Dash0 instructions name the filter and where to read the span, without naming an answer', async () => {
  const { tele } = session();
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-check');
  const t = h.text();
  assert.ok(t.includes('session.id'));
  assert.ok(t.includes('Trace Explorer'));
});

test('live: the result names Dash0, not the simulation', async () => {
  const { tele } = session();
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-check');
  answer(answersFrom(tele.incident().spans));
  press('#its-finish');
  assert.equal(h.finished[0].result.stars, 5);
  assert.match(h.finished[0].result.text, /your own Dash0/);
  assert.doesNotMatch(h.finished[0].result.text, /simulated/i);
});

test('a second press while the incident is in flight sends nothing more', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tele, sent } = session({ answers: [ok(), async () => { await gate; return ok(); }] });
  await connectLive(tele);
  open(tele);
  press('#its-send');
  assert.ok(q('#its-send').disabled, 'the button is disabled while the request is out');
  assert.throws(() => press('#its-send'), /disabled/);
  release();
  await settle('#its-check');
  assert.equal(incidentSends(sent).length, 1);
});

test('re-opening the lab in the same session shows the same session id and answers, with no second send', async () => {
  const { tele, sent } = session();
  await connectLive(tele);
  const first = open(tele);
  press('#its-send');
  await settle('#its-check');
  const id = tele.sessionId;
  const before = incidentSends(sent).length;
  const again = open(tele);
  assert.ok(q('#its-check'), 'straight to the questions');
  assert.ok(!q('#its-send'));
  assert.ok(again.text().includes(id));
  assert.equal(incidentSends(sent).length, before);
  assert.equal(before, 1);
  assert.ok(first);
});

// ---- live: outcomes ----

test('unreachable: plain words, no mistake, retry resends the same span ids, and practice shows the same fault code', async () => {
  const { tele, sent } = session({ answers: [ok(), () => { throw new TypeError('Failed to fetch'); }, ok()] });
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-feedback[data-outcome]');
  assert.equal(q('#its-feedback').getAttribute('data-outcome'), 'unreachable');
  assert.equal(h.mistakes(), 0);
  assert.ok(q('#its-retry') && q('#its-switch'), 'retry and practice are both offered');
  assert.match(q('#its-feedback').textContent, /may show the trace twice/, 'a retry can duplicate');
  assert.ok(qa('[data-finish]').every((b) => b.disabled));
  press('#its-retry');
  await settle('#its-check');
  const ids = (s) => JSON.parse(s.init.body).resourceSpans[0].scopeSpans[0].spans.map((x) => x.spanId);
  const sends = incidentSends(sent);
  assert.equal(sends.length, 2);
  assert.deepEqual(ids(sends[0]), ids(sends[1]), 'the same span ids');
});

test('unreachable then practice: the simulated view shows the very incident that was sent', async () => {
  const { tele } = session({ answers: [ok(), () => { throw new TypeError('Failed to fetch'); }] });
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-switch');
  press('#its-switch');
  const inc = tele.incident();
  openSpan(failingIndex(inc));
  assert.ok(q('#its-detail').textContent.includes(answersFrom(inc.spans).faultCode));
  assert.ok(h.text().includes('Simulated'));
});

test('a refused token: plain words, no status code, no mistake, practice offered and no retry', async () => {
  for (const status of [401, 403]) {
    const { tele } = session({ answers: [ok(), reply(status)] });
    await connectLive(tele);
    const h = open(tele);
    press('#its-send');
    await settle('#its-feedback[data-outcome]');
    assert.equal(q('#its-feedback').getAttribute('data-outcome'), 'rejected');
    assert.equal(h.mistakes(), 0);
    assert.ok(!h.text().includes(String(status)), `no ${status} in the words`);
    assert.ok(q('#its-switch'));
    assert.ok(!q('#its-retry'));
  }
});

test('another rejection (HTTP 400) shows its status and offers a retry', async () => {
  const { tele } = session({ answers: [ok(), reply(400, '{"message":"bad span"}')] });
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-feedback[data-outcome]');
  assert.ok(h.text().includes('400'));
  assert.ok(q('#its-retry'));
  assert.equal(h.mistakes(), 0);
});

test('a timeout says so, costs nothing and offers a retry', async () => {
  const { tele } = session({
    answers: [ok(), (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('x'))))],
    timers: { setTimeout: (f) => setImmediate(f), clearTimeout: () => {} },
  });
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-feedback[data-outcome]');
  assert.match(q('#its-feedback').textContent, /no answer within \d+ seconds/);
  assert.equal(h.mistakes(), 0);
  assert.ok(q('#its-retry'));
});

test('closing the level while the request is out renders nothing further and does not throw', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { tele } = session({ answers: [ok(), async () => { await gate; return ok(); }] });
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  h.abort.abort();
  const shown = h.page();
  release();
  await turn();
  await turn();
  assert.equal(h.page(), shown);
});

// ---- the time-rebase decision (docs/DASH0-LAB.md "Notes for P5") ----

test('the incident is built when the boss first needs it, not when the page started, and sent with those times', async () => {
  const { tele, sent, clock } = session();
  await connectLive(tele); // the session is a few minutes old when the player gets to the boss
  clock.t = T0 + 5 * 60 * 1000;
  open(tele);
  press('#its-send');
  await settle('#its-check');
  const root = JSON.parse(incidentSends(sent)[0].init.body).resourceSpans[0].scopeSpans[0].spans.find((s) => s.name === 'progress.sync');
  assert.equal(root.startTimeUnixNano, msToUnixNano(T0 + 5 * 60 * 1000), 'the root starts when the boss opened');
});

test('a retry sends the same timestamps: the times are not rebased', async () => {
  const { tele, sent, clock } = session({ answers: [ok(), () => { throw new TypeError('Failed to fetch'); }, ok()] });
  await connectLive(tele);
  open(tele);
  press('#its-send');
  await settle('#its-retry');
  clock.t = T0 + 60 * 60 * 1000;
  press('#its-retry');
  await settle('#its-check');
  const starts = incidentSends(sent).map((s) => JSON.parse(s.init.body).resourceSpans[0].scopeSpans[0].spans.map((x) => x.startTimeUnixNano));
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0], starts[1]);
});

// ---- the token ----

test('the token is in no part of the page, in any outcome, and a server echo of it is withheld', async () => {
  const stages = [];
  for (const answer of [ok(), reply(401), reply(500, JSON.stringify({ message: `bad token ${SECRET}` })), () => { throw new TypeError(`Failed to fetch ${SECRET}`); }]) {
    const { tele } = session({ answers: [ok(), answer] });
    await connectLive(tele);
    const h = open(tele);
    stages.push(h.page());
    press('#its-send');
    stages.push(h.page());
    await settle('#its-feedback[data-outcome], #its-check');
    stages.push(h.page(), h.text());
  }
  for (const s of stages) assert.ok(!s.includes('LIVESECRET'), 'the token reached the DOM');
});

test('the token reaches no error report, no status and no result', async () => {
  const reported = [];
  const { tele } = session({ answers: [ok(), () => { throw new Error(`boom ${SECRET}`); }], reportError: (e) => reported.push(e.message) });
  await connectLive(tele);
  const h = open(tele);
  press('#its-send');
  await settle('#its-feedback[data-outcome]');
  assert.ok(!JSON.stringify([reported, tele.status(), h.finished]).includes('LIVESECRET'));
});

test('the boss never touches storage, the URL, the console, a token or a connection', () => {
  const src = readFileSync(new URL('../levels/its-us.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  for (const banned of [/localStorage/, /sessionStorage/, /document\.cookie/, /\blocation\b/, /\bhistory\b/, /console\./, /indexedDB/, /reportError/, /fetch\(/, /practiceCredential/, /\.connect\(/, /sendTest/, /status\(\)\.token/]) {
    assert.doesNotMatch(code, banned);
  }
});

// ---- structure ----

test('the boss is a scored run-level with no widgets, in the shape of a boss', () => {
  assert.equal(level.id, 'its-us');
  assert.equal(level.no, null);
  assert.equal(level.scored, true);
  assert.deepEqual(level.widgets, []);
  assert.equal(typeof level.run, 'function');
});

test('the questions come from QUESTION: four fields, one per key', () => {
  const { h } = practiceView();
  for (const key of Object.values(QUESTION)) assert.ok(q(field(key)), key);
  assert.ok(h);
});
