// Level 8.5 "AI-assisted debugging" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs, test/levels-play.test.mjs):
// the scenario pinned (views, kinds, costs, budget, answerAfterViews), the engine's validator and budget arithmetic on it, the one table
// every figure comes from (TABLE), the legacy-name query (a neutral view, set beside the versions query in step 2) against the 8.2 pair, tile labels with no tell, the simulated agent said plainly, an all-subsets probe
// through the real incident engine (the three clues are each needed; unlocking boards leave exactly one defensible cause), the hint tiers
// on every board, the reference path within budget (I7), one penalty per run, and a focus walk that ends on Finish. The scenario is
// designed for this game (#138); the structure mirrors test/everything-is-green.test.mjs. The happy and sloppy runs are generated from
// the level's data. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { answer, budgetLeft, canAnswer, newIncident, openView, validateScenario } from '../lib/widgets/incident.mjs';
import { hintFor } from '../lib/widgets/incident-help.mjs';
import { liveRegistry } from '../app.mjs';
import { TABLE } from '../levels/ai-assisted-debugging.mjs';
import semconv from '../levels/semantic-convention-versions.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { alertTitle, budget as board, causeState, locked as lockedOf, region } from './helpers/incident-board.mjs';
import { litIds } from './helpers/lights.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const ID = 'ai-assisted-debugging';
const LEVEL = LIVE.levels[ID];
const S = LEVEL.play.steps[0].incident;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
const CLUES = ['failures-by-version', 'failing-trace', 'request-rate'];
const NEUTRALS = ['alert-rule', 'node-status', 'service-list', 'failed-requests'];
const HERRINGS = ['recent-changes', 'card-charges'];
const RIGHT = 'inventory-failing';
const LEGACY = 'http.status_code';
const STABLE = 'http.response.status_code';
const WINDOW = `${TABLE.failuresFrom} to ${TABLE.queryAt}`;
const fmt = (n) => n.toLocaleString('en-US');
const per1000 = (e, r) => ((e / r) * 1000).toFixed(1);

// ---- content pin ---------------------------------------------------------------------

test('8.5: scenario pin: id, budget, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'Checkout failing at the last step');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 5 });
  assert.equal(S.answerAfterViews, 3);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'failures-by-version|clue|4', 'failing-trace|clue|4', 'request-rate|clue|3',
      'alert-rule|neutral|2', 'node-status|neutral|3', 'service-list|neutral|2', 'failed-requests|neutral|1',
      'recent-changes|herring|4', 'card-charges|herring|3',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['inventory-failing|true', 'bad-release|false', 'payment-timeouts|false', 'order-surge|false'],
  );
});

test('8.5: tile labels carry no tell: no herring is among the two longest or two shortest, a clue and a neutral also name a window, herrings are not the only ones with "last"', () => {
  const byLen = [...S.views].sort((a, b) => a.label.length - b.label.length).map((v) => v.id);
  for (const h of HERRINGS) {
    assert.equal(byLen.slice(-2).includes(h) || byLen.slice(0, 2).includes(h), false, `${h} is not an extreme label`);
  }
  const withLast = S.views.filter((v) => /\blast\b/.test(v.label));
  assert.equal(withLast.some((v) => v.kind === 'clue') && withLast.some((v) => v.kind === 'neutral'), true, 'a clue and a neutral name a window');
  assert.equal(withLast.filter((v) => v.kind !== 'herring').length > HERRINGS.length, true, 'more non-herrings than herrings say "last"');
  assert.equal(HERRINGS.every((h) => /\blast\b/.test(view(h).label)) && withLast.length > HERRINGS.length, true);
});

test('8.5: valid; 20 minutes; clues plus neutrals cost 19 min and leave 5% (1 min), so only a herring can exhaust the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(S.budget.startPct / S.budget.burnPctPerMin, 20);
  assert.equal(cost('clue'), 11);
  assert.equal(cost('neutral'), 8);
  assert.equal(cost('herring'), 7);
  assert.equal(S.budget.startPct - (cost('clue') + cost('neutral')) * S.budget.burnPctPerMin, 5);
  for (const h of S.views.filter((v) => v.kind === 'herring')) assert.equal(h.costMin > 1, true, `${h.id} alone spends more than the 1 min that is left`);
  assert.equal(S.views.every((v) => v.costMin <= 4), true, 'no view is a long wait');
  assert.equal(S.views.filter((v) => v.kind === 'neutral').length >= 2 && S.views.filter((v) => v.kind === 'herring').length === 2, true, 'two herrings');
  assert.equal(S.hypotheses.filter((h) => h.right).length, 1);
});

test('8.5: a scored non-boss level of act-8, last, lighting existing nodes, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: LEVEL.id, no: LEVEL.no, name: LEVEL.name, sub: LEVEL.sub, icon: LEVEL.icon, rewardTitle: LEVEL.rewardTitle, mechanics: [...LEVEL.mechanics], hintless: [...LEVEL.hintless], cards: [...LEVEL.cards], lights: [...LEVEL.lights], scored: LEVEL.scored, parMs: LEVEL.scoring.parMs, kind: LEVEL.kind, actId: LEVEL.actId, prefix: LEVEL.play.prefix },
    { id: ID, no: '8.5', name: 'AI-assisted debugging', sub: 'The agent asks by name', icon: '\u{1F916}', rewardTitle: 'Query reader', mechanics: ['incident'], hintless: [], cards: [], lights: ['checkout', 'inventory'], scored: true, parMs: null, kind: 'level', actId: 'act-8', prefix: 'aad' },
  );
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Query reader').length, 1, 'the reward title is unique');
  assert.deepEqual(LEVEL.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))), ['incident', 'choice']);
  const act = LIVE.acts.find((a) => a.id === 'act-8');
  assert.equal(act.bossId, null, 'a level with an incident step, not a boss');
  assert.deepEqual([...act.levelIds], ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors', 'frontend-rum', ID]);
  assert.equal(LIVE.order[LIVE.order.indexOf('frontend-rum') + 1], ID, '8.5 plays right after 8.4');
  assert.equal(S.hypotheses.length, 4);
});

test('8.5: lights checkout and inventory (existing nodes), pinned by what completing it lights', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['checkout', 'inventory']);
  assert.deepEqual(lit(['dashboards-as-code']), ['checkout'], '8.1 already lights checkout; inventory is new with 8.5');
});

test('8.5: star totals count it (the derived scored-level max), and a 3-star run is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('globe: 8.5 lights the Philippines and, last of the act, completes Southeast Asia', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'PHL');
  assert.equal(COUNTRY_NAMES.PHL, 'the Philippines');
  assert.equal(ACT_REGIONS['act-8'].region, 'Southeast Asia');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const progressOf = (ids) => {
    const p = emptyProgress();
    for (const id of ids) p.levels[id] = { stars: 3, at: null };
    return p;
  };
  const others = ['dashboards-as-code', 'semantic-convention-versions', 'migrating-vendors', 'frontend-rum'];
  const fresh = freshlyLit(progressOf(others), progressOf([...others, ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['PHL'], regionIds: ['act-8'] });
  assert.equal(litText(fresh, LEVEL, map), 'The Philippines is now lit: AI-assisted debugging. Southeast Asia is complete.');
  assert.deepEqual(freshlyLit(emptyProgress(), progressOf([ID]), LIVE, map), { countryIds: ['PHL'], regionIds: [] }, 'alone it leaves the region open');
});

test('8.5: no em dash in the level file or this level\'s copy', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes(String.fromCharCode(0x2014)), false);
  assert.equal(JSON.stringify(LEVEL.play).includes(String.fromCharCode(0x2014)), false);
});

// ---- the one table ---------------------------------------------------------------------

const [OLD, NEW] = TABLE.versions;
const failed = OLD.afterErrors + NEW.afterErrors;
const requests = OLD.afterRequests + NEW.afterRequests;

test('the table is pinned: times, the two versions, the request rate, the rule and the counts', () => {
  assert.deepEqual(
    { releaseAt: TABLE.releaseAt, failuresFrom: TABLE.failuresFrom, ruleFiredAt: TABLE.ruleFiredAt, queryAt: TABLE.queryAt, beforeMin: TABLE.beforeMin, afterMin: TABLE.afterMin, errorRatioRulePct: TABLE.errorRatioRulePct, sampledTraces: TABLE.sampledTraces, services: TABLE.services, nodes: TABLE.nodes },
    { releaseAt: '09:40', failuresFrom: '10:12', ruleFiredAt: '10:27', queryAt: '10:36', beforeMin: 32, afterMin: 24, errorRatioRulePct: 5, sampledTraces: 20, services: 23, nodes: 9 },
  );
  assert.deepEqual(TABLE.versions, [
    { v: '2.13.4', beforeRequests: 7200, beforeErrors: 8, afterRequests: 5400, afterErrors: 492 },
    { v: '2.14.0', beforeRequests: 7200, beforeErrors: 7, afterRequests: 5400, afterErrors: 492 },
  ]);
  assert.deepEqual(TABLE.rate, [{ at: '09:50', perMin: 448 }, { at: '10:10', perMin: 452 }, { at: '10:12', perMin: 449 }, { at: '10:30', perMin: 451 }]);
});

test('the table agrees with itself: 225 requests a minute per version, 450 in all; the rule fires 15 minutes after the failures start; the ratio is above the rule', () => {
  const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  for (const x of TABLE.versions) {
    assert.equal(x.beforeRequests / TABLE.beforeMin, 225, `${x.v} before`);
    assert.equal(x.afterRequests / TABLE.afterMin, 225, `${x.v} after`);
  }
  assert.equal(minutes(TABLE.failuresFrom) - minutes(TABLE.releaseAt), TABLE.beforeMin);
  assert.equal(minutes(TABLE.queryAt) - minutes(TABLE.failuresFrom), TABLE.afterMin);
  assert.equal(minutes(TABLE.ruleFiredAt) - minutes(TABLE.failuresFrom), 15);
  assert.equal(requests / TABLE.afterMin, 450);
  assert.equal(TABLE.rate.every((x) => Math.abs(x.perMin - 450) <= 5), true, 'the rate stays within 5 of 450');
  assert.equal((failed / requests) * 100 > TABLE.errorRatioRulePct, true);
  assert.equal(failed, 984);
  assert.equal(requests, 10800);
  assert.equal(per1000(OLD.afterErrors, OLD.afterRequests), '91.1');
  assert.equal(per1000(NEW.beforeErrors, NEW.beforeRequests), '1.0');
  assert.equal(per1000(OLD.beforeErrors, OLD.beforeRequests), '1.1');
  assert.equal(((failed / requests) * 100).toFixed(1), '9.1');
});

test('the views state exactly the table\'s figures', () => {
  const byVersion = plain(view('failures-by-version').html);
  for (const x of TABLE.versions) {
    assert.equal(byVersion.includes(`${x.v} ${per1000(x.beforeErrors, x.beforeRequests)} ${per1000(x.afterErrors, x.afterRequests)}`), true, x.v);
  }
  assert.equal(byVersion.includes(`${NEW.v} went live on 3 of the 6 pods at ${TABLE.releaseAt}`) && byVersion.includes(`ran ${TABLE.beforeMin} minutes`), true);
  assert.equal(/\b(7,200|5,400|10,800|450)\b/.test(byVersion), false, 'the version view shows rates, not volumes, so it cannot rule out a surge');
  const rate = plain(view('request-rate').html);
  for (const x of TABLE.rate) assert.equal(rate.includes(`${x.at} ${fmt(x.perMin)}`), true, x.at);
  const rule = plain(view('alert-rule').html);
  assert.equal(rule.includes(`above ${TABLE.errorRatioRulePct}% for 15 minutes`) && rule.includes(`since ${TABLE.ruleFiredAt}`) && rule.includes(`The ratio since ${TABLE.failuresFrom} is ${((failed / requests) * 100).toFixed(1)}%`), true, 'the ratio is over the stated window');
  const charges = plain(view('card-charges').html);
  for (const x of TABLE.charges) assert.equal(charges.includes(`${x.at} ${x.p95Ms}`), true, x.at);
  assert.deepEqual(TABLE.charges, [{ at: '09:50', p95Ms: 410 }, { at: '10:12', p95Ms: 430 }, { at: '10:30', p95Ms: 520 }]);
  assert.equal(plain(view('node-status').html), `${TABLE.nodes} of ${TABLE.nodes} nodes in the checkout pool are Ready.`);
  assert.equal(plain(view('service-list').html).includes(`${TABLE.services} services`), true);
  const trace = plain(view('failing-trace').html);
  assert.equal(trace.includes(`one of the ${TABLE.sampledTraces} failing traces`) && trace.includes(`since ${TABLE.failuresFrom}`), true);
  assert.equal(trace.includes('SERVER 500') && trace.includes('CLIENT 503') && trace.includes('server.address=inventory.kettle.example'), true);
  assert.equal(trace.includes('Checkout reserves stock first and takes the payment after') && trace.includes('No span in the trace calls the payment provider'), true);
});

test('the time line holds: release 09:40, failures 10:12, rule 10:27 = the page, queries to 10:36; the alert does not name the cause', () => {
  const alert = plain(S.alert.html);
  assert.equal(alert.includes(`PAGE ${TABLE.ruleFiredAt}`), true);
  assert.equal(/inventory|payment|release|503|version|stock|surge/i.test(alert), false, 'the alert names no cause');
  assert.equal(plain(view('recent-changes').html).includes(`${TABLE.releaseAt} checkout release ${NEW.v} on 3 of 6 pods`), true, 'the release time agrees with the table');
});

// ---- the herring, and the 8.2 pair -----------------------------------------------------

test('the legacy-name query is a neutral view, so no star is lost for looking: it queries the legacy name of the 8.2 pair and returns nothing; the clues query the stable name', () => {
  assert.equal(view('failed-requests').kind, 'neutral');
  assert.equal(HERRINGS.includes('failed-requests'), false);
  const spot = semconv.play.steps[0].spot;
  assert.equal(spot.lines.some((l) => l.text === `${LEGACY}=500`), true, '8.2 shows the old name');
  assert.equal(spot.faults.includes('http-status-code'), true, '8.2 has the old name as a fault');
  assert.equal(spot.explain.includes(`<code>${LEGACY}</code> (now <code>${STABLE}</code>)`), true, 'the pair is the one 8.2 states');
  const legacy = plain(view('failed-requests').html);
  assert.equal(legacy.includes(`${LEGACY} = 500`) && legacy.includes('result: 0 spans') && legacy.includes('no failed checkout requests'), true);
  assert.equal(legacy.includes(STABLE), false, 'the legacy view never shows the stable name; the player compares it with the versions view');
  const uses = (id) => plain(view(id).html);
  assert.equal(uses('failures-by-version').includes(`${STABLE} = 500`), true, 'a clue asks by the stable name');
  for (const v of S.views.filter((x) => x.id !== 'failed-requests')) assert.equal(uses(v.id).includes(LEGACY), false, `${v.id} does not use the legacy name`);
  assert.equal(S.hypotheses.some((h) => h.id === 'false-alarm'), false, 'no step 1 cause is a trap nobody can fall into');
});

test('8.5: the legacy view costs no mistake; a player who opened it and the clues still has one defensible cause', () => {
  const st = [...CLUES, 'failed-requests'].reduce((acc, id) => openView(S, acc, id).state, newIncident(S));
  assert.equal(openView(S, newIncident(S), 'failed-requests').herring, false);
  assert.equal(openView(S, newIncident(S), 'failed-requests').exhaustedNow, false);
  assert.equal(canAnswer(S, st), true);
  assert.deepEqual(defensibleOn([...CLUES, 'failed-requests']), [RIGHT]);
});

// ---- the agent is simulated ------------------------------------------------------------

test('the copy says the agent is simulated once, in the alert (not again in the step intro), and no view claims a model, a tool or a product', () => {
  assert.equal(/simulated/.test(plain(S.alert.html)) && /no model is called and no real MCP server is reached/.test(plain(S.alert.html)), true);
  const intro = plain(LEVEL.play.steps[0].intro);
  assert.equal(/simulated|no model|MCP/i.test(intro), false, 'the step intro does not repeat it');
  for (const v of S.views) assert.equal(/Dash0|Agent0|MCP|getAttributeKeys|credit|pricing|GPT|Claude/i.test(plain(v.html)), false, `${v.id}: no product or tool claim inside a simulated view`);
});

// ---- sources ---------------------------------------------------------------------------

test('sources: one Spec line on opentelemetry.io, Dash0 docs lines on www.dash0.com, the not-claimed and invented parts marked, no pricing', () => {
  const src = read(`levels/${ID}.mjs`);
  const lines = src.split('\n');
  const urls = (re) => lines.filter((l) => re.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.deepEqual(urls(/^\/\/ Spec: /), ['https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/']);
  const docs = urls(/^\/\/ Dash0 docs: /);
  assert.deepEqual(docs, [
    'https://www.dash0.com/docs/dash0/ai/mcp',
    'https://www.dash0.com/docs/dash0/ai/agent0/overview',
    'https://www.dash0.com/docs/dash0/ai/agent0/overview/use-agent0/query-telemetry-via-mcp',
  ]);
  assert.equal(docs.every((u) => new URL(u).host === 'www.dash0.com'), true);
  assert.equal(lines.some((l) => /^\/\/ Not claimed: /.test(l)) || src.includes('Not claimed:'), true);
  assert.equal(lines.some((l) => /^\/\/ Invented for the game:/.test(l)), true);
  assert.equal(/\bthe spec says\b/i.test(src), false);
  assert.equal(/\b(price|pricing|per month|free tier|credits?)\b/i.test(JSON.stringify(LEVEL.play).replace(/not claimed/gi, '')), false, 'no pricing or credit copy in the play');
});

test('the Dash0 tie-in is only what the docs say: the MCP server lets an assistant query with read-only tools, Agent0 reads the semantic conventions it was produced in', () => {
  const claims = plain([LEVEL.play.finish, ...LEVEL.play.steps[1].choice.choices.map((c) => c.why)].join(' '));
  assert.equal(claims.includes('Agent0 reads telemetry in the OpenTelemetry semantic conventions it was produced in'), true);
  assert.equal(claims.includes('the MCP Server lets an assistant query your telemetry with read-only tools'), true);
  assert.equal(claims.includes('one of the tools of the Dash0 MCP Server'), true);
  assert.equal(/MCP server/.test(claims), false, 'the product is spelled as its page title, MCP Server');
  assert.equal(/as a person does|names to ask for/.test(claims), false, 'no unsourced claim about how an agent asks');
  assert.equal(claims.includes('getAttributeKeys'), true);
});

// ---- all subsets through the real engine ---------------------------------------------------

// What each wrong cause is ruled out by: the views that show it cannot be. Each clue is the only view that rules out one cause.
const REFUTED_BY = {
  'bad-release': { 'failures-by-version': 'Both versions fail at the same rate' },
  'payment-timeouts': { 'failing-trace': 'No span in the trace calls the payment provider' },
  'order-surge': { 'request-rate': 'The rate did not change' },
};
const idsOf = S.views.map((v) => v.id);
const defensibleOn = (set) => S.hypotheses.filter((h) => h.right || !Object.keys(REFUTED_BY[h.id]).some((v) => set.includes(v))).map((h) => h.id);
const subsets = function* () {
  for (let mask = 0; mask < 1 << idsOf.length; mask += 1) yield idsOf.filter((_, i) => mask & (1 << i));
};

test('each refutation is in the text of the view it names', () => {
  for (const [h, byView] of Object.entries(REFUTED_BY)) {
    for (const [v, words] of Object.entries(byView)) assert.equal(plain(view(v).html).includes(words), true, `${h} / ${v}`);
  }
  assert.deepEqual(Object.keys(REFUTED_BY).sort(), S.hypotheses.filter((h) => !h.right).map((h) => h.id).sort());
});

test('no neutral or herring view refutes the three causes the clues each settle, so no board shortcuts a clue', () => {
  const only = ['bad-release', 'payment-timeouts', 'order-surge'];
  for (const h of only) assert.equal(Object.keys(REFUTED_BY[h]).length, 1, `${h} is ruled out by one view`);
  for (const v of [...NEUTRALS, ...HERRINGS]) {
    const t = plain(view(v).html);
    assert.equal(/both versions|same rate|requests a minute|rate did not/i.test(t), false, `${v} does not speak to the version or the rate`);
    if (v !== 'card-charges') assert.equal(/payment (provider|call)/i.test(t), false, `${v} does not speak to the payment call`);
  }
  assert.equal(/did not say|does not say whether the failing orders reached a charge/i.test(plain(view('card-charges').html)), true, 'the charge herring leaves the trace to refute it');
  assert.deepEqual(CLUES.map((c) => only.filter((h) => REFUTED_BY[h][c]).length), [1, 1, 1], 'each clue rules out exactly one of them');
});

test('all 512 boards of the nine views: the boards that unlock hold all three clues and leave exactly the right cause; each clue alone is needed to settle one cause', () => {
  let unlocking = 0;
  let missing = 0;
  for (const set of subsets()) {
    let st = newIncident(S);
    for (const id of set) st = openView(S, st, id).state;
    const defensible = defensibleOn(set);
    if (canAnswer(S, st)) {
      unlocking += 1;
      assert.equal(CLUES.every((c) => set.includes(c)), true, `an unlocking board holds every clue: ${set.join()}`);
      assert.deepEqual(defensible, [RIGHT], set.join());
    }
    for (const c of CLUES.filter((x) => !set.includes(x))) {
      missing += 1;
      assert.equal(defensible.length >= 2 && defensible.includes(RIGHT), true, `a board without ${c} keeps two defensible causes: ${set.join()}`);
    }
  }
  assert.equal(unlocking, 64, 'the three clues with any of the six other views');
  assert.equal(missing > 0, true);
});

test('with the threshold lowered to two clues, every board lacking a clue would still leave two defensible causes (the clues are decisive, not just counted)', () => {
  let boards = 0;
  for (const set of subsets()) {
    const have = CLUES.filter((c) => set.includes(c)).length;
    if (have !== 2) continue;
    boards += 1;
    assert.equal(defensibleOn(set).length >= 2, true, set.join());
  }
  assert.equal(boards, 3 * 64, 'three pairs of clues with any of the six other views');
});

// ---- the hint tiers on every board -------------------------------------------------------

test('tier 1 holds on every board: a cause has to explain where the failing requests stop and whether the release explains the failures, with no view to open and nothing given away', () => {
  const t = plain(S.hint);
  assert.equal(t.includes('where the failing requests stop') && t.includes('whether the release explains the failures'), true);
  assert.equal(/not opened|open|alike|inventory|503/i.test(t), false, 'no view-opening instruction and no clue read out');
  assert.equal(/attribute|status_code|name/i.test(t), false, 'step 1 tier 1 leaves the naming to step 2');
});

test('no hint tier names the cause on any of the 512 boards: tier 1 is the authored hint, tier 2 names only clue views, tier 3 is the paid one', () => {
  const rightLabel = plain(S.hypotheses.find((h) => h.id === RIGHT).label);
  const causeWords = ['inventory', 'stock', 'reservation', '503'];
  for (const set of subsets()) {
    let st = newIncident(S);
    for (const id of set) st = openView(S, st, id).state;
    const t1 = hintFor(S, st, 1);
    assert.equal(t1.html, S.hint);
    assert.equal(/failed-requests|http\.status_code|0 spans|empty|changes|charge|payment/i.test(plain(t1.html)), false, 'tier 1 points at no view');
    assert.deepEqual([t1.views, t1.hypothesis], [[], null]);
    const t2 = hintFor(S, st, 2);
    assert.equal(t2.hypothesis, null);
    assert.equal(t2.views.every((v) => CLUES.includes(v) && !set.includes(v)), true, 'tier 2 outlines only unopened clue views');
    for (const html of [t1.html, t2.html]) {
      const text = plain(html).toLowerCase();
      assert.equal(causeWords.some((w) => text.includes(w)) || text.includes(rightLabel.toLowerCase()), false, `${set.join()}: ${text}`);
    }
  }
  assert.equal(hintFor(S, newIncident(S), 3).hypothesis, RIGHT, 'tier 3 is where the cause is named');
});

// ---- play ----------------------------------------------------------------------------

/** Start the level with the real ctx; counts ctx.mistake() calls. */
function start() {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const finished = [];
  const slips = { mistakes: 0 };
  const ctx = createLevelContext({
    level: LEVEL,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (_id, r) => finished.push(r),
    signal: new AbortController().signal,
  });
  const mistake = ctx.mistake;
  ctx.mistake = () => {
    slips.mistakes += 1;
    mistake();
  };
  LEVEL.run(ctx);
  return { finished, focus, slips };
}

const open = (id) => click(`[data-view="${id}"]`);
const guess = (id) => click(`[data-hypothesis="${id}"]`);
const budget = () => {
  const b = board(ID);
  return `${b.left} ${b.spent}`;
};
const locked = () => lockedOf(ID);
const status = () => region(ID, 'status');
const feedback = () => region(ID, 'feedback');
/** After the right hypothesis: Next, the closing Choice answered right, then Finish. */
const finish = () => {
  click('#aad-next');
  click('[data-pick="old-name"]');
  click('[data-finish]');
};

test('8.5: the first screen shows the alert, a full budget, nine views, locked hypotheses and a disabled Next', () => {
  start();
  assert.equal(alertTitle(ID), 'Checkout failing at the last step');
  assert.equal(budget(), '20 min left. 0 of 20 min spent');
  assert.equal(board(ID).cells.total, 20);
  assert.equal(qa('[data-view]').length, 9);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#aad-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('8.5: it takes all three clue views to unlock the answers (answerAfterViews 3): two are not enough, and neutrals and herrings never count', () => {
  start();
  for (const id of [...NEUTRALS, ...HERRINGS]) open(id);
  assert.equal(locked(), 'true,true,true,true');
  open('failures-by-version');
  open('request-rate');
  assert.equal(locked(), 'true,true,true,true');
  open('failing-trace');
  assert.equal(locked(), 'false,false,false,false');
});

test('8.5: the reference path (the three clues, then inventory-failing) solves with 45% of the budget (9 min) left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of CLUES) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 45);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, RIGHT).outcome, 'right');
  assert.equal(mistakes, 0);
});

test('8.5: shortcut: opening every view in order exhausts at the first herring and costs three mistakes (two herrings, one exhaustion); the legacy query is free; the answer is still open', () => {
  let st = newIncident(S);
  let mistakes = 0;
  const exhaustedOn = [];
  for (const v of S.views) {
    const r = openView(S, st, v.id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
    if (r.exhaustedNow) exhaustedOn.push(v.id);
  }
  assert.deepEqual(exhaustedOn, ['recent-changes']);
  assert.equal(budgetLeft(S, st), 0);
  assert.equal(mistakes, 3);
  assert.equal(answer(S, st, RIGHT).outcome, 'right', 'the incident is still solvable at 0');
});

test('8.5: shortcut: clues and neutrals in any order are never penalised and never exhaust; a herring is the only way to run out', () => {
  for (const order of [[...CLUES, ...NEUTRALS], [...NEUTRALS, ...CLUES], [...CLUES].reverse().concat(NEUTRALS)]) {
    let st = newIncident(S);
    for (const id of order) {
      const r = openView(S, st, id);
      st = r.state;
      assert.equal(r.herring || r.exhaustedNow, false, order.join());
    }
    assert.equal(budgetLeft(S, st), 5, order.join());
    for (const h of HERRINGS) assert.equal(openView(S, st, h).exhaustedNow, true, `${h} alone runs out the last minute`);
  }
});

test('8.5: shortcut impossible: four neutrals leave every hypothesis locked with 12 of 20 min left', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  assert.equal(budget(), '12 min left. 8 of 20 min spent');
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#aad-next').disabled, true);
  assert.equal(finished.length, 0);
  assert.equal(slips.mistakes, 0);
});

test('8.5: the shortest path is the three clues; it solves with 9 of 20 min left, no penalty and 5 stars, and the answer does not finish the level', () => {
  const { finished, slips } = start();
  for (const id of CLUES) open(id);
  assert.equal(q('#aad-next').disabled, true, 'Next waits for the right answer');
  guess(RIGHT);
  assert.equal(finished.length, 0);
  assert.equal(qa('[data-finish]').length, 0);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '9 min left. 11 of 20 min spent');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, LEVEL.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('8.5: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('recent-changes');
  assert.equal(slips.mistakes, 1);
  assert.deepEqual([status().tone, status().text.includes('was misleading')], ['error', true]);
  open('recent-changes');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  for (const id of CLUES) open(id);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('8.5: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('card-charges');
  open('recent-changes');
  for (const id of CLUES) open(id);
  assert.equal(slips.mistakes, 2);
  guess('order-surge');
  assert.equal(slips.mistakes, 3);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['bad-release', 'payment-timeouts', 'order-surge']) {
  test(`8.5: guessing ${id} costs one mistake, once, and is then ruled out (picking it again is free)`, () => {
    const { slips, finished } = start();
    for (const v of CLUES) open(v);
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(causeState(ID, id), 'wrong');
    assert.equal(feedback().text.startsWith('Not quite.'), true);
    guess(id);
    assert.equal(slips.mistakes, 1);
    guess(RIGHT);
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('8.5: every clue and neutral leaves 1 min and no mistake; a herring then spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  assert.equal(slips.mistakes, 0, '19 min in: 1 left, nothing spent yet');
  assert.equal(budget(), '1 min left. 19 of 20 min spent');
  open('recent-changes');
  assert.equal(slips.mistakes, 2);
  assert.equal(board(ID).left, 'Budget spent.');
  assert.deepEqual([status().tone, status().text.includes('was misleading, and the error budget is spent')], ['error', true]);
  assert.equal(causeState(ID, RIGHT), null, 'still answerable at 0');
  guess(RIGHT);
  finish();
  assert.equal(finished[0].stars, 3, 'two penalties leave 3 stars');
});

test('8.5: the legacy-name query is free: it costs 1 min, no mistake and no "misleading" note, and the run keeps 5 stars', () => {
  const { slips, finished } = start();
  open('failed-requests');
  assert.equal(slips.mistakes, 0);
  assert.equal(status().text.includes('misleading'), false);
  for (const id of CLUES) open(id);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 0);
  assert.equal(finished[0].stars, 5);
});

test('8.5: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  for (const id of ['failing-trace', 'alert-rule', 'service-list']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), '1 min left. 19 of 20 min spent');
});

// ---- the closing Choice: the naming nuance -------------------------------------------------

const pick = LEVEL.play.steps[1].choice.choices;
const choice = (key) => pick.find((c) => c.key === key);

test('8.5: step 2 asks why the failed-requests query found nothing: one right cause, three wrong ones that are all about the name, each with a why', () => {
  assert.deepEqual(pick.filter((c) => c.right).map((c) => c.key), ['old-name']);
  assert.deepEqual(pick.filter((c) => !c.right).map((c) => c.key), ['invented-name', 'newer-name', 'metric-label']);
  assert.equal(plain(LEVEL.play.steps[1].question), "Why did the agent's failed-requests query return nothing?");
  const right = plain(choice('old-name').why);
  for (const w of [STABLE, LEGACY, 'level 8.2', 'Agent0 reads telemetry in the OpenTelemetry semantic conventions it was produced in', 'getAttributeKeys', 'Dash0 MCP Server', 'Use the names the spans carry', `${fmt(failed)} failed from ${WINDOW}`]) assert.equal(right.includes(w), true, w);
  const inv = plain(choice('invented-name').why);
  for (const w of [LEGACY, STABLE, 'level 8.2']) assert.equal(inv.includes(w), true, `the invented-name decoy is refuted by the migration pair: ${w}`);
  const mirror = plain(choice('newer-name').why);
  for (const w of [LEGACY, STABLE, 'older name', 'level 8.2'.replace('level ', ''), `${fmt(failed)} failed from ${WINDOW}`]) assert.equal(mirror.includes(w), true, `the mirror decoy is refuted by the pair: ${w}`);
  const metric = plain(choice('metric-label').why);
  for (const w of ['span attribute names', 'HTTP conventions', 'migration']) assert.equal(metric.includes(w), true, w);
});

test('8.5: no step 2 decoy is ruled out by the step text alone: none mentions case, and the right label and a mirror decoy claim opposite directions of the rename', () => {
  for (const c of pick) assert.equal(/\b(case|upper|lower|spell\w*)\b/i.test(c.label), false, `${c.key}: nothing about case`);
  assert.equal(/\b(before|older)\b/.test(choice('old-name').label), true);
  assert.equal(/\bnewer\b/.test(choice('newer-name').label), true, 'the mirror decoy claims the opposite direction');
  for (const c of pick.filter((x) => !x.right)) assert.equal(/\b(before|older|earlier)\b/.test(c.label), false, `${c.key}: only the right label states the rename direction`);
  assert.equal(plain(LEVEL.play.steps[1].code).includes(`the ${WINDOW} column of the step 1 versions query`), true);
  assert.equal(plain(view('failed-requests').label), `Agent: failed requests, ${WINDOW}`);
});

test('8.5: step 2 shows the two queries side by side over one explicit window and one service, with the TABLE figures, and names neither attribute in the prose', () => {
  const step = LEVEL.play.steps[1];
  const code = step.code;
  const first = code.indexOf(`${LEGACY} = 500`);
  const second = code.indexOf(`${STABLE} = 500`);
  assert.equal(first > -1 && second > first, true, 'the failed-requests query, then the versions query');
  assert.equal(code.split(WINDOW).length - 1, 2, 'both queries carry the one explicit window');
  assert.equal(code.includes('since'), false, 'no open-ended window');
  assert.equal(code.split('service.name = checkout').length - 1, 2, 'both queries use the one service');
  assert.equal(code.includes('result: 0 spans') && code.includes(`result: ${fmt(failed)} failed`), true);
  assert.equal(failed, 984);
  const intro = plain(step.intro);
  assert.equal(intro.includes(`${fmt(failed)} failed from ${WINDOW}`), true);
  assert.equal(/\blater\b|\bfirst\b/i.test(intro), false, 'no ordering in the intro: nothing says when each query ran');
  assert.equal(intro.includes('failed-requests query'), true);
  assert.equal(intro.includes('http.') || /status_code/.test(intro), false, 'the intro names neither attribute');
  assert.equal(plain(view('failed-requests').html).includes(WINDOW), true, 'the failed-requests view uses the same window');
  assert.equal(plain(view('failures-by-version').html).includes(`each version had ${fmt(TABLE.versions[0].afterErrors)} failed requests, ${fmt(failed)} failed in all`), true, 'step 1 gives the counts that make the 984');
  assert.equal(TABLE.versions.reduce((n, x) => n + x.afterErrors, 0), failed);
  assert.equal(/getAttributeKeys/.test(plain(LEVEL.play.finish)) && /Dash0 MCP Server/.test(plain(LEVEL.play.finish)), true);
});

test('8.5: step 2 labels are balanced: the right one is neither the longest nor the shortest, within 15 characters of the others, attribute or name in more than one label, varied openings, no verify tail', () => {
  const lens = pick.map((c) => plain(c.label).length);
  const right = plain(choice('old-name').label);
  assert.equal(right.length < Math.max(...lens) && right.length > Math.min(...lens), true, lens.join());
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 15, true, lens.join());
  assert.equal(pick.filter((c) => /\b(attribute|name)\b/i.test(c.label)).length >= 3, true, 'attribute or name is not the right label alone');
  assert.equal(pick.every((c) => /\b(name|status code)\b/.test(c.label)), true, 'every label is about the name');
  assert.equal(new Set(pick.map((c) => c.label.split(' ').slice(0, 2).join(' '))).size >= 3, true, 'the labels do not all open alike');
  assert.equal(pick.every((c) => !/,/.test(c.label)), true, 'one shape: no clause after a comma');
  for (const c of pick) assert.equal(/\b(verify|check|make sure|confirm)\b/i.test(c.label), false, `${c.key}: no verify tail`);
  for (const c of pick) assert.equal(c.label.includes(LEGACY) || c.label.includes(STABLE), false, `${c.key}: no label repeats the query text`);
  for (const v of S.views) assert.equal(/attribute|no longer sends/i.test(v.label), false, 'no view tile echoes a label');
});

test('8.5: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  for (const id of CLUES) open(id);
  guess(RIGHT);
  click('#aad-next');
  click('[data-pick="invented-name"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right change');
  click('[data-pick="old-name"]');
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('8.5: focus walk: first view, an opened heading, the win card, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:failures-by-version');
  open('failures-by-version');
  assert.equal(focus.last(), 'heading:failures-by-version');
  open('failing-trace');
  open('request-rate');
  guess(RIGHT);
  assert.equal(focus.last(), `#${ID}-win-title`);
  assert.equal(q('#aad-next').disabled, false);
  click('#aad-next');
  click('[data-pick="old-name"]');
  assert.equal(focus.last(), '#aad-finish');
  assert.equal(q('[data-finish]').id, 'aad-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
