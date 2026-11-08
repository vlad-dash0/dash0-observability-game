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

// The hint ladder (#159 E1): three tiers in order, each Hint click one ctx.hint() and one hint on
// the score card; tier 3 fills REFERENCE and runs the same Check without a mistake.
const tone = () => q('#nys-feedback').getAttribute('data-tone');
const hintText = () => q('#nys-hint-text').textContent;
const finishFrom = (finished) => {
  click('#nys-next');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  return finished[0].stars;
};

test('hint tier 1 is the authored hint, costs one star, and the button then offers tier 2', () => {
  const finished = start();
  toEditor();
  assert.equal(q('#nys-hint').textContent, 'Hint 1 of 3');
  click('#nys-hint');
  assert.match(hintText(), /^Hint 1 of 3/);
  assert.match(hintText(), /variable of its own/);
  assert.equal(q('#nys-hints').textContent, '1');
  assert.equal(q('#nys-hint').textContent, 'Hint 2 of 3');
  assert.equal(q('#nys-hint').disabled, false);
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.equal(finishFrom(finished), 4, 'one hint, no failed Check');
});

test('hint tier 2 names the first problem in the player text by its variable, with no value', () => {
  start();
  toEditor();
  click('#nys-hint');
  click('#nys-hint');
  assert.match(hintText(), /^Hint 2 of 3/);
  assert.match(hintText(), /In OTEL_SERVICE_NAME: no service name is set/);
  assert.match(hintText(), /finished answer has 3 pairs, the service name included; yours has 2/);
});

/** The tier 2 text for `text` in the editor (a fresh level, two Hint clicks). */
function tier2For(text) {
  start();
  toEditor();
  q('#nys-env').value = text;
  click('#nys-hint');
  click('#nys-hint');
  return hintText();
}
const LIST = 'OTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production';

test('hint tier 2 names the variable in use: the list when the name comes from it, and where it sits', () => {
  const t = tier2For(`${LIST.replace('service.version', 'service.name=cart,service.version')}`);
  assert.match(t, /In OTEL_RESOURCE_ATTRIBUTES \(line 1\): the list's service name is not the one this task asks for/);
  assert.doesNotMatch(t, /OTEL_SERVICE_NAME|cart|checkout/);
  const wrongVar = tier2For(`OTEL_SERVICE_NAME=cart\n${LIST}`);
  assert.match(wrongVar, /In OTEL_SERVICE_NAME \(line 1\): a name is set, but not the one this task asks for/);
  const second = tier2For(`OTEL_EXPORTER_OTLP_ENDPOINT=http://x\nOTEL_SERVICE_NAME=checkout\nOTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production`);
  assert.match(second, /In OTEL_RESOURCE_ATTRIBUTES \(line 3\): the list has no version pair/);
});

test('hint tier 2 says a variable is not set in the file when it is missing or misspelled', () => {
  const t = tier2For(`OTEL_SERVICE_NAME=checkout\n${LIST.replace('OTEL_RESOURCE_ATTRIBUTES', 'OTEL_RESOURCE_ATTRIBUTE').replace('service.version=1.4.2,', '')}`);
  assert.match(t, /OTEL_RESOURCE_ATTRIBUTES is not set in the file/);
  assert.doesNotMatch(t, /no version pair/);
});

test('hint tier 3 fills the reference and passes without a mistake, costing the three hints only', () => {
  const finished = start();
  toEditor();
  click('#nys-hint');
  click('#nys-hint');
  click('#nys-hint');
  assert.equal(q('#nys-env').value.includes('OTEL_SERVICE_NAME=checkout'), true, 'the reference is in the editor');
  assert.equal(q('#nys-env').readOnly, true);
  assert.equal(tone(), 'neutral', 'a filled-in pass is not a success');
  assert.match(feedback(), /^Filled in for you\. Config passes\./);
  assert.equal(q('#nys-wrong').textContent, '0', 'tier 3 is not a failed Check');
  assert.equal(q('#nys-hints').textContent, '3');
  assert.equal(q('#nys-hint').disabled, true);
  assert.ok(!q('#nys-next').disabled);
  assert.equal(q('#nys-win').hidden, false, 'the success card shows');
  assert.equal(finishFrom(finished), 2, 'three hints, no mistake');
});

test('the ladder stops after three hints, and a hint never counts as a failed Check', () => {
  start();
  toEditor();
  for (let i = 0; i < 2; i++) click('#nys-hint');
  assert.equal(q('#nys-wrong').textContent, '0');
  assert.equal(q('#nys-hints').textContent, '2');
  click('#nys-check');
  assert.equal(q('#nys-wrong').textContent, '1');
  assert.equal(q('#nys-hints').textContent, '2');
  click('#nys-hint');
  assert.equal(q('#nys-hints').textContent, '3');
  assert.equal(q('#nys-hint').disabled, true, 'the ladder is spent');
  const hint = q('#nys-hint');
  hint.onclick({ currentTarget: hint, target: hint });
  assert.equal(q('#nys-hints').textContent, '3', 'a fourth click is ignored');
  assert.equal(q('#nys-wrong').textContent, '1');
});

test('no hint tier before the last gives away the answer: no reference line and no value', () => {
  start();
  toEditor();
  click('#nys-hint');
  const tier1 = hintText();
  click('#nys-hint');
  const tier2 = hintText();
  for (const text of [tier1, tier2]) {
    assert.doesNotMatch(text, /checkout|1\.4\.2|production|OTEL_SERVICE_NAME=/);
  }
  for (const text of [tier2For(`${LIST}\nOTEL_SERVICE_NAME=cart`), tier2For('OTEL_RESOURCE_ATTRIBUTES=service.name=cart,deployment.environment=prod'), tier2For('OTEL_RESOURCE_ATTRIBUTE=service.version=1.4.2')]) {
    assert.doesNotMatch(text, /checkout|1\.4\.2|production|OTEL_SERVICE_NAME=|cart/);
  }
});

test('Check reads in tones: a new failing config is an error, the same text again neutral, a pass success', () => {
  start();
  toEditor();
  assert.equal(q('#nys-feedback').hasAttribute('hidden'), true, 'nothing said before the first Check');
  click('#nys-check');
  assert.equal(tone(), 'error');
  assert.equal(q('#nys-wrong').textContent, '1');
  click('#nys-check');
  assert.equal(tone(), 'neutral');
  assert.equal(q('#nys-wrong').textContent, '1', 'the same text again is free');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.equal(tone(), 'success');
});

test('any config already checked is free: a trailing newline, trailing spaces, CRLF and A, B, A cost nothing more', () => {
  start();
  toEditor();
  const A = q('#nys-env').value;
  const B = `${A}\nOTEL_SERVICE_NAME=cart`;
  click('#nys-check');
  assert.equal(q('#nys-wrong').textContent, '1');
  for (const same of [`${A}\n`, `${A}   `, A.replace(/\n/g, '\r\n'), `\n\n${A}`]) {
    q('#nys-env').value = same;
    click('#nys-check');
    assert.equal(tone(), 'neutral');
    assert.equal(q('#nys-wrong').textContent, '1', JSON.stringify(same));
  }
  q('#nys-env').value = B;
  click('#nys-check');
  assert.equal(q('#nys-wrong').textContent, '2');
  q('#nys-env').value = A;
  click('#nys-check');
  assert.equal(tone(), 'neutral');
  assert.equal(q('#nys-wrong').textContent, '2', 'going back to A is free');
});

test('a blank Check is free and neutral, and says what to do', () => {
  start();
  toEditor();
  q('#nys-env').value = '  \n ';
  click('#nys-check');
  assert.equal(tone(), 'neutral');
  assert.equal(feedback(), 'Type a config first.');
  assert.equal(q('#nys-wrong').textContent, '0');
});

test('a pass whose name comes from the attribute list works, with a neutral note about OTEL_SERVICE_NAME', () => {
  start();
  toEditor();
  q('#nys-env').value = LIST.replace('service.version', 'service.name=checkout,service.version');
  click('#nys-check');
  assert.equal(tone(), 'success');
  assert.match(feedback(), /^Config passes\./);
  assert.match(feedback(), /dedicated variable and wins if both are set/);
  assert.ok(!q('#nys-next').disabled, 'the note blocks nothing');
  start();
  toEditor();
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.doesNotMatch(feedback(), /dedicated variable/);
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

// The sloppy run in levels-play carries several penalties at once, so it is a coarse check
// that either mistake was dropped. These runs carry exactly one penalty each, from a clean
// 5-star baseline.
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
  assert.equal(runWith({}), 5, 'a clean run');
  assert.equal(runWith({ wrongPick: true }), 4, 'one wrong pick in step 1');
  assert.equal(runWith({ failedCheck: true }), 4, 'one failed check in step 2');
  assert.equal(runWith({ wrongLast: true }), 4, 'one wrong pick in step 3');
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
  assert.match(feedback(), /^You already checked this config\. Nothing new was counted\./);
  assert.equal(q('#nys-feedback li') !== null, true, 'the problems are still listed');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  click('#nys-next');
  click('[data-pick="env-var"]');
  click('[data-finish]');
  assert.equal(once[0].stars, 3, 'wrong pick + one failed check: 2 penalties');

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
  assert.equal(twice[0].stars, 2, 'wrong pick + two different failed configs: 3 penalties');
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
  click('#nys-check');
  assert.equal(lastFocus(), '#nys-env', 'a failing Check leaves focus in the editor');
  click('#nys-hint');
  assert.equal(lastFocus(), '#nys-hint-text', 'a hint focuses its text');
  q('#nys-env').value = GOOD;
  click('#nys-check');
  assert.equal(lastFocus(), '#nys-win-title', 'a pass focuses the success card heading');
  click('#nys-next');
  assert.equal(lastFocus(), 'pick:env-var', 'step 3 focuses its first choice');
  click('[data-pick="env-var"]');
  assert.equal(lastFocus(), '#nys-finish', 'the right answer moves to Finish');
  assert.deepEqual(focusLog.filter((f) => !f.focusable).map((f) => f.name), [], 'focused only enabled elements');
});

test('Escape on a shown hint is handled and moves focus to the Hint button, or the editor once the ladder is spent (#178)', () => {
  start();
  toEditor();
  click('#nys-hint');
  const esc = () => {
    const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    q('#nys-hint-text').onkeydown(e);
    return e.defaultPrevented;
  };
  focusLog = [];
  assert.equal(esc(), true);
  assert.deepEqual(focusLog, [{ name: '#nys-hint', focusable: true }]);
  click('#nys-hint');
  click('#nys-hint');
  focusLog = [];
  assert.equal(esc(), true, 'the Hint button is spent: Escape goes to the (read-only, still focusable) editor');
  assert.deepEqual(focusLog, [{ name: '#nys-env', focusable: true }]);
});
