// tools/pr-findings.mjs (#35): every review finding on a PR needs a disposition before
// merge. The parser and the decision are pure; the gh layer is injected here as a fake
// that pages like `gh api --paginate --slurp`. Exit codes are asserted as literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, fetchPr, parseComment, run } from '../tools/pr-findings.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pr-findings');
const fx = (name) => readFileSync(join(FIX, `${name}.md`), 'utf8');

// Comments in posting order, one minute apart.
const at = (i) => new Date(Date.UTC(2026, 9, 30, 17, i)).toISOString();
const comments = (...names) => names.map((n, i) => ({ at: at(i), url: `c${i}`, body: fx(n) }));
const decide = (names, threads = []) => evaluate({ comments: comments(...names), threads });
const ids = (open) => open.map((f) => f.id);

test('parses a findings table, including escaped pipes and non-numeric ids', () => {
  const { reviews, dispositions, errors } = parseComment(fx('review'));
  assert.deepEqual(errors, []);
  assert.deepEqual(dispositions, []);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].sha, 'a0f4c88');
  assert.deepEqual(reviews[0].findings.map((f) => [f.id, f.severity]), [['1', 'medium'], ['2', 'medium'], ['N1', 'nit']]);
  assert.equal(reviews[0].findings[1].finding, 'Dialogs are modal but `a || b` leaves the hub reachable');
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
  const r = decide(['review', 'audit', 'dispositions-all', 'combined', 'clean']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.open, []);
  assert.equal(r.reviews, 3);
  assert.equal(r.findings, 6);
  assert.equal(r.exit, 0);
});

test('open: a finding the dispositions table skips is reported', () => {
  const r = decide(['review', 'dispositions-partial']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(ids(r.open), ['2']);
  assert.equal(r.open[0].sha, 'a0f4c88');
  assert.equal(r.exit, 1);
});

test('open: a review with no dispositions at all', () => {
  const r = decide(['review']);
  assert.deepEqual(ids(r.open), ['1', '2', 'N1']);
  assert.equal(r.exit, 1);
});

test('open: an empty disposition cell in a combined table', () => {
  const r = decide(['combined-open']);
  assert.deepEqual(ids(r.open), ['2']);
  assert.equal(r.exit, 1);
});

test('open: an unresolved review thread; a resolved one is a disposition', () => {
  const thread = (isResolved) => ({ isResolved, where: 'lib/a.mjs:3', url: 't1', body: 'off by one' });
  const open = decide(['clean'], [thread(false)]);
  assert.deepEqual(open.open.map((f) => f.where), ['lib/a.mjs:3']);
  assert.equal(open.exit, 1);
  const resolved = decide(['clean'], [thread(true)]);
  assert.deepEqual(resolved.open, []);
  assert.equal(resolved.exit, 0);
});

test('inconclusive: a row with the wrong number of cells', () => {
  const r = decide(['malformed-row']);
  assert.match(r.errors.join('\n'), /cells/);
  assert.equal(r.exit, 2);
});

test('inconclusive: a review heading with no table and no "No findings." line', () => {
  const r = decide(['malformed-no-table']);
  assert.match(r.errors.join('\n'), /5a9c257/);
  assert.equal(r.exit, 2);
});

test('inconclusive: a review-like heading the parser does not recognise', () => {
  const r = decide(['clean', 'malformed-heading']);
  assert.match(r.errors.join('\n'), /HEAD/);
  assert.equal(r.exit, 2);
});

test('inconclusive: dispositions posted before (or without) their review', () => {
  const r = decide(['dispositions-all', 'review']);
  assert.match(r.errors.join('\n'), /a0f4c88/);
  assert.equal(r.exit, 2);
});

test('inconclusive: a disposition for a finding id the review does not have', () => {
  const extra = fx('dispositions-all').replace('| N1 | nit |', '| N9 | nit |');
  const r = evaluate({ comments: [...comments('review'), { at: at(5), url: 'x', body: extra }], threads: [] });
  assert.match(r.errors.join('\n'), /N9/);
  assert.equal(r.exit, 2);
});

test('inconclusive: duplicate finding ids in one review', () => {
  const dup = fx('review').replace('| N1 | nit |', '| 1 | nit |');
  const r = evaluate({ comments: [{ at: at(0), url: 'x', body: dup }], threads: [] });
  assert.match(r.errors.join('\n'), /duplicate/);
  assert.equal(r.exit, 2);
});

test('inconclusive, never PASS: a PR with no review comment', () => {
  const none = evaluate({ comments: [], threads: [] });
  assert.equal(none.exit, 2);
  const auditOnly = decide(['audit']);
  assert.match(auditOnly.errors.join('\n'), /no review/i);
  assert.equal(auditOnly.exit, 2);
});

test('inconclusive wins over open: an unparseable comment means the list may be short', () => {
  const r = decide(['review', 'malformed-row']);
  assert.equal(r.open.length, 3);
  assert.equal(r.exit, 2);
});


// --- review round on f24711a: headings, hidden text, edits, placeholders, escape hatch ---

const T = '| # | Severity | Finding |\n|---|---|---|\n| 1 | low | thing 1 |\n';
const CLEAN = '## Review of 1111111: CLEAN\n\nNo findings.\n';
const REV = `## Review of 2222222: NOT CLEAN\n\n${T}`;
const DISP = (cell = 'Fixed') => `## Dispositions for the review of 2222222\n\n| # | Disposition |\n|---|---|\n| 1 | ${cell} |\n`;
const bodies = (...bs) => bs.map((b, i) => ({ at: at(i), url: `c${i}`, body: b }));
const judge = (...bs) => evaluate({ comments: bodies(...bs), threads: [] });

test('a review heading at a level other than ## is an error, not skipped', () => {
  for (const body of [`# Review of 2222222\n\n${T}`, `### Review of 2222222\n\n${T}`,
    `###### Dispositions for the review of 1111111\n`, `Review of 2222222\n---\n\n${T}`,
    `Review of 2222222\n===\n\n${T}`, `**Review of 2222222**\n\n${T}`, `__Review of 2222222:__\n\n${T}`]) {
    const r = judge(CLEAN, body);
    assert.equal(r.exit, 2, body);
    assert.match(r.errors.join('\n'), /2222222|1111111/, body);
  }
});

test('a level-2 heading that names findings but no recognised form is an error', () => {
  const r = judge(CLEAN, '## Findings on 2222222\n\n1. low: thing\n');
  assert.match(r.errors.join('\n'), /Findings on 2222222.*unrecognised/);
  assert.equal(r.exit, 2);
});

test('a findings table outside a review section is an error', () => {
  for (const body of [`${CLEAN}\n## Extra\n\n${T}`, `Before any heading:\n\n${T}`]) {
    const r = judge(body);
    assert.match(r.errors.join('\n'), /outside a review/, body);
    assert.equal(r.exit, 2, body);
  }
});

// Every table in a review section must still be a findings table (a renamed column must
// not hide a finding); ordinary subheadings and text are fine.
test('ordinary subheadings inside a review are fine', () => {
  const r = judge(`## Review of 2222222: NOT CLEAN\n\n### Notes\n\n**Verdict:** see the table.\n\n${T}`, DISP());
  assert.deepEqual(r.errors, []);
  assert.equal(r.exit, 0);
});

test('a disposition hidden in an HTML comment or a code fence does not count', () => {
  for (const hidden of [`<!--\n${DISP()}-->\n`, `\`\`\`\n${DISP()}\`\`\`\n`, `~~~md\n${DISP()}~~~\n`,
    DISP('<!-- Fixed -->')]) {
    const r = judge(REV, hidden);
    assert.deepEqual(r.errors, [], hidden);
    assert.deepEqual(ids(r.open), ['1'], hidden);
    assert.equal(r.exit, 1, hidden);
  }
});

test('a finding hidden in an unterminated comment or fence is inconclusive', () => {
  for (const tail of ['<!-- note\n', '```\n']) {
    const r = judge(`${tail}${REV}`);
    assert.match(r.errors.join('\n'), /unterminated/, tail);
    assert.equal(r.exit, 2, tail);
  }
});

test('a review edited after its dispositions is inconclusive until they are re-posted', () => {
  const edited = (when) => [{ at: at(0), edited: when, url: 'rev', body: REV }, { at: at(1), url: 'disp', body: DISP() }];
  const after = evaluate({ comments: edited(at(2)), threads: [] });
  assert.match(after.errors.join('\n'), /rev.*2222222.*edited/);
  assert.equal(after.exit, 2);
  const before = evaluate({ comments: edited(at(1)), threads: [] });
  assert.deepEqual(before.errors, []);
  assert.equal(before.exit, 0);
  const reposted = evaluate({ comments: [...edited(at(2)), { at: at(3), url: 'again', body: DISP('Still fixed') }], threads: [] });
  assert.deepEqual(reposted.errors, []);
  assert.equal(reposted.exit, 0);
});

test('placeholder dispositions leave the finding open', () => {
  for (const cell of ['-', '—', 'TBD', ' todo ', 'Open']) {
    const sep = judge(REV, DISP(cell));
    assert.deepEqual(ids(sep.open), ['1'], `dispositions table: ${cell}`);
    assert.equal(sep.exit, 1);
    const combined = judge(`## Review of 2222222: NOT CLEAN\n\n| # | Finding | Disposition |\n|---|---|---|\n| 1 | x | ${cell} |\n`);
    assert.deepEqual(ids(combined.open), ['1'], `combined table: ${cell}`);
    assert.equal(combined.exit, 1);
  }
  assert.equal(judge(REV, DISP('Open question answered in #12')).exit, 0, 'only the bare word is a placeholder');
});

test('third-party headings that merely mention review are ignored', () => {
  for (const h of ["## Reviewer's Guide", '## Preview deployment', '## Reviewed-by bots', '### Summary']) {
    const r = judge(CLEAN, `${h}\n\nbot text\n`);
    assert.deepEqual(r.errors, [], h);
    assert.equal(r.exit, 0, h);
  }
});

test('an unminimized old-style review heading is an error', () => {
  const r = judge(CLEAN, '## Re-review round 2\n\nAll fixed.\n');
  assert.match(r.errors.join('\n'), /Re-review round 2.*unrecognised/);
  assert.equal(r.exit, 2);
});

test('a minimized (hidden) comment is skipped: the override for a bad heading', () => {
  const comments = [...bodies(CLEAN), { at: at(1), url: 'hidden', minimized: true, body: `## Re-review round 2\n\n${T}` }];
  const r = evaluate({ comments, threads: [] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.exit, 0);
});

test('a comment with no usable timestamp is inconclusive', () => {
  const r = evaluate({ comments: [{ at: null, url: 'r', body: REV }, { at: at(1), url: 'd', body: DISP() }], threads: [] });
  assert.match(r.errors.join('\n'), /timestamp/);
  assert.equal(r.exit, 2);
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

const issueComment = (i, name, extra = {}) => ({ createdAt: at(i), lastEditedAt: null, isMinimized: false, url: `c${i}`, body: fx(name), ...extra });
const sink = () => { const lines = []; return { lines, log: (s) => lines.push(s) }; };

test('fetchPr reads every page of comments, reviews and threads, with edit and hidden flags', async () => {
  const { gh } = fakeGh({
    comments: [[issueComment(0, 'review', { lastEditedAt: at(9) })], [issueComment(2, 'dispositions-partial', { isMinimized: true })]],
    reviews: [[{ submittedAt: at(1), createdAt: at(1), lastEditedAt: null, isMinimized: false, url: 'r1', body: '' }],
      [{ submittedAt: null, createdAt: at(3), lastEditedAt: at(4), isMinimized: false, url: 'r2', body: fx('combined') }]],
    threads: [[{ isResolved: true, path: 'a', line: 1, comments: { nodes: [{ body: 'x', url: 't0' }] } }],
      [{ isResolved: false, path: 'b', line: 2, comments: { nodes: [{ body: 'y', url: 't1' }] } }]],
  });
  const pr = await fetchPr({ repo: 'acme/game', pr: 7, gh });
  assert.deepEqual(pr.comments.map((c) => [c.url, c.at, c.edited, c.minimized]), [
    ['c0', at(0), at(9), false], ['c2', at(2), null, true], ['r2', at(3), at(4), false], // empty review body dropped
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

test('run skips a minimized comment fetched from GitHub', async () => {
  const { gh } = fakeGh({ comments: [[issueComment(0, 'clean'), issueComment(1, 'malformed-row', { isMinimized: true })]] });
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: () => {} }), 0);
});

test('run resolves the repo through gh when none is given, and passes it on', async () => {
  const { gh, calls } = fakeGh({ comments: [[issueComment(0, 'clean')]] });
  assert.equal(await run({ pr: 7, gh, log: () => {} }), 0);
  const q = calls.find((a) => a.includes('graphql'));
  assert.ok(q.includes('owner=acme') && q.includes('name=game') && q.includes('number=7'), q.join(' '));
});
