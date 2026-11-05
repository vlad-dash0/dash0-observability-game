// PR findings detector (#35): has every review finding on a PR been dispositioned?
// Reads the PR's issue comments, review bodies and review threads through `gh api graphql`
// (every page) and parses each comment as GitHub renders it (`bodyHTML`, read with
// linkedom): sections are <h2> elements and findings and dispositions are <table>
// elements, so text in code, an HTML comment or anything else GitHub does not render as a
// heading or table is never read as one. The comment formats are documented in
// .github/pull_request_template.md. It fails closed: a table is allowed only inside a
// recognised section (review, dispositions, pre-merge audit), inside a review section
// only the recognised content is allowed, outside one any text naming a review form is an
// error, and a disposition counts only in a positive form. The PR body is not read.
// Prints each finding that has no disposition and who posted each dispositions comment;
// minimized (hidden) comments are skipped and listed. Only comments and threads by the
// repo's owner, members and collaborators are read; anyone else's are ignored and listed.
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
// A read-only audit section: it carries no findings, and its only table is "Gate | Result".
const AUDIT = new RegExp(String.raw`^pre-merge\s+audit\s+at\s+${SHA}\s*$`, 'i');
const AUDIT_COLS = ['gate', 'result'];
// NOT CLEAN in plain ASCII: the words in any case with whitespace between ("not clean"
// in prose included, as before), or in capitals glued or joined by "_"/"-" ("NOTCLEAN",
// "NOT_CLEAN", "NOT-CLEAN"). Any other spelling of it is a disguise: see disguises().
const NOT_CLEAN = { test: (t) => /\bnot\s+clean\b/i.test(t) || /(?<![A-Za-z0-9])NOT[\s_-]*CLEAN(?![A-Za-z0-9])/.test(t) };
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
// "Review notes", "Reviewer's Guide", "Findings from QA" (no table may follow them), and
// "Pre-merge audit at <sha>", which is its own read-only section.
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
// A disposition counts only in a positive form (allowlist): it starts with a verdict, or it
// names a commit (7-40 hex digits with at least one digit) or an issue or PR ("#12").
// Anything else ("TODO later", "pending review", "Reworded") leaves the finding open.
const VERDICT = /^(?:fixed|won['\u2019]?t\s+fix|by\s+design|false\s+positive|not\s+a\s+bug|deferred\s+to\s+#\d+|documented|duplicate\s+of|out\s+of\s+scope|accepted)(?![\p{L}\p{N}])/iu;
const COMMIT_REF = /(?<![0-9a-z])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}(?![0-9a-z])/i;
const ISSUE_REF = /(?<![\p{L}\p{N}&])#\d+(?![\p{L}\p{N}])/u;

// Latin lookalikes folded to their ASCII letter: Cyrillic and Greek letters that look
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

// Latin letters with a stroke or bar, which NFKD does not decompose.
const STROKE = Object.fromEntries(['Øo', 'øo', 'Łl', 'łl', 'Đd', 'đd', 'Ðd', 'ðd', 'Ħh', 'ħh', 'Ŧt', 'ŧt',
  'Ɨi', 'ɨi', 'Ƶz', 'ƶz', 'Ƀb', 'ƀb', 'ıi', 'ȷj', 'Ɉj', 'ɉj', 'Ꝋo', 'ꝋo'].map((pair) => [...pair]));
// Letters of the alphabets lookalikes come from: one that does not fold to ASCII is a
// wildcard ("?") in the skeleton, so an unlisted lookalike still spells the word.
const WILD = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Cherokee}\p{Script=Coptic}\p{Script=Lisu}]/u;

/**
 * The skeleton of s, what it spells whatever the letters look like: each code point is
 * NFKD-decomposed, its marks (\p{M}) stripped, lookalikes and stroke letters folded to
 * ASCII, lowercased, and only [a-z0-9] kept (a lookalike-alphabet letter that folds to
 * nothing becomes "?"). Returns { sk, at }: at[i] is the [start, end) in s of the code
 * point that sk[i] came from.
 */
export function skeleton(s) {
  let sk = '';
  const at = [];
  for (const m of s.matchAll(/./gsu)) {
    for (const d of m[0].normalize('NFKD').replace(/\p{M}/gu, '')) {
      let out = (CONFUSABLE[d] ?? STROKE[d] ?? d).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!out && /\p{L}/u.test(d) && WILD.test(d)) out = '?';
      for (const c of out) {
        sk += c;
        at.push([m.index, m.index + m[0].length]);
      }
    }
  }
  return { sk, at };
}

// Reserved skeletons. 'part': found anywhere, even inside a longer word ("Rеviewers").
// 'word': a whole word ("fóund", not "Problème"). 'phrase': starts a word and may span
// words ("NØT CLEAN"). "reviewof" counts only before a sha ("Review öffentlich" is prose).
const RESERVED_SKELETONS = [
  ...['review', 'clean', 'disposition', 'finding'].map((w) => ({ w, mode: 'part' })),
  ...['found', 'problem', 'problems', 'issue', 'issues', 'bug', 'bugs'].map((w) => ({ w, mode: 'word' })),
  ...['notclean', 'rereview', 'independentreview'].map((w) => ({ w, mode: 'phrase' })),
  { w: 'reviewof', mode: 'phrase', then: /^[0-9a-f]{7,40}/ },
];
const WORDISH = String.raw`\p{L}\p{M}\p{Cf}`;
const GAP = new RegExp(`[^${WORDISH}]`, 'u');
const GAPS = new RegExp(`[^${WORDISH}]+`, 'u');
// A letter or mark that is not ASCII: a lookalike, an accent, U+FE0F, a stroke letter.
const FOREIGN = /(?![\x00-\x7f])[\p{L}\p{M}]/u;
// A cross-script lookalike: after NFKD and marks stripped, a letter folded by CONFUSABLE
// (Cyrillic, Greek, Latin small capitals), a letter of another script, or a letter that
// folds to nothing (a wildcard). A Latin letter with a diacritic or stroke is not one.
const crossScript = (span) => [...span.normalize('NFKD').replace(/\p{M}/gu, '')].some((d) =>
  d in CONFUSABLE || (/\p{L}/u.test(d) && (!/\p{Script=Latin}/u.test(d)
    || !(STROKE[d] ?? d).toLowerCase().replace(/[^a-z0-9]/g, ''))));

/**
 * Every reserved word or phrase in s (text outside code) that is spelled other than in
 * plain ASCII: its skeleton matches a reserved skeleton (at most one wildcard, none in a
 * word shorter than 5 letters) and the matched text holds a non-ASCII letter or mark, or
 * is letter-spaced (two or more single letters between gaps). Plain-ASCII spellings are
 * left to the reserved-form patterns, so honest prose reads as before. Returns
 * [{ span, w }].
 */
export function disguises(s) {
  const { sk, at } = skeleton(s);
  const out = [];
  for (const { w, mode, then } of RESERVED_SKELETONS) {
    for (let i = 0; i + w.length <= sk.length; i++) {
      let wild = 0;
      let k = 0;
      for (; k < w.length; k++) {
        if (sk[i + k] === '?') wild++;
        else if (sk[i + k] !== w[k]) break;
      }
      if (k < w.length || wild > (w.length >= 5 ? 1 : 0)) continue;
      if (then && !then.test(sk.slice(i + w.length))) continue;
      const start = at[i][0];
      let end = at[i + w.length - 1][1];
      for (let c; end < s.length && /[\p{M}\p{Cf}]/u.test(c = String.fromCodePoint(s.codePointAt(end)));) end += c.length;
      const span = s.slice(start, end);
      const crossing = GAP.test(span);
      const wordBefore = /[\p{L}\p{M}]\p{Cf}*$/u.test(s.slice(Math.max(0, start - 8), start));
      if ((crossing || mode !== 'part') && wordBefore) continue;
      if (mode === 'word' && /^\p{L}/u.test(s.slice(end))) continue;
      // Letter-spaced: two or more one-letter pieces ("N O T"), not a plural "Issue(s)".
      const spaced = crossing && span.split(GAPS).filter((r) => (r.match(/\p{L}/gu) ?? []).length === 1).length >= 2;
      // A phrase ("NÖT CLEAN") is flagged for any non-ASCII letter or mark; a single word
      // ("problém", "Préviewed") only for a cross-script lookalike ("Rеview", Cyrillic е).
      if ((mode === 'phrase' ? FOREIGN.test(span) : crossScript(span)) || spaced) out.push({ span, w });
    }
  }
  return out;
}

// Raw text of a node, a <br> as a newline; code and pre left out when `code` is false,
// struck-through text (del, s, strike) when `struck` is false.
function raw(node, code = true, struck = true) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.localName === 'br') return '\n';
  if (!code && (node.localName === 'code' || node.localName === 'pre')) return '';
  if (!struck && ['del', 's', 'strike'].includes(node.localName)) return '';
  let s = '';
  for (const c of node.childNodes) s += raw(c, code, struck);
  return s;
}
const text = (el) => normalize(raw(el));
// Text outside code with each block on its own line, so blocks never run together.
function blocks(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1 || node.localName === 'code' || node.localName === 'pre') return '';
  if (node.localName === 'br') return '\n';
  let s = '';
  for (const c of node.childNodes) s += blocks(c);
  return INLINE.has(node.localName) ? s : `\n${s}\n`;
}
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
  const cellsOf = (tr, f = text) => [...tr.children].filter((c) => c.localName === 'td' || c.localName === 'th').map(f);
  const header = trs.length ? cellsOf(trs[0]).map((h) => h.toLowerCase()) : [];
  const rows = [];
  // Each row's cells without struck-through text ("~~Fixed~~" is not a verdict).
  const unstruck = [];
  for (const tr of trs.slice(1)) {
    const row = cellsOf(tr);
    if (row.length !== header.length) {
      errors.push(`${where}: row has ${row.length} cells, header has ${header.length}: ${row.join(' | ')}`);
      continue;
    }
    const kept = cellsOf(tr, (c) => normalize(raw(c, true, false)));
    rows.push(Object.fromEntries(header.map((h, k) => [h, row[k]])));
    unstruck.push(Object.fromEntries(header.map((h, k) => [h, kept[k]])));
  }
  return { header, rows, unstruck };
}

// Phrasing (inline) elements: a run of these and bare text between blocks is one text
// block. Any other element is a block, walked in turn, so no text sits outside the walk.
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'font', 'g-emoji', 'i', 'img', 'input', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr']);
const inline = (n) => n.nodeType === 3 || (n.nodeType === 1 && INLINE.has(n.localName));

// Sections split at <h1>/<h2> in document order (one in a blockquote counts); each is
// { kind, sha, heading, tables, items, paras, prose } with kind 'review', 'dispositions',
// 'audit' (read-only; its text is checked as if outside a section) or null. Fail closed: outside a review section, every text block (paragraph, list item,
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
    if (cur().kind && cur().kind !== 'audit') return;
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
        const a = !d && !r && AUDIT.exec(t);
        if (!d && !r && !a && reserved(t)) {
          errors.push(`"## ${t}": unrecognised review heading (expected "Review of <sha>" or "Dispositions for the review of <sha>")`);
        }
        const kind = d ? 'dispositions' : r ? 'review' : a ? 'audit' : null;
        open(kind, kind ? (d || r || a)[1].toLowerCase() : undefined, `## ${t}`);
      } else if (level) {
        const t = text(child);
        if (level === 1) open(null, undefined, `# ${t}`);
        headingLike(t, `a level-${level} heading`);
        cur().prose.push(proseText(child));
      } else if (name === 'table') {
        // Structure, not words: a table is read only inside a recognised section, and a
        // table inside a table is never read, so either is an error.
        const where = `"${cur().heading}"`;
        if (child.querySelector('table')) errors.push(`${where}: a table inside a table`);
        cur().tables.push(table(child, where, errors));
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

// `cell` as normalized; `kept` the cell without struck-through text. Returns the cell if
// it is a disposition (a positive form), else null.
function disposition(cell, kept) {
  const t = (kept ?? '').replace(/[*_`~]/g, '').trim().replace(/[.!,;:]+$/, '').trim();
  return VERDICT.test(t) || COMMIT_REF.test(t) || ISSUE_REF.test(t) ? cell : null;
}
const dispositionOf = (t, j) => disposition(t.rows[j].disposition, t.unstruck[j].disposition);

/** Parse one comment's rendered HTML (bodyHTML) into the reviews and dispositions it declares. */
export function parseComment(html) {
  const reviews = [];
  const dispositions = [];
  const errors = [];
  if (typeof html !== 'string') return { reviews, dispositions, errors: ['no rendered body (bodyHTML)'] };
  if (!parseHTML) throw new Error(`linkedom is not installed (run npm ci): ${domError.message}`);
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const seen = new Set();
  for (const { span, w } of disguises(blocks(document.body))) {
    const shown = span.replace(/\s+/g, ' ').trim();
    if (seen.has(shown)) continue;
    seen.add(shown);
    errors.push(`"${shown}" spells the reserved "${w}" with non-ASCII letters, marks or letter-spacing (write it in plain ASCII)`);
  }
  for (const { kind, sha, heading, tables, items, paras, prose } of sections(document.body, errors)) {
    const where = `"${heading}"`;
    if (!kind) {
      // Any table outside a recognised section may hold an open finding, whatever its
      // columns are called.
      for (const t of tables) {
        errors.push(`${where}: a table outside a review, dispositions or pre-merge audit section (${t.header.join(' | ')})`);
      }
      continue;
    }
    if (kind === 'audit') {
      // Read-only: its only table is "Gate | Result"; it carries no findings.
      for (const t of tables) {
        if (t.header.join('|') !== AUDIT_COLS.join('|')) {
          errors.push(`${where}: an audit table other than "Gate | Result" (${t.header.join(' | ')})`);
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
        for (const [j, row] of t.rows.entries()) {
          entries.push({ id: row['#'], disposition: dispositionOf(t, j) });
        }
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
      for (const [j, row] of t.rows.entries()) {
        findings.push({
          id: row['#'],
          severity: row.severity ?? '',
          finding: row.finding,
          disposition: combined ? dispositionOf(t, j) : null,
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
 * url so who cleared which findings is visible (fetchPr passes only trusted authors' comments:
 * see the trust note in .github/pull_request_template.md). Any error, or no review at all, is inconclusive: the open list may then be
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

/** Run `gh` with `args` (no shell); resolves stdout. tools/pr-findings-status.mjs uses it too. */
export function defaultGh(args) {
  return new Promise((done, fail) => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? fail(new Error(stderr.trim() || err.message)) : done(stdout));
  });
}

const NODES = {
  comments: 'createdAt lastEditedAt isMinimized url bodyHTML author { login } authorAssociation',
  reviews: 'submittedAt createdAt lastEditedAt isMinimized url bodyHTML author { login } authorAssociation',
  reviewThreads: 'isResolved path line comments(first: 1) { nodes { body url author { login } authorAssociation } }',
};

// The repo is public: only comments (and threads, by their first comment) from people with
// write access to it count for the verdict. Anyone else's are ignored, and listed, so they
// can neither clear a finding nor block a merge: an ignored review never makes the result
// inconclusive. A node with no association is a response the detector cannot read: error.
export const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
function trusted(node, url) {
  const assoc = node?.authorAssociation;
  if (typeof assoc !== 'string' || !assoc) throw new Error(`${url}: no author association`);
  return TRUSTED.has(assoc);
}
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
 * Every issue comment, non-empty review body and review thread on the PR from a trusted
 * author (TRUSTED); the rest are returned in `ignored` ({ kind, url, author, association }).
 * A missing bodyHTML is passed on as is (not as ''), so the parser reports it.
 */
export async function fetchPr({ repo, pr, gh = defaultGh }) {
  const [issueComments, reviews, threads] = await Promise.all(
    ['comments', 'reviews', 'reviewThreads'].map((key) => connection(gh, repo, pr, key)));
  const ignored = [];
  const keep = (kind, node, url, author) => {
    if (trusted(node, url)) return true;
    ignored.push({ kind, url, author: author ?? '(unknown)', association: node.authorAssociation });
    return false;
  };
  const comment = (at, c) => ({ at, edited: c.lastEditedAt ?? null, minimized: c.isMinimized === true, author: c.author?.login ?? '(unknown)', url: c.url, html: c.bodyHTML });
  const bodies = [
    ...issueComments.map((c) => [c, c.createdAt]),
    ...reviews.filter((r) => typeof r.bodyHTML !== 'string' || r.bodyHTML.trim())
      .map((r) => [r, r.submittedAt ?? r.createdAt]),
  ];
  return {
    comments: bodies.filter(([c]) => keep('comment', c, c.url, c.author?.login)).map(([c, at]) => comment(at, c)),
    threads: threads.filter((t) => {
      const first = t.comments?.nodes?.[0];
      return keep('thread', first, first?.url ?? `${t.path}:${t.line ?? '?'}`, first?.author?.login);
    }).map((t) => ({
      isResolved: t.isResolved === true,
      where: `${t.path}:${t.line ?? '?'}`,
      url: t.comments?.nodes?.[0]?.url ?? '',
      body: t.comments?.nodes?.[0]?.body ?? '',
    })),
    ignored,
  };
}

const oneLine = (s, n = 120) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Fetch, decide and print. Returns the exit code; never throws. */
export async function run({ repo, pr, gh = defaultGh, log = console.log }) {
  let result;
  let ignored;
  try {
    if (!/^\d+$/.test(String(pr))) throw new Error(`not a PR number: ${pr}`);
    const slug = repo ?? (await gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error(`not an owner/name repo: ${slug}`);
    log(`PR ${slug}#${pr}`);
    const fetched = await fetchPr({ repo: slug, pr, gh });
    ignored = fetched.ignored;
    result = evaluate(fetched);
  } catch (err) {
    log(`INCONCLUSIVE: ${err.message}`);
    return EXIT.INCONCLUSIVE;
  }
  for (const i of ignored) log(`IGNORED untrusted ${i.kind} by ${i.author} (${i.association}): ${i.url}`);
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
