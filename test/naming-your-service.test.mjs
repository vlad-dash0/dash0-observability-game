// Level 1.2 "Naming your service" beyond the play-through: player input reaches the page
// only escaped, every answer is stated in words (not just the CSS marker), each penalty
// is scored once, and focus never drops to the page. The happy and sloppy runs live in
// test/levels-play.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, click } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import level from '../levels/naming-your-service.mjs';

// linkedom has no focus model: record each focus() call as a string (`#id` or
// `pick:<key>`) plus whether the element could take focus, never the node itself.
let focusLog = [];
const lastFocus = () => focusLog.at(-1)?.name ?? 'body';

/** Start the level with the real ctx; returns the finish results collected so far. */
function start() {
  const dom = makeDom();
  focusLog = [];
  dom.window.HTMLElement.prototype.focus = function focus() {
    const name = this.id ? `#${this.id}` : `pick:${this.dataset.pick}`;
    focusLog.push({ name, focusable: !this.disabled && this.isConnected });
  };
  const finished = [];
  const ctx = createLevelContext({
    level: { ...level, scored: true, scoring: { parMs: null } },
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (_id, r) => finished.push(r),
    signal: new AbortController().signal,
  });
  level.run(ctx);
  return finished;
}

const feedback = () => q('#nys-feedback').textContent;
const GOOD = [
  'OTEL_SERVICE_NAME=checkout',
  'OTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production',
].join('\n');

/** Answer step 1 right and move to the config editor. */
function toEditor() {
  click('[data-pick="fallback"]');
  click('#nys-next');
}

test('step 1 states a wrong and a right pick in words', () => {
  start();
  assert.match(q('#nys-config').textContent, /deployment\.environment\.name=production/);
  click('[data-pick="name"]');
  assert.match(feedback(), /^Not quite\./);
  assert.ok(q('#nys-next').disabled, 'a wrong pick does not unlock Next');
  click('[data-pick="fallback"]');
  assert.match(feedback(), /^Right\./);
  assert.match(feedback(), /unknown_service:node/);
  assert.ok(!q('#nys-next').disabled);
});

test('a failed check says so in words and lists each problem', () => {
  start();
  toEditor();
  click('#nys-check');
  assert.match(feedback(), /^Not yet: 2 problems\./);
  assert.match(feedback(), /shows up as unknown_service:node/);
  assert.equal(q('#nys-feedback').querySelectorAll('li').length, 2);
  assert.ok(q('#nys-next').disabled);
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.match(feedback(), /^Config passes\./);
  assert.ok(!q('#nys-next').disabled);
});

test('player config is echoed only escaped', () => {
  start();
  toEditor();
  q('#nys-env').value = GOOD.replace('=checkout', '=<img src=x onerror=alert(1)>');
  click('#nys-check');
  assert.equal(q('#nys-feedback img') === null, true, 'player markup became an element');
  assert.match(feedback(), /<img src=x onerror=alert\(1\)>/);
});

test('the hint is offered once and costs a star', () => {
  const finished = start();
  toEditor();
  click('#nys-hint');
  assert.match(q('#nys-hint-text').textContent, /OTEL_SERVICE_NAME=checkout/);
  assert.ok(q('#nys-hint').disabled, 'the hint can be taken only once');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  click('#nys-next');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 2, 'a clean run with one hint');
});

test('step 3: Finish waits for the right answer, and both answers are stated in words', () => {
  start();
  toEditor();
  q('#nys-env').value = GOOD;
  click('#nys-check');
  click('#nys-next');
  assert.ok(q('[data-finish]').disabled, 'Finish waits for the step 3 answer');
  click('[data-pick="resource-attr"]');
  assert.match(feedback(), /^Not quite\./);
  assert.ok(q('[data-finish]').disabled);
  click('[data-pick="env-var"]');
  assert.match(feedback(), /^Right\./);
  assert.ok(!q('[data-finish]').disabled);
});

// scoreStars maps 1 and 2 penalties to the same 2 stars, so the sloppy run in
// levels-play (one wrong pick plus one failed check) cannot tell if either mistake was
// dropped. These runs carry exactly one penalty each, from a clean 3-star baseline.
/** Play the level through, adding the named slips; returns the stars earned. */
function runWith({ wrongPick = false, failedCheck = false, wrongLast = false }) {
  const finished = start();
  if (wrongPick) click('[data-pick="bare"]');
  toEditor();
  if (failedCheck) click('#nys-check');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  click('#nys-next');
  if (wrongLast) click('[data-pick="last-line"]');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  assert.equal(finished.length, 1);
  return finished[0].stars;
}

test('each wrong pick and each failed check costs a star on its own', () => {
  assert.equal(runWith({}), 3, 'a clean run');
  assert.equal(runWith({ wrongPick: true }), 2, 'one wrong pick in step 1');
  assert.equal(runWith({ failedCheck: true }), 2, 'one failed check in step 2');
  assert.equal(runWith({ wrongLast: true }), 2, 'one wrong pick in step 3');
});

test('step 2 fails a config that names checkout twice, or that turns the SDK off', () => {
  start();
  toEditor();
  q('#nys-env').value = GOOD.replace('=service.version', '=service.name=cart,service.version');
  click('#nys-check');
  assert.match(feedback(), /^Not yet: 1 problem\./);
  assert.equal(q('#nys-feedback [data-code="service-name-conflict"]') !== null, true);
  q('#nys-env').value = `${GOOD}\nOTEL_SDK_DISABLED=true`;
  click('#nys-check');
  assert.match(feedback(), /^Not yet: 1 problem\./);
  assert.match(feedback(), /turns the SDK off/);
  assert.equal(q('#nys-next').disabled, true);
});

test('a passing service.version is echoed only escaped', () => {
  start();
  toEditor();
  q('#nys-env').value = GOOD.replace('1.4.2', '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  click('#nys-check');
  assert.match(feedback(), /^Config passes\./);
  assert.equal(q('#nys-feedback img') === null, true, 'player markup became an element');
  assert.match(feedback(), /<img src=x onerror=alert\(1\)>/);
});

test('the passed config stays readable and focusable: readOnly, not disabled', () => {
  start();
  toEditor();
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.equal(q('#nys-env').readOnly, true);
  assert.equal(q('#nys-env').disabled, false);
});

test('re-checking the same failed config costs nothing more; a new failing one does', () => {
  const once = start();
  click('[data-pick="bare"]'); // one wrong pick
  toEditor();
  click('#nys-check');
  click('#nys-check');
  assert.match(feedback(), /^Same config as last time: 2 problems\./);
  assert.equal(q('#nys-feedback li') !== null, true, 'the problems are still listed');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  click('#nys-next');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  assert.equal(once[0].stars, 2, 'wrong pick + one failed check: 2 penalties');

  const twice = start();
  click('[data-pick="bare"]');
  toEditor();
  click('#nys-check');
  q('#nys-env').value = `${q('#nys-env').value}\nOTEL_SERVICE_NAME=cart`;
  click('#nys-check');
  assert.match(feedback(), /^Not yet:/);
  q('#nys-env').value = GOOD;
  click('#nys-check');
  click('#nys-next');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  assert.equal(twice[0].stars, 1, 'wrong pick + two different failed configs: 3 penalties');
});

test('focus never drops to the page: each step, pick, hint and pass moves it on', () => {
  start();
  assert.equal(lastFocus(), 'pick:name', 'step 1 focuses its first choice');
  click('[data-pick="name"]');
  assert.equal(lastFocus(), 'pick:fallback', 'a wrong pick moves to the next enabled choice');
  click('[data-pick="env"]');
  assert.equal(lastFocus(), 'pick:fallback', 'and wraps around past disabled ones');
  click('[data-pick="fallback"]');
  assert.equal(lastFocus(), '#nys-next', 'a right pick moves to Next');
  click('#nys-next');
  assert.equal(lastFocus(), '#nys-env', 'step 2 focuses the editor');
  click('#nys-hint');
  assert.equal(lastFocus(), '#nys-env', 'the spent hint hands focus back to the editor');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.equal(lastFocus(), '#nys-next', 'a pass moves to Next');
  click('#nys-next');
  assert.equal(lastFocus(), 'pick:env-var', 'step 3 focuses its first choice');
  click('[data-pick="env-var"]');
  assert.equal(lastFocus(), '#nys-finish', 'the right answer moves to Finish');
  assert.deepEqual(focusLog.filter((f) => !f.focusable).map((f) => f.name), [], 'focused only enabled elements');
});
