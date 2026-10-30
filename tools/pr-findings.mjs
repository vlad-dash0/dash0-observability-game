// PR findings detector (#35): has every review finding on a PR been dispositioned?
// Reads the PR's issue comments, review bodies and review threads through `gh api graphql`
// (every page), parses the comment formats documented in .github/pull_request_template.md
// and prints each finding that has no disposition. Minimized (hidden) comments are skipped
// and listed. Within the format it reads what GitHub renders (blockquotes, GFM tables with
// or without outer pipes; not HTML comments or code); anything ambiguous is inconclusive.
// Usage: node tools/pr-findings.mjs <pr-number> [--repo owner/name]
// Exit: 0 PASS, 1 open findings, 2 inconclusive (API error, no review, unparseable).
// Zero dependencies; the gh call is injected so the parser and the decision are pure.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT = { PASS: 0, OPEN: 1, INCONCLUSIVE: 2 };

const SHA = '`?([0-9a-f]{7,40})`?';
const REVIEW = new RegExp(String.raw`^(?:independent\s+)?(?:re-?)?review\s+of\s+${SHA}(?![0-9a-z])`, 'i');
const DISPOSITIONS = new RegExp(String.raw`^dispositions\s+for\s+the\s+(?:re-?)?review\s+of\s+${SHA}(?![0-9a-z])`, 'i');
// Headings reserved for the forms above: outside a review section, one that is not a
// recognised form at level 2 is an error, because it may hold the open finding. Reserved:
// starts with "Re-review"/"Independent review" or "Disposition(s)"; starts with "Review(s)"
// and names findings, dispositions or a sha; or names findings and a sha. Not reserved:
// "Review notes", "Reviewer's Guide", "Findings from QA", "Pre-merge audit at <sha>".
const HEX = String.raw`\b[0-9a-f]{7,40}\b`;
const RESERVED = [
  /^(?:re-?review|independent\s+review|dispositions?)\b/i,
  new RegExp(String.raw`^reviews?\b.*(?:\bfindings?\b|\bdispositions?\b|${HEX})`, 'i'),
  new RegExp(String.raw`\bfindings?\b.*${HEX}|${HEX}.*\bfindings?\b`, 'i'),
];
const reserved = (text) => RESERVED.some((re) => re.test(text));
const NO_FINDINGS = /^no findings\.?$/i;
const NOT_CLEAN = /\bnot\s+clean\b/i;
// A disposition cell that, once formatting is stripped, is only one of these (or one of
// tbd/todo/open/n/a followed by a separator, e.g. "TODO: later") leaves the finding open.
const PLACEHOLDER = /^(?:-+|—|–|\?+|(?:tbd|todo|open|n\/a)(?:\s*(?:[—–:(,]|-\s).*)?)$/i;
const FINDING_COLS = ['finding', 'findings', 'issue', 'issues'];
const DELIMITER = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const BOLD = /^ {0,3}(\*\*|__)(.+?)\1[ \t]*:?[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])(?:\s|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED = /^(?: {4}|\t)/;
const QUOTE = /^(?: {0,3}> ?)+/;
// Lines that end a GFM table (besides a blank line).
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|(?:[-*+]|\d+[.)])\s)/;

// Inline: keep code spans verbatim (a `<!--` in code is literal), drop `<!-- ... -->`.
// Returns null when a comment opens and does not close on this line.
function stripInline(line) {
  let out = '';
  for (let i = 0; i < line.length;) {
    if (line[i] === '`') {
      const run = /^`+/.exec(line.slice(i))[0];
      const close = new RegExp(String.raw`(?<!\`)${run}(?!\`)`, 'g');
      close.lastIndex = i + run.length;
      const m = close.exec(line);
      const end = m ? m.index + run.length : i + run.length;
      out += line.slice(i, end);
      i = end;
    } else if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4);
      if (end < 0) return null;
      i = end + 3;
    } else {
      out += line[i++];
    }
  }
  return out;
}

// What GitHub renders, line by line: blockquote markers removed (a quoted review is still
// a review); HTML comments, fenced and indented code dropped (a disposition hidden in them
// must not count). An unterminated comment or fence is an error: it may hide a finding.
function visibleLines(body, errors) {
  const lines = [];
  let fence = null;
  let comment = false;
  let code = false; // inside an indented code block
  let list = false; // inside a list (indented lines continue it, not code)
  let blank = true; // previous line was blank (indented code cannot interrupt a paragraph)
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(QUOTE, '');
    if (fence) {
      const close = new RegExp(String.raw`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\s*$`);
      if (close.test(line)) fence = null;
      continue;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      continue;
    }
    if (!line.trim()) {
      blank = true;
      lines.push('');
      continue;
    }
    if (INDENTED.test(line) && !list && (blank || code)) {
      code = true;
      continue;
    }
    code = false;
    if (LIST_ITEM.test(line)) list = true;
    else if (!/^\s/.test(line)) list = false;
    blank = false;
    const f = FENCE.exec(line);
    if (f) { fence = f[1]; continue; }
    if (/^ {0,3}<!--/.test(line)) {
      if (!line.slice(line.indexOf('<!--') + 4).includes('-->')) comment = true;
      continue;
    }
    const visible = stripInline(line);
    if (visible === null) {
      errors.push(`unterminated HTML comment in: ${raw.trim()}`);
      continue;
    }
    lines.push(visible);
  }
  if (fence) errors.push(`unterminated code fence (${fence})`);
  if (comment) errors.push('unterminated HTML comment');
  return lines;
}

const unwrap = (s) => s.trim().replace(/^(\*\*|__|\*|_)(.*)\1$/, '$2').trim();
const isForm = (text) => DISPOSITIONS.test(text) || REVIEW.test(text);

// Tokens: { head } for ATX, setext and bold-only lines; { line } for every line (a bold
// line is both). A setext underline only makes a heading when the paragraph above it is a
// review or dispositions form (and is then an error); otherwise it is ignored.
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
      const text = unwrap(out.slice(out.length - para).map((t) => t.line.trim()).join(' '));
      if (isForm(text)) {
        out.splice(out.length - para, para);
        out.push({ head: { kind: 'setext', level: setext[1][0] === '=' ? 1 : 2, text } });
        para = 0;
        continue;
      }
    }
    const bold = BOLD.exec(line);
    if (bold) out.push({ head: { kind: 'bold', level: 0, text: bold[2].trim().replace(/:$/, '') } });
    out.push({ line });
    para = !line.trim() || bold || setext || line.includes('|') || LIST_ITEM.test(line) ? 0 : para + 1;
  }
  return out;
}

const describe = (h) => (h.kind === 'atx' ? `a level-${h.level} heading` : h.kind === 'setext' ? 'a setext heading' : 'a bold line');

// Sections split at level-1/2 headings; each is { kind, sha, heading, lines } with kind
// 'review', 'dispositions' or null. Inside a review or dispositions section, level-3+
// headings and bold lines are free text unless they use a review or dispositions form.
function sections(body, errors) {
  const out = [{ kind: null, heading: '(top of comment)', lines: [] }];
  for (const t of tokens(visibleLines(body, errors))) {
    if (!t.head) { out.at(-1).lines.push(t.line); continue; }
    const h = t.head;
    const d = DISPOSITIONS.exec(h.text);
    const r = !d && REVIEW.exec(h.text);
    const canonical = h.kind === 'atx' && h.level === 2;
    if (canonical) {
      if (!d && !r && reserved(h.text)) {
        errors.push(`"## ${h.text}": unrecognised review heading (expected "Review of <sha>" or "Dispositions for the review of <sha>")`);
      }
      const kind = d ? 'dispositions' : r ? 'review' : null;
      out.push({ kind, sha: kind && (d || r)[1].toLowerCase(), heading: `## ${h.text}`, lines: [] });
      continue;
    }
    if (d || r || (!out.at(-1).kind && reserved(h.text))) {
      errors.push(`"${h.text}" is ${describe(h)}; review and dispositions headings must be level 2 ("## ")`);
    }
    if (h.kind === 'setext' || h.level === 1) out.push({ kind: null, heading: h.text, lines: [] });
  }
  return out;
}

// GFM table cells: split on unescaped pipes (outer pipes optional), then unescape `\|`.
function cells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const isDelimiter = (line) => line.includes('|') && DELIMITER.test(line.trim());

// GFM tables, found by their delimiter row: the line above is the header (same cell
// count), and each following line up to a blank line or a new block is a row, with or
// without outer pipes. Returns { tables: [{ header, rows }], used: Set of line indexes }.
function tables(lines, where, errors) {
  const found = [];
  const used = new Set();
  for (let i = 1; i < lines.length; i++) {
    if (!isDelimiter(lines[i]) || used.has(i - 1)) continue;
    const head = lines[i - 1];
    if (!head.includes('|') || cells(head).length !== cells(lines[i]).length) continue;
    const header = cells(head).map((c) => c.toLowerCase());
    used.add(i - 1).add(i);
    const rows = [];
    let j = i + 1;
    for (; j < lines.length && lines[j].trim() && !BLOCK_START.test(lines[j]); j++) {
      used.add(j);
      if (isDelimiter(lines[j])) {
        errors.push(`${where}: a delimiter row inside a table (start a second table after a blank line)`);
        continue;
      }
      const row = cells(lines[j]);
      if (row.length !== header.length) {
        errors.push(`${where}: row has ${row.length} cells, header has ${header.length}: ${lines[j].trim()}`);
        continue;
      }
      rows.push(Object.fromEntries(header.map((h, k) => [h, row[k]])));
    }
    found.push({ header, rows });
    i = j;
  }
  return { tables: found, used };
}

// Outside review sections only headers matter (third-party tables may be anything).
function hasFindingsHeader(lines) {
  return lines.some((line, i) => {
    if (!line.includes('|') || !isDelimiter(lines[i + 1] ?? '')) return false;
    const header = cells(line).map((c) => c.toLowerCase());
    return header.includes('#') && header.some((h) => FINDING_COLS.includes(h));
  });
}

function needColumns(table, cols, where, errors) {
  const missing = cols.filter((c) => !table.header.includes(c));
  if (missing.length) errors.push(`${where}: table lacks column(s) ${missing.map((c) => `"${c}"`).join(', ')}`);
  return missing.length === 0;
}

function disposition(cell) {
  if (!cell) return null;
  const bare = cell.replace(/&nbsp;|\u00a0/gi, ' ').replace(/[*_`]/g, '').trim().replace(/[.!,;:]+$/, '').trim();
  return !bare || PLACEHOLDER.test(bare) ? null : cell.trim();
}

/** Parse one comment body into the reviews and dispositions it declares. */
export function parseComment(body) {
  const reviews = [];
  const dispositions = [];
  const errors = [];
  for (const { kind, sha, heading, lines } of sections(body ?? '', errors)) {
    const where = `"${heading}"`;
    if (!kind) {
      if (hasFindingsHeader(lines)) errors.push(`${where}: a findings table outside a review section`);
      continue;
    }
    const { tables: found, used } = tables(lines, where, errors);
    const loose = lines.filter((l, i) => !used.has(i));
    if (loose.some((l) => l.trim().startsWith('|'))) errors.push(`${where}: a table row outside a table (no header and delimiter row)`);
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
    // A review: findings live in tables with "#" and "Finding"; other tables (a file list,
    // a summary) are skipped unless they look like findings ("#" or an issue column).
    const findingTables = found.filter((t) => t.header.includes('#') || t.header.some((h) => FINDING_COLS.includes(h)));
    const lists = loose.filter((l) => LIST_ITEM.test(l));
    if (lists.length) errors.push(`${where}: a list item in a review section (findings go in the table): ${lists[0].trim()}`);
    if (loose.some((l) => NO_FINDINGS.test(l.trim()))) {
      if (found.length || lists.length || NOT_CLEAN.test(heading)) {
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

/**
 * Decide from comments ({ at, edited?, minimized?, author?, url, body }) and review threads
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
    const parsed = parseComment(c.body);
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
        // Dispositions answer the review as it read when they were posted: one posted
        // before the review's last edit does not count; each finding needs a fresh one.
        else if (review.edited && time(c.at) < time(review.edited)) f.stale ??= review.edited;
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
  comments: 'createdAt lastEditedAt isMinimized url body author { login }',
  reviews: 'submittedAt createdAt lastEditedAt isMinimized url body author { login }',
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

/** Every issue comment, non-empty review body and review thread on the PR. */
export async function fetchPr({ repo, pr, gh = defaultGh }) {
  const [issueComments, reviews, threads] = await Promise.all(
    ['comments', 'reviews', 'reviewThreads'].map((key) => connection(gh, repo, pr, key)));
  const comment = (at, c) => ({ at, edited: c.lastEditedAt ?? null, minimized: c.isMinimized === true, author: c.author?.login ?? '(unknown)', url: c.url, body: c.body ?? '' });
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
