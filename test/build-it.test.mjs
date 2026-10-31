// lib/widgets/build-it.mjs: the Build it core (validate, edit, check, apply).
// Spec: docs/M1-DESIGN.md §4.2, §7 P5. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyState,
  checkBuild,
  gradedKey,
  newBuildState,
  setKind,
  setParent,
  setStatus,
  toggleLink,
  validateBuildSpec,
} from '../lib/widgets/build-it.mjs';
import { A, B, C, D, E, b1Spec } from './fixtures/build-b1.mjs';

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
    'edit: "name" is not one of parent, kind, status, links',
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
  assert.equal(has(problems, 'edit: expected at least one of parent, kind, status, links'), true);
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
