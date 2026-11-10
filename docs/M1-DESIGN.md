# M1 design: the vertical slice

Source of truth for M1 (Act 0, Act 2). Builds on [FOUNDATION.md](FOUNDATION.md); where they
differ, FOUNDATION governs the platform and this file governs M1 content and widgets.

**Scope (decided 2026-10-30).** M1a = P0–P9 (Act 0 + its boss + Act 2 levels 2.1–2.7),
playable end to end. M1b = P10–P11 (incident engine + Act 2 boss "Checkout is slow").

**Decisions (2026-10-30, user).**
- Q1: an act stays unlocked once entered (P0 changes the rule before any content).
- Q2: M1a first, then M1b.
- Q3: accepted: 2.7 uses Sort + Choice (no YAML "Configure it" in M1); 2.3's "Spot it" is built
  on Sort it. Configure it arrives with the Collector act.
- Q4: M1 lights fewer map nodes (see §6 `lights`); the rest are saved for later acts.

## 1. Invariants

- I1. Penalties are expressed only in widget mount helpers (`mountChoice`, `mountSort`,
  `mountBuild`, `mountIncident`); a level never calls `ctx.mistake()` for a placement, check
  or incident action itself.
- I2. Widgets use no `setTimeout`/`setInterval`/`requestAnimationFrame`; incident "time" is
  simulated minutes advanced by actions. Reduced motion is the existing global CSS rule.
- I3. Data text (span names, attribute values, headers) reaches HTML only through
  `ctx.escapeHtml`; authored copy (labels, `why`) is trusted HTML.
- I4. Every outcome is stated in words in a `role="status"` region; CSS ✓/✗ is never the only cue.
- I5. After every action focus lands on an enabled connected control or a `tabindex="-1"`
  feedback/panel; never `<body>`.
- I6. No Alpine attributes; wire with `el.on* = …` after render (incl. `ondragstart`/`ondrop`).
  `draggable="true"` is allowed.
- I7. A widget spec's reference answer passes that widget's own checker; every level tests it.
- One slip costs one star: tests start from a clean run and add exactly one slip (→ 4★).
- Tests assert booleans/strings/numbers only (never DOM nodes); every run uses
  `NODE_OPTIONS=--max-old-space-size=2048`.
- Every level file has a `// Spec: <https URL>` line; teaching claims cite the spec.

## 2. Expression sites (one authoritative home each)

| Fact | Home |
|---|---|
| wrong choice costs one mistake; focus to next enabled choice (wrapping) | `mountChoice` (`lib/widgets/choice.mjs`); 1.2 rewired onto it in P1 |
| wrong sort placement costs one mistake; repeating it is free | `mountSort` |
| Build it: a failed check costs one mistake unless identical to the last failed one; with instant feedback a wrong drop or edit costs one (an unchanged repeat is free); each hint tier costs one hint | `mountBuild` (1.2 keeps its own copy of the check rule inline in `run` in `levels/naming-your-service.mjs`, not in `mountBuild`; follow-up issue extracts it) |
| incident budget left | `budgetLeft(s, st)` only; the minutes-left headline, the meter's spent line and cells are all formatted from it |
| incident clues found / answerable | `cluesFound(s, st)` and `canAnswer(s, st)` only (`clueIds` says which views are clues); the counter, the lock line, the cause states and tier 3 read them |
| incident penalties | `penalise(kind)` in `mountIncident` only: ctx.mistake() and the side column's tally together |
| service-map edges from span kinds | `serviceEdges` |
| attribute share slow vs baseline | `compareAttribute` (`lib/widgets/triage.mjs`); empty set → `null`, never 0% |
| node lit / pulse | `lib/map.mjs` (unchanged) |
| act unlocked | `lib/unlock.mjs` (P0 changes the rule, still one home) |

## 3. Unlock rule (P0)

New rule in `lib/unlock.mjs`: act *i* is unlocked if **every earlier act is complete, OR the
player has completed any level (or the boss) of act *i***. Boss rule unchanged (a boss opens
when its act's levels are done). Completed levels always show `'done'`.

Consequences: adding levels to an earlier act never re-locks an act the player has entered.
An act not yet entered still waits for the chain. Existing players (only 1.2 done) after P3:
1.2 `'done'`, Act 1 entered so open, Act 0 open, Act 2 opens after Act 0 complete (Act 1 is
complete). FOUNDATION §3 is updated in P0.

**Merge order still matters:** the pager (P4) merges before any Act 2 level (P6) so Act 2's
unlock condition doesn't change under players; the Act 2 boss (P11) merges after 2.1–2.7.
Between P3 and P4 a new player who finished 0.1–0.3 but not 1.2 sees Act 1 lock again when the
pager lands; accepted, since the game is not yet deployed.

## 4. Widget contracts

Each widget = pure core (backend-expert) + `*-view.mjs` render/mount (frontend-expert);
mount helpers touch only `ctx.ovBody`/`ctx.ovActions`.

### 4.0 Choice (P1): `lib/widgets/choice.mjs` (extracted from 1.2's `ask`)
- `choiceHtml(ctx, choices, {id})` → `<div class="choices" data-choice="ID">` with
  `<button class="choice" data-pick="KEY">` in `ctx.shuffle` order +
  `<div class="feedback" id="ID-feedback" role="status" aria-live="polite" tabindex="-1">`.
- `mountChoice(ctx, choices, {id, onRight})`: `TypeError` unless exactly one `right`. Wrong pick
  → `mistake()`, class `wrong`, disable, text `Not quite. <why>`, focus next enabled (wrapping)
  or feedback. Right → class `correct`, disable all, `Right. <why>`, focus `onRight()`'s return.
- 1.2 uses `id: 'nys'` so `#nys-feedback` is unchanged.

### 4.1 Sort it (P2)
Core `lib/widgets/sort-it.mjs`:
```
SortSpec = { id, buckets: [{id, label}], items: [{id, label, bucket, why, whyNot?: {[bucketId]: html}}] }
  2..5 buckets, 2..12 items
validateSortSpec(spec) → string[]          // all problems
newSortState(spec) → { right: {}, tried: {} }
place(spec, state, itemId, bucketId) → { state, outcome }   // never mutates
  outcome: 'right' | 'wrong' | 'repeat' (bucket already tried) | 'placed' (already right) | 'unknown'
remaining(spec, state) → itemIds not yet right, spec order
untried(spec, state, itemId) → bucketIds not yet tried, spec order
isComplete(spec, state) → boolean
```
`bucketOf(spec, itemId)` → the item's answer bucket id (undefined if unknown): the one reader of
an answer; `place` grades with it and stays the only grader.
View `lib/widgets/sort-it-view.mjs` (the UI kit, #156): one typed `sortView(spec, state,
{order, selected, hinted})` → `{id, total, left, done, pool: [{id, labelHtml, pressed, hinted}],
buckets: [{id, labelHtml, enabled, hinted, placed: [{id, labelHtml}]}]}` (pool in `order`, buckets
in spec order, a bucket enabled only for the selected item and when untried; placed plus left
equals total). `renderSort(spec, state, {selected, order, escapeHtml, labelledBy?})` renders it in
a wide step: a kit split with the board and the side column (score card with a wrong-placement
count, success card with its swirl, and the hint tools when the step's helps turn hints on; a chips
row `Helps: Instant feedback on, Hints on|off` above the board). Items are toggle options (`data-item` +
`aria-pressed`, no answer attribute) in a named group (`role="group" aria-label="Items to sort"`,
`aria-describedby="ID-instr"`); there are no bucket boxes (#261): the categories are a row of kit
choice options (`data-bucket`, disabled until an item is selected and for a category already tried
for it, outlined when hinted) under a plain "Then choose its category." line, and below that one plain
group per category (`[data-drop]`: a heading "Label, a middle dot, N" with the tally, and the
`[data-bucket-list]` of placed items); a kit stats line reads "Sorted N of M";
`#ID-feedback` is the kit feedback region; the plain-text instruction ("Pick an item, then its
category, or drag an item onto a category.") is `<p class="sort-instr" id="ID-instr">`.
`labelledBy`, a plain-token heading id, makes the widget a labelled group.
`mountSort(ctx, spec, {onComplete, swirl?})`: the pool order is shuffled once per mount through
`ctx.shuffle`; tap-to-place (item then category button; keyboard-native); drag is an enhancement calling
the same path, dropping an item on a category's group. Only `'wrong'` costs a mistake (`ctx.mistake()` and the score card's count in one
branch); nothing counts after the last item. Feedback (D7): `Right. <label> goes in <bucket>.
<why>` (success) / `Not quite. <label> is not <bucket>. <whyNot?>` (error; doesn't reveal the
answer) / `You already tried <bucket> for <label>.` (a repeat; free, neutral) / `Pick an item
first.` (neutral). Focus: first remaining item → its first untried bucket → after wrong, next
untried bucket → after right, next remaining item → after the last, `onComplete()` runs and the
success card's heading takes focus.

Help ladder (#156), pure in `lib/widgets/sort-it-help.mjs`. A sort step may declare
`helps: {hints: boolean}` (default `{hints: false}`; instant feedback is always on) and, only with
hints on, an authored `hint` line (inline HTML only: tier 1 wraps it in `<p>`, so no block elements; it points at the idea and never names a bucket or quotes an item). `sortHelps(spec)`, `validateSortHelps(spec)` (unknown or
non-boolean helps key, `hint: not non-empty text`, `hint: shown only when helps.hints is on`; play.mjs
also rejects unknown keys with a did-you-mean). The hint target, `hintTarget(spec, state,
{order, selected})`: the selected item if still remaining, else the first remaining in display
order, else null (Hint disabled, "Nothing to hint right now."). Tiers by `hintFor(spec, state,
itemId, tier, {shuffle})`, all derived from `bucketOf`, each html a `<p>`: 1 the step's `hint` or
`SORT_RULE`; 2 two candidate buckets in spec order, the right one and a decoy shuffled (through
`ctx.shuffle`) from the buckets not yet tried for the item, outlined with `data-hinted` while that
item is the hint target (the selected item, else the first item still to sort), never on a bucket already tried; 3 places the item
through `place` (a hint, never a mistake; the feedback is a neutral "Placed for you.", never
"Right.").

Which tier a click gives is decided at click time by `hintLadder(spec, state, itemId, {ruleShown,
taken})`, still with no second grading path. Tier 1 is charged once per board: after it was shown
for any item, every item's ladder starts past it. Tier 2 is offered only when it narrows, that is
when the item's untried buckets number 3 or more (or it was already given); otherwise the next tier is
the placement. The ladder is `[1, 2?, 3]`; the button reads "Hint `done+1` of `tiers.length`" and the
side line "For X: `done` of `tiers.length` used", where `done` counts the rule once it was read for
any item (so a 2-bucket board after the rule reads "Hint 2 of 2"). With one bucket left and no hint for it, the side line reads "For X: only one bucket left" with no dots.
With fewer than 3 untried buckets the view skips tier 2; with exactly one left untried (the right
one) there is no hint at all: `next` is null, the button reads "No more hints" and is disabled. The
hint panel always shows the hint target's own last hint (tier 2) and, when that item has none, shows the rule once it was read (else it is empty); selecting an item, a placement that moves the target, or a wrong try re-syncs it with the
board's outlines. One exception: right after a tier 3 placement the panel keeps "Placed for you. ..." until the next selection, placement or try. The rule (tier 1) is paid once per board, not stored per item.
An item's total can therefore shrink mid-ladder ("Hint 2 of 3" becomes "Hint 2 of 2") when a wrong
try leaves fewer than three untried buckets and tier 2 was not yet taken.
Each click is one `ctx.hint()` and one hint on the score card; nothing happens after the last item.
Ladder: 0.1 and 0.2 hints on (both sorts), 0.3, 1.1 and 2.3 hints on, 2.5, 2.7, 3.1, 4.1 and 5.6
hints off. Every hints-on sort step authors its `hint` (#190): 0.1, both 0.2 sorts, 0.3, 1.1 and 2.3.

### 4.2 Build it, trace waterfall (P5)
Core `lib/widgets/trace.mjs`:
```
Span = { spanId: 16 lc hex, traceId: 32 lc hex, name, service,
  kind: SERVER|CLIENT|PRODUCER|CONSUMER|INTERNAL, startMs, endMs, status: UNSET|ERROR|OK,
  attributes, events: [{name, atMs, attributes}], parentId: string|null, links: string[] }
waterfall(spans) → { rows: [{spanId, traceId, depth, x, width, name, service, kind, status, orphan, crossTrace}], traces }
  traces by earliest start; DFS per trace, children by startMs then spanId; x/width 0..100 over
  all spans; unknown parent → root, orphan:true; parent in another trace → root, crossTrace:true
serviceEdges(spans) → sorted unique [{from, to, via}]: CLIENT→child SERVER in another service
  ('client-server'); CONSUMER whose parent or link is a PRODUCER in another service ('producer-consumer')
```
Core `lib/widgets/build-it.mjs`:
```
BuildSpec = { id, spans, edit: ⊆ ['parent','kind','status','links'] | ['logs'], answer: {[spanId]: {...}}, hint? }
validateBuildSpec(spec) → string[]   // hex, unique ids, endMs>=startMs, answer acyclic & passes checkBuild
newBuildState(spec); setParent → 'set'|'self'|'cycle'|'unknown'; setKind/setStatus → 'set'|'invalid'|'unknown'
toggleLink → 'linked'|'unlinked'|'self'|'unknown'
checkBuild(spec, st) → {ok, issues:[{code, spanId, message}]}   // only `edit` fields graded
  codes: wrong-parent, wrong-kind, wrong-status, missing-link, extra-link, cross-trace-parent
applyState(spec, st) → Span[]
```
View `lib/widgets/build-it-view.mjs` (redesigned in #146 from the owner-approved prototype;
`checkBuild`, `setParent` and `validateBuildSpec` unchanged):
- **Board.** A Dash0-style waterfall built as DOM: a metadata line, the one instruction line
  (`#ID-instr`, every row's `aria-describedby`, not a live region; parent mode: "Drag each span
  onto its parent, or pick a span and then its parent."), a root drop zone, the move status
  (`#ID-status`, live), a tick header, then one row per span: name and service, then the trace
  id (8 hex characters, full id in a tooltip), kind, status and timing; indent elbows. Each row's
  track is an SVG without a viewBox (real, unstretched text; positions are attributes, CSP):
  grid lines, connectors from parent to child, the bar labelled with duration and name. Bars
  are coloured by service (`--color-svc-0..5`, muted, legend below); ERROR is a
  stroke, not the fill. The selected row and bar are outlined, its current parent dashed.
- **Moving a span.** Drag a row onto a span or the root zone (HTML drag and drop, `el.on*`), or
  pick it (click or Enter on its row), then click its parent row or the root zone, as in the
  prototype; clicking the picked span again, or Escape, cancels. The widget takes Escape only
  while a move is pending (a span picked in parent mode, when the status says "Esc cancels"),
  and marks it handled so the app's Escape does not also close the level. In every other state
  (a span left selected after a wrong instant drop, a row selected on a kind, status or link
  step, a record selected in logs mode, any row after success) Escape is not handled and
  reaches the app, which closes the level. The panel stays as an extra
  keyboard and screen-reader path (`data-parent`: root, then the placed spans; itself and its
  descendants disabled). All call `setParent`; a loop refused there stays free. While a span
  moves, itself and its descendants are marked invalid and are not drop targets. Kind, status,
  links and logs-mode attach keep their panel controls.
- **Help ladder.** A step declares `helps` (`queue`, `tint`, `guide`, `instant`, `hints`;
  validated by `validateBuildHelps`, `lib/widgets/build-it-help.mjs`); `renderBuild` is the one
  renderer and a chips row says which are on. Queue: the first root is placed, spans arrive in
  start order, waiting spans are inert ("hasn't arrived yet"). Guide (parent mode): a band at
  the moving span's window, spans that contain it highlighted. Tint: one tint per trace id;
  candidates in another trace fade and say "other trace". Instant: each change is graded at
  once from `checkBuild`'s issue for that span (a tick, or a specific note), no Check button.
  Hints: three tiers per span or record (the rule, or the spec's authored `hint`; two
  candidates outlined; set for you with a reason), derived from the answer (`answerFor`) and
  `checkBuild`. A hint never contradicts the board: a tier-2 parent candidate that sits below
  the span (the board refuses it) is named as having to move out first. Tier 3 for a parent
  always leaves the span under its answer parent: when that parent sits below the span, it
  moves out first (to its own answer parent if that is placed and outside the span's subtree,
  else to the root), through `setParent`, graded by `checkBuild` and never charged; the hint
  and the status say so, and when the lifted span lands wrong they add its note ("is not where
  it belongs yet: ..."). No `helps`: Check, and hints only when the spec has a `hint`. Ladder: 2.1 all;
  2.2 tint, instant, hints (the guide needs parent editing); 2.4 Check and hints; 2.6 none;
  4.2 (logs mode, no edit) the default: Check and three-tier hints with its authored hint as tier 1.
- **Notes.** Each `checkBuild` code maps to a short, specific note that never names the
  expected parent or span (`noteFor`): cross-trace names both trace ids; wrong-parent says root,
  outside the parent's window, or a closer span contains it. Not graded today (no code): a
  child starting before its parent, and a CLIENT span whose child is not the SERVER span it called.
- **Scoring (§2).** Instant: a wrong drop or edit costs one `ctx.mistake()`, an unchanged repeat
  is free. Check: a new failing Check costs one, an identical recheck is free (`Same as last
  time: N problems.`). Each hint tier costs one `ctx.hint()`. Retrying is free; Reset puts the
  board back and keeps what was paid.
- **Right column** (markup: `sideColumn` and `helpChips` in `lib/ui/side.mjs`; behaviour:
  `lib/widgets/help-ladder.mjs`, shared; Sort it adopted it in #156; Query it and Configure it share the
  Hint click and score drawing in its `mountHintLadder`, #247): about
  300px and sticky beside the board from about 960px of widget width (a container query), else
  stacked under it: the success card (hidden until success; heading focused, no focus ring;
  stars line; the spec's `closing`), the score card (wrong drops or failed Checks, hints, five
  stars for this board only, `boardStars`: the star rule over the board's own wrong drops or
  failed Checks and hint tiers, counted from zero at mount, so earlier steps never show here;
  muted outlines while still possible, filled once earned; the level's stars stay on the
  reward screen), the hint tools (button, cost from the star rule, tier line, hint text).
- **Swirl** (#151, folded in): on the first success only, `lib/swirl-render.mjs` plays a dot
  swirl with the vendored three.js (a few seconds; the canvas and WebGL context are then
  released and the settled frame stays as an SVG ring, `lib/swirl.mjs`). Reduced motion or no
  WebGL: the static SVG ring at once, three.js never loads. Decorative: `aria-hidden`, not
  focusable, no text. Tests inject a fake renderer.

**Logs mode (#113: core in phase A, view in phase B).** `edit: ['logs']` is its own
mode (exactly that list; a mix with span fields is refused), with the same step type and
mechanic (`build`). Spans are read-only and not graded; a log record is a standalone
record that carries `trace_id` / `span_id` (OTel logs data model), never a child span, so
it gets no `parentId` and no waterfall row.
```
BuildSpec += logs: 1..12 LogRecord in non-decreasing timeMs (spec order = display and grading order), explain?
LogRecord = { id (kebab, unique, not a span id), timeMs (finite, same clock as spans), severity (TRACE|DEBUG|INFO|WARN|ERROR|FATAL),
  service, body, traceId: 32 lc hex|null, spanId: 16 lc hex|null (both or neither; a set spanId is a span on
  the board and traceId is that span's trace; all-zero ids refused), attributes? {string|finite number|boolean} }
answer = {[logId]: spanId | null}   // every record once; null = no span context; 'none' is refused
BuildState += logs: {[logId]: spanId|null}   // the trace is never stored
isLogMode(spec); attachLog(spec, st, logId, spanId|null) → 'attached'|'detached'|'unknown'
applyLogs(spec, st) → records with traceId/spanId derived from the span (the one place)
recordsBySpan(spec, st) → {[spanId]: record[]} (every span a key, [] for none)
gradedState: span entries carry spanId only, then {logId, spanId} per record; gradedKey serializes it
checkBuild → issues {code, logId, message}; one per record, first that applies:
  log-other-service, log-outside-span (inclusive window), log-no-active-span, log-wrong-trace,
  log-wrong-span, log-not-attached
validateBuildSpec applies the log answer before the I7 check, so the rule codes grade the reference answer
timeAxis(spans, times = []) → {min, range, pct(ms)}; waterfall(spans, {times}) uses it (same output with no times)
```
`play.mjs` accepts `logs` and `explain` on a build step, and logs mode in levels (phase B
removed the "not available in levels yet" guard). `explain` is shown only in logs mode, so
`validateBuildSpec` refuses it elsewhere (`explain: only shown in logs mode`) rather than
letting an author's text vanish.

Logs mode view (#113 phase B), same `renderBuild` / `mountBuild`, span mode unchanged:
- **Board.** The read-only waterfall (one row per span, widened by the record times through
  `waterfall(spans, {times})`; a row's accessible name ends `, N records` once records are
  attached), then the log stream `<ol class="wf-logs">`: one `li` per record holding a
  `[data-log]` kit option (first, with `aria-pressed`), spec order, text `time ms · SEVERITY ·
  service · trace_id=… · span_id=… · body · k=v, …`; a blank id reads `(none)`.
- **Select a record.** A dashed `<line class="wf-cursor">` at its time in every row's track
  (`timeAxis(...).pct`) and the panel "Span context for "body" (service, time ms)": `data-attach` buttons, "No span
  context" (`data-attach="none"`) first, then every span in row order. Attaching is free and
  says `"body" now carries span_id=… and trace_id=… from <span>.` (or `now has no span context`).
  The ids come from `applyLogs`, never from the view.
- **Ticks.** A `<rect class="wf-log">` on the row of the record's span at the record's time,
  hanging off the bar when the time is outside it. Positions are SVG attributes (#146: the
  tracks have no viewBox, so nothing is stretched).
- **Select a span.** Read-only: its attributes (`.build-attrs`) and "Records carrying this
  span_id" as `data-show-log` buttons (from `recordsBySpan`), each opening that record's
  attach panel. A panel with nothing to press focuses its heading (`data-panel-title`).
- **Check.** Same penalties as span mode (a failing Check costs one unless `gradedKey`, which
  includes the records, equals the last failed one). Pass: `Right. Every record checks out.`
  plus `explain` (authored HTML); the attach buttons lock, inspecting still works.
- **Focus.** Mount: first `[data-log]`; a record: "No span context"; an attach: that button;
  a failing Check: the feedback; a pass: `onComplete()`'s return.
- **Driver.** `solve` selects each record and sets it explicitly; slips `check`, `orphan`,
  `hint`; `first()` is `log:<first record id>`.

### 4.3 Incident engine (P10, M1b; the board on the kit, #143)
Core `lib/widgets/incident.mjs`:
```
Scenario = { id, alert: {title, html}, budget: {startPct 1..100, burnPctPerMin > 0},
  views: [{id, label, costMin, html, kind: clue|herring|neutral}],
  hypotheses: [{id, label, right, why}], answerAfterViews,   // answerAfterViews = clue views to open first
  hint? }                                                    // optional text: the board's first hint tier
validateScenario(s) → string[]   // unique ids; exactly one right; all clues affordable; answerAfterViews 0..clues; hint non-empty text
newIncident(s) → {opened: [], minutes: 0, wrong: [], solved: false}
budgetLeft(s, st) → max(0, startPct - minutes * burnPctPerMin)       // the ONLY budget expression
clueIds(s) → ids of the clue views, in scenario order                // the ONLY place a view's kind is read as a clue
cluesFound(s, st) → distinct opened clue views, uncapped             // the ONLY clue count
openView(s, st, id) → {state, outcome: opened|repeat|unknown|closed, herring, exhaustedNow}
canAnswer(s, st)   // the ONE unlock rule: not solved and cluesFound >= answerAfterViews;
                   // neutral and herring opens never count (#120)
answer(s, st, id) → right|wrong|repeat|locked|unknown|closed
```
Each incident boss sets its own rate: 5%/min (20 min) for who-is-talking, the-bill, the-3am-errors and silence; 6%/min (16.7 min) for errors-tripled; 4%/min (25 min) for checkout-is-slow. A scenario may use any rate.

Hints, `lib/widgets/incident-help.mjs` (pure): `hintFor(s, st, tier)` → `{html, views, hypothesis}`. Tier 1 is
the scenario's `hint` (authored HTML) or one generic rule that names no view; tier 2 names up to two clue views
(from `clueIds`): the unopened ones while any remain, else every clue as already open (then the text
reads "You have X and Y open." or "You have X, Y and Z open."); it outlines only the unopened (`views`); tier 3 names the right cause,
outlines it (`hypothesis`) and says how many clues unlock it only while it is locked. A hint never changes
the state. Each tier costs one `ctx.hint()`.

View `lib/widgets/incident-view.mjs`, all of it kit helpers (`lib/ui`, no class of its own), rendered inside a
wide step as a kit split (board, side column). `boardView(s, st, ui)` is the one typed contract every template
renders (`ui`: preview, fresh, hintViews, hintCause, viewOrder, causeOrder): the alert, the budget, the tiles, the Spent-on row, the
evidence log, the clue counter, the lock line and the causes. No `data-kind` reaches the markup.
- **Shuffle:** `incidentOrder(ctx, s)` returns `{viewOrder, causeOrder}`; tiles and causes are shuffled once per
  board through `ctx.shuffle`, as Choice does; `renderIncident` and `mountIncident` take the order; the focus hop
  after a wrong pick follows the displayed order; the evidence log and Spent on keep open order.
- **Alert:** a kit alert panel with a "Firing" eyebrow, the title as its h3 and the alert html.
- **Budget:** the headline is minutes LEFT (`18 min left.`, `Budget spent.` once `budgetLeft` is 0) and counts
  down with each look; the kit meter under it reads `S of T min spent` with one cell per minute (rounded up,
  at most 100: a longer budget scales). Hovering or focusing a tile previews its cost (`This look: N min.`,
  preview cells; an opened tile previews nothing); handlers are properties, never inline. Minutes are
  `budgetLeft / burnPctPerMin` shown to one decimal. No timer anywhere (I2). Once any view is opened a
  "Spent on" row has one chip per view in the order opened (`Label N min`).
- **Step 1, Investigate:** tiles (kit option, tile kind) with a cost chip; an opened tile says "opened", and
  only an opened herring also says "misleading" (the engine already tells the player on that open); clue and
  neutral tiles look the same once opened. Opens speak in `#<id>-status`.
- **Evidence:** the newest opened view's card is on top and open, older cards fold (kit fold, one line each:
  title, cost, "misleading" on a herring); a repeat open reopens its card. Only an open redraws the log, so a
  card the player opened by hand stays open through a hint.
- **Step 2, Unlock the causes:** `Clues found: F of N` with N dots, F capped at N (a third clue never shows;
  absent when N is 0), and the lock line `#<id>-lock`: locked (`Locked until you find N clues in Step 1 (F of N
  so far)...`, which now shows the count, reversing the earlier rule that the line never counted), open, solved.
  It is plain text, not a live region; the causes group (`role=group`, `aria-describedby` the line) always
  points at it. The line is derived from `canAnswer` alone.
- **Step 3, Name the cause:** causes (kit option, hypothesis kind) are `data-state=locked` while `canAnswer`
  is false, with `aria-disabled` and still focusable: a pick then says why in `#<id>-feedback`, at no cost.
  A wrong cause is `data-state=wrong` ("ruled out"), stays clickable and a repeat pick is free. The right one
  is `correct`; solving disables the tiles and causes.
- **Side column:** the kit sideColumn: wrong picks, misleading views, budget run out, hints, five stars from
  `boardStars` (every one of those is one penalty), three hint tiers, and the success card.
Penalties, all through the one `penalise(kind)` (ctx.mistake() and the tally the side column shows, so the two
agree): the first open of a herring, `exhaustedNow` exactly once, a wrong pick. A repeat open, a repeat wrong
pick and a locked pick are free. D7 tones: a free open is neutral, a costly open error, the open that unlocks
the causes success; a wrong pick error, the right one success. Focus: an open moves to its card's heading
(`tabindex=-1`), a wrong pick to the next cause, a locked pick stays, and solving moves to the success card's
heading; `onComplete()` only enables Finish. The incident step type is wide and its lesson card is the boss's
scenario line plus the generic "How this board works" list (`ol[aria-label]`, the same on every board, naming
no view and no cause).

### 4.4 Spot it (M2, #5)
Core `lib/widgets/spot-it.mjs`, view `lib/widgets/spot-it-view.mjs`; step type `spot`, mechanic `spot`.
```
SpotSpec = { id, target: 'config'|'span'|'metric', lines: [{id, text}] (2..12),
  faults: [lineId] (>=1, fewer than all lines), whyNot?: {[lineId]: html}, explain: html,
  helps?: {hints: boolean}, hint?: html }   // hint (tier 1 text; inline HTML, wrapped in <p>) only when helps.hints is on
  config: any text per line; span: `key=value` per attribute; metric: `name{labels}` per series
validateSpotSpec(spec) → string[]   // kebab ids, unique, faults/whyNot name real lines, whyNot never on a fault
newSpotState(spec) → {selected: [], tried: [], solved: false}
toggleLine(spec, st, id) → {state, outcome: selected|unselected|unknown|solved}
checkSpot(spec, st) → {state, outcome: right|wrong|repeat|empty|solved, extra, missing}
```
- **Interaction:** each line is a kit `line` option (a real `<button aria-pressed>` whose name is its text, rendered escaped in `<code>`); `explain` and `whyNot` are trusted authored HTML. The step is wide: a kit split with the board (`#ID-instr`, the lines, Check, feedback) and the side column (success card, score card with `#ID-wrong` failed Checks and hints, hint tools). Toggling is free and updates in place. `#ID-check` grades the whole selection. The view is `spotView(spec, state, {hinted})` -> `{id, target, locked, lines: [{id, text, pressed, hinted, correct}]}`; `correct` is a picked line once solved.
- **Hints (`lib/widgets/spot-it-help.mjs`, `helps.hints`, default off; Sort it's ladder):** three tiers, each one `ctx.hint()` and one hint on the card, never a mistake, derived only from `checkSpot`'s `extra` and `missing` (the module never reads `faults`). Tier 1: `spec.hint` or the generic rule. Tier 2 outlines a pair in spec order, picked through `ctx.shuffle` so it never leaks: an unpicked fault and an unpicked non-fault decoy (a picked line is never the decoy); with only wrong picks, one wrong pick and one right pick; with nothing wrong or missing, nothing and "Your picks are already the answer." Tier 3 picks exactly the fault set through `toggleLine` and runs the same Check (neutral "Picked for you."). Outlines stay until success. Hint stays enabled whatever the picks, until success or three tiers. Levels 3.2, 3.5 and 3.6 turn hints on, and each authors its `hint` (#190); it points at the idea and never names an answer line, its id, or a value or key only the answer lines carry.
- **Outcomes:** `right` = the selection is exactly the fault set (order irrelevant): `Right. <explain>`, lines and Check lock, `onComplete()`. Tones (D7): right `success`, wrong `error`, empty and repeat `neutral`. On success focus goes to the success card's heading and nothing counts afterwards. Anything else is one mistake (I1) in `mountSpot` only (one `penalise()` for `ctx.mistake()` and `#ID-wrong`): `Not quite. N of your picks does/do not match the question.` plus the `whyNot` of each picked non-fault, or `Not quite. Everything you picked matches the question, but there is more.` when nothing extra was picked. The faults are never named or counted. Any wrong selection tried before is free (`You already checked these lines. Nothing new was counted.`); Check with nothing selected is free.
- **Solvability (I7):** `validateSpotSpec` guarantees the fault set is a non-empty proper subset of real lines, so the reference path (select the faults, Check) always passes; the generated step driver plays exactly that.
- **A11y and focus:** feedback is `role=status aria-live=polite tabindex=-1`; with `labelledBy` the widget is a labelled group. Focus: first line on mount, stays on the toggled line, feedback after a Check that does not finish, the success card's heading after the last (`onComplete()` only enables Finish). No timers (I2).

### 4.5 Trade-off (M2, #7; on the UI kit, #160)
Core `lib/widgets/trade-off.mjs` (the grader, unchanged), view `lib/widgets/trade-off-view.mjs`, hints `lib/widgets/trade-off-help.mjs`; step type `tradeoff`, mechanic `tradeoff`.
```
TradeoffSpec = { id, unit, cap, knobs: [{id, label, options: [{id, label, cost, keeps?: [needId]}]}] (1..5 knobs, 2..5 options),
  needs: [{id, label}] (1..4), answer: {[knobId]: optionId}, whyNot?: {['knobId:optionId']: html}, explain: html,
  helps?: {hints: boolean}, hint?: html }   // hint (tier 1 text; inline HTML, wrapped in <p>) only when helps.hints is on
validateTradeoffSpec(spec) → string[]   // kebab ids, unique per list, cost >= 0 and cap > 0 with at most 2 decimals,
                                        // keeps/answer/whyNot name real needs/knobs/options, whyNot never on an answer option
newTradeoffState(spec) → {picks: {}, tried: [], solved: false}
pickOption(spec, st, knobId, optionId) → {state, outcome: picked|unknown|solved}
evaluatePlan(spec, picks) → {complete, total, over, lost}   // total = sum of picked costs; over = total - cap (0 when within); lost = needs no picked option keeps
checkTradeoff(spec, st) → {state, outcome: right|wrong|repeat|incomplete|solved, total, over, lost}
tradeoffView(spec, st, {hinted}) → {id, unit, cap, locked, total, over, complete, spare, knobs: [{id, label, options: [{id, label, cost, keeps, pressed, hinted, correct}]}]}
```
- **Cost model (shown, never hidden):** a plan is one option per knob and costs the sum of the picked options' costs, in `unit`. The widget states that rule, the cap and the needs; each option card shows its cost (a chip) and, in a hidden `data-keeps` line, what it keeps: the line stays hidden until a Check (a failed Check unhides the picked cards, a solve unhides every card), because knowing what an option keeps is the lesson; the kit meter (`#ID-meter`, label "Plan cost") draws the cost against the cap, every cell reading `over` when the plan is past it, and `#ID-total` (`aria-live=polite`) says `Within the cap, N unit to spare.` or `Over the cap by M unit.`. Sampling rates, retention periods and label/attribute choices are all just knobs with costs. Numbers are always grouped and rounded to 2 decimals (`formatAmount`; the meter groups the same way).
- **Pass rule:** `total <= cap` AND every need is in the `keeps` of at least one picked option. Exactly at the cap passes. A cheap plan that drops a need fails.
- **Interaction:** the step is wide: a kit split with the board and the side column (success card, score card with `#ID-wrong` failed Checks and hints, hint tools). Each knob is a `<fieldset>` (kit `radioGroup`, its legend authored HTML) holding `[data-knob]` and one kit `radio` option card per option (`[data-option]`, the real `<input type="radio">` inside; the picked card has `data-picked`, the dot and a border are the selected cue, the dot takes the focus ring and dims when locked); nothing is preselected. Picking is free and redraws the meter, the cap line and the cards in place. `#ID-check` (primary) grades the plan; `label`, `whyNot` and `explain` are trusted authored HTML, `unit` and ids are escaped. Option labels and `<code>` wrap anywhere, so nothing overflows at 320px.
- **Outcomes:** `right` = the plan passes: success tone, `Right. This plan costs N of CAP unit and keeps everything you need. <explain>`, cards and Check lock (the picked cards `data-state="correct"`), `onComplete()`, the success card (swirl once, heading focused). A failing plan is one mistake (I1) in `mountTradeoff` only (`ladder.miss()`: `ctx.mistake()` and `#ID-wrong`), in the error tone: `Not quite.` plus one of `Over the cap by M unit.`, `It is within the cap but drops what you need: <labels>.` or, when both apply, `Over the cap by M unit, and it drops what you need: <labels>.`, then the `whyNot` of each picked option that has one. The right plan is never named. Any failing plan tried before is free (neutral `You already checked this plan. Nothing new was counted.`); Check with a knob unpicked is free (neutral `Pick an option for every knob first.`).
- **Hints (`lib/widgets/trade-off-help.mjs`, `helps.hints`, default off; the shared `mountHintLadder`):** three tiers, each one `ctx.hint()` and one hint on the card (a star by the one rule), never a mistake, derived only from `evaluatePlan` and the spec's `answer` (no second grader). Tier 1: `spec.hint` or the generic rule. Tier 2 outlines two option cards of one knob (`data-hinted`): the first knob, in spec order, whose pick is not the answer's, with the answer's option and one decoy drawn through `ctx.shuffle` so the pair never says which is which; when the picks already pass, nothing and "Press Check." Tier 3 picks the answer and runs the same Check (neutral `Picked for you. ...`, not earned). Outlines stay until success. Levels 3.5 cardinality, 6.1 head-sampling, 6.2 tail-sampling and 6.3 what-costs-money turn hints on and author a tier 1 `hint`; 9.2 (a live-demo question) leaves them off.
- **Solvability (I7):** `validateTradeoffSpec` enumerates every plan (at most 5^5) and requires: the `answer` passes; some plan within the cap drops a need; some plan keeps every need but is over the cap. So the puzzle is a real trade-off, not a cap alone or a signal alone. The generated step driver plays the `answer`, and slips with one plan of each failing kind (and a hint when hints are on).
- **A11y and focus:** feedback is `role=status aria-live=polite tabindex=-1`; the cap line is `aria-live=polite`; with `labelledBy` the widget is a labelled group. Focus: first radio on mount, stays on the picked radio, feedback after a Check that does not finish, the success card's heading after the last (`onComplete()` only enables Finish). No timers (I2).

### 4.6 Query it core (M2, #4, part 1)
Core `lib/promql/` (`lex`, `parse`, `math`, `eval`, `grade`, `datasets`). Pure, DOM-free, no timers (I2), no randomness. The view and the `query` step type are part 2 (§4.7).
```
evaluate(dataset, time, query) → {kind:'vector', series:[{labels, value}]}   // sorted by label set
                               | {kind:'scalar', value}
                               | {kind:'syntax', message, at}               // at = character offset
                               | {kind:'unsupported', what}
                               | {kind:'error', message}                    // runtime: many-to-one matching, duplicate label sets
gradeQuery(dataset|name, time, query, referenceQuery) → {ok:true, result} | {ok:false, reason, result, ...detail}
parse(text) → {kind:'ok', ast} | the failure results above        getDataset(name), datasetNames(), DATASETS
Dataset = {id, title, meta, series: [{labels: {__name__, ...}, samples: [[t, v]]}]}   // seconds, ascending
```
**Supported subset** (anything else is `unsupported`, never a wrong verdict; a syntax error is only for text that is not PromQL):

| Feature | Supported | Notes |
|---|---|---|
| Selectors | `name`, `name{l="v", l!="v", l=~"re", l!~"re"}`, `{__name__="n", ...}` | at least one matcher must not match `""`; an absent label equals `""`; regexes fully anchored |
| Range vectors | `sel[5m]`, `[1h30m]`, units `ms s m h d w y` | only as the argument of `rate`/`increase` |
| Functions | `rate`, `increase`, `histogram_quantile(φ, v)` | `φ` is any scalar expression |
| Aggregation | `sum avg min max count`, `by (…)`, `without (…)`, clause before or after the argument | no clause = one group |
| Arithmetic | `+ - * /`, unary `-`, parentheses, number literals (`1e3`, `Inf`, `NaN`) | precedence `* /` over `+ -`, left-associative |
| Comparison filters | `== != < > <= >=` between vector and scalar, scalar and vector, vector and vector | keeps the vector's sample; no `bool` |
| Vector matching | one-to-one on identical label sets (ignoring `__name__`), `on(…)`, `ignoring(…)` | many-to-one is a runtime `error` |

**Unsupported (reported as such):** `offset`, `@`, subqueries (`[5m:1m]`), `bool`, `and`/`or`/`unless`/`atan2`, `^`, `%`, `group_left`/`group_right`, string literals, a bare range vector as the result, aggregations `topk bottomk quantile stddev stdvar count_values group limitk limit_ratio`, and every other Prometheus function (`irate`, `delta`, `*_over_time`, `label_replace`, `abs`, `clamp*`, `time`, `vector`, ...: the full list is `KNOWN_FUNCS` in `parse.mjs`). A name that is not a Prometheus function is a `syntax` error ("unknown function"). Type errors (`rate(x)`, `sum(x[5m])`, `1 > 2`) are `syntax` errors, as in Prometheus.

**Semantics (Prometheus 3.x; docs: [basics](https://prometheus.io/docs/prometheus/latest/querying/basics/), [operators](https://prometheus.io/docs/prometheus/latest/querying/operators/), [functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)):**
- *Instant selector:* the newest sample in `(t - 300s, t]` (default 5m lookback delta; left-open, as in 3.x). No staleness markers.
- *Range window* of `[R]` at `t` is `(t - R, t]`, left-open (3.x; 2.x was closed).
- *`rate`/`increase`* port `extrapolatedRate`: both treat the series as a counter; a sample below its predecessor is a reset and adds the predecessor. `delta = last - first (+ resets)`. With `sampled = lastT - firstT` and `avg = sampled / (n - 1)`: start gap `toStart = firstT - (t - R)`, then clamped to `sampled * first / delta` (the counter was never negative) when `delta > 0 && first >= 0`; end gap `toEnd = t - lastT`. A gap `>= 1.1 * avg` extrapolates by `avg / 2`, a smaller gap by the whole gap; the start gap is reduced to `avg / 2` first and only then clamped (the 3.x order, `promql/functions.go` `extrapolatedRate` at v3.0.0; 2.x clamped first). `increase = delta * (sampled + startExt + endExt) / sampled`; `rate` divides that by `R` (the selector range). Fewer than 2 samples in the window: the series is absent, not 0. So `increase(x[R]) / R` equals `rate(x[R])`. Both drop `__name__`.
- *`histogram_quantile`* ports `bucketQuantile` for classic buckets: series are grouped by every label except `le` and `__name__`; a series with no parsable `le` is ignored; buckets are sorted, equal bounds summed, counts made monotonic (raised to the predecessor). `rank = φ * total`; the first finite bucket with `count >= rank` is interpolated linearly from its lower bound (0 for the first bucket, unless its bound is `<= 0`, which answers that bound); a rank above every finite bucket (inside +Inf) answers the highest finite bound. No `+Inf` bucket, fewer than 2 buckets or zero observations: NaN (a result, not absence); `φ < 0` is `-Inf`, `φ > 1` is `+Inf`.
- *Aggregation* drops `__name__`; `by` keeps only the listed labels, `without` drops them. `min`/`max` ignore NaN unless all inputs are NaN. An aggregate over no series is empty (not 0).
- *Binary operators:* arithmetic drops `__name__`, comparison filters keep it. A vector with no partner is dropped; with `on(…)` the result carries only those labels. Duplicate label sets in a result are an `error`, as in Prometheus. `x / 0` is `±Inf`, `0 / 0` is NaN, kept as samples.
- **Deviations (deliberate, smallest-thing):** `avg` is `sum / count` (Prometheus uses an incremental mean, differences are below the grading tolerance); histogram monotonic fix is a plain running max (newer Prometheus also ignores tiny float-noise deltas); string escapes follow Go (`\\ \" \' \n \t \r \a \b \f \v \xNN \uNNNN \UNNNNNNNN \NNN`; `\'` only in single quotes, `\"` only in double; backticks take none) and any other escape is a `syntax` error, so a regex digit class is `"\\d+"`; `=~` uses JavaScript regular expressions anchored with `^(?:…)$` (Prometheus uses RE2: lookaheads and backreferences work here and would not there); no native histograms, no staleness markers, no `-query.lookback-delta` override, no `@`/`offset`; hex literals and quoted UTF-8 label names are not lexed.

**Grading:** `gradeQuery` evaluates the reference query (a text) and the learner's query on the same dataset at the same `time` and compares the RESULT series, never the query text, so any equivalent formulation passes. Both results are sorted by label set. Order of checks, first hit wins: `syntax` (+`message`, `at`), `unsupported` (+`what`), `error` (+`message`) → `empty` (vector with no series) → `wrong-count` → `wrong-labels` (same count, different label sets; a scalar answer to a vector question, or the reverse, also lands here; `__name__` is part of the label set) → `wrong-values` (a value outside tolerance) → `{ok:true}`. Scalar vs scalar compares by value. Tolerance: `|a-b| <= 1e-9 + 1e-6 * max(|a|,|b|)`; NaN equals NaN, infinities equal themselves. `result` (the learner's evaluation) rides along so the view can show it; it is never a hint at the reference. A reference that gives no data (or fails) is an authoring bug and throws, so the I7 check is: every level's reference query grades `ok` against itself on its dataset.

**Datasets:** `DATASETS = {name: generator}` in `datasets.mjs`, read through `getDataset(name)` (built once, deep-frozen, throws on an unknown name). A level names a dataset (and an eval time) and never inlines series. `checkout-http`: scrape every 15s for t = 0..3600; `http_server_requests_total{service,route,status}`, `http_server_request_duration_seconds_{bucket{le},sum,count}{service,route}` for checkout `/pay` `/quote` and cart `/add` `/view`. At `meta.deployAt` = 2400 the checkout counters reset (pods restart, so `rate` must cope) and `/pay` gets slower (p99 0.9s → 2.5s) and failing (1/30 → 1/4 of requests); other routes do not change. `meta.end` = 3600 is the natural eval time. The generator's per-scrape table is the single source for every figure in `test/promql-datasets.test.mjs`. `checkout-spanmetrics` (M3 P3, level 3.7): the same traffic as a Collector's spanmetrics connector emits it, `traces_span_metrics_calls_total{service_name,span_name,span_kind,status_code}` and `traces_span_metrics_duration_milliseconds_{bucket{le},sum,count}`; a success is `STATUS_CODE_UNSET`, a status series exists only once seen, there is no restart reset (the connector holds the count), and checkout's outbound call is a `SPAN_KIND_CLIENT` series.

### 4.7 Query it (M2, #4, part 2)
Core `lib/widgets/query-it.mjs`, view `lib/widgets/query-it-view.mjs`, list data `lib/promql/supported.mjs`; step type `query`, mechanic `query`.
```
QuerySpec = { id, dataset: name, at: seconds, reference: query, given?: text, hint?: html, explain: html }
validateQuerySpec(spec) → string[]   // kebab id, known dataset, at inside the dataset's start..end, reference gives data (so it grades ok
                                     // against itself, I7), given (if any) does NOT already pass, explain/hint/given non-empty text
newQueryState(spec) → {tried: [], solved: false}
runQuery(spec, st, text) → {state, outcome, reason?, grade?}
  outcome: right | wrong (+reason: empty | wrong-count | wrong-labels | wrong-values) | syntax | unsupported | error | repeat | blank | solved
SUPPORTED → [{title, items: string[], note}]   // functions, aggregations, units and operators read from the parser's own tables
```
- **Grading** is `gradeQuery(dataset, at, text, reference)` (§4.6): result series, never query text, so the reference and any equivalent formulation pass. A level names the dataset and the time; it never inlines data.
- **Documented in the widget:** a collapsible `Supported here` list rendered from `SUPPORTED` (one source; a test evaluates every listed function and aggregation) plus "Anything else is reported as unsupported, not as wrong."
- **Interaction:** a labelled `<textarea>` (monospace, no spellcheck/autocorrect/autocapitalize, prefilled with `given`), `#ID-input`, `#ID-run`, `#ID-feedback`. The wide kit splits: the board holds the editor panel and the Result panel `#ID-result`; the side column holds the success card `#ID-win`, the score card and, with `helps.hints`, the Hint ladder (`#ID-hint`, `#ID-hint-text`, tiers 1 to 3). `explain` and `hint` are trusted authored HTML; the dataset title, query text, labels, values and every engine message are escaped.
- **Result display:** each Run shows the learner's own result: a table of `series` (`name{a="b"}`, labels sorted) and `value` (six significant digits, `+Inf`/`-Inf`/`NaN`), at most 20 rows then `and N more series`, or, for a scalar, a one-row table (`Kind`, `Value`: `Scalar`, the value). The reference result is never shown.
- **Outcomes:** `right`: `Right. <explain>` (success tone); tier 3 runs the reference as neutral `Filled in for you. <explain>`; the textarea is read-only, Run and Hint are disabled, `onComplete()` once, the success card is shown. `syntax`, `unsupported`, `error` are FREE: `Syntax error at character N: ...`, `Not supported here: <what>. Nothing was marked wrong; ...`, `That query could not run: ...`; they are not remembered. `wrong` costs one mistake (I1) in `mountQuery` only: `Not quite.` plus `Your query returned no data.`, `Different series than expected: the number of series is not right.` / `...the labels are not right.` or `Right shape, wrong values.` The same failing query again (whitespace trimmed and collapsed) is `Same as last time: ...` (free). Blank text is free.
- **Solvability (I7):** `validateQuerySpec` guarantees the reference gives data and `given` is not already a pass. The generated step driver types the reference and Runs; its slip is `(reference) + 1`, valid, with the reference's series and wrong values, costing exactly one mistake. The equivalent-query proof is in `test/query-it-view.test.mjs`.
- **A11y and focus:** feedback is `role=status aria-live=polite tabindex=-1`; with `labelledBy` the widget is a labelled group. Focus: the textarea on mount; a Run that does not finish leaves focus where it is (the live region announces it, so the player keeps typing); `onComplete()`'s return after the pass. On the pass the success card heading takes focus (`#ID-win-title`) and the swirl plays once. No timers (I2).

### 4.8 Configure it core (M2, #3, part 1)
Core `lib/configure/` (`parse`, `paths`, `schema`, `check`, `collector`). Pure, DOM-free, no timers (I2), no randomness. The view and the `configure` step type are part 2 (§4.9). YAML is read by the vendored js-yaml 5.5.0 (MIT, `vendor/js-yaml-5.5.0.mjs`, pinned in `vendor/SHA256SUMS`), imported by a relative path so `node --test` and the browser load the same file; it is loaded only in `parse.mjs`, with its CORE schema (YAML 1.2 core: no timestamps, binary, `<<` merge or language tags).
```
parseYaml(text) → {ok:true, doc} | {ok:false, error}      // doc is a plain mapping; throws TypeError if text is not a string
checkConfig(text, schema) → {ok, errors: Error[], doc: mapping|null, verdict: Verdict|null}   // throws on a malformed schema
describeError(error) → string                              referenceProblems(schema, reference, given?) → string[]
validateSchema(schema) → string[]                          COLLECTOR_SCHEMA, MAX_CHARS, joinPath, resolvePattern
Error = {kind, path, message, ...detail}                   // path = key path of the offending key; '' for file-level errors
Verdict = {flowing, pipelines: [{name, flowing, reasons: Error[]}], inactive: [{section, id}]}
```
**Input is untrusted.** Safe load only. Text over `MAX_CHARS` = 32768 characters is refused unparsed. js-yaml's own nesting limit (100) turns absurd nesting into a `parse` error. An alias (`*name`) of a mapping or list is refused (`alias`, `path` = the second place it is used), found by walking each collection once, so an alias bomb is refused without being expanded; an alias of a scalar copies a value and is accepted. A `__proto__` key is an ordinary key. Schema and path lookups follow own properties only.

**File-level errors** (`parseYaml`, and so the only error of `checkConfig`; `doc` and `verdict` are then null). `line` and `column` are 1-based, or null when js-yaml gives no position:

| kind | message | extra |
|---|---|---|
| `too-large` | `the file is longer than 32768 characters` | line, column null |
| `parse` | js-yaml's own reason, verbatim (e.g. `bad indentation of a mapping entry`, `unknown scalar tag !<tag:yaml.org,2002:js/function>`, `expected a single document in the stream, but found more`) | `line`, `column` of the mark |
| `duplicate-key` | `duplicate key` | `line`, `column` of the second key |
| `root` | `the top level must be a mapping, got a list`; also `... got a string`, `... got a number`, `... got a boolean`, `... got null`, `the top level must be a mapping, got an empty document` (no text, or only comments; LF, CRLF and lone CR line endings all count) | line, column null |
| `alias` | `aliases (*name) are not supported` | `path` of the reused node, e.g. `use` or `l[1]` |

**Schema format** (plain data; `validateSchema` lists authoring mistakes and `checkConfig` throws `invalid schema: ...` on any, so a typo cannot pass everything. It checks node types and properties; that `at`, `in` entries, `key`, `keyPattern`, `keyExpect` and `required` entries are strings (messages like `refs[0]: at must be a string`, `pipelines.stages[0]: key must be a string`, `pipelines.stages[0]: in entries must be strings`, `root: keyPattern must be a string`); that a stage `key` is one plain key (`pipelines.stages[0]: key "r.s" must be a single plain key`); and that no object has an unknown property, e.g. `schema: unknown property "refz"`):
```
{ root: Node,
  refs?: [{at: pattern, in: [path]}],                       // each string at `at` must be a key of a mapping at one of `in`
  pipelines?: {at: path, stages: [{key, in: [path]}]} }     // `at` is a mapping of pipelines; each pipeline's list `key` is a ref into `in`
Node = {type: 'mapping', keys?: {k: Node}, required?: [k], additional?: Node, keyPattern?: regex source, keyExpect?: text,
        nullable?: true, min?: n}                           // keys not in `keys` use `additional`, else are unknown; null is allowed only if nullable
     | {type: 'list', items: Node, min?: n}
     | {type: 'string'|'number'|'integer'|'boolean', enum?: [value]}
     | {type: 'any'}
```
Paths are dotted keys with `[i]` for list items; a key that is not letters, digits, `_`, `-` or `/` is quoted (`resource["a.b c"]`). A pattern is the same with `*` (every key of a mapping) and a final `[]` (every item of a list): `service.pipelines.*.receivers[]`.

**Schema errors** (`checkConfig`), in order: the walk of the document (for a mapping: `min`, then `required`, then each key in the order written), then every ref in schema order (`refs`, then the pipeline stages), each in document order. Each key is reported once: a wrong type is not also checked for enum, and a `bad-key` value is not checked as well.

| kind | path | message | extra |
|---|---|---|---|
| `wrong-type` | the value | `expected a mapping, got a list`, `expected an integer, got a string` (`a mapping`, `a list`, `a string`, `a number`, `an integer`, `a boolean`; got also `null`) | `expected`, `got` (`mapping list string number integer boolean null`) |
| `bad-value` | the value | `must be one of "1.0", "1.1"` | `allowed` |
| `missing-key` | the missing key | `missing required key "exporters"` | |
| `unknown-key` | the key | `unknown key "log_levl"` | `allowed` (sorted) |
| `bad-key` | the key | `invalid key "Bad": expected <keyExpect>` (default `a key matching <keyPattern>`) | |
| `too-few` | the list or mapping | `needs at least 1 item` / `needs at least 2 items`, `needs at least 1 entry` / `needs at least 2 entries` | `min` |
| `unknown-ref` | the item, e.g. `service.pipelines.traces.exporters[1]` | `"otlp/typo" is not defined under exporters or connectors` (`a`, `a or b`, `a, b or c`) | `ref`, `in` |

A non-string ref item is the schema's `wrong-type`, not a second error.

**Verdict** (only with `schema.pipelines`; null after a file-level error). One entry per key of the pipelines mapping, in document order. A pipeline's `reasons` are the errors whose path is at or under it (`service.pipelines.traces`, `...traces.exporters[1]`, a missing `exporters`, a pipeline that is not a mapping, an invalid pipeline name), and its `flowing` is "no reasons": its own wiring. The top-level `flowing` is also false when the config has any error anywhere (a Collector refuses to start then) or has no pipeline. `inactive` lists components defined in a stage's `in` sections that no pipeline names (a Collector ignores them silently): a note for the view, not a stall. `ok` is "no errors"; a config is *passing* when `ok` and (no verdict or `verdict.flowing`).

**`COLLECTOR_SCHEMA`** ([config docs](https://opentelemetry.io/docs/collector/configuration/)): a deliberate subset. Top-level keys `receivers processors exporters connectors extensions` (a mapping of component ids to a settings mapping or nothing; settings are not checked; an id is `type` or `type/name`, `^[A-Za-z0-9_]+(/\S+)?$`) and `service` (required, with `pipelines` required, `extensions` a list of ids and `telemetry` any mapping). Pipelines are named `traces`, `metrics` or `logs`, optionally `/name`; each needs `receivers` and `exporters` (at least one item each) and may have `processors`. References: receivers must be defined under `receivers` or `connectors`, processors under `processors`, exporters under `exporters` or `connectors`, `service.extensions` under `extensions`. Not modelled: a connector used on only one side, component settings, the `profiles` signal.

**Authoring check (I7):** `referenceProblems(schema, reference, given?)` returns `[]` or messages: `reference: <describeError>` for every error of the reference (`describeError` is `path: message`, or `line L, column C: message` for a positioned file-level error, or the bare message), `reference: no pipeline flows` for a reference that has no error and no flowing pipeline, and `given: already passes the checker, so there is nothing to fix`. A given that does not parse counts as failing. Part 2's generated suites call it for every `configure` step.

### 4.9 Configure it (M2, #3, part 2)
Core `lib/widgets/configure-it.mjs`, view `lib/widgets/configure-it-view.mjs`; step type `configure`, mechanic `configure`.
```
ConfigureSpec = { id, schema: name, given: yaml, reference: yaml, target?: [pipeline name], uses?: {pipeline name: [component id]}, extensions?: [component id], forbids?: {pipeline name: [component id]}, hint?: html, helps?: {hints: boolean}, explain: html }
                  // hint is tier 1, shown only when helps.hints is on; validateConfigureHelps (next to validateConfigureSpec) checks that helps is well formed and that hint, when present, is non-empty text and only with helps.hints on (without one, tier 1 is the default rule)
SCHEMAS → {collector: COLLECTOR_SCHEMA}           // data holds the name, code holds the schema
validateConfigureSpec(spec) → string[]            // kebab id, known schema, given/reference/explain/hint non-empty text, target a non-empty list
                                                  // of unique names; uses a non-empty mapping of pipeline name to a non-empty list of unique ids; then referenceProblems (I7: the reference passes its own checker, given does
                                                  // NOT), "target "x": the reference has no flowing pipeline with that name", and for uses the same plus
                                                  // "uses "x": the reference does not list "id"". `extensions` is a non-empty list of unique ids, each enabled by the reference under
                                                  // service.extensions; `forbids` a non-empty mapping of pipeline name to a non-empty list of unique ids the reference's
                                                  // pipeline does not list. Never throws.
newConfigureState() → {tried: [], solved: false}
runConfigure(spec, st, text, {check?}) → {state, outcome, reason?, result?, unmet?}
  outcome: right | wrong (+reason: invalid | target | uses | forbids | extensions) | parse | crash | repeat | blank | solved
renderConfigure(spec, st, {escapeHtml, labelledBy?}) → html      mountConfigure(ctx, spec, {onComplete, check?, swirl?})
```
- **Right** means `checkConfig` passes (`ok` and the verdict flows) and every pipeline in `target` or named by `uses` is in the verdict and flowing, and every `uses` pipeline lists each of its component ids (exactly as written, e.g. `batch`, `otlp/dash0`) in at least one stage (receivers, processors or exporters, read from `result.doc`). `uses` implies `target` for its pipelines: they need not be listed in both. Every `extensions` id must be enabled in the schema's extension list (`service.extensions`, read through the schema's `extensions` ref), and no `forbids` pipeline may list any of its ids in any stage. Grading is on the checker's result, never on the text, so the reference and any equivalent YAML pass.
- **Grading (I1).** Costs one mistake, in `mountConfigure` only: `wrong/invalid` (schema or wiring errors: the Collector would not accept it) `wrong/target` (valid, but a required pipeline is missing or stalled, `unmet` names them) `wrong/uses` (every required pipeline flows, but a `uses` pipeline leaves a required component out; `unmet` names the pipelines, never the ids), `wrong/forbids` (a `forbids` pipeline lists a ruled-out component; `unmet` names the pipelines) and `wrong/extensions` (a required extension is not enabled; `unmet` is `['extensions']`, never the ids), when the normalised text differs from every earlier wrong one. Normalised = LF line endings, trailing spaces and outer blank lines dropped; indentation is kept because it means something in YAML. FREE: `blank`; `parse` (any file-level error of §4.8: too-large, parse, duplicate-key, root, alias; the learner is still typing); `crash` (see below); `repeat` (a failing config already tried, whitespace aside). Parse and crash are never remembered. A pass after a free outcome costs nothing extra.
- **Exceptions.** js-yaml 5 says to catch everything, and `parseYaml` rethrows what is not a `YAMLException`. `runConfigure` catches whatever the checker throws (any value) and returns `crash`; the view says `Could not check that text. Nothing was marked wrong.` and stays usable. `opts.check` replaces the checker so a test can make it throw.
- **Messages.** `Type a config first.` (blank); `Could not read that config as YAML. Nothing was marked wrong.` plus the error (parse); `Not quite. The Collector would not accept this config: N problem(s).` plus the errors (invalid); `Not quite. The config is valid, but there is no flowing pipeline named "p".` or `... these pipelines are not flowing: "a", "b".` (target); `The traces pipeline runs, but it does not do what the task asks yet.` (uses; several pipelines read `The traces and metrics pipelines run, but they do not do what the task asks yet.`, and it names the pipelines only, never the missing component ids); `You already checked this config. Nothing new was counted.` (repeat); `Right. <explain>`. Errors are data, one per item: the kind, then `path: message` or `line L, column C: message` (`describeError`); at most 20, then `and N more problems`. Feedback never shows the reference or what the checker would accept beyond its own messages.
- **Pipeline view (`#ID-pipelines`).** Redrawn after every Check that read the config (`right`, `wrong`, `repeat`), from the checker result alone: one entry per `verdict.pipelines` item in document order, its stages (`schema.pipelines.stages` keys, in order) read from `result.doc`: `Receivers: a → Processors: b, c → Exporters: d`, `none` for an empty stage, `(not defined)` after an item with an `unknown-ref` reason. A stalled pipeline lists its `reasons` (at most 5, then `and N more`). Above the list: `The Collector would start: every pipeline flows.`, `The Collector would not start.` (any error anywhere, even when every pipeline is wired) or `No pipelines are defined.`; below it, `Defined but not used by any pipeline: receivers/a, ...` from `verdict.inactive`. At most 20 pipelines, then `and N more pipelines`. After a `parse` the panel reads `Nothing to show until the YAML can be read.`; before the first Check, `Press Check to see which pipelines flow.` Nothing is hard-coded to a name; it is static (no animation, so nothing to reduce for `prefers-reduced-motion`).
- **Escaping (I3).** The textarea content (`given` and what the learner typed), pipeline and component names, key paths, messages and positions are escaped on both the render and the mount paths; `explain` and `hint` are trusted authored HTML.
- **A11y and focus.** As Query it (Run, not Check): a labelled monospace `<textarea>` (`#ID-input`, no spellcheck/autocorrect/autocapitalize), a `<button>` Check (`#ID-check`), `#ID-feedback` is `role=status aria-live=polite tabindex=-1`, and with `labelledBy` the widget is a labelled group. Focus: the textarea on mount; a Check that does not finish leaves focus where it is. On the pass the success card heading takes focus (`#ID-win-title`) and the swirl plays once.
- **Kit view and hint ladder.** A wide step: the board holds the editor panel and the Pipelines panel `#ID-pipelines`; the side column holds the success card `#ID-win`, the score card (failed Checks, hints, stars) and, with `helps.hints`, the Hint ladder (`#ID-hint`, `#ID-hint-text`, "Hint N of 3", then "No more hints"). A wrong config is the error tone, information is neutral. Each pipeline is an inset panel (`[data-pipeline]`, `data-state`) with a `Flowing` (neutral) or `Stalled` (error) chip, and `data-state` repeats it (the words carry the meaning, the tone only the dot and border). The solved textarea is read-only, never disabled; Check and Hint are disabled. Tiers (`hintFor`, `configure-it-help.mjs`): 1 the authored `hint` or the default rule, 2 the answer's shape against the player's config (never a component id), 3 fills the reference in and Checks it (no mistake; neutral `Filled in for you. <explain>`). Each tier is one `ctx.hint()` and one hint on the score card.
- **Solvability (I7).** The generated step driver types the reference and Checks; its slip is the reference plus an unknown top-level key (`zz-unknown: 1`), which parses, fails the checker (1 problem) and costs exactly one mistake, and a repeated Check on it is free. Level 1.2's env checker stays hand-written (DECLARATIVE-LEVELS open question 3).

### 4.10 Env config (level 1.2 step 2, #159 E1, #165)

The hand-written step of `levels/naming-your-service.mjs`, graded by `lib/widgets/env-config.mjs` (`checkConfig`, unchanged). A wide kit step: the lesson, then a kit split. The board is the helps chips and an `editorPanel` (`#nys-env`, `#nys-check`, the `#nys-feedback` region); the column is the kit `sideColumn` with the score card, the three-tier ladder and the success card, wired by `mountHintLadder` (`lib/widgets/help-ladder.mjs`). Steps 1 and 3 are narrow kit steps (`question`, `codeBlock`, `choiceHtml`).

- **Penalties (same rules as Configure it).** A new failing config costs one mistake and reads in the error tone; a config already checked (any earlier failing one, compared after `normalizeConfig`: LF line endings, no trailing spaces, no outer blank lines) is free and neutral, so a trailing newline or going back to an earlier text costs nothing more; a blank Check is free and neutral ("Type a config first."); a pass is the success tone, locks the editor read-only (never disabled) and shows the success card. Each Hint click is one `ctx.hint()`; the score card counts failed Checks and hints for this step only.
- **Ladder (`lib/widgets/env-config-help.mjs`, pure).** Tier 1 is the authored hint `ENV_HINT`, which names neither the service-name variable nor any value. Tier 2 reads the first problem `checkConfig` finds in the player's text, says where it sits through `ISSUE_VARIABLE` (issue code to variable and a value-free kind; a bad line gives its line number, a variable its line in the file; a variable absent from the file is said to be not set, and a wrong name that comes from the attribute list points at `OTEL_RESOURCE_ATTRIBUTES`, read from `effectiveResource`'s `source`) and sets the answer's pair count (`effectiveResource` of `REFERENCE`) against the player's. It never echoes a checker message, since those carry the expected value. Tier 3 fills `REFERENCE` and runs the same Check with `hinted: true`: never a mistake, a neutral "Filled in for you." A player who reaches tier 3 pays three hints (the old single hint cost one).
- **Tests.** `test/env-config-help.test.mjs` (the reference passes the grader, every issue code is mapped, leak checks) and `test/naming-your-service.test.mjs` (tiers, tones, counts, focus).

## 5. Phases (one PR each, never stacked, each mergeable to main)

| # | Phase | Owner | Depends | Must not batch |
|---|---|---|---|---|
| P0 | Unlock rule: act open once entered; FOUNDATION §3; this file committed | backend | – | yes (changes unlock for all players) |
| P1 | Choice widget extracted from 1.2 (1.2's tests unchanged) | frontend | P0 | yes (refactors a shipped level) |
| P2 | Sort it widget (core + view + CSS) | backend + frontend | P1 | no |
| P3 | Act 0 levels 0.1–0.3 | frontend | P2 | yes (adds Act 0 before Act 1) |
| P4 | Act 0 boss "The pager" | frontend | P3 | no |
| P5 | Build it widget (trace + build-it + view + CSS) | backend + frontend | P1 | no |
| P6 | Act 2: 2.1, 2.2 (creates act-2) | frontend | P4, P5 | no |
| P7 | 2.3, 2.5 (Sort-based) | frontend | P6 | no |
| P8 | 2.4, 2.6 (propagation; events and links) | frontend | P6 | no |
| P9 | 2.7 | frontend | P6 | no |
| P10 | Incident engine (M1b) | backend + frontend | P1 | no |
| P11 | Act 2 boss "Checkout is slow" + triage (M1b) | backend + frontend | P5, P7–P10 | yes (last Act 2 change) |

Every level PR notes that `EXPECTED_ORDER` in `test/live-registry.test.mjs` was extended on
purpose. Copy "verify before writing" items (profiles maturity, span-event deprecation, Python
context-manager status, Node double instrumentation) are checked against the spec in the PR.

## 6. Content

All levels `scoring.parMs: null`. Acts: `{id:'act-0', no:0, name:'Orientation', sub:'Day one'}`,
`{id:'act-2', no:2, name:'Traces', sub:'Follow the request'}`.

**`lights` (Q4: fewer).** Act 0: none. 2.1 `['storefront','api-gateway']`; 2.2 `['payments']`;
2.3 `['catalog']`; 2.4 `['orders']`; 2.5 `[]`; 2.6 `[]`; 2.7 `['cart']`; Act 2 boss
`['inventory']` (pulses while open). Saved for later acts: payment-provider, kafka, shipping,
notifications, recommendations, redis, postgres.

### Act 0
**0.1 `monitoring-vs-observability`**: sort; cards `[]`. Step 1 Sort into `known` / `new`:
cpu "Is CPU on db-1 above 90%?" known; 5xx "Has the checkout API 5xx rate stayed under 1%
for the last 5 minutes?" known; disk "Is the log disk down to 8 GB free space?" known; ios
"Why are only iOS 5.2 checkouts from Germany slow since 14:05 UTC?" new; cust "Is this one user hitting API
timeouts?" new; coupon "Is the coupon path slowing over 10% of carts with 20+ items?" new. No
blind rule (label length, `%`, a shared word) may sort these labels; `test/sort-tells.test.mjs` checks that. Step 2 choice "What makes the second kind
answerable?" → `rich` (telemetry with many attributes you can slice after the fact); decoys
dash, alerts, retention. Spec: https://opentelemetry.io/docs/concepts/observability-primer/#what-is-observability

**0.2 `the-signals`**: sort; cards `['profiles-signal']`. Step 1 Sort into metric/log/trace/
profile: `http.server.request.duration` histogram point → metric; `process.cpu.time` counter →
metric (Release Candidate, never "stable"); `{severity_text:"ERROR", body:"payment declined"}` → log; span `POST /checkout` with
trace_id/span_id/parent → trace; CPU stack samples per function → profile. Step 2 Sort
questions: req/s over 30 days → metric; which downstream call made this request slow → trace;
what exactly did the provider return → log; which function burns CPU in inventory → profile.
Step 3 choice: newest, still-maturing signal → profiles (decoys metrics, logs, traces). Card
front (≤140): "Profiles are OTel's fourth and newest signal. The profiles spec is Alpha, and
profiles in OTLP are still in Development, so expect changes." Verified 2026-10-30:
opentelemetry.io/docs/specs/otel/profiles/ "Status: Alpha"; opentelemetry.io/docs/specs/otlp/
"Development for the profiles signal"; proto v1.11.1; Collector v0.164.0 otlpreceiver profiles
alpha. Spec: https://opentelemetry.io/docs/concepts/signals/profiles/

**0.3 `why-opentelemetry`**: sort; cards `['api-vs-sdk']`. Step 1 Sort into api/sdk/otlp/
collector/semconv: `tracer.startActiveSpan('charge')` in a shared library → api; batch span
processor and sampler settings → sdk; the wire format sent to port 4318 → otlp; a separate
process that receives, filters, forwards → collector; the name `http.request.method` →
semconv. Step 2 choice: library `kettle-payments-client` used by 30 services depends on →
`api` (only `@opentelemetry/api`; no-op without an SDK; the app picks the SDK); decoys sdk,
exporter (an OTLP exporter), collector. Card front (≤140): "Libraries depend only on the OTel
API; only the app installs the SDK. Without an SDK, API calls are no-ops that record nothing."
The answer's `why` and the card back carry the full wording: "... Without an SDK, API calls are
no-ops: they record nothing and cost almost nothing." (not "do nothing": the trace API still
propagates SpanContext). Spec: https://opentelemetry.io/docs/concepts/instrumentation/libraries/#opentelemetry-api

**Boss `the-pager`**: `scored:false`; cards `[]`; lights `[]`. Two parts. Part 1, blind: the
intro states the goal ("Try the four questions below: you will find you cannot answer them,
because nothing sends telemetry yet. Each try burns error budget. When you give up, press
Escalate."). Alert "PAGE: checkout p95 > 2 s (firing)". Four looks (Which service? / Since
when? / Which customers? / Show me a trace), each reveals "No data. …" with the reason and
drops "Error budget: N% left" by 25. `#pager-escalate` "Escalate" (no `data-finish`) is
enabled after the first look and moves to part 2; the budget reaching 0 moves to part 2 by
itself. The budget also shows as a 4-cell kit meter ("N of 100 % spent") and a Spent on chip per look, in the order taken. Part 2, with telemetry: "Same alert, now with telemetry. Ask the same four questions.
The data is made up, for illustration. Ask all four to finish." The same four questions are
buttons (`data-ask`); clicking one reveals a made-up answer (service.name, a metric over time
with service.version, a span attribute, a trace; `CONTENT.telemetry` in
`levels/the-pager.mjs` cites the OpenTelemetry specs). Finish `#pager-finish` "Finish"
(`data-finish`) is enabled after all four are asked. Each part has its own status regions
(part 1: budget and feedback; part 2: answers), never both at once. Reward: "Blind, you
could not answer one question. With telemetry, all four took seconds. Time to instrument."

### Act 2
**2.1 `spans-and-traces`**: build; cards `['no-trace-object']`. Step 1 choice "What makes these
spans one trace?" → shared trace ID (decoy: "the SDK sends a trace object at the end"). Step 2
Build `edit:['parent']`, trace `4bf92f35` (8-char ids, the full id in a tooltip): A storefront `POST
/checkout` SERVER 0–100 root; B storefront `POST` CLIENT 10–90 → A; C api-gateway
`POST /checkout` SERVER 15–85 → B; D api-gateway `validate cart` INTERNAL 20–30 → C; E other
trace `0af76519` 40–60 stays root (overlaps C on purpose → `cross-trace-parent`). Step 3 choice
about E → another request. Card: "There is no trace object: a trace is just the spans that
share a trace ID, each exported on its own." Spec:
https://opentelemetry.io/docs/specs/otel/overview/#traces ,
https://opentelemetry.io/docs/specs/otel/trace/sdk/#span-processor

**2.2 `span-kinds`**: build; cards `['span-kind-edges']`. Build `edit:['kind']`, all given
INTERNAL; answer: checkout `POST /checkout` SERVER; checkout `POST payments` CLIENT; payments
`POST /charge` SERVER; payments `POST provider/charges` CLIENT; checkout `compute totals`
INTERNAL; orders `orders publish` PRODUCER; shipping `orders process` CONSUMER linked to the
publish span. "Map edges: …" line from `serviceEdges`. Step 2 choice: `/charge` set to
INTERNAL loses the checkout→payments edge. Card: "Span kind is not cosmetic: service maps draw
edges from CLIENT to SERVER and PRODUCER to CONSUMER pairs." Copy says "backends derive", not
"the spec says". Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind

**2.3 `status-and-errors`**: cards `['span-status']`. Sort into `ok` / `wrong`: a
storefront CLIENT `GET /products/999` 404 ERROR → ok; b catalog SERVER 404 ERROR → wrong (SERVER 4xx stays Unset); c
checkout SERVER 500 UNSET → wrong; d inventory SERVER 200 UNSET → ok; e payments SERVER
`POST /v1/charge` 503 ERROR → ok (a 5xx SHOULD be Error on a SERVER span). Split 3 ok / 2 wrong. No single rule sorts all five with fewer than two mistakes. Step 2 choice: Ok then
setStatus(Error) → stays Ok (Ok is final). Card: "Status starts Unset. A 4xx is Error on the
CLIENT span but stays Unset on the SERVER span. Ok is a final override." Spec:
https://opentelemetry.io/docs/specs/semconv/http/http-spans/#status ,
https://opentelemetry.io/docs/specs/otel/trace/api/#set-status

**2.4 `context-propagation`**: cards `['broken-propagation']`. Step 1 choice: hop headers
show nginx proxy dropping `traceparent`; waterfall shows two roots → the proxy. Step 2 choice: valid traceparent →
`00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01` (decoys: all-zero trace-id,
uppercase hex, 15-hex parent-id). Step 3 Build `edit:['parent']`: checkout's SERVER span's
parent is `00f067aa0ba902b7`. Card: "When a hop drops the traceparent header, one request
becomes two traces: look for unexpected root spans." Spec:
https://www.w3.org/TR/trace-context/#traceparent-header

**2.5 `baggage`**: cards `['baggage-leaks']`. Sort `ok` / `never`: `experiment.variant=redesign-B` ok;
`tenant.tier=gold` ok; `user.email` never; `session.token` never; `card.last4` never. Step 2 choice: do
recommendations' spans carry `tenant.tier` from baggage? → no, only if copied (e.g. a baggage
span processor). Card: "Baggage is not copied onto spans for you, and it travels in plain
headers to every downstream, third parties too." Spec:
https://opentelemetry.io/docs/concepts/signals/baggage/ , https://www.w3.org/TR/baggage/

**2.6 `events-and-links`**: cards `['exception-no-status','batch-links']`. Teaches that an
exception, however it is recorded (span event or log record), does not set the span status;
status is set separately, by the code or instrumentation that ends the span. Step 1 choice:
code records an exception (`span.recordException(err)`, rethrows, `span.end()` in `finally`)
and never sets a status → status unset (decoys: "Error: recording marked it failed"; "Error if
a span event, Unset if logged"). Step 2 Build `edit:['status']`: payments `charge` exception
recorded and escaped, given UNSET → ERROR; `charge with retry` (one span over the whole
charge, retries included) handled a reset and retried inside the span, nothing recorded,
given ERROR (set by a helper) → UNSET; inventory `GET /stock` no exception → UNSET.
Step 3 Build `edit:['links']`: notifications `send batch` CONSUMER (root) links the three
`orders publish` spans from three traces. Cards: "An exception record and the span status are
separate fields: recording one never sets the other. Set Error when the operation fails." (true in every
language, Python's context manager included: it sets Error on an escaping exception as a
separate step) / "A span has at most one parent. A consumer handling a batch from many traces
links to each message's context." The first card's back says semantic conventions 1.44 mark
exceptions on spans Deprecated in favour of log records, while the Trace API RecordException is
still Stable. Verified 2026-10-31 (P8): OTEP 4430 (merged 2025-04-25) only plans to deprecate
RecordException and AddEvent; spec v1.62.0 has not; semconv 1.44.0
`exceptions/exceptions-spans` is Deprecated, and `general/recording-errors` says to record an
exception as a log record and not to record handled ones. Spec:
https://opentelemetry.io/docs/specs/otel/trace/api/#record-exception ,
https://opentelemetry.io/docs/specs/semconv/general/recording-errors/ ,
https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/

**2.7 `auto-vs-manual`**: cards `['double-instrumentation']`. Step 1 Sort `auto` / `manual`:
HTTP server spans per route auto; Redis command spans auto; outgoing HTTP client spans auto;
"INTERNAL spans around `applyLoyaltyDiscount()` calls" manual; `app.coupon.code` on checkout span manual;
`app.cart.item_count` manual. Step 2 choice: each of cart's outgoing `fetch` calls shows two
CLIENT spans (operator-injected
`NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register` plus `tracing.js`
NodeSDK with `getNodeAutoInstrumentations()`) → two setups. Step 3 choice fix → keep one, add
business spans via the API (decoys: sample 50%, dedupe in Collector). Card: "Instrument the
same library twice, say an injected agent plus your own SDK setup, and each call can appear
twice." The card's back says duplicates depend on the instrumentation, and that fetch/undici
client spans are the case that doubles today. Verified 2026-10-31 (P9): with
auto-instrumentations-node 0.82 and sdk-node 0.300, an operator `--require .../register` agent
plus a `tracing.js` NodeSDK does not duplicate http/express server spans (patch-based
instrumentations unwrap before re-wrapping; the second SDK's global API registration fails),
but does duplicate the diagnostics_channel-based undici/fetch CLIENT spans
(opentelemetry-js-contrib #2229). Spec:
https://opentelemetry.io/docs/zero-code/js/ ,
https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/

**Boss `checkout-is-slow` (M1b)**: scored; budget start 100, burn 4%/min, `answerAfterViews:1` (one clue view: `trace-slow` or `triage`; the neutral `deploys` does not unlock).
Views: trace-slow 5 clue (inventory `GET /stock` with 40 sequential `SELECT stock` CLIENT
spans); triage 4 clue (`service.version` 2.4.0 = 100% of slow vs 7% of normal; region even);
deploys 2 neutral (2.4.0 at 14:03); checkout-logs 4, db-metrics 6, gateway-latency 4 neutral;
payments-errors 5 herring; redis-cpu 3 herring. Neutrals + clues = 25 min (exhaustion without a
herring). Hypotheses: n-plus-one (right), provider, redis, replicas.

## 7. RED test spec (summary; details per phase brief)

- P0: new rule cases: entered act stays open after an earlier act gains a level; un-entered act
  still waits; completed always `'done'`; boss rule unchanged; existing-player migration
  (`{naming-your-service:3}` → 1.2 done, act-1 open, act-0 open). Mutations: drop the "entered"
  clause; a boss-only completion doesn't enter; `levelState` disagrees with `lockReason`; the
  boss gate is skipped in an entered-only act.
- P1: `test/choice.test.mjs` (wrong/right/focus-wrap/TypeError); 1.2's tests and driver
  byte-identical (`git diff --stat` empty for them).
- P2: `test/sort-it.test.mjs` (validate, place outcomes incl. repeat/placed/unknown, frozen
  input, untried/remaining) and `test/sort-it-view.test.mjs` (render, penalties, drop path,
  focus sequence, `Pick an item first.`, no timers in `lib/widgets`).
- P3/P4/P6–P9: per level a DRIVER (happy 5★ + cards, sloppy fewer; one slip 4★), per-penalty runs, a content
  pin of the answer tables above, reference solvability via validators, focus walk ending on
  `[data-finish]`; `EXPECTED_ORDER` updated; `test/content.test.mjs` (Spec line, no em dash,
  specUrl hosts opentelemetry.io/www.w3.org). Pager: `scored:false`, `starTotals.max` unchanged.
- P5: waterfall rows/depth/x/width on fixture B1; orphan; `serviceEdges` incl. negative case;
  `setParent` cycle/self; `checkBuild` codes incl. `cross-trace-parent`; view penalties, recheck,
  escaping, SVG attributes only, focus.
- P10/P11: budget arithmetic (repeat free, clamp at 0, `exhaustedNow` once), answer outcomes,
  view penalties, the minutes-left headline, plus the kit meter's spent line and cells, all from `boardView`'s budget fields; triage percentages and `null` for empty sets.
