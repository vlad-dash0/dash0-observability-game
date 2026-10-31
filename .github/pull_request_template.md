## What and why

<!-- One paragraph. Close the issue: "Closes #N". -->

## How it was tested

<!-- Tests added or changed, run with NODE_OPTIONS=--max-old-space-size=2048; mutations run. -->

## Not verifiable here

<!-- Browser checks or anything CI can't cover. "None" if none. -->

<!--
REVIEW COMMENTS: post findings and dispositions as PR comments in these formats.
`node tools/pr-findings.mjs <PR>` reads them (all pages) and exits 0 PASS, 1 open
findings, 2 inconclusive. Merge needs `All checks` green and the detector at 0.

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
   (Severity) are allowed. These cells leave the finding open (formatting such as
   bold, code, strikethrough or a trailing period ignored): no letter or digit (empty,
   `&nbsp;`, `-`, `—`, `?`), `TBD`, `TODO`, `open`, `N/A`, `pending`, `none`, or one of
   those words followed by `:`/`—` and more text.
   If the review is edited, dispositions last written (posted or edited) before that
   edit no longer count: post or edit in a fresh one for every finding.

3. Combined, when the fixes land before the comment is posted:

   ## Review of <sha>: CLEAN; notes taken in <sha>

   | # | Severity | Finding | Disposition |
   |---|---|---|---|
   | 1 | nit | ... | Reworded |

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
become those letters, and any space becomes a plain space. A word outside code that
mixes Latin with Cyrillic or Greek letters is inconclusive. Outside a review section, a
heading that says NOT CLEAN or names "review of <sha>", starts with "Re-review" ("Re
review", "Re-reviews"; a block that is only "Re-review requested" is fine), "Independent review" or
"Disposition", starts with "Review" and names findings, dispositions or a sha, starts
with "Review(s)"/"Reviewer(s)" and reports problems (found, problem, issue, bug,
findings), or names findings and a sha, is inconclusive. So is any other text there
(paragraph, list item, quote, table cell, summary, bare text after raw HTML), tested
whole and line by line, with the same starts except that "Review(s)" needs a problem
word; a table cell that is only a form name ("Disposition", "Independent review") is a
label and is fine. "findings" in a name (pr-findings.mjs) does not count. Write the review as a level-2
heading, or say "Reviews: <sha> CLEAN" in an audit. So is a table outside a review
section with a `#` column or a Finding/Issue/Problem column. In a dispositions section,
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
