// The Build it help ladder, pure (#146; docs/M1-DESIGN.md §4.2): the helps a step declares
// (`spec.helps`), arrival order for the queue, what a moving span may be dropped on, the
// specific note for each checkBuild code, and the three hint tiers. Everything derives from
// the spec, its answer (`answerFor`, the way checkBuild reads it) and checkBuild's issues:
// there is no second grader. Data text is escaped with `e`; rule text is authored HTML.
// DOM-free.

import { answerFor, applyLogs, applyState, checkBuild, createsLoop, isLogMode, setParent } from './build-it.mjs';
import { namer, shortTrace } from './build-it-names.mjs';
import { validateHelps } from './help-ladder.mjs';
import { waterfall } from './trace.mjs';

/** The Build it helps, in chip order: [key, label]. */
export const BUILD_HELPS = Object.freeze([
  ['queue', 'One span at a time'],
  ['tint', 'Trace tint'],
  ['guide', 'Time-window guide'],
  ['instant', 'Instant feedback'],
  ['hints', 'Hints'],
]);
const KEYS = BUILD_HELPS.map(([k]) => k);

/** The helps of `spec`, every key true or false. Without `helps`: Check, and hints only when the spec has an authored `hint`. */
export function buildHelps(spec) {
  const given = spec.helps;
  const out = Object.fromEntries(KEYS.map((k) => [k, given?.[k] === true]));
  if (given === undefined) out.hints = spec.hint !== undefined;
  return out;
}

/** Whether the board renders a Check button: only without instant feedback. The one source for the board and for the disabled-Next reason (#339). */
export const hasCheckButton = (spec) => !buildHelps(spec).instant;

/** Why Next/Finish is disabled on this board, the start of "<reason> to continue.": names Check only when the board has one (#339). */
export function buildReason(spec) {
  if (hasCheckButton(spec)) return 'Solve the board and press Check';
  return isLogMode(spec) ? 'Get every record right' : 'Get every span right';
}

/** The player's words for each checkBuild issue code (the code itself stays in the markup's data-code, never on screen). */
export const ISSUE_LABELS = Object.freeze({
  'cross-trace-parent': 'Wrong trace',
  'wrong-parent': 'Wrong parent',
  'wrong-kind': 'Wrong kind',
  'wrong-status': 'Wrong status',
  'missing-link': 'Missing link',
  'extra-link': 'Extra link',
  'log-other-service': 'Other service',
  'log-outside-span': 'Outside the span',
  'log-no-active-span': 'No span active',
  'log-wrong-trace': 'Other trace',
  'log-wrong-span': 'Wrong span',
  'log-not-attached': 'Not attached yet',
});

/** The player word for an issue code; a code this table does not know reads "Not right yet", never the code. */
export const issueLabel = (code) => ISSUE_LABELS[code] ?? 'Not right yet';

const byStart = (a, b) => a.startMs - b.startMs || (a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0);

/** Span ids in arrival order: start time, then id. */
export const arrivalOrder = (spec) => [...spec.spans].sort(byStart).map((s) => s.spanId);

/** Problems with the helps of a valid BuildSpec (and its `closing` line). */
export function validateBuildHelps(spec) {
  const problems = validateHelps(spec.helps, KEYS);
  if (spec.closing !== undefined && !(typeof spec.closing === 'string' && spec.closing.trim() !== '')) {
    problems.push('closing: not non-empty text');
  }
  if (problems.some((p) => p.startsWith('helps:'))) return problems; // a malformed helps object: say only that
  const h = buildHelps(spec);
  const parent = !isLogMode(spec) && spec.edit.includes('parent');
  if (isLogMode(spec)) {
    if (h.queue || h.tint || h.guide || h.instant) problems.push('helps: logs mode takes only hints');
  } else {
    for (const k of ['queue', 'guide']) if (h[k] && !parent) problems.push(`helps: ${k} needs parent editing`);
  }
  if (h.queue && parent) {
    if (!h.instant) problems.push('helps: queue needs instant feedback'); // a Check button would grade past the queue
    if (spec.spans.some((s) => s.parentId !== null)) problems.push('helps: queue needs every span given as a root');
    else if (answerFor(spec, arrivalOrder(spec)[0], 'parentId') !== null) {
      problems.push('helps: queue needs the first span to arrive to be a root in the answer');
    }
  }
  if (spec.hint !== undefined && spec.helps !== undefined && !h.hints) problems.push('hint: shown only when helps.hints is on');
  return problems;
}

/** The spans on the board at the start: with the queue only the first to arrive, else every span. */
export function initialPlaced(spec, helps) {
  const order = arrivalOrder(spec);
  return new Set(helps.queue ? order.slice(0, 1) : order);
}

/** Every span below `id` in the state's tree. */
export function descendants(st, id) {
  const out = new Set();
  for (const start of Object.keys(st.spans)) {
    const seen = new Set();
    for (let at = st.spans[start].parentId; at != null && !seen.has(at) && st.spans[at]; at = st.spans[at].parentId) {
      seen.add(at);
      if (at === id) {
        out.add(start);
        break;
      }
    }
  }
  return out;
}

const contains = (p, s) => p.startMs <= s.startMs && p.endMs >= s.endMs;

/**
 * Drop marks while span `src` moves, for every placed span (spec order): 'src' (itself),
 * 'invalid' (itself or below it: not a target), else 'likely' / 'overflow' (with the guide:
 * contains its time window or not) or 'valid'. `other`: with the tint, the target is in
 * another trace.
 */
export function moveMarks(spec, st, src, { placed, helps }) {
  const s = spec.spans.find((x) => x.spanId === src);
  const bad = descendants(st, src);
  const out = {};
  for (const p of spec.spans) {
    if (!placed.has(p.spanId)) continue;
    if (p.spanId === src) out[p.spanId] = { mark: 'src', other: false };
    else if (bad.has(p.spanId)) out[p.spanId] = { mark: 'invalid', other: false };
    else {
      const mark = helps.guide ? (contains(p, s) ? 'likely' : 'overflow') : 'valid';
      out[p.spanId] = { mark, other: helps.tint && p.traceId !== s.traceId };
    }
  }
  return out;
}

const num = (n) => String(Math.round(n * 100) / 100);
const R = (l, e) => `"${e(l.body)}" (${e(l.service)}, ${num(l.timeMs)} ms)`;
const code = (t) => `<code>${shortTrace(t)}</code>`;

/** Span mode: the field an issue code is about. */
const FIELD_OF = {
  'cross-trace-parent': 'parent',
  'wrong-parent': 'parent',
  'wrong-kind': 'kind',
  'wrong-status': 'status',
  'missing-link': 'links',
  'extra-link': 'links',
};

function spanNote(spec, st, issue, e) {
  const L = namer(spec.spans, e).bold; // one twin map per message (#228)
  const spans = applyState(spec, st);
  const byId = new Map(spans.map((x) => [x.spanId, x]));
  const s = byId.get(issue.spanId);
  const p = s.parentId === null ? null : byId.get(s.parentId);
  switch (issue.code) {
    case 'cross-trace-parent':
      return `${L(s)} carries trace ID ${code(s.traceId)}, ${L(p)} carries ${code(p.traceId)}. Different trace IDs, so it can't be the parent.`;
    case 'wrong-parent': {
      if (!p) return `${L(s)} is a root now, yet another span of trace ${code(s.traceId)} was already running when it started. Which call was it doing work for?`;
      if (!contains(p, s)) {
        return `${L(s)} runs ${num(s.startMs)} to ${num(s.endMs)} ms, which is not inside ${L(p)} (${num(p.startMs)} to ${num(p.endMs)} ms). A parent starts first and is still running when its child ends.`;
      }
      const w = byId.get(answerFor(spec, s.spanId, 'parentId'));
      if (w && contains(p, w) && contains(w, s)) {
        return `${L(s)} runs inside ${L(p)}, but a span closer to it also contains it. Look for the innermost span that was running when it started.`;
      }
      return `${L(s)} runs inside ${L(p)}, but that is not the span it did its work for. Which call was it part of?`;
    }
    case 'wrong-kind':
      return `${L(s)}: the kind doesn't match what it did. Does it handle a call, make one, send a message, process one, or none of these?`;
    case 'wrong-status':
      return `${L(s)}: check the status. Only an operation that failed is ERROR.`;
    case 'missing-link':
      return issue.count > 1
        ? `${L(s)}: it should also point at ${issue.count} related spans that are not its parent.`
        : `${L(s)}: it should also point at a related span that is not its parent.`;
    case 'extra-link':
      return issue.count > 1
        ? `${L(s)}: ${issue.count} of its links point at spans it is not related to.`
        : `${L(s)}: one of its links points at a span it is not related to.`;
    default:
      return e(issue.message);
  }
}

function logNote(spec, st, issue, e) {
  const L = namer(spec.spans, e).bold; // one twin map per message (#228)
  const l = applyLogs(spec, st).find((x) => x.id === issue.logId);
  const a = l.spanId === null ? null : spec.spans.find((x) => x.spanId === l.spanId);
  switch (issue.code) {
    case 'log-other-service':
      return `${R(l, e)}: ${L(a)} is a span of ${e(a.service)}, and this record was written by ${e(l.service)}. A log call only sees the current span of its own service.`;
    case 'log-outside-span':
      return `${R(l, e)}: ${L(a)} ran ${num(a.startMs)} to ${num(a.endMs)} ms, and this record was written outside that window. A span is current only while it runs.`;
    case 'log-no-active-span':
      return `${R(l, e)}: was a span current when the log call ran? Compare its time and attributes with the span's.`;
    case 'log-wrong-trace':
      return `${R(l, e)}: ${L(a)} is in another trace than the request that wrote this record. Its attributes say which request it belongs to.`;
    case 'log-wrong-span':
      return `${R(l, e)}: ${L(a)} is in the right trace, but another span of it was current when this record was written. Compare the record's time and attributes with each span's.`;
    case 'log-not-attached':
      return `${R(l, e)} has no span context yet, so nothing links it to a trace.`;
    default:
      return e(issue.message);
  }
}

/**
 * The note for one checkBuild issue: specific to its code, built from the state (the span or
 * record as placed, the parent or span chosen), never naming the expected parent or span.
 */
export function noteFor(spec, st, issue, e) {
  return isLogMode(spec) ? logNote(spec, st, issue, e) : spanNote(spec, st, issue, e);
}

/**
 * The span (or, in logs mode, record) a hint is for: with the queue, the span arriving now;
 * else the selected one if checkBuild finds it wrong; else the first wrong one (arrival
 * order; logs mode: spec order). Null when there is nothing to hint.
 */
export function hintTarget(spec, st, { helps, placed, selected = null, selectedLog = null }) {
  const issues = checkBuild(spec, st).issues;
  if (isLogMode(spec)) {
    const wrong = new Set(issues.map((i) => i.logId));
    if (selectedLog !== null && wrong.has(selectedLog)) return selectedLog;
    return spec.logs.find((l) => wrong.has(l.id))?.id ?? null;
  }
  const order = arrivalOrder(spec);
  if (helps.queue) {
    const cur = order.find((id) => !placed.has(id));
    if (cur !== undefined) return cur;
  }
  const wrong = new Set(issues.map((i) => i.spanId));
  if (selected !== null && wrong.has(selected)) return selected;
  return order.find((id) => wrong.has(id)) ?? null;
}

/** The field a hint for span `id` is about: its first issue's, else parent (when editable), else the first editable field. */
function hintField(spec, st, id) {
  if (isLogMode(spec)) return 'logs';
  const issue = checkBuild(spec, st).issues.find((i) => i.spanId === id);
  if (issue) return FIELD_OF[issue.code];
  return spec.edit.includes('parent') ? 'parent' : spec.edit[0];
}

const RULES = {
  parent:
    'A child starts after its parent starts and ends before its parent ends, and it carries the same trace ID. ' +
    "When one service calls another, the CLIENT span's child is the SERVER span it called.",
  kind:
    'CLIENT calls another service and SERVER handles that call; PRODUCER sends a message and CONSUMER processes it; ' +
    'INTERNAL is work inside one service that calls no one.',
  status: 'Set ERROR when the operation failed. Leave UNSET when it completed, even if it handled an error on the way. OK marks an operation someone explicitly checked as a success.',
  links: 'A link points at a related span that is not the parent, often in another trace: a batch links each message it handled.',
  logs: 'A record carries the span that was current when its log call ran: a span of the same service, running at the record\'s time, doing the work the record describes.',
};
const KIND_PAIR = { SERVER: 'CLIENT', CLIENT: 'SERVER', PRODUCER: 'CONSUMER', CONSUMER: 'PRODUCER', INTERNAL: 'SERVER' };
const KIND_WHY = {
  SERVER: 'it handles a call that another span made.',
  CLIENT: 'it calls out to another service.',
  PRODUCER: 'it sends a message for another span to process.',
  CONSUMER: 'it processes a message that another span sent.',
  INTERNAL: 'it is work inside its service that calls no one.',
};
const STATUS_WHY = {
  ERROR: 'the operation failed.',
  UNSET: 'the operation completed, so nothing marks it failed.',
  OK: 'someone explicitly checked it as a success.',
};
const duration = (s) => s.endMs - s.startMs;
const shortest = (a, b) => duration(a) - duration(b) || byStart(a, b);

/** Span mode, parent: the expected parent ('root' for none) and a decoy, in board order (root first). */
function parentCands(spec, st, id, placed) {
  const spans = applyState(spec, st);
  const s = spans.find((x) => x.spanId === id);
  const want = answerFor(spec, id, 'parentId');
  const wantKey = want ?? 'root';
  const below = descendants(st, id);
  const usable = spans.filter((p) => p.spanId !== id && p.spanId !== want && !below.has(p.spanId) && (!placed || placed.has(p.spanId)));
  const holders = usable.filter((p) => contains(p, s)).sort(shortest);
  const decoy = holders[0]?.spanId ?? (wantKey !== 'root' ? 'root' : usable[0]?.spanId);
  const rows = waterfall(spans).rows.map((r) => r.spanId);
  const rank = (k) => (k === 'root' ? -1 : rows.indexOf(k));
  return [...new Set([wantKey, decoy].filter((k) => k !== undefined))].sort((a, b) => rank(a) - rank(b));
}

/** Logs mode: the expected span ('none' for no span context) and a decoy, 'none' first, then row order. */
function logCands(spec, st, logId) {
  const l = spec.logs.find((x) => x.id === logId);
  const want = spec.answer[logId];
  const wantKey = want ?? 'none';
  const others = spec.spans.filter((s) => s.spanId !== want);
  const holders = others.filter((s) => s.service === l.service && s.startMs <= l.timeMs && l.timeMs <= s.endMs).sort(shortest);
  const decoy = holders[0]?.spanId ?? (wantKey !== 'none' ? 'none' : (others.find((s) => s.service === l.service) ?? others[0])?.spanId);
  const rows = waterfall(spec.spans, { times: spec.logs.map((x) => x.timeMs) }).rows.map((r) => r.spanId);
  const rank = (k) => (k === 'none' ? -1 : rows.indexOf(k));
  return [...new Set([wantKey, decoy].filter((k) => k !== undefined))].sort((a, b) => rank(a) - rank(b));
}

/** Why the expected parent of span `id` is its parent (tier 3). */
function parentWhy(spec, st, id, e) {
  const L = namer(spec.spans, e).bold; // one twin map per message (#228)
  const spans = applyState(spec, st);
  const s = spans.find((x) => x.spanId === id);
  const want = answerFor(spec, id, 'parentId');
  if (want === null) {
    if (!spans.some((x) => x.spanId !== id && x.traceId === s.traceId)) {
      return `Its trace ID is ${code(s.traceId)}, unlike the others, so no span of this trace can be its parent.`;
    }
    return `It is the first span of trace ${code(s.traceId)}: nothing in it was running before it started, so it is the root.`;
  }
  const p = spans.find((x) => x.spanId === want);
  if (p.kind === 'CLIENT' && s.kind === 'SERVER') return `${L(p)} is the CLIENT call into ${e(s.service)}, and this is the SERVER span that handled it.`;
  const closer = spans.some((x) => x.spanId !== want && x.spanId !== id && x.traceId === s.traceId && contains(p, x) && contains(x, s));
  if (contains(p, s) && !closer) {
    return `${L(p)} is the innermost span of trace ${code(s.traceId)} that runs around it (${num(p.startMs)} to ${num(p.endMs)} ms).`;
  }
  return `${L(p)} is the span it did its work for (${num(p.startMs)} to ${num(p.endMs)} ms).`;
}

/**
 * Hint tier `tier` (1 to 3) for span or record `key`: { html, cands, apply }. Tier 1 is the
 * rule (the spec's authored `hint` when it has one); tier 2 names two candidates (`cands`:
 * span ids, 'root', 'none', or values for a kind or status), one of them right; tier 3 gives
 * the answer with a reason and `apply` = {field, value} for the widget to set through the
 * one setter; a parent whose answer sits below the span adds `lift` = {id, to}, a move the
 * widget makes first so the placement cannot loop. `placed` (span mode) limits parent
 * candidates (and a lift's target) to spans on the board.
 */
export function hintFor(spec, st, key, tier, { placed, e }) {
  const field = hintField(spec, st, key);
  if (tier === 1) {
    return { html: spec.hint !== undefined ? spec.hint : `<p>${RULES[field]}</p>`, cands: [], apply: null };
  }
  const spans = applyState(spec, st);
  const L = namer(spec.spans, e).bold; // one twin map per message (#228)
  const nameOf = (k) => {
    if (k === 'root') return '<b>No parent (root)</b>';
    if (k === 'none') return '<b>No span context</b>';
    const s = spans.find((x) => x.spanId === k);
    if (!s) return `<b>${e(k)}</b>`;
    return field === 'logs' ? `<b>${e(s.name)}</b> (${e(s.service)}, ${num(s.startMs)} to ${num(s.endMs)} ms)` : L(s);
  };
  if (tier === 2) {
    let cands;
    if (field === 'parent') cands = parentCands(spec, st, key, placed);
    else if (field === 'logs') cands = logCands(spec, st, key);
    else if (field === 'kind') {
      const want = answerFor(spec, key, 'kind');
      cands = [want, KIND_PAIR[want]].sort();
    } else if (field === 'status') {
      const want = answerFor(spec, key, 'status');
      cands = [want, want === 'ERROR' ? 'UNSET' : 'ERROR'].sort();
    } else {
      const want = answerFor(spec, key, 'links');
      const has = spans.find((x) => x.spanId === key).links;
      const missing = want.find((l) => !has.includes(l));
      const html = missing !== undefined
        ? `<p>It should link ${want.length} span${want.length === 1 ? '' : 's'}; one of them is ${nameOf(missing)}.</p>`
        : `<p>One of its links, to ${nameOf(has.find((l) => !want.includes(l)))}, should go.</p>`;
      return { html, cands: [missing ?? has.find((l) => !want.includes(l))], apply: null };
    }
    const outlined = field === 'parent' || field === 'logs' ? ', outlined on the board' : '';
    const names = cands.map((c) => (field === 'kind' || field === 'status' ? `<b>${c}</b>` : nameOf(c)));
    // A candidate below the span is one the board refuses now: say what has to happen first.
    const blocked = field === 'parent' ? cands.filter((c) => c !== 'root' && createsLoop(st, key, c)) : [];
    const first = blocked.map((c) => ` ${nameOf(c)} sits below it now, so it has to move out first.`).join('');
    return { html: `<p>It is one of these two${outlined}: ${names.join(' or ')}.${first}</p>`, cands, apply: null };
  }
  if (field === 'parent') {
    const value = answerFor(spec, key, 'parentId');
    const why = parentWhy(spec, st, key, e);
    if (value === null || !createsLoop(st, key, value)) return { html: `<p>Placed for you. ${why}</p>`, cands: [], apply: { field, value } };
    // The answer parent sits below the span: lift it out first, to its own answer parent
    // when that is on the board and outside the span's subtree (which holds the lifted
    // span's own), else to the root.
    const up = answerFor(spec, value, 'parentId');
    const to = up !== null && (!placed || placed.has(up)) && !createsLoop(st, key, up) ? up : null;
    // Grade the lifted span where it lands (a copy, through the one setter), so the hint says
    // when the lift leaves it wrong.
    const where = to === null ? 'to the root' : `under ${nameOf(to)}`;
    const after = structuredClone(st);
    setParent(spec, after, value, to);
    const left = checkBuild(spec, after).issues.find((i) => i.spanId === value);
    const first = left
      ? `${nameOf(value)} sat below it, so it moves out first, ${where}, and is not where it belongs yet: ${noteFor(spec, after, left, e)}`
      : `${nameOf(value)} sat below it, so it moves out first, ${where}.`;
    return { html: `<p>Placed for you. ${first} ${why}</p>`, cands: [], apply: { field, value, lift: { id: value, to } } };
  }
  if (field === 'logs') {
    const value = spec.answer[key];
    const l = spec.logs.find((x) => x.id === key);
    const w = spans.find((x) => x.spanId === value);
    const why = w
      ? `${L(w)} was the current span when this record was written, at ${num(l.timeMs)} ms.`
      : 'No span was current when this record was written, so it carries no span context.';
    return { html: `<p>Set for you. ${why}</p>`, cands: [], apply: { field, value } };
  }
  const s = spans.find((x) => x.spanId === key);
  if (field === 'kind' || field === 'status') {
    const value = answerFor(spec, key, field);
    const why = field === 'kind' ? KIND_WHY[value] : STATUS_WHY[value];
    return { html: `<p>Set for you. ${L(s)} is ${value}: ${why}</p>`, cands: [], apply: { field, value } };
  }
  return {
    html: `<p>Set for you. ${L(s)} now links to every span it is related to.</p>`,
    cands: [],
    apply: { field, value: [...answerFor(spec, key, 'links')] },
  };
}
