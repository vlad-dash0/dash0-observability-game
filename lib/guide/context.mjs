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
/** A configure value this long (skeleton) is distinctive enough to filter on by itself. */
const LONG_VALUE = 7;
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

/** `text` as plain NFKC text with no format characters (zero-width joiners and the like), case kept, line breaks kept. */
const clean = (text) => plain(text).normalize('NFKC').replace(/\p{Cf}/gu, '');

/**
 * What two texts are compared as, the skeleton: clean, lowercase, every run of anything that is not a letter or a
 * digit one space. So `**routing_key**: traceID`, "routing key traceid" and `Routing-Key = TraceID` are one text.
 */
const skel = (text) => clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether the skeleton `needle` is in the skeleton `hay`, starting at a word. */
function mention(hay, needle) {
  return count(hay, needle) > 0;
}

/** How many times the skeleton `needle` starts a word in the skeleton `hay`; a word may go on ("link" is in "links") unless `needle` is a number ("630" is not "6301"). */
function count(hay, needle) {
  const end = /^\d+$/.test(needle) ? ' ' : '';
  return ` ${hay} `.split(` ${needle}${end}`).length - 1;
}

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

/** Words too common to filter on alone: a neutral hint says them ("which service starts the request"). */
const STOP = new Set(
  (
    'about above after again also another because been before being between both cannot could does doing done each either ' +
    'else even ever every first from have here into just keep keeps like look made make makes many more most much must ' +
    'need needs next none only other over same should some still such than that their them then there these they thing ' +
    'this those under until upon used uses using very want well were what when where which while whole will with within ' +
    'without would your question answer hint think read check step steps line lines level game option options ' +
    // the game's own everyday vocabulary, which any hint uses ("which service starts the request")
    'service services request requests start starts begin begins end ends send sends call calls change changes engineer ' +
    'signal signals pipeline pipelines trace traces metric metrics collector error errors data value values name names ' +
    'time alert query label labels attribute attributes setting settings component components'
  ).split(' '),
);

/** The distinctive words of `label`: 4+ letters or 3+ digits, not a stop word, in none of the `others` labels. */
function distinctive(label, others) {
  const seen = new Set(others.flatMap((o) => skel(o).split(' ')));
  const keep = (w) => !seen.has(w) && !STOP.has(w) && (/^\d+$/.test(w) ? w.length >= 3 : w.length >= 4);
  return [...new Set(skel(label).split(' ').filter(keep))];
}

/** The first sentence of a log body as a skeleton, cut to a length a reply would plausibly quote. */
const excerpt = (body) => skel(clean(body).split(SENTENCE_END)[0]).slice(0, EXCERPT).trim();

/** Skeletons of the parenthesised sub-expressions of `query` that hold a call or a selector (not a bare name), outermost first, in order of their opening bracket. */
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
  return found
    .sort((a, b) => a[0] - b[0])
    .filter(([, inner]) => /[([{]/.test(inner))
    .map(([, inner]) => skel(inner));
}

/**
 * The scalar leaves of a parsed config as `{bag, pair, single}`: arrays are bags (an item's index says nothing);
 * a leaf is the pair `[key, value]` (an array item under its array's key), a null leaf (a component defined with
 * no settings) is `[section, key]`, or the bare key at the top. Prose states a setting as "set key to value" or
 * "list value under key", never as `key: value`, so a pair is matched within one sentence, not as a literal.
 */
function leaves(doc) {
  const out = [];
  const walk = (value, path, key, section) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], key, section));
    else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k], k, key);
    else {
      const bag = `${path.map((p) => (typeof p === 'number' ? '#' : p)).join('/')}=${String(value)}`;
      if (value !== null) out.push({ bag, pair: [key, String(value)], value: String(value) });
      else if (section === '') out.push({ bag, single: key });
      else out.push({ bag, pair: [section, key], defined: true });
    }
  };
  walk(doc, [], '', '');
  return out;
}

const SPAN_NAME_NONE = ['no span', 'any span', 'outside a span', 'not in a span', 'without a span', 'no trace'];

/** What to look for in a reply, per step type: `{singles, pairs}` of raw texts. */
const TOKENS = {
  choice: (spec) => {
    const right = spec.choices.find((c) => c.right).label;
    return { singles: [right, ...distinctive(right, spec.choices.filter((c) => !c.right).map((c) => c.label))], pairs: [] };
  },
  incident: (spec) => {
    const right = spec.hypotheses.find((h) => h.right === true).label;
    return { singles: [right, ...distinctive(right, spec.hypotheses.filter((h) => h.right !== true).map((h) => h.label))], pairs: [] };
  },
  spot: (spec) => {
    const faults = spec.lines.filter((l) => spec.faults.includes(l.id)).map((l) => l.text);
    const others = spec.lines.filter((l) => !spec.faults.includes(l.id)).map((l) => l.text);
    return { singles: [...faults, ...faults.flatMap((f) => distinctive(f, others))], pairs: [] };
  },
  sort: (spec) => ({ singles: [], pairs: spec.items.map((i) => [i.label, spec.buckets.find((b) => b.id === i.bucket).label]) }),
  tradeoff: (spec) => {
    // An option's head is its label up to the first colon, before the arithmetic. A reply names the option by the
    // head, or by the words only it has among its knob's options ("keep the default parentbased_always_on").
    const head = (label) => {
      const h = skel(plain(label).split(':')[0]);
      return h.length >= MIN_TOKEN ? h : skel(label);
    };
    const all = spec.knobs.flatMap((k) => k.options);
    const singles = [];
    const pairs = [];
    for (const k of spec.knobs) {
      const right = k.options.find((o) => o.id === spec.answer[k.id]);
      const mine = head(right.label);
      if (!all.some((o) => o !== right && mention(head(o.label), mine))) singles.push(mine);
      const rivals = k.options.filter((o) => o !== right).map((o) => head(o.label));
      const knob = [k.label, ...distinctive(k.label, spec.knobs.filter((x) => x !== k).map((x) => x.label))];
      for (const part of knob) for (const what of [mine, ...distinctive(mine, rivals)]) pairs.push([part, what]);
    }
    return { singles, pairs };
  },
  build: (spec) => {
    const text = namer(spec.spans, (x) => x).text;
    const byId = (id) => spec.spans.find((s) => s.spanId === id);
    // A span is stated by its display name ("charge card (payments)") or by its bare span.name, which twins share:
    // both forms are matched, each against the same form of the other end.
    const forms = (id) => [text(byId(id)), byId(id).name];
    const pairs = [];
    const add = (id, targets) => {
      forms(id).forEach((me, k) => targets.forEach((t) => pairs.push([me, t[k]])));
    };
    const plainly = (words) => words.map((w) => [w, w]);
    if (isLogMode(spec)) {
      for (const [id, spanId] of Object.entries(spec.answer)) {
        const body = excerpt(spec.logs.find((l) => l.id === id).body);
        for (const t of spanId === null ? plainly(SPAN_NAME_NONE) : [forms(spanId)]) for (const k of [0, 1]) pairs.push([body, t[k]]);
      }
      return { singles: [], pairs };
    }
    for (const [id, want] of Object.entries(spec.answer)) {
      if (has(want, 'parentId')) add(id, want.parentId === null ? plainly(['root', 'no parent', 'top level']) : [forms(want.parentId)]);
      if (has(want, 'kind')) add(id, plainly([want.kind]));
      if (has(want, 'status')) add(id, plainly([want.status]));
      if (has(want, 'links')) {
        if (want.links.length === 0) add(id, plainly(['link']));
        for (const l of want.links) add(id, [forms(l)]);
      }
    }
    return { singles: [], pairs };
  },
  query: (spec) => {
    const given = skel(spec.given ?? '');
    const whole = skel(spec.reference);
    const subs = subExpressions(spec.reference).filter((s) => s.length >= 8 && !given.includes(s));
    return { singles: [whole, ...new Set(subs)], pairs: [] };
  },
  configure: (spec) => {
    const [ref, given] = [spec.reference, spec.given].map((y) => {
      const parsed = parseYaml(y);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return leaves(parsed.doc);
    });
    const had = new Set(given.map(({ bag }) => bag));
    const known = skel(spec.given);
    // A component defined anew under a key the player already sees it listed under ("extensions: [health_check]") says nothing more.
    const lines = spec.given.split('\n').map(skel);
    const seen = ({ pair, defined }) => defined && lines.some((l) => together(l, pair.map(skel)));
    const fresh = ref.filter((leaf) => !had.has(leaf.bag) && !seen(leaf));
    const singles = fresh.flatMap(({ single, value }) => [single, value].filter((v) => v !== undefined && skel(v).length >= LONG_VALUE && !mention(known, skel(v))));
    return { singles, pairs: fresh.filter(({ pair }) => pair).map(({ pair }) => pair), soft: true };
  },
};

/**
 * What a reply must not contain for this step, as `{singles, pairs}` of skeletons (a single is a word-start
 * substring to find, a pair is two to find in one sentence), or null when there is no trustworthy set: a token
 * under 3 characters, no token at all, or a spec it cannot read. Null means the guide refuses the step; it never
 * means "nothing to withhold". A configure value may be short ("10", "on") when its key is not: the key anchors it.
 */
export function answerTokens(type, spec) {
  try {
    if (!has(TOKENS, type?.key)) return null;
    const raw = TOKENS[type.key](spec);
    const singles = [...new Set(raw.singles.map(skel))];
    const pairs = [...new Set(raw.pairs.map((p) => p.map(skel).join('\u0000')))].map((p) => p.split('\u0000'));
    const parts = [...singles, ...pairs.flatMap((p) => (raw.soft ? p.slice(0, 1) : p))];
    if (singles.length + pairs.length === 0 || parts.some((t) => t.length < MIN_TOKEN)) return null;
    if (raw.soft && pairs.some((p) => p[1] === '')) return null;
    return { singles, pairs };
  } catch {
    return null;
  }
}

/**
 * Whether both parts of `pair` are in `sentence`. When one part contains the other (a knob "Traces" and an option
 * "Head-sample traces"), the longer is taken out first, so the shorter has to appear on its own; two equal parts
 * (a span and its twin) must appear twice.
 */
function together(sentence, [a, b]) {
  if (a === b) return count(sentence, a) >= 2;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (!mention(sentence, long)) return false;
  const end = /^\d+$/.test(long) ? ' ' : '';
  return mention(` ${sentence} `.split(` ${long}${end}`).join('  ').trim(), short);
}

const LIST_LINE = /^[^\S\n]*(?:[-*+\u2022\u2013\u2014]|\d+[.)])\s/m;
const TABLE_LINE = /^[^\S\n]*\|/m;

/**
 * Whether `reply` must be withheld: it contains a single token, or both parts of a pair in one sentence (sentences
 * end at . ! ? before a space or the end, or at a line break), or a code fence, a list line or a table line (the
 * prompt allows plain sentences only). Compared as skeletons. `tokens` is answerTokens' result; null, or a set
 * with nothing in it, is a TypeError, never a pass. A reply that is not text is withheld.
 */
export function withholds(reply, tokens) {
  if (tokens === null || typeof tokens !== 'object' || !Array.isArray(tokens.singles) || !Array.isArray(tokens.pairs)) {
    throw new TypeError('withholds needs answer tokens; a step without them has no guide');
  }
  if (tokens.singles.length + tokens.pairs.length === 0) throw new TypeError('withholds needs at least one token; an empty set is no filter');
  if (typeof reply !== 'string' || /```|~~~/.test(reply) || LIST_LINE.test(reply) || TABLE_LINE.test(reply)) return true;
  const text = clean(reply);
  const flat = skel(text);
  if (tokens.singles.some((t) => mention(flat, t))) return true;
  const sentences = text.split(SENTENCE_END).map(skel);
  return tokens.pairs.some((pair) => sentences.some((s) => together(s, pair)));
}
