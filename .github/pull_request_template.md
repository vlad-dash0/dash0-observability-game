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

   - "Independent review of <sha>" and "Re-review of <sha>" are accepted too; the sha may
     be in backticks; text after it is free.
   - `#` is any id, unique within the review (1, M1, N-a). Escape a literal pipe as `\|`.
   - Findings go in tables only; a list item in a review section is inconclusive. Other
     tables (a file list, a summary) are fine if they have no `#`/Finding/Issue column.
   - `### Notes`-style subheadings and bold lines are fine inside a review.
   - A review with nothing to report says `No findings.` on its own line, with no table
     or list, under a heading that does not say NOT CLEAN.

2. Dispositions, posted after the review they answer:

   ## Dispositions for the review of <sha>
   (or "## Dispositions for the re-review of <sha>")

   | # | Disposition |
   |---|---|
   | 1 | Fixed in <sha>: ... |
   | N1 | Won't fix: ... |

   Every `#` must exist in the latest earlier review of that sha. Other columns
   (Severity) are allowed. These cells leave the finding open (formatting such as
   `**`, backticks or a trailing period ignored): empty, `&nbsp;`, `-`, `—`, `?`, `TBD`,
   `TODO`, `open`, `N/A`, or one of the last four followed by `:`/`—` and more text.
   If the review is edited, dispositions posted before the edit no longer count: post a
   fresh one for every finding.

3. Combined, when the fixes land before the comment is posted:

   ## Review of <sha>: CLEAN; notes taken in <sha>

   | # | Severity | Finding | Disposition |
   |---|---|---|---|
   | 1 | nit | ... | Reworded |

Inline review threads count as findings; resolve a thread when it is addressed.

What the detector reads is what GitHub renders. Tables are GFM tables, found by their
delimiter row, with or without outer pipes (`# | Finding` / `--- | ---` works); a second
table needs a blank line before it. Blockquoted text is read. Text in an HTML comment, a
fenced code block or a 4-space/tab indented code block does not count; an unterminated
comment or fence is inconclusive. Review and dispositions headings must be level 2
("## "); the same form at another level, setext or as a bold line is inconclusive.
Outside a review section, a heading that starts with "Re-review", "Independent review"
or "Disposition", starts with "Review" and names findings, dispositions or a sha, or
names findings and a sha, is inconclusive, and so is a table with a `#` column and a
Finding/Findings/Issue column. "## Review notes", "## Reviewer's Guide", "## Findings
from QA" and "## Pre-merge audit at <sha>" are fine.
Override: hide (minimize) a comment the detector must not read, e.g. a bot's or an
old-format review. Minimized comments are skipped and each is printed as SKIPPED with
its author, so the bypass shows in the output.
-->
