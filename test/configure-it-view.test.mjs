// lib/widgets/configure-it-view.mjs: the Configure it view and mount (render, the one penalty,
// the pipeline view, escaping, focus). Spec: docs/M1-DESIGN.md §4.9. Asserts strings, numbers and
// booleans only: specific elements and their text, never DOM graphs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { newConfigureState, SCHEMAS } from '../lib/widgets/configure-it.mjs';
import { RULE, mountConfigure, pipelinesHtml, renderConfigure } from '../lib/widgets/configure-it-view.mjs';
import { CONFIGURE_RULE } from '../lib/widgets/configure-it-help.mjs';

const REF = `receivers:
  otlp:
processors:
  batch:
exporters:
  otlp/dash0:
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/dash0]
`;
const GIVEN = REF.replace('[otlp/dash0]', '[otlp/dash0x]').replace('      processors: [batch]\n', '').replace('processors:\n  batch:\n', '');

const fixture = (extra = {}) => ({
  id: 'cf', schema: 'collector', given: GIVEN, reference: REF, target: ['traces'], explain: 'The names must match, <code>exactly</code>.', ...extra,
});

function setup(spec = fixture(), opts = {}) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const counts = { mistakes: 0, hints: 0, done: 0 };
  let swirled = 0;
  const ctx = { ovBody: dom.body, ovActions: dom.actions, escapeHtml, mistake() { counts.mistakes += 1; }, hint() { counts.hints += 1; } };
  dom.body.innerHTML = renderConfigure(spec, newConfigureState(), { escapeHtml, ...opts.render });
  dom.actions.innerHTML = '<button id="finish" disabled>Finish</button>';
  const onComplete = () => {
    counts.done += 1;
    const fin = dom.actions.querySelector('#finish');
    fin.disabled = false;
    return fin;
  };
  const swirl = () => { swirled += 1; };
  return { dom, focus, counts, swirled: () => swirled, mount: (extra = {}) => mountConfigure(ctx, spec, { onComplete, swirl, ...opts.mount, ...extra }) };
}

const feedback = () => q('#cf-feedback').textContent.trim();
const tone = () => q('#cf-feedback').getAttribute('data-tone');
const HELPS = { helps: { hints: true }, hint: 'Compare the <code>exporters</code> names.' };
const panel = () => q('#cf-pipelines').textContent;
const check = (text) => {
  q('#cf-input').value = text;
  click('#cf-check');
};
const pipe = (name) => q(`#cf-pipelines [data-pipeline="${name}"]`);
const stateOf = (name) => pipe(name).querySelector('.ui-chip').textContent.trim();
const flowOf = (name) => pipe(name).querySelector('[data-part="flow"]').textContent;
const items = (sel) => qa(sel).map((li) => li.textContent);

test('renderConfigure: a labelled monospace-ready textarea, a Check button, the pipelines panel, a live feedback region', () => {
  setup();
  const input = q('#cf-input');
  assert.equal(input.localName, 'textarea');
  assert.equal(q('label[for="cf-input"]').textContent, 'Your config (YAML)');
  for (const [attr, want] of [['spellcheck', 'false'], ['autocomplete', 'off'], ['autocapitalize', 'off'], ['autocorrect', 'off']]) {
    assert.equal(input.getAttribute(attr), want, attr);
  }
  assert.equal(q('#cf-check').textContent, 'Check');
  assert.equal(q('#cf-check').localName, 'button');
  const fb = q('#cf-feedback');
  assert.equal(fb.getAttribute('role'), 'status');
  assert.equal(fb.getAttribute('aria-live'), 'polite');
  assert.equal(fb.getAttribute('tabindex'), '-1');
  assert.equal(q('[data-configure]').hasAttribute('role'), false);
  assert.equal(qa('#cf-hint').length, 0);
  assert.equal(panel(), 'Press Check to see which pipelines flow.');
});

test('given prefills the textarea; in the markup it is escaped, so it cannot close the tag', () => {
  const given = 'a: "</textarea><img src=x>"';
  const spec = fixture({ given });
  const html = renderConfigure(spec, newConfigureState(), { escapeHtml });
  assert.equal(html.includes('</textarea><img'), false);
  const { mount } = setup(spec);
  mount();
  assert.equal(q('#cf-input').value, given);
  assert.equal(qa('img').length, 0);
});

test('renderConfigure: labelledBy makes a labelled group; a bad token is a TypeError naming the spec', () => {
  setup(fixture(), { render: { labelledBy: 'cf-q' } });
  assert.equal(q('[data-configure]').getAttribute('role'), 'group');
  assert.equal(q('[data-configure]').getAttribute('aria-labelledby'), 'cf-q');
  assert.throws(() => renderConfigure(fixture(), newConfigureState(), { escapeHtml, labelledBy: 'a b' }), /configure "cf": labelledBy must be a plain token/);
});

test('the reference passes: Right plus the explanation as markup, every pipeline Flowing, locked, done once, the success heading focused', () => {
  const { counts, focus, swirled, mount } = setup();
  mount();
  check(REF);
  assert.ok(feedback().startsWith('Right. The names must match, exactly.'));
  assert.equal(qa('#cf-feedback code').length, 1);
  assert.equal(stateOf('traces'), 'Flowing');
  assert.equal(flowOf('traces'), 'Receivers: otlp → Processors: batch → Exporters: otlp/dash0');
  assert.equal(q('[data-part="overall"]').textContent, 'The Collector would start: every pipeline flows.');
  assert.equal(q('#cf-input').readOnly, true, 'locked read-only, not disabled');
  assert.equal(q('#cf-input').disabled, false);
  assert.equal(q('#cf-check').disabled, true);
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.equal(tone(), 'success');
  assert.equal(q('#cf-win').hasAttribute('hidden'), false, 'the success card is on the right');
  assert.equal(q('#cf-win-stars').textContent, '5 of 5 stars: 0 failed Checks, 0 hints.');
  assert.equal(swirled(), 1);
  assert.equal(focus.last(), '#cf-win-title');
});

test('an equivalent config written differently passes too', () => {
  const { counts, mount } = setup();
  mount();
  check(REF.replace('[otlp]', '\n        - otlp').replace('[otlp/dash0]', '[ otlp/dash0 ]'));
  assert.ok(feedback().startsWith('Right.'));
  assert.equal(counts.mistakes, 0);
});

test('a wiring error costs one mistake, lists it as data, and shows the pipeline Stalled with the reason', () => {
  const { counts, mount } = setup();
  mount();
  check(GIVEN);
  assert.ok(feedback().startsWith('Not quite. The Collector would not accept this config: 1 problem.'), feedback());
  assert.deepEqual(items('#cf-feedback li'), ['unknown-ref service.pipelines.traces.exporters[0]: "otlp/dash0x" is not defined under exporters or connectors']);
  assert.equal(counts.mistakes, 1);
  assert.equal(counts.done, 0);
  assert.equal(tone(), 'error', 'a wrong answer is the error tone (D7)');
  assert.equal(q('#cf-wrong').textContent, '1');
  assert.equal(q('#cf-wrong-label').textContent, 'failed Check');
  assert.notEqual(q('#cf-input').readOnly, true);
  assert.equal(stateOf('traces'), 'Stalled');
  assert.equal(flowOf('traces'), 'Receivers: otlp → Processors: none → Exporters: otlp/dash0x (not defined)');
  assert.deepEqual(items('#cf-pipelines [data-pipeline="traces"] [data-part="reasons"] li'), ['service.pipelines.traces.exporters[0]: "otlp/dash0x" is not defined under exporters or connectors']);
  assert.equal(q('[data-part="overall"]').textContent, 'The Collector would not start.');
});

test('two problems are counted in the plural', () => {
  const { counts, mount } = setup();
  mount();
  check(`${GIVEN}zz: 1\n`);
  assert.ok(feedback().startsWith('Not quite. The Collector would not accept this config: 2 problems.'), feedback());
  assert.deepEqual(items('#cf-feedback li').map((t) => t.split(' ')[0]), ['unknown-key', 'unknown-ref']);
  assert.equal(counts.mistakes, 1);
});

test('the feedback and the pipeline view never show the reference', () => {
  const { mount } = setup();
  mount();
  check(GIVEN);
  assert.equal((feedback() + panel()).includes('batch'), false);
});

test('a valid config that leaves the target pipeline out costs one mistake and names it', () => {
  const { counts, mount } = setup();
  mount();
  check(REF.replace('traces:', 'metrics:'));
  assert.ok(feedback().startsWith('Not quite. The config is valid, but there is no flowing pipeline named "traces".'), feedback());
  assert.equal(counts.mistakes, 1);
  assert.equal(stateOf('metrics'), 'Flowing');
  assert.equal(counts.done, 0);
});

test('the same failing text again, whitespace aside, is free and keeps the pipeline view; a different failing one costs again', () => {
  const { counts, mount } = setup();
  mount();
  check(GIVEN);
  check(`${GIVEN}\n\n`);
  assert.equal(feedback(), 'You already checked this config. Nothing new was counted.');
  assert.equal(tone(), 'neutral');
  assert.equal(counts.mistakes, 1);
  assert.equal(stateOf('traces'), 'Stalled');
  check(`${GIVEN}zz: 1\n`);
  assert.equal(counts.mistakes, 2);
});

test('a failing config checked again after a different failing one is a repeat: the new copy, nothing new counted', () => {
  const { counts, mount } = setup();
  mount();
  check(GIVEN);
  check(`${GIVEN}zz: 1\n`);
  assert.equal(counts.mistakes, 2);
  check(GIVEN);
  assert.equal(feedback(), 'You already checked this config. Nothing new was counted.');
  assert.equal(counts.mistakes, 2);
});

test('a text that is not readable YAML is free, however often, says where, and clears the pipeline view', () => {
  const { counts, mount } = setup();
  mount();
  check(REF.replace('traces:', 'metrics:'));
  assert.equal(counts.mistakes, 1);
  check('a: b: c');
  check('a: b: c');
  check('- 1');
  assert.equal(counts.mistakes, 1);
  assert.ok(feedback().startsWith('Could not read that config as YAML. Nothing was marked wrong.'), feedback());
  assert.deepEqual(items('#cf-feedback li'), ['root the top level must be a mapping, got a list']);
  check('a: b: c');
  assert.deepEqual(items('#cf-feedback li'), ['parse line 1, column 5: bad indentation of a mapping entry']);
  assert.equal(panel(), 'Nothing to show until the YAML can be read.');
});

test('a repeat after an unreadable text redraws the pipeline view for the repeated config', () => {
  const { counts, mount } = setup();
  mount();
  check(GIVEN);
  check('a: b: c');
  assert.equal(panel(), 'Nothing to show until the YAML can be read.');
  check(GIVEN);
  assert.equal(feedback(), 'You already checked this config. Nothing new was counted.');
  assert.equal(stateOf('traces'), 'Stalled');
  assert.equal(counts.mistakes, 1);
});

test('blank text is free and asks for a config', () => {
  const { counts, mount } = setup();
  mount();
  check('  \n ');
  assert.equal(feedback(), 'Type a config first.');
  assert.equal(tone(), 'neutral');
  assert.equal(counts.mistakes, 0);
});

test('a checker that throws is a free "could not check", never a crash, and the widget keeps working', () => {
  for (const boom of [new Error('boom'), new RangeError('deep'), 'a string', undefined]) {
    const { counts, mount } = setup(fixture(), { mount: { check: () => { throw boom; } } });
    mount();
    check(GIVEN);
    check(GIVEN);
    assert.equal(feedback(), 'Could not check that text. Nothing was marked wrong.');
    assert.equal(counts.mistakes, 0);
    assert.equal(counts.done, 0);
    assert.equal(q('#cf-input').disabled, false);
    assert.equal(q('#cf-check').disabled, false);
  }
});

test('the pipeline view is drawn from the checker result alone: names, stages, state and reasons', () => {
  const doc = { service: { pipelines: { alpha: { receivers: ['r1'], processors: ['p1', 'p2'], exporters: ['e1'] }, beta: { receivers: ['r2'], exporters: ['e2'] } } } };
  const reason = { kind: 'unknown-ref', path: 'service.pipelines.alpha.processors[1]', message: '"p2" is gone', ref: 'p2', in: ['processors'] };
  let verdict = {
    flowing: false,
    pipelines: [{ name: 'alpha', flowing: false, reasons: [reason] }, { name: 'beta', flowing: true, reasons: [] }],
    inactive: [{ section: 'receivers', id: 'zed' }, { section: 'exporters', id: 'otlp/old' }],
  };
  const { mount } = setup(fixture(), { mount: { check: () => ({ ok: false, errors: [reason], doc, verdict }) } });
  mount();
  check('anything: 1');
  assert.deepEqual(qa('#cf-pipelines [data-pipeline]').map((el) => el.getAttribute('data-pipeline')), ['alpha', 'beta']);
  assert.equal(stateOf('alpha'), 'Stalled');
  assert.equal(stateOf('beta'), 'Flowing');
  assert.equal(flowOf('alpha'), 'Receivers: r1 → Processors: p1, p2 (not defined) → Exporters: e1');
  assert.equal(flowOf('beta'), 'Receivers: r2 → Processors: none → Exporters: e2');
  assert.deepEqual(items('#cf-pipelines [data-pipeline="alpha"] [data-part="reasons"] li'), ['service.pipelines.alpha.processors[1]: "p2" is gone']);
  assert.equal(qa('#cf-pipelines [data-pipeline="beta"] [data-part="reasons"]').length, 0);
  assert.equal(q('[data-part="inactive"]').textContent, 'Defined but not used by any pipeline: receivers/zed, exporters/otlp/old');
  assert.equal(pipe('alpha').getAttribute('data-state'), 'stalled');
  assert.equal(pipe('beta').getAttribute('data-state'), 'flowing');
});

test('a pipeline with nothing wrong in it is Flowing even when the config has errors elsewhere', () => {
  const doc = { service: { pipelines: { alpha: { receivers: ['r1'], exporters: ['e1'] } } } };
  const verdict = { flowing: false, pipelines: [{ name: 'alpha', flowing: true, reasons: [] }], inactive: [] };
  const err = { kind: 'unknown-key', path: 'zz', message: 'unknown key "zz"', allowed: [] };
  const { mount } = setup(fixture(), { mount: { check: () => ({ ok: false, errors: [err], doc, verdict }) } });
  mount();
  check('x: 1');
  assert.equal(stateOf('alpha'), 'Flowing');
  assert.equal(q('[data-part="overall"]').textContent, 'The Collector would not start.');
  const none = setup(fixture(), { mount: { check: () => ({ ok: false, errors: [err], doc: {}, verdict: { flowing: false, pipelines: [], inactive: [] } }) } });
  none.mount();
  check('x: 1');
  assert.equal(q('[data-part="overall"]').textContent, 'No pipelines are defined.');
});

test('everything typed or derived from the text is escaped in the pipeline view and the feedback', () => {
  const { counts, mount } = setup();
  mount();
  const evil = '<img src=x onerror=1>';
  check(REF.replace('[otlp/dash0]', `["${evil}"]`));
  assert.equal(qa('img').length, 0);
  assert.ok(panel().includes(`${evil} (not defined)`));
  assert.ok(feedback().includes(`"${evil}" is not defined`));
  check(REF.replace('    traces:', '    "traces/<u>x</u>":'));
  assert.equal(qa('u').length, 0);
  assert.ok(panel().includes('<u>x</u>'));
  assert.equal(counts.mistakes, 2);
  check('a: !<i>x</i> 1');
  assert.equal(qa('#cf-feedback i').length, 0);
  assert.ok(feedback().includes('unknown scalar tag !<i>'), feedback());
});

test('a long list of problems is cut with a count, and so are long pipeline lists', () => {
  const lines = Array.from({ length: 27 }, (_, i) => `    traces/p${i}:\n      receivers: [nope${i}]\n      exporters: [otlp/dash0]`).join('\n');
  const { mount } = setup();
  mount();
  check(REF.replace(/ {4}traces:[\s\S]*$/, `${lines}\n`));
  assert.equal(qa('#cf-feedback li').length, 20);
  assert.ok(feedback().includes('and 7 more problems'));
  assert.equal(qa('#cf-pipelines [data-pipeline]').length, 20);
  assert.ok(panel().includes('and 7 more pipelines'));
});

test('focus: the textarea on mount; a failing Check keeps focus where it is', () => {
  const { focus, mount } = setup();
  mount();
  assert.deepEqual(focus.names(), ['#cf-input']);
  check(GIVEN);
  assert.deepEqual(focus.names(), ['#cf-input']);
  assert.deepEqual(focus.unfocusable(), []);
});

test('mountConfigure throws a TypeError naming the spec for a bad spec, no onComplete, or no markup', () => {
  const { dom } = setup();
  const ctx = { ovBody: dom.body, escapeHtml, mistake() {}, hint() {} };
  assert.throws(() => mountConfigure(ctx, { ...fixture(), schema: 'nope' }, { onComplete() {} }), /configure "cf": invalid spec: unknown schema "nope"/);
  assert.throws(() => mountConfigure(ctx, fixture(), {}), /configure "cf": onComplete must be a function/);
  assert.throws(() => mountConfigure(ctx, { ...fixture(), id: 'other' }, { onComplete() {} }), /configure "other": not rendered/);
});

// `uses` (#97): the fixed message, the charge, and no leak of the missing ids.
const usesFixture = (extra = {}) => fixture({ uses: { traces: ['batch'] }, ...extra });
const NO_BATCH = REF.replace('      processors: [batch]\n', '').replace('processors:\n  batch:\n', '');

test('a config that flows but drops a required component costs one mistake, with a fixed message that never names it', () => {
  const { counts, mount } = setup(usesFixture());
  mount();
  check(NO_BATCH);
  assert.equal(feedback(), 'The traces pipeline runs, but it does not do what the task asks yet.');
  assert.equal(counts.mistakes, 1);
  assert.equal(counts.done, 0);
  assert.equal((feedback() + panel() + q('#cf-input').value).includes('batch'), false);
  assert.equal(stateOf('traces'), 'Flowing');
});

test('the uses message joins several pipelines in plain words, and a repeat is free', () => {
  const two = { traces: ['batch'], metrics: ['batch'] };
  const ref = `${REF}    metrics:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlp/dash0]\n`;
  const given = ref.replaceAll('[otlp/dash0]', '[otlp/dash0x]');
  const bare = ref.replaceAll('      processors: [batch]\n', '').replace('processors:\n  batch:\n', '');
  const { counts, mount } = setup(fixture({ given, reference: ref, uses: two }));
  mount();
  check(bare);
  assert.equal(feedback(), 'The traces and metrics pipelines run, but they do not do what the task asks yet.');
  check(bare);
  assert.equal(feedback(), 'You already checked this config. Nothing new was counted.');
  assert.equal(counts.mistakes, 1);
});

test('the reference passes a uses step after a uses slip, and the slip costs nothing more', () => {
  const { counts, mount } = setup(usesFixture());
  mount();
  check(NO_BATCH);
  check(REF);
  assert.ok(feedback().startsWith('Right. '), feedback());
  assert.equal(counts.mistakes, 1);
  assert.equal(counts.done, 1);
});

// `extensions` and `forbids` (#241): fixed messages, one mistake each, no ids.
test('a missing extension and a forbidden component each cost one mistake, with a message that names no id', () => {
  const ext = REF.replace('service:\n', 'service:\n  extensions: [pprof]\n').replace('processors:\n', 'extensions:\n  pprof:\nprocessors:\n');
  const a = setup(fixture({ reference: ext, extensions: ['pprof'], given: GIVEN }));
  a.mount();
  check(REF);
  assert.equal(feedback(), 'The pipelines run, but the Collector is not enabling every extension the task asks for yet.');
  assert.equal(a.counts.mistakes, 1);
  assert.equal(feedback().includes('pprof'), false);
  const two = REF.replace('exporters:\n', 'exporters:\n  otlp/bad:\n');
  const b = setup(fixture({ reference: two, forbids: { traces: ['otlp/bad'] } }));
  b.mount();
  check(two.replace('[otlp/dash0]', '[otlp/dash0, otlp/bad]'));
  assert.equal(feedback(), 'The traces pipeline runs, but it does not do what the task asks yet.');
  assert.equal(b.counts.mistakes, 1);
});

// ---- the kit view: the wide split, the chips, the hint ladder ---------------------------------

test('renderConfigure: a wide split with the board and the side column; the helps chips say hints are off or on', () => {
  setup().mount();
  assert.equal(qa('[data-configure] .ui-split .ui-split-side aside').length, 1, 'the side column beside the board');
  assert.equal(q('#cf-win').hasAttribute('hidden'), true, 'the success card waits for success');
  assert.equal(qa('#cf-stars [data-star="possible"]').length, 5);
  assert.equal(q('.ui-score-rule').textContent, RULE);
  assert.equal(q('#cf-hint-tier').textContent, 'No hints on this level.');
  assert.equal(q('[data-help="hints"]').getAttribute('data-on'), 'false');
  setup(fixture(HELPS));
  assert.equal(q('[data-help="hints"]').getAttribute('data-on'), 'true');
  assert.equal(qa('#cf-hint').length, 1);
});

test('each pipeline carries a chip in words: Flowing for one that flows, Stalled for one that does not', () => {
  const { mount } = setup();
  mount();
  check(GIVEN);
  assert.equal(pipe('traces').querySelector('.ui-chip').getAttribute('data-tone'), 'error');
  assert.equal(stateOf('traces'), 'Stalled');
  check(REF);
  assert.equal(pipe('traces').querySelector('.ui-chip').getAttribute('data-tone'), 'neutral');
  assert.equal(stateOf('traces'), 'Flowing');
  assert.equal(qa('#cf-pipelines [data-pipeline]').length, 1);
});

test('hint tier 1 charges once per click: ctx.hint() and the score card, the authored hint as markup, the tier line and the next label', () => {
  const { counts, mount } = setup(fixture(HELPS));
  mount();
  assert.equal(q('#cf-hint').textContent.trim(), 'Hint 1 of 3');
  click('#cf-hint');
  assert.equal(counts.hints, 1);
  assert.equal(q('#cf-hints').textContent, '1');
  assert.ok(q('#cf-hint-text').textContent.includes('Hint 1 of 3'));
  assert.ok(q('#cf-hint-text').textContent.includes('Compare the exporters names.'));
  assert.equal(qa('#cf-hint-text code').length, 1);
  assert.equal(q('#cf-hint').textContent.trim(), 'Hint 2 of 3');
  assert.ok(q('#cf-hint-tier').textContent.includes('1 of 3 used'));
  assert.equal(counts.mistakes, 0);
});

test('hint tiers advance 1, 2, 3 and stop: the label says No more hints once spent, a fourth click does nothing', () => {
  const { counts, mount } = setup(fixture({ helps: { hints: true } , hint: 'Compare.' }));
  mount();
  check(GIVEN);
  click('#cf-hint');
  click('#cf-hint');
  assert.ok(q('#cf-hint-text').textContent.includes('Hint 2 of 3'));
  assert.ok(q('#cf-hint-text').textContent.includes('In the answer, the traces pipeline lists 1 receiver, 1 processor and 1 exporter; yours lists 1 receiver, 0 processors and 1 exporter. One name yours lists under exporters is not defined under that exact id.'));
  assert.equal(q('#cf-hint-text').textContent.includes('batch'), false, 'the shape, never the ids');
  assert.equal(counts.hints, 2);
  assert.equal(counts.done, 0);
  assert.equal(q('#cf-hint').textContent.trim(), 'Hint 3 of 3');
  click('#cf-hint');
  assert.equal(counts.hints, 3);
  assert.equal(q('#cf-hint').textContent.trim(), 'Hint');
  assert.equal(q('#cf-hint').disabled, true);
  q('#cf-hint').disabled = false;
  click('#cf-hint');
  assert.equal(counts.hints, 3, 'no fourth charge');
});

test('without an authored hint tier 1 is the default rule', () => {
  const { mount } = setup(fixture({ helps: { hints: true } }));
  mount();
  click('#cf-hint');
  assert.ok(q('#cf-hint-text').textContent.includes(CONFIGURE_RULE));
});

test('hint tier 3 fills the reference in and Checks it without a mistake: neutral, success card, three hints charged, Check spent', () => {
  const { counts, focus, swirled, mount } = setup(fixture(HELPS));
  mount();
  click('#cf-hint');
  click('#cf-hint');
  assert.equal(q('#cf-input').value, GIVEN);
  click('#cf-hint');
  assert.equal(q('#cf-input').value, REF);
  assert.equal(counts.hints, 3);
  assert.equal(counts.mistakes, 0);
  assert.equal(counts.done, 1);
  assert.equal(tone(), 'neutral');
  assert.ok(feedback().startsWith('Filled in for you. The names must match, exactly.'), feedback());
  assert.equal(stateOf('traces'), 'Flowing');
  assert.equal(q('#cf-input').readOnly, true);
  assert.equal(q('#cf-check').disabled, true);
  assert.equal(q('#cf-win').hasAttribute('hidden'), false);
  assert.equal(q('#cf-win-stars').textContent, '2 of 5 stars: 0 failed Checks, 3 hints.');
  assert.equal(q('#cf-hint').disabled, true);
  assert.equal(swirled(), 1);
  assert.equal(focus.last(), '#cf-win-title');
});

test('the hint cost follows the failed Checks, and the success line counts both', () => {
  const { mount } = setup(fixture(HELPS));
  mount();
  check(GIVEN);
  assert.equal(q('#cf-hint-cost').textContent, 'costs 1 penalty');
  check(`${GIVEN}zz: 1\n`);
  assert.equal(q('#cf-wrong-label').textContent, 'failed Checks');
  check(`${GIVEN}yy: 1\n`);
  assert.equal(q('#cf-hint-cost').textContent, 'costs 1 penalty, no star yet');
  click('#cf-hint');
  check(REF);
  assert.equal(q('#cf-win-stars').textContent, '2 of 5 stars: 3 failed Checks, 1 hint.');
});

test('Escape on the shown hint is handled and moves focus to the Hint button while one is left (#178)', () => {
  const { focus, mount } = setup(fixture(HELPS));
  mount();
  click('#cf-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#cf-hint-text').onkeydown(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(focus.last(), '#cf-hint');
  assert.deepEqual(focus.unfocusable(), []);
});

test('after tier 3 solves the step the Hint button is spent, so Escape on the hint goes to the read-only textarea', () => {
  const { focus, mount } = setup(fixture(HELPS));
  mount();
  click('#cf-hint');
  click('#cf-hint');
  click('#cf-hint');
  const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  q('#cf-hint-text').onkeydown(e);
  assert.equal(focus.last(), '#cf-input');
});

test('the Configure it markup emits no retired class, no style attribute and no Alpine attribute', () => {
  const { mount } = setup(fixture(HELPS));
  mount();
  check(GIVEN);
  const html = q('[data-configure]').outerHTML;
  const classes = new Set(qa('[data-configure], [data-configure] *').flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)));
  for (const c of ['btn', 'ghost', 'info', 'show', 'small', 'feedback', 'configure-input', 'configure-note', 'configure-label']) {
    assert.equal(classes.has(c), false, c);
  }
  assert.equal([...classes].some((c) => c.startsWith('configure')), false);
  assert.equal(/\sstyle=|\sx-|\s@|\s:[a-z]|\son[a-z]+=/.test(html), false);
});

test('when tier 3 cannot finish (the checker fails) the ladder is spent: the label says No more hints and the button is disabled', () => {
  const { counts, mount } = setup(fixture(HELPS), { mount: { check: () => { throw new Error('boom'); } } });
  mount();
  click('#cf-hint');
  click('#cf-hint');
  click('#cf-hint');
  assert.equal(counts.hints, 3);
  assert.equal(counts.done, 0);
  assert.equal(q('#cf-hint').textContent.trim(), 'No more hints');
  assert.equal(q('#cf-hint').disabled, true);
  assert.equal(q('#cf-hint-cost').hasAttribute('hidden'), true);
});

test('a Collector that would not start for a reason outside every pipeline says so in the Pipelines panel', () => {
  const NOTE = 'The problem is outside the pipelines: see the list above.';
  const html = (text) => pipelinesHtml(checkConfig(text, SCHEMAS.collector), SCHEMAS.collector, escapeHtml);
  const outside = REF + '  extensions: [health_check]\n';
  assert.equal(html(outside).includes(NOTE), true, 'service.extensions names an undefined extension');
  assert.equal(html(REF).includes(NOTE), false, 'a flowing config has nothing to point at');
  assert.equal(html(REF.replace('[otlp/dash0]', '[nope]')).includes(NOTE), false, 'the problem is inside the pipeline');
});

test('the YAML editor keeps its indentation (no soft wrap) and grows to its lines (#321)', () => {
  const given = Array.from({ length: 20 }, (_, i) => `k${i}: v`).join('\n');
  const { dom, mount } = setup({ ...fixture(), given });
  mount();
  const input = dom.body.querySelector('#cf-input') ?? dom.body.querySelector('textarea');
  assert.equal(input.hasAttribute('wrap'), false);
  assert.equal(input.getAttribute('rows'), '20');
});

test('a hint fill regrows the editor to the filled config (#326)', () => {
  const { mount } = setup(fixture(HELPS));
  mount();
  assert.equal(q('#cf-input').getAttribute('rows'), '12');
  click('#cf-hint');
  click('#cf-hint');
  click('#cf-hint');
  assert.equal(q('#cf-input').value, REF);
  assert.equal(q('#cf-input').getAttribute('rows'), String(REF.split('\n').length));
});
