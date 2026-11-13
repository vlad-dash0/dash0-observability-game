# Dash0 Observability Game (working title)

A browser game that teaches observability to working engineers: the three (now four)
signals, OpenTelemetry and the details that trip people up, and how Dash0 ties it
together. You join a small company as its new on-call engineer and level up by
instrumenting, querying and debugging a system that gets more complex as you go.

Status: **M0 and M1 are done** (the M1 vertical slice). Playable today: Act 0
(Orientation) and its boss; Act 2 (Traces), levels 2.1 to 2.7, and its boss "Checkout
is slow"; plus 1.2 Naming your service from M0. Level widgets: Choice, Sort it, Build it
(trace waterfall), env-config, the incident engine and triage. The level list is in
[docs/OUTLINE.md](docs/OUTLINE.md) §4; the registry is `levels/index.mjs`. **Ask the
guide has not shipped**: it was in the original M1 scope and is now a separate track.
Next is the platform milestone (OUTLINE §8). Foundation design:
[docs/FOUNDATION.md](docs/FOUNDATION.md); M1 design: [docs/M1-DESIGN.md](docs/M1-DESIGN.md).

- [docs/OUTLINE.md](docs/OUTLINE.md): game structure, curriculum (acts and levels), OTel
  nuances, how Dash0 fits in, and open questions
- [docs/GLOSSARY.md](docs/GLOSSARY.md): the glossary the game teaches and links to
- [docs/FOUNDATION.md](docs/FOUNDATION.md): M0 design (contracts, invariants, test spec)
- [docs/M1-DESIGN.md](docs/M1-DESIGN.md): M1 design (Act 0 and Act 2 content, widgets)
- [docs/DECLARATIVE-LEVELS.md](docs/DECLARATIVE-LEVELS.md): M2 declarative level format (#71)
- [docs/GAME-EVENTS.md](docs/GAME-EVENTS.md): play events from the browser to the owner's Dash0 (wire contract, owner steps)
- [docs/LIVE-DEMO.md](docs/LIVE-DEMO.md): Act 9 Live Demo foundation (privacy, template, sign-off gates)
- [docs/prototypes/README.md](docs/prototypes/README.md): approved UI prototypes (reference specs for builders)

## Run and test

Needs Node 22 or later (`.nvmrc` pins the Active LTS; CI tests both 22 and that). No build step.

```sh
npm ci          # installs linkedom, the only (dev) dependency
npm run dev     # http://localhost:3000/, production headers (CSP) and .vercelignore; PORT=8080 to change
npm test        # node --test over test/**/*.test.mjs
```

The dev server 404s what `.vercelignore` excludes and, stricter than Vercel, every
dotfile. It deploys to Vercel as static files plus the `api/` functions, run locally at `/api/<name>`.

"Ask the guide" (`api/guide.mjs`, docs/FOUNDATION.md §2.8) needs `ANTHROPIC_API_KEY` in the Vercel project's
environment (Production and Preview). Without it the function answers "not configured" and the game hides the
guide. Create the key in its own Anthropic workspace with a monthly spend limit: that limit is the real cap on
what the endpoint can spend (the in-memory rate limit is per instance and a request without an `Origin` header is
served). Locally `GUIDE_STUB=1 npm run dev` answers with a canned reply and needs no key. The rate limit is best
effort (per instance, in memory), not a quota.

Server telemetry (docs/FOUNDATION.md §2.10) sends one trace per `api/` request
(and, once the page sends them, anonymous play events, docs/GAME-EVENTS.md) to your Dash0 when the endpoint and the
token are set in the Vercel project's environment (the dataset is optional; none set means off; a partial or malformed
set is reported in the function log and changes nothing for players). `TELEMETRY_STUB=1 npm run dev` prints one line per
span instead, with no network.

| Variable | Meaning |
| --- | --- |
| `DASH0_OTLP_ENDPOINT` | Dash0 ingress base URL, e.g. `https://ingress.eu-west-1.aws.dash0.com` |
| `DASH0_AUTH_TOKEN` | an `auth_...` token that may send traces |
| `DASH0_DATASET` | optional dataset slug; omitted means the default dataset |

## Lineage

The setup follows the pattern of
[wealthbot-io/webo-money-world](https://github.com/wealthbot-io/webo-money-world):
static front end (Alpine.js ES modules), one file per lesson in a registry, a hub world
that fills in as lessons complete, local-first progress, an optional Claude-backed
helper behind a serverless proxy, and play-through tests for every lesson. The same
author built it, so its code is reused directly (adapted where
[docs/FOUNDATION.md](docs/FOUNDATION.md) says so).
