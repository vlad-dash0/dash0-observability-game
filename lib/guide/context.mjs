// Ask the guide (#17), the pure core: which steps the guide may speak on, what it is told about
// a step (only what the player can see, never the answer), and the filter that keeps a reply
// from handing the answer out anyway. No DOM, no fetch, no state; the server (api/guide.mjs)
// and the panel both build on it. Design: the issue #17 comment "Ask the guide".

import { STEP_TYPES } from '../play.mjs';
import { namer } from '../widgets/build-it-names.mjs';
import { isLogMode } from '../widgets/build-it.mjs';
import { parseYaml } from '../configure/parse.mjs';
import { getDataset } from '../promql/datasets.mjs';

/** A token shorter than this (after normalizing) matches too much to filter on. */
const MIN_TOKEN = 3;
/** How much of a log body stands for it in a token. */
const EXCERPT = 40;
const NO_SPAN = 'no span';
const SENTENCE_END = /[.!?](?=\s|$)|\n/;

// ---- text ----

const BLOCK_TAGS = /<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|pre|h[1-6])\b[^>]*>/gi;
const ANY_TAG = /<\/?[a-zA-Z][^>]*>/g;
const ENTITIES = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/** `html` as plain text: block tags become line breaks, other tags vanish, basic entities decode. */
function plain(html) {
  const text = String(html).replace(BLOCK_TAGS, '\n').replace(ANY_TAG, '');
  return text.replace(/&(?:nbsp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]).replace(/&amp;/g, '&');
}

/** What two texts are compared as: plain, lowercase, no backticks or quotes, whitespace collapsed (line breaks kept). */
function normalize(text) {
  return plain(text)
    .toLowerCase()
    .replace(/[`'"‘’“”]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** A token's form: normalized onto one line. */
const form = (text) => normalize(text).replace(/\s+/g, ' ');

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const has = (o, k) => Object.hasOwn(o, k);

// ---- steps ----

/** The step of `level` whose widget id is `stepId`, as `{type, spec, step}`; null for a run level or an unknown id. */
export function findStep(level, stepId) {
  const steps = level?.play?.steps;
  if (!Array.isArray(steps) || typeof stepId !== 'string') return null;
  for (const step of steps) {
    const type = STEP_TYPES[Object.keys(STEP_TYPES).find((k) => has(step, k))];
    const spec = step[type.key];
    if (type.idOf(spec) === stepId) return { type, spec, step };
  }
  return null;
}

/**
 * Whether the guide may speak on this step: a choice step always, any other only when its Hint button
 * shows (`type.hints(spec) === true`). The one rule, for the server and the panel.
 */
export function guideAllowed(type, spec) {
  return type.key === 'choice' || type.hints?.(spec) === true;
}

// ---- what the guide is told ----

/** The lines the player can see for each widget; never the answer. Options are sorted so their order says nothing. */
const SEEN = {
  choice: (spec) => spec.choices.map((c) => `Option: ${plain(c.label)}`).sort(byText),
  sort: (spec) => [
    ...spec.buckets.map((b) => `Bucket: ${plain(b.label)}`),
    ...spec.items.map((i) => `Item: ${plain(i.label)}`).sort(byText),
  ],
  build: (spec) => {
    const text = namer(spec.spans, (x) => x).text;
    const spans = spec.spans.map((s) => `Span: ${text(s)}`);
    if (isLogMode(spec)) return ['You can change: which span each log record belongs to', ...spans, ...spec.logs.map((l) => `Log: ${plain(l.body)}`)];
    const name = (id) => text(spec.spans.find((s) => s.spanId === id));
    const list = (ids) => (ids.length ? ids.map(name).join(', ') : 'none');
    return [
      `You can change: ${spec.edit.join(', ')}`,
      ...spec.spans.map(
        (s) => `Span: ${text(s)}; parent: ${s.parentId === null ? 'none' : name(s.parentId)}; kind: ${s.kind}; status: ${s.status}; links: ${list(s.links)}`,
      ),
    ];
  },
  incident: (spec) => [
    `Alert: ${plain(spec.alert.title)}`,
    ...spec.views.map((v) => `View: ${plain(v.label)}`).sort(byText),
    ...spec.hypotheses.map((h) => `Hypothesis: ${plain(h.label)}`).sort(byText),
  ],
  spot: (spec) => [`Kind of text: ${spec.target}`, ...spec.lines.map((l) => `Line: ${l.text}`)],
  tradeoff: (spec) => [
    `Budget: ${spec.cap} ${spec.unit}`,
    ...spec.knobs.flatMap((k) => [
      `Knob: ${plain(k.label)}`,
      ...k.options.map((o) => `Option: ${plain(o.label)} (costs ${o.cost} ${spec.unit})`).sort(byText),
    ]),
    ...spec.needs.map((n) => `Need: ${plain(n.label)}`),
  ],
  query: (spec) => [
    `Dataset: ${getDataset(spec.dataset).title} (${spec.dataset})`,
    `The query runs at t = ${spec.at} s`,
    ...(spec.given === undefined ? [] : [`Starting query: ${spec.given}`]),
  ],
  configure: (spec) => [`Schema: ${spec.schema}`, ...spec.given.split('\n').filter((l) => l.trim() !== '').map((l) => `| ${l.trimEnd()}`)],
};

/** Plain-text lines of `text` (an HTML fragment) with `label` in front of each, blanks dropped. */
const textLines = (label, text) =>
  plain(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => `${label}${l}`);

/**
 * The text the model is given for the step `found` (from findStep) of `level`: the level, the step's lesson,
 * lead-in, code and question, and what its widget shows the player. Never the right answer, the explanation or a hint.
 */
export function stepContext(level, { type, spec, step }) {
  if (!has(SEEN, type.key)) throw new TypeError(`no guide context for step type ${String(type.key)}`);
  const text = (v) => (typeof v === 'string' ? v : '');
  return [
    ...textLines('Level: ', text(level?.name)),
    ...textLines('About the level: ', text(level?.sub)),
    ...textLines('Lesson: ', text(step.intro)),
    ...textLines('', text(step.show)),
    ...text(step.code).split('\n').filter((l) => l.trim() !== '').map((l) => `Code: ${l}`),
    ...textLines('Question: ', text(step.question)),
    ...SEEN[type.key](spec),
  ];
}

// ---- what the guide must not say ----

/** The first sentence of a log body, cut to a length a reply would plausibly quote. */
const excerpt = (body) => form(body).split(SENTENCE_END)[0].slice(0, EXCERPT).trim();

/** Normalized parenthesised sub-expressions of `query`, outermost first, in order of their opening bracket. */
function subExpressions(query) {
  const open = [];
  const found = [];
  for (let i = 0; i < query.length; i++) {
    if (query[i] === '(') open.push(i);
    else if (query[i] === ')' && open.length) {
      const from = open.pop();
      found.push([from, query.slice(from + 1, i).trim()]);
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, inner]) => inner);
}

/**
 * The scalar leaves of a parsed config as `[bag, token]`: arrays are bags (an item's index says nothing); a leaf is
 * `key: value`, a null leaf (a component defined with no settings) is `section: key`, or the bare key at the top.
 */
function leaves(doc) {
  const out = [];
  const walk = (value, path, key, section) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], key, section));
    else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k], k, key);
    else {
      const bag = `${path.map((p) => (typeof p === 'number' ? '#' : p)).join('/')}=${String(value)}`;
      out.push([bag, value === null ? (section === '' ? key : `${section}: ${key}`) : `${key}: ${String(value)}`]);
    }
  };
  walk(doc, [], '', '');
  return out;
}

/** What to look for in a reply, per step type: `{singles, pairs}` of raw texts. */
const TOKENS = {
  choice: (spec) => ({ singles: [spec.choices.find((c) => c.right).label], pairs: [] }),
  incident: (spec) => ({ singles: [spec.hypotheses.find((h) => h.right === true).label], pairs: [] }),
  spot: (spec) => ({ singles: spec.lines.filter((l) => spec.faults.includes(l.id)).map((l) => l.text), pairs: [] }),
  sort: (spec) => ({ singles: [], pairs: spec.items.map((i) => [i.label, spec.buckets.find((b) => b.id === i.bucket).label]) }),
  tradeoff: (spec) => ({
    singles: [],
    pairs: spec.knobs.map((k) => [k.label, k.options.find((o) => o.id === spec.answer[k.id]).label]),
  }),
  build: (spec) => {
    const text = namer(spec.spans, (x) => x).text;
    const name = (id) => text(spec.spans.find((s) => s.spanId === id));
    const pairs = [];
    if (isLogMode(spec)) {
      for (const [id, spanId] of Object.entries(spec.answer)) {
        pairs.push([excerpt(spec.logs.find((l) => l.id === id).body), spanId === null ? NO_SPAN : name(spanId)]);
      }
      return { singles: [], pairs };
    }
    for (const [id, want] of Object.entries(spec.answer)) {
      const me = name(id);
      if (has(want, 'parentId')) pairs.push([me, want.parentId === null ? 'root' : name(want.parentId)]);
      if (has(want, 'kind')) pairs.push([me, want.kind]);
      if (has(want, 'status')) pairs.push([me, want.status]);
      if (has(want, 'links')) {
        if (want.links.length === 0) pairs.push([me, 'link']);
        for (const l of want.links) pairs.push([me, name(l)]);
      }
    }
    return { singles: [], pairs };
  },
  query: (spec) => {
    const given = form(spec.given ?? '');
    const whole = form(spec.reference);
    return { singles: [whole, ...new Set(subExpressions(whole).filter((s) => s.length >= 8 && !given.includes(s)))], pairs: [] };
  },
  configure: (spec) => {
    const [ref, given] = [spec.reference, spec.given].map((y) => {
      const parsed = parseYaml(y);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return leaves(parsed.doc);
    });
    const had = new Set(given.map(([bag]) => bag));
    return { singles: [...new Set(ref.filter(([bag]) => !had.has(bag)).map(([, token]) => token))], pairs: [] };
  },
};

/**
 * What a reply must not contain for this step, as `{singles, pairs}` of normalized texts (a single is a
 * substring to find, a pair is two substrings to find in one sentence), or null when there is no trustworthy
 * set: a token under 3 characters, no token at all, or a spec it cannot read. Null means the guide refuses
 * the step; it never means "nothing to withhold".
 */
export function answerTokens(type, spec) {
  try {
    if (!has(TOKENS, type?.key)) return null;
    const raw = TOKENS[type.key](spec);
    const singles = raw.singles.map(form);
    const pairs = raw.pairs.map((p) => p.map(form));
    const all = [...singles, ...pairs.flat()];
    if (all.length === 0 || all.some((t) => t.length < MIN_TOKEN)) return null;
    return { singles, pairs };
  } catch {
    return null;
  }
}

/**
 * Whether both parts of `pair` are in `sentence`. When one part contains the other (a knob "Traces" and an option
 * "Head-sample traces"), the longer is taken out first, so the shorter has to appear on its own.
 */
function together(sentence, [a, b]) {
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (!sentence.includes(long)) return false;
  return sentence.split(long).join(' ').includes(short);
}

/**
 * Whether `reply` must be withheld: it contains a single token, or both parts of a pair in one sentence
 * (sentences end at . ! ? before a space or the end, or at a line break), or a code fence. Compared normalized.
 * `tokens` is answerTokens' result; null (no trustworthy set) is a TypeError, never a pass. A reply that is not text is withheld.
 */
export function withholds(reply, tokens) {
  if (tokens === null || typeof tokens !== 'object' || !Array.isArray(tokens.singles) || !Array.isArray(tokens.pairs)) {
    throw new TypeError('withholds needs answer tokens; a step without them has no guide');
  }
  if (typeof reply !== 'string' || /```|~~~/.test(reply)) return true;
  const text = normalize(reply);
  const flat = text.replace(/\n/g, ' ');
  if (tokens.singles.some((t) => flat.includes(t))) return true;
  const sentences = text.split(SENTENCE_END);
  return tokens.pairs.some((pair) => sentences.some((s) => together(s, pair)));
}
