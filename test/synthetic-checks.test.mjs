// Level 7.4 "Synthetic checks" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs, test/sort-tells.test.mjs):
// level fields and the globe; the Sort it step (items, buckets, the reference placement); the Choice (the numbers of the expired
// certificate shown against each alert); the card; the sources. Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK } from '../cards/deck.mjs';
import { liveRegistry } from '../app.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { newSortState, place, validateSortSpec } from '../lib/widgets/sort-it.mjs';
import { scoreStars } from '../lib/scoring.mjs';

const ID = 'synthetic-checks';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '');
const level = LIVE.levels[ID];
const [SORT_STEP, ALERT_STEP] = level.play.steps;
const sort = SORT_STEP.sort;

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};

test('7.4 fields: last level of act-7, scored with no par time, a sort then a choice, no Configure it, lights the edge, awards synthetics-see-the-edge', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '7.4', name: 'Synthetic checks', sub: 'See what users see', icon: '\u{1F4E1}', rewardTitle: 'Edge watcher', kind: 'level', actId: 'act-7', parMs: null, prefix: 'sc' },
  );
  assert.deepEqual([...level.mechanics], ['sort'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual([...level.hintless], ['sort']);
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'sort', 'configure'].find((k) => s[k])), ['sort', 'choice']);
  assert.equal(level.mechanics.includes('configure'), false);
  assert.deepEqual([...level.lights], ['storefront', 'api-gateway']);
  assert.deepEqual([...level.cards], ['synthetics-see-the-edge']);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Edge watcher').length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-7');
  assert.deepEqual([...act.levelIds], ['good-alerts', 'slis-and-slos', 'burn-rate-alerts', ID]);
});

test('card synthetics-see-the-edge: scoped front, fits a card, a spec page as source, the angle carries no bare URL fragment', () => {
  const card = DECK.find((c) => c.id === 'synthetics-see-the-edge');
  assert.equal(card.front, 'Failures in front of your service (DNS, TLS, CDN, load balancer) leave no server span of yours; a probe from outside sees them.');
  assert.equal(card.front.length <= 140, true, `front is ${card.front.length} characters`);
  assert.match(card.front, /in front of your service/, 'scoped, not a universal claim');
  assert.equal(card.specUrl, 'https://opentelemetry.io/docs/specs/semconv/http/http-spans/');
  for (const w of ['DNS lookup', 'TLS handshake', 'no server span', '0%', 'can happen before', 'client span', 'DNS error included', 'proxy or ingress you instrument']) assert.equal(card.back.includes(w), true, w);
  for (const w of ['DNS resolution', 'TCP connection', 'SSL/TLS handshake', 'notification']) assert.equal(card.dash0Angle.includes(w), true, w);
  assert.equal(card.dash0Angle.includes('dash0.com'), false);
  assert.equal((card.front + card.back + card.dash0Angle).includes('\u2014'), false);
});

// ---- step 1: Sort it -----------------------------------------------------------------------

const WANT = {
  'handler-throws': 'spans', 'tls-expired': 'probe', 'payment-dns': 'spans', 'slow-query': 'spans', 'dns-dropout': 'probe', 'inventory-loop': 'spans',
  'dns-stale': 'probe', 'payment-tls': 'spans', 'cdn-stale': 'probe', 'bad-deploy': 'spans', 'lb-no-targets': 'probe',
};

test('step 1: a valid sort of eleven failures into two buckets that say what the spans record, hints off, six recorded and five not', () => {
  assert.equal(SORT_STEP.qid, 'sc-q-sort');
  assert.deepEqual(validateSortSpec(sort), []);
  assert.equal(sort.id, 'sc-sort');
  assert.deepEqual(sort.helps, { hints: false });
  assert.deepEqual(sort.buckets.map((b) => [b.id, b.label]), [['spans', 'Your spans record the failure'], ['probe', 'Your spans record nothing; a probe sees it']]);
  for (const b of sort.buckets) assert.equal(b.label.length <= 45, true, `${b.id} label fits a bucket: ${b.label.length}`);
  assert.deepEqual(Object.fromEntries(sort.items.map((i) => [i.id, i.bucket])), WANT);
  assert.deepEqual(['spans', 'probe'].map((b) => sort.items.filter((i) => i.bucket === b).length), [6, 5]);
  for (const i of sort.items) assert.equal(plain(i.why).length > 40, true, `${i.id} has a why`);
});

test('step 1: the probe items fail before the request reaches the service, the span items reach it or fail on the way out; the whys say so', () => {
  const why = (id) => plain(sort.items.find((i) => i.id === id).why);
  assert.match(why('tls-expired'), /before any HTTP request is sent/);
  assert.match(why('tls-expired'), /checkout has no server span/);
  assert.match(why('dns-stale'), /Nothing arrives to be traced/);
  assert.match(why('dns-dropout'), /nothing arrives at checkout to be traced/);
  assert.match(why('cdn-stale'), /never travels to your service/);
  assert.match(why('cdn-stale'), /the spans of your service/);
  assert.match(why('lb-no-targets'), /forwards nothing to checkout/);
  for (const id of ['handler-throws', 'slow-query', 'inventory-loop', 'bad-deploy']) assert.match(why(id), /server span|trace/, id);
  for (const id of ['payment-dns', 'payment-tls']) assert.match(why(id), /client span/, id);
  assert.match(why('payment-tls'), /as with a DNS error/);
  assert.match(why('payment-dns'), /the HTTP spans page gives/);
  const intro = plain(SORT_STEP.intro);
  assert.match(intro, /probe is a request the team sends itself/);
  assert.match(intro, /synthetic check is a probe with a pass or fail/);
});

// The 7.4 sort must not pass on a keyword. Each rule below ignores what a failure means and decides from words alone; every one is
// played through the real place() and must cost at least two mistakes, which is 3 stars or fewer (one mistake still earns 4).
const placeAll = (pick) => {
  let state = newSortState(sort);
  let mistakes = 0;
  for (const it of sort.items) {
    const r = place(sort, state, it.id, pick(it));
    state = r.state;
    if (r.outcome === 'wrong') mistakes++;
  }
  return { mistakes, stars: scoreStars({ mistakes, hintsUsed: 0, elapsedMs: 0 }, { scored: true, scoring: level.scoring }) };
};
const INFRA = /\b(DNS|TLS|CDN|load balancer|hostname|certificate)\b/i;
const OWN = /\b(checkout|requests?|calls?)\b/i;
const OWN_WIDE = /\b(checkout|requests?|calls?|handler|query|loop|deploy)\b/i; // generous: also the other span-side nouns

test('step 1: the honest sort scores 5 stars, and no keyword rule through place() gets above 3', () => {
  assert.deepEqual(placeAll((it) => WANT[it.id]), { mistakes: 0, stars: 5 }, 'the reference placement is full marks');
  const rules = {
    'an infrastructure word goes to probe, the rest to spans': (it) => (INFRA.test(plain(it.label)) ? 'probe' : 'spans'),
    'an infrastructure word goes to spans, the rest to probe': (it) => (INFRA.test(plain(it.label)) ? 'spans' : 'probe'),
    'checkout, request or call goes to spans, the rest to probe': (it) => (OWN.test(plain(it.label)) ? 'spans' : 'probe'),
    'checkout, request, call, handler, query, loop or deploy goes to spans, the rest to probe': (it) => (OWN_WIDE.test(plain(it.label)) ? 'spans' : 'probe'),
    'checkout, request or call goes to probe, the rest to spans': (it) => (OWN.test(plain(it.label)) ? 'probe' : 'spans'),
    'public or hostname goes to probe, the rest to spans': (it) => (/public|hostname/i.test(plain(it.label)) ? 'probe' : 'spans'),
    'a possessive (checkout\'s) goes to spans, the rest to probe': (it) => (/'s\b/.test(plain(it.label)) ? 'spans' : 'probe'),
    'everything to spans': () => 'spans',
    'everything to probe': () => 'probe',
  };
  const got = {};
  for (const [name, pick] of Object.entries(rules)) got[name] = placeAll(pick);
  for (const [name, r] of Object.entries(got)) {
    assert.equal(r.mistakes >= 2, true, `${name}: ${r.mistakes} mistakes, ${r.stars} stars`);
    assert.equal(r.stars <= 3, true, `${name}: ${r.stars} stars`);
  }
  // The crossing items are what defeats the first two rules: an infrastructure word on checkout's way out is spans,
  // and checkout's own public hostname is probe.
  const crossing = (id) => sort.items.find((i) => i.id === id);
  for (const id of ['payment-dns', 'payment-tls']) {
    assert.equal(INFRA.test(plain(crossing(id).label)) && crossing(id).bucket === 'spans', true, `${id}: infrastructure word, spans`);
  }
  for (const id of ['dns-dropout', 'tls-expired']) {
    assert.equal(OWN.test(plain(crossing(id).label)) && crossing(id).bucket === 'probe', true, `${id} names checkout and is probe`);
  }
});

// ---- step 2: the alert ---------------------------------------------------------------------

test('step 2: the probe is the one right alert; each alert on spans is shown reading healthy or quiet in the numbers', () => {
  assert.equal(ALERT_STEP.qid, 'sc-q-alert');
  const choices = ALERT_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['error-ratio', 'burn-rate', 'p99', 'rate', 'health-check', 'probe']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['probe']);
  const lens = choices.map((c) => plain(c.label).length);
  assert.equal(plain(choices[5].label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 16, true, `plain label lengths ${lens}`);
  for (const c of choices) assert.doesNotMatch(plain(c.label), /expired|certificate|handshake|outside|blind|never|wrong|TLS|DNS/i, c.key);
  const spanLabels = choices.filter((c) => /spans/.test(c.label)).length;
  assert.equal(spanLabels, 4, 'four options are about spans, the other two are not: "spans" does not mark the odd one out');
  assert.equal(/spans|probe/i.test(choices[5].label), false, 'the right label says what it does, not the step 1 bucket word');
  const intro = plain(ALERT_STEP.intro);
  for (const w of ['3,000 requests (usually 4,000 at that hour)', '0 errors', 'p99 latency 180 ms (usually 180 ms)', 'TLS certificate', 'expired', 'so they still connect']) assert.equal(intro.includes(w), true, w);
  // The numbers of the intro, read as each alert would read them.
  const [requests, errors, usual] = [3000, 0, 4000];
  const allow = 1 - 0.999;
  const errorRatio = errors / requests;
  assert.deepEqual([errorRatio, errorRatio > 0.02], [0, false], 'the error ratio reads 0% and stays below 2%');
  assert.deepEqual([errorRatio / allow, errorRatio / allow > 14.4], [0, false], 'the burn rate reads 0');
  assert.equal(180 > 1000, false, 'p99 of 180 ms is below 1 second');
  assert.deepEqual([requests / usual, requests < usual / 2], [0.75, false], 'the request rate is three quarters of usual, above the half line');
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  assert.match(why('error-ratio'), /0 errors in 3,000 requests, a ratio of 0%/);
  assert.match(why('error-ratio'), /every browser visitor is refused/);
  assert.doesNotMatch(why('error-ratio'), /most visitors/);
  assert.match(why('burn-rate'), /0 errors divided by the 0\.001 the SLO allows is a burn rate of 0/);
  assert.match(why('p99'), /180 ms at p99/);
  assert.match(why('rate'), /3,000 requests is three quarters of the 4,000 usual at that hour/);
  assert.match(why('rate'), /cannot tell an expired certificate from a quiet night/);
  assert.match(why('rate'), /the probe names the TLS error/);
  assert.match(why('health-check'), /never meets the certificate on the public hostname/);
  assert.match(why('probe'), /DNS lookup, then the TLS handshake/);
});

test('step 2: the Dash0 tie-in uses only what the run-details and notification pages state', () => {
  const probe = plain(ALERT_STEP.choice.choices.find((c) => c.key === 'probe').why);
  for (const w of ['synthetic check sends requests to your endpoint at regular intervals', 'fires a notification when an assertion fails', 'DNS resolution, TCP connection and the SSL/TLS handshake', 'notification channels deliver the alert']) assert.equal(probe.includes(w), true, w);
  assert.doesNotMatch(probe, /free|pricing|\$|per month/i, 'no pricing claim');
});

// ---- sources -------------------------------------------------------------------------------

test('sources: Spec lines on opentelemetry.io, Dash0 docs lines on www.dash0.com, the unsourced reasoning is declared, no em dash', () => {
  const specs = SRC.split('\n').filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g));
  assert.deepEqual(specs, [
    'https://opentelemetry.io/docs/specs/otel/trace/api/#spankind',
    'https://opentelemetry.io/docs/specs/semconv/http/http-spans/',
  ]);
  const docs = SRC.split('\n').filter((l) => /^\/\/ Dash0 docs: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g));
  assert.deepEqual(docs, [
    'https://www.dash0.com/docs/dash0/monitoring/synthetics/synthetic-monitoring',
    'https://www.dash0.com/docs/dash0/monitoring/synthetics/explore-run-details',
    'https://www.dash0.com/docs/dash0/monitoring/alerting/about-notifications',
  ]);
  for (const url of SRC.match(/https:\/\/[^\s,)]+/g)) assert.equal(['opentelemetry.io', 'www.dash0.com'].includes(new URL(url).host), true, url);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Stated as reasoning, with no source/);
  assert.match(SRC, /Invented/);
  assert.equal(SRC.includes('\u2014'), false, 'no em dash');
});

// ---- the globe -----------------------------------------------------------------------------

test('globe: 7.4 lights South Korea; East Asia is complete once the boss is done too', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'KOR');
  assert.equal(COUNTRY_NAMES.KOR, 'South Korea');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const before = ['good-alerts', 'slis-and-slos', 'burn-rate-alerts'];
  const fresh = freshlyLit(progressOf(before), progressOf([...before, ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['KOR'], regionIds: [] }, 'the Act 7 boss is still to play');
  assert.equal(litText(fresh, level, map), 'South Korea is now lit: Synthetic checks.');
  const done = [...before, ID];
  const boss = freshlyLit(progressOf(done), progressOf([...done, 'everything-is-green']), LIVE, map);
  assert.deepEqual(boss, { countryIds: [], regionIds: ['act-7'] }, 'the boss has no country of its own and completes the region');
});
