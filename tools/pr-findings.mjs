// PR findings detector (#35): has every review finding on a PR been dispositioned?
// Reads the PR's issue comments, review bodies and review threads through `gh api graphql`
// (every page) and parses each comment as GitHub renders it (`bodyHTML`, read with
// linkedom): sections are <h2> elements and findings and dispositions are <table>
// elements, so text in code, an HTML comment or anything else GitHub does not render as a
// heading or table is never read as one. The comment formats are documented in
// .github/pull_request_template.md. It fails closed: inside a review section only the
// recognised content is allowed, and outside one any text naming a review form is an
// error. Prints each finding that has no disposition and who posted each dispositions
// comment; minimized (hidden) comments are skipped and listed.
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
const CLEAN = /\bclean\b/i;
const HEX = String.raw`\b[0-9a-f]{7,40}\b`;
const REVIEW_OF = new RegExp(String.raw`\b(?:re-?)?review\s+of\s+${SHA}(?![0-9a-z])`, 'i');
// Starts a review in prose: "Re-review(s)", "Re review", "Independent review(s)".
const REVIEW_START = /^(?:re[\s-]*reviews?|independent\s+reviews?)\b/i;
// Not a review: a block (or line) that is only "Re-review requested", with punctuation.
const REQUESTED = /^re[\s-]*review\s+requested[\s\p{P}]*$/iu;
// "finding(s)" as a word, not part of a name such as pr-findings.mjs.
const FINDING = String.raw`(?<![\w./-])findings?(?![\w/-]|\.\w)`;
// "Review(s)"/"Reviewer(s)" that then reports problems ("Reviewers found problems in ...").
const REVIEWER_FOUND = new RegExp(String.raw`^review(?:er)?s?\b.*(?<!\bno\s)(?:\b(?:found|problems?|issues?|bugs?)\b|${FINDING}(?!['’]s))`, 'i');
const FINDINGS_SHA = new RegExp(String.raw`${FINDING}.*${HEX}|${HEX}.*${FINDING}`, 'i');
// Outside a review section, a heading of a form reserved for reviews is an error, because
// it may hold the open finding: one that says NOT CLEAN or names "review of <sha>"; starts
// with "Re-review" (not "Re-review requested"), "Independent review" or "Disposition(s)";
// starts with "Review(s)" and names findings, dispositions or a sha; starts with
// "Review(s)/Reviewer(s)" and reports problems; or names findings and a sha. Not reserved:
// "Review notes", "Reviewer's Guide", "Findings from QA", "Pre-merge audit at <sha>".
const DISPOSITION_START = /^dispositions?\b/i;
const RESERVED = [
  NOT_CLEAN, REVIEW_OF, REVIEW_START, REVIEWER_FOUND, FINDINGS_SHA, DISPOSITION_START,
  new RegExp(String.raw`^reviews?\b.*(?:${FINDING}|\bdispositions?\b|${HEX})`, 'i'),
];
// Every other text block outside a review section (paragraph, list item, table cell,
// summary, any run of bare text) gets the same starts, tested on the whole block and on
// each of its lines, except that "Review(s)" needs a problem word, not just a sha or
// "finding's" ("Reviews: <sha> CLEAN", "Reviews: every finding's disposition is posted
// above." are audit lines). A table cell that is only a form name ("Disposition",
// "Independent review") is a column or row label, not a review.
const RESERVED_TEXT = [NOT_CLEAN, REVIEW_OF, REVIEW_START, REVIEWER_FOUND, FINDINGS_SHA, DISPOSITION_START];
const LABEL = /^(?:re[\s-]*reviews?|independent\s+reviews?|reviews?|dispositions?)$/i;
const matches = (patterns) => (t) => !REQUESTED.test(t) && patterns.some((re) => re.test(t));
const reserved = matches(RESERVED);
const reservedText = matches(RESERVED_TEXT);
const NO_FINDINGS = /^no findings\.?$/i;
// A disposition cell with no letter or digit, or that is only one of these words (or one
// of them followed by a separator, e.g. "TODO: later"), leaves the finding open.
const PLACEHOLDER = /^(?:tbd|todo|open|n\/a|pending|none)(?:\s*[-:(,].*)?$/i;
const FINDING_COLS = ['finding', 'findings', 'issue', 'issues', 'problem', 'problems'];

// Latin lookalikes folded to their ASCII skeleton: Cyrillic and Greek letters that look
// like a Latin letter, and Latin small capitals (NFKC leaves all of these alone).
const CONFUSABLE = Object.fromEntries([
  // Cyrillic capitals, then small letters.
  'АA', 'ВB', 'ЕE', 'ЅS', 'ІI', 'ЈJ', 'КK', 'МM', 'НH', 'ОO', 'РP', 'СC', 'ТT', 'УY', 'ХX',
  'ӀI', 'ԀD', 'ԌG', 'ԚQ', 'ԜW', 'ѴV', 'ЬB',
  'аa', 'вb', 'гr', 'еe', 'кk', 'мm', 'нh', 'оo', 'пn', 'рp', 'сc', 'тt', 'уy', 'хx', 'ьb',
  'ѕs', 'іi', 'јj', 'һh', 'ӏl', 'ԁd', 'ԍg', 'ԛq', 'ԝw', 'ѡw', 'ѵv',
  // Greek capitals, then small letters.
  'ΑA', 'ΒB', 'ΕE', 'ΖZ', 'ΗH', 'ΙI', 'ΚK', 'ΜM', 'ΝN', 'ΟO', 'ΡP', 'ΤT', 'ΥY', 'ΧX',
  'ϹC', 'ϜF', 'ͿJ',
  'αa', 'γy', 'εe', 'ηn', 'ιi', 'κk', 'νv', 'οo', 'ρp', 'τt', 'υu', 'χx', 'ωw', 'ϲc', 'ϝf', 'ϳj',
  // Latin small capitals.
  'ᴀA', 'ʙB', 'ᴄC', 'ᴅD', 'ᴇE', 'ꜰF', 'ɢG', 'ʜH', 'ɪI', 'ᴊJ', 'ᴋK', 'ʟL', 'ᴍM', 'ɴN', 'ᴏO',
  'ᴘP', 'ʀR', 'ꜱS', 'ᴛT', 'ᴜU', 'ᴠV', 'ᴡW', 'ʏY', 'ᴢZ',
].map((pair) => [...pair]));
const LOOKALIKE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'gu');

// Text as it renders, before folding: NFKC (fullwidth, ligature and mathematical letters
// become ASCII) with format characters (\p{Cf}: zero-width space and joiners, soft
// hyphen, word joiner, bidi marks) removed.
const canonical = (s) => s.normalize('NFKC').replace(/\p{Cf}/gu, '');

// The one normalisation every text accessor applies before any match: canonical(), then
// every dash (\p{Pd}, U+2010/U+2011 included, and the minus sign) becomes "-", every
// lookalike its Latin letter, and every run of whitespace (any Unicode space) one ASCII
// space, so "ＮＯＴ CL<U+200B>EAN", "NОT<U+00A0>CLEAN" (Cyrillic О) or "Re‑review" (U+2011)
// reads as "NOT CLEAN" or "Re-review".
const normalize = (s) => canonical(s).replace(/[\p{Pd}\u2212]/gu, '-')
  .replace(LOOKALIKE, (c) => CONFUSABLE[c]).replace(/[\s\p{Zs}]+/gu, ' ').trim();

// A word (outside code) that mixes Latin with Cyrillic or Greek letters is a disguise, not
// prose: returns the first, else null. Words of one script ("Проверено", "καλά") are fine.
const LATIN = /\p{Script=Latin}/u;
const OTHER = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const mixedWord = (s) => canonical(s).match(/[\p{L}\p{M}]+/gu)?.find((w) => LATIN.test(w) && OTHER.test(w)) ?? null;

// Raw text of a node, a <br> as a newline; code and pre left out when `code` is false.
function raw(node, code = true) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.localName === 'br') return '\n';
  if (!code && (node.localName === 'code' || node.localName === 'pre')) return '';
  let s = '';
  for (const c of node.childNodes) s += raw(c, code);
  return s;
}
const text = (el) => normalize(raw(el));
// Text of an element outside code: code renders as code, never as a table row.
const proseText = (el) => normalize(raw(el, false));

// A paragraph that is only bold text reads as a heading: returns that text, else null.
function boldLine(p) {
  const [only, ...rest] = p.children;
  if (!only || rest.length || !['strong', 'b'].includes(only.localName)) return null;
  const bare = (el) => text(el).replace(/:$/, '').trim();
  return bare(p) === bare(only) ? bare(only) : null;
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

// Phrasing (inline) elements: a run of these and bare text between blocks is one text
// block. Any other element is a block, walked in turn, so no text sits outside the walk.
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'font', 'g-emoji', 'i', 'img', 'input', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr']);
const inline = (n) => n.nodeType === 3 || (n.nodeType === 1 && INLINE.has(n.localName));

// Sections split at <h1>/<h2> in document order (one in a blockquote counts); each is
// { kind, sha, heading, tables, items, paras, prose } with kind 'review', 'dispositions'
// or null. Fail closed: outside a review section, every text block (paragraph, list item,
// table cell, heading, summary, and every maximal run of bare text and inline elements
// not inside one of those, at any depth including the top level) that reads as a review
// is an error. Inside a review or dispositions section, <h3>-<h6> and bold lines are free
// text unless they use a review or dispositions form; `prose` collects every text block
// (code excluded) so the caller can reject a finding row GitHub did not render as a
// table. Every node is walked: markdown code renders as text only, but GitHub keeps a raw
// HTML <h2> or <table> inside <pre> and shows it.
function sections(root, errors) {
  const out = [];
  const open = (kind, sha, heading) => out.push({ kind, sha, heading, tables: [], items: [], paras: [], prose: [] });
  open(null, undefined, '(top of comment)');
  const cur = () => out.at(-1);
  // A block's text is tested whole and line by line (lines split at <br> or a newline),
  // so a lead-in line cannot hide a reserved start.
  const outside = (rawText, what, test = reservedText) => {
    if (cur().kind) return;
    const whole = normalize(rawText);
    const hit = [whole, ...rawText.split(/[\n\r\v\f\x85\u2028\u2029]/).map(normalize)].find((t) => t && test(t));
    if (hit !== undefined) {
      errors.push(`"${hit}" is ${what} that reads as a review outside a review section (expected "## Review of <sha>")`);
    }
  };
  const headingLike = (t, what) => {
    if (DISPOSITIONS.test(t) || REVIEW.test(t)) {
      errors.push(`"${t}" is ${what}; review and dispositions headings must be level 2 ("## ")`);
    } else {
      outside(t, what, reserved);
    }
  };
  // A run of bare text and inline elements outside any text block.
  const textRun = (nodes, parent) => {
    const r = nodes.map((n) => raw(n)).join('');
    if (!normalize(r)) return;
    outside(r, parent === root ? 'text at the top level' : `text in <${parent.localName}>`);
    cur().paras.push(normalize(r));
    cur().prose.push(normalize(nodes.map((n) => raw(n, false)).join('')));
  };
  // inText: inside a paragraph, list item, summary, heading or code, whose text is already read.
  const walk = (el, inText) => {
    let run = [];
    const flush = () => {
      if (!inText && run.length) textRun(run, el);
      run = [];
    };
    for (const child of el.childNodes) {
      if (inline(child)) {
        run.push(child);
        if (child.nodeType === 1) walk(child, true);
        continue;
      }
      flush();
      if (child.nodeType !== 1) continue;
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
        if (level === 1) open(null, undefined, `# ${t}`);
        headingLike(t, `a level-${level} heading`);
        cur().prose.push(proseText(child));
      } else if (name === 'table') {
        cur().tables.push(table(child, `"${cur().heading}"`, errors));
        for (const cell of child.querySelectorAll('td, th')) {
          if (cell.closest('table') === child && !LABEL.test(text(cell))) outside(raw(cell), 'a table cell');
        }
      } else {
        let nowInText = inText;
        if (name === 'li') {
          cur().items.push(text(child));
          outside(raw(child), 'a list item');
          nowInText = true;
        } else if (name === 'p') {
          const bold = boldLine(child);
          if (bold) headingLike(bold, 'a bold line');
          else outside(raw(child), 'a paragraph');
          cur().paras.push(text(child));
          cur().prose.push(proseText(child));
          nowInText = true;
        } else if (name === 'summary') {
          outside(raw(child), 'a summary');
          cur().prose.push(proseText(child));
          nowInText = true;
        } else if (name === 'pre') {
          nowInText = true;
        }
        walk(child, nowInText);
      }
    }
    flush();
  };
  walk(root, false);
  errors.splice(0, errors.length, ...new Set(errors));
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

/** Parse one comment's rendered HTML (bodyHTML) into the reviews and dispositions it declares. */
export function parseComment(html) {
  const reviews = [];
  const dispositions = [];
  const errors = [];
  if (typeof html !== 'string') return { reviews, dispositions, errors: ['no rendered body (bodyHTML)'] };
  if (!parseHTML) throw new Error(`linkedom is not installed (run npm ci): ${domError.message}`);
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const mixed = mixedWord(raw(document.body, false));
  if (mixed) errors.push(`"${mixed}" mixes Latin with Cyrillic or Greek letters (a lookalike of a reserved word?)`);
  for (const { kind, sha, heading, tables, items, paras, prose } of sections(document.body, errors)) {
    const where = `"${heading}"`;
    if (!kind) {
      for (const t of tables) {
        // A "#" column or a Finding/Issue/Problem column: it may hold the open finding.
        if (t.header.includes('#') || t.header.some((h) => FINDING_COLS.includes(h))) {
          errors.push(`${where}: a findings table outside a review section (${t.header.join(' | ')})`);
        }
      }
      continue;
    }
    if (kind === 'dispositions') {
      if (paras.some((p) => p.startsWith('|'))) errors.push(`${where}: a table row outside a table (no header and delimiter row)`);
      const entries = [];
      if (!tables.length) errors.push(`${where}: no dispositions table`);
      for (const t of tables) {
        if (!needColumns(t, ['#', 'disposition'], where, errors)) continue;
        for (const row of t.rows) entries.push({ id: row['#'], disposition: disposition(row.disposition) });
      }
      dispositions.push({ sha, heading, entries });
      continue;
    }
    // A review holds only (allowlist, fail closed): a standalone "No findings." (a review
    // that is not NOT CLEAN), findings tables (a "#" column) with at least one row, and
    // prose with no "|" outside code. Anything else is an error, never skipped: a "|" in
    // text may be a finding row GitHub did not render as a table.
    const stray = prose.find((p) => p.includes('|'));
    if (stray) errors.push(`${where}: a table row outside a table ("|" in text; put a literal pipe in backticks): ${stray}`);
    if (items.length) errors.push(`${where}: a list item in a review section (findings go in the table): ${items[0]}`);
    for (const t of tables) {
      if (!t.header.includes('#')) errors.push(`${where}: a table without a "#" column in a review section (only findings tables): ${t.header.join(' | ')}`);
    }
    const findingTables = tables.filter((t) => t.header.includes('#'));
    const noFindings = paras.some((p) => NO_FINDINGS.test(p));
    // A CLEAN review (headed CLEAN, or "No findings.") that says NOT CLEAN in its prose
    // contradicts itself: which one holds is for a person to read.
    const clean = noFindings || (CLEAN.test(heading) && !NOT_CLEAN.test(heading));
    const notClean = clean && prose.find((p) => NOT_CLEAN.test(p));
    if (notClean) errors.push(`${where}: a CLEAN review that says NOT CLEAN in its text: ${notClean}`);
    if (noFindings) {
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
    if (!noFindings && findingTables.length && !findings.length) {
      errors.push(`${where}: a findings table with no finding rows (a review with nothing to report says "No findings.")`);
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
 * ({ isResolved, where, url, body }). Returns { exit, open, errors, skipped, dispositions,
 * reviews, findings }; `dispositions` lists each dispositions comment's sha, author and
 * url so who cleared which findings is visible (any commenter may: see the trust note in
 * .github/pull_request_template.md). Any error, or no review at all, is inconclusive: the open list may then be
 * incomplete, so it never reads as PASS. Minimized comments are skipped (the override for
 * a comment the parser must not read) and returned in `skipped` so the bypass is visible.
 */
export function evaluate({ comments, threads }) {
  const errors = [];
  const reviews = [];
  const visible = [];
  const skipped = [];
  const dispositions = [];
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
      dispositions.push({ sha: disp.sha, author: c.author ?? '(unknown)', url: c.url });
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
  return { exit, open, errors, skipped, dispositions, reviews: reviews.length, findings };
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
  for (const d of result.dispositions) log(`DISPOSITIONS for ${d.sha} by ${d.author}: ${d.url}`);
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
