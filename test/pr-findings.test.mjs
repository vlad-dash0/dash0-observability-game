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

// --- the gh layer -----------------------------------------------------------------

// A fake `gh`: pages are returned whole only under --paginate --slurp, as gh does;
// without --slurp gh concatenates pages (not valid JSON); without --paginate, page one.
function fakeGh({ comments: c = [[]], reviews = [[]], threads = [[]], fail } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (fail && args.some((a) => fail.test(a))) throw new Error('gh: HTTP 502');
    const joined = args.join(' ');
    let pages;
    if (/repo view/.test(joined)) return 'acme/game\n';
    if (args.includes('graphql')) {
      pages = threads.map((nodes, i) => ({
        data: { repository: { pullRequest: { reviewThreads: {
          pageInfo: { hasNextPage: i < threads.length - 1, endCursor: `cur${i}` }, nodes,
        } } } },
      }));
    } else if (/issues\/\d+\/comments/.test(joined)) pages = c;
    else if (/pulls\/\d+\/reviews/.test(joined)) pages = reviews;
    else throw new Error(`unexpected gh call: ${joined}`);
    if (!args.includes('--paginate')) return JSON.stringify(pages[0]);
    if (!args.includes('--slurp')) return pages.map((p) => JSON.stringify(p)).join('');
    return JSON.stringify(pages);
  };
  return { gh, calls };
}

const issueComment = (i, name) => ({ created_at: at(i), html_url: `c${i}`, body: fx(name) });
const sink = () => { const lines = []; return { lines, log: (s) => lines.push(s) }; };

test('fetchPr reads every page of comments, reviews and threads', async () => {
  const { gh } = fakeGh({
    comments: [[issueComment(0, 'review')], [issueComment(2, 'dispositions-partial')]],
    reviews: [[{ submitted_at: at(1), html_url: 'r1', body: '' }], [{ submitted_at: at(3), html_url: 'r2', body: fx('combined') }]],
    threads: [[{ isResolved: true, path: 'a', line: 1, comments: { nodes: [{ body: 'x', url: 't0' }] } }],
      [{ isResolved: false, path: 'b', line: 2, comments: { nodes: [{ body: 'y', url: 't1' }] } }]],
  });
  const pr = await fetchPr({ repo: 'acme/game', pr: 7, gh });
  assert.deepEqual(pr.comments.map((c) => c.url), ['c0', 'c2', 'r2']); // empty review body dropped
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
  for (const fail of [/issues\/\d+\/comments/, /pulls\/\d+\/reviews/, /^graphql$/]) {
    const { gh } = fakeGh({ comments: [[issueComment(0, 'clean')]], fail });
    const out = sink();
    assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2, String(fail));
    assert.match(out.lines.join('\n'), /INCONCLUSIVE.*502/s);
  }
});

test('run exits 2 when gh returns a non-page shape (e.g. a GraphQL error body)', async () => {
  const gh = async (args) => (args.includes('graphql') ? JSON.stringify([{ errors: [{ message: 'nope' }] }]) : '[[]]');
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: () => {} }), 2);
});

test('run exits 2 for a PR with no review comment', async () => {
  const { gh } = fakeGh({ comments: [[issueComment(0, 'audit')]] });
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh, log: out.log }), 2);
  assert.match(out.lines.join('\n'), /no review/i);
});

test('run resolves the repo through gh when none is given, and passes it on', async () => {
  const { gh, calls } = fakeGh({ comments: [[issueComment(0, 'clean')]] });
  assert.equal(await run({ pr: 7, gh, log: () => {} }), 0);
  assert.ok(calls.some((a) => a.includes('repos/acme/game/issues/7/comments?per_page=100')));
});

test('run names the bad response when gh does not return a list of pages', async () => {
  const out = sink();
  assert.equal(await run({ repo: 'acme/game', pr: 7, gh: async () => '{"message":"Not Found"}', log: out.log }), 2);
  assert.match(out.lines.join('\n'), /INCONCLUSIVE: .*expected an array of pages/);
});
