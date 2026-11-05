// Declarative levels (docs/DECLARATIVE-LEVELS.md §3-§5): lib/play.mjs, the registry's `play`
// key and the suite generated from every play level's data. Plays the live play levels plus
// test/fixtures/play-level.mjs; the harness checks at the end that it ran at least one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { STEP_DRIVERS, stepsOf } from './helpers/step-drivers.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { validateChoiceSpec } from '../lib/widgets/choice.mjs';
import { RESERVED, runPlay, STEP_TYPES, validatePlay } from '../lib/play.mjs';
import { buildRegistry, RegistryError, validateRegistry } from '../lib/registry.mjs';
import { liveRegistry } from '../app.mjs';
import { playFixture, FIXTURE_CARD } from './fixtures/play-level.mjs';
import { logsSpec } from './fixtures/build-logs.mjs';

const NOW = 1767225600000;
const KIT = { validatePlay, runPlay };
const ID = 'play-fixture';
const AT = `level "${ID}"`;
const act = (levels) => [{ id: 'a', no: 0, levels, boss: null }];
const build = (lv, extra = {}) => buildRegistry(act([lv]), { deck: [FIXTURE_CARD], nodeIds: [], play: KIT, ...extra });
const errorsOf = (lv, extra = {}) => validateRegistry(act([lv]), { cardIds: [FIXTURE_CARD.id], nodeIds: [], play: KIT, ...extra }).errors;

const FX = build(playFixture()).levels[ID];
const LEVELS = [...Object.values(liveRegistry().levels).filter((l) => l.play), FX];
let ran = 0;

/** Start `level` with the real ctx on a fresh DOM (stub shuffle keeps spec order). */
function start(level) {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const calls = [];
  const ctx = createLevelContext({
    level, ovBody: dom.body, ovActions: dom.actions, now: () => NOW, shuffle: (a) => a, reduceMotion: true,
    onFinish: (id, result) => calls.push({ id, result }), signal: new AbortController().signal,
    reportError: (e) => { throw e; },
  });
  level.run(ctx);
  return { focus, calls };
}

const prefixOf = (level) => level.play.prefix ?? level.id;
const advanceId = (level, i) => `#${prefixOf(level)}-${i === level.play.steps.length - 1 ? 'finish' : 'next'}`;
const text = (sel) => q(sel).textContent;

/** Play every step cleanly, calling `during(i, entry)` before step i is solved. */
function playAll(level, during = () => {}, run = start(level)) {
  const steps = stepsOf(level);
  steps.forEach((entry, i) => {
    during(i, entry, run);
    for (const sel of entry.driver.solve(entry.spec)) click(sel);
    click(advanceId(level, i));
  });
  return run;
}

const stars = (level) => (level.scored ? 5 : 0);
/** The step types with a side column (a wide split and a success card). */
const SIDE = ['sort', 'build', 'incident'];

for (const level of LEVELS) {
  const steps = stepsOf(level);
  const last = steps.length - 1;

  test(`${level.id}: every step passes its type's validate`, () => {
    assert.deepEqual(validatePlay(level.play).errors, []);
    for (const { type, spec } of steps) assert.deepEqual(type.validate(spec), []);
    ran += 1;
  });

  test(`${level.id}: a clean run finishes once, from the Finish click, with every card`, () => {
    const { calls } = playAll(level, (i, entry, run) => assert.equal(run.calls.length, 0, `step ${i + 1} is not the end`));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, level.id);
    assert.equal(calls[0].result.stars, stars(level));
    assert.deepEqual(calls[0].result.cards, level.cards);
    assert.equal(calls[0].result.text, level.play.finish);
    ran += 1;
  });

  test(`${level.id}: Next and Finish stay disabled until the step is solved`, () => {
    playAll(level, (i) => {
      assert.equal(q(advanceId(level, i)).disabled, true, `step ${i + 1} starts gated`);
      assert.equal(q(advanceId(level, i)).hasAttribute('data-finish'), i === last);
    });
    start(level);
    const [{ driver, spec }] = steps;
    for (const sel of driver.solve(spec)) click(sel);
    assert.equal(q(advanceId(level, 0)).disabled, false, 'solved: enabled');
    ran += 1;
  });

  test(`${level.id}: the focus walk starts each step on its first control and ends on Finish`, () => {
    const { focus } = start(level);
    steps.forEach(({ key, driver, spec }, i) => {
      const before = i === 0 ? 0 : focus.names().length;
      if (i > 0) click(advanceId(level, i - 1));
      assert.equal(focus.names()[before], driver.first(spec), `step ${i + 1} starts here`);
      for (const sel of driver.solve(spec)) click(sel);
      // A solved Build it step, incident board or Sort it step focuses its success heading (#146, #143, #156); its Next is enabled.
      const handOff = SIDE.includes(key) ? `#${spec.id}-win-title` : advanceId(level, i);
      assert.equal(focus.last(), handOff, `step ${i + 1} hands off to its button`);
      assert.equal(q(advanceId(level, i)).disabled, false, `step ${i + 1} opens its button`);
    });
    assert.deepEqual(focus.unfocusable(), []);
    assert.equal(focus.names().includes('body'), false);
    ran += 1;
  });

  steps.forEach(({ key, driver, spec }, at) => {
    for (const slip of driver.slips(spec)) {
      test(`${level.id}: step ${at + 1} (${key}) slip "${slip.name}" alone costs exactly one star`, () => {
        const { calls } = playAll(level, (i) => {
          if (i !== at) return;
          for (const sel of slip.clicks) click(sel);
          assert.match(text(slip.at ?? `#${spec.id}-feedback`), slip.says);
        });
        assert.equal(calls[0].result.stars, level.scored ? 4 : 0);
        ran += 1;
      });
      if (slip.name === 'check') {
        test(`${level.id}: step ${at + 1} a repeated Check on the same state is free`, () => {
          const { calls } = playAll(level, (i) => {
            if (i !== at) return;
            for (const sel of [...slip.clicks, ...slip.clicks]) click(sel);
            assert.match(text(`#${spec.id}-feedback`), /^Same as last time:/);
          });
          assert.equal(calls[0].result.stars, level.scored ? 4 : 0);
          ran += 1;
        });
      }
    }
  });

  test(`${level.id}: a second clean run starts at step 1 and scores the same`, () => {
    assert.equal(playAll(level).calls[0].result.stars, stars(level));
    const second = start(level);
    assert.equal(second.focus.names()[0], steps[0].driver.first(steps[0].spec));
    assert.equal(qa('[data-finish]').length, 0, 'starts on a step that is not the last');
    assert.equal(playAll(level, () => {}, second).calls[0].result.stars, stars(level));
    ran += 1;
  });
}

test('the suite played at least one level', () => {
  assert.ok(LEVELS.length >= 1);
  assert.ok(ran >= 1, `ran ${ran} generated tests`);
});

test('every step type has a driver and every driver a step type', () => {
  assert.deepEqual(Object.keys(STEP_DRIVERS).sort(), Object.keys(STEP_TYPES).sort());
});

test('code is plain text: an <img onerror> in it renders escaped', () => {
  const lv = playFixture();
  const injected = '<img src=x onerror=alert(1)>';
  lv.play.steps[0].code = injected;
  start(build(lv).levels[ID]);
  assert.equal(qa('img').length, 0);
  assert.equal(text('pre code'), injected);
});

// ---- T12 (#158): the step frame comes from the kit; the step type decides its width -------

test('P3 T12 every step type says whether its step is wide; Sort it, Build it and the incident board are the wide ones', () => {
  for (const [key, type] of Object.entries(STEP_TYPES)) assert.equal(typeof type.wide, 'boolean', `${key}.wide`);
  assert.deepEqual(Object.keys(STEP_TYPES).filter((k) => STEP_TYPES[k].wide), SIDE);
});

test('T12 each step renders one kit step, wide by its type: a sort, build or incident step holds the board and its side column', () => {
  const seen = [];
  playAll(FX, (i, { key }) => {
    const wide = STEP_TYPES[key].wide;
    seen.push(key);
    assert.equal(qa('.ui-step').length, 1, `step ${i + 1} (${key}) is one kit step`);
    assert.equal(qa('.ui-step--wide').length, wide ? 1 : 0, `step ${i + 1} (${key}) width`);
    assert.equal(qa('.ui-actions--wide').length, wide ? 1 : 0, `step ${i + 1} (${key}) actions width`);
    assert.equal(qa('.ui-step .ui-lesson').length, 1, `step ${i + 1} (${key}) opens with the lesson card`);
    assert.equal(qa('.ui-step .ui-question').length, FX.play.steps[i].question == null ? 0 : 1, `step ${i + 1} (${key}) question`);
    if (SIDE.includes(key)) {
      assert.equal(qa('.ui-step--wide .ui-split').length, 1, `${key}: the board and side column split inside the wide step`);
      assert.equal(qa('.ui-split-side [id$="-win"]').length, 1, `${key}: the side column holds the success card`);
    }
  });
  assert.deepEqual(['sort', 'build', 'incident', 'choice'].every((k) => seen.includes(k)), true);
});

const HOW = 'ol[aria-label="How this board works"]';

test('P1 an incident step\'s lesson card is its scenario line, then the generic How this board works list; no other step has it', () => {
  const lists = [];
  playAll(FX, (i, { key, spec }) => {
    const card = q('.ui-step .ui-lesson');
    if (key !== 'incident') {
      assert.equal(qa(HOW).length, 0, `step ${i + 1} (${key}) has no board list`);
      return;
    }
    assert.equal(card.textContent.trim().startsWith(FX.play.steps[i].intro), true, 'the scenario line opens the card');
    assert.equal(qa(`.ui-lesson ${HOW}`).length, 1, 'the list is inside the lesson card');
    const items = qa(`${HOW} > li`).map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    assert.equal(items.length, 3);
    ['Investigate', 'Unlock the causes', 'Name the cause'].forEach((name, n) => assert.equal(items[n].includes(name), true, items[n]));
    const t = card.textContent;
    for (const v of spec.views) assert.equal(t.includes(v.label), false, `the lesson does not name the view ${v.label}`);
    for (const h of spec.hypotheses) assert.equal(t.includes(h.label), false, `nor the cause ${h.label}`);
    lists.push(q(HOW).outerHTML);
  });
  assert.equal(lists.length, 1, 'the fixture has one incident step');
  for (const level of LEVELS.filter((l) => l.play.steps[0].incident)) {
    start(level);
    assert.equal(q(HOW)?.outerHTML, lists[0], `${level.id}: the same list on every incident board`);
  }
});

test('a step\'s show is its lead-in prose: after the lesson card, before the question, and only on that step', () => {
  const lv = playFixture();
  lv.play.steps[0].show = 'Lead-in <em>before</em> the pick.';
  const level = build(lv).levels[ID];
  const run = start(level);
  const leads = qa('.ui-step .ui-prose').filter((el) => !el.closest('.ui-lesson'));
  assert.equal(leads.length, 1, 'one lead-in on the step with show');
  assert.equal(leads[0].innerHTML, 'Lead-in <em>before</em> the pick.');
  const order = qa('.ui-step .ui-lesson, .ui-step .ui-prose, .ui-step .ui-question')
    .filter((el) => el.matches('.ui-lesson, .ui-question') || !el.closest('.ui-lesson'))
    .map((el) => (el.matches('.ui-lesson') ? 'lesson' : el.matches('.ui-question') ? 'question' : 'show'));
  assert.deepEqual(order, ['lesson', 'show', 'question']);
  for (const sel of STEP_DRIVERS.choice.solve(level.play.steps[0].choice)) click(sel);
  click(advanceId(level, 0));
  assert.equal(qa('.ui-step .ui-prose').filter((el) => !el.closest('.ui-lesson')).length, 0, 'step 2 has no show, so no lead-in');
  assert.equal(run.calls.length, 0);
});

test('the step frame: Next and Finish are the kit primary buttons, the question carries its id', () => {
  start(FX);
  assert.equal(q('#fx-next').getAttribute('type'), 'button');
  assert.equal(q('#fx-next').classList.contains('ui-btn--primary'), true);
  assert.equal(q('#fx-pick-q').textContent, 'Pick one.');
  assert.equal(q('#fx-pick-choices').getAttribute('aria-labelledby'), 'fx-pick-q');
});

test('lib/play.mjs never charges a penalty itself (PI1)', () => {
  const src = readFileSync(new URL('../lib/play.mjs', import.meta.url), 'utf8');
  assert.equal(/mistake\(|hint\(/.test(src), false);
});

// ---- registry: the play key ----------------------------------------------------

test('a play level derives its mechanics in order of first appearance', () => {
  assert.deepEqual([...FX.mechanics], ['sort', 'build', 'incident', 'spot', 'tradeoff', 'query', 'configure']);
  assert.equal(validatePlay(playFixture().play).mechanics.join(), 'sort,build,incident,spot,tradeoff,query,configure');
});

test('a declared mechanics list that equals the derived one is accepted', () => {
  const lv = { ...playFixture(), mechanics: ['sort', 'build', 'incident', 'spot', 'tradeoff', 'query', 'configure'] };
  assert.deepEqual([...build(lv).levels[ID].mechanics], ['sort', 'build', 'incident', 'spot', 'tradeoff', 'query', 'configure']);
});

test('registry errors for run and play together, no kit, differing mechanics, a function', () => {
  assert.deepEqual(errorsOf({ ...playFixture(), run() {} }), [`${AT}: declares both run and play; use one`]);
  assert.deepEqual(errorsOf(playFixture(), { play: undefined }), [`${AT}: play needs the step kit (buildRegistry option "play")`]);
  assert.deepEqual(errorsOf({ ...playFixture(), mechanics: ['build'] }), [
    `${AT}: declares mechanics ["build"] but its steps give ["sort","build","incident","spot","tradeoff","query","configure"]; fix or remove mechanics`,
  ]);
  const lv = playFixture();
  lv.play.steps[0].choice.choices[0].why = () => 'x';
  assert.deepEqual(errorsOf(lv), [
    `${AT}: play must be plain data: steps[0].choice.choices[0].why is a function; write run(ctx) for custom behaviour`,
  ]);
});

test('two bad steps are two errors, not one', () => {
  const lv = playFixture();
  lv.play.steps = [{ intro: 'x' }, { intro: 'y', choice: lv.play.steps[0].choice, sort: lv.play.steps[1].sort }];
  assert.deepEqual(errorsOf(lv), [
    `${AT}: step 1 has no step type (one of choice, sort, build, incident, spot, tradeoff, query, configure)`,
    `${AT}: step 2 has two step types ("choice", "sort")`,
  ]);
  assert.throws(() => build(lv), RegistryError);
});

test('the built play is a frozen copy: mutating the source cannot reach it', () => {
  const src = playFixture();
  const built = build(src).levels[ID];
  assert.equal(Object.isFrozen(built.play), true);
  assert.equal(Object.isFrozen(built.play.steps[0].choice.choices[0]), true);
  assert.equal(Object.isFrozen(src.play), false);
  src.play.steps[0].intro = 'changed';
  src.play.finish = 'changed too, and long enough';
  assert.notEqual(built.play.steps[0].intro, 'changed');
  assert.notEqual(built.play.finish, src.play.finish);
});

test('a run level keeps play null', () => {
  const run = { id: 'r', no: '0.2', name: 'R', icon: '*', rewardTitle: 'R', mechanics: ['sort'], run() {} };
  assert.equal(build(run).levels.r.play, null);
});

test('the live registry passes the kit, so it builds play levels', () => {
  const reg = liveRegistry(act([playFixture()]), [FIXTURE_CARD]);
  assert.deepEqual([...reg.levels[ID].mechanics], ['sort', 'build', 'incident', 'spot', 'tradeoff', 'query', 'configure']);
});

// ---- validatePlay: the author-facing messages (§5) ------------------------------

/** validatePlay errors for the fixture after `edit(play)`. */
function problems(edit) {
  const lv = playFixture();
  edit(lv.play);
  return validatePlay(lv.play).errors;
}

test('validatePlay names each problem as the design says', () => {
  const cases = [
    [(p) => { p.steps[1].inrto = 'x'; }, 'step 2: unknown key "inrto" (did you mean "intro"?)'],
    [(p) => { p.steps[2] = { intro: 'x', configure: {} }; }, 'step 3 (configure "?"): unknown schema undefined (one of collector)'],
    [(p) => { p.steps[0].choice.choices[1].right = false; }, 'step 1 (choice "fx-pick"): needs exactly one right answer, has 0'],
    [(p) => { p.steps[1].sort.items[0].bucket = 'automatic'; }, 'step 2 (sort "fx-sort"): item "server": unknown bucket "automatic"'],
    [(p) => { p.steps[2].build.answer = {}; }, 'step 3 (build "fx-tree"): the given state already passes Check, so there is nothing to do'],
    [(p) => { p.steps[1].sort.id = 'fx-pick'; }, 'step 2: widget id "fx-pick" is already used by step 1'],
    [(p) => { p.finish = 'short'; }, 'play.finish must be reward text longer than 10 characters'],
    [(p) => { p.prefix = 'no spaces'; }, 'play.prefix must be a plain token'],
    [(p) => { delete p.steps[0].intro; }, 'step 1: intro must be text'],
    [(p) => { delete p.steps[0].question; }, 'step 1 (choice "fx-pick"): needs a question'],
    [(p) => { p.steps[3].show = 5; }, 'step 4: show must be a string'],
    [(p) => { p.steps[0].qid = p.steps[1].qid = 'same'; }, 'step 2: heading id "same" is already used by step 1'],
    [(p) => { p.steps = []; }, 'play.steps must be a non-empty array'],
    [(p) => { p.stpes = []; }, 'unknown key "stpes" on play (did you mean "steps"?)'],
    [(p) => { p.steps[5].tradeoff.knobs[0].options[0].cst = 3; }, 'step 6 (tradeoff "fx-budget"): unknown key "cst" on option "head" of knob "sampling" (did you mean "cost"?)'],
    [(p) => { p.steps[5].tradeoff.knobz = []; }, 'step 6 (tradeoff "fx-budget"): unknown key "knobz" on spec (did you mean "knobs"?)'],
    [(p) => { p.steps[5].tradeoff.cap = 100; }, 'step 6 (tradeoff "fx-budget"): trade-off: every plan that keeps every need fits the cap, so the cap never bites'],
    [(p) => { p.steps[5].tradeoff.answer.attrs = 'user'; }, 'step 6 (tradeoff "fx-budget"): answer: the reference plan is over the cap by 5'],
    [(p) => { delete p.steps[5].question; }, 'step 6 (tradeoff "fx-budget"): needs a question'],
  ];
  for (const [edit, want] of cases) {
    const got = problems(edit);
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
});

test('validatePlay names each query step problem, with the step and widget id', () => {
  const cases = [
    [(p) => { p.steps[6].query.referense = 'x'; }, 'step 7 (query "fx-query"): unknown key "referense" on spec (did you mean "reference"?)'],
    [(p) => { p.steps[6].query.dataset = 'nope'; }, 'step 7 (query "fx-query"): unknown dataset "nope" (one of checkout-http, checkout-spanmetrics)'],
    [(p) => { p.steps[6].query.reference = 'sum(('; }, 'step 7 (query "fx-query"): reference does not give data: {"kind":"syntax"'],
    [(p) => { p.steps[6].query.given = 'sum without (route, status) (rate(http_server_requests_total[5m]))'; }, 'step 7 (query "fx-query"): given already passes, so there is nothing to do'],
    [(p) => { delete p.steps[6].question; }, 'step 7 (query "fx-query"): needs a question'],
    [(p) => { p.steps[6].query.id = 'fx-pick'; }, 'step 7: widget id "fx-pick" is already used by step 1'],
  ];
  for (const [edit, want] of cases) {
    const got = problems(edit);
    assert.ok(got.some((e) => e.startsWith(want)), `${want}\n  got: ${JSON.stringify(got)}`);
  }
});

test('a query step may carry a given starting query', () => {
  assert.deepEqual(problems((p) => { p.steps[6].query.given = 'http_server_requests_total'; }), []);
});

test('validatePlay names each configure step problem, with the step and widget id', () => {
  const cases = [
    [(p) => { p.steps[7].configure.referense = 'x'; }, 'step 8 (configure "fx-config"): unknown key "referense" on spec (did you mean "reference"?)'],
    [(p) => { p.steps[7].configure.schema = 'nope'; }, 'step 8 (configure "fx-config"): unknown schema "nope" (one of collector)'],
    [(p) => { p.steps[7].configure.reference = p.steps[7].configure.given; }, 'step 8 (configure "fx-config"): reference: service.pipelines.traces.exporters[0]: "otlp/dash0x" is not defined under exporters or connectors'],
    [(p) => { p.steps[7].configure.given = p.steps[7].configure.reference; }, 'step 8 (configure "fx-config"): given: already passes the checker, so there is nothing to fix'],
    [(p) => { p.steps[7].configure.target = ['metrics']; }, 'step 8 (configure "fx-config"): target "metrics": the reference has no flowing pipeline with that name'],
    [(p) => { delete p.steps[7].question; }, 'step 8 (configure "fx-config"): needs a question'],
    [(p) => { p.steps[7].configure.id = 'fx-pick'; }, 'step 8: widget id "fx-pick" is already used by step 1'],
  ];
  for (const [edit, want] of cases) {
    const got = problems(edit);
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
});

test('a configure step may leave out the target and the hint', () => {
  assert.deepEqual(problems((p) => { delete p.steps[7].configure.target; delete p.steps[7].configure.hint; }), []);
});

test('no step type is reserved any more: configure is live', () => {
  assert.deepEqual(Object.keys(RESERVED), []);
  assert.equal(typeof STEP_TYPES.configure.mount, 'function');
  assert.equal(STEP_TYPES.configure.mechanic, 'configure');
});

test('a build whose answer fails checkBuild names the issue', () => {
  const got = problems((p) => { p.steps[2].build.spans[0].traceId = '0af7651916cd43dd8448eb211c80319c'; });
  assert.ok(got.some((e) => /^step 3 \(build "fx-tree"\): answer does not pass checkBuild: cross-trace-parent aaaaaaaaaaaaaaa2/.test(e)), JSON.stringify(got));
});

test('only choice steps is an error at registry level', () => {
  const lv = playFixture();
  lv.play.steps = [lv.play.steps[0]];
  assert.deepEqual(errorsOf(lv), [`${AT}: play.steps has only choice steps; a level needs at least one mechanic step`]);
});

test('validatePlay never throws, whatever it is given', () => {
  const cyclic = { steps: [] };
  cyclic.steps.push(cyclic);
  for (const v of [undefined, null, 3, 'x', [], {}, cyclic, { steps: [null, 4, []] }, { steps: [{ intro: 'x', sort: null }] }, { get steps() { throw new Error('boom'); } }]) {
    const r = validatePlay(v);
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0, JSON.stringify(r));
  }
});

// ---- sparse arrays and unknown widget keys ---------------------------------------

test('a hole in an array is not plain data, whether in steps or in choices', () => {
  const steps = playFixture();
  delete steps.play.steps[1];
  assert.deepEqual(errorsOf(steps), [`${AT}: play must be plain data: steps[1] is a hole in an array; write run(ctx) for custom behaviour`]);
  const choices = playFixture();
  delete choices.play.steps[0].choice.choices[2];
  assert.deepEqual(errorsOf(choices), [
    `${AT}: play must be plain data: steps[0].choice.choices[2] is a hole in an array; write run(ctx) for custom behaviour`,
  ]);
});

test('validateChoiceSpec reports a hole instead of skipping it', () => {
  const choices = [{ key: 'a', why: 'x', right: true }, { key: 'b', why: 'y' }, { key: 'c', why: 'z' }];
  delete choices[2];
  assert.ok(validateChoiceSpec(choices).includes('choice 2 is not an object'));
});

test('an unknown key in a widget spec is named, with a hint when close', () => {
  const cases = [
    [(p) => { p.steps[0].choice.extra = 1; }, 'step 1 (choice "fx-pick"): unknown key "extra" on spec'],
    [(p) => { p.steps[1].sort.bogus = 1; }, 'step 2 (sort "fx-sort"): unknown key "bogus" on spec'],
    [(p) => { p.steps[1].sort.items[0].bucktet = 'auto'; }, 'step 2 (sort "fx-sort"): unknown key "bucktet" on item "server" (did you mean "bucket"?)'],
    [(p) => { p.steps[1].sort.buckets[0].lable = 'x'; }, 'step 2 (sort "fx-sort"): unknown key "lable" on bucket "auto" (did you mean "label"?)'],
    [(p) => { const b = p.steps[2].build; b.hin = b.hint; delete b.hint; }, 'step 3 (build "fx-tree"): unknown key "hin" on spec (did you mean "hint"?)'],
    [(p) => { p.steps[2].build.spans[0].serivce = 'x'; }, 'step 3 (build "fx-tree"): unknown key "serivce" on span 0 (did you mean "service"?)'],
    [(p) => { p.steps[2].build.answer.aaaaaaaaaaaaaaa2.kidn = 'SERVER'; }, 'step 3 (build "fx-tree"): unknown key "kidn" on answer aaaaaaaaaaaaaaa2 (did you mean "kind"?)'],
    [(p) => { p.steps[3].incident.answerAfterView = 2; }, 'step 4 (incident "checkout-slow"): unknown key "answerAfterView" on spec (did you mean "answerAfterViews"?)'],
    [(p) => { p.steps[3].incident.views[0].costMn = 1; }, 'step 4 (incident "checkout-slow"): unknown key "costMn" on view "traces" (did you mean "costMin"?)'],
    [(p) => { p.steps[3].incident.hypotheses[0].wy = 1; }, 'step 4 (incident "checkout-slow"): unknown key "wy" on hypothesis "slow-query" (did you mean "why"?)'],
    [(p) => { p.steps[3].incident.alert.titel = 'x'; }, 'step 4 (incident "checkout-slow"): unknown key "titel" on alert (did you mean "title"?)'],
    [(p) => { p.steps[3].incident.budget.startPc = 1; }, 'step 4 (incident "checkout-slow"): unknown key "startPc" on budget (did you mean "startPct"?)'],
  ];
  for (const [edit, want] of cases) {
    const got = problems(edit);
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
});

test('validatePlay names a configure step uses problem, and a step may leave uses out', () => {
  const cases = [
    [(p) => { p.steps[7].configure.uses = { traces: ['memory_limiter'] }; }, 'step 8 (configure "fx-config"): uses "traces": the reference does not list "memory_limiter"'],
    [(p) => { p.steps[7].configure.uses = { traces: [] }; }, 'step 8 (configure "fx-config"): uses "traces" must be a non-empty list of component ids'],
  ];
  for (const [edit, want] of cases) {
    const got = problems(edit);
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(problems((p) => { delete p.steps[7].configure.uses; }), []);
});

// logs mode (#113): the core (phase A) and the view (phase B) exist; the fixture's step 9 is a logs step

test('P1 a logs-mode build step is accepted in levels; mixing it with span fields is still refused', () => {
  const got = problems((p) => { p.steps.push({ intro: 'Attach the logs.', build: logsSpec() }); });
  assert.deepEqual(got, []);
  const mixed = problems((p) => { p.steps.push({ intro: 'Attach the logs.', build: { ...logsSpec(), edit: ['logs', 'parent'] } }); });
  assert.equal(mixed.filter((e) => e.includes('logs is its own mode')).length, 1);
  assert.equal(mixed.some((e) => e.includes('not available in levels yet')), false);
});

test('P2 logs-mode keys are checked: a typo on the spec or a record is named', () => {
  const cases = [
    [(b) => { b.explan = 'x'; }, 'unknown key "explan" on spec (did you mean "explain"?)'],
    [(b) => { b.logz = []; }, 'unknown key "logz" on spec (did you mean "logs"?)'],
    [(b) => { b.logs[0].bdy = 'x'; }, 'unknown key "bdy" on log 0 (did you mean "body"?)'],
    [(b) => { b.logs[1].timeM = 1; }, 'unknown key "timeM" on log 1 (did you mean "timeMs"?)'],
  ];
  for (const [edit, tail] of cases) {
    const got = problems((p) => { const b = logsSpec(); edit(b); p.steps.push({ intro: 'x', build: b }); });
    const want = `step 10 (build "l1"): ${tail}`;
    assert.ok(got.includes(want), `${want}\n  got: ${JSON.stringify(got)}`);
  }
});

test('#146 a build step may declare its helps and a closing line; bad helps are refused with the view\'s message', () => {
  assert.deepEqual(problems((p) => { p.steps[2].build.helps = { hints: true, instant: true }; p.steps[2].build.closing = 'Done.'; }), []);
  assert.deepEqual(problems((p) => { p.steps[2].build.helps = { hints: 'yes' }; }), ['step 3 (build "fx-tree"): helps: "hints" is not true or false']);
  assert.deepEqual(problems((p) => { p.steps[2].build.closing = ''; }), ['step 3 (build "fx-tree"): closing: not non-empty text']);
});

test('19 #156 a sort step may declare its helps and a hint; a typo is named with a did-you-mean; bad helps are refused with the widget\'s message', () => {
  assert.deepEqual(problems((p) => { p.steps[1].sort.helps = { hints: true }; p.steps[1].sort.hint = 'Ask what shape the data has.'; }), []);
  assert.deepEqual(problems((p) => { p.steps[1].sort.helps = { hints: false }; }), []);
  assert.deepEqual(problems((p) => { p.steps[1].sort.helpz = { hints: true }; }),
    ['step 2 (sort "fx-sort"): unknown key "helpz" on spec (did you mean "helps"?)']);
  assert.deepEqual(problems((p) => { p.steps[1].sort.hnit = 'x'; }),
    ['step 2 (sort "fx-sort"): unknown key "hnit" on spec (did you mean "hint"?)']);
  assert.deepEqual(problems((p) => { p.steps[1].sort.helps = { hints: 'yes' }; }), ['step 2 (sort "fx-sort"): helps: "hints" is not true or false']);
  assert.deepEqual(problems((p) => { p.steps[1].sort.hint = 'Never shown.'; }), ['step 2 (sort "fx-sort"): hint: shown only when helps.hints is on']);
});
