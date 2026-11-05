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
Returns `{ok:true, base, tracesUrl, host}` or `{ok:false, reason}`. Reasons, in check order: `empty`, `grpc-port` (scheme-less `host:port`, or port 4317), `malformed`, `not-https`, `credentials`, `query`, `fragment`, `unknown-host` (exact match, lookalikes fail), `unexpected-port`, `signal-path` (already ends in `/v1/traces`; the field is the base and the game appends the path), `unexpected-path` (any other path). A trailing slash is normalised and never yields `//v1`. `allowLocal` (debug mode only) also accepts `http://localhost:<port>`.

## Token and dataset
`checkToken(raw)` returns `{ok}` or a reason: `empty`, `bearer-prefix`, `whitespace`, `characters`, `prefix` (only while a verified `TOKEN_PREFIX` is set), `length`. `checkDataset(raw)`: empty means the default dataset (`dataset: null`, header omitted), else a slug or `format`. No result ever contains the input. `REASONS` maps each reason to its teaching copy, so validator and level feedback cannot disagree.

## Encoder: `lib/otlp/encode.mjs`
`encodeTraces(drafts, {sessionId})` builds one `ExportTraceServiceRequest`: one resource (`service.name=oncall-game`, `service.version`, `telemetry.sdk.name=oncall-game-otlp`, `telemetry.sdk.language=webjs`), one scope. Per https://opentelemetry.io/docs/specs/otlp/ (JSON encoding): ids lowercase hex (32 and 16 chars), `*TimeUnixNano` decimal strings computed with BigInt, int attributes `intValue` strings, enums as integers. The encoder stamps `session.id` on every span in one place; a draft cannot override it. Bad ids, timestamps, attribute types or an empty list throw.

Draft: `{traceId, spanId, parentSpanId?, name, kind? (default internal), startMs, endMs, attributes?, events?: [{name, timeMs, attributes?}], status?: {code: 'ok'|'error', message?}}`. An unset status is omitted.

## Sender: `lib/otlp/send.mjs`
`sendTraces({fetch, tracesUrl, token, dataset, body, signal, setTimeout, clearTimeout, timeoutMs})` POSTs with `Authorization: Bearer`, JSON content type, `Dash0-Dataset` only when a dataset is given, `credentials:'omit'`, `redirect:'error'`, `referrerPolicy:'no-referrer'`, `cache:'no-store'`; 10 s timeout. `classifyResponse` is the only place a response becomes an outcome:
- `accepted`: 2xx with `partialSuccess.rejectedSpans` absent or 0 (an empty body is fine).
- `rejected {status, auth, message?}`: `auth` is true for 401/403; other 4xx/5xx and a 2xx with rejected spans are `auth:false`. `message` is capped at 200 characters with the token replaced by `[token]`.
- `unreachable {cause}`: `network` (fetch threw: DNS, CORS, CSP, or an error response without CORS headers, which a browser cannot tell apart), `timeout`, `opaque` (no usable status), `aborted` (the caller's signal).
Absence is never success. Thrown error text is never passed through.

## Practice ingress: `lib/otlp/practice-ingress.mjs`
`createPracticeIngress({token, readOnlyToken})` returns a fetch-compatible fake. Rules in order: foreign host throws TypeError; not POST 405; path other than `/v1/traces` 404; content type not JSON 415; body not an OTLP traces request 400; missing or wrong token 401; the read-only token 403; else 200 `{}`. It goes through the same `sendTraces`, so practice and live cannot diverge. Practice never calls the real fetch.

## Phase ledger
| Phase | Content | State |
|---|---|---|
| P1 | encoder, sender, validators, practice ingress, this doc, derived CSP test | this PR |
| P2 | `lib/telemetry.mjs`, `ctx.telemetry`, completion spans, FOUNDATION §2.6 | planned |
| P4 | `lib/incident-lab.mjs`: seeded incident, `answersFrom`, `gradeAnswer` | planned |
| P3 | Act 9 level "Connect the game to Dash0" (PNG), secret field kind, connect form | planned |
| P5 | the lab boss "It's us" | planned |
| P6 | fill `INGRESS_HOSTS`, `vercel.json`, cite Dash0 docs; relay only if CORS is refused | needs owner inputs |

Merge order: P1, P2, P4, P3, P5, P6.

## Owner inputs (VERIFY)
1. Does the OTLP/HTTP ingress answer browser CORS preflights for `Authorization`, `Content-Type` and `Dash0-Dataset`, including on 401/403? If not, the relay is needed.
2. Token prefix, scope names (ingest-only, dataset-limited), where tokens are created, whether 401/403 mean what the game teaches.
3. Region and ingress host list, OTLP/HTTP port (443 or 4318), JSON body acceptance, the dataset header name.
4. Trace explorer view name, how to filter by `session.id`, deep-link format.
5. A test org with an ingest-only token for the live QA run (never committed).
