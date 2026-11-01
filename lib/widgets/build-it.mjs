// Build it widget core (docs/M1-DESIGN.md §4.2): validate a BuildSpec, edit a span tree,
// grade it. Pure and DOM-free; the spec is never written. The setters edit the state in
// place and return an outcome. The view and its penalties live in `build-it-view.mjs`
// (`mountBuild`, I1).
//
// BuildSpec = { id, spans: Span[], edit: ⊆ ['parent','kind','status','links'] | ['logs'],
//   answer: {[spanId]: {parentId?, kind?, status?, links?}}, logs?, hint?, explain? (logs mode only) }
//   An answer gives only what changes: a field it leaves out is expected to stay as given.
//   Logs mode (`edit: ['logs']`, its own mode; spans are read-only): `logs` is 1 to 12
//   LogRecord = { id, timeMs, severity, service, body, traceId|null, spanId|null, attributes? }
//   in non-decreasing time, and `answer` is {[logId]: spanId | null} (null: no span context).
//   A record is a standalone record that carries ids: never a child span, never a row.
// BuildState = { spans: {[spanId]: {parentId, kind, status, links}}, logs: {[logId]: spanId|null} }
//   The record's trace is never stored: `applyLogs` derives it from the span, in one place.

import { isId } from '../registry.mjs';
import { KINDS, STATUSES } from './trace.mjs';

const EDITS = ['parent', 'kind', 'status', 'links'];
const LOGS = 'logs';
const ALLOWED = [...EDITS, LOGS];
const SEVERITIES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const MAX_LOGS = 12;
const FIELD = { parent: 'parentId', kind: 'kind', status: 'status', links: 'links' };
const SPAN_ID = /^[0-9a-f]{16}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));
const own = (obj, key) => isObject(obj) && Object.hasOwn(obj, key);

/** True in logs mode: `edit` is exactly ['logs']. The one mode test. */
export const isLogMode = (spec) => isObject(spec) && Array.isArray(spec.edit) && spec.edit.length === 1 && spec.edit[0] === LOGS;

/** Links of span `self` at `at`: a list of known span ids, none of them `self`, each once. */
function checkLinks(links, self, ids, at, problems) {
  if (!Array.isArray(links) || !links.every((l) => typeof l === 'string')) {
    problems.push(`${at}: links is not a list of span ids`);
    return;
  }
  const seen = new Set();
  for (const l of links) {
    if (l === self) problems.push(`${at}: links to itself`);
    else if (!ids.has(l)) problems.push(`${at}: link ${show(l)} is not a span`);
    else if (seen.has(l)) problems.push(`${at}: duplicate link ${show(l)}`);
    seen.add(l);
  }
}

function checkSpans(spans, problems) {
  if (!Array.isArray(spans)) {
    problems.push('spans: not a list');
    return [];
  }
  if (spans.length === 0) problems.push('spans: expected at least one span');
  const ids = new Set(spans.filter(isObject).map((s) => s.spanId));
  const seen = new Set();
  spans.forEach((s, i) => {
    const at = `span ${i}`;
    if (!isObject(s)) {
      problems.push(`${at}: not an object`);
      return;
    }
    if (!SPAN_ID.test(s.spanId ?? '')) problems.push(`${at}: spanId ${show(s.spanId)} is not 16 lowercase hex`);
    else if (seen.has(s.spanId)) problems.push(`duplicate spanId ${show(s.spanId)}`);
    seen.add(s.spanId);
    if (!TRACE_ID.test(s.traceId ?? '')) problems.push(`${at}: traceId ${show(s.traceId)} is not 32 lowercase hex`);
    if (!isText(s.name)) problems.push(`${at}: name is not non-empty text`);
    if (!isText(s.service)) problems.push(`${at}: service is not non-empty text`);
    if (!KINDS.includes(s.kind)) problems.push(`${at}: kind ${show(s.kind)} is not one of ${KINDS.join(', ')}`);
    if (!STATUSES.includes(s.status)) problems.push(`${at}: status ${show(s.status)} is not one of ${STATUSES.join(', ')}`);
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) problems.push(`${at}: startMs and endMs must be numbers`);
    else if (s.endMs < s.startMs) problems.push(`${at}: endMs ${s.endMs} is before startMs ${s.startMs}`);
    if (s.parentId !== null && typeof s.parentId !== 'string') problems.push(`${at}: parentId is not a string or null`);
    checkLinks(s.links, s.spanId, ids, at, problems);
    if (s.attributes !== undefined && !isObject(s.attributes)) problems.push(`${at}: attributes is not an object`);
    if (s.events !== undefined && !Array.isArray(s.events)) problems.push(`${at}: events is not a list`);
  });
  return spans.filter(isObject);
}

function checkAnswer(spec, ids, edit, problems) {
  if (!isObject(spec.answer)) {
    problems.push('answer: not an object');
    return;
  }
  for (const [id, want] of Object.entries(spec.answer)) {
    if (!ids.has(id)) {
      problems.push(`answer: unknown span ${show(id)}`);
      continue;
    }
    if (!isObject(want)) {
      problems.push(`answer ${id}: not an object`);
      continue;
    }
    for (const key of Object.keys(want)) {
      const name = Object.keys(FIELD).find((k) => FIELD[k] === key);
      if (!name) problems.push(`answer ${id}: ${show(key)} is not a span field it can set`);
      else if (!edit.includes(name)) problems.push(`answer ${id}: ${name} is not editable`);
    }
    if (own(want, 'parentId') && want.parentId !== null && !ids.has(want.parentId)) {
      problems.push(`answer ${id}: parentId ${show(want.parentId)} is not a span`);
    }
    if (own(want, 'kind') && !KINDS.includes(want.kind)) problems.push(`answer ${id}: kind ${show(want.kind)} is not valid`);
    if (own(want, 'status') && !STATUSES.includes(want.status)) problems.push(`answer ${id}: status ${show(want.status)} is not valid`);
    if (own(want, 'links')) checkLinks(want.links, id, ids, `answer ${id}`, problems);
  }
}

/** Problems of the `logs` list: shape of each record, time order, id pairing. */
function checkLogs(spec, spans, problems) {
  const logs = spec.logs;
  if (!Array.isArray(logs)) {
    problems.push('logs: not a list');
    return [];
  }
  if (logs.length < 1 || logs.length > MAX_LOGS) problems.push(`logs: expected 1 to ${MAX_LOGS} records`);
  const spanById = new Map(spans.map((s) => [s.spanId, s]));
  const seen = new Set();
  let prev;
  logs.forEach((l, i) => {
    const at = `log ${i}`;
    if (!isObject(l)) {
      problems.push(`${at}: not an object`);
      return;
    }
    if (!isId(l.id)) problems.push(`${at}: id ${show(l.id)} is not kebab-case`);
    else if (spanById.has(l.id)) problems.push(`${at}: id ${show(l.id)} is also a span id`);
    else if (seen.has(l.id)) problems.push(`duplicate log id ${show(l.id)}`);
    seen.add(l.id);
    if (!Number.isFinite(l.timeMs)) problems.push(`${at}: timeMs ${show(l.timeMs)} is not a finite number`);
    else {
      if (prev !== undefined && l.timeMs < prev) {
        problems.push(`${at}: timeMs ${l.timeMs} is earlier than the record before it (${prev}); records go in time order`);
      }
      prev = l.timeMs;
    }
    if (!SEVERITIES.includes(l.severity)) problems.push(`${at}: severity ${show(l.severity)} is not one of ${SEVERITIES.join(', ')}`);
    if (!isText(l.service)) problems.push(`${at}: service is not non-empty text`);
    if (!isText(l.body)) problems.push(`${at}: body is not non-empty text`);
    const traceOk = l.traceId === null || TRACE_ID.test(l.traceId ?? '');
    const spanOk = l.spanId === null || SPAN_ID.test(l.spanId ?? '');
    if (!traceOk) problems.push(`${at}: traceId ${show(l.traceId)} is not 32 lowercase hex or null`);
    if (!spanOk) problems.push(`${at}: spanId ${show(l.spanId)} is not 16 lowercase hex or null`);
    if (traceOk && spanOk && (l.traceId === null) !== (l.spanId === null)) {
      problems.push(`${at}: traceId and spanId must both be set or both be null`);
    }
    if (traceOk && l.traceId !== null && /^0+$/.test(l.traceId)) problems.push(`${at}: traceId is all zeros`);
    if (spanOk && l.spanId !== null) {
      if (/^0+$/.test(l.spanId)) problems.push(`${at}: spanId is all zeros`);
      const span = spanById.get(l.spanId);
      if (!span) problems.push(`${at}: spanId ${show(l.spanId)} is not a span`);
      else if (traceOk && l.traceId !== null && l.traceId !== span.traceId) {
        problems.push(`${at}: traceId is not the trace of span ${show(l.spanId)}`);
      }
    }
    if (l.attributes !== undefined) {
      if (!isObject(l.attributes)) problems.push(`${at}: attributes is not an object`);
      else {
        for (const [k, v] of Object.entries(l.attributes)) {
          if (typeof v !== 'string' && typeof v !== 'boolean' && !Number.isFinite(v)) {
            problems.push(`${at}: attribute ${show(k)} is not text, a finite number or a boolean`);
          }
        }
      }
    }
  });
  return logs.filter(isObject);
}

/** Problems of a logs-mode answer: every record listed once, each a span id or null. */
function checkLogAnswer(spec, logs, spanIds, problems) {
  if (!isObject(spec.answer)) {
    problems.push('answer: not an object');
    return;
  }
  const ids = new Set(logs.map((l) => l.id));
  for (const [id, want] of Object.entries(spec.answer)) {
    if (!ids.has(id)) problems.push(`answer: unknown log ${show(id)}`);
    else if (want === 'none') problems.push(`answer ${id}: "none" is not a span id; use null for no span context`);
    else if (want !== null && typeof want !== 'string') problems.push(`answer ${id}: expected a span id or null`);
    else if (want !== null && !spanIds.has(want)) problems.push(`answer ${id}: ${show(want)} is not a span`);
  }
  for (const id of ids) if (!own(spec.answer, id)) problems.push(`answer: log ${show(id)} is not listed`);
}

/** Every problem with `spec` (empty when valid). Never throws, never stops at the first. */
export function validateBuildSpec(spec) {
  if (!isObject(spec)) return ['spec: not an object'];
  const problems = [];
  if (!isId(spec.id)) problems.push(`spec id ${show(spec.id)} is not kebab-case`);
  const spans = checkSpans(spec.spans, problems);
  const ids = new Set(spans.map((s) => s.spanId));
  let edit = [];
  if (!Array.isArray(spec.edit) || spec.edit.length === 0) {
    problems.push(`edit: expected at least one of ${ALLOWED.join(', ')}`);
  } else {
    edit = spec.edit;
    for (const e of edit) if (!ALLOWED.includes(e)) problems.push(`edit: ${show(e)} is not one of ${ALLOWED.join(', ')}`);
    if (new Set(edit).size !== edit.length) problems.push('edit: duplicate field');
    if (edit.includes(LOGS) && edit.length > 1) problems.push('edit: logs is its own mode; edit span fields in another step');
  }
  if (spec.hint !== undefined && !isText(spec.hint)) problems.push('hint: not non-empty text');
  if (spec.explain !== undefined && !isText(spec.explain)) problems.push('explain: not non-empty text');
  const logsMode = edit.includes(LOGS);
  if (spec.explain !== undefined && !logsMode) problems.push('explain: only shown in logs mode');
  let logs = [];
  if (logsMode) {
    if (spec.logs === undefined) problems.push('logs: required when edit is logs');
    else logs = checkLogs(spec, spans, problems);
    checkLogAnswer(spec, logs, ids, problems);
  } else {
    if (spec.logs !== undefined) problems.push('logs: only allowed when edit is logs');
    checkAnswer(spec, ids, edit, problems);
  }
  if (logsMode && problems.length === 0 && logs.every((l) => l.spanId === null && spec.answer[l.id] === null)) {
    problems.push('logs: nothing to do, every record is unlinked in both the given state and the answer');
  }
  if (problems.length) return problems;

  // The given tree and the reference answer must be loop-free, and the answer must pass (I7).
  const st = newBuildState(spec);
  for (const s of spec.spans) {
    if (s.parentId !== null && ids.has(s.parentId) && createsLoop(st, s.spanId, s.parentId)) {
      return [`span ${s.spanId}: the given parents make a loop`];
    }
  }
  if (logsMode) {
    // Apply the log answer before the I7 check, so the rule codes grade the reference answer too.
    for (const l of logs) st.logs[l.id] = spec.answer[l.id];
    const result = checkBuild(spec, st);
    if (result.ok) return [];
    return [`answer does not pass checkBuild: ${result.issues.map((i) => `${i.code} ${i.logId}`).join('; ')}`];
  }
  for (const [id, want] of Object.entries(spec.answer)) {
    if (own(want, 'parentId')) st.spans[id].parentId = null;
  }
  for (const [id, want] of Object.entries(spec.answer)) {
    if (!own(want, 'parentId')) continue;
    if (setParent(spec, st, id, want.parentId) !== 'set') return ['answer makes a loop'];
  }
  for (const [id, want] of Object.entries(spec.answer)) {
    if (own(want, 'kind')) st.spans[id].kind = want.kind;
    if (own(want, 'status')) st.spans[id].status = want.status;
    if (own(want, 'links')) st.spans[id].links = [...want.links];
  }
  const result = checkBuild(spec, st);
  if (!result.ok) return [`answer does not pass checkBuild: ${result.issues.map((i) => `${i.code} ${i.spanId}`).join('; ')}`];
  return [];
}

/** A fresh state: every span and every record as given. */
export function newBuildState(spec) {
  const spans = {};
  for (const s of spec.spans) {
    spans[s.spanId] = { parentId: s.parentId, kind: s.kind, status: s.status, links: [...s.links] };
  }
  const logs = {};
  for (const l of spec.logs ?? []) logs[l.id] = l.spanId;
  return { spans, logs };
}

const has = (st, id) => typeof id === 'string' && Object.hasOwn(st.spans, id);

/** True when `parentId` is `spanId` or sits below it, following the state's parents. */
function createsLoop(st, spanId, parentId) {
  const seen = new Set();
  for (let at = parentId; at != null && has(st, at) && !seen.has(at); at = st.spans[at].parentId) {
    if (at === spanId) return true;
    seen.add(at);
  }
  return false;
}

/** Make `parentId` (or null: a root) the parent of `spanId`: 'set', 'self', 'cycle' or 'unknown'. Refusals change nothing. */
export function setParent(spec, st, spanId, parentId) {
  if (!has(st, spanId) || (parentId !== null && !has(st, parentId))) return 'unknown';
  if (parentId === spanId) return 'self';
  if (parentId !== null && createsLoop(st, spanId, parentId)) return 'cycle';
  st.spans[spanId].parentId = parentId;
  return 'set';
}

/** Set the kind of `spanId`: 'set', 'invalid' or 'unknown'. */
export function setKind(spec, st, spanId, kind) {
  if (!has(st, spanId)) return 'unknown';
  if (!KINDS.includes(kind)) return 'invalid';
  st.spans[spanId].kind = kind;
  return 'set';
}

/** Set the status of `spanId`: 'set', 'invalid' or 'unknown'. */
export function setStatus(spec, st, spanId, status) {
  if (!has(st, spanId)) return 'unknown';
  if (!STATUSES.includes(status)) return 'invalid';
  st.spans[spanId].status = status;
  return 'set';
}

/** Add or remove a link from `spanId` to `targetId`: 'linked', 'unlinked', 'self' or 'unknown'. */
export function toggleLink(spec, st, spanId, targetId) {
  if (!has(st, spanId) || !has(st, targetId)) return 'unknown';
  if (spanId === targetId) return 'self';
  const links = st.spans[spanId].links;
  const i = links.indexOf(targetId);
  if (i >= 0) {
    links.splice(i, 1);
    return 'unlinked';
  }
  links.push(targetId);
  return 'linked';
}

/** Attach record `logId` to `spanId` (null: no span context): 'attached', 'detached' or 'unknown'. Refusals change nothing. */
export function attachLog(spec, st, logId, spanId) {
  if (typeof logId !== 'string' || !Object.hasOwn(st.logs, logId)) return 'unknown';
  if (spanId === null) {
    st.logs[logId] = null;
    return 'detached';
  }
  if (!has(st, spanId)) return 'unknown';
  st.logs[logId] = spanId;
  return 'attached';
}

/** The records of `spec` in spec order with `traceId` and `spanId` derived from the state: the one place a record's trace is read (fresh copies). */
export function applyLogs(spec, st) {
  return (spec.logs ?? []).map((l) => {
    const at = st.logs[l.id];
    const span = at == null ? undefined : spec.spans.find((s) => s.spanId === at);
    return { ...l, attributes: { ...l.attributes }, traceId: span ? span.traceId : null, spanId: span ? span.spanId : null };
  });
}

/** Every span id as a key, its attached records (as `applyLogs`, spec order) as the value, [] for none. */
export function recordsBySpan(spec, st) {
  const by = {};
  for (const s of spec.spans) by[s.spanId] = [];
  for (const l of applyLogs(spec, st)) if (l.spanId !== null) by[l.spanId].push(l);
  return by;
}

/** The spans of `spec` in spec order with the state applied (fresh copies). */
export function applyState(spec, st) {
  return spec.spans.map((s) => {
    const e = st.spans[s.spanId];
    return { ...s, parentId: e.parentId, kind: e.kind, status: e.status, links: [...e.links] };
  });
}

/** What the answer expects for `field` of span `s`: the answer's value, else the given one. */
function expected(spec, s, field) {
  const want = own(spec.answer, s.spanId) ? spec.answer[s.spanId] : undefined;
  return own(want, field) ? want[field] : s[field];
}

/** Links as a set: sorted, each once. The one normalization of links for grading. */
const linkSet = (links) => [...new Set(links)].sort();

/**
 * The graded state: per span in spec order, its editable fields only, links as a set
 * (`linkSet`). The one statement of "what is graded": `checkBuild` grades it and
 * `gradedKey` serializes it, so they can't disagree. In logs mode span entries carry only
 * `spanId` and `{logId, spanId}` entries follow, per record in spec order.
 */
export function gradedState(spec, st) {
  if (isLogMode(spec)) {
    // Spans are read-only here; the records are what is graded, in spec order.
    const spans = spec.spans.map((s) => ({ spanId: s.spanId }));
    return [...spans, ...spec.logs.map((l) => ({ logId: l.id, spanId: st.logs[l.id] }))];
  }
  return spec.spans.map((s) => {
    const e = st.spans[s.spanId];
    const g = { spanId: s.spanId };
    for (const name of EDITS) {
      if (!spec.edit.includes(name)) continue;
      g[FIELD[name]] = name === 'links' ? linkSet(e.links) : e[FIELD[name]];
    }
    return g;
  });
}

/** A string equal for two states exactly when `checkBuild` grades them the same way. */
export const gradedKey = (spec, st) => JSON.stringify(gradedState(spec, st));

/**
 * Grade `st` against the answer, editable fields only: `{ok, issues: [{code, spanId,
 * message}]}` in spec order, per span parent, kind, status, then links. A parent in
 * another trace is 'cross-trace-parent' (never also 'wrong-parent'). Messages name the
 * span (data text, so escape them) and never reveal the answer. In logs mode the issues
 * are `{code, logId, message}`, see `checkLogRecords`.
 */
export function checkBuild(spec, st) {
  if (isLogMode(spec)) return checkLogRecords(spec, st);
  const byId = new Map(spec.spans.map((s) => [s.spanId, s]));
  const graded = new Map(gradedState(spec, st).map((g) => [g.spanId, g]));
  const label = (s) => `${s.name} (${s.service})`;
  const issues = [];
  const add = (code, s, text) => issues.push({ code, spanId: s.spanId, message: `${label(s)}: ${text}` });
  const edit = (name) => spec.edit.includes(name);
  for (const given of spec.spans) {
    const s = { ...given, ...graded.get(given.spanId) };
    if (edit('parent')) {
      const p = s.parentId === null ? undefined : byId.get(s.parentId);
      if (p && p.traceId !== s.traceId) {
        add('cross-trace-parent', s, "its parent is in another trace. A parent always shares its child's trace ID.");
      } else if (s.parentId !== expected(spec, given, 'parentId')) {
        add('wrong-parent', s, 'the parent is not right.');
      }
    }
    if (edit('kind') && s.kind !== expected(spec, given, 'kind')) add('wrong-kind', s, 'the kind is not right.');
    if (edit('status') && s.status !== expected(spec, given, 'status')) add('wrong-status', s, 'the status is not right.');
    if (edit('links')) {
      const want = linkSet(expected(spec, given, 'links'));
      for (const id of want) if (!s.links.includes(id)) add('missing-link', s, 'a link is missing.');
      for (const id of s.links) {
        if (!want.includes(id)) add('extra-link', s, `links ${label(byId.get(id))}, which it should not.`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Grade the records of a logs-mode spec: at most one issue per record, in spec order, the
 * first that applies (rule codes win over answer codes; `a` is the attached span, `w` the
 * expected one): log-other-service (`a` is another service's), log-outside-span (the time is
 * outside `a`, inclusive), log-no-active-span (`a` set, `w` null), log-wrong-trace (`w` is in
 * another trace than `a`), log-wrong-span (same trace), log-not-attached (`a` null, `w` set).
 * Messages state facts about the chosen span, never the expected one. Escape them (data text).
 */
function checkLogRecords(spec, st) {
  const byId = new Map(spec.spans.map((s) => [s.spanId, s]));
  const graded = new Map(gradedState(spec, st).filter((g) => g.logId).map((g) => [g.logId, g.spanId]));
  const label = (s) => `${s.name} (${s.service})`;
  const issues = [];
  for (const l of spec.logs) {
    const a = byId.get(graded.get(l.id)) ?? null;
    const w = byId.get(spec.answer[l.id]) ?? null;
    const add = (code, text) => issues.push({ code, logId: l.id, message: `"${l.body}" (${l.service}, ${l.timeMs} ms): ${text}` });
    if (a && a.service !== l.service) add('log-other-service', `${label(a)} is a span of another service.`);
    else if (a && (l.timeMs < a.startMs || l.timeMs > a.endMs)) {
      add('log-outside-span', `${label(a)} ran ${a.startMs} to ${a.endMs} ms and this record is outside that window.`);
    } else if (a && !w) add('log-no-active-span', 'it was not written while a span was active, so it carries no span context.');
    else if (a && w && w !== a && w.traceId !== a.traceId) {
      add('log-wrong-trace', `${label(a)} is in a different trace from the one this record belongs to.`);
    } else if (a && w && w !== a) {
      add('log-wrong-span', `${label(a)} is in the right trace but is not the span this record was logged in.`);
    } else if (!a && w) add('log-not-attached', 'it has no span context yet.');
  }
  return { ok: issues.length === 0, issues };
}
