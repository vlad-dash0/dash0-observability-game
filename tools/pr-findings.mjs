// PR findings detector (#35): has every review finding on a PR been dispositioned?
// Reads the PR's issue comments, review bodies and review threads through `gh api graphql`
// (every page) and parses each comment as GitHub renders it (`bodyHTML`, read with
// linkedom): sections are <h2> elements and findings and dispositions are <table>
// elements, so text in code, an HTML comment or anything else GitHub does not render as a
// heading or table is never read as one. The comment formats are documented in
// .github/pull_request_template.md. Prints each finding that has no disposition;
// minimized (hidden) comments are skipped and listed.
// Usage: node tools/pr-findings.mjs <pr-number> [--repo owner/name]
// Exit: 0 PASS, 1 open findings, 2 inconclusive (API error, no review, unparseable).
// Needs `npm ci` (linkedom, a devDependency); the gh call is injected so the parser and
// the decision are pure.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded here, not imported statically: a missing module must exit 2, not node's 1 for a
// failed import, so it surfaces from parseComment as an error that run() reports.
let parseHTML;
let domError;
try {
  ({ parseHTML } = await import('linkedom'));
} catch (err) {
  domError = err;
}

export const EXIT = { PASS: 0, OPEN: 1, INCONCLUSIVE: 2 };

const SHA = '([0-9a-f]{7,40})';
const REVIEW = new RegExp(String.raw`^(?:independent\s+)?(?:re-?)?review\s+of\s+${SHA}(?![0-9a-z])`, 'i');
const DISPOSITIONS = new RegExp(String.raw`^dispositions\s+for\s+the\s+(?:re-?)?review\s+of\s+${SHA}(?![0-9a-z])`, 'i');
const NOT_CLEAN = /\bnot\s+clean\b/i;
// Headings reserved for the forms above: outside a review section, one that is not a
// recognised form is an error, because it may hold the open finding. Reserved: says NOT
// CLEAN; starts with "Re-review" (not "Re-review requested"), "Independent review" or
// "Disposition(s)"; starts with "Review(s)" and names findings, dispositions or a sha; or
// names findings and a sha. Not reserved: "Review notes", "Reviewer's Guide", "Findings
// from QA", "Pre-merge audit at <sha>".
const HEX = String.raw`\b[0-9a-f]{7,40}\b`;
const RESERVED = [
  NOT_CLEAN,
  /^(?:re-?review(?!\s+requested\b)|independent\s+review|dispositions?)\b/i,
  new RegExp(String.raw`^reviews?\b.*(?:\bfindings?\b|\bdispositions?\b|${HEX})`, 'i'),
  new RegExp(String.raw`\bfindings?\b.*${HEX}|${HEX}.*\bfindings?\b`, 'i'),
];
const reserved = (t) => RESERVED.some((re) => re.test(t));
const NO_FINDINGS = /^no findings\.?$/i;
// A disposition cell with no letter or digit, or that is only one of these words (or one
// of them followed by a separator, e.g. "TODO: later"), leaves the finding open.
const PLACEHOLDER = /^(?:tbd|todo|open|n\/a|pending|none)(?:\s*(?:[—–:(,]|-\s).*)?$/i;
const FINDING_COLS = ['finding', 'findings', 'issue', 'issues'];

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// A paragraph that is only bold text reads as a heading: returns that text, else null.
function boldLine(p) {
  const [only, ...rest] = p.children;
  if (!only || rest.length || !['strong', 'b'].includes(only.localName)) return null;
  const bare = (s) => s.replace(/\s+/g, ' ').trim().replace(/:$/, '').trim();
  return bare(p.textContent) === bare(only.textContent) ? bare(only.textContent) : null;
}

// A <table> as { header, rows }; the first row is the header (GFM puts it in <thead>).
// GFM pads or trims every row to the header; a raw HTML table may not, which is an error.
function table(el, where, errors) {
  const trs = [...el.querySelectorAll('tr')].filter((tr) => tr.closest('table') === el);
  const cellsOf = (tr) => [...tr.children].filter((c) => c.localName === 'td' || c.localName === 'th').map(text);
  const header = trs.length ? cellsOf(trs[0]).map((h) => h.toLowerCase()) : [];
  const rows = [];
  for (const tr of trs.slice(1)) {
    const row = cellsOf(tr);
    if (row.length !== header.length) {
      errors.push(`${where}: row has ${row.length} cells, header has ${header.length}: ${row.join(' | ')}`);
      continue;
    }
    rows.push(Object.fromEntries(header.map((h, k) => [h, row[k]])));
  }
  return { header, rows };
}

// Sections split at <h1>/<h2> in document order (one in a blockquote counts); each is
// { kind, sha, heading, tables, items, paras } with kind 'review', 'dispositions' or null.
// Inside a review or dispositions section, <h3>-<h6> and bold lines are free text unless
// they use a review or dispositions form. Every element is walked: markdown code renders
// as text only, but GitHub keeps a raw HTML <h2> or <table> inside <pre> and shows it.
function sections(root, errors) {
  const out = [];
  const open = (kind, sha, heading) => out.push({ kind, sha, heading, tables: [], items: [], paras: [] });
  open(null, undefined, '(top of comment)');
  const headingLike = (t, what) => {
    if (DISPOSITIONS.test(t) || REVIEW.test(t)) {
      errors.push(`"${t}" is ${what}; review and dispositions headings must be level 2 ("## ")`);
    } else if (!out.at(-1).kind && reserved(t)) {
      errors.push(`"${t}" is ${what} that reads as a review outside a review section (expected "## Review of <sha>")`);
    }
  };
  const walk = (el) => {
    for (const child of el.children) {
      const name = child.localName;
      const level = /^h[1-6]$/.test(name) ? Number(name[1]) : 0;
      if (level === 2) {
        const t = text(child);
        const d = DISPOSITIONS.exec(t);
        const r = !d && REVIEW.exec(t);
        if (!d && !r && reserved(t)) {
          errors.push(`"## ${t}": unrecognised review heading (expected "Review of <sha>" or "Dispositions for the review of <sha>")`);
        }
        const kind = d ? 'dispositions' : r ? 'review' : null;
        open(kind, kind ? (d || r)[1].toLowerCase() : undefined, `## ${t}`);
      } else if (level) {
        const t = text(child);
        headingLike(t, `a level-${level} heading`);
        if (level === 1) open(null, undefined, `# ${t}`);
      } else if (name === 'table') {
        out.at(-1).tables.push(table(child, `"${out.at(-1).heading}"`, errors));
      } else {
        if (name === 'li') out.at(-1).items.push(text(child));
        if (name === 'p') {
          const bold = boldLine(child);
          if (bold) headingLike(bold, 'a bold line');
          out.at(-1).paras.push(text(child));
        }
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function needColumns(t, cols, where, errors) {
  const missing = cols.filter((c) => !t.header.includes(c));
  if (missing.length) errors.push(`${where}: table lacks column(s) ${missing.map((c) => `"${c}"`).join(', ')}`);
  return missing.length === 0;
}

function disposition(cell) {
  const bare = (cell ?? '').replace(/[*_`~]/g, '').trim().replace(/[.!,;:]+$/, '').trim();
  return !/[\p{L}\p{N}]/u.test(bare) || PLACEHOLDER.test(bare) ? null : cell;
}

const looksLikeFindings = (t) => t.header.includes('#') || t.header.some((h) => FINDING_COLS.includes(h));

/** Parse one comment's rendered HTML (bodyHTML) into the reviews and dispositions it declares. */
export function parseComment(html) {
  const reviews = [];
  const dispositions = [];
  const errors = [];
  if (typeof html !== 'string') return { reviews, dispositions, errors: ['no rendered body (bodyHTML)'] };
  if (!parseHTML) throw new Error(`linkedom is not installed (run npm ci): ${domError.message}`);
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const { kind, sha, heading, tables, items, paras } of sections(document.body, errors)) {
    const where = `"${heading}"`;
    if (!kind) {
      for (const t of tables) {
        if (t.header.includes('#') && t.header.some((h) => FINDING_COLS.includes(h))) {
          errors.push(`${where}: a findings table outside a review section (${t.header.join(' | ')})`);
        }
      }
      continue;
    }
    if (paras.some((p) => p.startsWith('|'))) errors.push(`${where}: a table row outside a table (no header and delimiter row)`);
    if (kind === 'dispositions') {
      const entries = [];
      if (!tables.length) errors.push(`${where}: no dispositions table`);
      for (const t of tables) {
        if (!needColumns(t, ['#', 'disposition'], where, errors)) continue;
        for (const row of t.rows) entries.push({ id: row['#'], disposition: disposition(row.disposition) });
      }
      dispositions.push({ sha, heading, entries });
      continue;
    }
    // A review: findings live in tables with "#" and "Finding"; other tables (a file list,
    // a summary) are skipped unless they look like findings ("#" or an issue column).
    const findingTables = tables.filter(looksLikeFindings);
    if (items.length) errors.push(`${where}: a list item in a review section (findings go in the table): ${items[0]}`);
    if (paras.some((p) => NO_FINDINGS.test(p))) {
      if (tables.length || items.length || NOT_CLEAN.test(heading)) {
        errors.push(`${where}: "No findings." must stand alone, in a review that is not NOT CLEAN`);
      }
    } else if (!findingTables.length) {
      errors.push(`${where}: no findings table and no "No findings." line`);
    }
    const findings = [];
    for (const t of findingTables) {
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
// When a comment last said what it says: its last edit if any, else its creation.
const lastWritten = (c) => (c.edited == null ? time(c.at) : Math.max(time(c.at), time(c.edited)));

/**
 * Decide from comments ({ at, edited?, minimized?, author?, url, html }) and review threads
 * ({ isResolved, where, url, body }). Returns { exit, open, errors, skipped, reviews,
 * findings }. Any error, or no review at all, is inconclusive: the open list may then be
 * incomplete, so it never reads as PASS. Minimized comments are skipped (the override for
 * a comment the parser must not read) and returned in `skipped` so the bypass is visible.
 */
export function evaluate({ comments, threads }) {
  const errors = [];
  const reviews = [];
  const visible = [];
  const skipped = [];
  for (const c of comments) {
    if (c.minimized) { skipped.push({ url: c.url, author: c.author ?? '(unknown)' }); continue; }
    if (!Number.isFinite(time(c.at))) errors.push(`${c.url}: no usable timestamp (${c.at})`);
    else if (c.edited != null && !Number.isFinite(time(c.edited))) errors.push(`${c.url}: unusable edit timestamp (${c.edited})`);
    else visible.push({ ...c, i: visible.length });
  }
  visible.sort((a, b) => time(a.at) - time(b.at) || a.i - b.i);
  for (const c of visible) {
    const parsed = parseComment(c.html);
    errors.push(...parsed.errors.map((e) => `${c.url}: ${e}`));
    for (const review of parsed.reviews) {
      const seen = new Set();
      for (const f of review.findings) {
        if (!f.id) errors.push(`${c.url}: review of ${review.sha} has a finding with an empty "#"`);
        else if (seen.has(f.id)) errors.push(`${c.url}: review of ${review.sha} has duplicate finding #${f.id}`);
        seen.add(f.id);
      }
      reviews.push({ ...review, url: c.url, edited: c.edited ?? null });
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
        else if (!e.disposition) continue;
        // Dispositions answer the review as it read when they were last written (posted
        // or edited): ones last written before the review's last edit do not count; each
        // finding then needs a fresh one.
        else if (review.edited && lastWritten(c) < time(review.edited)) f.stale ??= review.edited;
        else { f.disposition = e.disposition; delete f.stale; }
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
  return { exit, open, errors, skipped, reviews: reviews.length, findings };
}

// --- gh layer -------------------------------------------------------------------------

function defaultGh(args) {
  return new Promise((done, fail) => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? fail(new Error(stderr.trim() || err.message)) : done(stdout));
  });
}

const NODES = {
  comments: 'createdAt lastEditedAt isMinimized url bodyHTML author { login }',
  reviews: 'submittedAt createdAt lastEditedAt isMinimized url bodyHTML author { login }',
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
    // A partial response (data plus errors) may be missing nodes: never read it as whole.
    if (p?.errors) throw new Error(`gh api graphql ${key}: ${JSON.stringify(p.errors)}`);
    const conn = p?.data?.repository?.pullRequest?.[key];
    if (!conn || !Array.isArray(conn.nodes)) {
      throw new Error(`gh api graphql: no ${key} in the response`);
    }
    return conn.nodes;
  });
}

/**
 * Every issue comment, non-empty review body and review thread on the PR. A missing
 * bodyHTML is passed on as is (not as ''), so the parser reports it.
 */
export async function fetchPr({ repo, pr, gh = defaultGh }) {
  const [issueComments, reviews, threads] = await Promise.all(
    ['comments', 'reviews', 'reviewThreads'].map((key) => connection(gh, repo, pr, key)));
  const comment = (at, c) => ({ at, edited: c.lastEditedAt ?? null, minimized: c.isMinimized === true, author: c.author?.login ?? '(unknown)', url: c.url, html: c.bodyHTML });
  return {
    comments: [
      ...issueComments.map((c) => comment(c.createdAt, c)),
      ...reviews.filter((r) => typeof r.bodyHTML !== 'string' || r.bodyHTML.trim())
        .map((r) => comment(r.submittedAt ?? r.createdAt, r)),
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
  for (const s of result.skipped) log(`SKIPPED minimized comment by ${s.author}: ${s.url}`);
  for (const f of result.open) {
    const at = f.sha ? `${f.sha} #${f.id}` : `thread ${f.where}`;
    const stale = f.stale ? ` (dispositioned before the review was edited at ${f.stale})` : '';
    log(`OPEN ${at}${f.severity ? ` [${f.severity}]` : ''}: ${oneLine(f.finding)}${stale} ${f.url}`);
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
