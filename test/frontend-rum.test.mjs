// Level 8.4 "Frontend / RUM" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs):
// level fields and the globe (which completes Southeast Asia with every level of the act); the Build it board of two browser traces, one with a twin call read against the traceparent
// header in the intro, and every tempting parent graded through the real checkBuild; the CORS Choice as a two-by-two of placements read
// from the replies the intro shows; the sources and what the copy does not claim. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { DECK } from '../cards/deck.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { checkBuild, newBuildState, setParent, validateBuildSpec } from '../lib/widgets/build-it.mjs';
import { validateBuildHelps } from '../lib/widgets/build-it-help.mjs';
import { namer } from '../lib/widgets/build-it-names.mjs';
import { waterfall } from '../lib/widgets/trace.mjs';

const ID = 'frontend-rum';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const level = LIVE.levels[ID];
const [BUILD_STEP, CORS_STEP] = level.play.steps;
const tree = BUILD_STEP.build;
const choices = CORS_STEP.choice.choices;
const byName = (service, name, trace, nth = 0) => tree.spans.filter((s) => s.service === service && s.name === name && s.traceId.startsWith(trace))[nth];
const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};

test('8.4 fields: in act-8 after 8.3, scored with no par time, a build then a choice, lights storefront and api-gateway, awards no card', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '8.4', name: 'Frontend / RUM', sub: 'The trace starts in the browser', icon: '\u{1F310}', rewardTitle: 'Browser tracer', kind: 'level', actId: 'act-8', parMs: null, prefix: 'frum' },
  );
  assert.deepEqual([...level.mechanics], ['build'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual([...level.hintless], ['build']);
  assert.deepEqual(level.play.steps.map((s) => ['build', 'choice'].find((k) => s[k])), ['build', 'choice']);
  assert.deepEqual([...level.lights], ['storefront', 'api-gateway']);
  assert.deepEqual([...level.cards], []);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Browser tracer').length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-8');
  assert.deepEqual([...act.levelIds], ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors', ID]);
  assert.equal(LIVE.order[LIVE.order.indexOf('migrating-vendors') + 1], ID, '8.4 plays right after 8.3');
});

test('card 19 (flush-on-shutdown): 8.4 does not award it, the batch-processor flush is not what this level grades', () => {
  assert.deepEqual([...level.cards], []);
  assert.equal(DECK.some((c) => c.id === 'flush-on-shutdown'), false, 'exactly one level awards it, decided on #137 and recorded on #27');
  assert.doesNotMatch(plain(JSON.stringify(level.play)), /flush|shutdown|batch processor/i);
});

test('globe: 8.4 lights Malaysia and, with the other three levels of act-8, completes Southeast Asia', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'MYS');
  assert.equal(COUNTRY_NAMES.MYS, 'Malaysia');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const others = ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors'];
  const fresh = freshlyLit(progressOf(others), progressOf([...others, ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['MYS'], regionIds: ['act-8'] });
  assert.equal(litText(fresh, level, map), 'Malaysia is now lit: Frontend / RUM. Southeast Asia is complete.');
  assert.deepEqual(freshlyLit(emptyProgress(), progressOf([ID]), LIVE, map), { countryIds: ['MYS'], regionIds: [] }, 'alone it leaves the region open');
});

// ---- step 1: Build it -----------------------------------------------------------------------

const { traceparent } = (() => {
  const m = /traceparent: (\S+)<\/code>/.exec(BUILD_STEP.intro);
  return { traceparent: m ? m[1] : null };
})();

test('step 1: a valid parent-only build of two browser traces, no helps, a Check button, the reference answer passes checkBuild (I7)', () => {
  assert.equal(BUILD_STEP.qid, 'frum-q-tree');
  assert.equal(tree.id, 'frum-tree');
  assert.deepEqual(validateBuildSpec(tree), []);
  assert.deepEqual(validateBuildHelps(tree), []);
  assert.deepEqual(tree.edit, ['parent']);
  assert.deepEqual(tree.helps, {});
  assert.equal(Object.hasOwn(tree, 'hint'), false, 'no authored hint (hints off)');
  assert.equal(tree.spans.length, 10);
  assert.equal(new Set(tree.spans.map((s) => s.traceId)).size, 2, 'two traces on the board');
  assert.equal(plain(BUILD_STEP.question), 'Give checkout\'s server span its parent.');
  const server = byName('checkout', 'POST /checkout', 'a3f1c9e2');
  assert.equal(server.parentId, null, 'checkout\'s server span arrives as a root');
  assert.deepEqual(Object.keys(tree.answer), [server.spanId]);
});

test('step 1: the traceparent in the intro is a valid W3C value and names the fetch call, in the server span\'s trace', () => {
  assert.match(traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const [version, traceId, parentId, flags] = traceparent.split('-');
  assert.equal(version, '00');
  assert.equal(/^0+$/.test(traceId) || /^0+$/.test(parentId), false, 'neither id is all zeros');
  assert.equal(flags, '01');
  const server = byName('checkout', 'POST /checkout', 'a3f1c9e2');
  const named = tree.spans.find((s) => s.spanId === parentId);
  assert.equal(server.traceId, traceId, 'the header\'s trace is the server span\'s trace');
  assert.deepEqual([named.service, named.name, named.kind, named.traceId], ['shop-web', 'POST /checkout', 'CLIENT', traceId]);
  assert.equal(tree.answer[server.spanId].parentId, parentId, 'the answer is the span the header names');
  assert.equal(server.startMs >= named.startMs && server.endMs <= named.endMs, true, 'the call encloses the server span');
  assert.match(plain(BUILD_STEP.intro), /Another visitor clicked Pay at the same moment, in trace 9d8c7b6a/);
  assert.match(plain(BUILD_STEP.intro), /server span for one of the two calls arrived as a root/);
  assert.doesNotMatch(plain(BUILD_STEP.intro), /first call|retry/, 'no word of the intro picks a twin or calls it a retry');
  assert.match(plain(BUILD_STEP.intro), /code that sends the checkout call ran twice, so two identical calls left together; the board tells them apart by the end of their span id/);
  assert.match(plain(BUILD_STEP.intro), /share an origin/);
});

/** Grade the board with `parentId` as checkout's server span's parent: the issue codes. */
function gradeWith(parentId) {
  const server = byName('checkout', 'POST /checkout', 'a3f1c9e2');
  const st = newBuildState(tree);
  if (parentId !== undefined) assert.equal(setParent(tree, st, server.spanId, parentId), 'set');
  return checkBuild(tree, st).issues.map((i) => i.code);
}

test('step 1: only the span the header names passes; each tempting parent fails with its own code', () => {
  const click = byName('shop-web', 'click Pay', 'a3f1c9e2');
  const cart = byName('shop-web', 'GET /cart', 'a3f1c9e2');
  const pay = tree.spans.find((s) => s.spanId === traceparent.split('-')[2]);
  const pay2 = byName('shop-web', 'POST /checkout', '9d8c7b6a');
  const click2 = byName('shop-web', 'click Pay', '9d8c7b6a');
  const server2 = byName('checkout', 'POST /checkout', '9d8c7b6a');
  const boardRows = waterfall(tree.spans).rows;
  const twinRow = boardRows.find((r) => r.name === 'POST /checkout' && r.service === 'shop-web' && r.traceId === pay.traceId);
  const twin = tree.spans.find((s) => s.spanId === twinRow.spanId);
  assert.notEqual(twin.spanId, pay.spanId, 'the upper twin on the board is the other call of the trace, not the one the header names');
  const status = byName('shop-web', 'GET /order-status', 'a3f1c9e2');
  assert.deepEqual(gradeWith(status.spanId), ['wrong-parent'], 'the later fetch of the order status, which does not enclose the server span');
  assert.deepEqual(gradeWith(pay.spanId), [], 'the fetch call the header names');
  assert.deepEqual(gradeWith(twin.spanId), ['wrong-parent'], 'the twin in the same trace, which also encloses the server span');
  assert.deepEqual(gradeWith(undefined), ['wrong-parent'], 'left as a root');
  assert.deepEqual(gradeWith(click.spanId), ['wrong-parent'], 'the click that started the call');
  assert.deepEqual(gradeWith(cart.spanId), ['wrong-parent'], 'the earlier fetch of the cart');
  assert.deepEqual(gradeWith(pay2.spanId), ['cross-trace-parent'], 'the same-looking call in the other visitor\'s trace');
  assert.deepEqual(gradeWith(click2.spanId), ['cross-trace-parent'], 'the other visitor\'s click');
  assert.deepEqual(gradeWith(server2.spanId), ['cross-trace-parent'], 'the other visitor\'s server span');
});

test('step 1: surface rules for choosing the parent fail, so the header has to be read', () => {
  const server = byName('checkout', 'POST /checkout', 'a3f1c9e2');
  const candidates = tree.spans.filter((s) => s.spanId !== server.spanId && s.service === 'shop-web');
  const encloses = (p) => p.startMs <= server.startMs && p.endMs >= server.endMs;
  const width = (p) => p.endMs - p.startMs;
  const rules = {
    'the root of the browser trace': () => byName('shop-web', 'click Pay', 'a3f1c9e2'),
    'the first browser span to start': () => [...candidates].sort((a, b) => a.startMs - b.startMs)[0],
    'the first fetch call to start': () => [...candidates].filter((s) => s.kind === 'CLIENT').sort((a, b) => a.startMs - b.startMs)[0],
    'the last same-named span in the list': () => [...candidates].reverse().find((s) => s.name === server.name),
    'the tightest span that encloses it, any trace': () => candidates.filter(encloses).sort((a, b) => width(a) - width(b))[0],
    'the widest span that encloses it, any trace': () => candidates.filter(encloses).sort((a, b) => width(b) - width(a))[0],
    'the span starting nearest before it, any trace': () => candidates.filter((s) => s.startMs <= server.startMs).sort((a, b) => b.startMs - a.startMs)[0],
  };
  for (const [name, pick] of Object.entries(rules)) {
    const chosen = pick();
    assert.notEqual(gradeWith(chosen.spanId).length, 0, `${name} picked ${chosen.name} (${chosen.spanId}) and passed`);
  }
  const same = candidates.filter((s) => s.name === server.name);
  assert.deepEqual(same.map((s) => gradeWith(s.spanId).length === 0).sort(), [false, false, true], 'three browser spans share the server span\'s name: only the one the header names passes');
  // The twins are identical calls: same start, same end, both enclose the server span. No timing rule can tell them apart.
  const passes = (s) => gradeWith(s.spanId).length === 0;
  const rows = waterfall(tree.spans).rows;
  const board = rows.map((r) => tree.spans.find((s) => s.spanId === r.spanId));
  const sameTrace = board.filter((s) => s.traceId === server.traceId && s.name === server.name && s.kind === 'CLIENT' && encloses(s));
  assert.equal(sameTrace.length, 2, 'the double-bound twins, in board order');
  assert.deepEqual([sameTrace[0].startMs === sameTrace[1].startMs, sameTrace[0].endMs === sameTrace[1].endMs], [true, true], 'identical times');
  assert.equal(passes(sameTrace[0]), false, 'the upper twin row on the board is the wrong one');
  assert.equal(passes(sameTrace[1]), true);
  const timing = {
    tightest: (a, b) => width(a) - width(b),
    widest: (a, b) => width(b) - width(a),
    'earliest start': (a, b) => a.startMs - b.startMs,
    'latest start': (a, b) => b.startMs - a.startMs,
    'earliest end': (a, b) => a.endMs - b.endMs,
    'latest end': (a, b) => b.endMs - a.endMs,
    'closest start to the server span': (a, b) => Math.abs(server.startMs - a.startMs) - Math.abs(server.startMs - b.startMs),
    'closest end to the server span': (a, b) => Math.abs(server.endMs - a.endMs) - Math.abs(server.endMs - b.endMs),
  };
  for (const [name, cmp] of Object.entries(timing)) {
    assert.equal(cmp(sameTrace[0], sameTrace[1]), 0, `${name} cannot separate the twins`);
    // A stable sort over the rows the player sees keeps the upper twin first.
    assert.equal(passes([...sameTrace].sort(cmp)[0]), false, `${name} over the board order picked the upper twin and passed`);
    // The same rule over every enclosing same-trace browser row, in board order.
    const enclosing = board.filter((s) => s.traceId === server.traceId && s.service === 'shop-web' && encloses(s));
    assert.equal(passes([...enclosing].sort(cmp)[0]), false, `${name} over the enclosing rows picked ${[...enclosing].sort(cmp)[0].name} and passed`);
  }
  // Position beliefs over the real waterfall rows: both are wrong, only the header's parent id passes.
  const at = rows.findIndex((r) => r.spanId === server.spanId);
  const browserRows = board.slice(0, at).filter((s) => s.service === 'shop-web' && s.traceId === server.traceId);
  const beliefs = {
    'the first POST /checkout row': board.find((s) => s.name === 'POST /checkout' && s.traceId === server.traceId && s.service === 'shop-web'),
    'the upper twin': sameTrace[0],
    'the row above the server span': board[at - 1],
    'the last browser row before the server span': browserRows[browserRows.length - 1],
    'the first browser row of the trace': browserRows[0],
    'the first CLIENT row': browserRows.find((s) => s.kind === 'CLIENT'),
    'the last CLIENT row': [...browserRows].reverse().find((s) => s.kind === 'CLIENT'),
  };
  for (const [name, s] of Object.entries(beliefs)) assert.equal(passes(s), false, `${name} (${s.name}, ${s.spanId}) passed`);
  assert.equal(board[at - 1].name, 'GET /order-status', 'a later fetch sits between the twins and the server span');
  assert.deepEqual(sameTrace.map((s) => gradeWith(s.spanId)), [['wrong-parent'], []], 'of the two only the header\'s parent id decides');
});

test('step 1: the board labels the twins by span id, and reading the parent id of the traceparent is what picks the right one', () => {
  const [, , parentId] = traceparent.split('-');
  const twins = tree.spans.filter((s) => s.traceId === byName('checkout', 'POST /checkout', 'a3f1c9e2').traceId && s.name === 'POST /checkout' && s.service === 'shop-web');
  const labels = twins.map((s) => namer(tree.spans, (x) => x).text(s));
  assert.deepEqual(labels, ['POST /checkout (shop-web, trace a3f1c9e2, span id \u20264c3d)', 'POST /checkout (shop-web, trace a3f1c9e2, span id \u202692a3)']);
  assert.equal(new Set(labels).size, 2, 'the labels differ only by the span id');
  assert.equal(labels.map((l) => parentId.endsWith(l.slice(-5, -1))).join(), 'false,true', 'the end of the header\'s parent id matches one label only');
  assert.deepEqual(twins.map((s) => gradeWith(s.spanId).length === 0), [false, true]);
  assert.equal(twins.every((s) => s.startMs <= 230 && s.endMs >= 1160), true, 'both twins enclose the server span');
  assert.deepEqual([twins[0].startMs, twins[0].endMs], [twins[1].startMs, twins[1].endMs], 'identical times');
});

// ---- step 2: CORS ---------------------------------------------------------------------------

test('step 2: the intro shows two failing replies as data: no allow-origin on the export, and a headers list without traceparent', () => {
  assert.equal(CORS_STEP.qid, 'frum-q-cors');
  assert.equal(CORS_STEP.choice.id, 'frum-cors');
  assert.equal(plain(CORS_STEP.question), 'Which change makes both work?');
  const intro = plain(CORS_STEP.intro);
  for (const s of [
    'https://shop.kettle.example', 'https://api.kettle.example', 'https://otlp.kettle.example', 'three origins',
    'by default it sends it only to the page\'s own origin',
    'The API already allows the shop\'s origin, https://shop.kettle.example',
    'POST https://otlp.kettle.example/v1/traces is blocked: the reply has no Access-Control-Allow-Origin header, and no browser spans reach Dash0',
    'asks whether it may send the header traceparent',
    'Access-Control-Allow-Headers: Content-Type, Authorization',
    'the payment fails',
  ]) assert.equal(intro.includes(s), true, s);
  const listed = /Access-Control-Allow-Headers: ([^,.]+(?:, [^,.]+)*)/.exec(intro)[1].split(', ').map((h) => h.toLowerCase());
  assert.equal(listed.includes('traceparent'), false, 'the API\'s list lacks the header the browser wants to send');
});

test('step 2: a two-by-two of placements, each once; exactly one is right, with the page\'s origin and the API\'s headers', () => {
  const read = (c) => {
    const l = plain(c.label);
    return {
      origin: l.includes('https://shop.kettle.example') ? 'shop' : l.includes('https://api.kettle.example') ? 'api' : '?',
      header: l.includes('in the API\'s allowed headers') ? 'api' : l.includes('in that endpoint\'s allowed headers') ? 'endpoint' : '?',
    };
  };
  const grid = choices.map(read);
  assert.deepEqual(grid.map((g) => `${g.origin}/${g.header}`).sort(), ['api/api', 'api/endpoint', 'shop/api', 'shop/endpoint']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['page-origin-api-header']);
  assert.deepEqual(read(choices.find((c) => c.right)), { origin: 'shop', header: 'api' });
  // The intro's facts decide each cell: the export carries the page's origin; the reply that blocks the call is the API's.
  assert.match(plain(CORS_STEP.intro), /the SDK's export POST https:\/\/otlp\.kettle\.example\/v1\/traces/i);
  assert.match(plain(CORS_STEP.intro), /Before the checkout call to https:\/\/api\.kettle\.example/);
});

test('step 2: labels are balanced, share every word between right and wrong options, and the right one is neither the longest nor the shortest', () => {
  assert.deepEqual(choices.map((c) => c.key), ['page-origin-api-header', 'page-origin-otlp-header', 'api-origin-api-header', 'api-origin-otlp-header']);
  const lens = choices.map((c) => plain(c.label).length);
  const right = lens[0];
  assert.equal(right < Math.max(...lens) && right > Math.min(...lens), true, `neither the longest nor the shortest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 12, true, `plain label lengths ${lens}`);
  for (const c of choices) assert.doesNotMatch(plain(c.label), /wrong|never|unsafe|careful|verify|check|both/i, c.key);
  assert.equal(choices.every((c) => (c.label.match(/<code>/g) ?? []).length === 2), true, 'every label has the same two code names');
});

test('step 2: each wrong cell says which half is right and which half fails, and what then still breaks', () => {
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  assert.match(why('page-origin-api-header'), /sent by the page, so its origin is https:\/\/shop\.kettle\.example/);
  assert.match(why('page-origin-api-header'), /allowed_origins under cors on the HTTP receiver/);
  assert.match(why('page-origin-api-header'), /reply that blocks it is the API's, and it is the API that has to list traceparent/);
  assert.match(why('page-origin-otlp-header'), /^The origin is right\. The header is not/);
  assert.match(why('page-origin-otlp-header'), /Content-Type and Authorization only/);
  assert.match(why('page-origin-otlp-header'), /payments keep failing/);
  assert.match(why('api-origin-api-header'), /^The header is right\. The origin is not/);
  assert.match(why('api-origin-api-header'), /no browser spans would arrive/);
  assert.match(why('api-origin-otlp-header'), /^Both changes land in the wrong place/);
  for (const c of choices) assert.equal(c.why.length > 80, true, `${c.key} has a why`);
});

test('step 2: the one Dash0 sentence names website monitoring, Core Web Vitals at p75 and the link to the backend trace, and only that', () => {
  const copy = plain(JSON.stringify(level.play));
  const dash0 = copy.match(/[^.]*Dash0[^.]*\./g) ?? [];
  const mentions = dash0.filter((s) => /website monitoring/.test(s));
  assert.equal(mentions.length, 1);
  for (const fact of ['sessions', 'Core Web Vitals (LCP, INP and CLS, at p75)', 'a request links to its backend trace']) assert.equal(mentions[0].includes(fact), true, fact);
  assert.doesNotMatch(copy, /\$\d|per month|pricing|free tier|session replay|rage click/i);
  assert.doesNotMatch(copy, /propagateTraceHeaderCorsUrls|propagateTraceHeader|allowedOrigins/, 'no SDK setting name is claimed');
});

// ---- sources and claims ---------------------------------------------------------------------

test('sources: W3C and OpenTelemetry on the Spec line, four Dash0 pages, the Collector README as Docs, reasoning marked, no MDN or web.dev', () => {
  const spec = SRC.split('\n').find((l) => /^\/\/ Spec: /.test(l));
  for (const url of ['https://www.w3.org/TR/trace-context/#traceparent-header', 'https://opentelemetry.io/docs/languages/js/exporters/']) assert.equal(spec.includes(url), true, url);
  const dash0 = SRC.split('\n').find((l) => /^\/\/ Dash0 docs: /.test(l));
  for (const page of ['monitoring/websites/website-monitoring', 'monitoring/websites/correlate-sessions-backend-traces', 'monitoring/websites/proxying-the-ingestion-endpoint', 'monitoring/websites/understand-web-vitals']) {
    assert.equal(dash0.includes(`https://www.dash0.com/docs/dash0/${page}`), true, page);
  }
  assert.match(SRC, /^\/\/ Docs \(GitHub README, not an allowed Spec host; the Collector's CORS settings\): https:\/\/github\.com\/open-telemetry\/opentelemetry-collector\/blob\/main\/receiver\/otlpreceiver\/README\.md#cors-cross-origin-resource-sharing$/m);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Stated as reasoning, with no source on an allowed host/);
  assert.match(SRC, /Invented for the game/);
  const hosts = ['www.w3.org', 'opentelemetry.io', 'www.dash0.com', 'github.com'];
  for (const url of SRC.split('\n').filter((l) => l.startsWith('//')).join('\n').match(/https:\/\/[^\s,):]+(?:\/[^\s,)]*)?/g)) assert.equal(hosts.includes(new URL(url).host), true, url);
  assert.equal(/developer\.mozilla\.org|web\.dev/.test(SRC), false, 'MDN and web.dev are not cited');
  assert.equal(SRC.includes(String.fromCharCode(0x2014)), false, 'no em dash');
});

test('claims: the CORS mechanics are only what the replies on screen show, scoped to this game\'s origins', () => {
  const finish = plain(level.play.finish);
  assert.match(finish, /^A trace can start in the browser: the traceparent header names the browser span that made the call, and the backend span becomes its child\./);
  assert.match(finish, /the telemetry endpoint must allow the page's origin, and the API must allow the traceparent header\.$/);
  const copy = plain(JSON.stringify(level.play));
  assert.doesNotMatch(copy, /always|every browser|all browsers|never allow/i, 'no universal claim in the copy');
});
