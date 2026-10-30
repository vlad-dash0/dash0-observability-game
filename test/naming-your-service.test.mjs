// Level 1.2 "Naming your service" beyond the play-through: player input reaches the page
// only escaped, every answer is stated in words (not just the CSS marker), the hint is
// scored once. The happy and sloppy runs live in test/levels-play.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, click } from './helpers/dom.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import level from '../levels/naming-your-service.mjs';

/** Start the level with the real ctx; returns the finish results collected so far. */
function start() {
  const dom = makeDom();
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
  assert.equal(q('#nys-feedback img'), null, 'player markup became an element');
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
