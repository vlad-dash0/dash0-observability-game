# The Dash0 lab ("It's us")

Contracts for connecting the game to the player's own Dash0 and the lab boss. Issue #195.
Every Dash0 fact not yet confirmed is marked `VERIFY (#195)` in code and listed under Owner inputs.

## Decisions (2026-11-05)
- Placement: inside Act 9. "Connect the game to Dash0" is an Act 9 level on PNG (9.1 filter-or-sampler takes NZL, 9.2 keeps AUS); the lab "It's us" is Act 9's boss. No new act, no globe region change.
- Hosting: Vercel. The token lives in memory only (a closure in `lib/telemetry.mjs`), never in localStorage, sessionStorage, progress, span attributes, the DOM after capture, a URL or `reportError`.
- Transport: the browser sends OTLP/HTTP JSON straight to the player's ingress. A Vercel relay `api/otlp` is built only if Dash0 refuses browser CORS; it would forward the player's own `Authorization`, never store or log it, forward only to allowlisted hosts and cap the body at 64 KiB.
- Practice mode scores full stars.
- Each phase is one PR against main, never stacked.

## Hosts and CSP
`INGRESS_HOSTS` in `lib/dash0/ingress.mjs` is the single authority: the validator's allowlist and, enforced by `test/static.test.mjs`, the `vercel.json` `connect-src` origins minus `'self'`. It ships `[]` (CSP unchanged, live mode "not open yet"). `PRACTICE_HOSTS` (a reserved `.invalid` host) belongs to the simulated ingress and is never a CSP origin.

## Endpoint check: `parseEndpoint(raw, {hosts, ports, allowLocal})`
Returns `{ok:true, base, tracesUrl, host}` or `{ok:false, reason}`. Reasons, in check order: `empty`, `grpc-port` (scheme-less `host:4317`, or port 4317), `no-scheme` (scheme-less input: a host with a dot, or any host with a port other than 4317, optionally with a path; a word with no dot and no port stays `malformed`), `malformed`, `not-https`, `credentials`, `query`, `fragment`, `unknown-host` (exact match, lookalikes fail), `unexpected-port` (the effective port, `443` when none is written, must be in `ports`; `cspOrigin(host, port)` renders a non-443 port as `https://host:port`), `signal-path` (already ends in `/v1/traces`, case-insensitive, repeated slashes collapsed; the field is the base and the game appends the path), `unexpected-path` (any other path). A trailing slash is normalised and never yields `//v1`. `allowLocal` (debug mode only) also accepts `http://localhost:<port>`.

## Token and dataset
`checkToken(raw)` returns `{ok}` or a reason: `empty`, `bearer-prefix`, `whitespace`, `characters`, `prefix` (`auth_`, https://www.dash0.com/docs/dash0/miscellaneous/glossary/auth-tokens), `length`. `checkDataset(raw)`: empty means the default dataset (`dataset: null`, header omitted), else a slug or `format`. No result ever contains the input. `REASONS` maps each reason to its teaching copy, so validator and level feedback cannot disagree.

## Encoder: `lib/otlp/encode.mjs`
`encodeTraces(drafts, {sessionId})` builds one `ExportTraceServiceRequest`: one resource (`service.name=oncall-game`, `service.version`, `telemetry.sdk.name=oncall-game-otlp`, `telemetry.sdk.language=webjs`, `telemetry.sdk.version`), one scope. Per https://opentelemetry.io/docs/specs/otlp/ (JSON encoding): ids lowercase hex (32 and 16 chars), `*TimeUnixNano` decimal strings computed with BigInt, int attributes `intValue` strings (safe integers and bigint only; anything else throws), enums as integers. The encoder stamps `session.id` on every span in one place; a draft cannot override it. Bad ids, timestamps, attribute types or an empty list throw.

Draft: `{traceId, spanId, parentSpanId?, name, kind? (default internal), startMs, endMs, attributes?, events?: [{name, timeMs, attributes?}], status?: {code: 'ok'|'error', message?}}`. An unset status is omitted.

## Sender: `lib/otlp/send.mjs`
`sendTraces({fetch, tracesUrl, token, dataset, body, signal, setTimeout, clearTimeout, timeoutMs})` POSTs with `Authorization: Bearer`, JSON content type, `Dash0-Dataset` only when a dataset is given, `credentials:'omit'`, `redirect:'error'`, `referrerPolicy:'no-referrer'`, `cache:'no-store'`; 10 s timeout. `classifyResponse` is the only place a response becomes an outcome:
- `accepted`: 2xx with `partialSuccess.rejectedSpans` absent or 0 (an empty body is fine). A 2xx body that is not a JSON object is `rejected` 'Unreadable response body'.
- `rejected {status, auth, message?}`: `auth` is true for 401/403; other 4xx/5xx and a 2xx with rejected spans are `auth:false`. `message` is never set on 401/403. Otherwise it is dropped whole if the response echoes the token, else capped at 200 characters. A response text longer than 64 KiB (65,536 characters, the relay cap) is never searched and never surfaces a message: on a 2xx it is `rejected` 'Unreadable response body', otherwise `rejected` with no message. One search per response, before any message is surfaced: the haystack is the raw body plus, if it parses as JSON, its re-serialised form (so `\u` escapes resolve), with numeric and named (`&amp; &lt; &gt; &quot;`) HTML entities decoded, whitespace stripped and lower-cased. Needles are the token and `Bearer <token>` raw, URL-encoded and JSON-escaped, plus their base64 (standard and URL-safe) at the three byte alignments. Any 8+ character run of a needle (the whole needle if shorter) in the haystack drops the message, including `partialSuccess.errorMessage`.
- `unreachable {cause}`: `network` (fetch threw: DNS, CORS, CSP, or an error response without CORS headers, which a browser cannot tell apart), `timeout`, `opaque` (no usable status), `aborted` (the caller's signal). A body that cannot be read is `unreachable` with the cause that fired (`timeout`, `aborted`) or `network`. `sendTraces` throws a TypeError if `setTimeout`/`clearTimeout` are not injected.
Absence is never success. Thrown error text is never passed through.

## Practice ingress: `lib/otlp/practice-ingress.mjs`
`createPracticeIngress({token, readOnlyToken})` (`token` is one string or an array) returns a fetch-compatible fake. Rules in order: foreign host throws TypeError; not POST 405; path other than `/v1/traces` 404; content type not JSON 415; body not an OTLP traces request 400; missing or wrong token 401; the read-only token 403; else 200 `{}`. It goes through the same `sendTraces`, so practice and live cannot diverge. Practice never calls the real fetch.

## Telemetry session: `lib/telemetry.mjs`
`createTelemetry({fetch, randomBytes, now, setTimeout, clearTimeout, reportError, hosts, allowLocal})` returns the facade `ctx.telemetry` exposes (FOUNDATION §2.6). Everything is injected; `main.mjs` supplies the browser's.
- Token: only in the closure and the outgoing `Authorization` header. Not in `status()`, an outcome, a span, `reportError` (always a fresh Error built from the message or thrown string, with every token the session has used rewritten to `[token]`, so a late error from a replaced config is redacted too; a message that holds any session token in another shape, such as URL-encoded, re-cased or base64, is replaced whole by `telemetry error (message withheld)`) or the DOM.
- State: `off`, then `configured` (`connect` validated; nothing sent), then `connected` only when `sendTest` is `accepted` for the current config generation. `connect` and `disconnect` bump a generation counter; a late outcome for an older generation changes nothing and is returned as `unreachable/aborted`. A failed or aborted re-test demotes `connected` to `configured` and clears the span buffer, counting its spans as dropped. `connect` and `disconnect` start a new session: they discard the buffer without counting it and reset `dropped` to 0. Only a failed or aborted re-test counts its spans as dropped.
- `sendTest` is single-flight per generation (the in-flight promise is returned). Practice goes to `createPracticeIngress` and never calls the injected `fetch`; live never calls the practice ingress. Live needs `INGRESS_HOSTS` non-empty and a `fetch` (`liveAvailable()`), otherwise `connect` returns `{field:'mode', reason:'unavailable'}`.
- `emit` is a no-op unless connected and never throws (a bad draft is reported and counted dropped). Missing ids and times are filled in. The buffer holds 200 spans; more are dropped and counted. `flush` takes the buffer synchronously, so spans emitted meanwhile go in the next batch; a failed flush drops its snapshot and counts it; a flush that finishes after the config changed returns `unreachable/aborted` and touches no counter. `stats()` is `{buffered, dropped}`. `sendBatch` bypasses the buffer and rejects on an invalid draft.
- `app.mjs` `completeLevel` emits `level.complete` (`game.level.id`, `game.act.id`, `game.level.stars` = the result's stars, `game.cards.count`, `game.debug`) and flushes without awaiting, inside try/catch with `reportError`. No request is made unless connected. Completion never waits on telemetry.

## The connect level: `levels/connect-to-dash0.mjs` (9.3, PNG)
A hand-written level (`widgets: []`, scored, no par). Screens: mode (practice, or live while `liveAvailable()`); connect (practice shows a labelled simulated settings page with the endpoint reference and a token creator; live shows where to look); connected (session id, Finish with `data-finish`, only after `accepted` and `status().state === 'connected'`).
- Validation is `ctx.telemetry.connect` (`parseEndpoint`, `checkToken`, `checkDataset`); the level only words the reason from `REASONS`. An empty endpoint or token is a nudge and costs nothing.
- One charge rule, the same in both modes: each distinct cause costs one mistake, once, held in one Set: a wrong permission (`scope:<key>`), a form error (`<field>:<reason>`) or a rejected token (`rejected:<status>`). An emptied token field right after a form error or a rejection keeps the earlier reason.
- Permissions: practice mints a token per permission in a token creator; live cannot see a token's permission, so the player declares it ("Which permission did you give this token?") before Connect, charged by the same rule. Ingesting is right; All permissions and Reading are wrong.
- Practice tokens come from `telemetry.practiceCredential(scope)`: `auth_practice_` plus a suffix from the session's `randomBytes`, so the name does not say what the token can do and a replay cannot type it. Reading's token is the one the practice ingress refuses with 403; the other two are accepted.
- Outcomes: `accepted` goes to Finish; `rejected` with `auth` costs a mistake in both modes and says only "refused this token", with the remedy (complete, from this organization, has the Ingesting permission), never the status code; `rejected` without `auth` and every `unreachable` cause cost nothing and offer a retry (live unreachable also offers practice).
- The player is never told the answer: the screens give the reason (the game sends from a browser tab, the token sits where anyone can open dev tools) and the endpoint field is "Endpoint", not a label to match. The port is not asserted: the copy says to copy the address exactly as Dash0 shows it.
- The token: the secret field (`field kind: 'secret'`, a write-only password input) is read and emptied in the same click, before validation. The shown practice token is scrubbed from the page at the same moment. The secret field asks password managers not to offer to save it, but a browser may ignore that, so the copy only says the game never saves the token and tells the player to decline a save prompt. After a failed send the held token is retried without retyping; to change it the player types a new one. The level file never touches storage, the URL, the console or `reportError` (`test/connect-to-dash0.test.mjs` scans its source).

## Phase ledger
| Phase | Content | State |
|---|---|---|
| P1 | encoder, sender, validators, practice ingress, this doc, derived CSP test | merged (#197) |
| P2 | `lib/telemetry.mjs`, `ctx.telemetry`, completion spans, FOUNDATION §2.6 | this PR |
| P4 | `lib/incident-lab.mjs`: seeded incident, `answersFrom`, `gradeAnswer` | planned |
| P3 | Act 9 level 9.3 "Connect the game to Dash0" (PNG), secret field kind, connect form, practice mode | in review |
| P5 | the lab boss "It's us" | planned |
| P6 | fill `INGRESS_HOSTS`, `vercel.json`, cite Dash0 docs; relay only if CORS is refused | needs owner inputs |

Merge order: P1, P2, P4, P3, P5, P6.

### P6 live QA list
- In a real browser (Chrome, Firefox, Safari), connect live and check that no password-manager save prompt appears when the token field disappears on success. If one does, the opt-out attributes of the secret field are not enough.
- Check that the ingress answers CORS preflights (owner input 1) and what a rejected token returns (owner input 2).

## Owner inputs (VERIFY)
1. Does the OTLP/HTTP ingress answer browser CORS preflights for `Authorization`, `Content-Type` and `Dash0-Dataset`, including on 401/403? If not, the relay is needed.
2. Scope names (ingest-only, dataset-limited), where tokens are created (the `auth_` prefix and `Dash0-Dataset` header are confirmed in the Dash0 docs), whether 401/403 mean what the game teaches.
3. Region and ingress host list, OTLP/HTTP port (443 or 4318), JSON body acceptance, the dataset identifier rules (the game's regex is its own check).
4. Trace explorer view name, how to filter by `session.id`, deep-link format.
5. A test org with an ingest-only token for the live QA run (never committed).
