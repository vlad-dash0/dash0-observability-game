// Level 8.3 "Migrating vendors" beyond the generated play-through (test/play.test.mjs, test/answers.test.mjs, test/sort-tells.test.mjs,
// test/sort-ladder.test.mjs): level fields and the globe; the Sort it step (twelve constructs, four buckets, keyword rules through the real
// place()); the Choice (the bucket arithmetic of the converted p99 alert); the sources and what the copy does not claim.
// Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRegistry } from '../app.mjs';
import { ACT_REGIONS, COUNTRY_NAMES, LEVEL_COUNTRY } from '../hub/globe-map.mjs';
import { freshlyLit, litText } from '../lib/globe-ignite.mjs';
import { emptyProgress } from '../lib/progress.mjs';
import { newSortState, place, validateSortSpec } from '../lib/widgets/sort-it.mjs';
import { scoreStars } from '../lib/scoring.mjs';

const ID = 'migrating-vendors';
const LIVE = liveRegistry();
const SRC = readFileSync(new URL(`../levels/${ID}.mjs`, import.meta.url), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&times;/g, 'x');
const level = LIVE.levels[ID];
const [SORT_STEP, FIX_STEP] = level.play.steps;
const sort = SORT_STEP.sort;
const choices = FIX_STEP.choice.choices;

const progressOf = (ids) => {
  const p = emptyProgress();
  for (const id of ids) p.levels[id] = { stars: 3, at: null };
  return p;
};

test('8.3 fields: second level of act-8 after 8.2, scored with no par time, a sort then a choice, lights the storefront, no card', () => {
  assert.deepEqual(
    { no: level.no, name: level.name, sub: level.sub, icon: level.icon, rewardTitle: level.rewardTitle, kind: level.kind, actId: level.actId, parMs: level.scoring.parMs, prefix: level.play.prefix },
    { no: '8.3', name: 'Migrating vendors', sub: 'Not everything maps 1:1', icon: '\u{1F69A}', rewardTitle: 'Migration lead', kind: 'level', actId: 'act-8', parMs: null, prefix: 'mv' },
  );
  assert.deepEqual([...level.mechanics], ['sort'], 'derived from the steps: choice is not a mechanic');
  assert.deepEqual([...level.hintless], ['sort']);
  assert.deepEqual(level.play.steps.map((s) => ['choice', 'sort'].find((k) => s[k])), ['sort', 'choice']);
  assert.deepEqual([...level.lights], ['storefront']);
  assert.deepEqual([...level.cards], []);
  assert.equal(Object.values(LIVE.levels).filter((l) => l.rewardTitle === 'Migration lead').length, 1, 'the reward title is unique');
  const act = LIVE.acts.find((a) => a.id === 'act-8');
  assert.deepEqual([...act.levelIds], ['semantic-convention-versions', ID]);
  assert.equal(LIVE.order[LIVE.order.indexOf('semantic-convention-versions') + 1], ID, '8.3 plays right after 8.2');
});

test('globe: 8.3 lights Vietnam and completes Southeast Asia', () => {
  assert.equal(LEVEL_COUNTRY[ID], 'VNM');
  assert.equal(COUNTRY_NAMES.VNM, 'Vietnam');
  const map = { ACT_REGIONS, LEVEL_COUNTRY, COUNTRY_NAMES };
  const before = progressOf(['semantic-convention-versions']);
  const fresh = freshlyLit(before, progressOf(['semantic-convention-versions', ID]), LIVE, map);
  assert.deepEqual(fresh, { countryIds: ['VNM'], regionIds: ['act-8'] });
  assert.equal(litText(fresh, level, map), 'Vietnam is now lit: Migrating vendors. Southeast Asia is complete.');
});

// ---- step 1: Sort it -----------------------------------------------------------------------

const WANT = {
  'p95-chart': 'approximated', 'ratio-alert': 'translated', 'agent-panel': 'skipped', 'anomaly-chart': 'manual',
  'memory-chart': 'translated', 'p99-alert': 'approximated', 'retired-alert': 'skipped', 'failed-count': 'approximated',
  'paging-alert': 'manual', 'unused-dashboard': 'skipped', 'disk-alert': 'translated', 'logs-panel': 'manual',
};

test('step 1: a valid sort of twelve constructs into the four generic buckets, three each, hints off, each with a why', () => {
  assert.equal(SORT_STEP.qid, 'mv-q-sort');
  assert.deepEqual(validateSortSpec(sort), []);
  assert.equal(sort.id, 'mv-sort');
  assert.deepEqual(sort.helps, { hints: false });
  assert.deepEqual(sort.buckets.map((b) => b.id), ['translated', 'approximated', 'manual', 'skipped']);
  assert.deepEqual(sort.buckets.map((b) => b.label.split(':')[0]), ['Translated', 'Approximated', 'Manual', 'Skipped']);
  assert.deepEqual(Object.fromEntries(sort.items.map((i) => [i.id, i.bucket])), WANT);
  assert.deepEqual(sort.buckets.map((b) => sort.items.filter((i) => i.bucket === b.id).length), [3, 3, 3, 3]);
  for (const i of sort.items) assert.equal(plain(i.why).length > 40, true, `${i.id} has a why`);
  const intro = plain(SORT_STEP.intro);
  for (const w of ['Translated: it means the same thing in the new tool', 'Approximated: it converts to something close, and the numbers can differ', 'Manual: it is still needed and nothing converts it, so someone rebuilds it', 'Skipped: nothing in the new tool needs it', 'counters, gauges and histograms with fixed buckets']) {
    assert.equal(intro.includes(w), true, w);
  }
});

test('step 1: the whys name the PromQL behaviour each translated or approximated item rests on', () => {
  const why = (id) => plain(sort.items.find((i) => i.id === id).why);
  assert.match(why('p95-chart'), /histogram_quantile/);
  assert.match(why('p95-chart'), /spread evenly inside the bucket/);
  assert.match(why('p99-alert'), /same estimate as the p95 chart/);
  assert.match(why('failed-count'), /extrapolates to cover the full window/);
  assert.match(why('failed-count'), /41\.7 where the old tool said 42/);
  assert.match(why('disk-alert'), /predict_linear/);
  assert.match(why('disk-alert'), /straight line to a gauge/);
  assert.match(why('memory-chart'), /A gauge is plotted as it is/);
  assert.match(why('paging-alert'), /notification channels/);
  assert.match(why('unused-dashboard'), /a decision, not a gap/);
});

test('step 1: the same kind of thing lands in different buckets, so an alert, a chart or a panel is no tell', () => {
  const kinds = { alert: [/\balert\b/i, 4], chart: [/\bchart\b/i, 3], panel: [/\bpanel\b/i, 2] };
  for (const [kind, [re, want]] of Object.entries(kinds)) {
    const buckets = new Set(sort.items.filter((i) => re.test(plain(i.label))).map((i) => i.bucket));
    assert.equal(buckets.size, want, `${kind} items span ${want} buckets: ${[...buckets]}`);
  }
  // An item that sounds hard to convert (a forecast) is translated; one that sounds simple (an exact count) is not.
  assert.equal(sort.items.find((i) => i.id === 'disk-alert').bucket, 'translated');
  assert.equal(sort.items.find((i) => i.id === 'failed-count').bucket, 'approximated');
});

// The sort must not pass on a keyword or a surface tell. Every rule below ignores what a construct means; each is played through the
// real place() and must cost at least two mistakes (3 stars or fewer; one mistake still earns 4).
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
const ids = sort.buckets.map((b) => b.id);
const text = (it) => plain(it.label);

test('step 1: the honest sort scores 5 stars, and named surface rules through place() score 3 or fewer', () => {
  assert.deepEqual(placeAll((it) => WANT[it.id]), { mistakes: 0, stars: 5 }, 'the reference placement is full marks');
  const rules = {
    'alert to translated, the rest to approximated': (it) => (/\balert\b/i.test(text(it)) ? 'translated' : 'approximated'),
    'chart to translated, alert to approximated, panel to manual, the rest skipped': (it) => (/\bchart\b/i.test(text(it)) ? 'translated' : /\balert\b/i.test(text(it)) ? 'approximated' : /\bpanel\b/i.test(text(it)) ? 'manual' : 'skipped'),
    'the old tool\'s to manual, the rest to translated': (it) => (/old tool/i.test(text(it)) ? 'manual' : 'translated'),
    'latency or percentile to approximated, the rest to translated': (it) => (/latency|percentile|p95|p99/i.test(text(it)) ? 'approximated' : 'translated'),
    'latency to approximated, nobody or retired or learned or own to skipped, the rest translated': (it) => (/latency/i.test(text(it)) ? 'approximated' : /nobody|retired|learned|own/i.test(text(it)) ? 'skipped' : 'translated'),
    'a number, count or exactly to approximated, the rest to translated': (it) => (/number|count|exact/i.test(text(it)) ? 'approximated' : 'translated'),
    'a time span (hour, year, minutes, seconds, hours) to approximated, the rest to skipped': (it) => (/hour|year|minutes|seconds/i.test(text(it)) ? 'approximated' : 'skipped'),
    'the shortest three to skipped, the next three to translated, then approximated, the longest manual': (it) => {
      const ranked = [...sort.items].sort((a, b) => text(a).length - text(b).length).map((x) => x.id);
      return ['skipped', 'translated', 'approximated', 'manual'][Math.floor(ranked.indexOf(it.id) / 3)];
    },
    'the longest three to skipped, the next three to translated, then approximated, the shortest manual': (it) => {
      const ranked = [...sort.items].sort((a, b) => text(b).length - text(a).length).map((x) => x.id);
      return ['skipped', 'translated', 'approximated', 'manual'][Math.floor(ranked.indexOf(it.id) / 3)];
    },
    'round robin in the order shown': (it) => ids[sort.items.indexOf(it) % 4],
    'everything to translated': () => 'translated',
    'everything to skipped': () => 'skipped',
  };
  for (const [name, pick] of Object.entries(rules)) {
    const r = placeAll(pick);
    assert.equal(r.mistakes >= 2, true, `${name}: ${r.mistakes} mistakes, ${r.stars} stars`);
    assert.equal(r.stars <= 3, true, `${name}: ${r.stars} stars`);
  }
});

test('step 1: no one-keyword rule over the label vocabulary gets under five mistakes, no two-keyword list under three', () => {
  const KW = ['chart', 'panel', 'alert', 'dashboard', 'latency', 'percentile|p95|p99', 'old tool', 'number', 'query|queries', 'hour|year|week|minutes|seconds', 'nobody|retired|learned|own', 'from', 'exact|exactly', 'per host|per ', 'combines|mix', 'the', '^An? ', 'agent|licen|paging|phone'];
  const res = KW.map((k) => new RegExp(k, 'i'));
  let best1 = Infinity;
  for (const re of res) for (const a of ids) for (const b of ids) best1 = Math.min(best1, placeAll((it) => (re.test(text(it)) ? a : b)).mistakes);
  assert.equal(best1 >= 5, true, `best one-keyword rule makes ${best1} mistakes`);
  let best2 = Infinity;
  for (const r1 of res) for (const r2 of res) for (const x of ids) for (const y of ids) for (const z of ids) {
    best2 = Math.min(best2, placeAll((it) => (r1.test(text(it)) ? x : r2.test(text(it)) ? y : z)).mistakes);
  }
  assert.equal(best2 >= 3, true, `best two-keyword list makes ${best2} mistakes`);
});

// ---- step 2: the converted p99 alert -------------------------------------------------------

test('step 2: the bucket arithmetic of the intro gives a 1.5 s estimate against a raw reading of at most 1.1 s, and a 1.2 s boundary fixes it', () => {
  assert.equal(FIX_STEP.qid, 'mv-q-fix');
  assert.equal(FIX_STEP.choice.id, 'mv-fix');
  assert.equal(plain(FIX_STEP.question), 'What do you do before the old alert is removed?');
  const intro = plain(FIX_STEP.intro);
  for (const w of ['bucket boundaries at 0.5, 1 and 2.5 seconds', 'pages above 1.2 seconds', '1,000 requests', '900 took 0.5 s or less', '985 took 1 s or less', 'all 1,000 took 2.5 s or less', 'between 1.0 and 1.1 s', 'read no more than 1.1 s and stayed quiet', 'The converted alert paged']) {
    assert.equal(intro.includes(w), true, w);
  }
  // histogram_quantile on cumulative buckets: find the bucket holding the rank, interpolate linearly inside it.
  const quantile = (q, cumulative) => {
    const total = cumulative[cumulative.length - 1][1];
    const rank = q * total;
    let [lowerBound, lowerCount] = [0, 0];
    for (const [bound, count] of cumulative) {
      if (count >= rank) return lowerBound + ((rank - lowerCount) / (count - lowerCount)) * (bound - lowerBound);
      [lowerBound, lowerCount] = [bound, count];
    }
    return NaN;
  };
  const threshold = 1.2;
  const coarse = [[0.5, 900], [1, 985], [2.5, 1000]];
  const finer = [[0.5, 900], [1, 985], [1.2, 1000], [2.5, 1000]];
  assert.equal(Math.abs(quantile(0.99, coarse) - 1.5) < 1e-9, true, 'the coarse buckets estimate 1.5 s');
  assert.equal(quantile(0.99, coarse) > threshold, true, 'which pages');
  assert.equal(Math.abs(quantile(0.99, finer) - 1.0667) < 0.001, true, 'a boundary at 1.2 s estimates about 1.07 s');
  assert.equal(quantile(0.99, finer) > threshold, false, 'which stays quiet');
  // The raw samples: 985 requests at or under 1 s and the 15 slowest between 1.0 and 1.1 s, so the 990th is at most 1.1 s.
  assert.equal(1.1 > threshold, false, 'the old alert stays quiet');
  assert.equal(coarse[2][1] - coarse[1][1], 15, 'the 15 slowest sit in the 1 to 2.5 s bucket');
  assert.equal(0.99 * 1000 - 985, 5, 'the 990th request is the 5th of those 15');
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  assert.match(why('boundary'), /1 \+ 5\/15 x 1\.5 = 1\.5 s/);
  assert.match(why('boundary'), /1 \+ 5\/15 x 0\.2 = about 1\.07 s/);
  assert.match(why('boundary'), /set in the metrics SDK/);
});

test('step 2: one right answer; the labels are balanced and give nothing away; each wrong option fails for a reason the figures show', () => {
  assert.deepEqual(choices.map((c) => c.key), ['boundary', 'keep', 'raise', 'mean']);
  assert.deepEqual(choices.filter((c) => c.right).map((c) => c.key), ['boundary']);
  const lens = choices.map((c) => plain(c.label).length);
  const right = plain(choices[0].label).length;
  assert.equal(right < Math.max(...lens) && right > Math.min(...lens), true, `the right label is neither the longest nor the shortest: ${lens}`);
  assert.equal(Math.max(...lens) - Math.min(...lens) <= 14, true, `plain label lengths ${lens}`);
  for (const c of choices) assert.doesNotMatch(plain(c.label), /wrong|never|blind|estimate|interpolat|careful|unsafe/i, c.key);
  assert.equal(choices.filter((c) => /converted/.test(c.label)).length, 2, 'two labels say "converted", two do not: it marks no odd one out');
  assert.equal(choices.filter((c) => /\d/.test(plain(c.label))).length, 2, 'two labels carry a figure');
  const why = (k) => plain(choices.find((c) => c.key === k).why);
  assert.match(why('keep'), /not the same query/);
  assert.match(why('keep'), /opposite sides of the threshold/);
  // Raising to 1.5 s: the estimate is 1.5 s for slow requests anywhere in the bucket, and a strict "above 1.5" never fires on it.
  assert.equal(1.5 > 1.5, false, 'a threshold of 1.5 s is not crossed by an estimate of 1.5 s');
  assert.match(why('raise'), /whether they took 1\.05 s or 1\.4 s/);
  assert.match(why('raise'), /misses the next one where the real p99 is 1\.4 s/);
  // The mean: every request took under 1.1 s, so the mean cannot reach 1.2 s.
  assert.equal(1.1 < 1.2, true);
  assert.match(why('mean'), /Every request in this window took under 1\.1 s, so the mean cannot reach 1\.2 s/);
});

// ---- sources and claims ---------------------------------------------------------------------

test('sources: Prometheus and OpenTelemetry pages on the Spec line, the Dash0 import page behind the one Dash0 sentence, Facts used and Invented sections', () => {
  const spec = SRC.split('\n').find((l) => /^\/\/ Spec: /.test(l));
  for (const url of [
    'https://prometheus.io/docs/prometheus/latest/querying/functions/',
    'https://prometheus.io/docs/practices/histograms/',
    'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#explicit-bucket-histogram-aggregation',
  ]) assert.equal(spec.includes(url), true, url);
  assert.match(SRC, /^\/\/ Dash0 docs: https:\/\/www\.dash0\.com\/docs\/dash0\/dashboards\/import-dashboards$/m);
  assert.match(SRC, /Facts used/);
  assert.match(SRC, /Invented for the game/);
  const copy = plain(JSON.stringify(level.play));
  const dash0 = copy.match(/[^.]*Dash0[^.]*\./g) ?? [];
  assert.equal(dash0.length, 1, 'one Dash0 sentence, backed by the import page');
  assert.match(dash0[0], /Dash0's import of Grafana dashboards/);
  for (const fact of ['Prometheus queries only', 'common panel types', 'placeholder for a panel it cannot convert', 'may omit some panel options']) assert.equal(dash0[0].includes(fact), true, fact);
  assert.equal(SRC.includes('\u2014'), false, 'no em dash');
});

test('claims: no DART, no named vendor, no migration-tool or automatic-translation claim, no pricing', () => {
  const copy = plain(JSON.stringify(level.play));
  assert.doesNotMatch(copy, /\bDART\b/i, 'DART is not named: no allowed source documents it (owner question)');
  assert.doesNotMatch(copy, /Datadog|Sentry|New Relic|Splunk|Dynatrace/i, 'the old tool is invented and never named');
  assert.doesNotMatch(copy, /migration tool|automatic(ally)?|one click|\$|per month|pricing/i);
  assert.doesNotMatch(SRC.split('\n').filter((l) => !/^\/\//.test(l)).join('\n'), /\bDART\b/);
});
