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
- One slip costs one star: tests start from a clean run and add exactly one slip (→ 2★).
- Tests assert booleans/strings/numbers only (never DOM nodes); every run uses
  `NODE_OPTIONS=--max-old-space-size=2048`.
- Every level file has a `// Spec: <https URL>` line; teaching claims cite the spec.

## 2. Expression sites (one authoritative home each)

| Fact | Home |
|---|---|
| wrong choice costs one mistake; focus to next enabled choice (wrapping) | `mountChoice` (`lib/widgets/choice.mjs`); 1.2 rewired onto it in P1 |
| wrong sort placement costs one mistake; repeating it is free | `mountSort` |
| failed check costs one mistake unless identical to the last failed one | `mountBuild` (1.2 keeps its own copy; follow-up issue extracts it) |
| incident budget left | `budgetLeft(s, st)` only; meter value and text both formatted from it |
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
View `lib/widgets/sort-it-view.mjs`: `renderSort(spec, state, {selected, escapeHtml,
labelledBy?})` (item buttons `data-item` + `aria-pressed`; bucket buttons `data-bucket`,
disabled when tried for the selected item or nothing selected; `[data-bucket-list]` of placed
items; `#ID-feedback`; `labelledBy`, a plain-token heading id, makes the widget a labelled group).
Above the board every Sort it step shows one plain-text instruction, `<p class="sort-hint"
id="ID-hint">` ("Drag each item into the right bucket, or pick an item and then a bucket."),
the same on every step, not a live region; the item pool (`.sort-pool`) is a named group
(`role="group" aria-label="Items to sort"`) carrying `aria-describedby="ID-hint"`.
`mountSort(ctx, spec, {onComplete})`: tap-to-place (item then bucket; keyboard-native); drag is
an enhancement calling the same path. Only `'wrong'` costs a mistake. Feedback: `Right. <label>
goes in <bucket>. <why>` / `Not quite. <label> is not <bucket>. <whyNot?>` (doesn't reveal the
answer) / `You already tried <bucket> for <label>.` (a repeat; free) / `Pick an item first.`
Focus: first remaining item → its first untried bucket → after wrong, next untried bucket →
after right, next remaining item → `onComplete()`'s return.

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
View `lib/widgets/build-it-view.mjs`: SVG waterfall (`<rect>` x/width/y attributes, never
`style`) plus an `<ol>` text alternative (`name · service · KIND · status · start–end ms ·
Parent: …`); a panel for the selected span with only editable controls (`data-parent`,
`data-kind`, `data-status`, `data-link` + `aria-pressed`); `#ID-check`, optional `#ID-hint`
(`ctx.hint()` once). A new failing Check costs a mistake; an identical recheck is free
(`Same as last time: N problems.`); a refused cycle/self is free ("would make a loop").

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
  `waterfall(spans, {times})`), its `<ol>` of span rows (`… · Parent: … · Logs: N` once N >= 1
  records are attached), then the log stream `<ol class="build-logs">`: one `button.build-log`
  per record with `data-log` first and `aria-pressed`, spec order, text `time ms · SEVERITY ·
  service · trace_id=… · span_id=… · body · k=v, …`; a blank id reads `(none)`.
- **Select a record.** A dashed `<line class="wf-cursor">` at its time (`timeAxis(...).pct`)
  and the panel "Span context for "body" (service, time ms)": `data-attach` buttons, "No span
  context" (`data-attach="none"`) first, then every span in row order. Attaching is free and
  says `"body" now carries span_id=… and trace_id=… from <span>.` (or `now has no span context`).
  The ids come from `applyLogs`, never from the view.
- **Ticks.** A `<line class="wf-log">` on the row of the record's span at the record's time,
  hanging off the bar when the time is outside it. Positions are SVG attributes; CSS sets
  `vector-effect: non-scaling-stroke`.
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

### 4.3 Incident engine (P10, M1b)
Core `lib/widgets/incident.mjs`:
```
Scenario = { id, alert: {title, html}, budget: {startPct 1..100, burnPctPerMin > 0},
  views: [{id, label, costMin, html, kind: clue|herring|neutral}],
  hypotheses: [{id, label, right, why}], answerAfterViews }   // answerAfterViews = clue views to open first
validateScenario(s) → string[]   // unique ids; exactly one right; all clues affordable; answerAfterViews 0..clues
newIncident(s) → {opened: [], minutes: 0, wrong: [], solved: false}
budgetLeft(s, st) → max(0, startPct - minutes * burnPctPerMin)       // the ONLY budget expression
openView(s, st, id) → {state, outcome: opened|repeat|unknown|closed, herring, exhaustedNow}
canAnswer(s, st)   // the ONE unlock rule: not solved and >= answerAfterViews CLUE-kind views opened;
                   // neutral and herring opens never count (#120)
answer(s, st, id) → right|wrong|repeat|locked|unknown|closed
```
View: alert, `<meter min=0 max=100 value=…>` + `Error budget: N% left (M min in).`, view
buttons `Label (N min)`, opened panels with `tabindex="-1"` headings, hypothesis buttons
disabled until `canAnswer` (enough clues opened). While not `canAnswer` and not solved, a plain-text line
`<p class="incident-locked-hint" id="<id>-locked-hint">Look for more evidence before naming the cause.</p>`
sits above the hypotheses; it is derived from the same `canAnswer` result (no second statement of the unlock rule),
is the same text every time (never names the clue views or counts what remains), and is absent when unlocked,
when solved, and when a hypothesis is merely disabled because it was answered wrong. The hypotheses sit in
`role=group aria-label="Hypotheses"` with `aria-describedby` pointing at that line (only while it exists). It is
not a live region: `#<id>-feedback` stays the only one. Mistakes: first open of a herring, a wrong hypothesis (repeat free),
`exhaustedNow` exactly once.

### 4.4 Spot it (M2, #5)
Core `lib/widgets/spot-it.mjs`, view `lib/widgets/spot-it-view.mjs`; step type `spot`, mechanic `spot`.
```
SpotSpec = { id, target: 'config'|'span'|'metric', lines: [{id, text}] (2..12),
  faults: [lineId] (>=1, fewer than all lines), whyNot?: {[lineId]: html}, explain: html }
  config: any text per line; span: `key=value` per attribute; metric: `name{labels}` per series
validateSpotSpec(spec) → string[]   // kebab ids, unique, faults/whyNot name real lines, whyNot never on a fault
newSpotState(spec) → {selected: [], tried: [], solved: false}
toggleLine(spec, st, id) → {state, outcome: selected|unselected|unknown|solved}
checkSpot(spec, st) → {state, outcome: right|wrong|repeat|empty|solved, extra, missing}
```
- **Interaction:** each line is a real `<button aria-pressed>` whose name is its text, rendered escaped in `<code>` (monospace); `explain` and `whyNot` are trusted authored HTML. Toggling is free and updates in place. `#ID-check` grades the whole selection.
- **Outcomes:** `right` = the selection is exactly the fault set (order irrelevant): `Right. <explain>`, lines and Check lock, `onComplete()`. Anything else is one mistake (I1) in `mountSpot` only: `Not quite. N of your picks is/are not a fault.` plus the `whyNot` of each picked non-fault, or `Everything you picked is a fault, but there is more.` when nothing extra was picked. The faults are never named or counted. The same wrong selection again is free (`Same as last time: ...`); Check with nothing selected is free.
- **Solvability (I7):** `validateSpotSpec` guarantees the fault set is a non-empty proper subset of real lines, so the reference path (select the faults, Check) always passes; the generated step driver plays exactly that.
- **A11y and focus:** feedback is `role=status aria-live=polite tabindex=-1`; with `labelledBy` the widget is a labelled group. Focus: first line on mount, stays on the toggled line, feedback after a Check that does not finish, `onComplete()`'s return after the last. No timers (I2).

### 4.5 Trade-off (M2, #7)
Core `lib/widgets/trade-off.mjs`, view `lib/widgets/trade-off-view.mjs`; step type `tradeoff`, mechanic `tradeoff`.
```
TradeoffSpec = { id, unit, cap, knobs: [{id, label, options: [{id, label, cost, keeps?: [needId]}]}] (1..5 knobs, 2..5 options),
  needs: [{id, label}] (1..4), answer: {[knobId]: optionId}, whyNot?: {['knobId:optionId']: html}, explain: html }
validateTradeoffSpec(spec) → string[]   // kebab ids, unique per list, cost >= 0 and cap > 0 with at most 2 decimals,
                                        // keeps/answer/whyNot name real needs/knobs/options, whyNot never on an answer option
newTradeoffState(spec) → {picks: {}, tried: [], solved: false}
pickOption(spec, st, knobId, optionId) → {state, outcome: picked|unknown|solved}
evaluatePlan(spec, picks) → {complete, total, over, lost}   // total = sum of picked costs; over = total - cap (0 when within); lost = needs no picked option keeps
checkTradeoff(spec, st) → {state, outcome: right|wrong|repeat|incomplete|solved, total, over, lost}
```
- **Cost model (shown, never hidden):** a plan is one option per knob and costs the sum of the picked options' costs, in `unit`. The widget states that rule, the cap and the needs; each option shows its cost and what it keeps; a live line shows `Plan cost: N of CAP unit` and, past the cap, `over the cap by M unit`. Sampling rates, retention periods and label/attribute choices are all just knobs with costs. Numbers are always grouped and rounded to 2 decimals (`formatAmount`).
- **Pass rule:** `total <= cap` AND every need is in the `keeps` of at least one picked option. Exactly at the cap passes. A cheap plan that drops a need fails.
- **Interaction:** each knob is a `<fieldset>` with a `<legend>` and one radio per option; nothing is preselected. Picking is free and updates the total in place. `#ID-check` grades the plan; `label`, `whyNot` and `explain` are trusted authored HTML, `unit` and ids are escaped.
- **Outcomes:** `right` = the plan passes: `Right. This plan costs N of CAP unit and keeps everything you need. <explain>`, radios and Check lock, `onComplete()`. A failing plan is one mistake (I1) in `mountTradeoff` only: `Not quite.` plus one of `Over the cap by M unit.`, `It is within the cap but drops what you need: <labels>.` or, when both apply, `Over the cap by M unit, and it drops what you need: <labels>.`, then the `whyNot` of each picked option that has one. The right plan is never named. The same failing plan again is free (`Same as last time: ...`); Check with a knob unpicked is free.
- **Solvability (I7):** `validateTradeoffSpec` enumerates every plan (at most 5^5) and requires: the `answer` passes; some plan within the cap drops a need; some plan keeps every need but is over the cap. So the puzzle is a real trade-off, not a cap alone or a signal alone. The generated step driver plays the `answer`, and slips with one plan of each failing kind.
- **A11y and focus:** feedback is `role=status aria-live=polite tabindex=-1`; the total is `aria-live=polite`; with `labelledBy` the widget is a labelled group. Focus: first radio on mount, stays on the picked radio, feedback after a Check that does not finish, `onComplete()`'s return after the last. No timers (I2).

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
- **Interaction:** a labelled `<textarea>` (monospace, no spellcheck/autocorrect/autocapitalize, prefilled with `given`), `#ID-input`, `#ID-run`, optional `#ID-hint`, `#ID-result`, `#ID-feedback`. `explain` and `hint` are trusted authored HTML; the dataset title, query text, labels, values and every engine message are escaped.
- **Result display:** each Run shows the learner's own result: a table of `series` (`name{a="b"}`, labels sorted) and `value` (six significant digits, `+Inf`/`-Inf`/`NaN`), at most 20 rows then `and N more series`, or `Scalar: v`. The reference result is never shown.
- **Outcomes:** `right`: `Right. <explain>`, input, Run and hint lock, `onComplete()`. `syntax`, `unsupported`, `error` are FREE: `Syntax error at character N: ...`, `Not supported here: <what>. Nothing was marked wrong; ...`, `That query could not run: ...`; they are not remembered. `wrong` costs one mistake (I1) in `mountQuery` only: `Not quite.` plus `Your query returned no data.`, `Different series than expected: the number of series is not right.` / `...the labels are not right.` or `Right shape, wrong values.` The same failing query again (whitespace trimmed and collapsed) is `Same as last time: ...` (free). Blank text is free.
- **Solvability (I7):** `validateQuerySpec` guarantees the reference gives data and `given` is not already a pass. The generated step driver types the reference and Runs; its slip is `(reference) + 1`, valid, with the reference's series and wrong values, costing exactly one mistake. The equivalent-query proof is in `test/query-it-view.test.mjs`.
- **A11y and focus:** feedback is `role=status aria-live=polite tabindex=-1`; with `labelledBy` the widget is a labelled group. Focus: the textarea on mount; a Run that does not finish leaves focus where it is (the live region announces it, so the player keeps typing); `onComplete()`'s return after the pass. No timers (I2).

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
ConfigureSpec = { id, schema: name, given: yaml, reference: yaml, target?: [pipeline name], uses?: {pipeline name: [component id]}, hint?: html, explain: html }
SCHEMAS → {collector: COLLECTOR_SCHEMA}           // data holds the name, code holds the schema
validateConfigureSpec(spec) → string[]            // kebab id, known schema, given/reference/explain/hint non-empty text, target a non-empty list
                                                  // of unique names; uses a non-empty mapping of pipeline name to a non-empty list of unique ids; then referenceProblems (I7: the reference passes its own checker, given does
                                                  // NOT), "target "x": the reference has no flowing pipeline with that name", and for uses the same plus
                                                  // "uses "x": the reference does not list "id"". Never throws.
newConfigureState() → {tried: [], solved: false}
runConfigure(spec, st, text, {check?}) → {state, outcome, reason?, result?, unmet?}
  outcome: right | wrong (+reason: invalid | target | uses) | parse | crash | repeat | blank | solved
renderConfigure(spec, st, {escapeHtml, labelledBy?}) → html      mountConfigure(ctx, spec, {onComplete, check?})
```
- **Right** means `checkConfig` passes (`ok` and the verdict flows) and every pipeline in `target` or named by `uses` is in the verdict and flowing, and every `uses` pipeline lists each of its component ids (exactly as written, e.g. `batch`, `otlp/dash0`) in at least one stage (receivers, processors or exporters, read from `result.doc`). `uses` implies `target` for its pipelines: they need not be listed in both. Grading is on the checker's result, never on the text, so the reference and any equivalent YAML pass.
- **Grading (I1).** Costs one mistake, in `mountConfigure` only: `wrong/invalid` (schema or wiring errors: the Collector would not accept it) `wrong/target` (valid, but a required pipeline is missing or stalled, `unmet` names them) and `wrong/uses` (every required pipeline flows, but a `uses` pipeline leaves a required component out; `unmet` names the pipelines, never the ids), when the normalised text differs from every earlier wrong one. Normalised = LF line endings, trailing spaces and outer blank lines dropped; indentation is kept because it means something in YAML. FREE: `blank`; `parse` (any file-level error of §4.8: too-large, parse, duplicate-key, root, alias; the learner is still typing); `crash` (see below); `repeat` (a failing config already tried, whitespace aside). Parse and crash are never remembered. A pass after a free outcome costs nothing extra.
- **Exceptions.** js-yaml 5 says to catch everything, and `parseYaml` rethrows what is not a `YAMLException`. `runConfigure` catches whatever the checker throws (any value) and returns `crash`; the view says `Could not check that text. Nothing was marked wrong.` and stays usable. `opts.check` replaces the checker so a test can make it throw.
- **Messages.** `Type a config first.` (blank); `Could not read that config as YAML. Nothing was marked wrong.` plus the error (parse); `Not quite. The Collector would not accept this config: N problem(s).` plus the errors (invalid); `Not quite. The config is valid, but there is no flowing pipeline named "p".` or `... these pipelines are not flowing: "a", "b".` (target); `The traces pipeline runs, but it does not do what the task asks yet.` (uses; several pipelines read `The traces and metrics pipelines run, but they do not do what the task asks yet.`, and it names the pipelines only, never the missing component ids); `Same as last time: that config still does not pass.` (repeat); `Right. <explain>`. Errors are data, one per item: the kind, then `path: message` or `line L, column C: message` (`describeError`); at most 20, then `and N more problems`. Feedback never shows the reference or what the checker would accept beyond its own messages.
- **Pipeline view (`#ID-pipelines`).** Redrawn after every Check that read the config (`right`, `wrong`, `repeat`), from the checker result alone: one entry per `verdict.pipelines` item in document order, its stages (`schema.pipelines.stages` keys, in order) read from `result.doc`: `Receivers: a → Processors: b, c → Exporters: d`, `none` for an empty stage, `(not defined)` after an item with an `unknown-ref` reason. `Flowing` or `Stalled` is written as text and repeated in `data-state`; a stalled pipeline lists its `reasons` (at most 5, then `and N more`). Above the list: `The Collector would start: every pipeline flows.`, `The Collector would not start.` (any error anywhere, even when every pipeline is wired) or `No pipelines are defined.`; below it, `Defined but not used by any pipeline: receivers/a, ...` from `verdict.inactive`. At most 20 pipelines, then `and N more pipelines`. After a `parse` the panel reads `Nothing to show until the YAML can be read.`; before the first Check, `Press Check to see which pipelines flow.` Nothing is hard-coded to a name; it is static (no animation, so nothing to reduce for `prefers-reduced-motion`), and the border (solid or dashed) is a second cue, never the only one.
- **Escaping (I3).** The textarea content (`given` and what the learner typed), pipeline and component names, key paths, messages and positions are escaped on both the render and the mount paths; `explain` and `hint` are trusted authored HTML.
- **A11y and focus.** As Query it: a labelled monospace `<textarea>` (`#ID-input`, no spellcheck/autocorrect/autocapitalize), a `<button>` Check (`#ID-check`), optional `#ID-hint` / `#ID-hint-text`, `#ID-feedback` is `role=status aria-live=polite tabindex=-1`, and with `labelledBy` the widget is a labelled group. Focus: the textarea on mount; a Check that does not finish leaves focus where it is; `onComplete()`'s return after the pass.
- **Solvability (I7).** The generated step driver types the reference and Checks; its slip is the reference plus an unknown top-level key (`zz-unknown: 1`), which parses, fails the checker (1 problem) and costs exactly one mistake, and a repeated Check on it is free. Level 1.2's env checker stays hand-written (DECLARATIVE-LEVELS open question 3).

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
cpu "Is CPU on db-1 above 90%?" known; 5xx "Is the 5xx rate above 1%?" known; disk "Is the log
disk full?" known; ios "Why are only iOS 5.2 checkouts from Germany slow since 14:05?" new;
cust "Which customer IDs hit a payment timeout in the last hour?" new; coupon "Did the coupon
path slow carts with over 20 items?" new. Step 2 choice "What makes the second kind
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

**Boss `the-pager`**: `scored:false`; cards `[]`; lights `[]`. Alert "PAGE: checkout p95 > 2 s
(firing)". Four looks (Which service? / Since when? / Which customers? / Show me a trace), each
reveals "No data. …" with the reason and drops "Error budget: N% left" by 25. Finish
`#pager-escalate` "Escalate" (`data-finish`) enabled after the first look. Reward: "You could
not answer one question. Time to instrument."

### Act 2
**2.1 `spans-and-traces`**: build; cards `['no-trace-object']`. Step 1 choice "What makes these
spans one trace?" → shared trace ID (decoy: "the SDK sends a trace object at the end"). Step 2
Build `edit:['parent']`, trace `4bf92f3577b34da6a3ce929d0e0e4736`: A storefront `POST
/checkout` SERVER 0–100 root; B storefront `POST api-gateway` CLIENT 10–90 → A; C api-gateway
`POST /checkout` SERVER 15–85 → B; D api-gateway `validate cart` INTERNAL 20–30 → C; E other
trace `0af7…` 40–60 stays root (overlaps C on purpose → `cross-trace-parent`). Step 3 choice
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
checkout SERVER 500 UNSET → wrong; d inventory SERVER 200 UNSET → ok. Step 2 choice: Ok then
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

**2.5 `baggage`**: cards `['baggage-leaks']`. Sort `ok` / `never`: `experiment.variant=B` ok;
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
span around `applyLoyaltyDiscount()` manual; `app.coupon.code` on checkout span manual;
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
- P3/P4/P6–P9: per level a DRIVER (happy 3★ + cards, sloppy 2★), per-penalty runs, a content
  pin of the answer tables above, reference solvability via validators, focus walk ending on
  `[data-finish]`; `EXPECTED_ORDER` updated; `test/content.test.mjs` (Spec line, no em dash,
  specUrl hosts opentelemetry.io/www.w3.org). Pager: `scored:false`, `starTotals.max` unchanged.
- P5: waterfall rows/depth/x/width on fixture B1; orphan; `serviceEdges` incl. negative case;
  `setParent` cycle/self; `checkBuild` codes incl. `cross-trace-parent`; view penalties, recheck,
  escaping, SVG attributes only, focus.
- P10/P11: budget arithmetic (repeat free, clamp at 0, `exhaustedNow` once), answer outcomes,
  view penalties, meter value/text from one source; triage percentages and `null` for empty sets.
