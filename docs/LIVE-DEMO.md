# Live Demo (Act 9) foundation (#177)

How an SE turns a question from a customer call into an Act 9 level. Epic: #32 (ledger), #177 (foundation and level 9.2). It builds on DECLARATIVE-LEVELS.md and FOUNDATION §2.

## 1. Purpose

Act 9 turns anonymised questions from real calls into "does this answer hold?" levels.
- A presenter gives a confident answer. The player decides: it holds, it is wrong, or ask first.
- Levels use existing widgets only. No new widget, no new engine.
- Each level is driven by a Dash0 specific: the passing setup is something Dash0 does, with a public page to back it.
- This is also how the game introduces Dash0 to the team: the level teaches the concept, then shows where Dash0 handles it.

## 2. The privacy boundary

- The source notes are held privately outside the repo. They are never linked, named, dated or described here, in a level, in a PR or in a commit.
- What enters the repo: a paraphrased question, invented round figures, and public sources (dash0.com docs, OpenTelemetry specs).
- The same rule holds for PR descriptions, issues and intake cards: the paraphrase only, never the source wording.
- When unsure whether something may enter, it may not. Ask the owner.

## 3. Anonymisation rules

- No customer, company, person or customer-product names. Use "the shop", "the platform team".
- No identifying numbers: no real traffic, spend, host counts, dates or version strings. Invent round figures (1,000 requests a second).
- Paraphrase, never quote. Combining questions from several calls is allowed and encouraged.
- The test: could anyone on the call recognise it? If yes, change it until they could not.

## 4. The intake card

Fill one in per question, in the PR description or the level issue (not in the repo's docs).

```
Question (paraphrased, one sentence):
The confident answer the presenter gives:
Why it is wrong, or when it holds:
Concept taught (one):
Mechanic for step 2 (Trade-off, Sort it, Spot it, Query it, Configure it or Build it; existing only):
Dash0 specific (the passing setup):
Public source for it (URL, read on dash0.com or confirmed by product):
Invented figures (round, one table):
Pricing involved? (yes needs G3):
Anonymisation check (G1 done by):
```

## 5. The level template

A declarative level (DECLARATIVE-LEVELS.md §2) with two steps.
- `intro` holds the presenter's confident answer. The presenter is "the presenter", with no affiliation stated: they are shown confidently wrong, so they must not read as Dash0.
- `show` holds the evidence: a small table or list.
- Step 1 is a `choice` with keys `holds`, `wrong`, `follow-up`. Labels open with "It holds:", "It is wrong:", "Ask first:". Exactly one is right.
- Step 2 is one existing mechanic step (Trade-off, Sort it, Spot it, Query it, Configure it, Build it) that proves the verdict with numbers.
- All numbers come from one constants table at the top of the level file. Copy, tests and widget data read from it.
- No Collector YAML unless a test validates it. No pricing copy without G3.
- Act 9 needs at least one level whose right verdict is `holds` or `follow-up` before more `wrong` levels are added, and presenters are confident, not hasty: no copy that hints at haste ("straight away") or a tell in the label lengths.
- Normal scoring, no bonus stars. `scoreStars` only subtracts and tops out at `MAX_STARS`, so "catching the wrong answer" means not losing a star. A bonus would need a scoring change, which is out of scope.

Worked example: 9.2 "The 34% error rate" (#32 ledger, #177 design). At 1,000 requests a second with 50 errors, tail sampling keeps every error plus 10% of the rest, so 50 of 145 stored spans are errors: 34%, while the request error rate is 5%. The right verdict is `wrong` (the ratio is over kept spans); step 2 is a Trade-off whose answer computes RED before sampling.

Dash0 pages for 9.2, both read on dash0.com on 2026-11-05:
- SignalControl sample traces: https://www.dash0.com/docs/dash0/telemetry/signal-control/sample-traces
- SignalControl Edge, `dash0redmetrics` in the pre-sampling pipeline: https://www.dash0.com/docs/dash0/telemetry/signal-control/edge/about-signalcontrol-edge

Each level's finish names where Dash0 handles the concept, with a sentence cited from a Dash0 docs page. 9.2's Dash0 close is still owed (tracked on #32).

Open product question, not claimed anywhere in the copy: what `dash0.spans.red` shows when spans are sampled in the customer's own Collector before sending.

## 6. Sign-off gates

All four before merge. Record each in the PR.
- **G1 Anonymisation.** Section 3 applied; a second person confirms the "could they recognise it?" test.
- **G2 Dash0 claims.** Every Dash0 statement is read on dash0.com or confirmed by product, with the URL in a `// Dash0 docs:` comment on the level.
- **G3 Pricing.** Any cost or pricing copy has product sign-off. Without it, leave pricing out.
- **G4 Presenter tone.** The presenter is confident, never a villain, never a real person, never Dash0.

## 7. Act registration

Decision (owner, 2026-11-05): Act 9 is the endgame, chained after the earlier acts (option A, no unlock code change).
- `levels/index.mjs` ACTS gets `{ id: 'act-9', no: 9, name: 'Live Demo', sub: 'Does that answer hold?', levels: [...], boss: null }`, after act-6. Act numbers may skip and a null boss is handled.
- Act 9 opens when every act before it in ACTS is complete (now acts 0-7), or once entered (`lib/unlock.mjs`). `?mode=debug` opens it.
- When Acts 7-8 land, they must come before act-9 in ACTS, and act-9 then re-locks for anyone who finished 0-6 without entering it. If an always-open side track is wanted instead (option B), that change must merge before the first Act 7 PR. Revisit then, not before. Act 7 landed with level 7.1 (option A kept): act-9 now needs acts 0-7, or to have been entered; Act 8 is still coming soon.
- Globe: `ACT_REGIONS['act-9']` is already Oceania. `test/globe-data.test.mjs:97` has an `inBox('AUS', ...)` dot-placement check; the separate `HOME` table (about line 156) gets an AUS box only when AUS is first mapped to a level. A country can serve only one level (the `countries are distinct across the whole game and exist in the data` test, `test/globe-data.test.mjs:38`), so each Act 9 level needs its own country in `hub/globe-map.mjs`: `LEVEL_COUNTRY[<id>]` plus `COUNTRY_NAMES.<ISO>` (once per country). Only AUS (391 dots), PNG (23) and NZL (13) reach `MIN_DOTS` (6), so plan at most 3 Act 9 levels. Epic #32's ledger plans 8 levels plus a boss, so the globe capacity is an open owner decision to settle before a fourth Act 9 level (widen the region, change the one-country rule, or cap the act): [#32 comment](https://github.com/vlad-dash0/dash0-observability-game/issues/32#issuecomment-6663168538). When a country is first mapped, `HOME` in `test/globe-data.test.mjs` needs one box for it (the test requires a box for exactly the mapped countries).
- Act 9 levels so far: 9.1 "Filter, sampler, or both?" (`filter-or-sampler`, NZL, hints off, the finish text names Dash0 spam filters and SignalControl sampling) and 9.2 (AUS). PNG stays free for the next one.
- No new card needed when the fact already has one (9.2 uses `spanmetrics-before-sampling`).
- Citation host: `www.dash0.com` is allowed in SPEC_HOSTS (`test/content.test.mjs`, decided in #177).

## 8. Call-to-PR checklist

1. Fill the intake card (section 4). Stop if the concept does not fit an existing mechanic.
2. Anonymise (section 3). Get G1.
3. Find the Dash0 page that backs the passing setup. Get G2. If there is none, the question is not an Act 9 level.
4. Write the constants table, then the level from the template (section 5), plus its driver in `test/levels-play.test.mjs` (happy and sloppy runs).
5. Register it: the `act-9` ACTS entry once (in the first Act 9 level PR, §7); then, per level, its globe country and the globe test.
6. One branch per level, PR to `main`, title `feat: ... (#N)`. Get G3 and G4 recorded in the PR.
7. Tick the ledger line in #32.
