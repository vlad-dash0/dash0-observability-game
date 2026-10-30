# Foundation design (M0)

Source of truth for F1–F6 (issues #9–#14, epic #15). Architect design, adapted from
the reference game `wealthbot-io/webo-money-world` ("R"; same author, code may be
reused directly). Every phase turns its slice of §6 into failing tests first, then
makes them pass, then proves each test by a one-line mutation of the implementation
(edit, see red, edit back).

## 1. Decisions

1. Levels never pass stars. ctx counts `mistake()` / `hint()`; one pure `scoreStars`
   turns counts into stars.
2. `act` and `kind` come from the registry position: `ACTS[i].levels[]` and
   `ACTS[i].boss` (module or null). A level file declaring `act` or `kind` is an error.
3. The map link lives on the level (`lights: nodeId[]`); `nodeLitBy` derives the reverse.
4. `no` (e.g. `'1.2'`) stays on the level file and is validated against act and order.
5. Unknown ids are dropped from the in-memory view but kept in storage (an older tab or
   a renamed level must not erase progress).
6. Standard Alpine 3.14.1 build + `'unsafe-eval'` in the CSP (as R does). No string
   `:style`, no `style=` attributes, so `style-src 'self'`.
7. `test/` (singular), plain `node --test "test/**/*.test.mjs"` (the bare default also
   runs `test/helpers/` and `test/fixtures/` as test files), `"type": "module"`, `.mjs` everywhere,
   relative imports, no top-level `window`/`document` access; Alpine referenced only in
   `main.mjs`.
8. One ctx implementation (`lib/level-context.mjs`) used by both app and test harness
   (R had two copies).
9. Fixed R bugs: stale `finish` crediting whichever lesson is open now; corrupt progress
   silently overwritten; `escapeHtml` not escaping `'`; sanitizer *cleaning* bad ids into
   real ones (we drop them).

Provisional answers (recorded on #16; the user can override):
success = mint `#a8fbbe`; error = purple `#ad46ff` (dash0.com purple-500); dark by
default with an explicit light toggle; star rule as §2.6; Martian Mono self-hosted
(OFL); no finale until after M0; F6 ships Act 1 only (first unlocked act).

## 2. Data contracts

### 2.1 Level module (`levels/<id>.mjs`, default export; defaults applied by `buildRegistry`)

| field | type | default | rule |
|---|---|---|---|
| id | string | required | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤64 chars, unique, never renamed |
| no | string \| null | required | non-boss `^<act.no>\.[1-9]\d*$` (levels number from 1, no leading zeros), increasing within the act; boss `null` |
| name | string | required | non-empty |
| sub | string | `''` | |
| icon | string | required | non-empty |
| rewardTitle | string | required | non-empty, unique |
| mechanics | string[] | required | ≥1, unique, from `sort build configure query spot incident tradeoff` |
| cards | string[] | `[]` | ids that exist in DECK, unique |
| lights | string[] | `[]` | ids that exist in map NODES, unique |
| scored | boolean | `true` | `false`: always 0 stars, excluded from both sides of star totals |
| scoring | `{parMs: number\|null}` | `{parMs: null}` | positive integer or null |
| run | `(ctx) => void` | required | function |
| act, kind | forbidden | | |

Rule: when `ctx.reduceMotion` is true a level must not wait on any timer (the harness
plays levels synchronously, as R does).

### 2.2 Acts (`levels/index.mjs`)

`export const ACTS = [{ id, no, name, sub, levels: Level[], boss: Level | null }]`.
`id` kebab, unique; `no` integer ≥0, strictly increasing (gaps allowed); `levels.length ≥ 1`.
Acts unlock by array position. Empty `ACTS` is valid.

### 2.3 Nuance card (`cards/deck.mjs`)

`export const DECK = [{ id, front, back, specUrl, dash0Angle }]`: kebab unique id;
non-empty `front` (≤140 chars) and `back`; `specUrl` starts `https://`; `dash0Angle`
non-empty string or `null`. Checked by `validateDeck`.

### 2.4 Built registry (shared by F3, F4, F5)

```
Registry = {
  acts:   [{ id, no, name, sub, levelIds: string[], bossId: string|null }],
  levels: { [id]: Level },  // null-prototype; Level = §2.1 + defaults + actId + kind:'level'|'boss'
  order:  string[],         // per act: its levels, then its boss
  cardIds: string[],        // sorted DECK ids
}
```
Deep-frozen. `buildRegistry(ACTS, {deck, nodeIds})` throws one `RegistryError` listing
every problem; `validateRegistry(ACTS, {cardIds, nodeIds})` returns `{ok, errors}` and
never throws. F4 codes against this shape with hand-written fixtures and does not import F3.

### 2.5 Progress (localStorage key `oncall.progress`)

```
{ v: 1,
  levels: { [levelId]: { stars: 0|1|2|3, at: string|null } },  // at = first completion, ISO UTC
  cards: string[] }                                             // sorted, unique
```
Completed = has an own entry, whatever its stars (`stars: 0` is real and distinct from no
entry). `CURRENT_VERSION = 1`; `MIGRATIONS = {}` where `MIGRATIONS[n]` maps v n → n+1.

`sanitizeProgress(raw, {levelIds?, cardIds?, keep?})`: never throws, never mutates, never awards.
- Not a plain object, or `levels` not a plain object → `emptyProgress()`; missing `cards` → `[]`.
- Own keys only; ignore `__proto__`, `constructor`, `prototype`; outputs null-prototype.
- Id must match `^[a-z0-9-]{1,64}$`, else the entry is DROPPED (never cleaned).
- `stars` must be a finite number, else drop; clamp `Math.min(3, Math.max(0, Math.floor(s)))`.
- `at`: an ISO-8601 date-time with `Z` or `±HH:MM` that exists on the calendar as written
  (no Feb 30, no `T24:00`) → `toISOString()` if that stays in years 0000–9999, else `null`.
- Cards: strings only, valid ids, dedupe, sort. Caps (one rule, applied by sanitize and
  merge): level entries and cards each at most max(500, registered ids present); the cap
  bounds unknown data only. Ids in `keep` (the registry's, passed by storage and
  `recordCompletion`) are never evicted, unknown ids fill the rest by sorted id.
- With `levelIds`/`cardIds`: drop ids not in the set (the in-memory view). Without: keep
  every well-formed id (what gets persisted).

### 2.6 ctx (`createLevelContext({level, ovBody, ovActions, now, shuffle, reduceMotion, onFinish, signal})`)

```
ctx = {
  renderStep(bodyHtml, actionsHtml = ''): void  // set both innerHTMLs; ovBody.scrollTop = 0
  speech(html): string     // TRUSTED authored HTML, not escaped; player input must use escapeHtml
  escapeHtml(s): string
  shuffle(arr): any[]      // NEW array; app passes Math.random-based, harness identity
  mistake(): void          // mistakes += 1
  hint(): void             // hintsUsed += 1
  finish({text = '', cards = []}): {stars, cards, text} | null
  reduceMotion: boolean
  ovBody, ovActions: Element
  signal: AbortSignal      // aborted when the overlay closes; timer callbacks check it
}
```
Levels wire buttons by assigning `el.onclick = …` after `renderStep` (CSP-safe), as in R.

`finish` computes `stars = scoreStars({mistakes, hintsUsed, elapsedMs: now() - startedAt}, level)`
and calls `onFinish(level.id, {stars, cards, text, at: new Date(now()).toISOString()})`.
`level.id` is captured at creation. Returns `null` without calling `onFinish` if already
finished or `signal.aborted`. Non-array `cards` → `[]`.

`scoreStars({mistakes, hintsUsed, elapsedMs}, {scored, scoring})`: `!scored` → 0; else
`p = mistakes + hintsUsed + (parMs != null && elapsedMs > parMs ? 1 : 0)`;
`p === 0` → 3, `p <= 2` → 2, else 1.

### 2.7 Map (`hub/map-data.mjs`)

`NODES = [{ id, label, kind: 'service'|'datastore'|'queue'|'external', x: 0..100, y: 0..60 }]`
(SVG viewBox `0 0 100 60`), `EDGES = [{ from, to }]`. Nodes: storefront, api-gateway,
catalog, cart, checkout, payments, inventory, orders, shipping, notifications,
recommendations, postgres, redis, kafka, payment-provider (external).
Node lit when ANY level in `nodeLitBy(node)` is completed; edge lit when both ends lit;
node pulses when an `'open'` boss lights it. Positions are SVG attributes, never `style`.

## 3. Invariants

Registry (`validateRegistry` reports all at once): act and level ids unique across all acts
and bosses (same module twice, or boss also in `levels`, is an error); each act ≥1
non-boss level; card and node references exist; `no` format and order; no `act`/`kind`
declared; valid mechanics; `run` is a function; reward titles unique.

Progress: never downgrades (best stars, earliest non-null `at`, card union); stars
integers 0–3; corrupt input → empty, no throw; `recordCompletion` idempotent;
`mergeProgress` commutative, associative, idempotent for a fixed `keep`.

Unlock (`lib/unlock.mjs`, pure):
- `isCompleted(progress, id)`: has an own entry.
- `isActComplete(act, progress)`: all `levelIds` and the `bossId` (if any) completed.
- `isActUnlocked(i, progress, registry)`: EVERY earlier act complete (whole chain).
- `levelState(id, progress, registry)` → `'locked'|'open'|'done'`: unknown → locked;
  completed → done (even in a locked act; imported progress is never hidden); act locked →
  locked; boss with an unfinished level in its act → locked; else open.
- `lockReason(id, progress, registry)` → `{kind:'act', actId}` (first incomplete earlier act) `| {kind:'boss', remaining:[ids]} | {kind:'unknown'}` (id or its act not in the registry) `| null` (playable).

Concurrency: `saveProgress` reads storage, merges, writes in one sync task; the `storage`
event merges other tabs' writes into memory; progress only goes up, so last-writer-wins
cannot lose a completion. `finished` flag stops double finish; AbortSignal + captured id
stop stale finish; `openLevel` re-checks `levelState`. No reset UI in M0. When two different
builds run side by side, only the current build's registry is protected at the cap (accepted for M0).

## 4. Pure functions

| function | module |
|---|---|
| `escapeHtml`, `speech`, `shuffle(arr, rand)`, `prefersReducedMotion(win = globalThis.window)` | `lib/lesson-kit.mjs` |
| `validateDeck`, `validateRegistry`, `buildRegistry`, `nodeLitBy` | `lib/registry.mjs` |
| `scoreStars` | `lib/scoring.mjs` |
| `createLevelContext` | `lib/level-context.mjs` |
| `emptyProgress`, `sanitizeProgress`, `registryIds(registry)` → `{levelIds, cardIds}` (the `keep` ids), `migrate(raw, {current, migrations})` → migrated record, `raw` if at/past `current`, or `null` (corrupt), `mergeProgress(a, b, {keep}?)`, `recordCompletion(progress, levelId, {stars, cards, at}, registry)` → `{progress, firstCompletion, newBest, newCards}`, `starTotals` → `{earned, max}`, `cardTotals` → `{earned, max}` | `lib/progress.mjs` |
| `isCompleted`, `isActComplete`, `isActUnlocked`, `levelState`, `lockReason` | `lib/unlock.mjs` |
| `loadProgress(storageGetter, registry)` → `{status, progress}` (`TypeError` before any read without a registry), `saveProgress(storageGetter, progress, registry)` → `{saved, reason?, progress}` (`progress` is always the registry view; `TypeError` before any storage access without a registry) | `lib/storage.mjs` |
| `resolveTheme`, `readTheme(getter)`, `writeTheme(getter, t)` | `lib/theme.mjs` |
| `nodeStates(registry, progress, NODES, EDGES)` | `lib/map.mjs` |
| `parseEnv`, `effectiveResource`, `checkConfig` | `lib/widgets/env-config.mjs` |

Totals: star `max = 3 × |scored registered levels|`, `earned` sums best stars over the
same set. Card `max = |union of registered levels' cards|`, `earned = |progress.cards ∩ that union|`.
`recordCompletion` is the only place cards are filtered (`cards ∩ level.cards`); an unknown
level id returns the progress unchanged with all flags false.

Absence (`storageGetter = () => window.localStorage`, called inside try/catch):

| status | when | memory | writes |
|---|---|---|---|
| `fresh` | `getItem` → null | empty | normal |
| `ok` | parses, `v === 1` after migration | sanitized view | read, merge, write |
| `corrupt` | bad JSON, not an object, `v` missing / not an integer, migration gap, `levels` not an object | empty | each save first copies the raw string to `oncall.progress.corrupt` if absent, else to `oncall.progress.corrupt.latest` if it differs; a failed copy aborts with `unavailable`; then writes |
| `future` | `v > CURRENT_VERSION` | sanitized best effort | refused `{saved:false, reason:'future'}` |
| `unavailable` | getter / `getItem` / `setItem` throws | memory only | `{saved:false, reason:'unavailable'}` |

`game.notice` is set for corrupt, future and unavailable; null for fresh and ok. On save,
stored data is sanitized without id filtering, so unknown levels survive in storage; the
returned `progress` is the registry view, so they never reach memory.

## 5. Files per phase (copy / adapt / new from R)

R = <https://github.com/wealthbot-io/webo-money-world> at commit
`f80763e825ae301ffb347f9e8a0f6e3356582419` (clone anywhere; R below means that checkout).
Not brought over: `api/`, `lib/kv.js`, `lib/util.js`, `grownups.*`, `prototype/`,
`scripts/`, `assets/`, `HANDOFF.md`, `run.sh`, `.env.example`, all lessons, and the tests
for those. After F1, only the named phase edits each file.

**F1 scaffold, CI, CLAUDE.md (#9)**
- Copy: `vendor/alpine-3.14.1.min.js`.
- Adapt: `package.json` (name, description, `"type":"module"`, `scripts.test = "node --test \"test/**/*.test.mjs\""`,
  so helpers and fixtures are not run as tests;
  `linkedom` pinned exactly, `engines.node >=22`); `vercel.json` (no `functions`; CSP §7;
  keep X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, the
  `/vendor/(.*)` immutable cache header, and the same for `/fonts/(.*)`); `.gitignore`/`.vercelignore`; `index.html` stub
  (R's head order and CSP comment; no Google Fonts; links `styles/tokens.css`,
  `styles/base.css`, `styles/hub.css`; `<script type="module" src="/main.mjs">` then
  `<script defer src="/vendor/alpine-3.14.1.min.js">`; body `<div class="app" x-data="game">`).
- New: `.github/workflows/ci.yml`, `CLAUDE.md`, `.nvmrc`, `vendor/SHA256SUMS`,
  `vendor/README.md`, `tools/serve.mjs` (dev server sending the vercel.json headers and
  refusing what `.vercelignore` lists), `test/serve.test.mjs`,
  `test/helpers/dom.mjs` (R's `makeDom` via linkedom `parseHTML`, sets globals, stubs
  `Element.prototype.animate`; exports `q`, `qa`, `click`, `clickUntil`),
  `test/static.test.mjs`, `docs/FOUNDATION.md` (this file).
- Stubs handed on: `main.mjs`, `styles/hub.css` → F5; `styles/tokens.css`,
  `styles/base.css` → F2; `index.html` → F5.

**F2 theme tokens (#10)**: `styles/tokens.css`, `styles/base.css`, `fonts/MartianMono-*.woff2`,
`fonts/OFL.txt`, `lib/theme.mjs`, `test/theme.test.mjs`. Adapt R/styles.css: `:root` vars →
Dash0 tokens in `light-dark()`; carry over reset/body, `.btn` (+`.ghost`, `.small`),
`.choice` (`.correct`, `.wrong`), `.feedback` (`.good`, `.info`, `.show`), `.speech`,
`.bubble`, `.lesson-intro`, `.lesson-stage`, `h3.q`, focus and reduced-motion; system sans,
Martian Mono for `code, pre, kbd`; every hex → token; `.correct`/`.good` → success,
`.wrong` → error. Drop lesson-specific classes.

**F3 level platform (#11)**: `lib/lesson-kit.mjs` (adapt R: keep `escapeHtml` + `'`,
guarded `prefersReducedMotion`, `speech` without avatar; add `shuffle`; drop Webo/prop/hint
helpers and `mergeProgress`), `lib/registry.mjs`, `lib/scoring.mjs`, `lib/level-context.mjs`,
`cards/deck.mjs` (`[]`), `levels/index.mjs` (`ACTS = []` + "to add a level: one file, one
line here, one driver" comment), `test/kit.test.mjs`, `test/registry.test.mjs`,
`test/scoring.test.mjs`, `test/level-context.test.mjs`, `test/levels-play.test.mjs`
(adapt R's play test; DRIVERS object lives here), `test/fixtures/fixture-level.mjs`.

**F4 progress store (#12)**: `lib/progress.mjs`, `lib/unlock.mjs`, `lib/storage.mjs`,
`test/progress.test.mjs`, `test/unlock.test.mjs`, `test/storage.test.mjs`,
`test/helpers/fake-storage.mjs`. Adapt R's `load/save`, `mergeProgress`,
`api/progress.js` `sanitizeProgress`, `isLocked`, `complete` as described in §2–4.

**F5 hub map (#13)**: takes over `index.html`, `main.mjs`, `styles/hub.css`; new `app.mjs`
(`createGame(deps)`, no Alpine import), `hub/map-data.mjs`, `lib/map.mjs`,
`test/map.test.mjs`, `test/game.test.mjs`, `test/live-registry.test.mjs`. Adapt R/app.mjs:
keep registry-derived level list, overlay, `openLevel` with nudge + `lockReason` text,
`closeOverlay` (also aborts ctx), focus return by level id, reward card, confetti (skipped
under reduced motion, CSS-class colours); `onFinish(levelId, result)` replaces
`complete(i)`. Adapt R/index.html: header with earned/max stars, level cards grouped by
act (keep R's a11y: role, tabindex, aria-disabled, aria-label, Enter/Space), overlay and
reward dialogs; SVG system map replaces the world stage; level HTML inside an `x-ignore`
wrapper, elements fetched by id. `main.mjs`:
`document.addEventListener('alpine:init', () => window.Alpine.data('game', () => createGame(browserDeps())))`.
Gotcha for CLAUDE.md: Alpine `:class` with a mixed `['str', {obj}]` array renders
`"[object Object]"`; use a method returning a class string. Needs a one-time manual
browser check that Alpine leaves `x-ignore` children alone.

**F6 level 1.2 (#14)**: new `levels/naming-your-service.mjs` (R lesson style),
`lib/widgets/env-config.mjs`, `test/env-config.test.mjs`; edits `levels/index.mjs`,
`cards/deck.mjs`, DRIVERS in `test/levels-play.test.mjs`. Level fields:
`no '1.2'`, `lights ['checkout']`, `cards ['unknown-service']`, `mechanics ['configure']`.
Act: `{id:'act-1', no:1, name:'Resources and identity', sub:'Who is talking?', levels:[…], boss:null}`.

Order: F1 → (F2 ∥ F3 ∥ F4; the F6 checker may also start) → F5 → F6.

## 6. RED test spec

### F1 `test/static.test.mjs`
- No inline scripts (every `<script>` has `src`, no text). Mutation: add `<script>1</script>`.
- No `on*` or `style` attributes. Mutation: add `onclick=""`.
- No `:style` / `x-bind:style`. Mutation: add `:style="'left:1px'"`.
- `main.mjs` script precedes Alpine; Alpine has `defer`. Mutation: swap them.
- CSP header on `/(.*)` equals §7 exactly; `script-src` has no `'unsafe-inline'`;
  `frame-ancestors 'none'`. Mutation: add `'unsafe-inline'`.
- sha256 of the vendored Alpine equals `vendor/SHA256SUMS`. Mutation: change one byte.
- Every local `src`/`href` exists on disk.

### F2 `test/theme.test.mjs`
- Brand primitives exact (case-insensitive): `--d0-red:#f8494d`, `--d0-orange:#fd6f40`,
  `--d0-orange-soft:#fd8c66`, `--d0-grey-900:#101010`, `-800:#212121`, `-700:#2c2c2c`,
  `-600:#424242`, `-400:#9e9e9e`, `--d0-white:#ffffff`, `--d0-mint:#a8fbbe`,
  `--d0-purple:#ad46ff`. Mutation: change one hex.
- Every `--color-*` in `:root` is `light-dark(<light>, <dark>)`; `:root` has
  `color-scheme: dark`; `[data-theme="light"]` sets only `color-scheme: light`.
- `--color-primary` uses `var(--d0-red)` both sides; `--color-success` mint;
  `--color-error` purple, not red, not primary. Mutation: error → red.
- WCAG: `--color-text` and `--color-text-muted` on `--color-bg` ≥ 4.5 in both themes.
  Mutation: light text `#9e9e9e` on white.
- No hex in `styles/*.css` except tokens.css. Mutation: `color:#fff` in base.css.
- `code, pre, kbd` use `"Martian Mono"`; `@font-face` src is local `/fonts/`.
- `resolveTheme`: `'light'`→light, `'dark'`→dark, `null`/`'blue'`/`undefined`→dark.
  `readTheme` with a throwing getter → `'dark'`; `writeTheme` with a throwing `setItem` → false.

### F3 `test/kit.test.mjs`
- `escapeHtml('<b>"x"</b> & y')` → `'&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y'`;
  `escapeHtml("it's")` → `'it&#39;s'` (mutation: R's `/[&<>"]/`); `null` → `''`; `5` → `'5'`.
- `shuffle` returns a new permutation; frozen input unchanged; a fixed `rand` gives the
  same order twice.
- `prefersReducedMotion`: `{}` → false; `matchMedia` `{matches:true}` → true; throwing
  `matchMedia` → false; import without `window` doesn't throw.

### F3 `test/scoring.test.mjs` (level `{scored:true, scoring:{parMs:null}}` unless stated)
p=0 → 3; 1 mistake → 2; 2 → 2; 3 → 1; 100 → 1; 1 hint → 2; 1 mistake + 2 hints → 1;
`parMs 60000` elapsed 60000 → 3; elapsed 60001 → 2; `scored:false` p=0 → 0.
Mutations: `p < 2`; `>=` against par; drop the `scored` check.

### F3 `test/level-context.test.mjs`
- `renderStep('<p>x</p>')` → body `'<p>x</p>'`, actions `''`, `scrollTop` 0 after being 50.
  Mutation: drop `|| ''`.
- `speech('<b>hi</b>')` contains `<b>hi</b>`, `class="speech"`, `class="bubble"`.
- `shuffle` returns a new array; frozen input unchanged.
- `mistake()` ×2 then `finish({cards:['c1']})` → `{stars:2, cards:['c1'], text:''}`;
  `onFinish` once with `('lvl-a', {stars:2, cards:['c1'], text:'', at:'2026-01-01T00:00:00.000Z'})`
  (now = 1767225600000).
- `now` 0 at create, 61000 at finish, `parMs 60000` → stars 2.
- Second `finish` → null, `onFinish` count stays 1. Mutation: drop the `finished` flag.
- `abort()` then `finish` → null, no `onFinish`. Mutation: drop the abort check.
- `finish({cards:'c1'})` → `cards: []`.
- ctx A (`lvl-a`) and B (`lvl-b`) created; `A.finish()` → `onFinish` first arg `'lvl-a'`.

### F3 `test/registry.test.mjs` (fixture factory `L(id, no, extra)`)
Valid baseline: `[{id:'a0', no:0, levels:[L('x','0.1'), L('y','0.2')], boss:L('bx',null)},
{id:'a1', no:1, levels:[L('z','1.1')], boss:null}]`, `cardIds ['c1']`, `nodeIds ['n1']` →
`ok`; `order ['x','y','bx','z']`; `bx.kind 'boss'`, `bx.actId 'a0'`, `z.kind 'level'`;
defaults `scored true`, `cards []`.
Invalid (assert `ok false` and the fragment): level id in two acts → `duplicate level id "x"`
(mutation: track ids per act); boss also in levels → duplicate; act without levels →
`act "a0" has no levels`; `cards:['c9']` → `unknown card "c9"`; `lights:['n9']` →
`unknown node "n9"`; declares act/kind → `must not declare`; `'2.1'` in act 1, out-of-order
`no`, boss with `no` → `no`; `['dance']`, empty mechanics, missing run, `'Bad_ID'`,
duplicate act id, non-increasing act `no`, duplicate reward title. Two defects →
`errors.length === 2` (mutation: return on first). `buildRegistry` throws `RegistryError`
naming both. Empty ACTS → ok, `order []`. `validateDeck`: duplicate id, `http://` specUrl,
empty front, `dash0Angle: ''`. `nodeLitBy`: x and z light `n1` → `['x','z']`.

### F3 `test/levels-play.test.mjs`
Driver: `DRIVERS[levelId] = { play(), expect:{stars, cards}, sloppy?:{ play(), expect } }`
(sloppy required for real levels). Harness: real `createLevelContext`, `now = () => 1767225600000`,
identity shuffle, `reduceMotion: true`, `onFinish` collects calls; `run(ctx)` then `play()`
synchronously.
- Every registered id has a driver AND every driver key is registered. Mutation: add a
  driver for a missing level.
- Each level: `onFinish` exactly once; stars/cards deepEqual `expect`; cards ⊆ level
  `cards`; `text.length > 10`; every rendered step has a `<button` or `<input`; no em dash.
- Sloppy run scores fewer stars than happy.
- First screen has no enabled Finish.
- Harness teeth: fixture level finishes once with 3 stars; `click('#missing')` throws
  mentioning `#missing`; clicking a disabled button throws "disabled".

### F4 `test/unlock.test.mjs`
Registry: a0 `['l0a','l0b']` boss `b0`; a1 `['l1a','l1b']` no boss; a2 `['l2a']` boss `b2`.
- Empty: l0a, l0b open; b0, l1a, l2a, b2 locked.
- `{l0a:3, l0b:3}` → b0 open, l1a locked. Mutation: act complete counts only levelIds.
- `{l0a:1, l0b:2, b0:0}` → l1a open. Mutation: `isCompleted` uses `stars > 0`.
- `{l0a:3}` → b0 locked. Mutation: `some` for `every`.
- a0, a1 complete → l2a open, b2 locked.
- `{l1a:3, l1b:3}` with a0 incomplete → l2a locked; l1a `'done'`. Mutation: check only the previous act.
- Unknown id → `'locked'`, no throw. `lockReason` returns the act / boss-remaining forms.

### F4 `test/progress.test.mjs`
Fixture: `levelIds ['a','b','u']`, `cardIds ['c1','c2']`; `a.cards ['c1','c2']`; `u.scored false`.
- sanitize: `null`, `'x'`, `42`, `[]`, `{v:1, levels:[]}` → empty. Stars 2.7→2, 5→3, −1→0;
  `NaN`, `'3'`, `null`, missing → dropped (mutation: `Math.round`). `__proto__` key → no
  keys, `({}).stars` undefined. Unknown `zz` dropped with `levelIds`, kept without (mutation:
  always filter). Cards `['c2','c1','c1','zz',7]` → `['c1','c2']`. `at`
  `'2026-10-30T10:00:00Z'` → `'2026-10-30T10:00:00.000Z'`; `'yesterday'`, `5` → null.
  `'naming-your-service<x>'` with `levelIds` including `naming-your-service` → `{}`
  (mutation: clean instead of drop). Id >64 chars dropped; 600 entries → first 500 by
  sorted id. Frozen input unchanged.
- migrate: `{current:2, migrations:{1: r => ({...r, v:2, x:1})}}`: `{v:1}` → `{v:2, x:1}`;
  `{v:2}` unchanged; gap → corrupt.
- recordCompletion: empty + a `{stars:2, cards:['c1','zz'], at:T1}` → `{stars:2, at:T1}`,
  cards `['c1']`, flags first/newBest true, `newCards ['c1']`; then `{stars:1, at:T2}` →
  stays 2 and T1, newBest false (mutation: assign instead of max); then 3/T3 → 3, T1; same
  call twice → equal progress, `newCards []`; `{stars:0}` on b → completed; stars 7 → 3;
  unknown id → unchanged, flags false; input not mutated.
- mergeProgress: A `{a: 2@T2, b: 0@null}, [c1]`; B `{a: 1@T1, u: 0}, [c2]` →
  `{a:{2, T1}, b:{0, null}, u:{0}}`, `[c1, c2]` (mutations: whole entry from higher side;
  max of `at`). Commutative, idempotent, associative (three fixtures). Null `at` never
  beats a date.
- totals: `{a:2, u:0}` → stars `{earned:2, max:6}` (mutation: count unscored → 9); cards
  `['c1']` → `{earned:1, max:2}`.

### F4 `test/storage.test.mjs` (`fakeStorage({initial, throwOn})` records every `setItem`)
fresh; ok; corrupt for `'{bad'`, `'[]'`, `'{"levels":{}}'`; future for `v:99`; unavailable
for a throwing getter or `getItem`. Save merges with stored (stored `{a:2}`, memory
`{a:1, b:3}` → `{a:2, b:3}`, returns the registry view; mutation: write memory directly).
Save keeps unknown ids. Throwing `setItem` → `{saved:false, reason:'unavailable'}`. Future
→ zero `setItem` calls (mutation: drop the check). Corrupt → backup written before the
progress write, and a second corrupt value doesn't overwrite the backup (it goes to
`.latest`). A registered completion is never evicted by the cap.

### F5 `test/map.test.mjs`
A lights `['checkout','payments']`, B `['checkout']`, progress `{B:1}`: checkout lit,
payments dark (mutation: require all); edge dark until A done; unlinked node dark; open
boss lighting `cart` → pulse true, false once done.

### F5 `test/live-registry.test.mjs`
`buildRegistry(ACTS, {deck: DECK, nodeIds})` doesn't throw; flattened order deepEqual the
expected ids (F6 sets `['naming-your-service']`); node ids unique; edges reference nodes;
no self-edges; x in [0,100], y in [0,60].

### F5 `test/game.test.mjs` (`createGame` with fake storage, fixture registry, fixed now)
Fresh boot `notice null`; corrupt → `'corrupt'`; throwing getter → `'unavailable'`.
`openLevel` on a locked level → false, `overlayOpen false` (mutation: drop the check).
Completion: open `x`, finish with 1 mistake → stored `x` 2 stars, `levelState 'done'`, its
nodes lit, totals updated. `storage` event with `y:3` → `progress.levels.y.stars === 3`.
Stale finish: open `a`, keep ctx, close, open `b`, `a.finish({text:'stale'})` → null,
neither recorded, storage unchanged (mutation: R's `complete(this.currentLevel)`).
`index.html`: `#ov-body`/`#ov-actions` inside `[x-ignore]`; map is `<svg>` without `style`.

### F6 `test/env-config.test.mjs`
- `parseEnv`: comments, blanks, `export ` prefix, double quotes; duplicate → last wins;
  `'NOEQUALS'` → error `{line: 1}`.
- `effectiveResource(vars, {processName:'node'})`: `{}` → `unknown_service:node`, source
  `default`; `OTEL_SERVICE_NAME=checkout` + RA `service.name=cart` → checkout (mutation:
  swap precedence); empty `OTEL_SERVICE_NAME` + RA cart → cart; `service.version=1.2%2C3`
  → `1.2,3`; RA with one invalid entry → whole RA discarded with an error. **Verify these
  three rules against the OTel spec before shipping.**
- `checkConfig(text, {serviceName:'checkout', environment:'production'})`: correct →
  `{ok:true, issues:[]}`; codes `service-name-missing`, `service-name-wrong`,
  `version-missing`, `deprecated-environment` (old `deployment.environment`, not
  `environment-missing`); each issue once.
- Player input `<img src=x onerror=alert(1)>` renders escaped (mutation: drop escapeHtml).

### F6 driver (`naming-your-service`)
Steps: (1) given config, "what does it show up as?" (4 choices, `unknown_service:node`
correct; wrong → `mistake()`); (2) fix the config and `check` (each new failing config → `mistake()`);
(3) precedence question (`checkout` correct). Happy → `{stars:3, cards:['unknown-service']}`;
sloppy (one wrong choice, one failed check) → `{stars:2, …}`. A single dropped `mistake()`
cannot flip the sloppy run (1 and 2 penalties both score 2★), so
`test/naming-your-service.test.mjs` plays one-penalty runs (each must score 2★). Mutation:
skip `mistake()` on a failed check, or on a wrong pick; that test goes red. DECK adds
`unknown-service` (front: "Without service.name, your telemetry arrives as
unknown_service:<executable>.").

## 7. CSP, imports, CI

CSP (vercel.json `/(.*)`; `tools/serve.mjs` sends the same headers):
```
default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```
Tests import modules directly; `window`, `localStorage`, `matchMedia` are injected as
dependencies. CI: on push + pull_request, `permissions: contents: read`, ubuntu-latest,
`actions/checkout` and `actions/setup-node` pinned to SHAs, a matrix of Node 22 (the
`engines` floor) and `node-version-file: .nvmrc`,
`cache: npm`, `npm ci`, `npm test`. `.nvmrc` = current Active LTS major.
