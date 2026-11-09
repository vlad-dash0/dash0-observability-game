// Level 9.4 "The trace that starts in the middle" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs,
// test/levels-play.test.mjs): level fields, the globe (SLB is a 2-dot country in MIN_DOTS_EXCEPTIONS), the verdict Choice read against the
// tables the step shows, the Build it board of one trace with two orphans graded through the real checkBuild (every tempting parent, and
// the surface rules that must fail), the headers in step 2 against the board, the sources, and how it differs from 2.4 and 8.4.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { DOTS } from '../hub/globe-data.mjs';
import { COUNTRY_NAMES, LEVEL_COUNTRY, MIN_DOTS, MIN_DOTS_EXCEPTIONS } from '../hub/globe-map.mjs';
import { checkBuild, newBuildState, setParent, validateBuildSpec } from '../lib/widgets/build-it.mjs';
import { validateBuildHelps } from '../lib/widgets/build-it-help.mjs';
import { waterfall } from '../lib/widgets/trace.mjs';

const ID = 'the-trace-that-starts-in-the-middle';
const LIVE = liveRegistry();
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SRC = read(`levels/${ID}.mjs`);
const plain = (html) => html.replace(/<[^>]+>/g, '');
const level = LIVE.levels[ID];
const [VERDICT_STEP, BUILD_STEP] = level.play.steps;
const choices = VERDICT_STEP.choice.choices;
const tree = BUILD_STEP.build;
const byId = (id) => tree.spans.find((s) => s.spanId === id);
const byName = (service, name) => tree.spans.find((s) => s.service === service && s.name === name);
const WEB_C = byId('9c3e1a7d4b6f2085');
const WEB_C2A = byId('2f8b6d0a1c5e9347');
const WEB_C2B = byId('f7a1d5f3b9e0c462');
const CART_S = byName('cart', 'POST /cart/checkout');
const CART_C = byId('e0a4c8f2b6d19375');
const CART_C2A = byId('3d7b1f5a9c2e8064');
const CART_C2B = byId('8c2e6a0d4f1b7953');
const PAY_S = byName('payments', 'POST /payments/charge');

/** The `<td>` texts of each row of the table with this caption in `html`, tags stripped. */
function tableRows(html, caption) {
  const m = new RegExp(`<caption>${caption}[^<]*</caption>.*?<tbody>(.*?)</tbody>`).exec(html);
  assert.ok(m, `no table "${caption}"`);
  return [...m[1].matchAll(/<tr>(.*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td>(.*?)<\/td>/g)].map((c) => plain(c[1])));
}

test('9.4 fields: in act-9 after 9.3 and before 9.5 and the boss, scored with no par time, a choice then a build, hints off, no card', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix, scored: level.scored },
    { no: '9.4', name: 'The trace that starts in the middle', sub: 'Does that answer hold?', rewardTitle: 'Parent finder', kind: 'level', actId: 'act-9', parMs: null, prefix: 'ttsm', scored: true },
  );
  assert.deepEqual([...level.mechanics], ['build']);
  assert.deepEqual([...level.hintless], ['build']);
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'build'].find((k) => s[k])), ['choice', 'build']);
  assert.deepEqual([...level.lights], ['storefront', 'cart', 'payments']);
  assert.deepEqual([...level.cards], []);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === level.rewardTitle).length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-9');
  assert.deepEqual([...act.levelIds], ['filter-or-sampler', 'the-34-percent-error-rate', 'connect-to-dash0', ID, 'lost-in-translation', 'the-alert-that-stayed-green', 'two-vendors-one-weekend', 'edge-of-the-platform']);
  assert.equal(LIVE.order[LIVE.order.indexOf(ID) + 1], 'lost-in-translation', '9.5 follows 9.4, then 9.6 to 9.8 and the boss');
});

test('globe: 9.4 is on the Solomon Islands, two dots, allowed by exactly its own MIN_DOTS_EXCEPTIONS entry', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'SLB');
  assert.equal(COUNTRY_NAMES.SLB, 'the Solomon Islands');
  assert.equal(DOTS.filter((d) => d[2] === 'SLB').length, 2);
  assert.equal(MIN_DOTS_EXCEPTIONS.SLB, 2);
  assert.equal(2 < MIN_DOTS, true);
});

// ---- step 1: the verdict Choice ----------------------------------------------------------------

const received = tableRows(VERDICT_STEP.show, 'Spans received');
const hops = tableRows(VERDICT_STEP.show, 'The traceparent on each hop');
const parse = (header) => {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(header);
  assert.ok(m, `not a valid traceparent: ${header}`);
  return { traceId: m[1], parentId: m[2] };
};

test('step 1 data: one trace of ten received spans, exactly two whose parent-id no received span has, both server spans', () => {
  assert.equal(received.length, 10);
  const ids = new Set(received.map((r) => r[3]));
  assert.equal(ids.size, 10);
  const loose = received.filter((r) => r[4] !== 'none' && !ids.has(r[4]));
  assert.deepEqual(loose.map((r) => [r[0], r[2]]), [['cart', 'SERVER'], ['payments', 'SERVER']]);
  assert.deepEqual(received.filter((r) => r[4] === 'none').map((r) => r[0]), ['web'], 'one root');
  assert.equal(new Set(tree.spans.map((s) => s.traceId)).size, 1, 'one trace id on every span');
  assert.match(VERDICT_STEP.show, new RegExp(`Spans received, one trace \\(${tree.spans[0].traceId.slice(0, 8)}\\)`));
});

test('step 1 hops: the header leaves each caller naming a received client span and reaches the callee naming a span nobody sent', () => {
  const ids = new Set(received.map((r) => r[3]));
  assert.deepEqual(hops.map((h) => h[0]), ['web to cart', 'cart to payments']);
  const [left1, left2] = [parse(hops[0][1]), parse(hops[1][1])];
  const [got1, got2] = [parse(hops[0][2]), parse(hops[1][2])];
  assert.equal(left1.parentId, WEB_C.spanId);
  assert.equal(left2.parentId, CART_C.spanId);
  for (const h of [left1, left2]) assert.equal(ids.has(h.parentId), true, 'what left the caller is a received span');
  for (const h of [got1, got2]) assert.equal(ids.has(h.parentId), false, 'what reached the callee is not');
  for (const h of [left1, left2, got1, got2]) assert.equal(h.traceId, WEB_C.traceId, 'the trace id is the same on every hop');
  assert.deepEqual([CART_S.parentId, PAY_S.parentId], [got1.parentId, got2.parentId], 'the server spans carry what reached them');
  assert.notEqual(got1.parentId, got2.parentId);
});

test('step 1: exactly one right choice, "rewritten", third of four, whose label is neither the longest nor the shortest', () => {
  assert.deepEqual(choices.map((c) => c.key), ['holds', 'never-sent', 'rewritten', 'dropped']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['rewritten']);
  assert.equal(choices.findIndex((c) => c.right), 2);
  const lengths = choices.map((c) => plain(c.label).length);
  const own = lengths[2];
  assert.equal(own < Math.max(...lengths) && own > Math.min(...lengths), true, `lengths ${lengths}`);
  assert.equal(Math.max(...lengths) - Math.min(...lengths) <= 14, true, `label lengths ${lengths} differ by more than 14`);
  for (const c of choices) assert.equal(/\d/.test(c.label), false, 'no digit in a label');
});

test('step 1 whyNots hold against the tables: same trace id, the header was sent, the sidecar has no exporter', () => {
  const [holds, neverSent, , dropped] = choices;
  const traceId = tree.spans[0].traceId;
  assert.equal(plain(holds.why).includes(traceId.slice(0, 8)), true, 'the "holds" whyNot names the trace id the data shows');
  assert.equal(tree.spans.every((s) => s.traceId === traceId), true, 'so every span, cart\'s included, is in web\'s trace');
  assert.equal(parse(hops[0][1]).traceId, traceId, 'web did send a traceparent');
  assert.equal(plain(neverSent.why).includes(hops[0][1]), true, 'the "never sent" whyNot quotes the header from the table');
  assert.match(VERDICT_STEP.show, /tracing export: none/);
  assert.match(plain(dropped.why), /tracing export: none, so they never produced an export to drop/);
  const right = choices.find((c) => c.right);
  assert.equal(plain(right.why).includes(hops[0][2].split('-')[2]), true, 'the right why names the id the sidecar wrote');
  for (const c of choices) assert.equal(/^[A-Z<]/.test(c.why), true, `${c.key}: why is a sentence`);
});

test('step 1 intro: a presenter\'s confident claim, no name and no affiliation', () => {
  const intro = plain(VERDICT_STEP.intro);
  assert.match(intro, /The presenter answers without a pause: "Cart's SDK ignores the header web sends, so it starts over\./);
  assert.doesNotMatch(intro, /Inc|Ltd|GmbH|@|\bMr\b|\bMs\b/);
  assert.equal(plain(VERDICT_STEP.question), 'Does the presenter\'s answer hold?');
});

// ---- step 2: Build it --------------------------------------------------------------------------

/** Grade the board with the two server spans' parents set (undefined: left as given). */
function gradeWith(cartParent, payParent) {
  const st = newBuildState(tree);
  if (cartParent !== undefined) assert.equal(setParent(tree, st, CART_S.spanId, cartParent), 'set');
  if (payParent !== undefined) assert.equal(setParent(tree, st, PAY_S.spanId, payParent), 'set');
  return checkBuild(tree, st).issues.map((i) => `${i.code}:${byId(i.spanId).service}`);
}

test('step 2: a valid parent-only board, no helps, the given state fails Check, the reference answer needs both orphans joined', () => {
  assert.equal(BUILD_STEP.qid, 'ttsm-q-tree');
  assert.equal(tree.id, 'ttsm-tree');
  assert.deepEqual(validateBuildSpec(tree), []);
  assert.deepEqual(validateBuildHelps(tree), []);
  assert.deepEqual(tree.edit, ['parent']);
  assert.deepEqual(tree.helps, {});
  assert.equal(Object.hasOwn(tree, 'hint'), false);
  assert.equal(tree.spans.length, 10);
  assert.deepEqual(tree.answer, { [CART_S.spanId]: { parentId: WEB_C.spanId }, [PAY_S.spanId]: { parentId: CART_C.spanId } });
  assert.deepEqual(gradeWith(), ['wrong-parent:cart', 'wrong-parent:payments'], 'as given both fail');
  assert.deepEqual(gradeWith(WEB_C.spanId, CART_C.spanId), []);
  assert.deepEqual(gradeWith(WEB_C.spanId), ['wrong-parent:payments'], 'cart alone is not enough');
  assert.deepEqual(gradeWith(undefined, CART_C.spanId), ['wrong-parent:cart'], 'payments alone is not enough');
  assert.equal(plain(BUILD_STEP.question), 'Rebuild the tree the fix gives: join cart\'s and payments\' server spans to their parents.');
});

test('step 2: every other parent for either server span fails; the enclosing SERVER span and every parallel call are tempting and wrong', () => {
  const others = (server, right) => tree.spans.filter((s) => s.spanId !== server.spanId && s.spanId !== right.spanId && s.spanId !== PAY_S.spanId);
  const onlyOne = (server, parentId) => {
    const st = newBuildState(tree);
    return setParent(tree, st, server.spanId, parentId) === 'set' ? checkBuild(tree, st).issues.some((i) => i.spanId === server.spanId) : 'refused';
  };
  for (const s of others(CART_S, WEB_C)) assert.notEqual(onlyOne(CART_S, s.spanId), false, `${s.name} (${s.service}) as cart's parent passed`);
  for (const s of others(PAY_S, CART_C)) assert.notEqual(onlyOne(PAY_S, s.spanId), false, `${s.name} (${s.service}) as payments' parent passed`);
  assert.equal(onlyOne(CART_S, WEB_C.spanId), false, 'the check has teeth: the right parent is not flagged');
  assert.equal(onlyOne(PAY_S, CART_C.spanId), false);
  const web = byName('web', 'POST /checkout');
  assert.deepEqual(gradeWith(web.spanId, CART_C.spanId), ['wrong-parent:cart'], 'the enclosing SERVER of web');
  assert.deepEqual(gradeWith(WEB_C.spanId, CART_S.spanId), ['wrong-parent:payments'], 'the enclosing SERVER of cart');
  assert.deepEqual(gradeWith(WEB_C2A.spanId, CART_C.spanId), ['wrong-parent:cart']);
  assert.deepEqual(gradeWith(WEB_C2B.spanId, CART_C.spanId), ['wrong-parent:cart'], 'the parallel POST of web');
  assert.deepEqual(gradeWith(WEB_C.spanId, CART_C2A.spanId), ['wrong-parent:payments']);
  assert.deepEqual(gradeWith(WEB_C.spanId, CART_C2B.spanId), ['wrong-parent:payments'], 'the parallel POST of cart');
});

test('step 2 blind rules: name match, verb, middle, every extremal timing rule, largest and smallest span ID, first and last row all fail through checkBuild', () => {
  const callerOf = { cart: 'web', payments: 'cart' };
  const rows = waterfall(tree.spans).rows.map((row) => byId(row.spanId)); // board order
  /** The client spans of the caller that enclose `server`, in board order. */
  const cands = (server) => rows.filter((s) => s.kind === 'CLIENT' && s.service === callerOf[server.service] && s.startMs <= server.startMs && s.endMs >= server.endMs);
  const width = (p) => p.endMs - p.startMs;
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const by = (key, dir = 1) => (server) => [...cands(server)].sort((a, b) => dir * cmp(key(a), key(b)))[0];
  const nth = (key, i) => (server) => [...cands(server)].sort((a, b) => key(a) - key(b))[i];
  const verb = (name) => name.split(' ')[0];
  const rules = {
    'same name as the server span': (server) => cands(server).find((c) => c.name === server.name),
    'same HTTP verb as the server span': (server) => cands(server).find((c) => verb(c.name) === verb(server.name)),
    'the only POST': (server) => cands(server).filter((c) => c.name === 'POST').at(0),
    'the last POST on the board': (server) => cands(server).filter((c) => c.name === 'POST').at(-1),
    tightest: by(width),
    widest: by(width, -1),
    'earliest start': by((c) => c.startMs),
    'latest start': by((c) => c.startMs, -1),
    'earliest end': by((c) => c.endMs),
    'latest end': by((c) => c.endMs, -1),
    'middle by width': nth(width, 1),
    'middle by start': nth((c) => c.startMs, 1),
    'middle by end': nth((c) => c.endMs, 1),
    'largest span ID': by((c) => c.spanId, -1),
    'smallest span ID': by((c) => c.spanId),
    'first row': (server) => cands(server)[0],
    'middle row': (server) => cands(server)[1],
    'last row': (server) => cands(server)[2],
    'closest start to the server span': (server) => [...cands(server)].sort((a, b) => Math.abs(server.startMs - a.startMs) - Math.abs(server.startMs - b.startMs))[0],
    'closest end to the server span': (server) => [...cands(server)].sort((a, b) => Math.abs(server.endMs - a.endMs) - Math.abs(server.endMs - b.endMs))[0],
  };
  for (const server of [CART_S, PAY_S]) {
    assert.equal(cands(server).length, 3, `${server.service}: three client spans of the caller enclose the server span`);
  }
  for (const [name, pick] of Object.entries(rules)) {
    const [c, p] = [pick(CART_S), pick(PAY_S)];
    const st = newBuildState(tree);
    const ok = (server, parent) => parent !== undefined && setParent(tree, st, server.spanId, parent.spanId) === 'set';
    if (name === 'same name as the server span') assert.deepEqual([c, p], [undefined, undefined], 'no client span has a server span\'s name');
    const applied = ok(CART_S, c) && ok(PAY_S, p);
    assert.equal(applied && checkBuild(tree, st).ok, false, `blind rule "${name}" passed (picked ${c?.name} ${c?.startMs}, ${p?.name} ${p?.startMs})`);
  }
  // Teeth: the same harness passes when handed the answer, and a rule that is right on one hop only still fails the other.
  const st = newBuildState(tree);
  setParent(tree, st, CART_S.spanId, WEB_C.spanId);
  setParent(tree, st, PAY_S.spanId, CART_C.spanId);
  assert.equal(checkBuild(tree, st).ok, true);
  assert.deepEqual([rules['latest start'](CART_S).spanId === WEB_C.spanId, rules['latest start'](PAY_S).spanId === CART_C.spanId], [true, false], 'a rule right on web fails on cart');
  assert.deepEqual([rules['earliest start'](CART_S).spanId === WEB_C.spanId, rules['earliest start'](PAY_S).spanId === CART_C.spanId], [false, true], 'and the reverse');
  // The right client is the decoy POST's neighbour: web lists a parallel POST above it.
  const web = cands(CART_S);
  assert.equal(web.filter((c) => c.name === 'POST').length, 2, 'a parallel POST on each side');
  assert.equal(web.findIndex((c) => c.spanId === WEB_C2B.spanId) < web.findIndex((c) => c.spanId === WEB_C.spanId), true, 'the decoy POST is listed above the right one on web');
  assert.equal(new Set(tree.spans.filter((s) => s.kind === 'CLIENT' && s.service !== 'payments').map((s) => s.name)).size, 2, 'client names are bare methods, none equals a server name');
});

const headers = tableRows(BUILD_STEP.show, 'The traceparent on each hop after the fix');
const clients = tableRows(BUILD_STEP.show, 'CLIENT spans of web and cart, by ID');

test('step 2 data: the header table names the right client span of each hop, and the id table resolves it', () => {
  assert.deepEqual(headers.map((h) => h[0]), ['web to cart', 'cart to payments']);
  assert.equal(parse(headers[0][1]).parentId, WEB_C.spanId);
  assert.equal(parse(headers[1][1]).parentId, CART_C.spanId);
  assert.equal(parse(headers[0][1]).traceId, WEB_C.traceId);
  assert.equal(clients.length, 6, 'three client spans of web and three of cart');
  assert.deepEqual(clients.map((c) => c[2]).sort(), tree.spans.filter((s) => s.kind === 'CLIENT' && s.service !== 'payments').map((s) => s.spanId).sort());
  for (const [service, name, id] of clients) {
    const s = byId(id);
    assert.deepEqual([s.service, s.name], [service, name], 'the id table matches the board');
  }
  assert.match(plain(BUILD_STEP.intro), /A vendor must send the header on and may change it first, so sending it on unchanged is allowed too/);
  assert.match(plain(BUILD_STEP.intro), /not in this capture/);
});

test('step 2: the old trace on the board has the same ids as step 1\'s table, parent for parent', () => {
  for (const [service, name, kind, id, parentId] of received) {
    const s = byId(id);
    assert.deepEqual([s.service, s.name, s.kind, s.parentId ?? 'none'], [service, name, kind, parentId], id);
  }
});

// ---- sources, and how 9.4 differs ---------------------------------------------------------------

test('sources: three Spec URLs on allowed hosts, the W3C sentences quoted as the page has them, no Dash0 product claim, no pricing, no em dash', () => {
  const spec = SRC.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g));
  assert.deepEqual(spec, [
    'https://www.w3.org/TR/trace-context/#parent-id',
    'https://www.w3.org/TR/trace-context/#mutating-the-traceparent-field',
    'https://opentelemetry.io/docs/concepts/context-propagation/',
  ]);
  const flat = SRC.replace(/\n\/\/ /g, ' ');
  for (const quote of [
    'A vendor receiving a traceparent request header MUST send it to outgoing requests. It MAY mutate the value of this header before passing it to outgoing requests.',
    'This is the ID of this request as known by the caller',
    'Unmodified header propagation is typically implemented in pass-through services like proxies.',
    'Update parent-id: The value of the parent-id field can be set to the new value representing the ID of the current operation.',
    'Service B uses these values to create a new span that belongs to the same trace, setting the span from Service A as its parent.',
  ]) assert.equal(flat.includes(quote), true, `the source comment quotes: ${quote}`);
  const copy = plain(JSON.stringify(level.play));
  assert.equal(/dash0|pric|\$|dollar|per GB|invoice/i.test(copy), false, 'no Dash0 claim and no pricing in the copy');
  assert.equal(SRC.includes('\u2014'), false, 'no em dash');
});

test('how 9.4 differs from 2.4 and 8.4: its own ids, names, prefix and qids; one trace, a header that arrives, two orphans and three candidates', () => {
  const others = ['context-propagation', 'frontend-rum'].map((id) => LIVE.levels[id]);
  const ownIds = new Set(tree.spans.flatMap((s) => [s.spanId, s.traceId]));
  for (const o of others) {
    const text = JSON.stringify(o.play ?? {}) + read(`levels/${o.id}.mjs`);
    for (const id of ownIds) assert.equal(text.includes(id), false, `${id} appears in ${o.id}`);
    assert.notEqual(o.play?.prefix, level.play.prefix);
    assert.notEqual(o.name, level.name);
  }
  const names = new Set(tree.spans.map((s) => s.service));
  assert.deepEqual([...names].sort(), ['cart', 'payments', 'web']);
  for (const reused of ['storefront', 'checkout', 'orders', 'shop-web']) assert.equal(names.has(reused), false, `${reused} is the service of 2.4 or 8.4`);
  assert.equal(tree.spans.filter((s) => s.parentId !== null && !tree.spans.some((p) => p.spanId === s.parentId)).length, 2, 'two orphans on the board');
  assert.equal(Object.keys(tree.answer).length, 2);
});
