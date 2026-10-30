// PR findings detector (#35): has every review finding on a PR been dispositioned?
// Reads the PR's issue comments, review bodies and review threads through `gh api graphql`
// (every page), parses the comment formats documented in .github/pull_request_template.md
// and prints each finding that has no disposition. Minimized (hidden) comments are skipped.
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
// Headings reserved for the formats above: any that starts with a review or disposition
// word, or names findings, must be one of them (at level 2) or it is an error, because it
// may hold the open finding. "Reviewer's Guide" or "Preview" are not reserved.
const RESERVED = /^(?:independent\s+)?(?:re-?)?reviews?\b|^dispositions?\b|\bfindings?\b/i;
const NO_FINDINGS = /^no findings\.?$/i;
// A disposition cell holding only one of these is no disposition: the finding stays open.
const PLACEHOLDER = /^(?:-|—|tbd|todo|open)$/i;
const SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const BOLD = /^ {0,3}(\*\*|__)(.+?)\1[ \t]*:?[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])(?:\s|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// What GitHub renders: drop HTML comments and fenced code blocks (a disposition hidden in
// either must not count). An unterminated one is an error, since it may hide a finding.
function visibleLines(body, errors) {
  const lines = [];
  let fence = null;
  let comment = false;
  for (const raw of body.split(/\r?\n/)) {
    if (fence) {
      const close = new RegExp(String.raw`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\s*$`);
      if (close.test(raw)) fence = null;
      continue;
    }
    if (comment) {
      if (raw.includes('-->')) comment = false;
      continue;
    }
    const f = FENCE.exec(raw);
    if (f) { fence = f[1]; continue; }
    if (/^ {0,3}<!--/.test(raw)) {
      if (!raw.slice(raw.indexOf('<!--') + 4).includes('-->')) comment = true;
      continue;
    }
    const line = raw.replace(/<!--[\s\S]*?-->/g, '');
    if (line.includes('<!--')) errors.push(`unterminated HTML comment in: ${raw.trim()}`);
    lines.push(line);
  }
  if (fence) errors.push(`unterminated code fence (${fence})`);
  if (comment) errors.push('unterminated HTML comment');
  return lines;
}

const unwrap = (s) => s.trim().replace(/^(\*\*|__|\*|_)(.*)\1$/, '$2').trim();

// Tokens: { head } for ATX, setext and bold-only lines; { line } for everything else.
// A setext heading takes back the paragraph lines above its underline.
function tokens(lines) {
  const out = [];
  let para = 0; // lines in the current paragraph
  for (const line of lines) {
    const atx = ATX.exec(line);
    if (atx) {
      out.push({ head: { kind: 'atx', level: atx[1].length, text: unwrap(atx[2] ?? '') } });
      para = 0;
      continue;
    }
    const setext = SETEXT.exec(line);
    if (setext && para > 0) {
      const text = out.splice(out.length - para, para).map((t) => t.line.trim()).join(' ');
      out.push({ head: { kind: 'setext', level: setext[1][0] === '=' ? 1 : 2, text: unwrap(text) } });
      para = 0;
      continue;
    }
    const bold = BOLD.exec(line);
    if (bold) out.push({ head: { kind: 'bold', level: 0, text: bold[2].trim().replace(/:$/, '') } });
    out.push({ line });
    para = !line.trim() || bold || setext || /^\s*\|/.test(line) || LIST_ITEM.test(line) ? 0 : para + 1;
  }
  return out;
}

const describe = (h) => (h.kind === 'atx' ? `a level-${h.level} heading` : h.kind === 'setext' ? 'a setext heading' : 'a bold line');

// Sections split at level-1/2 headings (ATX or setext); each is { kind, sha, heading, lines }
// with kind 'review', 'dispositions' or null. Every heading of any form is classified.
function sections(body, errors) {
  const out = [{ kind: null, heading: '(top of comment)', lines: [] }];
  for (const t of tokens(visibleLines(body, errors))) {
    if (!t.head) { out.at(-1).lines.push(t.line); continue; }
    const h = t.head;
    const d = DISPOSITIONS.exec(h.text);
    const r = !d && REVIEW.exec(h.text);
    const reserved = d || r || RESERVED.test(h.text);
    const canonical = h.kind === 'atx' && h.level === 2;
    if (reserved && !canonical) {
      errors.push(`"${h.text}" is ${describe(h)}; review and dispositions headings must be level 2 ("## ")`);
    } else if (reserved && !d && !r) {
      errors.push(`"## ${h.text}": unrecognised review heading (expected "Review of <sha>" or "Dispositions for the review of <sha>")`);
    }
    if (h.kind === 'bold' || (h.kind === 'atx' && h.level > 2)) continue; // not a boundary
    const kind = canonical && d ? 'dispositions' : canonical && r ? 'review' : null;
    out.push({ kind, sha: kind && (d || r)[1].toLowerCase(), heading: `## ${h.text}`, lines: [] });
  }
  return out;
}

// GFM table cells: split on unescaped pipes, then unescape `\|`.
function cells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
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

// Outside review sections only the header matters (third-party tables may be anything).
function isFindingsHeader(lines, i) {
  if (!lines[i].trim().startsWith('|') || !SEPARATOR.test(lines[i + 1]?.trim() ?? '')) return false;
  const header = cells(lines[i]).map((c) => c.toLowerCase());
  return header.includes('#') && header.includes('finding');
}

function needColumns(table, cols, where, errors) {
  const missing = cols.filter((c) => !table.header.includes(c));
  if (missing.length) errors.push(`${where}: table lacks column(s) ${missing.map((c) => `"${c}"`).join(', ')}`);
  return missing.length === 0;
}

const disposition = (cell) => (cell && !PLACEHOLDER.test(cell.trim()) ? cell.trim() : null);

/** Parse one comment body into the reviews and dispositions it declares. */
export function parseComment(body) {
  const reviews = [];
  const dispositions = [];
  const errors = [];
  for (const { kind, sha, heading, lines } of sections(body ?? '', errors)) {
    const where = `"${heading}"`;
    if (!kind) {
      if (lines.some((_, i) => isFindingsHeader(lines, i))) {
        errors.push(`${where}: a findings table outside a review section`);
      }
      continue;
    }
    const found = tables(lines, where, errors);
    if (kind === 'dispositions') {
      const entries = [];
      if (!found.length) errors.push(`${where}: no dispositions table`);
      for (const t of found) {
        if (!needColumns(t, ['#', 'disposition'], where, errors)) continue;
        for (const row of t.rows) entries.push({ id: row['#'], disposition: disposition(row.disposition) });
      }
      dispositions.push({ sha, heading, entries });
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
          disposition: combined ? disposition(row.disposition) : null,
        });
      }
    }
    reviews.push({ sha, heading, findings });
  }
  return { reviews, dispositions, errors };
}

const sameSha = (a, b) => a.startsWith(b) || b.startsWith(a);
const time = (s) => (typeof s === 'string' ? Date.parse(s) : NaN);

/**
 * Decide from comments ({ at, edited?, minimized?, url, body }) and review threads
 * ({ isResolved, where, url, body }). Returns { exit, open, errors, reviews, findings }.
 * Any error, or no review at all, is inconclusive: the open list may then be incomplete,
 * so it never reads as PASS. Minimized comments are skipped (the override for a comment
 * the parser must not read).
 */
export function evaluate({ comments, threads }) {
  const errors = [];
  const reviews = [];
  const visible = [];
  for (const c of comments) {
    if (c.minimized) continue;
    if (!Number.isFinite(time(c.at))) errors.push(`${c.url}: no usable timestamp (${c.at})`);
    else if (c.edited != null && !Number.isFinite(time(c.edited))) errors.push(`${c.url}: unusable edit timestamp (${c.edited})`);
    else visible.push({ ...c, i: visible.length });
  }
  visible.sort((a, b) => time(a.at) - time(b.at) || a.i - b.i);
  for (const c of visible) {
    const parsed = parseComment(c.body);
    errors.push(...parsed.errors.map((e) => `${c.url}: ${e}`));
    for (const review of parsed.reviews) {
      const seen = new Set();
      for (const f of review.findings) {
        if (!f.id) errors.push(`${c.url}: review of ${review.sha} has a finding with an empty "#"`);
        else if (seen.has(f.id)) errors.push(`${c.url}: review of ${review.sha} has duplicate finding #${f.id}`);
        seen.add(f.id);
      }
      reviews.push({ ...review, url: c.url, edited: c.edited ?? null, closedAt: null });
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
        else if (e.disposition) { f.disposition = e.disposition; review.closedAt = c.at; }
      }
    }
  }
  for (const r of reviews) {
    // Dispositions answer the review as it read when they were posted; a later edit may
    // have added or changed findings, so they must be posted again.
    if (r.edited && r.closedAt && time(r.edited) > time(r.closedAt)) {
      errors.push(`${r.url}: review of ${r.sha} was edited (${r.edited}) after its dispositions (${r.closedAt}); post them again`);
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
      err ? fail(new Error(stderr.trim() || err.message)) : done(stdout));
  });
}

const NODES = {
  comments: 'createdAt lastEditedAt isMinimized url body',
  reviews: 'submittedAt createdAt lastEditedAt isMinimized url body',
  reviewThreads: 'isResolved path line comments(first: 1) { nodes { body url } }',
};
const query = (key) => `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    ${key}(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { ${NODES[key]} } }
  } } }`;

// Every node of one PR connection; `--paginate --slurp` returns one entry per page.
async function connection(gh, repo, pr, key) {
  const [owner, name] = repo.split('/');
  const args = ['graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${pr}`, '-f', `query=${query(key)}`];
  let pages;
  try {
    pages = JSON.parse(await gh(['api', '--paginate', '--slurp', ...args]));
  } catch (err) {
    throw new Error(`gh api graphql ${key}: ${err.message}`);
  }
  if (!Array.isArray(pages)) throw new Error(`gh api graphql ${key}: expected an array of pages`);
  return pages.flatMap((p) => {
    const conn = p?.data?.repository?.pullRequest?.[key];
    if (!conn || !Array.isArray(conn.nodes)) {
      throw new Error(`gh api graphql: no ${key} in the response${p?.errors ? `: ${JSON.stringify(p.errors)}` : ''}`);
    }
    return conn.nodes;
  });
}

/** Every issue comment, non-empty review body and review thread on the PR. */
export async function fetchPr({ repo, pr, gh = defaultGh }) {
  const [issueComments, reviews, threads] = await Promise.all(
    ['comments', 'reviews', 'reviewThreads'].map((key) => connection(gh, repo, pr, key)));
  const comment = (at, c) => ({ at, edited: c.lastEditedAt ?? null, minimized: c.isMinimized === true, url: c.url, body: c.body ?? '' });
  return {
    comments: [
      ...issueComments.map((c) => comment(c.createdAt, c)),
      ...reviews.filter((r) => r.body?.trim()).map((r) => comment(r.submittedAt ?? r.createdAt, r)),
    ],
    threads: threads.map((t) => ({
      isResolved: t.isResolved === true,
      where: `${t.path}:${t.line ?? '?'}`,
      url: t.comments?.nodes?.[0]?.url ?? '',
      body: t.comments?.nodes?.[0]?.body ?? '',
    })),
  };
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
