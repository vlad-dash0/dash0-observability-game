## What and why

<!-- One paragraph. Close the issue: "Closes #N". -->

## How it was tested

<!-- Tests added or changed, run with NODE_OPTIONS=--max-old-space-size=2048; mutations run.
     No full-suite test count: CI shows it, and a pasted count goes stale on the next push. -->

## Not verifiable here

<!-- Browser checks or anything CI can't cover. "None" if none. -->

<!--
REVIEW COMMENTS: post findings and dispositions as PR comments in these formats.
`node tools/pr-findings.mjs <PR>` reads them (all pages) and exits 0 PASS, 1 open
findings, 2 inconclusive. Merge needs `All checks` green and the `PR findings` status
green: CI runs this same script on every push, comment, review and resolved thread and
posts its verdict on the head commit (pending while the PR is a draft). Hiding a comment
fires no event: re-run it then (Actions, PR findings, Run workflow, the PR number).

1. Findings, one comment per review round. The heading names the reviewed commit:

   ## Review of <sha>: NOT CLEAN

   | # | Severity | Finding |
   |---|---|---|
   | 1 | medium | ... |
   | N1 | nit | ... |

   - The comment starts with the heading: no lead-in line before it.
   - "Independent review of <sha>" and "Re-review of <sha>" are accepted too; the sha may
     be in backticks; text after it is free.
   - `#` is any id, unique within the review (1, M1, N-a). Escape a literal pipe as `\|`.
   - A review section holds only: findings tables (a `#` column, at least one row),
     `No findings.`, and prose (subheadings, bold lines, notes). Anything else is
     inconclusive: a list item, any other table, an empty findings table, or a `|` in
     text outside code (a row GitHub did not render as a table, e.g. after a blank
     line). Put a literal pipe in prose in backticks.
   - `### Notes`-style subheadings and bold lines are fine inside a review.
   - A review with nothing to report says `No findings.` on its own line, with no table
     or list, under a heading that does not say NOT CLEAN; a note paragraph on what was
     checked may follow. A CLEAN review whose text says NOT CLEAN is inconclusive.

2. Dispositions, posted after the review they answer:

   ## Dispositions for the review of <sha>
   (or "## Dispositions for the re-review of <sha>")

   | # | Disposition |
   |---|---|
   | 1 | Fixed in <sha>: ... |
   | N1 | Won't fix: ... |

   Start the comment with its heading: no lead-in line before it ("Thanks, fixed in
   <sha>." goes under the table, or in the table). Text before the heading is outside
   any section, and a line there naming a review or dispositions is inconclusive.
   Every `#` must exist in the latest earlier review of that sha. Other columns
   (Severity, Note) are allowed. A disposition counts only in a positive form
   (allowlist; bold, code, a trailing period and the case ignored, struck-through text
   dropped): it starts with `Fixed` (`Fixed in <sha>`, `Fixed: ...`), `Won't fix`
   (`Wont fix`), `By design`, `False positive`, `Not a bug`, `Deferred to #N`,
   `Documented`, `Duplicate of`, `Out of scope` or `Accepted`; or it names a commit
   (7-40 hex digits, at least one a digit) or an issue or PR (`#12`). Anything else
   leaves the finding open: `TODO later`, `pending review`, `none yet`, `Reworded`,
   `Deferred to later`, `~~Fixed~~`, empty or `-`.
   If the review is edited, dispositions last written (posted or edited) before that
   edit no longer count: post or edit in a fresh one for every finding.

3. Combined, when the fixes land before the comment is posted:

   ## Review of <sha>: CLEAN; notes taken in <sha>

   | # | Severity | Finding | Disposition |
   |---|---|---|---|
   | 1 | nit | ... | Fixed: reworded |

4. Pre-merge audit, read-only (it carries no findings):

   ## Pre-merge audit at <sha>

   | Gate | Result |
   |---|---|
   | CI on head | pass |

   Its only table is `Gate | Result`; its text is read like text outside a section.

Tables: a table counts only inside one of these four sections. Any other table in a
comment (under another heading, at the top, after a paragraph, inside a table cell) is
inconclusive, whatever its columns are called, because it may hold a finding the
detector cannot read. Put notes as prose, or in an audit's `Gate | Result` table. A
finding written only as prose outside a review section is not read (it has no id to
disposition): post it as a review.
The PR body is not read: only comments, review bodies and review threads. A finding or
disposition in the body does not count, and the body may hold checklists and tables.

Inline review threads count as findings; resolve a thread when it is addressed.

What the detector reads is what GitHub renders: each comment's HTML (`bodyHTML`, so run
`npm ci` first). Sections start at level-1/2 headings (`##` or a `---` underline both
render as one; a heading inside a blockquote counts); tables are rendered tables. Text in
an HTML comment or code (fenced, indented or inline) is never a heading or table, so it
does not count; a raw HTML `<h2>` or `<table>` that GitHub displays does. Review and
dispositions headings must be level 2; the same form at another level or as a bold line
is inconclusive. All text is read after one normalisation: NFKC (fullwidth letters
become ASCII), format characters (zero-width space, soft hyphen, word joiner, bidi marks)
are removed, every dash becomes `-`, Cyrillic and Greek lookalikes of Latin letters
become those letters, and any space becomes a plain space. Disguises are caught by
skeleton, not by a list of spellings: text outside code is reduced to what it spells
(NFKD, marks stripped, lookalikes and stroke letters such as Ø, Ł, Đ, Ħ folded, lowercase,
only a-z and 0-9 kept; a Latin, Greek, Cyrillic or Armenian letter that folds to nothing
is a one-letter wildcard). Where that skeleton spells a reserved word or phrase (review,
clean, disposition, finding anywhere in a word; found, problem(s), issue(s), bug(s) as a
whole word; NOT CLEAN, Re-review, Independent review starting a word; "review of" before
a sha), the comment is inconclusive, wherever it is, when: for one of the phrases, the
text there has any non-ASCII letter or mark; for a single word, it has a cross-script
lookalike (a Cyrillic, Greek or other non-Latin letter, a Latin small capital, or a
letter that folds to nothing), not just a Latin accent or stroke; or it is
letter-spaced (`N O T`). Plain-ASCII text is read by the forms below, unchanged: so
`10µs`, `Δt`, `kΩ`, Zürich, André reviewed, Problème, problém, Préviewed, Cyrillic or
Greek words, e-mail and Re-reviewing are fine, and `NØT CLEAN`, `N̈OT CLEAN`,
`NOT CLÉAN`, `Rеview` (Cyrillic е) are not. NOT CLEAN in plain ASCII is the two words in
any case with whitespace between (so "not clean" in prose outside a review section is
inconclusive, as before), or the capitals glued or joined by `_`/`-` (`NOT_CLEAN`).
Outside a review section, a heading that says NOT CLEAN or names "review of <sha>", starts with "Re-review" ("Re
review", "Re-reviews"; a block that is only "Re-review requested" is fine), "Independent review" or
"Disposition", starts with "Review" and names findings, dispositions or a sha, starts
with "Review(s)"/"Reviewer(s)" and reports problems (found, problem, issue, bug,
findings), or names findings and a sha, is inconclusive. So is any other text there
(paragraph, list item, quote, table cell, summary, bare text after raw HTML), tested
whole and line by line, with the same starts except that "Review(s)" needs a problem
word; a table cell that is only a form name ("Disposition", "Independent review") is a
label and is fine. "findings" in a name (pr-findings.mjs) does not count. Write the review as a level-2
heading, or say "Reviews: <sha> CLEAN" in an audit. In a dispositions section,
a paragraph starting with `|` (a row GitHub did not render as a table) is inconclusive.
"## Review notes", "## Reviewer's Guide", "## Findings from QA"
and "## Pre-merge audit at <sha>" are fine.
Override: hide (minimize) a comment the detector must not read, e.g. a bot's or an
old-format review. Minimized comments are skipped and each is printed as SKIPPED with
its author, so the bypass shows in the output. Minimizing removes the whole comment
from the audit: its findings and its dispositions no longer count. To fix a malformed
review or dispositions comment (e.g. one with a lead-in line), edit it or post a
corrected one; minimize only what must not count at all.
Trust: the detector does not check who posts dispositions; anyone who can comment can
clear findings. That holds only because this repo is private and only collaborators can
comment. Each dispositions comment is printed as DISPOSITIONS for <sha> by <login> so
who cleared what is visible; revisit (enforce an author list) if the repo opens up.
-->
