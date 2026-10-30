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

   - "Independent review of <sha>" and "Re-review of <sha>" are accepted too; text after
     the sha is free.
   - `#` is any id, unique within the review (1, M1, N-a). Escape a literal pipe as `\|`.
   - A review with nothing to report says so on its own line: `No findings.`

2. Dispositions, posted after the review they answer:

   ## Dispositions for the review of <sha>
   (or "## Dispositions for the re-review of <sha>")

   | # | Disposition |
   |---|---|
   | 1 | Fixed in <sha>: ... |
   | N1 | Won't fix: ... |

   Every `#` must exist in the latest earlier review of that sha. An empty Disposition
   cell, or one holding only `-`, `—`, `TBD`, `TODO` or `open` (any case), leaves the
   finding open. Other columns (Severity) are allowed. If the review is edited after
   its dispositions, post the dispositions again.

3. Combined, when the fixes land before the comment is posted:

   ## Review of <sha>: CLEAN; notes taken in <sha>

   | # | Severity | Finding | Disposition |
   |---|---|---|---|
   | 1 | nit | ... | Reworded |

Inline review threads count as findings; resolve a thread when it is addressed.

What the detector reads: only what GitHub renders, so text in an HTML comment or a code fence
does not count (an unterminated one is inconclusive). Review and dispositions headings
must be level 2 ("## "). Any heading (#..######, setext, or a bold-only line) that starts
with "Review", "Re-review", "Reviews" or "Disposition(s)", or contains "finding(s)", and
is not one of the forms above at level 2 makes it inconclusive; so does a `#` + Finding
table outside a review section. Other summary comments use other words ("## Pre-merge
audit"); "## Reviewer's Guide" or "## Preview" are fine.
Override: hide (minimize) a comment the detector must not read, e.g. a bot's or an
old-format review; minimized comments are skipped.
-->
