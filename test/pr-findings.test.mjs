// tools/pr-findings.mjs (#35): every review finding on a PR needs a disposition before
// merge. The parser reads what GitHub renders (bodyHTML): each fixture is a markdown
// comment (.md) rendered once by GitHub (tools/render-fixtures.mjs) to the .html beside
// it, which is what these tests read. The parser and the decision are pure; the gh layer
// is injected as a fake that pages like `gh api --paginate --slurp`. Exit codes are
// asserted as literals. No DOM node ever reaches an assertion: the parser returns strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, fetchPr, parseComment, run } from '../tools/pr-findings.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pr-findings');
const fx = (name) => readFileSync(join(FIX, `${name}.html`), 'utf8');

// Comments in posting order, one minute apart.
const at = (i) => new Date(Date.UTC(2026, 9, 30, 17, i)).toISOString();
const comments = (...names) => names.map((n, i) => ({ at: at(i), url: `c${i}`, html: fx(n) }));
const decide = (...names) => evaluate({ comments: comments(...names), threads: [] });
const ids = (open) => open.map((f) => f.id);
const errs = (r) => r.errors.join('\n');

test('every markdown fixture has its rendered HTML beside it, and no HTML is orphaned', () => {
  const files = readdirSync(FIX);
  const md = files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  const html = files.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort();
  assert.ok(md.length > 0);
  assert.deepEqual(html, md);
});

test('parses a findings table, including escaped pipes and non-numeric ids', () => {
  const { reviews, dispositions, errors } = parseComment(fx('review'));
  assert.deepEqual(errors, []);
  assert.deepEqual(dispositions, []);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].sha, 'a0f4c88');
  assert.deepEqual(reviews[0].findings.map((f) => [f.id, f.severity]), [['1', 'medium'], ['2', 'medium'], ['N1', 'nit']]);
  assert.equal(reviews[0].findings[1].finding, 'Dialogs are modal but a || b leaves the hub reachable');
  assert.deepEqual(reviews[0].findings.map((f) => f.disposition), [null, null, null]);
});

test('parses a dispositions table', () => {
  const { reviews, dispositions, errors } = parseComment(fx('dispositions-all'));
  assert.deepEqual(errors, []);
  assert.deepEqual(reviews, []);
  assert.equal(dispositions[0].sha, 'a0f4c88');
  assert.deepEqual(dispositions[0].entries.map((e) => e.id), ['1', '2', 'N1']);
});

test('a combined table carries its own dispositions', () => {
  const { reviews, errors } = parseComment(fx('combined'));
  assert.deepEqual(errors, []);
  assert.deepEqual(reviews[0].findings.map((f) => [f.id, f.disposition]),
    [['1', 'Reworded'], ['H', 'Added'], ['—', 'Filed as #39']]);
});

test('PASS: every finding has a disposition', () => {
  const r = decide('review', 'audit', 'dispositions-all', 'combined', 'clean');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.open, []);
  assert.equal(r.reviews, 3);
  assert.equal(r.findings, 6);
  assert.equal(r.exit, 0);
});

test('open: a finding the dispositions table skips is reported', () => {
  const r = decide('review', 'dispositions-partial');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(ids(r.open), ['2']);
  assert.equal(r.open[0].sha, 'a0f4c88');
  assert.equal(r.exit, 1);
});

test('open: a review with no dispositions at all', () => {
  const r = decide('review');
  assert.deepEqual(ids(r.open), ['1', '2', 'N1']);
  assert.equal(r.exit, 1);
});

test('open: an empty disposition cell in a combined table', () => {
  const r = decide('combined-open');
  assert.deepEqual(ids(r.open), ['2']);
  assert.equal(r.exit, 1);
});

test('open: an unresolved review thread; a resolved one is a disposition', () => {
  const thread = (isResolved) => ({ isResolved, where: 'lib/a.mjs:3', url: 't1', body: 'off by one' });
  const open = evaluate({ comments: comments('clean'), threads: [thread(false)] });
  assert.deepEqual(open.open.map((f) => f.where), ['lib/a.mjs:3']);
  assert.equal(open.exit, 1);
  const resolved = evaluate({ comments: comments('clean'), threads: [thread(true)] });
  assert.deepEqual(resolved.open, []);
  assert.equal(resolved.exit, 0);
});

// Structurally impossible now: GitHub pads or trims every GFM row to the header, so a
// stray cell is not rendered and not read. A raw HTML table is not normalised: an error.
test('row width: GitHub normalises GFM rows; a ragged raw HTML table is inconclusive', () => {
  const gfm = decide('malformed-row');
  assert.deepEqual(gfm.errors, []);
  assert.deepEqual(gfm.open.map((f) => [f.id, f.finding]), [['1', 'a finding']]);
  assert.equal(gfm.exit, 1);
  const raw = decide('malformed-row-html');
  assert.match(errs(raw), /row has 4 cells, header has 3/);
  assert.equal(raw.exit, 2);
});

test('inconclusive: a review heading with no table and no "No findings." line', () => {
  const r = decide('malformed-no-table');
  assert.match(errs(r), /5a9c257.*no findings table/);
  assert.equal(r.exit, 2);
});

test('inconclusive: a review-like heading the parser does not recognise', () => {
  const r = decide('clean', 'malformed-heading');
  assert.match(errs(r), /HEAD.*unrecognised/);
  assert.equal(r.exit, 2);
});

test('inconclusive: dispositions posted before (or without) their review', () => {
  const r = decide('dispositions-all', 'review');
  assert.match(errs(r), /no earlier review of a0f4c88/);
  assert.equal(r.exit, 2);
});

test('inconclusive: a disposition for a finding id the review does not have', () => {
  const r = decide('review', 'dispositions-unknown-id');
  assert.match(errs(r), /#N9 matches no finding/);
  assert.equal(r.exit, 2);
});

test('inconclusive: duplicate finding ids in one review', () => {
  const r = decide('review-duplicate-id');
  assert.match(errs(r), /duplicate finding #1/);
  assert.equal(r.exit, 2);
});

test('inconclusive, never PASS: a PR with no review comment', () => {
  const none = evaluate({ comments: [], threads: [] });
  assert.equal(none.exit, 2);
  const auditOnly = decide('audit');
  assert.match(errs(auditOnly), /no review/i);
  assert.equal(auditOnly.exit, 2);
});

test('inconclusive wins over open: an unparseable comment means the list may be short', () => {
  const r = decide('review', 'malformed-no-table');
  assert.equal(r.open.length, 3);
  assert.equal(r.exit, 2);
});

test('inconclusive: a comment with no rendered body (bodyHTML missing)', () => {
  assert.deepEqual(parseComment(undefined).errors, ['no rendered body (bodyHTML)']);
  const r = evaluate({ comments: [...comments('clean'), { at: at(5), url: 'x', html: null }], threads: [] });
  assert.match(errs(r), /x: no rendered body/);
  assert.equal(r.exit, 2);
});

test('a comment with no usable timestamp is inconclusive', () => {
  const r = evaluate({ comments: [{ at: null, url: 'r', html: fx('base-review') }, { at: at(1), url: 'd', html: fx('base-dispositions') }], threads: [] });
  assert.match(errs(r), /timestamp/);
  assert.equal(r.exit, 2);
});

// --- review round on f24711a (#1-#5) ------------------------------------------------------

test('#1: a review form at a level other than <h2>, or as a bold line, is an error', () => {
  const r = decide('clean', 'heading-levels');
  for (const sha of ['2222221', '2222222', '2222223', '2222224', '2222225', '2222226']) {
    assert.match(errs(r), new RegExp(`${sha}" is a (level-\\d heading|bold line); review and dispositions headings must be level 2`), sha);
  }
  assert.equal(r.exit, 2);
});

// Rewritten (was: "setext review form" must block). A setext `---` heading renders as
// the same <h2> as `## `, so it is now read as the review it looks like on GitHub.
test('#1: a setext level-2 review heading is an <h2> like "## " and is read', () => {
  assert.deepEqual(ids(decide('setext-review').open), ['1']);
  assert.equal(decide('setext-review', 'base-dispositions').exit, 0);
});

test('#1: a level-2 heading that names findings and a sha but no recognised form is an error', () => {
  const r = decide('clean', 'findings-on-sha');
  assert.match(errs(r), /Findings on 2222222.*unrecognised/);
  assert.equal(r.exit, 2);
});

test('#1: a findings table outside a review section is an error', () => {
  const r = decide('clean', 'table-outside');
  assert.match(errs(r), /"\(top of comment\)": a findings table outside a review/);
  assert.match(errs(r), /"## Extra": a findings table outside a review/);
  assert.equal(r.exit, 2);
});

test('#2: a disposition in an HTML comment or a code fence is not rendered, so does not count', () => {
  const parsed = parseComment(fx('hidden-dispositions'));
  assert.deepEqual([parsed.reviews.length, parsed.dispositions.length, parsed.errors.length], [0, 0, 0]);
  const r = decide('base-review', 'hidden-dispositions');
  assert.deepEqual(ids(r.open), ['1']);
  assert.equal(r.exit, 1);
});

// Structurally impossible now: GitHub renders an unterminated comment or fence to the end
// of the comment, so what follows is not a heading or table on GitHub either.
test('#2: a review after an unterminated comment or fence is not rendered as one', () => {
  for (const name of ['unterminated-comment', 'unterminated-fence']) {
    const parsed = parseComment(fx(name));
    assert.deepEqual([parsed.reviews.length, parsed.errors.length], [0, 0], name);
    assert.equal(decide(name).exit, 2, `${name}: alone it is "no review", never PASS`);
  }
});

// R3: dispositions answer the review as it read when they were last written; after an
// edit, each finding needs a fresh one (a partial repost leaves the rest open).
test('#3/R3: dispositions written before the review\'s last edit do not count', () => {
  const judge = (edited, ...later) => evaluate({ comments: [
    { at: at(0), edited, url: 'rev', html: fx('r3-review-two') }, { at: at(1), url: 'disp', html: fx('r3-dispositions-two') },
    ...later.map((name, i) => ({ at: at(3 + i), url: `later${i}`, html: fx(name) }))], threads: [] });
  const stale = judge(at(2));
  assert.deepEqual(stale.errors, []);
  assert.deepEqual(ids(stale.open), ['1', '2']);
  assert.ok(stale.open.every((f) => f.stale === at(2)), 'open findings say why');
  assert.equal(stale.exit, 1);
  const partial = judge(at(2), 'r3-dispositions-repost');
  assert.deepEqual(ids(partial.open), ['1']);
  assert.equal(partial.exit, 1);
  assert.equal(judge(at(2), 'r3-dispositions-two').exit, 0);
  assert.equal(judge(at(1)).exit, 0, 'an edit before the dispositions is fine');
});

test('F3: an edited dispositions comment counts from its last edit', () => {
  const judge = (dispEdited) => evaluate({ comments: [
    { at: at(0), edited: at(2), url: 'rev', html: fx('r3-review-two') },
    { at: at(1), edited: dispEdited, url: 'disp', html: fx('r3-dispositions-two') }], threads: [] });
  assert.equal(judge(at(3)).exit, 0, 'edited after the review edit: fresh');
  const before = judge(at(1));
  assert.deepEqual(ids(before.open), ['1', '2'], 'edited before the review edit: stale');
  assert.equal(before.exit, 1);
  assert.match(errs(evaluate({ comments: [{ at: at(0), edited: 'soon', url: 'x', html: fx('clean') }], threads: [] })), /unusable edit timestamp/);
});

const PLACEHOLDERS = Array.from({ length: 22 }, (_, i) => `P${i + 1}`);

// R2/F3: P1-P22 are placeholders (`-`, `**TODO**`, `&nbsp;`, `Pending`, `None`,
// `~~TODO~~`, an escaped-backtick comment, empty, ...); OK1-OK3 are real dispositions.
test('#4/R2/F3: placeholder dispositions leave the finding open, in both table forms', () => {
  const separate = decide('placeholders-review', 'placeholders-disp');
  assert.deepEqual(separate.errors, []);
  assert.deepEqual(ids(separate.open), PLACEHOLDERS);
  assert.equal(separate.exit, 1);
  const combined = decide('placeholders-combined');
  assert.deepEqual(combined.errors, []);
  assert.deepEqual(ids(combined.open), PLACEHOLDERS);
  assert.equal(combined.exit, 1);
});

test('#5: an unminimized old-style review heading is an error', () => {
  const r = decide('clean', 'old-style');
  assert.match(errs(r), /Re-review round 2.*unrecognised/);
  assert.equal(r.exit, 2);
});

test('#5/R7: a minimized (hidden) comment is skipped: the override for a bad heading', () => {
  const hidden = { at: at(1), url: 'hidden', author: 'bot', minimized: true, html: fx('old-style') };
  const r = evaluate({ comments: [...comments('clean'), hidden], threads: [] });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.skipped, [{ url: 'hidden', author: 'bot' }]);
  assert.equal(r.exit, 0);
});

// --- re-review of 456142a (R1-R10) ---------------------------------------------------------

test('R1: GFM rows and tables without outer pipes are read, in and out of a review', () => {
  const noLead = decide('r1-no-lead', 'base-dispositions');
  assert.deepEqual(ids(noLead.open), ['2']);
  assert.equal(noLead.exit, 1);
  const leadless = decide('r1-leadless-table', 'base-dispositions');
  assert.deepEqual(ids(leadless.open), ['3']);
  assert.equal(leadless.exit, 1);
  const outside = decide('base-review', 'base-dispositions', 'r1-outside');
  assert.match(errs(outside), /"## Notes": a findings table outside a review/);
  assert.equal(outside.exit, 2);
  const headless = decide('r1-headless-row', 'base-dispositions');
  assert.match(errs(headless), /row outside a table/);
  assert.equal(headless.exit, 2);
});

// A second header glued to a table renders as more rows of the same table, so the
// repeated ids are duplicates: never PASS.
test('R1: a second header glued to a table is read as rows and blocks as duplicates', () => {
  const r = decide('r1-glued', 'base-dispositions');
  assert.match(errs(r), /duplicate finding #1/);
  assert.equal(r.exit, 2);
});

test('R4: blockquoted reviews and tables are read; a quoted bot alert is not a review', () => {
  const quoted = decide('clean', 'r4-quoted');
  assert.deepEqual(ids(quoted.open), ['1']);
  assert.equal(quoted.exit, 1);
  const nested = decide('r4-nested', 'base-dispositions');
  assert.deepEqual(ids(nested.open), ['2']);
  assert.equal(nested.exit, 1);
  assert.equal(decide('clean', 'r4-alert').exit, 0);
});

test('R5: an indented code block hides what it holds; a table in a list item is read', () => {
  const code = decide('base-review', 'r5-indented');
  assert.match(errs(code), /no dispositions table/);
  assert.equal(code.exit, 2);
  const tab = decide('base-review', 'r5-tab');
  assert.deepEqual(ids(tab.open), ['1']);
  assert.equal(tab.exit, 1);
  const inList = decide('base-review', 'r5-in-list');
  assert.deepEqual(inList.open, []);
  assert.equal(inList.exit, 0);
});

test('R6: each #-and-finding/findings/issue table outside a review section is an error', () => {
  const r = decide('clean', 'r6-tables-outside');
  for (const col of ['finding', 'findings', 'issue', 'issues']) {
    assert.match(errs(r), new RegExp(`outside a review section \\(# \\| severity \\| ${col}\\)`), col);
  }
  assert.equal(r.exit, 2);
});

test('R9: "No findings." must stand alone in a review that is not NOT CLEAN; no list items', () => {
  const r = decide('r9-no-findings');
  for (const sha of ['3333331', '3333332', '3333333', '3333334', '3333335']) {
    assert.match(errs(r), new RegExp(`Review of ${sha}`), sha);
  }
  assert.equal(r.exit, 2);
  assert.equal(decide('clean').exit, 0);
});

test('R10: honest review layouts are not blocked', () => {
  const ok = {
    'subheadings, a bold line and "### Verdict: NOT CLEAN" in a review': ['r10-honest-review', 'base-dispositions'],
    'sha in backticks': ['r10-backtick-sha'],
    'dispositions sha in backticks': ['base-review', 'r10-backtick-disp'],
    'human and bot headings, "Re-review requested", <!-- in inline code': ['clean', 'r10-human'],
  };
  for (const [name, names] of Object.entries(ok)) {
    const r = decide(...names);
    assert.deepEqual(r.errors, [], name);
    assert.equal(r.exit, 0, name);
  }
});

test('R10: the strict counterparts still block', () => {
  for (const name of ['r10-issue-column', 'r10-h3-form', 'findings-on-sha']) {
    assert.equal(decide('clean', name).exit, 2, name);
  }
});

// --- re-review of 75dec1d (F1-F3) ----------------------------------------------------------

test('F1: text GitHub renders after inline code or a contained fence is read', () => {
  for (const name of ['f1-inline-backticks', 'f1-quote-fence', 'f1-list-fence']) {
    const r = decide('clean', name);
    assert.deepEqual(r.errors, [], name);
    assert.deepEqual(ids(r.open), ['1'], name);
    assert.equal(r.exit, 1, name);
  }
});

// Structurally impossible now: a heading or table inside fenced, indented or inline code
// is <pre>/<code> text, never an <h2> or <table>.
test('F1: a review heading and table inside code are never read as a review', () => {
  const { reviews, errors } = parseComment(fx('f1-heading-in-code'));
  assert.deepEqual(errors, []);
  assert.deepEqual(reviews.map((r) => [r.sha, r.findings.length]), [['1111111', 0]]);
  assert.equal(decide('f1-heading-in-code').exit, 0);
});

// GitHub keeps a raw HTML <h2> and <table> inside <pre> (and lifts an <h2> out of
// <code>) and shows them: they are a review on GitHub, so they are read as one.
test('F1: a raw HTML heading and table inside <pre> or <code> are read', () => {
  const { reviews, errors } = parseComment(fx('f1-raw-html-pre'));
  assert.deepEqual(reviews.map((r) => [r.sha, r.findings.map((f) => f.id).join()]), [['2222222', '1'], ['2222223', '']]);
  assert.match(errors.join('\n'), /2222223.*no findings table/);
});

test('F2: a NOT CLEAN heading outside a recognised review section is inconclusive', () => {
  const h2 = decide('clean', 'f2-not-clean');
  assert.match(errs(h2), /Review of the latest push: NOT CLEAN.*unrecognised/);
  assert.equal(h2.exit, 2);
  const h3 = decide('clean', 'f2-not-clean-h3');
  assert.match(errs(h3), /Status: NOT CLEAN" is a level-3 heading/);
  assert.equal(h3.exit, 2);
});

// --- re-review of 147192b (G1-G4): fail closed by allowlist ------------------------------
// A review section holds only a standalone "No findings.", findings tables (a "#" column)
// with rows, and prose with no "|" outside code; anything else is an error. Outside a
// section, any text block naming a review form is an error.

test('G1: a findings table with a header and no rows is inconclusive, not PASS', () => {
  const r = decide('g1-empty-table');
  assert.match(errs(r), /Review of abc1234: NOT CLEAN.*findings table with no finding rows/);
  assert.equal(r.exit, 2);
});

test('G2: a finding row GitHub rendered as a paragraph is inconclusive, not PASS', () => {
  const r = decide('g2-row-after-blank', 'g2-dispositions');
  assert.match(errs(r), /abc1234.*table row outside a table.*2 \| high \| real bug/);
  assert.equal(r.exit, 2);
});

test('G2: a "|" row in a subheading, a summary or a raw element in a review is inconclusive', () => {
  const r = decide('g2-pipes');
  assert.match(errs(r), /4444441.*table row outside a table.*in a subheading/);
  assert.match(errs(r), /4444442.*table row outside a table.*in a summary/);
  assert.match(errs(r), /4444443.*table row outside a table.*in a raw div/);
  assert.equal(r.exit, 2);
});

test('G2: a table without a "#" column in a review section is inconclusive (allowlist)', () => {
  const r = decide('allowlist-other-table', 'base-dispositions');
  assert.match(errs(r), /2222222.*table without a "#" column.*item \| problem/);
  assert.equal(r.exit, 2);
});

test('G2: a CLEAN review keeps its note paragraph after "No findings." (a pipe in code is fine)', () => {
  const r = decide('clean-note');
  assert.deepEqual(r.errors, []);
  assert.equal(r.exit, 0);
});

test('G3: a review written as a paragraph outside a section is inconclusive, not PASS', () => {
  const table = decide('clean', 'g3-paragraph-table');
  assert.match(errs(table), /"Re-review of abc1234 found problems \(NOT CLEAN\):" is a paragraph that reads as a review/);
  assert.equal(table.exit, 2);
  const list = decide('clean', 'g3-paragraph-list');
  assert.match(errs(list), /"Review of abc1234: NOT CLEAN" is a paragraph that reads as a review/);
  assert.equal(list.exit, 2);
});

test('G3: every text block outside a section is checked: quote, cell, summary, heading, raw element, list item', () => {
  const r = decide('clean', 'g3-blocks');
  for (const [what, sha] of [['a paragraph', '5555551'], ['a table cell', 'NOT CLEAN in a cell'], ['a summary', '5555553'],
    ['a level-4 heading', 'NOT CLEAN in a level-4'], ['text in <div>', '5555555'], ['a list item', '5555556']]) {
    assert.match(errs(r), new RegExp(`${sha}[^"]*" is ${what} that reads as a review`), what);
  }
  assert.equal(r.exit, 2);
});

test('G4: each dispositions comment is returned and printed with its author', async () => {
  const r = evaluate({ comments: [{ at: at(0), url: 'rev', html: fx('base-review') },
    { at: at(1), url: 'disp', author: 'mallory', html: fx('base-dispositions') }], threads: [] });
  assert.deepEqual(r.dispositions, [{ sha: '2222222', author: 'mallory', url: 'disp' }]);
  assert.equal(r.exit, 0);
  const { gh } = fakeGh({ comments: [[issueComment(0, 'base-review'), issueComment(1, 'base-dispositions', { author: { login: 'mallory' } })]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 0);
  assert.match(out.lines.join('\n'), /DISPOSITIONS for 2222222 by mallory: c1/);
});

// --- re-review of da420b8 (H1-H3): every text node read, normalised, reserved starts ----

test('H1: text directly under the comment root is read: a review there is inconclusive, not PASS', () => {
  const r = decide('clean', 'h1-root-outside');
  assert.match(errs(r), /"Re-review of abc1234: NOT CLEAN[^"]*" is text at the top level that reads as a review/);
  assert.equal(r.exit, 2);
});

test('H1: a finding row left as top-level text inside a review is inconclusive, not PASS', () => {
  const r = decide('h1-root-review');
  assert.match(errs(r), /abc1234.*table row outside a table.*2 \| high \| rootrow/);
  assert.equal(r.exit, 2);
});

test('H1: each run of text between blocks in a mixed element is its own block', () => {
  const r = decide('clean', 'h1-mixed');
  assert.match(errs(r), /"Re-review found problems:" is text in <div> that reads as a review/);
  assert.equal(r.exit, 2);
});

test('H2: a zero-width space inside NOT CLEAN in a paragraph is still NOT CLEAN', () => {
  const r = decide('clean', 'h2-zero-width-paragraph');
  assert.match(errs(r), /"Verdict: NOT CLEAN" is a paragraph that reads as a review/);
  assert.equal(r.exit, 2);
});

test('H2: a zero-width space inside NOT CLEAN in a review heading is still NOT CLEAN', () => {
  const r = decide('h2-zero-width-heading');
  assert.match(errs(r), /"## Review of abc1234: NOT CLEAN".*"No findings\." must stand alone/);
  assert.equal(r.exit, 2);
});

test('H2: soft hyphen, word joiner, bidi mark and no-break space are normalised away', () => {
  const r = decide('clean', 'h2-format-chars');
  assert.match(errs(r), /"Status: NOT CLEAN" is a paragraph that reads as a review/);
  assert.equal(r.exit, 2);
});

test('H3: "Re-review found problems:" as a paragraph is inconclusive, and so is its Problem table', () => {
  const r = decide('clean', 'h3-re-review-table');
  assert.match(errs(r), /"Re-review found problems:" is a paragraph that reads as a review/);
  assert.match(errs(r), /a findings table outside a review section \(item \| problem\)/);
  assert.equal(r.exit, 2);
});

test('H3: "Re-review of the latest push" with a list is inconclusive', () => {
  const r = decide('clean', 'h3-re-review-list');
  assert.match(errs(r), /"Re-review of the latest push" is a paragraph that reads as a review/);
  assert.equal(r.exit, 2);
});

test('H3: "Reviewers found problems in <sha>:" with a numbered list is inconclusive', () => {
  const r = decide('clean', 'h3-reviewers-list');
  assert.match(errs(r), /"Reviewers found problems in abc1234:" is a paragraph that reads as a review/);
  assert.equal(r.exit, 2);
});

test('H3: a table outside a section with a "#" column, or with an Issue column, is inconclusive', () => {
  const r = decide('clean', 'h3-tables');
  assert.match(errs(r), /a findings table outside a review section \(# \| note\)/);
  assert.match(errs(r), /a findings table outside a review section \(item \| issue\)/);
  assert.equal(r.exit, 2);
});

test('H3: a "Disposition" header cell and "Reviews: ..." audit lines stay PASS', () => {
  const r = decide('clean', 'h3-must-pass');
  assert.deepEqual(r.errors, []);
  assert.equal(r.exit, 0);
});

// --- the gh layer -----------------------------------------------------------------

// A fake `gh`: pages are returned whole only under --paginate --slurp, as gh does;
// without --slurp gh concatenates pages (not valid JSON); without --paginate, page one.
// Comments, reviews and threads are three GraphQL connections, told apart by the query.
function fakeGh({ comments: c = [[]], reviews = [[]], threads = [[]], fail } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const joined = args.join(' ');
    if (fail && fail.test(joined)) throw new Error('gh: HTTP 502');
    if (/repo view/.test(joined)) return 'acme/game\n';
    if (!args.includes('graphql')) throw new Error(`unexpected gh call: ${joined}`);
    const key = /reviewThreads\(/.test(joined) ? 'reviewThreads' : /reviews\(/.test(joined) ? 'reviews' : 'comments';
    const src = { reviewThreads: threads, reviews, comments: c }[key];
    const pages = src.map((nodes, i) => ({
      data: { repository: { pullRequest: { [key]: {
        pageInfo: { hasNextPage: i < src.length - 1, endCursor: `cur${i}` }, nodes,
      } } } },
    }));
    if (!args.includes('--paginate')) return JSON.stringify(pages[0]);
    if (!args.includes('--slurp')) return pages.map((p) => JSON.stringify(p)).join('');
    return JSON.stringify(pages);
  };
  return { gh, calls };
}

const issueComment = (i, name, extra = {}) => ({ createdAt: at(i), lastEditedAt: null, isMinimized: false, url: `c${i}`, bodyHTML: fx(name), ...extra });
const sink = () => { const lines = []; return { lines, log: (s) => lines.push(s) }; };

test('fetchPr reads every page of comments, reviews and threads, with edit and hidden flags', async () => {
  const { gh } = fakeGh({
    comments: [[issueComment(0, 'review', { lastEditedAt: at(9), author: { login: 'ann' } })], [issueComment(2, 'dispositions-partial', { isMinimized: true })]],
    reviews: [[{ submittedAt: at(1), createdAt: at(1), lastEditedAt: null, isMinimized: false, url: 'r1', bodyHTML: '' }],
      [{ submittedAt: null, createdAt: at(3), lastEditedAt: at(4), isMinimized: false, url: 'r2', bodyHTML: fx('combined') }]],
    threads: [[{ isResolved: true, path: 'a', line: 1, comments: { nodes: [{ body: 'x', url: 't0' }] } }],
      [{ isResolved: false, path: 'b', line: 2, comments: { nodes: [{ body: 'y', url: 't1' }] } }]],
  });
  const pr = await fetchPr({ repo: 'acme/game', pr: 7, gh });
  assert.deepEqual(pr.comments.map((c) => [c.url, c.at, c.edited, c.minimized, c.author]), [
    ['c0', at(0), at(9), false, 'ann'], ['c2', at(2), null, true, '(unknown)'], ['r2', at(3), at(4), false, '(unknown)'], // empty review body dropped
  ]);
  assert.deepEqual(pr.threads.map((t) => [t.where, t.isResolved]), [['a:1', true], ['b:2', false]]);
});

test('paginated: the dispositions on page two close the findings on page one', async () => {
  const { gh } = fakeGh({ comments: [[issueComment(0, 'review')], [issueComment(1, 'dispositions-all')]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 0);
  assert.match(out.lines.join('\n'), /PASS/);
});

test('run exits 1 and prints each open finding', async () => {
  const { gh } = fakeGh({ comments: [[issueComment(0, 'review'), issueComment(1, 'dispositions-partial')]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 1);
  const text = out.lines.join('\n');
  assert.match(text, /a0f4c88 #2 .*Dialogs are modal/);
  assert.doesNotMatch(text, /#N1 /);
});

test('run exits 2 on an API error, whichever call fails', async () => {
  for (const fail of [/ comments\(first: 100/, / reviews\(first: 100/, /reviewThreads\(first: 100/]) {
    const { gh } = fakeGh({ comments: [[issueComment(0, 'clean')]], fail });
    const out = sink();
    assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2, String(fail));
    assert.match(out.lines.join('\n'), /INCONCLUSIVE.*502/s);
  }
});

test('run exits 2 when gh returns a GraphQL error body instead of a connection', async () => {
  const gh = async () => JSON.stringify([{ errors: [{ message: 'nope' }] }]);
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2);
  assert.match(out.lines.join('\n'), /INCONCLUSIVE: .*nope/);
});

test('run names the bad response when gh does not return a list of pages', async () => {
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh: async () => '{"message":"Not Found"}', log: out.log }), 2);
  assert.match(out.lines.join('\n'), /INCONCLUSIVE: .*expected an array of pages/);
});

test('run exits 2 for a PR with no review comment', async () => {
  const { gh } = fakeGh({ comments: [[issueComment(0, 'audit')]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2);
  assert.match(out.lines.join('\n'), /no review/i);
});

test('R7: run skips a minimized comment but logs who posted it and where', async () => {
  const hidden = issueComment(1, 'old-style', { isMinimized: true, author: { login: 'some-bot' } });
  const { gh } = fakeGh({ comments: [[issueComment(0, 'clean'), hidden]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 0);
  assert.match(out.lines.join('\n'), /SKIPPED minimized comment by some-bot: c1/);
});

test('R8: a page carrying errors is inconclusive even when it also has data', async () => {
  const { gh: base } = fakeGh({ comments: [[issueComment(0, 'clean')]] });
  const gh = async (args) => {
    const out = await base(args);
    if (!args.join(' ').includes('reviews(first: 100')) return out;
    return JSON.stringify(JSON.parse(out).map((p) => ({ ...p, errors: [{ message: 'partial: rate limited' }] })));
  };
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2);
  assert.match(out.lines.join('\n'), /INCONCLUSIVE: .*rate limited/);
});

test('run resolves the repo through gh when none is given, and passes it on', async () => {
  const { gh, calls } = fakeGh({ comments: [[issueComment(0, 'clean')]] });
  assert.equal(await run({ pr: 7, gh, log: () => {} }), 0);
  const q = calls.find((a) => a.includes('graphql'));
  assert.ok(q.includes('owner=acme') && q.includes('name=game') && q.includes('number=7'), q.join(' '));
});

test('run exits 2 when a comment comes back without bodyHTML', async () => {
  const { gh } = fakeGh({ comments: [[issueComment(0, 'clean'), issueComment(1, 'clean', { bodyHTML: null })]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2);
  assert.match(out.lines.join('\n'), /c1: no rendered body/);
});

test('fetchPr asks GitHub for the rendered body, not the markdown', async () => {
  const { gh, calls } = fakeGh({ comments: [[issueComment(0, 'clean')]] });
  await fetchPr({ repo: 'acme/game', pr: 7, gh });
  const queries = calls.map((a) => a.find((x) => x.startsWith('query=')));
  assert.equal(queries.filter((q) => /\bbodyHTML\b/.test(q)).length, 2, 'comments and reviews');
});
