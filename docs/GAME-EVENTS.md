# Game play events

Epic #18. The game can tell its owner how levels are played: which level, how long, how many stars, where
the page threw. This page is the wire contract between the page and `api/events.mjs`, what the server does
with it, and how the owner turns it on. It is off until the owner sets the Dash0 variables.

This is separate from the Act 9 lab (`lib/telemetry.mjs`), which sends the player's own spans to the
player's own Dash0. The events here go to the owner's Dash0, through the server, and the owner's token never
reaches the browser.

## What is sent, and what never is

One `level.play` span for each opened level. Its outcome is `complete` or `abandon`, with the real
duration. On complete it also carries stars, mistakes and hints. One `client.error` span per page error,
carrying only the error class name. Each span has a random session id (fresh for every page load, not
stored), the level id and the act id (the server looks the act up).

Never sent: nickname, email, address, user agent, URL, free text, cookies, or a clock time. Times are
relative (`agoMs`, `durationMs`); the server works out the real times from when the request arrives. The
server drops the request headers and does not log the session id or the level.

## Wire contract, version 1

`POST /api/events`, content type `text/plain` (what a beacon sends) or `application/json`, at most 8192
bytes. Body:

    {"v":1, "sid":"<16 lowercase hex>", "events":[ ...1 to 20 events... ]}

Every object is closed: a key that is not listed rejects the whole batch with a 400 that names only the
field (`{"error":"bad-request","field":"level"}`), never the value.

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

POST checks run in this order, and each failure sends nothing to Dash0.

1. Method other than POST: 405.
2. Not enabled: 204, the body is not read, nothing is sent.
3. An Origin header that names another host: 403. An Origin of `null` is allowed, because the page's
   `Referrer-Policy: no-referrer` makes beacons send `Origin: null`. A request without Origin passes.
4. Content type other than `text/plain` or `application/json`: 415.
5. A declared content length over 8192: 413.
6. The per-client limit (60 per 10 minutes) or the per-instance limit (300 per minute), memory only and
   best effort: 429 with `retry-after`.
7. A body over 8192 bytes: 413. A body that fails the contract: 400.
8. Export to Dash0, awaited, within the same 500 ms budget as the api traces (`lib/otel/export.mjs`).
   Accepted: 204. Dropped (rejected, unreachable, over the budget, too large): 502 and a log line with the
   reason (for example `auth`).

The spans use `service.name` `oncall-game-web`, one trace per event.

## Client contract (for the page)

Probe once with GET; only `{"v":1,"on":true}` turns events on. Buffer events and send them when 20 are
waiting, when a level completes, and when the page is hidden or closing (`navigator.sendBeacon`, falling
back to `fetch` with `keepalive`). Never throw, never wait for the result, never report a failed send as a
page error. Send nothing in debug mode. At most 10 error events per page.

## Turning it on (owner)

1. Set `DASH0_OTLP_ENDPOINT`, `DASH0_AUTH_TOKEN` and `DASH0_DATASET` in Vercel, the same variables the api
   traces use, and redeploy.
2. Check `GET /api/events` returns `{"v":1,"on":true}`.
3. To stop the browser events but keep the api traces, set `DASH0_GAME_EVENTS=off`. Unset or `on` leaves
   them on; any other value turns them off.
4. Optional: add a Vercel Firewall rate limit on `/api/events`. The built-in limit is only per instance.

Locally, `TELEMETRY_STUB=1 npm run dev` prints one `span ...` line for each event and sends nothing.
