// lib/widgets/build-it.mjs: the Build it core (validate, edit, check, apply).
// Spec: docs/M1-DESIGN.md §4.2, §7 P5. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLogs,
  applyState,
  attachLog,
  checkBuild,
  gradedKey,
  gradedState,
  isLogMode,
  newBuildState,
  recordsBySpan,
  setKind,
  setParent,
  setStatus,
  toggleLink,
  validateBuildSpec,
} from '../lib/widgets/build-it.mjs';
import { A, B, C, D, E, b1Spec } from './fixtures/build-b1.mjs';
import { S1, S2, S3, S4, T1, T2, logsSpec } from './fixtures/build-logs.mjs';

function deepFreeze(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

const SPEC = deepFreeze(b1Spec());
const has = (problems, text) => problems.some((p) => p.includes(text));
const parents = (spec, st) => applyState(spec, st).map((s) => s.parentId);
const codes = (result) => result.issues.map((i) => `${i.code}:${i.spanId}`);

/** B1 with every field editable and an answer touching all four. */
function allSpec() {
  const spec = b1Spec();
  spec.edit = ['parent', 'kind', 'status', 'links'];
  spec.answer = {
    [B]: { parentId: A, status: 'ERROR' },
    [C]: { parentId: B },
    [D]: { parentId: C, kind: 'CLIENT' },
    [E]: { links: [A] },
  };
  return spec;
}

/** A state with the answer of `spec` applied through the public setters. */
function solved(spec) {
  const st = newBuildState(spec);
  for (const [id, want] of Object.entries(spec.answer)) {
    if ('parentId' in want) setParent(spec, st, id, want.parentId);
    if ('kind' in want) setKind(spec, st, id, want.kind);
    if ('status' in want) setStatus(spec, st, id, want.status);
    for (const l of want.links ?? []) toggleLink(spec, st, id, l);
  }
  return st;
}

// validateBuildSpec

test('validateBuildSpec: fixture B1 and the all-fields spec are valid', () => {
  assert.deepEqual(validateBuildSpec(SPEC), []);
  assert.deepEqual(validateBuildSpec(allSpec()), []);
  assert.deepEqual(validateBuildSpec({ ...b1Spec(), hint: 'Look at the <code>parent</code> ids.' }), []);
});

test('validateBuildSpec reports every id, time, kind and status problem at once', () => {
  const spec = b1Spec();
  spec.id = 'Not Kebab';
  spec.spans[0].spanId = '00F067AA0BA902B7'; // uppercase
  spec.spans[1].spanId = 'b7ad6b716920333'; // 15 hex
  spec.spans[2].traceId = '4bf92f3577b34da6a3ce929d0e0e473'; // 31 hex
  spec.spans[3].spanId = E; // duplicate of E
  spec.spans[3].endMs = 19; // before its start (20)
  spec.spans[4].kind = 'server';
  spec.spans[4].status = 'FAILED';
  spec.edit = ['parent', 'name'];
  const problems = validateBuildSpec(spec);
  for (const text of [
    'spec id "Not Kebab" is not kebab-case',
    'span 0: spanId "00F067AA0BA902B7" is not 16 lowercase hex',
    'span 1: spanId "b7ad6b716920333" is not 16 lowercase hex',
    'span 2: traceId "4bf92f3577b34da6a3ce929d0e0e473" is not 32 lowercase hex',
    `duplicate spanId "${E}"`,
    'span 3: endMs 19 is before startMs 20',
    'span 4: kind "server" is not one of SERVER, CLIENT, PRODUCER, CONSUMER, INTERNAL',
    'span 4: status "FAILED" is not one of UNSET, ERROR, OK',
    'edit: "name" is not one of parent, kind, status, links, logs',
  ]) assert.equal(has(problems, text), true, text);
});

test('validateBuildSpec: an answer must name known spans, editable fields and valid values', () => {
  const spec = b1Spec();
  spec.answer = {
    ffffffffffffffff: { parentId: A },
    [B]: { parentId: '0123456789abcdef', kind: 'CLIENT' },
  };
  const problems = validateBuildSpec(spec);
  assert.equal(has(problems, 'answer: unknown span "ffffffffffffffff"'), true);
  assert.equal(has(problems, `answer ${B}: parentId "0123456789abcdef" is not a span`), true);
  assert.equal(has(problems, `answer ${B}: kind is not editable`), true);
});

test('validateBuildSpec: a given link must be a known span other than itself, listed once', () => {
  const spec = b1Spec();
  spec.spans[1].links = ['ffffffffffffffff'];
  spec.spans[2].links = [C];
  spec.spans[3].links = [A, A];
  assert.deepEqual(validateBuildSpec(spec), [
    'span 1: link "ffffffffffffffff" is not a span',
    'span 2: links to itself',
    `span 3: duplicate link "${A}"`,
  ]);
});

test('validateBuildSpec: an answer link must be a known span other than itself, listed once', () => {
  const spec = b1Spec();
  spec.edit = ['parent', 'links'];
  spec.answer = { [A]: { links: ['ffffffffffffffff'] }, [B]: { links: [B] }, [C]: { links: [A, A] }, [D]: { links: 'x' } };
  assert.deepEqual(validateBuildSpec(spec), [
    `answer ${A}: link "ffffffffffffffff" is not a span`,
    `answer ${B}: links to itself`,
    `answer ${C}: duplicate link "${A}"`,
    `answer ${D}: links is not a list of span ids`,
  ]);
});

test('validateBuildSpec refuses an answer that makes a loop', () => {
  const spec = b1Spec();
  spec.answer = { [A]: { parentId: D }, [B]: { parentId: A }, [C]: { parentId: B }, [D]: { parentId: C } };
  const problems = validateBuildSpec(spec);
  assert.equal(has(problems, 'answer makes a loop'), true);
});

test('validateBuildSpec refuses an answer that fails its own checker (I7)', () => {
  const spec = b1Spec();
  spec.answer[E] = { parentId: C }; // a parent in another trace
  assert.deepEqual(validateBuildSpec(spec), [`answer does not pass checkBuild: cross-trace-parent ${E}`]);
});

test('validateBuildSpec: not an object, empty spans, empty edit', () => {
  assert.deepEqual(validateBuildSpec(null), ['spec: not an object']);
  const problems = validateBuildSpec({ id: 'x', spans: [], edit: [], answer: {} });
  assert.equal(has(problems, 'spans: expected at least one span'), true);
  assert.equal(has(problems, 'edit: expected at least one of parent, kind, status, links, logs'), true);
});

// newBuildState, setParent

test('the reference answer of fixture B1 passes its own checker (I7)', () => {
  const st = solved(SPEC);
  assert.deepEqual(checkBuild(SPEC, st), { ok: true, issues: [] });
  assert.deepEqual(parents(SPEC, st), [null, A, B, C, null]);
  const all = allSpec();
  assert.deepEqual(checkBuild(all, solved(all)), { ok: true, issues: [] });
});

test('newBuildState starts from the given spans and never writes to the spec', () => {
  const st = newBuildState(SPEC);
  assert.deepEqual(parents(SPEC, st), [null, null, null, null, null]);
  assert.equal(setParent(SPEC, st, B, A), 'set');
  assert.deepEqual(parents(SPEC, st), [null, A, null, null, null]);
  assert.equal(SPEC.spans[1].parentId, null);
  assert.deepEqual(parents(SPEC, newBuildState(SPEC)), [null, null, null, null, null], 'a new state is fresh');
});

test('setParent: set, back to root, self and unknown', () => {
  const st = newBuildState(SPEC);
  assert.equal(setParent(SPEC, st, C, A), 'set');
  assert.equal(setParent(SPEC, st, C, null), 'set');
  assert.equal(parents(SPEC, st)[2], null);
  assert.equal(setParent(SPEC, st, C, C), 'self');
  assert.equal(setParent(SPEC, st, 'ffffffffffffffff', A), 'unknown');
  assert.equal(setParent(SPEC, st, C, 'ffffffffffffffff'), 'unknown');
  assert.deepEqual(parents(SPEC, st), [null, null, null, null, null], 'refusals change nothing');
});

test('setParent refuses a cycle, direct or through a chain, and changes nothing', () => {
  const st = solved(SPEC); // A <- B <- C <- D
  assert.equal(setParent(SPEC, st, C, D), 'cycle', 'direct child');
  assert.equal(setParent(SPEC, st, A, D), 'cycle', 'three levels down');
  assert.deepEqual(parents(SPEC, st), [null, A, B, C, null]);
  assert.equal(setParent(SPEC, st, D, A), 'set', 'moving a span up is not a loop');
  assert.equal(setParent(SPEC, st, C, D), 'set', 'nor is moving under a former child');
  assert.deepEqual(parents(SPEC, st), [null, A, D, A, null]);
});

// setKind, setStatus, toggleLink

test('setKind and setStatus: set, invalid, unknown', () => {
  const st = newBuildState(SPEC);
  assert.equal(setKind(SPEC, st, D, 'CLIENT'), 'set');
  assert.equal(setKind(SPEC, st, D, 'client'), 'invalid');
  assert.equal(setKind(SPEC, st, 'ffffffffffffffff', 'CLIENT'), 'unknown');
  assert.equal(setStatus(SPEC, st, D, 'ERROR'), 'set');
  assert.equal(setStatus(SPEC, st, D, 'Error'), 'invalid');
  assert.equal(setStatus(SPEC, st, 'ffffffffffffffff', 'OK'), 'unknown');
  const d = applyState(SPEC, st)[3];
  assert.deepEqual([d.kind, d.status], ['CLIENT', 'ERROR']);
});

test('toggleLink: linked, unlinked, self, unknown', () => {
  const st = newBuildState(SPEC);
  assert.equal(toggleLink(SPEC, st, E, A), 'linked');
  assert.equal(toggleLink(SPEC, st, E, C), 'linked');
  assert.deepEqual(applyState(SPEC, st)[4].links, [A, C]);
  assert.equal(toggleLink(SPEC, st, E, A), 'unlinked');
  assert.deepEqual(applyState(SPEC, st)[4].links, [C]);
  assert.equal(toggleLink(SPEC, st, E, E), 'self');
  assert.equal(toggleLink(SPEC, st, E, 'ffffffffffffffff'), 'unknown');
  assert.equal(toggleLink(SPEC, st, 'ffffffffffffffff', E), 'unknown');
  assert.deepEqual(applyState(SPEC, st)[4].links, [C]);
});

// applyState

test('applyState: spans in spec order with the state applied, copies that do not alias the state', () => {
  const st = solved(SPEC);
  const out = applyState(SPEC, st);
  assert.deepEqual(out.map((s) => s.spanId), [A, B, C, D, E]);
  assert.deepEqual(out.map((s) => s.name), ['POST /checkout', 'POST api-gateway', 'POST /checkout', 'validate cart', 'GET /products']);
  assert.equal(out[1].parentId, A);
  out[1].parentId = null;
  out[4].links.push(A);
  assert.equal(applyState(SPEC, st)[1].parentId, A);
  assert.deepEqual(applyState(SPEC, st)[4].links, []);
});

// checkBuild

test('checkBuild: wrong-parent for each span off its answer, in spec order, without naming the answer', () => {
  const st = newBuildState(SPEC);
  setParent(SPEC, st, C, A); // should be B
  const result = checkBuild(SPEC, st);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [`wrong-parent:${B}`, `wrong-parent:${C}`, `wrong-parent:${D}`]);
  assert.equal(result.issues[1].message, 'POST /checkout (api-gateway): the parent is not right.');
});

test('checkBuild: a parent in another trace is cross-trace-parent, not wrong-parent', () => {
  const st = solved(SPEC);
  setParent(SPEC, st, E, C);
  setParent(SPEC, st, D, E); // D under E: also across traces
  const result = checkBuild(SPEC, st);
  assert.deepEqual(codes(result), [`cross-trace-parent:${D}`, `cross-trace-parent:${E}`]);
  assert.equal(result.issues[1].message, 'GET /products (storefront): its parent is in another trace. A parent always shares its child\'s trace ID.');
});

test('checkBuild: wrong-kind, wrong-status, missing-link and extra-link', () => {
  const spec = allSpec();
  const st = solved(spec);
  setKind(spec, st, D, 'INTERNAL');
  setStatus(spec, st, B, 'OK');
  toggleLink(spec, st, E, A); // removes the answer link
  toggleLink(spec, st, E, B); // adds a wrong one
  toggleLink(spec, st, A, C); // a link where none belongs
  const result = checkBuild(spec, st);
  assert.deepEqual(codes(result), [`extra-link:${A}`, `wrong-status:${B}`, `wrong-kind:${D}`, `missing-link:${E}`, `extra-link:${E}`]);
  assert.deepEqual(result.issues.map((i) => i.message), [
    'POST /checkout (storefront): links POST /checkout (api-gateway), which it should not.',
    'POST api-gateway (storefront): the status is not right.',
    'validate cart (api-gateway): the kind is not right.',
    'GET /products (storefront): a link is missing.',
    'GET /products (storefront): links POST api-gateway (storefront), which it should not.',
  ]);
});

test('gradedKey: links are a set, so the order they were added in does not matter', () => {
  const spec = allSpec();
  const one = newBuildState(spec);
  toggleLink(spec, one, E, B);
  toggleLink(spec, one, E, C);
  const two = newBuildState(spec);
  toggleLink(spec, two, E, C);
  toggleLink(spec, two, E, B);
  assert.equal(gradedKey(spec, one), gradedKey(spec, two));
  assert.deepEqual(codes(checkBuild(spec, one)), codes(checkBuild(spec, two)));
  toggleLink(spec, two, E, B);
  assert.notEqual(gradedKey(spec, one), gradedKey(spec, two), 'a different set is a different key');
  const three = newBuildState(spec);
  toggleLink(spec, three, E, B);
  toggleLink(spec, three, E, C);
  setKind(spec, three, A, 'CLIENT');
  assert.notEqual(gradedKey(spec, one), gradedKey(spec, three), 'a graded field changed');
  spec.edit = ['parent', 'status', 'links'];
  assert.equal(gradedKey(spec, one), gradedKey(spec, three), 'an ungraded field is not in the key');
});

test('checkBuild grades only the edit fields', () => {
  const st = solved(SPEC);
  setKind(SPEC, st, A, 'CLIENT');
  setStatus(SPEC, st, A, 'ERROR');
  toggleLink(SPEC, st, A, E);
  assert.deepEqual(checkBuild(SPEC, st), { ok: true, issues: [] });
  const spec = allSpec();
  spec.edit = ['kind'];
  spec.answer = { [D]: { kind: 'CLIENT' } };
  const st2 = newBuildState(spec);
  setKind(spec, st2, D, 'CLIENT');
  setParent(spec, st2, E, C); // cross-trace, but parents are not graded here
  assert.deepEqual(checkBuild(spec, st2), { ok: true, issues: [] });
});

// ---- logs mode (#113): fixture L1 --------------------------------------------------

const LSPEC = deepFreeze(logsSpec());
const NONE = 'ffffffffffffffff';
const lcodes = (result) => result.issues.map((i) => `${i.code}:${i.logId}`);
/** A state of `spec` with every record attached as in `spec.answer`, through attachLog. */
function lsolved(spec) {
  const st = newBuildState(spec);
  for (const [id, span] of Object.entries(spec.answer)) attachLog(spec, st, id, span);
  return st;
}
/** A spec with one record at `timeMs` attached to S3 in the answer (spans of L1). */
function oneLog(timeMs) {
  const spec = logsSpec();
  spec.logs = [{ ...spec.logs[3], timeMs }];
  spec.answer = { 'l-charge': S3 };
  return spec;
}

test('A1 logs mode: isLogMode, and fixture L1 validates (frozen, no early output)', () => {
  assert.deepEqual(validateBuildSpec(LSPEC), []);
  assert.equal(isLogMode(LSPEC), true);
  assert.equal(isLogMode(SPEC), false);
  assert.equal(isLogMode({ edit: ['logs', 'parent'] }), false, 'logs mode is exactly ["logs"]');
  assert.equal(isLogMode(null), false);
  assert.deepEqual(validateBuildSpec({ ...logsSpec(), hint: 'Look at the <code>order.id</code>.', explain: 'Because.' }), []);
  assert.deepEqual(validateBuildSpec({ ...logsSpec(), explain: ' ' }), ['explain: not non-empty text']);
});

test('A2 logs is its own mode: it cannot share edit with span fields', () => {
  for (const edit of [['logs', 'parent'], ['kind', 'logs']]) {
    const spec = logsSpec();
    spec.edit = edit;
    assert.equal(has(validateBuildSpec(spec), 'edit: logs is its own mode; edit span fields in another step'), true, edit.join());
  }
  const dup = logsSpec();
  dup.edit = ['logs', 'logs'];
  assert.equal(has(validateBuildSpec(dup), 'edit: duplicate field'), true);
});

test('A3 every record field fault is reported at once, each with its record index', () => {
  const spec = logsSpec();
  const [l0, l1, l2, l3, l4] = spec.logs;
  l0.id = 'Not Kebab';
  l1.id = S2; // also a span id
  l2.timeMs = 'x';
  l3.id = 'l-other'; // duplicate of l2's id
  l3.severity = 'LOUD';
  l3.service = ' ';
  l3.body = '';
  l4.traceId = 'abc';
  l4.spanId = undefined;
  l4.attributes = [];
  spec.logs[0].attributes = { 'thread.name': { a: 1 }, ok: true, n: Infinity };
  const problems = validateBuildSpec(spec);
  for (const text of [
    'log 0: id "Not Kebab" is not kebab-case',
    `log 1: id "${S2}" is also a span id`,
    'duplicate log id "l-other"',
    'log 2: timeMs "x" is not a finite number',
    'log 3: severity "LOUD" is not one of TRACE, DEBUG, INFO, WARN, ERROR, FATAL',
    'log 3: service is not non-empty text',
    'log 3: body is not non-empty text',
    'log 4: traceId "abc" is not 32 lowercase hex or null',
    'log 4: spanId undefined is not 16 lowercase hex or null',
    'log 4: attributes is not an object',
    'log 0: attribute "thread.name" is not text, a finite number or a boolean',
    'log 0: attribute "n" is not text, a finite number or a boolean',
  ]) assert.equal(has(problems, text), true, `${text}\n  got: ${JSON.stringify(problems)}`);
  assert.equal(has(problems, 'attribute "ok"'), false, 'a boolean attribute is fine');
});

test('A4 logs and edit are coupled; 1 to 12 records in non-decreasing time', () => {
  const none = logsSpec();
  delete none.logs;
  assert.equal(has(validateBuildSpec(none), 'logs: required when edit is logs'), true);
  const span = b1Spec();
  span.logs = logsSpec().logs;
  assert.equal(has(validateBuildSpec(span), 'logs: only allowed when edit is logs'), true);
  const empty = logsSpec();
  empty.logs = [];
  empty.answer = {};
  assert.equal(has(validateBuildSpec(empty), 'logs: expected 1 to 12 records'), true);
  const many = logsSpec();
  many.logs = Array.from({ length: 13 }, (_, i) => ({ ...many.logs[0], id: `l-${i}` }));
  assert.equal(has(validateBuildSpec(many), 'logs: expected 1 to 12 records'), true);
  const back = logsSpec();
  back.logs[2].timeMs = 10; // after 30
  assert.equal(has(validateBuildSpec(back), 'log 2: timeMs 10 is earlier than the record before it (30); records go in time order'), true);
  const equal = logsSpec();
  equal.logs[2].timeMs = 30; // equal times are fine: spec order decides
  assert.deepEqual(validateBuildSpec(equal), []);
  const text = logsSpec();
  text.logs = 'x';
  assert.equal(has(validateBuildSpec(text), 'logs: not a list'), true);
});

test('A5 the answer lists every record once; null is "no span", "none" is refused, unknown keys named', () => {
  const miss = logsSpec();
  delete miss.answer['l-cart'];
  assert.equal(has(validateBuildSpec(miss), 'answer: log "l-cart" is not listed'), true);
  const extra = logsSpec();
  extra.answer.ghost = null;
  assert.equal(has(validateBuildSpec(extra), 'answer: unknown log "ghost"'), true);
  const none = logsSpec();
  none.answer['l-boot'] = 'none';
  assert.equal(has(validateBuildSpec(none), 'answer l-boot: "none" is not a span id; use null for no span context'), true);
  const unknown = logsSpec();
  unknown.answer['l-cart'] = NONE;
  assert.equal(has(validateBuildSpec(unknown), `answer l-cart: "${NONE}" is not a span`), true);
  const odd = logsSpec();
  odd.answer['l-cart'] = undefined;
  odd.answer['l-other'] = 7;
  const problems = validateBuildSpec(odd);
  assert.equal(has(problems, 'answer l-cart: expected a span id or null'), true);
  assert.equal(has(problems, 'answer l-other: expected a span id or null'), true);
  const idle = logsSpec();
  idle.answer = { 'l-boot': null, 'l-cart': null, 'l-other': null, 'l-charge': null, 'l-worker': null };
  assert.deepEqual(validateBuildSpec(idle), ['logs: nothing to do, every record is unlinked in both the given state and the answer']);
  const notObj = logsSpec();
  notObj.answer = null;
  assert.equal(has(validateBuildSpec(notObj), 'answer: not an object'), true);
});

test('A6 I7: the log answer is applied before the check, so rule codes catch a bad reference answer', () => {
  const spec = logsSpec();
  spec.answer['l-boot'] = S1; // -40 ms is outside S1
  assert.deepEqual(validateBuildSpec(spec), ['answer does not pass checkBuild: log-outside-span l-boot']);
  const other = logsSpec();
  other.answer['l-charge'] = S2; // a checkout span for a payments record
  assert.deepEqual(validateBuildSpec(other), ['answer does not pass checkBuild: log-other-service l-charge']);
  const both = logsSpec();
  both.answer['l-boot'] = S3; // wrong service and outside: the service rule is first
  assert.deepEqual(validateBuildSpec(both), ['answer does not pass checkBuild: log-other-service l-boot']);
  assert.deepEqual(checkBuild(LSPEC, lsolved(LSPEC)), { ok: true, issues: [] });
});

test('A7 attachLog and applyLogs derive the trace from the span, never store it', () => {
  const st = newBuildState(LSPEC);
  assert.deepEqual(st.logs, { 'l-boot': null, 'l-cart': null, 'l-other': null, 'l-charge': null, 'l-worker': null });
  assert.equal(attachLog(LSPEC, st, 'l-other', S4), 'attached');
  const other = applyLogs(LSPEC, st).find((l) => l.id === 'l-other');
  assert.deepEqual([other.spanId, other.traceId], [S4, T2], 'S4 is in T2, not T1');
  assert.equal(attachLog(LSPEC, st, 'l-other', S1), 'attached', 're-attaching moves it');
  assert.equal(applyLogs(LSPEC, st).find((l) => l.id === 'l-other').traceId, T1);
  assert.equal(attachLog(LSPEC, st, 'l-other', null), 'detached');
  const detached = applyLogs(LSPEC, st).find((l) => l.id === 'l-other');
  assert.deepEqual([detached.spanId, detached.traceId], [null, null], 'both ids or neither');
  // Refusals run against attached records, so one that cleared or moved a record would show.
  assert.equal(attachLog(LSPEC, st, 'l-other', S4), 'attached');
  assert.equal(attachLog(LSPEC, st, 'l-charge', S3), 'attached');
  const before = gradedKey(LSPEC, st);
  const refusals = [
    ['l-other', NONE],
    ['l-other', 'none'],
    ['l-other', undefined],
    ['l-other', 7],
    ['ghost', S1],
    ['constructor', S1],
    [undefined, S1],
  ];
  for (const [id, span] of refusals) {
    assert.equal(attachLog(LSPEC, st, id, span), 'unknown', `${id} ${span}`);
    assert.deepEqual(st.logs, { 'l-boot': null, 'l-cart': null, 'l-other': S4, 'l-charge': S3, 'l-worker': null }, `${id} ${span} changes nothing`);
    assert.equal(gradedKey(LSPEC, st), before, `${id} ${span}: the graded key is unchanged`);
  }
  assert.equal(LSPEC.logs[2].spanId, null, 'the frozen spec is never written');
  const out = applyLogs(LSPEC, st);
  out[0].attributes['thread.name'] = 'x';
  assert.equal(applyLogs(LSPEC, st)[0].attributes['thread.name'], 'main', 'copies, not aliases');
  assert.deepEqual(applyLogs(LSPEC, st).map((l) => l.id), ['l-boot', 'l-cart', 'l-other', 'l-charge', 'l-worker'], 'spec order');
});

test('A7b a record given attached starts attached, with the ids derived', () => {
  const spec = logsSpec();
  spec.logs[1].spanId = S2;
  spec.logs[1].traceId = T1;
  assert.deepEqual(validateBuildSpec(spec), []);
  const st = newBuildState(spec);
  assert.equal(st.logs['l-cart'], S2);
  assert.deepEqual(applyLogs(spec, st)[1].spanId, S2);
});

test('A8 span mode is byte-identical: gradedKey and gradedState carry no log entries', () => {
  // Literals captured from main (ac3ab15) before the logs change.
  assert.equal(
    gradedKey(SPEC, newBuildState(SPEC)),
    '[{"spanId":"00f067aa0ba902b7","parentId":null},{"spanId":"b7ad6b7169203331","parentId":null},{"spanId":"53995c3f42cd8ad8","parentId":null},{"spanId":"1d5c3a2f8e4b6a90","parentId":null},{"spanId":"9e1f2a3b4c5d6e7f","parentId":null}]',
  );
  const all = allSpec();
  assert.equal(
    gradedKey(all, newBuildState(all)),
    '[{"spanId":"00f067aa0ba902b7","parentId":null,"kind":"SERVER","status":"UNSET","links":[]},{"spanId":"b7ad6b7169203331","parentId":null,"kind":"CLIENT","status":"UNSET","links":[]},{"spanId":"53995c3f42cd8ad8","parentId":null,"kind":"SERVER","status":"UNSET","links":[]},{"spanId":"1d5c3a2f8e4b6a90","parentId":null,"kind":"INTERNAL","status":"UNSET","links":[]},{"spanId":"9e1f2a3b4c5d6e7f","parentId":null,"kind":"SERVER","status":"UNSET","links":[]}]',
  );
});

test('A9 checkBuild log codes: one issue per record, rule codes win, messages never name the answer', () => {
  const st = newBuildState(LSPEC);
  attachLog(LSPEC, st, 'l-boot', S3); // wrong service AND outside: service first
  attachLog(LSPEC, st, 'l-cart', S1); // inside S1, same service, but the answer is S2
  attachLog(LSPEC, st, 'l-other', S1); // same service, outside? 60 is inside S1: wrong trace (answer S4 is T2)
  attachLog(LSPEC, st, 'l-charge', S3); // right
  attachLog(LSPEC, st, 'l-worker', S3); // right service and window, but no span was active
  const result = checkBuild(LSPEC, st);
  assert.deepEqual(lcodes(result), ['log-other-service:l-boot', 'log-wrong-span:l-cart', 'log-wrong-trace:l-other', 'log-no-active-span:l-worker']);
  assert.deepEqual(result.issues.map((i) => i.message), [
    '"Application started" (checkout, -40 ms): POST /charge (payments) is a span of another service.',
    '"Cart validated" (checkout, 30 ms): POST /checkout (checkout) is in the right trace but is not the span this record was logged in.',
    '"Order accepted" (checkout, 60 ms): POST /checkout (checkout) is in a different trace from the one this record belongs to.',
    '"Retry worker gave up on charge" (payments, 75 ms): it was not written while a span was active, so it carries no span context.',
  ]);
  const outside = newBuildState(LSPEC);
  attachLog(LSPEC, outside, 'l-boot', S1); // -40 is outside 0..100
  assert.deepEqual(lcodes(checkBuild(LSPEC, outside)).slice(0, 1), ['log-outside-span:l-boot']);
  assert.equal(checkBuild(LSPEC, outside).issues[0].message, '"Application started" (checkout, -40 ms): POST /checkout (checkout) ran 0 to 100 ms and this record is outside that window.');
  const missing = checkBuild(LSPEC, newBuildState(LSPEC));
  assert.deepEqual(lcodes(missing), ['log-not-attached:l-cart', 'log-not-attached:l-other', 'log-not-attached:l-charge']);
  assert.equal(missing.issues[0].message, '"Cart validated" (checkout, 30 ms): it has no span context yet.');
  for (const i of result.issues) assert.equal(i.message.includes('validate cart'), false, 'never names the expected span');
  assert.equal(Object.keys(result.issues[0]).sort().join(), 'code,logId,message');
});

test('A10 the time window is inclusive: 50 and 90 pass, 49 and 91 are outside S3', () => {
  for (const t of [50, 90]) {
    const spec = oneLog(t);
    assert.deepEqual(checkBuild(spec, lsolved(spec)), { ok: true, issues: [] }, `${t}`);
  }
  for (const t of [49, 91]) {
    const spec = oneLog(t);
    assert.deepEqual(lcodes(checkBuild(spec, lsolved(spec))), ['log-outside-span:l-charge'], `${t}`);
  }
});

test('A11 gradedKey includes the records, not the attach order, and not the span state', () => {
  const one = newBuildState(LSPEC);
  attachLog(LSPEC, one, 'l-cart', S2);
  attachLog(LSPEC, one, 'l-charge', S3);
  const two = newBuildState(LSPEC);
  attachLog(LSPEC, two, 'l-charge', S3);
  attachLog(LSPEC, two, 'l-cart', S2);
  assert.equal(gradedKey(LSPEC, one), gradedKey(LSPEC, two));
  attachLog(LSPEC, two, 'l-cart', S1);
  assert.notEqual(gradedKey(LSPEC, one), gradedKey(LSPEC, two), 'a different span for one record');
  attachLog(LSPEC, two, 'l-cart', null);
  assert.notEqual(gradedKey(LSPEC, one), gradedKey(LSPEC, two), 'detached differs from attached');
  const spans = newBuildState(LSPEC);
  const before = gradedKey(LSPEC, spans);
  setKind(LSPEC, spans, S1, 'CLIENT');
  assert.equal(gradedKey(LSPEC, spans), before, 'spans are not graded in logs mode');
  assert.deepEqual(gradedState(LSPEC, one), [
    { spanId: S1 }, { spanId: S2 }, { spanId: S3 }, { spanId: S4 },
    { logId: 'l-boot', spanId: null }, { logId: 'l-cart', spanId: S2 }, { logId: 'l-other', spanId: null },
    { logId: 'l-charge', spanId: S3 }, { logId: 'l-worker', spanId: null },
  ]);
});

test('A12 recordsBySpan: every span is a key, [] for none, records in spec order', () => {
  const st = newBuildState(LSPEC);
  assert.deepEqual(Object.keys(recordsBySpan(LSPEC, st)).sort(), [S1, S2, S3, S4].sort());
  assert.equal(Object.values(recordsBySpan(LSPEC, st)).every((l) => l.length === 0), true);
  attachLog(LSPEC, st, 'l-charge', S3);
  attachLog(LSPEC, st, 'l-worker', S3);
  attachLog(LSPEC, st, 'l-other', S4);
  const by = recordsBySpan(LSPEC, st);
  assert.deepEqual(by[S3].map((l) => l.id), ['l-charge', 'l-worker']);
  assert.deepEqual(by[S3].map((l) => l.spanId), [S3, S3]);
  assert.deepEqual([by[S4][0].id, by[S4][0].traceId], ['l-other', T2]);
  assert.deepEqual(by[S1], []);
});

test('A13 id pairing: both or neither, on the board, in the span\'s trace, never all zeros', () => {
  const cases = [
    [(l) => { l.traceId = T1; }, 'log 1: traceId and spanId must both be set or both be null'],
    [(l) => { l.spanId = S2; }, 'log 1: traceId and spanId must both be set or both be null'],
    [(l) => { l.traceId = T1; l.spanId = NONE; }, `log 1: spanId "${NONE}" is not a span`],
    [(l) => { l.traceId = T2; l.spanId = S2; }, `log 1: traceId is not the trace of span "${S2}"`],
    [(l) => { l.traceId = '0'.repeat(32); l.spanId = S2; }, 'log 1: traceId is all zeros'],
    [(l) => { l.traceId = T1; l.spanId = '0'.repeat(16); }, 'log 1: spanId is all zeros'],
  ];
  for (const [edit, want] of cases) {
    const spec = logsSpec();
    edit(spec.logs[1]);
    const got = validateBuildSpec(spec);
    assert.equal(has(got, want), true, `${want}\n  got: ${JSON.stringify(got)}`);
  }
  const ok = logsSpec();
  ok.logs[1].traceId = T1;
  ok.logs[1].spanId = S2;
  assert.deepEqual(validateBuildSpec(ok), []);
});
