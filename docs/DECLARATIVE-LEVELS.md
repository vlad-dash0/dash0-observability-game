# Declarative levels (#71)

Design for M2's first item (OUTLINE §8). It builds on FOUNDATION §2 and §3 and on M1-DESIGN §1 and §4. Where they differ, this file governs only the new `play` key and `lib/play.mjs`. Goal: once M2 ships, a new level is copy plus an answer table.

**Decisions (2026-10-31, defaults taken while the user was away; the user may override):** migrate 2.7 only in M2 (P4 if it stays mechanical); for new acts the level file is the source of truth plus a one-line-per-step `ANSWERS` key, and the design doc keeps concept, nuance, cards and spec URLs; 1.2's env checker stays hand-written until #3 decides. See §9.

## 1. What the levels share, and where they are bespoke

**Common case (8 of 13: 0.1, 0.2, 0.3, 2.1, 2.3, 2.5, 2.6, 2.7).** Each level is a straight sequence of steps. Each step does the following:
- Renders `<div class="lesson-intro">${ctx.speech(intro)}</div>`, then a `lesson-stage` with `<h3 class="q">` and one widget's render.
- Renders a disabled `#<prefix>-next`. On the last step it is a disabled `#<prefix>-finish` carrying `data-finish`.
- Calls `mountX(ctx, spec, {onComplete|onRight: () => (btn.disabled = false, btn)})`.
- Next renders the following step. Finish calls `ctx.finish({text, cards})`.

Evidence:
- In 2.7 the whole `run()` is this pattern three times: `levels/auto-vs-manual.mjs:117-196`, which is 80 of the file's 197 lines.
- Same pattern in `status-and-errors.mjs:82-137`, `monitoring-vs-observability.mjs:97-150` and `spans-and-traces.mjs:93-173`.
- Authors already began factoring it out: `the-signals.mjs:135-146` (`sortStep`), and the `next(onclick)` helper in `spans-and-traces.mjs:95-99`, `context-propagation.mjs:118-122` and `events-and-links.mjs:103-107`.

**The data is already declarative.** `CONTENT.steps` is `{sort}`, `{build}` or `{id, question, choices}` (`auto-vs-manual.mjs:98-104`, `span-kinds.mjs:72-74`). The tests pin it (`test/act-2.test.mjs:286-318`).

**Facts each level states twice today:**
- **Cards:** listed on the level and again in `finish`, always the same list. Examples: `auto-vs-manual.mjs:114` and `:191`; `status-and-errors.mjs:79` and `:132`; `span-kinds.mjs:90` and `:149`; `the-pager.mjs:53` and `:96`; `checkout-is-slow.mjs:153` and `:172`.
- **`mechanics`:** written by hand, and always equal to the non-choice widgets the level uses. No UI reads it; the only reader is `lib/registry.mjs`.

**Bespoke:**

| Level | What | Where | Consequence |
|---|---|---|---|
| 2.2 span-kinds | "Map edges" line, rewritten inside `onComplete` from `serviceEdges` | `span-kinds.mjs:77-80`, `:107`, `:114-121` | stays `run(ctx)` |
| 2.4 context-propagation | hop and root lists built from data with `escapeHtml`; `CONTENT.steps[0].hops/roots` pinned | `context-propagation.mjs:125-144`; `act-2.test.mjs:480-488` | can migrate with `show` (those two tests become string checks); optional, last |
| 2.6 events-and-links | an authored list of three short stories | `events-and-links.mjs:133`, `:140` | fits, via `show` |
| 1.2 naming-your-service | env editor, Check and hint written inline, with its own `lastFailed` (M1-DESIGN §2); choice id `nys` used twice | `naming-your-service.mjs:145-189`, `:107`, `:201` | stays `run(ctx)` until a configure step exists |
| the-pager | not a widget: looks, a plain-text budget, Escalate | `the-pager.mjs:57-98` | stays `run(ctx)` |
| checkout-is-slow | a plain Scenario plus 17 lines of standard wiring | `checkout-is-slow.mjs:40-136`, `:157-173` | fits: one `incident` step; optional |

## 2. The declarative level

A level file keeps today's metadata (FOUNDATION §2.1) and declares `play` instead of `run`. New levels omit `mechanics`.

| Field | Rule |
|---|---|
| `id`, `no`, `name`, `sub`, `icon`, `rewardTitle`, `cards`, `lights`, `scored`, `scoring` | unchanged (FOUNDATION §2.1) |
| `mechanics` | derived from the step types, in order of first appearance. Optional with `play`: if declared it must equal the derived list (registry error otherwise). Migrated levels keep it because existing tests read it from the raw export (`act-2.test.mjs:349`, `act-0.test.mjs:145`); new levels omit it |
| `run` | forbidden with `play`; required without it |
| `play.prefix` | optional plain token; default is `id`. Sets the button ids `<prefix>-next` and `<prefix>-finish` |
| `play.steps` | non-empty array of steps |
| `play.finish` | reward text, longer than 10 characters. Finish awards `level.cards`, never a separate list |

**A step** has exactly one type key holding that widget's spec, plus:
- `intro`: required. Trusted authored HTML, shown in the speech bubble.
- `question`: trusted HTML, rendered as `<h3 class="q" id="<widgetId>-q">`. Required for labelled types (choice, sort), optional otherwise.
- `show`: optional. Trusted authored HTML shown before the question (lists, tables).
- `code`: optional. Plain text, escaped, rendered in `<pre><code>`. Intended for env files, YAML and PromQL.
- `qid`: optional plain token, the question heading's id. Default `<widgetId>-q`. Migrated levels set it to keep today's hand-named ids (e.g. `avm-q-sort`).

**Step types:**

| Key | Spec | Mechanic | Status |
|---|---|---|---|
| `choice` | `{id, choices: [{key, label, why, right?}]}`, at least 2 choices | none | live (`choiceHtml`/`mountChoice`) |
| `sort` | SortSpec (M1-DESIGN §4.1) | sort | live |
| `build` | BuildSpec (§4.2) | build | live |
| `incident` | Scenario (§4.3) | incident | live |
| `configure` | reserved for #3, e.g. `{id, given, lang, checker: '<name>', target, hint?}` | configure | reserved |
| `query` | reserved for #4, e.g. `{id, dataset: '<name>', reference: '<query>'}`, graded by comparing result series | query | reserved |
| `spot` | SpotSpec (§4.4 of M1-DESIGN) | spot | live |
| `tradeoff` | reserved for #7 | tradeoff | reserved |

**Rule: data holds names; code holds the functions they name.** A checker, dataset or grader is a function in its widget module, registered by name; a level refers to it by an id string. `play` must be plain data: objects, arrays, strings, finite numbers, booleans and null. Values computed when the module loads are fine, because they are data by the time the registry sees them (e.g. checkout-is-slow's triage tables).

**What is declared where:**
- **Answers:** only inside the widget spec (`right: true`, `bucket`, `answer`, view `kind`, the right hypothesis).
- **Penalties:** never declared. Each type's `mount` is their only home (I1). Slips are derived from the spec (§4).
- **Cards and lights:** on the level.
- **Copy:** `intro`, `question`, `show`, and the widget labels and `why` text.
- **Spec URLs:** stay as `// Spec: <https URL>` comment lines, which `test/content.test.mjs:38-47` already enforces.

### Worked example: 2.7 `auto-vs-manual`

`SORT`, `WHY` and `FIX` stay byte-identical (`:11-95`). The header comment and Spec lines stay. `CONTENT` stays exported (existing tests import it, #71 AC4) but is **derived from `play`**, so every question and answer has one home and the pin reads exactly what the player sees. Imports used only by `run`, and `run` itself, go.

```js
const PLAY = { prefix: 'avm', steps: [ /* as below */ ], finish: '…' };
// Kept for the existing pins; derived from PLAY, never written by hand.
export const CONTENT = {
  steps: PLAY.steps.map((s) => s.choice ? { id: s.choice.id, question: s.question, choices: s.choice.choices } : s.sort ? { sort: s.sort } : { build: s.build }),
};
```

The level's default export then uses `play: PLAY`. The derivation must reproduce today's `CONTENT` shape exactly (the P3 empty-diff gate proves it).

```js
export default {
  id: 'auto-vs-manual', no: '2.7', name: 'Auto vs manual', sub: 'What the agent covers',
  icon: '\u{1F916}', rewardTitle: 'Hands-on instrumenter',
  cards: ['double-instrumentation'], lights: ['cart'],
  play: {
    prefix: 'avm',
    steps: [
      {
        intro: 'Cart runs with zero-code instrumentation, so it already emits spans. Some of what you want to see in them comes with that, and some only your own code can add.',
        question: 'Pick an item, then say whether it comes automatically or needs your code.',
        qid: 'avm-q-sort', sort: SORT,
      },
      {
        intro: 'Now cart\'s traces look wrong: each outgoing <code>fetch</code> call shows two CLIENT spans. The operator injects <code>NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register</code> into the pod, and cart\'s own <code>tracing.js</code> starts a NodeSDK with <code>getNodeAutoInstrumentations()</code>.',
        question: 'Why does each fetch call show two CLIENT spans?',
        qid: 'avm-q-why', choice: { id: 'avm-why', choices: WHY },
      },
      {
        intro: 'Cart still needs spans for <code>applyLoyaltyDiscount()</code> and the coupon, which no agent can add for you.',
        question: 'What is the fix?',
        qid: 'avm-q-fix', choice: { id: 'avm-fix', choices: FIX },
      },
    ],
    finish: 'You know what zero-code instrumentation covers, and that a second setup can double some spans. Run one and add business spans through the API.',
  },
};
```

The registry derives `mechanics` as `['sort']`, which matches today's pin (`act-2.test.mjs:218`).

### Worked example: 2.1 `spans-and-traces` (choice, build, choice)

`ONE_TRACE`, `TREE` and `OTHER` are unchanged.

```js
play: {
  prefix: 'sat',
  steps: [
    { intro: 'A customer pays. The request passes through storefront and api-gateway, and each service records spans for its part of the work: one span per operation.',
      question: 'What makes these spans one trace?', qid: 'sat-q-one', choice: { id: 'sat', choices: ONE_TRACE } },
    { intro: 'The spans of trace <code>4bf9…</code> arrived one by one, and the waterfall shows every one as a root. Pick each span and give it its parent, so the request reads top to bottom.',
      question: 'Rebuild the request\'s span tree.', build: TREE },
    { intro: '<code>GET /products</code> on storefront ran while api-gateway handled the checkout, yet it stays a root.',
      question: 'What is <code>GET /products</code>?', qid: 'sat-q-other', choice: { id: 'sat-e', choices: OTHER } },
  ],
  finish: 'You can read a trace: its spans share a trace ID, and each one points at its parent.',
},
```

Derived `mechanics`: `['build']`, as pinned (`act-2.test.mjs:46`).

## 3. The generic runner

**Where it lives.** `lib/play.mjs` exports `STEP_TYPES`, `validatePlay(play) → {errors, mechanics}` and `runPlay(level, ctx)`.
- `buildRegistry(acts, {deck, nodeIds, play})` takes the kit `{validatePlay, runPlay}` as an option. The registry does not import it, because widgets import `isId` from the registry (`sort-it.mjs:8`, `incident.mjs:12`), which would create a cycle.
- `liveRegistry` (`app.mjs:26-28`) passes it in. `openLevel` is unchanged: it calls `level.run(ctx)` (`app.mjs:231`).

**What the registry builds for a `play` level** (`registry.mjs:342-361`):
- `play`: a plain-data copy, deep-frozen.
- `mechanics`: the derived list.
- `run: (ctx) => runPlay(built, ctx)`.
- Run-level entries get `play: null`.

**`runPlay`** (one closure per run, no module-level state):

```js
const show = (i) => {
  const step = steps[i], type = typeOf(step), spec = step[type.key], last = i === steps.length - 1;
  const qid = step.qid ?? `${type.idOf(spec)}-q`, e = ctx.escapeHtml;
  ctx.renderStep(
    `<div class="lesson-intro">${ctx.speech(step.intro)}</div><div class="lesson-stage">` +
      `${step.show ?? ''}${step.code != null ? `<pre><code>${e(step.code)}</code></pre>` : ''}` +
      `${step.question != null ? `<h3 class="q" id="${qid}">${step.question}</h3>` : ''}` +
      `${type.render(ctx, spec, { labelledBy: step.question != null && type.labelled ? qid : undefined })}</div>`,
    last ? `<button class="btn" id="${prefix}-finish" data-finish disabled>Finish</button>`
         : `<button class="btn" id="${prefix}-next" disabled>Next</button>`);
  const btn = ctx.ovActions.querySelector(`#${prefix}-${last ? 'finish' : 'next'}`);
  btn.onclick = last ? () => ctx.finish({ text: finish, cards: level.cards }) : () => show(i + 1);
  type.mount(ctx, spec, { onDone: () => { btn.disabled = false; return btn; } });
};
show(0);
```

**Step-type contract** (what #3, #4, #5 and #7 implement):

```js
STEP_TYPES[key] = {
  key, mechanic,          // a MECHANICS value, or null (choice)
  labelled,               // question required; render receives labelledBy
  idOf(spec),             // the widget id: `${id}-q`, `${id}-feedback`
  validate(spec) → string[],  // pure, never throws, every problem; includes I7 (reference passes the checker)
                              // and "the given state is not already solved"
  render(ctx, spec, {labelledBy}) → html,
  mount(ctx, spec, {onDone}),  // the ONLY home of this widget's penalties (I1); calls onDone() once,
                               // focuses its return if canFocus, else its feedback
};
```

The live adapters are thin wrappers:
- **choice:** `choiceHtml`, `mountChoice` with `onRight: onDone`, and `validateChoiceSpec` plus "at least 2 choices".
- **sort:** `renderSort(spec, newSortState(spec), …)`, `mountSort`, `validateSortSpec`.
- **build:** `renderBuild`, `mountBuild`, and `validateBuildSpec` plus `checkBuild(spec, newBuildState(spec)).ok === false`.
- **incident:** `renderIncident`, `mountIncident`, `validateScenario`.
- **spot:** `renderSpot(spec, newSpotState(spec), …)`, `mountSpot`, `validateSpotSpec`.

Each type also has a test driver in `test/helpers/step-drivers.mjs` (§4). Adding a widget means: core and view (M1-DESIGN §4 pattern), plus one `STEP_TYPES` entry, plus one step driver, plus one thin level.

**Identical behaviour.**
- The same mount helpers run with the same specs, so penalties, feedback words and focus order are unchanged.
- ctx and `scoreStars` are untouched. Finish text and cards are the same, and with `prefix` so are the button ids.
- The only markup differences: build steps' `<h3>` gains an id, and lead-in lists move into `show`. Question heading ids are derived (`<widgetId>-q`) unless the step sets `qid`; migrated levels set `qid` to their current ids (2.7: `avm-q-sort`, `avm-q-why`, `avm-q-fix`; 2.1: `sat-q-one`, `sat-q-other`), so their markup is unchanged. No test pins these ids today.

**Invariants.**
- **PI1:** `lib/play.mjs` never calls `ctx.mistake` or `ctx.hint` (I1).
- **PI2:** no timers and no module-level mutable state (I2). Reopening a level is a fresh closure.
- **PI3:** `play` is plain data, and the built copy is deep-frozen. A widget that mutates its spec throws (modules are strict) instead of corrupting the next run.
- **PI4:** a play level's mechanics and awarded cards have one home each (below).
- **PI5:** `validatePlay` collects every problem and never throws.
- **PI6:** every step is gated: its button stays disabled until `onDone`.

**Concurrency.** Everything runs single-threaded with no timers.
- Actors: player clicks, overlay close (`AbortSignal`) and the `storage` event, which never touches a running level.
- Double Finish is caught by ctx's `finished` latch (`level-context.mjs:73`).
- Closing and reopening gives a new ctx and closure; the old closure's `finish` returns null because its signal is aborted.
- Two runs of the same level at once are impossible (`openLevel` guards `overlayOpen`, `app.mjs:206`).
- The registry is frozen, so runs share nothing mutable. No state is read outside its run, so there is no TOCTOU.

### 3.1 Expression-site inventory

| Fact | Sites today | After (play levels) |
|---|---|---|
| cards awarded on finish | `level.cards` plus `finish({cards})` in all 13 levels | `runPlay` passes `level.cards`; one home. Run-levels keep theirs, guarded by `levels-play` "card … is not in level.cards" (`levels-play.test.mjs:488-490`) |
| level mechanics | hand-written per level | derived by `validatePlay`, the one source; a declared value must equal it (registry error otherwise) |
| choice spec validity | only inside `mountChoice` (`choice.mjs:51-63`) | `validateChoiceSpec`; `mountChoice` calls it (like `mountSort` → `validateSortSpec`, `sort-it-view.mjs:75`) |
| Next/Finish markup, gating, `data-finish` | 13 copies | `runPlay` only |
| reference answer solvable (I7) | per-act test loops (`act-2.test.mjs:358-393`), plus `validateBuildSpec` and `validateScenario` | each type's `validate`, run when the registry is built, plus the generated suite. The per-act loops stay (not deleted in M2) |
| what costs a star (slip list) | hand `SLIPS` tables (`act-2.test.mjs:599-660`) | derived from the spec by the step drivers; the hand tables stay for migrated levels as proof |
| answer key | level data plus `PIN` plus `DRIVERS` constants | level data plus one `ANSWERS` line per step (§4) |

**Guards this design relies on, with their triggers:**
- **`levels-play` `checkRun`** (`levels-play.test.mjs:477-500`): "the first screen has no enabled Finish", "finished from a [data-finish] click", "card … is not in level.cards", "step has nothing to click", em dash, Alpine attributes. Play levels are covered because they get a derived driver (§4) and so pass through `checkRun`.
- **`content.test`** scans `readdirSync('levels')` (`content.test.mjs:14-16`). Play levels are still files there, so the Spec line and em-dash checks cover them.
- **`checkKeys`** (`registry.mjs:63-75`) checks only top-level keys. `play` and step keys are not covered, so `validatePlay` must run its own key check, reusing an exported `checkKeys`.

**What each test set ranges over:**
- Generated suite: the play levels in LIVE plus the fixture play level. Never empty.
- `DRIVERS` gap check: the run-levels in `LIVE.order` must each have a driver. Hand drivers for play levels are allowed.
- Together, every registered level is covered.

## 4. Tests generated from data

`test/helpers/step-drivers.mjs` holds one driver per step type, all built from the spec:
- `solve(spec) → selector[]`
- `slips(spec) → [{name, clicks, says: RegExp}]`, each costing exactly one penalty:
  - choice: each wrong key;
  - sort: each item's first wrong bucket;
  - build: Check on the given state, plus the hint if any;
  - incident: the first herring, and a wrong hypothesis.
- `first(spec) → focusName`: `pick:`, `item:<id>`, `span:<first row>` or `view:<id>`.
- `answerKey(spec) → string`

A meta test checks that every `STEP_TYPES` key has a driver and that every driver has a type.

`test/play.test.mjs` runs over every play level in LIVE plus the fixture registry, and asserts:
1. Every step's spec passes its type's `validate`. Solvability (I7) is enforced when the registry is built and asserted again here.
2. A clean run finishes once, from a `[data-finish]` click, with 3★ (0 if unscored) and `cards` deep-equal to `level.cards`.
3. Each slip alone, from a clean start, scores exactly 2★, and its feedback matches `says`. A build Check repeated with identical state is free (still 2★).
4. Before solving, Next/Finish is disabled; after, it is enabled.
5. Focus walk: each step starts on `first(spec)` and hands off to `#<prefix>-next`; the walk ends on `#<prefix>-finish`. `unfocusable()` is empty and the walk never lands on `body`.
6. The suite exercised at least one level. Without this, it would pass vacuously while no live level is declarative yet.

`test/answers.test.mjs` pins each play level's answer key as a second, independent copy, e.g. `'choice avm-why: two-setups'`, so a wrong key in a level file fails a test in another file. There is a two-way gap check.

**What stays per level:**
- card fronts and backs pinned to the design doc;
- copy claims that can be checked (e.g. the status rule test in `act-2.test.mjs:453-463`, the traceparent regex);
- `EXPECTED_ORDER` in `live-registry.test.mjs`;
- bespoke run-levels keep their own tests.

All assertions compare strings, numbers and booleans, never DOM nodes. Every run uses `NODE_OPTIONS=--max-old-space-size=2048`.

## 5. Validation

Run when the registry is built; all errors are collected into one `RegistryError`.

`validatePlay` checks:
- plain data only;
- known keys at every level of `play`;
- `qid`, when present, is a plain token and unique within the level;
- exactly one type key per step, and it is live, not reserved;
- `intro` present; `question` present where the type requires it;
- `code` and `show` are strings;
- widget ids unique within the level;
- `prefix` is a plain token;
- the `finish` text length;
- every type's `validate`.

The registry adds: run and play are mutually exclusive, play requires the kit, a declared `mechanics` equals the derived list, and the derived mechanics are non-empty.

**Messages an author sees** (prefix `level "<id>": `):
- `declares both run and play; use one`
- `play needs the step kit (buildRegistry option "play")`
- `declares mechanics ["build"] but its steps give ["sort"]; fix or remove mechanics`
- `play must be plain data: steps[1].choice.choices[0].why is a function; write run(ctx) for custom behaviour`
- `step 2: unknown key "inrto" (did you mean "intro"?)`
- `step 2 has no step type (one of choice, sort, build, incident, spot)` / `step 2 has two step types ("choice", "sort")`
- `step 3: step type "configure" is reserved for Configure it (#3) and not available yet`
- `step 2 (choice "avm-why"): needs exactly one right answer, has 0`
- `step 1 (sort "avm-sort"): item "redis": unknown bucket "automatic"`
- `step 2 (build "sat-tree"): the given state already passes Check, so there is nothing to do`
- `step 2 (build "sat-tree"): answer does not pass checkBuild: wrong-parent b7ad6b7169203331`
- `step 3: widget id "avm-why" is already used by step 2`
- `play.steps has only choice steps; a level needs at least one mechanic step`
- `play.finish must be reward text longer than 10 characters`

## 6. Escape hatch

Hand-written `run(ctx)` stays fully supported, with unchanged rules and tests (`DRIVERS` required).

The line: **if the level needs a function anywhere, write `run(ctx)`.** That means any of:
- behaviour between or after widget events (2.2's edges line);
- an interaction that is not a registered widget (the pager);
- a checker that is not a registered named checker (1.2 today).

There is no hybrid "mostly steps plus one hook". Two clean modes are cheaper to review than a hook API.

## 7. Migration (optional per #71)

**Migrate cleanly, with test changes limited to adapters:**
- 2.7 (P3).
- 0.1, 0.2, 0.3, 2.3 and 2.5: Sort and Choice only (P4).
- 2.1 and 2.6: Build (P5). 2.6's stories go into `show`.

**Possible but low value:**
- 2.4: hops and roots go into `show`; two tests turn into string checks.
- checkout-is-slow: one incident step.

**Stay hand-written:**
- 2.2: the edges hook.
- 1.2: the env checker, until #3 decides whether Configure it absorbs it.
- the-pager.

In each migration PR (#71 AC4: existing tests unchanged and green):
- The level keeps its `CONTENT` export (derived from `play`, never a second hand-written copy) and its `mechanics` (checked equal to the derived list), and steps set `qid` to the current heading ids, so no existing test line changes. `PIN`, `SLIPS` and `DRIVERS` stay byte-identical: they are the proof that behaviour is identical.
- The only test edits allowed are additions (the `ANSWERS` line) and, once, in the first migration, passing the kit (`play: { validatePlay, runPlay }`, plus its import) to `test/live-registry.test.mjs`'s direct `buildRegistry(ACTS, …)` call, which has no kit until some level has `play`. If a migration cannot avoid editing an existing test line, it stops and the PR body names the line and why, for the user to decide.

## 8. Phased plan (one PR each, never stacked, each mergeable to main)

| # | Phase | Owner | Depends on | RED (one-line mutation in brackets) |
|---|---|---|---|---|
| P1 | `validateChoiceSpec` pulled out of `mountChoice`; no "at least 2" rule here, because `choice.test.mjs:260-268` mounts a single choice and expects the "rendered" error | backend | – | `test/choice.test.mjs` adds: valid → `[]`; 0 or 2 rights → `needs exactly one right answer, has N`; duplicate key; non-string why; `null` → a problem, no throw. Existing assertions unchanged. [drop the rights check in the validator → the new test and the existing `mountChoice` test both go red, proving the delegation] |
| P2 | Platform: `lib/play.mjs`, registry `play` key and option, `liveRegistry`, `test/fixtures/play-level.mjs` (one step of each live type), `test/helpers/step-drivers.mjs`, `test/play.test.mjs`, `test/answers.test.mjs`, derived drivers in `levels-play`, `levels/index.mjs` "TO ADD A LEVEL" comment, FOUNDATION §2.1 and §2.4 | backend (registry, validate) + frontend (runner) | P1 | (a) fixture clean run 3★ with cards = `level.cards` [runner passes `cards: []`]; (b) each slip exactly 2★ [drop `ctx.mistake()` in `mountChoice`]; (c) Next disabled before solve [render Next without `disabled`]; (d) focus walk ends on `#fx-finish` [`onDone` returns undefined]; (e) registry errors: both run and play, no kit, declared mechanics differing from derived (equal is accepted), function in play, two bad steps → 2 errors [return on first]; (f) built `play` is frozen and survives mutation of the source [skip the clone]; (g) derived mechanics `['sort','build','incident']` [count choice]; (h) `code` `<img onerror>` renders escaped [drop `e()`]; (i) `lib/play.mjs` source has no `mistake(` or `hint(` [add one on Next]; (j) the suite ran ≥1 level [drop the fixture]; (k) a second clean run of the same level starts at step 1 with 3★ [module-level step index] |
| P3 | Migrate 2.7 (keeps `CONTENT` and current heading ids via `qid`; the only existing test edit is passing the kit to `live-registry`'s direct `buildRegistry` call) | frontend | P2 | Add `'auto-vs-manual'` to `ANSWERS` → red (gap: not a play level); migrate; `git diff` of test files is the `ANSWERS` entry plus the `live-registry` kit line; `PIN`, `SLIPS` and `DRIVERS` byte-identical [swap `right` from two-setups to retries → `ANSWERS`, `PIN` and the clean run go red; change a question string in `play` → the `PIN` goes red, proving `CONTENT` is derived] |
| P4 | Migrate 0.1–0.3, 2.3, 2.5 (optional) | frontend | P3 | as P3, per level |
| P5 | Migrate 2.1, 2.6 (2.4 optional, last) | frontend | P3 | as P3; build answer key lines |
| – | #3, #4, #5, #7 | per issue | P2 | a step type plus a driver plus a thin play level; generated suites cover it |

**Cost of one new level** (sort plus two choices, 2.7 measured):

| | Files | Lines | Code or logic a reviewer must read |
|---|---|---|---|
| Before | 6 (level, `index`, `deck`, `levels-play` DRIVERS, `act-N.test` PIN + SLIPS, `live-registry`) | ~270 (level 197, of which `run` is 80; driver ~25; PIN, LEVELS, SLIPS ~37; deck ~8; 3 one-liners) | ~140 |
| After | 5 (level, `index`, `deck`, `answers.test`, `live-registry`) | ~135 (level ~120 of copy and data; deck ~8; answer key 3; 2 one-liners) | ~0 |

## 9. Open questions (default in brackets; defaults taken 2026-10-31, the user may override)

1. How much existing content to migrate in M2? [P3 (2.7) only. P4 if it stays mechanical. Build levels and bosses later or never.]
2. For new acts, should the design doc keep full answer tables plus a per-act `PIN` test, or should the level file be the source of truth plus the 1-line-per-step `ANSWERS` key? [Level file plus `ANSWERS`. The design doc keeps concept, nuance, cards and spec URLs, and card fronts stay pinned.]
3. 1.2's env checker: make it a step type now, or let #3 Configure it decide? [Let #3 decide. 1.2 stays hand-written.]
