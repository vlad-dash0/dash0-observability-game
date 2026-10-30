# Dash0 Observability Game (working title)

A browser game that teaches observability to working engineers: the three (now four)
signals, OpenTelemetry and the details that trip people up, and how Dash0 ties it
together. You join a small company as its new on-call engineer and level up by
instrumenting, querying and debugging a system that gets more complex as you go.

Status: **M0 foundation**: the app shell, CI and static checks are in; the hub, level
platform and first level are being built (design: [docs/FOUNDATION.md](docs/FOUNDATION.md)).

- [docs/OUTLINE.md](docs/OUTLINE.md): game structure, curriculum (acts and levels), OTel
  nuances, how Dash0 fits in, and open questions
- [docs/GLOSSARY.md](docs/GLOSSARY.md): the glossary the game teaches and links to
- [docs/FOUNDATION.md](docs/FOUNDATION.md): M0 design (contracts, invariants, test spec)

## Run and test

Needs Node 22 or later (`.nvmrc` pins the Active LTS; CI tests both 22 and that). No build step.

```sh
npm ci          # installs linkedom, the only (dev) dependency
npm run dev     # http://localhost:3000/, production headers (CSP) and .vercelignore; PORT=8080 to change
npm test        # node --test over test/**/*.test.mjs
```

The dev server 404s what `.vercelignore` excludes and, stricter than Vercel, every
dotfile. It deploys to Vercel as static files (serverless `api/` functions come later).

## Lineage

The setup follows the pattern of
[wealthbot-io/webo-money-world](https://github.com/wealthbot-io/webo-money-world):
static front end (Alpine.js ES modules), one file per lesson in a registry, a hub world
that fills in as lessons complete, local-first progress, an optional Claude-backed
helper behind a serverless proxy, and play-through tests for every lesson. The same
author built it, so its code is reused directly (adapted where
[docs/FOUNDATION.md](docs/FOUNDATION.md) says so).
