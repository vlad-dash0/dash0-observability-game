// lib/widgets/build-it-help.mjs: the Build it help ladder, pure (#146). The helps a spec
// declares, arrival order, drop targets while a span moves, the specific note per checkBuild
// code, and the three hint tiers, all derived from the spec, its answer and checkBuild (no
// second grader). Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { attachLog, checkBuild, newBuildState, setKind, setParent, setStatus, toggleLink } from '../lib/widgets/build-it.mjs';
import {
  arrivalOrder,
  buildHelps,
  hintFor,
  hintTarget,
  initialPlaced,
  moveMarks,
  noteFor,
  validateBuildHelps,
} from '../lib/widgets/build-it-help.mjs';
import { A, B, C, D, E, b1Spec } from './fixtures/build-b1.mjs';
import { S1, S2, S3, S4, logsSpec } from './fixtures/build-logs.mjs';

const ALL = { queue: true, tint: true, guide: true, instant: true, hints: true };
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const issueOf = (spec, st, id) => checkBuild(spec, st).issues.find((i) => (i.spanId ?? i.logId) === id);
const note = (spec, st, id) => text(noteFor(spec, st, issueOf(spec, st, id), escapeHtml));

test('buildHelps: a spec without helps gets Check and hints only when it has an authored hint', () => {
  assert.deepEqual(buildHelps(b1Spec()), { queue: false, tint: false, guide: false, instant: false, hints: false });
  assert.deepEqual(buildHelps({ ...b1Spec(), hint: 'Look up.' }), { queue: false, tint: false, guide: false, instant: false, hints: true });
  assert.deepEqual(buildHelps({ ...logsSpec(), hint: 'x' }).hints, true);
  assert.deepEqual(buildHelps({ ...b1Spec(), helps: { queue: true, hints: true } }), { queue: true, tint: false, guide: false, instant: false, hints: true });
});

test('validateBuildHelps: known keys, queue and guide only with parent editing, logs mode takes hints only', () => {
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), helps: ALL }), []);
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), helps: { queue: 1 } }), ['helps: "queue" is not true or false']);
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), edit: ['kind'], answer: {}, helps: { queue: true, guide: true } }), [
    'helps: queue needs parent editing',
    'helps: guide needs parent editing',
  ]);
  assert.deepEqual(validateBuildHelps({ ...logsSpec(), helps: { tint: true, hints: true } }), ['helps: logs mode takes only hints']);
  const given = b1Spec();
  given.spans[1].parentId = A;
  assert.deepEqual(validateBuildHelps({ ...given, helps: { queue: true, instant: true } }), ['helps: queue needs every span given as a root']);
  const late = b1Spec();
  late.spans[0].startMs = 12;
  assert.deepEqual(validateBuildHelps({ ...late, helps: { queue: true, instant: true } }), ['helps: queue needs the first span to arrive to be a root in the answer']);
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), helps: { queue: true, hints: true } }), ['helps: queue needs instant feedback'], 'Check would bypass the queue');
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), helps: { queue: true, instant: true } }), []);
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), hint: 'x', helps: { hints: false } }), ['hint: shown only when helps.hints is on']);
  assert.deepEqual(validateBuildHelps({ ...b1Spec(), closing: ' ' }), ['closing: not non-empty text']);
});

test('arrival order is start time; with the queue only the first root is placed, else every span', () => {
  assert.deepEqual(arrivalOrder(b1Spec()), [A, B, C, D, E]);
  assert.deepEqual([...initialPlaced(b1Spec(), ALL)], [A]);
  assert.deepEqual([...initialPlaced(b1Spec(), { ...ALL, queue: false })], [A, B, C, D, E]);
});

test('moveMarks: itself, its descendants refused; containing spans likely, the rest overflow; other trace marked', () => {
  const spec = b1Spec();
  const st = newBuildState(spec);
  const marks = (src, placed, helps = ALL) =>
    Object.entries(moveMarks(spec, st, src, { placed: new Set(placed), helps })).map(([id, m]) => `${id}:${m.mark}${m.other ? '+other' : ''}`);
  assert.deepEqual(marks(B, [A]), [`${A}:likely`], 'only placed spans are targets');
  setParent(spec, st, B, A);
  setParent(spec, st, C, B);
  setParent(spec, st, D, C);
  assert.deepEqual(marks(E, [A, B, C, D]), [`${A}:likely+other`, `${B}:likely+other`, `${C}:likely+other`, `${D}:overflow+other`]);
  assert.deepEqual(marks(B, [A, B, C, D, E]), [`${A}:likely`, `${B}:src`, `${C}:invalid`, `${D}:invalid`, `${E}:overflow+other`]);
  assert.deepEqual(marks(B, [A, B, C, D, E], { ...ALL, guide: false }), [`${A}:valid`, `${B}:src`, `${C}:invalid`, `${D}:invalid`, `${E}:valid+other`]);
  assert.deepEqual(marks(B, [A, B, C, D, E], { ...ALL, guide: false, tint: false }), [`${A}:valid`, `${B}:src`, `${C}:invalid`, `${D}:invalid`, `${E}:valid`], 'no tint: no other-trace mark');
});

test('a specific note per span code, never naming the right parent', () => {
  const spec = b1Spec();
  const st = newBuildState(spec);
  setParent(spec, st, E, C);
  assert.equal(note(spec, st, E), 'GET /products (storefront) carries trace id 0af76519, POST /checkout (api-gateway) carries 4bf92f35. Different trace ids, so it can\'t be the parent.');
  assert.equal(note(spec, st, B), 'POST (storefront) is a root now, yet another span of trace 4bf92f35 was already running when it started. Which call was it doing work for?');
  setParent(spec, st, C, D);
  assert.equal(note(spec, st, C), 'POST /checkout (api-gateway) runs 15 to 85 ms, which is not inside validate cart (api-gateway) (20 to 30 ms). A parent starts first and is still running when its child ends.');
  setParent(spec, st, C, null);
  setParent(spec, st, D, A);
  assert.equal(note(spec, st, D), 'validate cart (api-gateway) runs inside POST /checkout (storefront), but a span closer to it also contains it. Look for the innermost span that was running when it started.');
  for (const id of [B, C, D]) assert.equal(note(spec, st, id).includes('(storefront) is the'), false);
  const all = { ...b1Spec(), edit: ['kind', 'status', 'links'], answer: { [E]: { kind: 'CONSUMER', status: 'ERROR', links: [A] } } };
  const st2 = newBuildState(all);
  setKind(all, st2, E, 'CLIENT');
  toggleLink(all, st2, E, B);
  const notes = checkBuild(all, st2).issues.map((i) => `${i.code}: ${text(noteFor(all, st2, i, escapeHtml))}`);
  assert.deepEqual(notes, [
    "wrong-kind: GET /products (storefront): the kind doesn't match what it did. Does it handle a call, make one, send a message, process one, or none of these?",
    'wrong-status: GET /products (storefront): check the status. Only an operation that failed is ERROR.',
    'missing-link: GET /products (storefront): it should also point at a related span that is not its parent.',
    'extra-link: GET /products (storefront): one of its links points at a span it is not related to.',
  ]);
  setStatus(all, st2, E, 'ERROR');
  assert.equal(checkBuild(all, st2).issues.some((i) => i.code === 'wrong-status'), false);
});

test('a specific note per logs-mode code, from the chosen span, never the expected one', () => {
  const spec = logsSpec();
  const st = newBuildState(spec);
  attachLog(spec, st, 'l-cart', S3);
  attachLog(spec, st, 'l-charge', S2);
  attachLog(spec, st, 'l-boot', S1);
  attachLog(spec, st, 'l-other', S1);
  const notes = checkBuild(spec, st).issues.map((i) => `${i.code}: ${text(noteFor(spec, st, i, escapeHtml))}`);
  assert.deepEqual(notes, [
    '"Application started" (checkout, -40 ms): POST /checkout (checkout, trace 4bf92f35) ran 0 to 100 ms, and this record was written outside that window. A span is current only while it runs.',
    '"Cart validated" (checkout, 30 ms): POST /charge (payments) is a span of payments, and this record was written by checkout. A log call only sees the current span of its own service.',
    '"Order accepted" (checkout, 60 ms): POST /checkout (checkout, trace 4bf92f35) is in another trace than the request that wrote this record. Its attributes say which request it belongs to.',
    '"Charge submitted" (payments, 70 ms): validate cart (checkout) is a span of checkout, and this record was written by payments. A log call only sees the current span of its own service.',
  ].map((n, i) => `${['log-outside-span', 'log-other-service', 'log-wrong-trace', 'log-other-service'][i]}: ${n}`));
  const st2 = newBuildState(spec);
  attachLog(spec, st2, 'l-worker', S3);
  attachLog(spec, st2, 'l-cart', S1);
  attachLog(spec, st2, 'l-other', S4);
  attachLog(spec, st2, 'l-charge', S3);
  const by = Object.fromEntries(checkBuild(spec, st2).issues.map((i) => [i.code, text(noteFor(spec, st2, i, escapeHtml))]));
  assert.equal(by['log-no-active-span'], '"Retry worker gave up on charge" (payments, 75 ms): was a span current when the log call ran? Compare its time and attributes with the span\'s.');
  assert.equal(by['log-wrong-span'], '"Cart validated" (checkout, 30 ms): POST /checkout (checkout, trace 4bf92f35) is in the right trace, but another span of it was current when this record was written. Compare the record\'s time and attributes with each span\'s.');
  assert.equal(note(spec, newBuildState(spec), 'l-cart'), '"Cart validated" (checkout, 30 ms) has no span context yet, so nothing links it to a trace.');
});

test('hintTarget: the arriving span with the queue; else the selected span if wrong, else the first wrong one', () => {
  const spec = b1Spec();
  const st = newBuildState(spec);
  assert.equal(hintTarget(spec, st, { helps: ALL, placed: new Set([A]), selected: null }), B);
  const off = { ...ALL, queue: false };
  const every = new Set([A, B, C, D, E]);
  assert.equal(hintTarget(spec, st, { helps: off, placed: every, selected: D }), D);
  assert.equal(hintTarget(spec, st, { helps: off, placed: every, selected: A }), B, 'A is right, so the first wrong span in arrival order');
  for (const [id, p] of [[B, A], [C, B], [D, C]]) setParent(spec, st, id, p);
  assert.equal(hintTarget(spec, st, { helps: off, placed: every, selected: null }), null);
  const logs = logsSpec();
  const lst = newBuildState(logs);
  assert.equal(hintTarget(logs, lst, { helps: { hints: true }, selectedLog: 'l-charge' }), 'l-charge');
  assert.equal(hintTarget(logs, lst, { helps: { hints: true }, selectedLog: 'l-boot' }), 'l-cart', 'l-boot is right as given');
});

test('hint tiers for a parent: the rule, two candidates outlined, then placed with a reason', () => {
  const spec = b1Spec();
  const st = newBuildState(spec);
  const placed = new Set([A]);
  const h1 = hintFor(spec, st, B, 1, { placed, e: escapeHtml });
  assert.equal(text(h1.html).startsWith('A child starts after its parent starts and ends before its parent ends, and it carries the same trace id.'), true);
  assert.deepEqual([h1.cands, h1.apply], [[], null]);
  const h2 = hintFor(spec, st, B, 2, { placed, e: escapeHtml });
  assert.deepEqual(h2.cands, ['root', A]);
  assert.equal(text(h2.html), 'It is one of these two, outlined on the board: No parent (root) or POST /checkout (storefront).');
  const h3 = hintFor(spec, st, B, 3, { placed, e: escapeHtml });
  assert.deepEqual(h3.apply, { field: 'parent', value: A });
  assert.equal(text(h3.html), 'Placed for you. POST /checkout (storefront) is the innermost span of trace 4bf92f35 that runs around it (0 to 100 ms).');
  setParent(spec, st, B, A);
  placed.add(B);
  assert.equal(text(hintFor(spec, st, C, 3, { placed, e: escapeHtml }).html), 'Placed for you. POST (storefront) is the CLIENT call into api-gateway, and this is the SERVER span that handled it.');
  assert.deepEqual(hintFor(spec, st, C, 2, { placed, e: escapeHtml }).cands, [A, B], 'the decoy is the next span that also contains it; both in board order');
  const e3 = hintFor(spec, st, E, 3, { placed: new Set([A, B, C, D]), e: escapeHtml });
  assert.deepEqual(e3.apply, { field: 'parent', value: null });
  assert.equal(text(e3.html), 'Placed for you. Its trace id is 0af76519, unlike the others, so no span of this trace can be its parent.');
});

test('tier 3 for a parent that sits below the span: lift it out first, to its own answer parent if that is free and placed, else to the root', () => {
  const spec = b1Spec();
  const all = new Set([A, B, C, D, E]);
  const st = newBuildState(spec);
  setParent(spec, st, B, C); // C's answer parent B is now C's child
  const h = hintFor(spec, st, C, 3, { placed: all, e: escapeHtml });
  assert.deepEqual(h.apply, { field: 'parent', value: B, lift: { id: B, to: A } });
  assert.equal(text(h.html).startsWith('Placed for you. POST (storefront) sat below it, so it moves out first, under POST /checkout (storefront). '), true);
  assert.deepEqual(hintFor(spec, st, C, 3, { placed: new Set([B, C]), e: escapeHtml }).apply.lift, { id: B, to: null }, 'its answer parent has not arrived');
  const deep = newBuildState(spec);
  setParent(spec, deep, D, C);
  setParent(spec, deep, A, D);
  setParent(spec, deep, B, A); // B's answer parent A is below C too
  const d = hintFor(spec, deep, C, 3, { placed: all, e: escapeHtml });
  assert.deepEqual(d.apply.lift, { id: B, to: null });
  assert.equal(text(d.html).startsWith('Placed for you. POST (storefront) sat below it, so it moves out first, to the root, and is not where it belongs yet: POST (storefront) is a root now, yet another span of trace 4bf92f35 was already running when it started.'), true);
});

test('tier 2 for a parent that sits below the span: the text says it has to move out first, since the board refuses it now', () => {
  const spec = b1Spec();
  const all = new Set([A, B, C, D, E]);
  const st = newBuildState(spec);
  setParent(spec, st, B, C);
  const h = hintFor(spec, st, C, 2, { placed: all, e: escapeHtml });
  assert.deepEqual(h.cands, [A, B]);
  assert.equal(moveMarks(spec, st, C, { placed: all, helps: {} })[B].mark, 'invalid', 'the board refuses B for C');
  assert.equal(text(h.html), 'It is one of these two, outlined on the board: POST /checkout (storefront) or POST (storefront). POST (storefront) sits below it now, so it has to move out first.');
  setParent(spec, st, B, A);
  assert.equal(text(hintFor(spec, st, C, 2, { placed: all, e: escapeHtml }).html), 'It is one of these two, outlined on the board: POST /checkout (storefront) or POST (storefront).', 'no such line when both are free');
});

test('hint tiers for a kind and for a record follow the same three steps', () => {
  const spec = { ...b1Spec(), edit: ['kind'], answer: { [B]: { kind: 'CLIENT' }, [E]: { kind: 'CONSUMER' } } };
  const st = newBuildState(spec);
  setKind(spec, st, E, 'SERVER');
  assert.equal(text(hintFor(spec, st, E, 1, { e: escapeHtml }).html).startsWith('CLIENT calls another service'), true);
  assert.deepEqual(hintFor(spec, st, E, 2, { e: escapeHtml }).cands, ['CONSUMER', 'PRODUCER']);
  const k3 = hintFor(spec, st, E, 3, { e: escapeHtml });
  assert.deepEqual(k3.apply, { field: 'kind', value: 'CONSUMER' });
  assert.equal(text(k3.html), 'Set for you. GET /products (storefront) is CONSUMER: it processes a message that another span sent.');
  const logs = { ...logsSpec(), hint: 'Look at the <b>thread</b>.' };
  const lst = newBuildState(logs);
  assert.equal(text(hintFor(logs, lst, 'l-cart', 1, { e: escapeHtml }).html), 'Look at the thread.', 'the authored hint is tier 1');
  const l2 = hintFor(logs, lst, 'l-cart', 2, { e: escapeHtml });
  assert.deepEqual(l2.cands, [S2, S4]);
  assert.equal(text(l2.html), 'It is one of these two, outlined on the board: validate cart (checkout, 20 to 40 ms) or POST /checkout (checkout, 30 to 80 ms).');
  const l3 = hintFor(logs, lst, 'l-cart', 3, { e: escapeHtml });
  assert.deepEqual(l3.apply, { field: 'logs', value: S2 });
  assert.equal(text(l3.html), 'Set for you. validate cart (checkout) was the current span when this record was written, at 30 ms.');
  attachLog(logs, lst, 'l-worker', S3);
  assert.equal(text(hintFor(logs, lst, 'l-worker', 3, { e: escapeHtml }).html), 'Set for you. No span was current when this record was written, so it carries no span context.');
  assert.deepEqual(hintFor(logs, lst, 'l-worker', 2, { e: escapeHtml }).cands, ['none', S3]);
});

test('a same-name, same-service twin is named with the view\'s suffix in notes and hints; a unique span is not (#228)', () => {
  const spec = { ...b1Spec(), helps: ALL };
  const b = spec.spans[1]; // POST (storefront), trace 4bf92f35
  Object.assign(spec.spans[4], { name: b.name, service: b.service }); // E becomes B's twin in trace 0af76519
  const st = newBuildState(spec);
  setParent(spec, st, E, C);
  assert.equal(note(spec, st, E), 'POST (storefront, trace 0af76519) carries trace id 0af76519, POST /checkout (api-gateway) carries 4bf92f35. Different trace ids, so it can\'t be the parent.');
  const placed = new Set([A, B, C, D, E]);
  assert.equal(text(hintFor(spec, st, C, 3, { placed, e: escapeHtml }).html), 'Placed for you. POST (storefront, trace 4bf92f35) is the CLIENT call into api-gateway, and this is the SERVER span that handled it.');
  assert.equal(text(hintFor(spec, st, D, 3, { placed, e: escapeHtml }).html), 'Placed for you. POST /checkout (api-gateway) is the innermost span of trace 4bf92f35 that runs around it (15 to 85 ms).');
});
