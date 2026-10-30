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
View `lib/widgets/sort-it-view.mjs`: `renderSort(spec, state, {selected, escapeHtml})` (item
buttons `data-item` + `aria-pressed`; bucket buttons `data-bucket`, disabled when tried for the
selected item or nothing selected; `[data-bucket-list]` of placed items; `#ID-feedback`).
`mountSort(ctx, spec, {onComplete})`: tap-to-place (item then bucket; keyboard-native); drag is
an enhancement calling the same path. Only `'wrong'` costs a mistake. Feedback: `Right. <label>
goes in <bucket>. <why>` / `Not quite. <label> is not <bucket>. <whyNot?>` (doesn't reveal the
answer) / `Pick an item first.` Focus: first remaining item → its first untried bucket → after
wrong, next untried bucket → after right, next remaining item → `onComplete()`'s return.

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
BuildSpec = { id, spans, edit: ⊆ ['parent','kind','status','links'], answer: {[spanId]: {...}}, hint? }
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

### 4.3 Incident engine (P10, M1b)
Core `lib/widgets/incident.mjs`:
```
Scenario = { id, alert: {title, html}, budget: {startPct 1..100, burnPctPerMin > 0},
  views: [{id, label, costMin, html, kind: clue|herring|neutral}],
  hypotheses: [{id, label, right, why}], answerAfterViews }
validateScenario(s) → string[]   // unique ids; exactly one right; all clues affordable
newIncident(s) → {opened: [], minutes: 0, wrong: [], solved: false}
budgetLeft(s, st) → max(0, startPct - minutes * burnPctPerMin)       // the ONLY budget expression
openView(s, st, id) → {state, outcome: opened|repeat|unknown|closed, herring, exhaustedNow}
canAnswer(s, st); answer(s, st, id) → right|wrong|repeat|locked|unknown|closed
```
View: alert, `<meter min=0 max=100 value=…>` + `Error budget: N% left (M min in).`, view
buttons `Label (N min)`, opened panels with `tabindex="-1"` headings, hypothesis buttons
disabled until `canAnswer`. Mistakes: first open of a herring, a wrong hypothesis (repeat free),
`exhaustedNow` exactly once.

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
dash, alerts, retention. Spec: https://opentelemetry.io/docs/concepts/observability-primer/

**0.2 `the-signals`**: sort; cards `['profiles-signal']`. Step 1 Sort into metric/log/trace/
profile: `http.server.request.duration` histogram point → metric; `process.cpu.time` counter →
metric; `{severity_text:"ERROR", body:"payment declined"}` → log; span `POST /checkout` with
trace_id/span_id/parent → trace; CPU stack samples per function → profile. Step 2 Sort
questions: req/s over 30 days → metric; which downstream call made this request slow → trace;
what exactly did the provider return → log; which function burns CPU in inventory → profile.
Step 3 choice: newest, still-maturing signal → profiles. Card front: "Profiles are OTel's
fourth signal and the newest; the profiles data model and its OTLP support are still
maturing." **Verify profiles' current status before copy.** Spec:
https://opentelemetry.io/docs/concepts/signals/ , https://opentelemetry.io/docs/specs/otel/profiles/

**0.3 `why-opentelemetry`**: sort; cards `['api-vs-sdk']`. Step 1 Sort into api/sdk/otlp/
collector/semconv: `tracer.startActiveSpan('charge')` in a shared library → api; batch span
processor and sampler settings → sdk; the wire format sent to port 4318 → otlp; a separate
process that receives, filters, forwards → collector; the name `http.request.method` →
semconv. Step 2 choice: library `kettle-payments-client` used by 30 services depends on →
`api` (only `@opentelemetry/api`; no-op without an SDK; the app picks the SDK). Card front:
"Libraries depend only on the OTel API; only the application installs the SDK. Without an
SDK, API calls do nothing." Spec: https://opentelemetry.io/docs/specs/otel/overview/#api ,
https://opentelemetry.io/docs/concepts/instrumentation/libraries/

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

**2.6 `events-and-links`**: cards `['exception-no-status','batch-links']`. Step 1 choice:
span with an `exception` event → status unset. Step 2 Build `edit:['status']`: payments
`charge` exception escaped → ERROR; `charge attempt 1` handled and retried → UNSET; inventory
`GET /stock` no exception → UNSET. Step 3 Build `edit:['links']`: notifications `send batch`
CONSUMER (root) links the three `orders publish` spans from three traces. Cards: "Recording an
exception adds an exception event; it does not set the span status to Error. Set that
yourself." / "A span has at most one parent. A consumer handling a batch from many traces
links to each message's context." **Verify the span-event deprecation (OTEP 4430) and
language context-manager behaviour before copy.** Spec:
https://opentelemetry.io/docs/specs/otel/trace/api/#record-exception ,
https://opentelemetry.io/docs/specs/semconv/general/recording-errors/ ,
https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/

**2.7 `auto-vs-manual`**: cards `['double-instrumentation']`. Step 1 Sort `auto` / `manual`:
HTTP server spans per route auto; Redis command spans auto; outgoing HTTP client spans auto;
span around `applyLoyaltyDiscount()` manual; `app.coupon.code` on checkout span manual;
`app.cart.item_count` manual. Step 2 choice: cart shows every request twice (operator-injected
`NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register` plus `tracing.js`
NodeSDK with `getNodeAutoInstrumentations()`) → two setups. Step 3 choice fix → keep one, add
business spans via the API (decoys: sample 50%, dedupe in Collector). Card: "Instrument the
same library twice, say an injected agent plus your own SDK setup, and each call can appear
twice." **Verify Node duplicate behaviour before copy.** Spec:
https://opentelemetry.io/docs/zero-code/js/ ,
https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/

**Boss `checkout-is-slow` (M1b)**: scored; budget start 100, burn 4%/min, `answerAfterViews:1`.
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
