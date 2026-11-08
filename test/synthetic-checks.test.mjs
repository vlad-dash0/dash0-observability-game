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
import { validateSortSpec } from '../lib/widgets/sort-it.mjs';

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
  assert.deepEqual([...level.lights], ['storefront', 'api-gateway']);
  assert.deepEqual([...level.cards], ['synthetics-see-the-edge']);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Edge watcher').length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-7');
  assert.deepEqual([...act.levelIds], ['good-alerts', 'slis-and-slos', 'burn-rate-alerts', ID]);
});

test('card synthetics-see-the-edge: pinned front, fits a card, a spec page as source, Dash0 angle from the run details page', () => {
  const card = DECK.find((c) => c.id === 'synthetics-see-the-edge');
  assert.equal(card.front, 'Spans only see requests that reach your code. DNS, TLS and CDN failures happen before that, so only a probe from outside sees them.');
  assert.equal(card.front.length <= 140, true, `front is ${card.front.length} characters`);
  assert.equal(card.specUrl, 'https://opentelemetry.io/docs/specs/otel/trace/api/#spankind');
  for (const w of ['DNS lookup', 'TLS handshake', 'no server span', '0%']) assert.equal(card.back.includes(w), true, w);
  for (const w of ['DNS resolution', 'TCP connection', 'SSL/TLS handshake', 'notification']) assert.equal(card.dash0Angle.includes(w), true, w);
  assert.equal((card.front + card.back + card.dash0Angle).includes('\u2014'), false);
});

// ---- step 1: Sort it -----------------------------------------------------------------------

test('step 1: a valid sort of nine failures into two buckets, hints off, five seen by spans and four only by a probe', () => {
  assert.equal(SORT_STEP.qid, 'sc-q-sort');
  assert.deepEqual(validateSortSpec(sort), []);
  assert.equal(sort.id, 'sc-sort');
  assert.deepEqual(sort.helps, { hints: false });
  assert.deepEqual(sort.buckets.map((b) => [b.id, b.label]), [['spans', 'Your server spans see it'], ['probe', 'Only a probe from outside sees it']]);
  assert.deepEqual(sort.items.map((i) => [i.id, i.bucket]), [
    ['handler-throws', 'spans'], ['tls-expired', 'probe'], ['slow-query', 'spans'], ['dns-stale', 'probe'], ['inventory-loop', 'spans'],
    ['cdn-stale', 'probe'], ['payment-timeout', 'spans'], ['lb-no-targets', 'probe'], ['bad-deploy', 'spans'],
  ]);
  assert.deepEqual(['spans', 'probe'].map((b) => sort.items.filter((i) => i.bucket === b).length), [5, 4]);
  for (const i of sort.items) assert.equal(plain(i.why).length > 40, true, `${i.id} has a why`);
});

test('step 1: the probe items fail before the request reaches the service, the span items reach it; the whys say so', () => {
  const why = (id) => plain(sort.items.find((i) => i.id === id).why);
  assert.match(why('tls-expired'), /before any HTTP request is sent/);
  assert.match(why('tls-expired'), /no server span/);
  assert.match(why('dns-stale'), /Nothing arrives to be traced/);
  assert.match(why('cdn-stale'), /never travels to your service/);
  assert.match(why('lb-no-targets'), /forwards nothing to checkout/);
  for (const id of ['handler-throws', 'slow-query', 'inventory-loop', 'payment-timeout', 'bad-deploy']) assert.match(why(id), /server span|trace|request/, id);
  const intro = plain(SORT_STEP.intro);
  assert.match(intro, /probe is a request the team sends itself/);
  assert.match(intro, /synthetic check is a probe with a pass or fail/);
});

// ---- step 2: the alert ---------------------------------------------------------------------

test('step 2: the probe is the one right alert; each alert on spans is shown reading healthy in the numbers', () => {
  assert.equal(ALERT_STEP.qid, 'sc-q-alert');
  const choices = ALERT_STEP.choice.choices;
  assert.deepEqual(choices.map((c) => c.key), ['error-ratio', 'burn-rate', 'p99', 'probe']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['probe']);
  const lens = choices.map((c) => plain(c.label).length);
  assert.equal(plain(choices[3].label).length < Math.max(...lens), true, `the right label is not the longest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 16, true, `plain label lengths ${lens}`);
  for (const c of choices) assert.doesNotMatch(plain(c.label), /expired|certificate|handshake|outside|blind|never|wrong/i, c.key);
  const intro = plain(ALERT_STEP.intro);
  for (const w of ['3,000 requests (usually 12,000)', '0 errors', 'p99 latency 180 ms (usually 180 ms)', 'TLS certificate', 'expired']) assert.equal(intro.includes(w), true, w);
  // The numbers of the intro, read as each alert would read them.
  const [requests, errors] = [3000, 0];
  const allow = 1 - 0.999;
  const errorRatio = errors / requests;
  assert.deepEqual([errorRatio, errorRatio > 0.02], [0, false], 'the error ratio reads 0% and stays below 2%');
  assert.deepEqual([errorRatio / allow, errorRatio / allow > 14.4], [0, false], 'the burn rate reads 0');
  assert.equal(180 > 1000, false, 'p99 of 180 ms is below 1 second');
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  assert.match(why('error-ratio'), /0 errors in 3,000 requests, a ratio of 0%/);
  assert.match(why('burn-rate'), /0 errors divided by the 0\.001 the SLO allows is a burn rate of 0/);
  assert.match(why('p99'), /180 ms at p99/);
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

test('globe: 7.4 lights North Korea and completes East Asia', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'PRK');
  assert.equal(COUNTRY_NAMES.PRK, 'North Korea');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const before = ['good-alerts', 'slis-and-slos', 'burn-rate-alerts'];
  const fresh = freshlyLit(progressOf(before), progressOf([...before, ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['PRK'], regionIds: ['act-7'] });
  assert.equal(litText(fresh, level, map), 'North Korea is now lit: Synthetic checks. East Asia is complete.');
});
