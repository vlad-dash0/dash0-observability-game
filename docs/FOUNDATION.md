# Foundation design (M0)

Source of truth for F1–F6 (issues #9–#14, epic #15). Architect design, adapted from
the reference game `wealthbot-io/webo-money-world` ("R"; same author, code may be
reused directly). Every phase turns its slice of §6 into failing tests first, then
makes them pass, then proves each test by a one-line mutation of the implementation
(edit, see red, edit back).

## 1. Decisions

1. Levels never pass stars. ctx counts `mistake()` / `hint()`; one pure `scoreStars`
   turns counts into stars, 0 to `MAX_STARS` (5, exported by `lib/scoring.mjs`, the only place the maximum is written).
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
default with an explicit light toggle; star rule as §2.6 (five stars since #155); Martian Mono self-hosted
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
| mechanics | string[] | required with `run`; with `play` derived, optional | ≥1, unique, from `sort build configure query spot incident tradeoff`; with `play` a declared list must equal the one derived from the steps (docs/DECLARATIVE-LEVELS.md §2) |
| widgets | string[] | `[]` with `run`; with `play` derived, optional | the widgets the level plays, in play order, for the how-to-play help (#199): unique, from `WIDGETS` (`lib/registry.mjs`: `choice` plus the mechanics); every non-`choice` entry must also be in `mechanics`. Absent means no help card (help is never guessed from `mechanics`). With `play` a declared list must equal the one derived from the steps |
| hintless | string[] | `[]` with `run`; with `play` derived, optional | the widgets of the level with no Hint button on any step, for the how-to-play help (#199): unique; a `run` level's must be in its `widgets`; with `play` a declared list must equal the one derived from the steps (choice and tradeoff never have hints and are not listed). Absent means none |
| cards | string[] | `[]` | ids that exist in DECK, unique |
| lights | string[] | `[]` | ids in `NODE_IDS` (`hub/map-data.mjs`), unique; not drawn since #150 |
| scored | boolean | `true` | `false`: always 0 stars, excluded from both sides of star totals |
| scoring | `{parMs: number\|null}` | `{parMs: null}` | positive integer or null |
| run | `(ctx) => void` | required without `play` | function; forbidden with `play` |
| play | `{prefix?, steps, finish}` | none | declarative level, plain data only (docs/DECLARATIVE-LEVELS.md §2); needs the registry's `play` kit; the registry builds `run` from it |
| act, kind | forbidden | | |

Rule: when `ctx.reduceMotion` is true a level must not wait on any timer (the harness
plays levels synchronously, as R does).

### 2.2 Acts (`levels/index.mjs`)

`export const ACTS = [{ id, no, name, sub, teaser?, badges?, levels: Level[], boss: Level | null }]`.
`id` kebab, unique; `no` integer ≥0, strictly increasing (gaps allowed); `levels.length ≥ 1`.
Acts unlock by array position, unless already entered (§3). Empty `ACTS` is valid.
`teaser` is optional plain text, one line (the About dialog shows it; every live act in
`levels/index.mjs` has one of at most 160 characters, `test/live-registry.test.mjs`); it
builds to `''` when absent and must be a string otherwise. `hub/coming-soon.mjs` uses the same field.
`badges` is optional: an array of unique badge ids known to `hub/badges.mjs` (`dash0`, `customer-calls`);
it builds to `[]` when absent, and an unknown id, a duplicate or a non-array is a registry error.
`hub/badges.mjs` `BADGES` is the only place a label and chip tone live ("Dash0", "From customer calls").
Acts 7 and 8 carry `dash0`, Act 9 `customer-calls`. `createGame().acts` and `aboutActs()` expose
`badges: [{id, label, tone}]` (`[]` for a coming-soon act); the hub card and the About list render them as
kit chips (`ui-chip`, `data-tone`) with `x-text`.

### 2.3 Nuance card (`cards/deck.mjs`)

`export const DECK = [{ id, front, back, specUrl, dash0Angle }]`: kebab unique id;
non-empty `front` (≤140 chars) and `back`; `specUrl` starts `https://`; `dash0Angle`
non-empty string or `null`. Checked by `validateDeck`.

### 2.4 Built registry (shared by F3, F4, F5)

```
Registry = {
  acts:   [{ id, no, name, sub, teaser, badges: string[], levelIds: string[], bossId: string|null }],
  levels: { [id]: Level },  // null-prototype; Level = §2.1 + defaults + actId + kind:'level'|'boss';
                            // `play` is a deep-frozen copy of the declared play, or null; `mechanics` and `widgets` derived for play levels
  order:  string[],         // per act: its levels, then its boss
  cardIds: string[],        // sorted DECK ids
}
```
Deep-frozen. `buildRegistry(ACTS, {deck, nodeIds, play})` (`play` is the kit `{validatePlay, runPlay}` from
`lib/play.mjs`, passed in so the registry never imports it; `liveRegistry` supplies it) throws one `RegistryError` listing
every problem; `validateRegistry(ACTS, {cardIds, nodeIds})` returns `{ok, errors}` and
never throws. F4 codes against this shape with hand-written fixtures and does not import F3.

### 2.5 Progress (localStorage key `oncall.progress`)

```
{ v: 1,
  levels: { [levelId]: { stars: 0|1|2|3|4|5, at: string|null } },  // at = first completion, ISO UTC
  cards: string[] }                                             // sorted, unique
```
Completed = has an own entry, whatever its stars (`stars: 0` is real and distinct from no
entry). `CURRENT_VERSION = 1`; `MIGRATIONS = {}` where `MIGRATIONS[n]` maps v n → n+1.

`sanitizeProgress(raw, {levelIds?, cardIds?, keep?})`: never throws, never mutates, never awards.
- Not a plain object, or `levels` not a plain object → `emptyProgress()`; missing `cards` → `[]`.
- Own keys only; ignore `__proto__`, `constructor`, `prototype`; outputs null-prototype.
- Id must match `^[a-z0-9-]{1,64}$`, else the entry is DROPPED (never cleaned).
- `stars` must be a finite number, else drop; clamp `Math.min(MAX_STARS, Math.max(0, Math.floor(s)))`, so 6 or more become 5. Values 0–3 saved in the three-star era stay valid as stored; there is no migration (no players, #16).
- `at`: an ISO-8601 date-time with `Z` or `±HH:MM` that exists on the calendar as written
  (no Feb 30, no `T24:00`) → `toISOString()` if that stays in years 0000–9999, else `null`.
- Cards: strings only, valid ids, dedupe, sort. Caps (one rule, applied by sanitize and
  merge): level entries and cards each at most max(500, registered ids present); the cap
  bounds unknown data only. Ids in `keep` (the registry's, passed by storage and
  `recordCompletion`) are never evicted, unknown ids fill the rest by sorted id.
- With `levelIds`/`cardIds`: drop ids not in the set (the in-memory view). Without: keep
  every well-formed id (what gets persisted).

**Save codes (#18)**: `lib/save-code.mjs` turns a registry-view record into `oc1.<base64url JSON>.<FNV-1a hex>`
(`encodeProgress`) and reads one back (`decodeProgress` → `{ok, progress, dropped}` or `{ok: false, reason}`,
reason one of `empty`, `format`, `version`, `checksum`, `shape`; whole or nothing, never throws; ids the
registry lacks are dropped and counted; a completion time after year 9999 is refused as `shape`, and one before 1970 is written as no time). The checksum catches typos and cut-off copies, not edits. `previewImport`
lists what a merge would add or improve and which levels keep better local stars; the merge itself is `mergeProgress`,
so the F4 rules hold (best stars, earliest `at`, card union, never a downgrade). The hub's "Save code" dialog
(`lib/save-view.mjs` markup, `lib/save-dialog.mjs` wiring, `createGame.openSave`) shows the preview before Import
and saves through `saveProgress`. `?mode=debug` hides the entry and refuses to open it: nothing is exported or imported.

### 2.6 ctx (`createLevelContext({level, ovBody, ovActions, now, shuffle, reduceMotion, onFinish, signal, reportError?, telemetry?, guide?})`)

```
ctx = {
  renderStep(bodyHtml, actionsHtml = ''): void  // set both innerHTMLs; ovBody.scrollTop = 0
  speech(html): string     // TRUSTED authored HTML, not escaped; player input must use escapeHtml
  escapeHtml(s): string
  shuffle(arr): any[]      // NEW array; app passes Math.random-based, harness identity
  mistake(): void          // mistakes += 1
  hint(): void             // hintsUsed += 1
  askedGuide(): void       // one answered guide question: hintsUsed += 1 (as hint()), then onGuideHint listeners run
  onGuideHint(fn): off     // listen for answered guide questions; listeners are dropped when signal aborts
  guide: object | null     // {configured, ask} from the app (§2.8), or null: the Ask the guide panel reads it
  finish({text = '', cards = []}): {stars, cards, text} | null
  reduceMotion: boolean
  ovBody, ovActions: Element
  signal: AbortSignal      // aborted when the overlay closes; timer callbacks check it
  telemetry: facade | null // the injected lib/telemetry.mjs facade (below), null when the app has none
}
```
`ctx.telemetry` has no token getter. `sessionId`, `status() -> {state: 'off'|'configured'|'connected',
mode: 'live'|'practice'|null, host}`, `stats() -> {buffered, dropped}`, `liveAvailable()`,
`connect({mode, endpoint, token, dataset}) -> {ok:true} | {ok:false, field, reason}` (validates, sends
nothing), `sendTest(opts?: {signal}) -> Promise<Outcome>` (single-flight), `emit(draft)` (no-op unless
connected, never throws), `flush(opts?) -> Promise<Outcome|null>`, `sendBatch(drafts, opts?)`,
`incident()` (the seeded lab incident, built once per session: docs/DASH0-LAB.md §Incident), `disconnect()`. Contract: docs/DASH0-LAB.md §Telemetry session.
Levels wire buttons by assigning `el.onclick = …` after `renderStep` (CSP-safe), as in R.

Guide questions (#17): one answered question costs one hint (owner choice, provisional).
`askedGuide()` does `hintsUsed += 1` like `hint()` and notifies `onGuideHint` listeners; `mountSide`
(`lib/widgets/help-ladder.mjs`) listens, keeps a `guided` count, adds it to its penalties and
exposes `hintsShown(h) = h + guided`, which every board's success line reads, so the board's
stars equal the level's. A board never asked is unchanged.

`finish` computes `stars = scoreStars({mistakes, hintsUsed, elapsedMs: now() - startedAt}, level)`
and calls `onFinish(level.id, {stars, cards, text, at: new Date(now()).toISOString()})`.
`level.id` is captured at creation. Returns `null` without calling `onFinish` if already
finished or `signal.aborted`. Non-array `cards` → `[]`.

`scoreStars({mistakes, hintsUsed, elapsedMs}, {scored, scoring})`: `!scored` → 0; else
`p = mistakes + hintsUsed + (parMs != null && elapsedMs > parMs ? 1 : 0)`;
`MAX_STARS` is 5. Penalties 0 → 5, 1 → 4, 2 → 3, 3 or 4 → 2, 5 or more → 1 (never 0 for a
scored level). `scoreStars` is the one star rule and `MAX_STARS` the one place the maximum is
written. The ladder as player text is `LADDER` in `lib/widgets/help-ladder.mjs`, generated from
`scoreStars`; the star rules each board states are composed from `LADDER` plus the widget's
`PENALTY`. `lib/progress.mjs` (clamp, totals) and every star display (`★` filled, `☆` empty,
always `MAX_STARS` glyphs, the reward label `n of 5 stars`) derive the maximum from `MAX_STARS`.

### 2.7 Map: the globe (#150; replaced the SVG system map)

The hub map is a dotted globe: act = world region, level = country, a boss pulses its whole
region while it is open. Data: `hub/globe-map.mjs` (`ACT_REGIONS`, `LEVEL_COUNTRY`,
`actOfCountry`), `hub/globe-data.mjs` (generated `DOTS`, `[lat, lon, iso3, subregion]`).
State: `lib/globe.mjs` `globeState` (country lit when its level is completed; region
`{done, total, pulse}`, pulse while the act's boss is `'open'`).
View, pure (`lib/globe-view.mjs`): `dotStates` (per dot UNLIT / LIT / PULSE / SOON; a pulsing region
outranks lit; a coming-soon region's dots are SOON, static and dim, and never lit), `currentActId` (lowest unlocked act not complete, else the last) and
`globeTarget` (rotation facing that act's region centre), `globeLabel` (the accessible name)
and `globeLines` (the no-WebGL text, one line per act), `readColors` (the `--color-globe-*`
tokens via computed style), `createLoop` (rAF loop: stops while the tab is hidden or the
globe is off screen; under reduced motion it draws single static frames only).
Renderer (`lib/globe-render.mjs`, three.js 0.180.0 vendored): `THREE.Points` with additive
halos, slow spin, drag to rotate, pixel ratio capped at 2, canvas sized by CSS and
`setSize(w, h, false)` (no style attribute). `createGame` mounts it into `.globe-stage`,
disposes it while a level covers the hub and on `pagehide`, and shows the text fallback when
three.js, the colours or WebGL are unavailable. Level `lights` stay level data, validated
against `hub/map-data.mjs` `NODE_IDS`, and are no longer drawn.

Island markers (#240). Fiji, Vanuatu and Samoa have no land dot on the 110m data, so `hub/globe-map.mjs` `ISLANDS` (hand-written, frozen: subregion and the capital's `[lat, lon]`) places each on its 3 nearest lattice points that are not land (`islandDots(k = 3)`, pure, deterministic, same `[lat, lon, iso3, subregion]` shape as `DOTS`). The one seam is `createGame`'s `dots` default in `app.mjs`, `[...DOTS, ...islandDots()]`; `dotStates`, `regionCentre` and ignite see them as ordinary dots, and `hub/globe-data.mjs` and its SHA pin are untouched. Polynesia is in `ACT_REGIONS['act-9']` so Samoa's markers belong to Oceania. A level PR for one of these countries adds it to `LEVEL_COUNTRY`; `test/globe-data.test.mjs` reads land plus island dots.

Act 9 (Oceania) uses eight countries: `filter-or-sampler` NZL, `the-34-percent-error-rate` AUS, `connect-to-dash0` PNG (docs/DASH0-LAB.md), `the-trace-that-starts-in-the-middle` SLB, `lost-in-translation` NCL (2 dots each, `MIN_DOTS_EXCEPTIONS` entries) `the-alert-that-stayed-green` FJI, `two-vendors-one-weekend` VUT and `edge-of-the-platform` WSM (no land dot, lit by island markers, `MIN_DOTS_EXCEPTIONS` entries of 3 each). `test/globe-data.test.mjs` `HOME` has a box for each. Its boss `its-us` (the lab) carries no country and pulses, then lights, the whole Oceania region like any boss.

Coming soon (#177 P7): `hub/coming-soon.mjs` `COMING_SOON` lists announced acts (`{id, no, name,
sub, teaser}`, frozen); it is empty now, since Acts 7 and 8 left it for `ACTS` with levels 7.1 and 8.2. It is never passed to `buildRegistry`, so unlock, progress, stars, cards
and ignite cannot see those acts. `createGame` (`comingSoon` dep) merges them into `acts` by
`no` (`soon: true`, `ids: []`, no level to open, even in debug); `globeState` returns them in
`soon` (never in `regions`, so they count for nothing); their region's dots are `DOT.SOON`
(dim, static, outside the wave), and `globeLines` / `globeLabel` name them. Moving an act into
`ACTS` means deleting its entry.

Ignite (#161). Pure, `lib/globe-ignite.mjs`: `freshlyLit(prev, next, registry, map)` gives
`{countryIds, regionIds}` (a level's country on its first completion only, never on a replay;
an act's region, as act ids, when its boss is newly completed or the act becomes complete),
`litText` ("Germany is now lit: The signals.", a boss names its region, `COUNTRY_NAMES` in
`hub/globe-map.mjs` has a name per level country), `igniteView` (per-dot flare and region-wave
distance, the ring's start point and the camera target facing the country's dot centroid, else
the region centre) and `igniteFrame(elapsed)` (the 1.5 s timeline). `createGame` remembers what
a completion lit and plays it when the reward card closes ("Back to the map"): scroll to the
map (smooth unless reduced motion), focus the map heading (`tabindex="-1"`, no outline), set
`litNote` (a polite live region, and the first line of the no-WebGL text), and call the
renderer's `ignite(view, states)`. A replay and a plain close do none of this. The renderer
turns to the target, waits until it nearly faces it, then plays the flare (country dots mix
toward white above the lit colour and settle), a ring over the sphere (a lazily made sphere
shader, registered in the release registry) and a gentle wave across the region, from frame
time `dt`. Reduced motion: no effect, the globe faces the country at once. Opening a level
disposes the globe, which cancels the effect.

### 2.8 Ask the guide: the server function (#17)

`api/guide.mjs` is the game's one serverless function: a Vercel Node function in the Web format (a `Request` in, a
`Response` out, one named export per HTTP method, `GET` and `POST`). No build step: Vercel's Node.js runtime docs
(vercel.com/docs/functions/runtimes/node-js) say "to use native ES modules in JavaScript handlers, use `.mjs`
(for example `api/index.mjs`)" and allow "export each HTTP method as a separate export"
(vercel.com/docs/functions/functions-api-reference shows `api/hello.js` with `export function GET(request)`).
Not yet proven on a deployment: confirm on a preview deploy that `GET /api/guide` answers `{configured:false}` and
that tracing `../app.mjs` bundles `levels/`, `lib/` and `vendor/js-yaml-5.5.0.mjs`. If `.mjs` is not picked up,
the fallback is `api/guide.js` with the same code, but then `package.json` (with `"type": "module"`) must also
deploy: `.vercelignore` excludes it today, and without it Vercel compiles the file as CommonJS and it fails. The
module also exports `createGuide({env, fetch, now, log, limiter, registry})`, which `GET` and `POST` are bound from
(to `process.env`, `globalThis.fetch`, `Date.now`, a JSON `console.log` and a module-level limiter); tests and the
dev stub use it.

Spend cap (setup step, the real limit): the in-memory limiter below does not bound spend, because a request without
an `Origin` header (plain curl) is served and every instance has its own counters, so many client addresses get 60
calls a minute on each instance. Create the key in its own Anthropic workspace with a monthly spend limit set, so
the cap is the provider's, not the function's.

The function reads no docs at runtime (`/docs/` is in `.vercelignore`). It builds the step context only from the
registry (`liveRegistry()` from `app.mjs`, the one construction site; importing it has no side effect) through
`lib/guide/context.mjs`, so the player sends ids, never context. `test/serve.test.mjs` walks the function's static
imports and fails if `.vercelignore` would drop one.

`GET /api/guide`: `200 {v:1, configured}`, `Cache-Control: no-store`; configured is `ANTHROPIC_API_KEY` set to a
non-empty string. `POST /api/guide`: `application/json`, at most 2048 bytes, body exactly
`{v:1, levelId, stepId, question}` (`question` trimmed, 1 to 300 characters, no control characters; any other
field, such as the player's current pick, is `400 body`: a pick would make the guide a yes/no oracle). The step
must be a `play` step the guide may speak on (`guideAllowed`) with a trustworthy token set (`answerTokens(type,
spec, step)` not null); otherwise it is refused before any model call. One call to
`POST https://api.anthropic.com/v1/messages` (model `claude-haiku-5-5`, `max_tokens` 300, 8 s timeout,
`x-api-key`, `anthropic-version: 2023-06-01`); the reply is the joined text blocks, trimmed and cut at 600 characters, then withheld when `withholds`
says that text states the answer (cut first, so the filter sees exactly what would be sent).

| status | body | when |
|---|---|---|
| 200 | `{ok:true, hint}` | answered |
| 200 | `{ok:false, error:'withheld'}` | the filter tripped; the reply is never sent |
| 400 | `{ok:false, error:'bad-request', field}` | bad JSON, version, id, question or extra field |
| 403 | `{error:'forbidden'}` | `Origin` present and its host differs from the request host |
| 404 | `{error:'unknown-step'}` | run level, unknown level or step id |
| 404 | `{error:'unavailable'}` | step not allowed, or no trustworthy token set |
| 405, 413, 415 | `{error}` | method, body over 2048 bytes, not `application/json` |
| 429 | `{error:'rate-limited', retryAfterS}` + `Retry-After` | limiter |
| 500 | `{error:'internal'}` | an unexpected throw; its text is never sent or logged |
| 502 | `{error:'upstream'}` | non-2xx, timeout, malformed body, empty text |
| 503 | `{error:'not-configured'}` | no key; the model is not called |

Rate limit (`lib/guide/limit.mjs`), best effort and in memory: 6 questions per client per fixed 10 minutes, and 60 a
minute for the whole instance; the client is the first `x-forwarded-for` value, else `unknown`; the map holds at
most 2000 clients and drops the oldest. A cold start empties it and parallel instances each keep their own, so it
slows a runaway client, it is not a quota. Only requests that reach the model count.

Privacy: the key is in no response, header or log line, and neither are the question, the reply or the address.
One log line per request, `{msg:'guide', levelId, stepId, outcome, status, ms}` (ids null until validated). There is
no client telemetry for the guide.

Local: `tools/serve.mjs` runs `api/<name>.mjs` at `/api/<name>` (GET and POST) and never serves `api/` source as a
file. `GUIDE_STUB=1 npm run dev` answers the guide with a canned reply and no key; the stub exists only in the dev
server.

The panel (#17 P4). `lib/guide/client.mjs` asks `GET /api/guide` once per page through the injected `fetch`
(`createGame` dep `fetch`, from `main.mjs`) and caches it; unknown, failed or `v` other than 1 means off, and a level
opened before the answer arrives has no panel. `ask(levelId, stepId, question, signal)` never throws and resolves to
`{kind}`: `ok` (hint), `withheld`, `rate-limited` (retryAfterS), `unavailable` (404, 503), `upstream` (502), `rejected`
(400, 413), `failed`, `aborted`. `ctx.guide` is `{configured, ask}` or null. When `ctx.guide.configured` and
`guideAllowed(type, spec)`, `runPlay` mounts `lib/guide/panel.mjs` after `type.mount`: into the side column's empty
`[data-guide-slot]` on a board, at the end of the step on a choice step. The panel is built from the kit only and shows
the reply as escaped text; one request at a time; `ctx.askedGuide()` runs once, on `ok`, while the step is unsolved and
its per-step `AbortController` (aborted by Next and close) has not fired; every other outcome is free. `?mode=debug`
shows the panel like any other mode. `MAX_QUESTION` in the client mirrors the server's limit (a test checks both).

### 2.9 Sign-in, saved progress, leaderboard (#273)

Optional, dormant until its env is set, and never required to play. Sign-in is for @dash0.com Google accounts only,
verified on the server. Rank is total stars (the sum of the best stars per level); a tie goes to whoever reached the
total first. Anonymous play (signed out or unconfigured) writes nothing new to storage, never touches
`oncall.progress` through sync, and leaves level play unchanged; the only additions are one `GET /api/account` per
page and, on a signed-out win, at most one `GET /api/leaderboard` per page for the sign-in nudge (`maybeSigninNudge`
in `app.mjs`; none after "Don't ask again").
The full email and the Google name are never stored, shown or logged. Phases: P1 `lib/auth/` (this section's auth
parts), P2 score, nickname, merge and store, P3 auth and account endpoints, P4 progress and leaderboard endpoints,
P5 dev server, P6 client and markup.

**Auth is a plain OIDC redirect handled by `api/`** (no Google Identity Services, so no CSP change: sign-in is a
top-level navigation from `<a href="/api/auth-start">`, sign-out is a same-origin fetch POST, no avatar is shown, and
`vercel.json` stays byte-for-byte with no "google" in it).
- `GET /api/auth-start`: makes a state, a nonce and a PKCE verifier (32 random bytes each), keeps them in the signed
  cookie `__Host-oc-auth` (HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600) and 302s to Google's authorization
  endpoint with `client_id`, `redirect_uri` (AUTH_ORIGIN + `/api/auth-callback`), `response_type=code`,
  `scope=openid email`, an S256 `code_challenge`, `state`, `nonce`, `hd=dash0.com` (a hint only) and
  `prompt=select_account`. Unconfigured, or a request host that is not AUTH_ORIGIN's host: 302 to `/?signin=unavailable`.
- `GET /api/auth-callback`: checks the auth cookie's signature and age and compares state in constant time, POSTs the
  code, verifier and secret to Google's token endpoint (8 s timeout), verifies the ID token, creates or loads the
  profile, sets the session cookie, clears the auth cookie and 302s to `/?signin=ok`. Failures go to `/?signin=` with
  `domain`, `cancelled` (Google's `access_denied`), `failed` or `unavailable`. The email is read once, to make the
  default nickname.
- `lib/auth/jwt.mjs`: `createJwksCache({fetch, now})` and `verifyIdToken(token, {jwks, clientId, nonce, now})`
  (`jwks` is the cache object, not raw keys; an unexpected exception maps to `format`), which
  resolves `{ok, claims}` or `{ok:false, reason}` and never throws. Reasons: `format` (not three base64url parts),
  `alg` (only RS256; `none` and HS256 refused), `jwks` (fetch failed or odd body), `kid`, `signature`, `iss`
  (`https://accounts.google.com` or `accounts.google.com`), `aud` (equal to the client id, or an array that includes it
  with `azp` equal to it), `expired` (`exp*1000 > now - 60 s`), `iat` (`iat*1000 <= now + 60 s`), `nonce`, `email`
  (`email_verified` must be the boolean `true`), `domain` (`hd === 'dash0.com'` exactly and a lowercased email ending
  `@dash0.com`) and `sub` (a non-empty string). The JWKS comes from `https://www.googleapis.com/oauth2/v3/certs`, is
  cached in memory for its Cache-Control max-age (never less than a minute), and an unknown kid refetches once, at most
  once a minute. Concurrent misses share one in-flight fetch, and the fetch times out after 8 s. A `crit` header is
  refused (`format`), and an unset or empty client id refuses every token (`aud`). Only
  WebCrypto (`RSASSA-PKCS1-v1_5` / SHA-256) is used.
- `lib/auth/session.mjs`: the cookie `__Host-oc-session` holds `v1.<b64url {pid, gen, exp}>.<b64url HMAC-SHA256>`
  with HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000 (30 days, not sliding); `exp` is epoch ms.
  `verifySession` checks version, HMAC and exp and returns the payload or null; the endpoint then loads the profile
  and requires `gen` to match. Sign-out clears the cookie (Max-Age=0); delete removes the profile, so a kept copy gets
  401. A SESSION_SECRET shorter than 32 bytes counts as not configured (`sessionSecret` returns null; `signSession`
  throws). The secret is measured in UTF-8 bytes of the env string (not base64-decoded). The short-lived
  `__Host-oc-auth` cookie (`lib/auth/auth-cookie.mjs`, `a1.<b64url {state, nonce, verifier, exp}>.<b64url HMAC>`) is
  signed apart from the session cookie: its own version tag (`a1`, so a session value never verifies as an auth value
  or the reverse) and a key derived from SESSION_SECRET with HKDF (SHA-256, empty salt, info `oc-auth-cookie-v1`), never
  the raw secret shared with sessions. Both directions are tested.
- CSRF: every POST needs an Origin that equals AUTH_ORIGIN (scheme, host and port; a missing Origin is 403) and
  `Content-Type: application/json` (else 415); no CORS headers are ever sent.
- Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, AUTH_ORIGIN (for now the current production
  vercel.app URL, so preview deploys cannot sign in); the store is UPSTASH_REDIS_REST_URL/_TOKEN,
  else KV_REST_API_URL/KV_REST_API_TOKEN (a URL without a token is not configured; the read-only token and custom
  prefixes are unsupported).

**Store (Upstash Redis over REST with fetch, no dependency).** Keys are prefixed `oc:v1:`: `sub:<sub>` (pid),
`profile:<pid>` (HASH: nick, nickKey, listed 0/1, gen, created, sub (needed by delete); never an email or name), `progress:<pid>`
(HASH: rev, json, total, reachedAt, score), `nick:<nickKey>` (pid, the uniqueness claim), `board` (ZSET of listed pids)
and `rl:<pid>:<route>:<window>` (INCR plus EXPIRE). The pid is a random 16-byte base64url id; Google's sub never
reaches a client. `lib/account/score.mjs` encodes `score = total * 2^31 + (2^31 - 1 - s)`, s being the server's
seconds since 2026-01-01 when the current total was reached, so a descending range gives most stars, then earliest;
`reachedAt` changes only when the recomputed total changes and always comes from the server clock. Writes that must be
atomic are Lua scripts (`cas-progress`, `claim-nick`, `set-listing`, `delete-account`) that only compare and write
values computed in JS (`set-listing` does an HSET of `listed`, then ZADD with the stored score or ZREM; with no stored score it only sets
`listed`, and the ZADD happens at the next progress write because `cas-progress` reads `listed` inside the script
before its ZADD); first sign-in uses `SET sub NX` and the loser re-reads. Nicknames match
`^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$`, are unique on the lowercase key, with reserved names and a small blocked-word list
(matched on a leet-folded form). The default nickname (`lib/account/nickname.mjs`) is a fun, deterministic name made from the first name token
of the email local part: the same email always gives the same nickname. The base is that token lowercased, with any
`+tag` dropped and only `[a-z0-9]` kept, capped at 10 characters; a base shorter than 3 characters, reserved or blocked
is replaced by `player` as the base (`player` itself is reserved, so the result is for example playerster). Five rules
build the fun names: `ster` (append), `er` (double the final consonant, only for a consonant-vowel-consonant ending),
`oton` (drop a final vowel, only when there is one), `inator` and `zilla` (append). A rule that does not apply is
skipped. An FNV-1a hash of the salt `s28` plus the base picks the starting rule, and the applicable rules are tried in
their fixed order cycling from there; a result that fails nickname validation or the blocked-word filter is dropped.
The owner's examples come out exactly: vlad gives vladster, bob gives bobber, kyle gives kyloton. The candidate list,
always the same for the same email, is: the fun names in that order, then `<first>-2` to `<first>-99`, then eight
`<first>-<4 hex>` tails, where `<first>` is the first fun name and the head is cut so the whole stays within 20
characters. `pickNick(email, isTaken)` returns the first candidate whose lowercase key is not taken, or null when every
candidate is taken (the caller must treat null as a failure, never invent a name). The player can override the nickname at any time. A new profile is listed by default
(`listed=1`) and joins the board on its first progress write; the account modal has a "Show me on the leaderboard"
toggle to hide. There is no confirm-once step. After first sign-in a notice says "You're on the leaderboard as <nick>.
Change your nickname or hide yourself in Account."


**Merge.** `mergeStored(storedRaw, incoming, registry)` in `lib/progress.mjs` is the one merge expression (unknown ids
survive, best stars per level, earliest `at`, union of cards); `lib/storage.mjs` and the server both call it.
`POST /api/progress` takes exactly `{v:1, progress}` (any other field, such as a sent total, is 400), sanitizes, reads
rev, merges, computes `total = starTotals(merged, liveRegistry()).earned`, and runs `cas-progress`, retrying up to
3 times on conflict. The client POSTs on sign-in, page load while signed in, each completion and a save-code import,
saves the merged response locally, and never syncs in debug mode.

**Endpoints** (single path segments, all in `api/`):
- `GET /api/account`: `{v:1, configured:false}` when unconfigured; `{v:1, configured:true, signedIn:false}` with no
  store call when there is no cookie; `{signedIn:true, nick, listed}` when signed in; a bad or stale cookie gives
  signedIn:false and clears the cookie; store down is 502 `store-unavailable`.
- `POST /api/account` `{v:1, action}`: `signout`, `nickname {nick}` (409 `nick-taken`, or 400 with field `nick`),
  `listing {listed}`, `delete {confirm:'delete'}`.
- `GET/POST /api/progress`: 200 `{v:1, progress, stars|null, rank|null}` (stars is null until a first write, never 0); errors 401,
  400, 413 (over 16 KB), 429, 502; 503 when unconfigured. POST needs the AUTH_ORIGIN origin and JSON like the account POSTs, then checks the
  declared content-length (413), then the session (401), then the body (its real size, 413, and its shape, 400), then the Redis rate limit (a refused body does not use the quota). The response stars come
  from the server's total, never the body. P4 decisions: the body must be exactly `{v:1, progress}` with `progress.levels` an
  object (field `body` for an extra key, `progress` for a bad progress); the plausibility check reads the stored total just
  before the write (a failed read, or nothing saved yet, skips the check: a first sync never logs) and logs a second line `{msg:'board', outcome:'implausible', why:'jump'|'fast'}`
  (`fast` only when the total first reaches the maximum, at most 30 minutes after `profile.created`, which the store now returns).
- `GET /api/leaderboard` (anonymous allowed): 200 `{v:1, ok:true, size, top:[{rank, nick, stars}] x10,
  me:{stars, rank|null, listed}|null}`, never a pid; rank and size are over the listed set; an empty board is ok with
  `top:[]`; 503 `not-configured`, 502 `store-unavailable`, 429 `rate-limited` (120 reads a minute per IP, in
  memory; no cap across all IPs). A signed-in reader gets `me:{stars|null, rank|null, listed}`; a bad cookie reads as
  anonymous; a 0-star player is not on the board.
- Rate limits: signed in, a Redis fixed window per pid (30 progress writes per 10 minutes, 10 nickname changes per
  hour); anonymous routes use `createLimiter` per IP with their own instance, `instanceMax: Infinity` and
  `maxKeys: 50000`, so only the per-IP limit applies (the guide keeps its 60 a minute per-instance cap) and thousands
  of other addresses in a window do not evict an over-limit one. Players behind one shared address (an office or venue
  network) share that address's allowance, which is set high for that case (120 board reads a minute, 100 sign-in
  starts per 10 minutes). The nickname quota is charged only for a name that can be claimed: a name refused for
  format, reserved or blocked is 400 before the quota is taken and takes none; a taken name uses the quota, so
  probing for taken names is bounded at 10 an hour.
- Logs: one line per request `{msg, outcome, status, ms}`; never a pid, sub, nick, email or cookie.
- `reply`, `sameOrigin` and the cookie helpers move to `lib/http.mjs`; `api/guide.mjs` imports them.

**Three outcomes.** Every read gives ok, unavailable or not configured. A failed store operation returns
`{ok:false, reason:'store'}`, never `[]` or 0. The client maps 502, 503, network errors and odd bodies to
unavailable ("Leaderboard unavailable"; "Account unavailable; your progress is still saved in this browser") and says
"No one on the board yet" only for an ok empty board.

**Threat model.** Progress is client-asserted. The server enforces real Dash0 identities, totals computed on the server
over registered scored levels only, stars capped at MAX_STARS, server-clock tie-breaks and rate limits. Plausibility is
logged, never blocked (`{msg:'board', outcome:'implausible'}` when one write raises the total by more than 50% of the
maximum, or the maximum is reached within 30 minutes of account creation). The remedy is for the owner to unlist the
player in the Upstash console. Accepted: signing in on a shared browser merges that browser's progress into the account.

**UI.** Shown only when configured and not in debug mode. The hub's "Your progress" section gets a Leaderboard button and
either an anchor "Sign in with Google (@dash0.com)" or "Signed in as <nick>" with an Account button. The board modal
(`#board-modal`) lists the top 10 then "You: N stars, #r" or "You're not on the board". The account modal has a
nickname field, a listing toggle, Sign out and Delete with a two-step confirm. The nudge, in the reward card, is
dismissible, shown at most once per page session and not when `signin-nudge` is hidden through `hideHelp`, with
buttons Sign in, Not now and Don't ask again. `?signin=` is read once in `main.mjs`, shown as a notice, then stripped
with `history.replaceState`. Privacy copy: "Optional, @dash0.com Google accounts only. We keep your Google account id,
a nickname and your level stars and cards, nothing else. We never store or show your name or email. Signed-in players
are listed on the leaderboard by default and can hide themselves in Account. Your default nickname is a fun name made
from your email; change it any time. Delete your account to remove everything we hold; this browser
keeps its own copy."

**P3 decisions.** Each of `api/auth-start.mjs`, `api/auth-callback.mjs` and `api/account.mjs` exports
`createAuthStart` / `createAuthCallback` / `createAccount({env, fetch, redis, now, random, registry, log})` and the
default `GET`/`POST` read `process.env` once; `redis` is a ready client (the dev stub passes one), else it is built from
the store env. `lib/auth/config.mjs` holds the shared env check (`authConfig`), the store and the session lookup;
`lib/http.mjs` holds `reply`, `redirect`, `sameOrigin` (lenient, the guide's), `originMatches` (strict, a required
Origin for account POSTs), `isJson`, `readCookie` and `clientKey`. Sign-in is configured only with all four env values,
a store and an https AUTH_ORIGIN (http only for localhost). A GET /api/account on a host other than AUTH_ORIGIN's
answers `configured:false`, so preview deploys show no sign-in UI. auth-start allows 100 starts per client IP per
10 minutes (its own in-memory limiter, no cap across all IPs; a shared network shares the allowance); over it, or any
other refusal, redirects to `/?signin=unavailable`. Accepted: there is one `__Host-oc-auth` cookie, so starting
sign-in in two tabs makes the earlier tab fail with "Sign-in did not work" (the later start replaced its cookie). The
callback maps failures as: no or bad auth cookie, state mismatch, Google error other than `access_denied`, a missing or
oversized code, a token refusal (4xx), an unreadable token and any other ID token reason (including
`email_verified` false) to `failed`; `domain` to `domain`; `access_denied` to `cancelled` (the state must still match);
a network error, timeout or 5xx at the token endpoint, a JWKS failure and a store failure to `unavailable`. Every callback
outcome clears the auth cookie. Store reasons map: `store` and `conflict` to 502 `store-unavailable`, `gone` to 401 (the
cookie is cleared), `limited` to 429 with `retry-after`, nickname `format`/`reserved`/`blocked` to 400
`{field:'nick', reason}`, `taken` to 409 `nick-taken`. POST /api/account bodies are at most 1 KB with listed fields
only (`v`, `action` and the action's own field); `signout` needs no session and no store call; a store outage on a
session lookup is 502 and keeps the cookie, never signed out. Log lines are `{msg, outcome, status, ms}` only.

**Local dev.** `tools/serve.mjs` forwards several Set-Cookie headers and passes a 302 Location through.
`AUTH_STUB=1` gives a stub sign-in (Google user `stub-dev`, email dev@dash0.com, so the nickname is the default one made
from `dev`) whose auth-start redirects straight to the callback (the auth cookie and its state are still made and
checked; no Google call, no token or JWKS fetch). The stub is honoured only when AUTH_STUB is exactly `1` and
AUTH_ORIGIN is `http://localhost` (any port); with any other origin the real flow is used, or, with no Google settings,
sign-in is unconfigured. The dev server (`startServer({authStub})`, or `AUTH_STUB=1 npm run dev`) builds the env itself
(AUTH_ORIGIN `http://localhost:<port>`, a random SESSION_SECRET) and one in-memory store shared by the auth functions,
so browse via http://localhost, not 127.0.0.1, and the data is gone on restart;
`tools/fake-redis.mjs` is an in-memory store speaking the REST and pipeline protocol with a JS twin per Lua script
(Lua itself is covered by the opt-in `test/redis-it.test.mjs`: run it with `REDIS_IT=1` plus
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` and `KV_REST_API_TOKEN`), against a dev
database only; it runs the same scenarios on the real endpoint and on the fake, asserts equal results and state, and
deletes its random-prefix keys afterwards, and `REDIS_IT=1` without a store config fails). `__Host-` cookies over
http://localhost work in Chrome and
Firefox, not Safari.

## 3. Invariants

Registry (`validateRegistry` reports all at once): act and level ids unique across all acts
and bosses (same module twice, or boss also in `levels`, is an error); each act ≥1
non-boss level; card and node references exist; `no` format and order; no `act`/`kind`
declared; valid mechanics; valid widgets (known, unique, non-choice ones in `mechanics`); `run` is a function; reward titles unique.

Progress: never downgrades (best stars, earliest non-null `at`, card union); stars
integers 0–5 (`MAX_STARS`); corrupt input → empty, no throw; `recordCompletion` idempotent;
`mergeProgress` commutative, associative, idempotent for a fixed `keep`.

Unlock (`lib/unlock.mjs`, pure; entered rule decided 2026-10-30, see [M1-DESIGN](M1-DESIGN.md) §3):
- `isCompleted(progress, id)`: has an own entry.
- `isActComplete(act, progress)`: all `levelIds` and the `bossId` (if any) completed.
- `isActUnlocked(i, progress, registry)`: EVERY earlier act complete (whole chain), OR act
  `i` entered (any of its levels or its boss completed; opening a level is not recorded and
  does not count). An entered act never re-locks when an earlier act gains a level.
- `levelState(id, progress, registry)` → `'locked'|'open'|'done'`: unknown → locked;
  completed → done (even in a locked act; imported progress is never hidden); act locked →
  locked; boss with an unfinished level in its act → locked; else open.
- `lockReason(id, progress, registry)` → `{kind:'act', actId}` (act not entered: first incomplete earlier act) `| {kind:'boss', remaining:[ids]} | {kind:'unknown'}` (id or its act not in the registry) `| null` (playable); `levelState` is `'open'` exactly when it is null.

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
| `scoreStars`, `MAX_STARS` | `lib/scoring.mjs` |
| `createLevelContext` | `lib/level-context.mjs` |
| `emptyProgress`, `sanitizeProgress`, `registryIds(registry)` → `{levelIds, cardIds}` (the `keep` ids), `migrate(raw, {current, migrations})` → migrated record, `raw` if at/past `current`, or `null` (corrupt), `mergeProgress(a, b, {keep}?)`, `recordCompletion(progress, levelId, {stars, cards, at}, registry)` → `{progress, firstCompletion, newBest, newCards}`, `starTotals` → `{earned, max}`, `cardTotals` → `{earned, max}` | `lib/progress.mjs` |
| `encodeProgress`, `decodeProgress`, `previewImport`, `REFUSALS` (save codes, #18) | `lib/save-code.mjs` |
| `isCompleted`, `isActComplete`, `isActUnlocked`, `levelState`, `lockReason` | `lib/unlock.mjs` |
| `loadProgress(storageGetter, registry)` → `{status, progress}` (`TypeError` before any read without a registry), `saveProgress(storageGetter, progress, registry)` → `{saved, reason?, progress}` (`progress` is always the registry view; `TypeError` before any storage access without a registry) | `lib/storage.mjs` |
| `resolveTheme`, `readTheme(getter)`, `writeTheme(getter, t)` | `lib/theme.mjs` |
| `HELP_KEY` (`oncall.help`), `readHiddenHelp(getter)` → `{status, hidden: Set}`, `hideHelp(getter, keys)` → `{saved, reason?}` | `lib/help-prefs.mjs` |
| `globeState(registry, progress, map?, soon?)` | `lib/globe.mjs` |
| `dotStates`, `currentActId`, `regionCentre`, `facingRotation`, `globeTarget`, `globeLines`, `globeLabel`, `parseColor`, `readColors`, `createLoop` | `lib/globe-view.mjs` |
| `parseEnv`, `effectiveResource`, `checkConfig` | `lib/widgets/env-config.mjs` |

Totals: star `max = MAX_STARS × |scored registered levels|` (5 ×), `earned` sums best stars over the
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

The "Don't show again" choice for the How to play card (#199) is a preference, not progress, so it has its own key
`oncall.help`, `{"v":1,"hidden":["build","sort"]}` (widget keys, sorted, unique, at most 100), and never
touches `oncall.progress`. `readHiddenHelp` gives `fresh`, `ok`, `corrupt`, `future` or `unavailable` with a
set of the well-formed keys (empty unless `ok` or `future`); a corrupt or unreadable value shows the card.
`hideHelp` reads, unions and writes in one task (unknown well-formed keys are kept), overwrites a corrupt
value with no backup, refuses `future` (store untouched) and a full store (`full`: the union would pass 100 keys; nothing written), and answers `unavailable` when storage throws; the
game raises no notice for any of these. Debug (`?mode=debug`) never writes it.

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
*(Superseded in part by #158: the kit in `docs/DESIGN-SYSTEM.md` replaces this list. `.btn`,
`.lesson-intro`, `.lesson-stage`, `h3.q`, `.speech` and `.bubble` are gone; #158 P7 deleted
the last pre-kit rules from `styles/base.css` (see Retired classes there).)*

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
- `speech('<b>hi</b>')` contains `<b>hi</b>`, `class="ui-lesson"` (since #158, `speech(...)` returns `lesson(...)`; M0 had `class="speech"` and
  `class="bubble"`).
- `shuffle` returns a new array; frozen input unchanged.
- `mistake()` ×2 then `finish({cards:['c1']})` → `{stars:3, cards:['c1'], text:''}`;
  `onFinish` once with `('lvl-a', {stars:3, cards:['c1'], text:'', at:'2026-01-01T00:00:00.000Z'})`
  (now = 1767225600000).
- `now` 0 at create, 61000 at finish, `parMs 60000` → stars 4 (one penalty).
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
- Harness teeth: fixture level finishes once with 5 stars; `click('#missing')` throws
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
- Entered acts (M1-DESIGN §3, `test/unlock.test.mjs`): one completed level or a completed boss alone opens its act; an entered act stays open after an earlier act gains a level, an un-entered one re-locks; un-entered later acts wait for the chain; migration `{naming-your-service:3}` on an M1-shaped registry; `lockReason` null exactly when `levelState` is open. Mutations: drop the entered clause; boss-only act not entered; `levelState` disagrees with `lockReason`.

### F4 `test/progress.test.mjs`
Fixture: `levelIds ['a','b','u']`, `cardIds ['c1','c2']`; `a.cards ['c1','c2']`; `u.scored false`.
- sanitize: `null`, `'x'`, `42`, `[]`, `{v:1, levels:[]}` → empty. Stars 2.7→2, 5→5, 6→5, 99→5, −1→0; a saved 3 stays 3;
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
  call twice → equal progress, `newCards []`; `{stars:0}` on b → completed; stars 7 → 5;
  unknown id → unchanged, flags false; input not mutated.
- mergeProgress: A `{a: 2@T2, b: 0@null}, [c1]`; B `{a: 1@T1, u: 0}, [c2]` →
  `{a:{2, T1}, b:{0, null}, u:{0}}`, `[c1, c2]` (mutations: whole entry from higher side;
  max of `at`). Commutative, idempotent, associative (three fixtures). Null `at` never
  beats a date.
- totals: `{a:2, u:0}` → stars `{earned:2, max:10}` (mutation: count unscored → 15); cards
  `['c1']` → `{earned:1, max:2}`.

### F4 `test/storage.test.mjs` (`fakeStorage({initial, throwOn})` records every `setItem`)
fresh; ok; corrupt for `'{bad'`, `'[]'`, `'{"levels":{}}'`; future for `v:99`; unavailable
for a throwing getter or `getItem`. Save merges with stored (stored `{a:2}`, memory
`{a:1, b:3}` → `{a:2, b:3}`, returns the registry view; mutation: write memory directly).
Save keeps unknown ids. Throwing `setItem` → `{saved:false, reason:'unavailable'}`. Future
→ zero `setItem` calls (mutation: drop the check). Corrupt → backup written before the
progress write, and a second corrupt value doesn't overwrite the backup (it goes to
`.latest`). A registered completion is never evicted by the cap.

### F5 `test/map.test.mjs` (retired by #150)
Replaced by `test/globe.test.mjs` and `test/globe-view.test.mjs` (§2.7); level tests pin
`lights` through `test/helpers/lights.mjs`.

### F5 `test/live-registry.test.mjs`
`buildRegistry(ACTS, {deck: DECK, nodeIds})` doesn't throw; flattened order deepEqual the
expected ids (F6 sets `['naming-your-service']`); `lights` ids unique (#150 dropped the
edge and position checks with the SVG map).

### F5 `test/game.test.mjs` (`createGame` with fake storage, fixture registry, fixed now)
Fresh boot `notice null`; corrupt → `'corrupt'`; throwing getter → `'unavailable'`.
`openLevel` on a locked level → false, `overlayOpen false` (mutation: drop the check).
Completion: open `x`, finish with 1 mistake → stored `x` 4 stars, `levelState 'done'`, its
country lit and its region's `done` counted (`mapState()`, #150), totals updated. `storage` event with `y:3` → `progress.levels.y.stars === 3`.
Stale finish: open `a`, keep ctx, close, open `b`, `a.finish({text:'stale'})` → null,
neither recorded, storage unchanged (mutation: R's `complete(this.currentLevel)`).
`index.html`: `#ov-body`/`#ov-actions` inside `[x-ignore]`; the globe stage (#150) is
`role="img"` named by `mapLabel()`, with a text fallback, and no `style`.

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
(3) precedence question (`checkout` correct). Happy → `{stars:5, cards:['unknown-service']}`;
sloppy (one wrong choice, one failed check) → `{stars:3, …}`. A single dropped `mistake()`
would still change the count, but `test/naming-your-service.test.mjs` plays one-penalty runs (each must score 4★) so each slip is pinned alone. Mutation:
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
`cache: npm`, `npm ci`, `npm test`. `.nvmrc` = current Active LTS major. An `All checks`
job (`if: always()`, `needs:` every other job, fails unless each succeeded) is the merge
gate, with the `PR findings` commit status green (#35): `.github/workflows/pr-findings.yml`
runs `tools/pr-findings.mjs` (the script a local `node tools/pr-findings.mjs <PR>` runs) on
comment events and, through `pr-findings-relay.yml`, PR and review events, and posts its
verdict on the PR head; it runs main's code only, and `All checks` cannot include it
because it re-runs on comments.
