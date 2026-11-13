# Game play events

Epic #18. The game can tell its owner how levels are played: which level, how long, how many stars, where
the page threw. This page is the wire contract between the page and `api/events.mjs`, what the server does
with it, and what is new about turning it on. The shared parts (the three Dash0 variables, the token, the
local stub, the 500 ms limit) are in docs/FOUNDATION.md §2.10. It is off until the owner sets the Dash0
variables.

This is separate from the Act 9 lab (`lib/telemetry.mjs`), which sends the player's own spans to the
player's own Dash0. The events here go to the owner's Dash0, through the server, and the owner's token never
reaches the browser.

## What is sent, and what never is

One `level.play` span for each opened level. Its outcome is `complete` or `abandon`, with the real
duration. On complete it also carries stars, mistakes and hints. Its attributes are the session id (random,
fresh for every page load, not stored), the level id, the act id (the server looks it up) and the outcome.
One `client.error` span per page error, carrying `error.type` (the class name) and the session id, plus the
level id and act id when the error names a level.

Never sent: nickname, email, address, user agent, URL, free text, cookies, or a clock time. Times are
relative (`agoMs`, `durationMs`); the server works out the real times from when the request arrives. The
server drops the request headers and does not log the session id or the level.

## Wire contract, version 1

`POST /api/events`, content type `text/plain` (what a beacon sends) or `application/json`, at most 8192
bytes. Body:

    {"v":1, "sid":"<16 lowercase hex>", "events":[ ...1 to 20 events... ]}

Every object is closed: a key that is not listed rejects the whole batch with a 400 that never echoes a
value. The `field` it names is `body` for a bad top level (not JSON, not an object, an unknown key), `events`
for a bad or unknown key inside an event, and otherwise the one wrong field (`v`, `sid`, `events` when the
list is empty or over 20, `t`, `level`, `outcome`, `durationMs`, `agoMs`, `stars`, `mistakes`, `hints`,
`kind`), for example `{"error":"bad-request","field":"level"}`.

A play event: `{"t":"play", "level", "outcome", "durationMs", "agoMs"}`. `level` is a level id the
registry knows. `outcome` is `complete` or `abandon`. `durationMs` and `agoMs` are integers from 0 to
86,400,000. A `complete` event must also have `stars`, `mistakes` and `hints`: `stars` is 1 to 5 for a
scored level and exactly 0 for an unscored one, `mistakes` and `hints` are integers from 0 to 10,000. An
`abandon` event must not have them.

An error event: `{"t":"error", "kind", "agoMs", "level"?}`. `kind` is a class name of 1 to 40 letters, or
`_OTHER`. `level` is optional and must be a known id.

`GET /api/events` answers `{"v":1,"on":true|false}` and is never cached. The page asks once and sends
nothing unless it says `on: true`.

## Server behaviour

POST checks run in this order, and each failure sends no play event to Dash0. The function's own
`oncall-game-api` server span (docs/FOUNDATION.md §2.10) is still exported when the Dash0 variables are
valid, as a separate export, even for a refused or failed POST.

1. Method other than POST: 405.
2. Not enabled: 204, the body is not read, no play event is sent.
3. An Origin header that names another host: 403. An Origin of `null` is allowed, and a request without
   Origin passes. Why `null`: a string or `text/plain` beacon is a no-cors request
   (https://www.w3.org/TR/beacon/), and with `Referrer-Policy: no-referrer` such a request sends
   `Origin: null` (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy,
   "Effect on the Origin header"). A non-safelisted type such as `application/json` makes it a cors request
   that sends the real origin, which the server also accepts.
4. Content type other than `text/plain` or `application/json`: 415.
5. A declared content length over 8192: 413.
6. The per-client limit (60 per 10 minutes) or the per-instance limit (300 per minute), memory only and
   best effort: 429 with `retry-after`.
7. A body over 8192 bytes: 413. A body that fails the contract: 400.
8. Export to Dash0, awaited, under the same 500 ms limit as the api traces (`lib/otel/export.mjs`).
   Accepted: 204. Dropped (rejected, unreachable, over the limit, too large): 502 and a log line with the
   reason (for example `auth`).

The spans use `service.name` `oncall-game-web`, one trace per event. Each POST also exports the usual
`oncall-game-api` server span for `POST /api/events`, as a separate export.

## Client contract (for the page)

Probe once with GET; only `{"v":1,"on":true}` turns events on. Buffer events and send them when 20 are
waiting, when a level completes, and when the page is hidden or closing (`navigator.sendBeacon`, falling
back to `fetch` with `keepalive`). Never throw, never wait for the result, never report a failed send as a
page error. Send nothing in debug mode. At most 10 error events per page.

## Turning it on (owner)

Set up the Dash0 variables, token and checks as in docs/FOUNDATION.md §2.10; the events use the same ones.
What is specific to events:

1. After the redeploy, check that `GET /api/events` returns `{"v":1,"on":true}`.
2. Finish a level: the POST answers 204 and a `level.play` span appears in Dash0 under `oncall-game-web`.
   Close a tab mid-level: an `abandon` span appears. The function log has no `forbidden` lines.
3. To stop the browser events but keep the api traces, set `DASH0_GAME_EVENTS=off`. Unset or `on` leaves
   them on; any other value, including an empty one, turns them off.
4. Optional, for the owner to confirm on their Vercel plan: a Firewall rate limit on `/api/events`. The
   built-in limit is only per instance.
