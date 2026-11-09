// Ask the guide (#17), the pure core: which steps the guide may speak on, what it is told about
// a step (only what the player can see, never the answer), and the filter that keeps a reply
// from handing the answer out anyway. No DOM, no fetch, no state; the server (api/guide.mjs)
// and the panel both build on it. Design: the issue #17 comment "Ask the guide".
//
// Known limits. The first guard is that the model is never shown the answer (stepContext). This filter is the
// second, best-effort guard: it catches a reply that states the answer in the answer's own words, however it is
// formatted, split or spelled (skeletons, pairs in one sentence, distinctive words, number words). It cannot catch
// a pure synonym or a description that uses none of the answer's words ("the TLS cert at the CDN lapsed"), and it
// leaves everyday vocabulary alone on purpose, so a mentor hint is not withheld for saying "service" or "request". The other direction is safe over-blocking: any
// ordinary word of 10 or more letters in the right answer ("measurement") is treated as a compound and withheld alone.

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
/** A distinctive word of this many characters is a compound, rare enough to filter on alone. */
const COMPOUND = 10;
/** Two distinctive words in one sentence are a statement only when each is this long: "wrong" and "share" are a hint's words. */
const PAIR_WORD = 6;
/** A single this long (spaces removed) is also looked for in the reply with its spaces removed: "delta to cumulative". */
const PACKED = 8;
/** A sentence that has one of these in its first three words goes with the one before it. */
const FOLLOWS = /^(?:\S+ ){0,2}(?:it|they|this|that|these)(?: |$)/;
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
const skel = (text) =>
  numberWords(
    clean(text)
      .toLowerCase()
      .replace(/(\d)[.,](?=\d)/g, '$1')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim(),
  );

const UNITS = Object.fromEntries(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ').map((w, i) => [w, i]),
);
const TENS = Object.fromEntries('twenty thirty forty fifty sixty seventy eighty ninety'.split(' ').map((w, i) => [w, (i + 2) * 10]));

/** `skeleton` with each run of number words up to 9999 ("six hundred and thirty", "twenty eight") as digits ("630"). */
function numberWords(skeleton) {
  const words = skeleton.split(' ');
  const out = [];
  for (let i = 0; i < words.length; ) {
    let total = 0;
    let part = 0;
    let j = i;
    for (; j < words.length; j++) {
      const w = words[j];
      const tail = part % 100;
      if (has(UNITS, w) && (tail === 0 || (tail >= 20 && tail % 10 === 0))) part += UNITS[w];
      else if (has(TENS, w) && tail === 0) part += TENS[w];
      else if (w === 'hundred' && part > 0 && part < 10) part *= 100;
      else if (w === 'thousand' && part > 0 && part < 10) {
        total += part * 1000;
        part = 0;
      } else if (w === 'and' && j > i && (words[j - 1] === 'hundred' || words[j - 1] === 'thousand') && (has(UNITS, words[j + 1]) || has(TENS, words[j + 1]))) continue;
      else break;
    }
    if (j === i) out.push(words[i++]);
    else {
      out.push(String(total + part));
      i = j;
    }
  }
  return out.join(' ');
}

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

/** Small words that join others; a pair of words is not a statement when one of them is only that. */
const FUNCTION = new Set('of to in on at is it by as an or be do if no so up we he me my us the and for but not you are was has its our can may all any how why who out off per via with from'.split(' '));

/**
 * The distinctive words of `label`: not a stop word (unless `stop` is false), not one of the words in `skip`, in none
 * of the `others` labels; 4+ letters or 3+ digits (`min` letters when given).
 */
function distinctive(label, others, { stop = true, min = 4, skip = new Set() } = {}) {
  const seen = new Set(others.flatMap((o) => skel(o).split(' ')));
  const keep = (w) => !seen.has(w) && !skip.has(w) && !(stop && STOP.has(w)) && (/^\d+$/.test(w) ? w.length >= 3 : w.length >= min);
  return [...new Set(skel(label).split(' ').filter(keep))];
}

/** A distinctive word long enough to be a compound ("deltatocumulative", "k8sattributes"), or a number of 3+ digits, stands alone. */
const standsAlone = (w) => (/^\d+$/.test(w) ? w.length >= 3 : w.length >= COMPOUND);

/**
 * The adjacent word pairs of `label` worth looking for: neither word a stop or small word, one of them 4+ characters
 * ("user id", "tail sample"; not "starts the" or "which service"), and not both already in the step's own text.
 */
function bigramsOf(label, ctx) {
  const own = skel(label).split(' ');
  return own
    .slice(1)
    .map((w, i) => [own[i], w])
    .filter(([x, y]) => [x, y].every((w) => w.length >= 2 && !STOP.has(w) && !FUNCTION.has(w)) && Math.max(x.length, y.length) >= 4 && !(ctx.words.has(x) && ctx.words.has(y)))
    .map((p) => p.join(' '));
}

/**
 * What the words of `label` that no `rivals` label has add to the tokens: a number or a long compound alone; any two
 * of the other distinctive words in one sentence (one common word alone, "counter" or "distribution", is a hint's
 * everyday vocabulary); and each adjacent pair of words no rival has, which is how a deciding combination of shared
 * words ("asynchronous UpDownCounter", "tail sample") is stated. Words the step's own text already uses are skipped.
 */
function wordTokens(label, rivals, ctx) {
  const words = distinctive(label, rivals, { skip: ctx.words });
  const rival = rivals.map(skel);
  const bigrams = bigramsOf(label, ctx).filter((bg) => !rival.some((r) => ` ${r} `.includes(` ${bg} `)));
  const apart = words.filter((w) => w.length >= PAIR_WORD);
  const pairs = apart.flatMap((x, i) => apart.slice(i + 1).map((y) => [x, y]));
  return { singles: [...words.filter(standsAlone), ...bigrams], pairs };
}

/**
 * The clauses of `label` (cut at , : ; . and at " so ", " but ", " then ", " and ") that stand alone as a statement of
 * the answer: 2 or more content words (not stop or small words), and not in a rival label or the step's own text. A
 * near-verbatim answer with one clause dropped or reworded still has another clause whole.
 */
function clauses(label, rivals, ctx) {
  const rival = rivals.map(skel);
  const content = (w) => w.length >= MIN_TOKEN && !STOP.has(w) && !FUNCTION.has(w);
  return plain(label)
    .split(/[,:;.]| so | but | then | and /i)
    .map(skel)
    .filter((c) => c.split(' ').filter(content).length >= 2 && !rival.some((r) => ` ${r} `.includes(` ${c} `)) && !` ${ctx.text} `.includes(` ${c} `));
}

const merge = (...parts) => ({ singles: parts.flatMap((p) => p.singles), pairs: parts.flatMap((p) => p.pairs) });

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
  choice: (spec, ctx) => {
    const right = spec.choices.find((c) => c.right).label;
    const rivals = spec.choices.filter((c) => !c.right).map((c) => c.label);
    return merge({ singles: [right, ...clauses(right, rivals, ctx)], pairs: [] }, wordTokens(right, rivals, ctx));
  },
  incident: (spec, ctx) => {
    const right = spec.hypotheses.find((h) => h.right === true).label;
    const rivals = spec.hypotheses.filter((h) => h.right !== true).map((h) => h.label);
    return merge({ singles: [right, ...clauses(right, rivals, ctx)], pairs: [] }, wordTokens(right, rivals, ctx));
  },
  spot: (spec, ctx) => {
    const faults = spec.lines.filter((l) => spec.faults.includes(l.id)).map((l) => l.text);
    const others = spec.lines.filter((l) => !spec.faults.includes(l.id)).map((l) => l.text);
    return merge({ singles: faults, pairs: [] }, ...faults.map((f) => wordTokens(f, others, ctx)));
  },
  sort: (spec) => {
    // An item is stated by its whole label or by its key (the label before " = "); a bucket by its label or by a word
    // only it has. The stop list does not apply: here a word like "resource" or "attribute" is what tells buckets apart.
    const pairs = [];
    for (const i of spec.items) {
      const bucket = spec.buckets.find((b) => b.id === i.bucket).label;
      const key = skel(plain(i.label).split(' = ')[0]).length >= MIN_TOKEN ? plain(i.label).split(' = ')[0] : i.label;
      const words = distinctive(bucket, spec.buckets.filter((b) => b.label !== bucket).map((b) => b.label), { stop: false, min: MIN_TOKEN });
      for (const item of new Set([i.label, key])) for (const what of [bucket, ...words]) pairs.push([item, what]);
    }
    return { singles: [], pairs };
  },
  tradeoff: (spec, ctx) => {
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
      const bigrams = bigramsOf(mine, ctx);
      for (const part of knob) for (const what of [mine, ...distinctive(mine, rivals), ...bigrams]) pairs.push([part, what]);
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
  query: (spec, ctx) => {
    // The answer is also stated without its `{...}` matchers, so each form is a token unless the player's own text has it.
    const unmatched = (q) => q.replace(/\{[^}]*\}/g, '');
    const given = spec.given ?? '';
    const known = `${skel(given)} ${skel(unmatched(given))} ${ctx.text}`;
    const forms = [...subExpressions(spec.reference), skel(unmatched(spec.reference)), ...subExpressions(unmatched(spec.reference))];
    return { singles: [skel(spec.reference), ...new Set(forms.filter((x) => x.length >= 8 && !known.includes(x)))], pairs: [] };
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
 * means "nothing to withhold". `step` (from findStep) is the step's own text, whose words the guide may use. A configure value may be short ("10", "on") when its key is not: the key anchors it.
 */
export function answerTokens(type, spec, step = null) {
  try {
    if (!has(TOKENS, type?.key)) return null;
    // What the player is told besides the options: the lesson, the lead-in, the code and the question. A word in it is
    // the guide's to use. Without the step (the stricter reading) nothing is excused.
    // A Configure it step also shows its starting config (`given`), so a pair that line already holds is not news either.
    const own = step === null ? [] : [step.intro, step.show, step.code, step.question, type.key === 'configure' ? spec.given : ''];
    const text = skel(own.map((v) => (typeof v === 'string' ? v : '')).join('\n'));
    const raw = TOKENS[type.key](spec, { text, words: new Set(text.split(' ')) });
    const singles = [...new Set(raw.singles.map(skel))];
    // A pair the lesson or the question already says in one sentence tells the player nothing new.
    const said = sentencesOf(own.map((v) => (typeof v === 'string' ? v : '')).join('\n'));
    const pairs = [...new Set(raw.pairs.map((p) => p.map(skel).join('\u0000')))]
      .map((p) => p.split('\u0000'))
      .filter((p) => step === null || !said.some((x) => together(x, p)));
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

/**
 * The skeleton sentences of `text`, each also joined to the one before when it has a pronoun in its first three words:
 * "Take service.name. It is a resource attribute." is one statement.
 */
function sentencesOf(text) {
  const sentences = text.split(SENTENCE_END).map(skel);
  return [...sentences, ...sentences.flatMap((x, i) => (i > 0 && FOLLOWS.test(x) ? [`${sentences[i - 1]} ${x}`] : []))];
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
  const packed = flat.replace(/ /g, '');
  const said = (t) => mention(flat, t) || (t.length >= PACKED && packed.includes(t.replace(/ /g, '')));
  if (tokens.singles.some(said)) return true;
  const sentences = sentencesOf(text);
  return tokens.pairs.some((pair) => sentences.some((x) => together(x, pair)));
}
