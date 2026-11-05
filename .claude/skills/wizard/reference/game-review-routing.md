# Game review routing: one split review per PR head

> Project-specific, loaded on demand: pointed to from the "Wizard workflow" section of this
> repo's `CLAUDE.md`. Owner decision 2026-11-05. It holds who reviews a PR head, the brief
> they share, and how their tables become the one posted review comment. The comment format
> itself is `.github/pull_request_template.md`; the merge gate is the Git section of `CLAUDE.md`
> (`All checks` green and the `PR findings` commit status green; CI runs `tools/pr-findings.mjs`,
> and only OWNER, MEMBER and COLLABORATOR comments count).

## Why split

One reviewer reading a level PR for logic, fairness, facts, rendering and wording at once
misses one of them per round. Precedent: PR #164 took six rounds (hint and board
contradictions, one per round), PR #145 six rounds on facts, PR #147 a rework for Collector
configs that did not validate. Narrow lenses, each with one question, run in parallel on the
same head and find their class in one pass.

## Who reviews: route by the diff

For every new head SHA, the orchestrator lists the paths the PR changes against its base
(`git diff --name-only <base>...<head>`) plus whether the PR body changed, and dispatches **in
parallel** every reviewer whose row matches:

| Reviewer | Model | Dispatch when the diff touches | Lane (one question) |
|---|---|---|---|
| `qa-engineer` | opus | always, except a docs-only or `.claude`-only PR | Is the logic right, and does every test have teeth (one-line mutation goes red)? |
| `level-design-reviewer` | opus | `levels/`, or widget grading, hint or star code (`lib/widgets/*` outside `*-view.mjs`, `lib/widgets/help-ladder.mjs`, `lib/scoring.mjs`) | Can the level be passed without learning the concept, and do hints and stars play fair? |
| `content-fact-checker` | sonnet | level content (`levels/`), `cards/`, or a technical claim in `docs/` (docs-only PRs included) | Is every claim true, cited on an allowed host, and every shown Collector config validated? |
| `browser-verifier` | sonnet | view code (`lib/widgets/*-view.mjs`, `lib/globe-render.mjs`, `lib/swirl-render.mjs`, any module that writes markup), `styles/`, `index.html`, `main.mjs`, `app.mjs` | Does the real browser give the player focus, keyboard, contrast, a clean console and released WebGL? |
| `ui-copy-lens` | haiku | any player-facing text, `docs/`, `.claude/`, or the PR body | Are the words plain, consistent, free of em dashes and attribution, and true to the code? |
| `doc-librarian` | sonnet | any diff touching `README.md`, `docs/` or `.claude/` (docs-only and `.claude`-only PRs included) | Is the doc corpus reachable, current and inside its budget? |

**A docs-only or `.claude`-only PR gets `ui-copy-lens` and `doc-librarian`, plus
`content-fact-checker` when it changes a technical claim in `docs/`; no other reviewer.** A PR that
touches several rows gets every matching reviewer; one reviewer is never stretched across a
second lane to save a dispatch.

## The base brief (identical for every reviewer)

Each reviewer gets the same base, then its one-line focus from the table above:

- PR number, **head SHA**, base branch, and the **worktree absolute path** checked out at that SHA.
- **Decisions already made** (owner decisions, accepted trade-offs, things the PR body says are
  out of scope), so no reviewer re-litigates them.
- **Do not re-raise**: every finding from earlier rounds on this PR already dispositioned
  (fixed, won't fix, by design), by id and one line each.
- Its own **scratch subdirectory** (`<scratchpad>/review-<sha7>-<agent>/`), absolute.
- Test runs use `NODE_OPTIONS=--max-old-space-size=2048`; probes carry timeouts.
- **Stay in your lane**: a finding in another reviewer's lane goes in your notes as one line,
  never in your table. Reviewers commit nothing and post nothing; `qa-engineer` in a review
  dispatch returns findings and reverts its mutations without committing (`qa-engineer.md`, "Review dispatch").
- Return the review table, then a section headed **Notes for the orchestrator (not posted)**.

## The budget

Reviewers share the test-running budget (`capacity-and-worktrees.md`). `qa-engineer` and
`browser-verifier` each hold a slot for the whole dispatch; the other reviewers hold one only
when their brief tells them to run `npm test`. Get a `resource-manager` GO for the slot count
before dispatching; queue the rest, never drop a lane to fit.

## One posted comment per head

When every dispatched reviewer has returned, the orchestrator posts **one** review comment:

1. **Cut each return at "Notes for the orchestrator"** and keep only the part above it. Notes
   never reach the PR. Precedent 2026-11-05: notes posted inside a review blocked the merge
   detector.
2. **Merge the tables**: drop duplicates (the same site and failure from two lanes becomes one
   row), order by severity, and **renumber** 1..N. Keep each row as `file:line`, concrete
   failure, fix.
3. **Post in the template format, starting with the heading** (no lead-in line):
   - Nothing to report: `## Review of <sha>: CLEAN`, then `No findings.` on its own line, then
     one paragraph naming the lanes that ran. The paragraph must not use the reserved words the
     template lists (a CLEAN review that says "not clean" is inconclusive).
   - Otherwise: `## Review of <sha>: NOT CLEAN` and **one** table `| # | Severity | Finding |`.
4. Run `node tools/pr-findings.mjs <PR>` (the same script CI runs for the `PR findings`
   status) and confirm it reads the comment (exit 1 with the findings listed, or 0 when
   CLEAN), not 2. The status on the head is what gates the merge; this local run shows why.

**Editing a posted review makes its dispositions stale**: the detector ignores dispositions
written before the edit. After any edit, post (or edit in) fresh dispositions for every finding
of that review.
