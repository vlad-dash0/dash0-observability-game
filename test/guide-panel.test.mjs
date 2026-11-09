// The Ask the guide panel (#17 P4): lib/guide/client.mjs and lib/guide/panel.mjs, played through
// runPlay in a linkedom DOM with the real ctx and a fake fetch. The server answers are the contract
// of docs/FOUNDATION.md §2.8; the panel's copy is not asserted beyond the facts a player needs
// (the minutes to wait, that the reply is text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { STEP_DRIVERS, stepsOf } from './helpers/step-drivers.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { runPlay, validatePlay } from '../lib/play.mjs';
import { buildRegistry } from '../lib/registry.mjs';
import { liveRegistry } from '../app.mjs';
import { createGuide } from '../api/guide.mjs';
import { createGuideClient, MAX_QUESTION, outcomeOf } from '../lib/guide/client.mjs';
import { cleanQuestion, guidePanelHtml, outcomeText } from '../lib/guide/panel.mjs';
import { guideAllowed } from '../lib/guide/context.mjs';
import { playFixture, FIXTURE_CARD } from './fixtures/play-level.mjs';
import fixtureLevel from './fixtures/fixture-level.mjs';

const NOW = 1767225600000;
const tick = () => new Promise((r) => setImmediate(r));
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

// The fixture's steps by key: choice 0, sort 1, build 2, incident 3, spot 4, tradeoff 5 (hints on), query 6, configure 7.
const STEP_AT = { choice: 0, sort: 1, build: 2, incident: 3, spot: 4, tradeoff: 5, query: 6, configure: 7 };

/** A level whose first step is the fixture's step `key`, built through the real registry (a level needs a mechanic step, so a choice is followed by the tradeoff). */
function oneStep(key) {
  const fx = playFixture();
  fx.play.steps = [fx.play.steps[STEP_AT[key]], ...(key === 'choice' ? [fx.play.steps[STEP_AT.tradeoff]] : [])];
  return buildRegistry([{ id: 'a', no: 0, levels: [fx], boss: null }], {
    deck: [FIXTURE_CARD], nodeIds: [], play: { validatePlay, runPlay },
  }).levels['play-fixture'];
}

/** A fetch that records its calls and lets the test answer each one (or leave it pending). */
function fakeFetch(answer) {
  const calls = [];
  const fetch = (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    return new Promise((resolve, reject) => {
      call.resolve = (r) => resolve(r);
      call.reject = reject;
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      if (answer) answer(call);
    });
  };
  fetch.calls = calls;
  return fetch;
}
const answers = (status, body) => (call) => call.resolve(res(status, body));

/** Open `level` with the real ctx and a guide over `fetch`; counts askedGuide calls. */
function open(level, { fetch = fakeFetch(answers(200, { ok: true, hint: 'Read the question again.' })), guide, close = new AbortController() } = {}) {
  const dom = makeDom();
  const client = createGuideClient({ fetch });
  const asked = { n: 0 };
  const ctx = createLevelContext({
    level, ovBody: dom.body, ovActions: dom.actions, now: () => NOW, shuffle: (a) => a, reduceMotion: true,
    onFinish: () => {}, signal: close.signal, reportError: (e) => { throw e; },
    guide: guide === undefined ? { configured: true, ask: client.ask } : guide,
  });
  const real = ctx.askedGuide;
  ctx.askedGuide = () => {
    asked.n += 1;
    real();
  };
  level.run(ctx);
  return { dom, ctx, fetch, asked, close };
}

const type = (text) => {
  q('#guide-q').value = text;
  q('#guide-q').oninput();
};
const ask = (text) => {
  type(text);
  click('#guide-ask');
};
const reply = () => q('#guide-reply');
const solve = (level) => {
  const [{ spec, driver }] = stepsOf(level);
  for (const sel of driver.solve(spec)) click(sel);
};

test('hidden when the guide is not configured, unknown, off for this step, or the level has no play', () => {
  const choice = oneStep('choice');
  assert.ok(open(choice).dom.body.querySelector('#guide'), 'sanity: configured shows it');
  for (const guide of [null, { configured: false, ask: async () => ({}) }]) {
    assert.equal(open(choice, { guide }).dom.body.querySelector('#guide') === null, true);
  }
  // A step whose Hint button is off has no panel (guideAllowed, the same rule as the server).
  const hintless = oneStep('sort');
  const { type: t, spec } = stepsOf(hintless)[0];
  assert.equal(guideAllowed(t, spec), false);
  assert.equal(open(hintless).dom.body.querySelector('#guide') === null, true);
  // A run(ctx) level never mounts it.
  const dom = makeDom();
  const ctx = createLevelContext({
    level: fixtureLevel, ovBody: dom.body, ovActions: dom.actions, now: () => NOW, shuffle: (a) => a,
    onFinish: () => {}, signal: new AbortController().signal, reportError: (e) => { throw e; },
    guide: { configured: true, ask: async () => ({}) },
  });
  fixtureLevel.run(ctx);
  assert.equal(dom.body.querySelector('#guide') === null, true);
});

test('the client: status once per page and cached; unknown, failed or odd means off', async () => {
  const ok = (body) => async () => res(200, body);
  const cases = [
    [ok({ v: 1, configured: true }), true],
    [ok({ v: 1, configured: false }), false],
    [ok({ v: 1, configured: 'yes' }), false],
    [ok({ v: 2, configured: true }), false],
    [async () => res(500, { v: 1, configured: true }), false],
    [async () => { throw new Error('offline'); }, false],
    [async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }), false],
  ];
  for (const [fetch, want] of cases) {
    let n = 0;
    const client = createGuideClient({ fetch: (...a) => { n += 1; return fetch(...a); } });
    assert.equal(client.configured, false, 'off until the status arrives');
    assert.equal(await client.status(), want);
    assert.equal(await client.status(), want);
    assert.equal(client.configured, want);
    assert.equal(n, 1, 'fetched once');
  }
});

test('the client: each server answer becomes one typed outcome', () => {
  assert.deepEqual(outcomeOf(200, { ok: true, hint: 'Look at the title.' }), { kind: 'ok', hint: 'Look at the title.' });
  assert.deepEqual(outcomeOf(200, { ok: false, error: 'withheld' }), { kind: 'withheld' });
  assert.deepEqual(outcomeOf(429, { error: 'rate-limited', retryAfterS: 90 }), { kind: 'rate-limited', retryAfterS: 90 });
  assert.deepEqual(outcomeOf(404, { error: 'unavailable' }), { kind: 'unavailable' });
  assert.deepEqual(outcomeOf(503, { error: 'not-configured' }), { kind: 'unavailable' });
  assert.deepEqual(outcomeOf(502, { error: 'upstream' }), { kind: 'upstream' });
  assert.deepEqual(outcomeOf(400, { ok: false, error: 'bad-request', field: 'question' }), { kind: 'rejected' });
  for (const [status, body] of [[200, { ok: true, hint: '  ' }], [200, null], [200, {}], [500, null], [403, { error: 'forbidden' }]]) {
    assert.equal(outcomeOf(status, body).kind, 'failed', `${status} ${JSON.stringify(body)}`);
  }
  assert.deepEqual(outcomeOf(429, null), { kind: 'rate-limited', retryAfterS: 60 }, 'no usable wait: a minute');
});

test('the client: ask posts the contract body, never the pick, and aborts without a trace', async () => {
  const fetch = fakeFetch(answers(200, { ok: true, hint: 'Hi.' }));
  const client = createGuideClient({ fetch });
  const out = await client.ask('lvl-1', 'step-a', 'What is a span?', new AbortController().signal);
  assert.deepEqual(out, { kind: 'ok', hint: 'Hi.' });
  const [{ url, init, body }] = fetch.calls;
  assert.equal(url, '/api/guide');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.deepEqual(body, { v: 1, levelId: 'lvl-1', stepId: 'step-a', question: 'What is a span?' });
  const gone = new AbortController();
  gone.abort();
  assert.deepEqual(await client.ask('l', 's', 'q', gone.signal), { kind: 'aborted' });
  assert.equal(fetch.calls.length, 1, 'an aborted signal sends nothing');
  const late = new AbortController();
  const slow = createGuideClient({ fetch: fakeFetch() });
  const pending = slow.ask('l', 's', 'q', late.signal);
  late.abort();
  assert.deepEqual(await pending, { kind: 'aborted' });
  const net = createGuideClient({ fetch: async () => { throw new Error('offline'); } });
  assert.deepEqual(await net.ask('l', 's', 'q', new AbortController().signal), { kind: 'failed' });
});

test('the panel is in the board side slot on a wide step, after the widget on a choice step', () => {
  const wide = open(oneStep('tradeoff'));
  const slot = wide.dom.body.querySelector('[data-guide-slot]');
  assert.ok(slot, 'the side column has the slot');
  assert.ok(slot.querySelector('#guide'), 'the panel is in it');
  assert.ok(wide.dom.body.querySelector('aside')?.contains(slot));
  assert.equal(wide.dom.body.querySelectorAll('#guide').length, 1);

  const choice = open(oneStep('choice'));
  assert.equal(choice.dom.body.querySelector('[data-guide-slot]') === null, true, 'a choice step has no side column');
  const step = choice.dom.body.querySelector('.ui-step');
  assert.equal(step.lastElementChild.querySelector('#guide') !== null, true, 'the panel is the last thing in the step');
  assert.ok(step.querySelector('#fx-pick-feedback').compareDocumentPosition(step.querySelector('#guide')) & 4, 'after the widget');
});

test('ask shows a loading state, then the reply as text, and charges one hint once', async () => {
  const hostile = '<img src=x onerror=alert(1)> Look at <b>the title</b>';
  const fetch = fakeFetch(); // answered by hand
  const run = open(oneStep('tradeoff'), { fetch });
  assert.equal(q('#fx-budget-hints').textContent, '0');
  ask('  What is this step about?  ');
  assert.equal(reply().hidden, false);
  assert.match(reply().textContent, /Asking/);
  assert.equal(run.asked.n, 0, 'nothing is charged while pending');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].body.question, 'What is this step about?', 'trimmed');
  assert.equal(fetch.calls[0].body.stepId, 'fx-budget');
  assert.equal(fetch.calls[0].body.levelId, 'play-fixture');
  fetch.calls[0].resolve(res(200, { ok: true, hint: hostile }));
  await tick();
  assert.equal(reply().querySelector('img') === null, true, 'the reply is text, not markup');
  assert.equal(reply().querySelector('b') === null, true);
  assert.ok(reply().textContent.includes(hostile), 'shown literally');
  assert.equal(run.asked.n, 1);
  assert.equal(q('#fx-budget-hints').textContent, '1', 'the board counts it');
  assert.equal(q('#guide-ask').disabled, false, 'free to ask again');
});

test('withheld, upstream, rate-limited (minutes shown), unavailable, rejected and a dead network charge nothing', async () => {
  const cases = [
    ['withheld', () => res(200, { ok: false, error: 'withheld' }), /answer/],
    ['upstream', () => res(502, { error: 'upstream' }), /could not answer/],
    ['rate-limited', () => res(429, { error: 'rate-limited', retryAfterS: 150 }), /3 minutes/],
    ['rate-limited, one minute', () => res(429, { error: 'rate-limited', retryAfterS: 20 }), /1 minute\b/],
    ['unavailable', () => res(404, { error: 'unavailable' }), /not available/],
    ['not configured', () => res(503, { error: 'not-configured' }), /not available/],
    ['rejected', () => res(400, { ok: false, error: 'bad-request', field: 'question' }), /could not take/],
    ['network', () => { throw new Error('offline'); }, /could not be reached/],
  ];
  for (const [name, make, says] of cases) {
    const fetch = fakeFetch((call) => {
      try {
        call.resolve(make());
      } catch (e) {
        call.reject(e);
      }
    });
    const run = open(oneStep('tradeoff'), { fetch });
    ask('Why?');
    await tick();
    assert.match(reply().textContent, says, name);
    assert.equal(run.asked.n, 0, `${name}: free`);
    assert.equal(q('#fx-budget-hints').textContent, '0', name);
    assert.equal(q('#guide-ask').disabled, false, `${name}: can try again`);
  }
});

test('double click: one request, one charge, the button disabled while pending', async () => {
  const fetch = fakeFetch();
  const run = open(oneStep('tradeoff'), { fetch });
  type('Why?');
  const btn = q('#guide-ask');
  btn.onclick();
  assert.equal(btn.disabled, true);
  btn.onclick();
  q('#guide-q').onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(fetch.calls.length, 1);
  fetch.calls[0].resolve(res(200, { ok: true, hint: 'A hint.' }));
  await tick();
  assert.equal(run.asked.n, 1);
  assert.equal(btn.disabled, false);
});

test('closing while pending aborts the request: no charge, no stale reply', async () => {
  const close = new AbortController();
  const stale = []; // a reply that arrives anyway, as if the network ignored the abort
  const run = open(oneStep('tradeoff'), {
    close,
    guide: { configured: true, ask: (...a) => new Promise((resolve) => stale.push({ a, resolve })) },
  });
  ask('Why?');
  const [{ a, resolve }] = stale;
  assert.equal(a[3].aborted, false);
  close.abort();
  assert.equal(a[3].aborted, true, 'the step signal aborts with the overlay');
  resolve({ kind: 'ok', hint: 'Too late.' });
  await tick();
  assert.equal(run.asked.n, 0);
  assert.equal(q('#fx-budget-hints').textContent, '0');
  assert.ok(!reply().textContent.includes('Too late'));
});

test('Next while pending aborts that step\'s request: no charge, no stale reply on the next step', async () => {
  const fx = playFixture();
  fx.play.steps = [fx.play.steps[0], fx.play.steps[5]];
  const level = buildRegistry([{ id: 'a', no: 0, levels: [fx], boss: null }], {
    deck: [FIXTURE_CARD], nodeIds: [], play: { validatePlay, runPlay },
  }).levels['play-fixture'];
  const pending = [];
  const run = open(level, { guide: { configured: true, ask: (...a) => new Promise((resolve) => pending.push({ a, resolve })) } });
  ask('Why?');
  const first = pending[0];
  solve(oneStep('choice'));
  click('#fx-next');
  assert.equal(first.a[3].aborted, true, 'Next aborts the step\'s signal');
  first.resolve({ kind: 'ok', hint: 'Old step reply.' });
  await tick();
  assert.equal(run.asked.n, 0);
  assert.ok(q('#guide'), 'the next step has its own panel');
  assert.ok(!reply().textContent.includes('Old step reply'));
  ask('And here?');
  assert.equal(pending[1].a[3].aborted, false, 'a fresh signal on the new step');
});

test('a solved step disables Ask and the box; a reply arriving after it is dropped', async () => {
  const pending = [];
  const run = open(oneStep('choice'), { guide: { configured: true, ask: (...a) => new Promise((resolve) => pending.push({ a, resolve })) } });
  type('Why?');
  assert.equal(q('#guide-ask').disabled, false);
  click('#guide-ask');
  solve(oneStep('choice'));
  assert.equal(q('#guide-ask').disabled, true);
  assert.equal(q('#guide-q').disabled, true);
  pending[0].resolve({ kind: 'ok', hint: 'After the fact.' });
  await tick();
  assert.equal(run.asked.n, 0, 'no charge after the step is solved');
  assert.ok(!reply().textContent.includes('After the fact'));
  q('#guide-q').value = 'Another';
  q('#guide-q').oninput();
  assert.equal(q('#guide-ask').disabled, true, 'typing does not bring it back');
  q('#guide-q').onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(pending.length, 1);
});

test('Enter submits; an empty or over-long question disables Ask', async () => {
  const fetch = fakeFetch(answers(200, { ok: true, hint: 'Think about timing.' }));
  const run = open(oneStep('tradeoff'), { fetch });
  assert.equal(q('#guide-ask').disabled, true, 'empty at the start');
  type('   ');
  assert.equal(q('#guide-ask').disabled, true, 'blank');
  type('x'.repeat(MAX_QUESTION));
  assert.equal(q('#guide-ask').disabled, false, 'the limit itself is fine');
  type('x'.repeat(MAX_QUESTION + 1));
  assert.equal(q('#guide-ask').disabled, true, 'over the limit');
  q('#guide-q').onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(fetch.calls.length, 0, 'Enter does not send an invalid question');
  type('What should I weigh first?');
  q('#guide-q').onkeydown({ key: 'a' });
  q('#guide-q').onkeydown({ key: 'Enter', isComposing: true, preventDefault() {} });
  assert.equal(fetch.calls.length, 0, 'other keys and an IME composition do not send');
  q('#guide-q').onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(fetch.calls.length, 1);
  await tick();
  assert.equal(run.asked.n, 1);
});

test('the question sent is cleaned: control characters become spaces, ends trimmed', () => {
  assert.equal(cleanQuestion('\tWhat\u0007 is it?\n'), 'What  is it?');
  assert.equal(cleanQuestion('\u0000\u007f'), '');
});

test('the panel markup is kit markup with no inline style, handlers or Alpine; the reply region is live', () => {
  const html = guidePanelHtml();
  const box = makeDom().document.createElement('div');
  box.innerHTML = html;
  const attrs = [...box.querySelectorAll('*')].flatMap((el) => el.getAttributeNames().map((n) => `${el.localName} ${n}`));
  assert.deepEqual(attrs.filter((a) => /^\S+ (style$|on|x-|@|:)/.test(a)), []);
  assert.equal(box.querySelector('#guide-reply').getAttribute('role'), 'status');
  assert.equal(box.querySelector('#guide-reply').getAttribute('aria-live'), 'polite');
  assert.equal(box.querySelector('#guide-q').getAttribute('autocomplete'), 'off');
  assert.match(box.querySelector('#guide-q-note').textContent, new RegExp(`${MAX_QUESTION} characters`));
  assert.ok(box.querySelector('.ui-btn--hint#guide-ask'));
  assert.ok(!html.includes('\u2014'));
  for (const k of ['withheld', 'rate-limited', 'unavailable', 'upstream', 'rejected', 'failed']) {
    assert.ok(!outcomeText({ kind: k, retryAfterS: 60 }).includes('\u2014'));
  }
});

test('the panel is on every allowed live step type with a hint, and never on a hintless one', () => {
  const fx = playFixture();
  fx.play.steps.forEach((step) => {
    const key = Object.keys(STEP_AT).find((k) => Object.hasOwn(step, k));
    const level = oneStep(key);
    const { type: t, spec } = stepsOf(level)[0];
    const run = open(level);
    assert.equal(run.dom.body.querySelector('#guide') !== null, guideAllowed(t, spec), key);
    assert.ok(STEP_DRIVERS[key], key);
  });
  for (const level of Object.values(liveRegistry().levels).filter((l) => l.play)) {
    for (const { type: t, spec } of stepsOf(level)) {
      if (!guideAllowed(t, spec)) continue;
      assert.ok(t.idOf(spec), 'an allowed step has an id the server can find');
    }
  }
});

test('MAX_QUESTION is the server\'s limit: the longest is taken, one more is refused', async () => {
  const live = liveRegistry();
  const level = Object.values(live.levels).find((l) => l.play && stepsOf(l).some(({ type: t, spec }) => guideAllowed(t, spec)));
  const { type: t, spec } = stepsOf(level).find(({ type: ty, spec: sp }) => guideAllowed(ty, sp));
  const server = createGuide({
    env: { ANTHROPIC_API_KEY: 'k' },
    fetch: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Re-read what the question asks.' }] })),
    registry: live,
    log: () => {},
  });
  const post = async (question) => {
    const r = await server.POST(new Request('http://localhost/api/guide', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, levelId: level.id, stepId: t.idOf(spec), question }),
    }));
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await post('x'.repeat(MAX_QUESTION))).status, 200);
  const over = await post('x'.repeat(MAX_QUESTION + 1));
  assert.equal(over.status, 400);
  assert.equal(over.body.field, 'question');
  assert.match(readFileSync(new URL('../lib/guide/client.mjs', import.meta.url), 'utf8'), /MAX_QUESTION = 300;/);
});
