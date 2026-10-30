// PR findings detector (#35): has every review finding on a PR been dispositioned?
// Reads the PR's issue comments, review bodies and review threads through `gh api`
// (every page), parses the comment formats documented in .github/pull_request_template.md
// and prints each finding that has no disposition.
// Usage: node tools/pr-findings.mjs <pr-number> [--repo owner/name]
// Exit: 0 PASS, 1 open findings, 2 inconclusive (API error, no review, unparseable).
// Zero dependencies; the gh call is injected so the parser and the decision are pure.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT = { PASS: 0, OPEN: 1, INCONCLUSIVE: 2 };

const SHA = '([0-9a-f]{7,40})';
const REVIEW = new RegExp(String.raw`^(?:independent\s+)?(?:re-?)?review\s+of\s+${SHA}\b`, 'i');
const DISPOSITIONS = new RegExp(String.raw`^dispositions\s+for\s+the\s+(?:re-?)?review\s+of\s+${SHA}\b`, 'i');
// A level-2 heading mentioning either word is reserved for the formats above; one that
// matches neither is an error, not silently skipped (it may hold the open finding).
const RESERVED = /\breview|\bdisposition/i;
const NO_FINDINGS = /^no findings\.?$/i;
const SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;

// GFM table cells: split on unescaped pipes, then unescape `\|`.
function cells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

// Level-2 sections: [{ heading, lines }]. A level-1 or level-2 heading ends a section.
function sections(body) {
  const out = [];
  let cur = null;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (h && !line.startsWith('###')) {
      cur = { heading: h[1], lines: [] };
      out.push(cur);
    } else if (/^#\s/.test(line)) {
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return out;
}

// Every table in a section, as { header, rows } with lower-cased header names.
function tables(lines, where, errors) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const block = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
    if (block.length < 2 || !SEPARATOR.test(block[1].trim())) {
      errors.push(`${where}: a table without a header separator row`);
      continue;
    }
    const header = cells(block[0]).map((c) => c.toLowerCase());
    const rows = [];
    for (const line of block.slice(2)) {
      const row = cells(line);
      if (row.length !== header.length) {
        errors.push(`${where}: row has ${row.length} cells, header has ${header.length}: ${line.trim()}`);
        continue;
      }
      rows.push(Object.fromEntries(header.map((h, j) => [h, row[j]])));
    }
    out.push({ header, rows });
  }
  return out;
}

function needColumns(table, cols, where, errors) {
  const missing = cols.filter((c) => !table.header.includes(c));
  if (missing.length) errors.push(`${where}: table lacks column(s) ${missing.map((c) => `"${c}"`).join(', ')}`);
  return missing.length === 0;
}

/** Parse one comment body into the reviews and dispositions it declares. */
export function parseComment(body) {
  const reviews = [];
  const dispositions = [];
  const errors = [];
  for (const { heading, lines } of sections(body ?? '')) {
    const where = `"## ${heading}"`;
    const d = DISPOSITIONS.exec(heading);
    const r = !d && REVIEW.exec(heading);
    if (!d && !r) {
      if (RESERVED.test(heading)) errors.push(`${where}: unrecognised review heading (expected "Review of <sha>" or "Dispositions for the review of <sha>")`);
      continue;
    }
    const found = tables(lines, where, errors);
    if (d) {
      const entries = [];
      if (!found.length) errors.push(`${where}: no dispositions table`);
      for (const t of found) {
        if (!needColumns(t, ['#', 'disposition'], where, errors)) continue;
        for (const row of t.rows) entries.push({ id: row['#'], disposition: row.disposition || null });
      }
      dispositions.push({ sha: d[1].toLowerCase(), heading, entries });
      continue;
    }
    const findings = [];
    if (!found.length && !lines.some((l) => NO_FINDINGS.test(l.trim()))) {
      errors.push(`${where}: no findings table and no "No findings." line`);
    }
    for (const t of found) {
      if (!needColumns(t, ['#', 'finding'], where, errors)) continue;
      const combined = t.header.includes('disposition');
      for (const row of t.rows) {
        findings.push({
          id: row['#'],
          severity: row.severity ?? '',
          finding: row.finding,
          disposition: combined && row.disposition ? row.disposition : null,
        });
      }
    }
    reviews.push({ sha: r[1].toLowerCase(), heading, findings });
  }
  return { reviews, dispositions, errors };
}

const sameSha = (a, b) => a.startsWith(b) || b.startsWith(a);

/**
 * Decide from comments ({ at, url, body }) and review threads ({ isResolved, where, url,
 * body }). Returns { exit, open, errors, reviews, findings }. Any error, or no review at
 * all, is inconclusive: the open list may then be incomplete, so it never reads as PASS.
 */
export function evaluate({ comments, threads }) {
  const errors = [];
  const reviews = [];
  const ordered = comments
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.i - b.i);
  for (const c of ordered) {
    const parsed = parseComment(c.body);
    errors.push(...parsed.errors.map((e) => `${c.url}: ${e}`));
    for (const review of parsed.reviews) {
      const seen = new Set();
      for (const f of review.findings) {
        if (!f.id) errors.push(`${c.url}: review of ${review.sha} has a finding with an empty "#"`);
        else if (seen.has(f.id)) errors.push(`${c.url}: review of ${review.sha} has duplicate finding #${f.id}`);
        seen.add(f.id);
      }
      reviews.push({ ...review, url: c.url });
    }
    for (const disp of parsed.dispositions) {
      // The latest review of that commit posted before these dispositions.
      const review = reviews.findLast((r) => sameSha(r.sha, disp.sha));
      if (!review) {
        errors.push(`${c.url}: dispositions for ${disp.sha} but no earlier review of ${disp.sha}`);
        continue;
      }
      for (const e of disp.entries) {
        const f = review.findings.find((x) => x.id === e.id);
        if (!f) errors.push(`${c.url}: disposition #${e.id} matches no finding in the review of ${review.sha}`);
        else if (e.disposition) f.disposition = e.disposition;
      }
    }
  }
  const open = [];
  for (const r of reviews) {
    for (const f of r.findings) if (!f.disposition) open.push({ ...f, sha: r.sha, url: r.url });
  }
  for (const t of threads) {
    if (!t.isResolved) open.push({ id: 'thread', severity: '', finding: t.body, where: t.where, url: t.url });
  }
  if (!reviews.length) errors.push('no review found: no "## Review of <sha>" comment on this PR');
  const findings = reviews.reduce((n, r) => n + r.findings.length, 0) + threads.length;
  const exit = errors.length ? EXIT.INCONCLUSIVE : open.length ? EXIT.OPEN : EXIT.PASS;
  return { exit, open, errors, reviews: reviews.length, findings };
}

// --- gh layer -------------------------------------------------------------------------

function defaultGh(args) {
  return new Promise((done, fail) => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? fail(new Error(`gh ${args.find((a) => a === 'graphql' || a.startsWith('repos/')) ?? args[0]}: ${stderr.trim() || err.message}`)) : done(stdout));
  });
}

// `--paginate --slurp` returns an array with one entry per page.
async function pages(gh, args) {
  const out = JSON.parse(await gh(['api', '--paginate', '--slurp', ...args]));
  if (!Array.isArray(out)) throw new Error(`gh api ${args[0]}: expected an array of pages`);
  return out;
}

const THREADS = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes { isResolved path line comments(first: 1) { nodes { body url } } }
    } } } }`;

/** Every issue comment, non-empty review body and review thread on the PR. */
export async function fetchPr({ repo, pr, gh = defaultGh }) {
  const [owner, name] = repo.split('/');
  const rest = (path) => pages(gh, [`repos/${repo}/${path}?per_page=100`]).then((ps) => {
    if (!ps.every(Array.isArray)) throw new Error(`gh api ${path}: a page is not an array`);
    return ps.flat();
  });
  const [issueComments, reviews, threadPages] = await Promise.all([
    rest(`issues/${pr}/comments`),
    rest(`pulls/${pr}/reviews`),
    pages(gh, ['graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${pr}`, '-f', `query=${THREADS}`]),
  ]);
  const comments = [
    ...issueComments.map((c) => ({ at: c.created_at, url: c.html_url, body: c.body ?? '' })),
    ...reviews.filter((r) => r.body?.trim()).map((r) => ({ at: r.submitted_at, url: r.html_url, body: r.body })),
  ];
  const threads = threadPages.flatMap((p) => {
    const conn = p?.data?.repository?.pullRequest?.reviewThreads;
    if (!conn || !Array.isArray(conn.nodes)) {
      throw new Error(`gh api graphql: no reviewThreads in the response${p?.errors ? `: ${JSON.stringify(p.errors)}` : ''}`);
    }
    return conn.nodes.map((t) => ({
      isResolved: t.isResolved === true,
      where: `${t.path}:${t.line ?? '?'}`,
      url: t.comments?.nodes?.[0]?.url ?? '',
      body: t.comments?.nodes?.[0]?.body ?? '',
    }));
  });
  return { comments, threads };
}

const oneLine = (s, n = 120) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Fetch, decide and print. Returns the exit code; never throws. */
export async function run({ repo, pr, gh = defaultGh, log = console.log }) {
  let result;
  try {
    if (!/^\d+$/.test(String(pr))) throw new Error(`not a PR number: ${pr}`);
    const slug = repo ?? (await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error(`not an owner/name repo: ${slug}`);
    log(`PR ${slug}#${pr}`);
    result = evaluate(await fetchPr({ repo: slug, pr, gh }));
  } catch (err) {
    log(`INCONCLUSIVE: ${err.message}`);
    return EXIT.INCONCLUSIVE;
  }
  for (const f of result.open) {
    const at = f.sha ? `${f.sha} #${f.id}` : `thread ${f.where}`;
    log(`OPEN ${at}${f.severity ? ` [${f.severity}]` : ''}: ${oneLine(f.finding)} ${f.url}`);
  }
  for (const e of result.errors) log(`ERROR ${e}`);
  const summary = `${result.findings} finding(s) in ${result.reviews} review(s)`;
  if (result.exit === EXIT.INCONCLUSIVE) log(`INCONCLUSIVE: ${result.errors.length} problem(s); ${result.open.length} open of ${summary}`);
  else if (result.exit === EXIT.OPEN) log(`OPEN: ${result.open.length} of ${summary} have no disposition`);
  else log(`PASS: ${summary}, all dispositioned`);
  return result.exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const r = args.findIndex((a) => a === '--repo' || a === '-R');
  const repo = r >= 0 ? args.splice(r, 2)[1] : undefined;
  if (args.length !== 1 || (r >= 0 && !repo)) {
    console.error('usage: node tools/pr-findings.mjs <pr-number> [--repo owner/name]');
    process.exitCode = EXIT.INCONCLUSIVE;
  } else {
    process.exitCode = await run({ repo, pr: args[0] });
  }
}
