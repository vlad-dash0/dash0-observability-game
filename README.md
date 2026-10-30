# Dash0 Observability Game (working title)

A browser game that teaches observability to working engineers: the three (now four)
signals, OpenTelemetry and the details that trip people up, and how Dash0 ties it
together. You join a small company as its new on-call engineer and level up by
instrumenting, querying and debugging a system that gets more complex as you go.

Status: **outline stage**, no game code yet.

- [docs/OUTLINE.md](docs/OUTLINE.md): game structure, curriculum (acts and levels), OTel
  nuances, how Dash0 fits in, and open questions
- [docs/GLOSSARY.md](docs/GLOSSARY.md): the glossary the game teaches and links to

## Lineage

The setup follows the pattern of
[wealthbot-io/webo-money-world](https://github.com/wealthbot-io/webo-money-world):
static front end (Alpine.js ES modules), one file per lesson in a registry, a hub world
that fills in as lessons complete, local-first progress, an optional Claude-backed
helper behind a serverless proxy, and play-through tests for every lesson. That repo
has no license, so we reuse the architecture, not the code, unless its owners grant it.
