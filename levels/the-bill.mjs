// Act 3 boss: The bill. The volume of metric data a Collector sends to Dash0 jumps to more than ten times
// the morning's rate and dashboards start to time out; the dashboards' query error budget burns while the
// player investigates: from the volume view (one metric's series count stepped from 228 to 118,904), to the
// label breakdown of that metric (a new label, user_id, with one value for each user), to the deploy that
// added it (checkout 5.12.0 put user.id on the counter's attributes). Three views hold the chain (clues);
// two are red herrings; the rest are neutral. Scored. A plain-data Scenario for the incident engine, played
// through one declarative `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3,
// docs/DECLARATIVE-LEVELS.md §2), then one closing Choice that grades the fix. The scenario is designed for
// this game: docs/OUTLINE.md §4 Act 3 defines no boss (decided on #16); the Dash0 tie-in is the one OUTLINE
// gives for 3.5, "Dash0 shows what drives volume".
// Spec: docs/OUTLINE.md §4 Act 3 (3.5 Cardinality).
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-metrics/
// Spec: https://prometheus.io/docs/practices/instrumentation/#do-not-overuse-labels
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/metrics/identify-high-cardinality-metrics
// Dash0 docs: https://www.dash0.com/docs/dash0/cost-control/spam-filters
//
// Facts used, each from the pages above (read 2026-11-01, OTel specification 1.62.0): the number of unique
// combinations of attributes is called cardinality; SDKs SHOULD support being configured with a cardinality
// limit, a default of 2000 SHOULD be used when none is configured, and measurements beyond the limit are
// folded into one point whose attributes are the single attribute otel.metric.overflow = true (SDK, "Cardinality
// limits"); cardinality limit enforcement SHOULD occur after attribute filtering, so a view can remove an
// attribute before the limit applies (same section). Prometheus: each labelset is an additional time series,
// and a metric with a cardinality over 100, or the potential to grow that large, is a prompt to reduce the
// dimensions (instrumentation practices). The semantic conventions say http.route MUST be low-cardinality and
// that the URI path cannot substitute for it. Dash0: the Metric Explorer tree map can size tiles by
// Cardinality, the metric sidebar shows the attributes behind a tile, and for random or unbounded values
// the guidance is to reduce them at the instrumentation layer; a spam filter drops matching data points
// before they are stored, what it drops cannot be recovered, and it reduces what SignalStore indexes, not what
// you send. Nothing below states a price: cost is described as volume and series only.
//
// The numbers agree by construction: 6 payment methods x 38 countries = 228 series before the deploy; one
// point per series every 60 s, so points a minute equal series; 12,400 - 228 + 118,904 = 131,076 points a
// minute after it; user_id has 112,367 values and the counter 118,904 series, because a few users appear
// with more than one method or country. The Prometheus-style names follow level 3.4 (dots become underscores,
// a monotonic Sum gets _total): the attribute user.id is the label user_id.

const SERIES_BEFORE = 6 * 38;
const SERIES_AFTER = 118904;
const FLEET_BEFORE = 12400;
const FLEET_AFTER = FLEET_BEFORE - SERIES_BEFORE + SERIES_AFTER;
const USERS = 112367;
const n = (x) => x.toLocaleString('en-US');

const SCENARIO = {
  id: 'the-bill',
  alert: {
    title: 'The bill',
    html:
      `<p>PAGE 10:12: metric data points reaching Dash0 are at about 131,000 a minute, more than 10 times the 12,400 a minute of this morning, and dashboards are timing out. ` +
      'It began at 09:42. The alert names no cause. Find it before the dashboards\' query error budget runs out.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 5 },
  views: [
    {
      id: 'volume-by-metric',
      label: 'Metric volume by metric',
      costMin: 5,
      kind: 'clue',
      html:
        '<p>Metric Explorer, tree map sized by Cardinality, last 2 hours:</p>' +
        '<table><caption>Active series by metric</caption>' +
        '<thead><tr><th scope="col">Metric</th><th scope="col">At 09:40</th><th scope="col">At 10:12</th></tr></thead>' +
        '<tbody>' +
        `<tr><td><code>checkout_attempts_total</code></td><td>${SERIES_BEFORE}</td><td>${n(SERIES_AFTER)}</td></tr>` +
        `<tr><td>every other metric together</td><td>${n(FLEET_BEFORE - SERIES_BEFORE)}</td><td>${n(FLEET_BEFORE - SERIES_BEFORE)}</td></tr>` +
        `<tr><td>all metrics</td><td>${n(FLEET_BEFORE)}</td><td>${n(FLEET_AFTER)}</td></tr>` +
        '</tbody></table>' +
        '<p>One tile fills the map: its series count stepped at 09:42 from 228 to 118,904, 91% of all series, while every other metric stayed where it was.</p>',
    },
    {
      id: 'label-breakdown',
      label: 'The labels of that metric',
      costMin: 4,
      kind: 'clue',
      html:
        '<p>The sidebar of <code>checkout_attempts_total</code>, series grouped by label, at 10:12, for example ' +
        '<code>checkout_attempts_total{payment_method="card",store_country="DE",user_id="u-8f31c2"}</code>:</p>' +
        '<table><caption>Distinct values for each label</caption>' +
        '<thead><tr><th scope="col">Label</th><th scope="col">Distinct values</th></tr></thead>' +
        '<tbody>' +
        '<tr><td><code>payment_method</code></td><td>6</td></tr>' +
        '<tr><td><code>store_country</code></td><td>38</td></tr>' +
        `<tr><td><code>user_id</code></td><td>${n(USERS)}</td></tr>` +
        '</tbody></table>' +
        `<p>At 09:40 the labels were <code>payment_method</code> and <code>store_country</code> only: 6 &times; 38 = ${SERIES_BEFORE} series. ` +
        `Now <code>user_id</code> is on every series and almost every user has exactly one series, ${n(SERIES_AFTER)} in all, and no point carries ` +
        '<code>otel.metric.overflow</code>: this SDK version has no cardinality limit set.</p>',
    },
    {
      id: 'deploys',
      label: 'Deploys',
      costMin: 3,
      kind: 'clue',
      html:
        '<p>Last 24 hours: checkout 5.12.0 deployed at 09:41. Pull request: "Add user.id to checkout attempts so support can look up one customer". The change to the <code>checkout.attempts</code> counter:</p>' +
        '<pre><code>\n' +
        '-  attempts.add(1, {"payment.method": method, "store.country": country})\n' +
        '+  attempts.add(1, {"payment.method": method, "store.country": country, "user.id": user_id})\n' +
        '</code></pre>' +
        '<p>No other service changed. The Collector configuration was last changed three weeks ago.</p>',
    },
    {
      id: 'request-rate',
      label: 'Checkout traffic',
      costMin: 2,
      kind: 'neutral',
      html: '<p>Checkout handles 26 requests a second, the same as last Thursday at this hour. There is no spike.</p>',
    },
    {
      id: 'export-interval',
      label: 'Export interval',
      costMin: 3,
      kind: 'neutral',
      html:
        '<p>Checkout\'s metric reader exports every 60 s, unchanged since the service was onboarded. Each series sends one point a minute, ' +
        'so points a minute equal active series.</p>',
    },
    {
      id: 'collector-health',
      label: 'Collector health',
      costMin: 2,
      kind: 'neutral',
      html: '<p>The Collector queue is empty, with no refused or retried batches and no restarts. It forwards what it receives.</p>',
    },
    {
      id: 'biggest-metric',
      label: 'Metric with the most data points',
      costMin: 4,
      kind: 'herring',
      html:
        '<p>The metric with the most data points over the last 2 hours is <code>http_server_request_duration_seconds_bucket</code>, ' +
        'with 3,112 series: the same as last week. It is the largest metric, and it is not new.</p>',
    },
    {
      id: 'new-service',
      label: 'New services reporting',
      costMin: 3,
      kind: 'herring',
      html:
        '<p>One service started reporting on Tuesday: loyalty, 3 metrics and 46 series in all. ' +
        'That is under 0.1% of today\'s series, and it was already counted at 09:40.</p>',
    },
  ],
  hypotheses: [
    {
      id: 'user-id-label',
      label: 'Checkout added a user_id label to a counter so each user gets a series',
      right: true,
      why: `The volume view shows one metric, checkout_attempts_total, stepping from ${SERIES_BEFORE} to ${n(SERIES_AFTER)} series at 09:42 while every other metric stayed put. Its label breakdown shows a new label, user_id, with ${n(USERS)} values, and checkout 5.12.0, deployed at 09:41, added user.id to the counter's attributes. Series are the unique combinations of attribute values, so one new unbounded label made the series count follow the user count.`,
    },
    {
      id: 'traffic-growth',
      label: 'Real checkout traffic grew and the number of series grew with it',
      right: false,
      why: 'Checkout traffic is the same as last Thursday at this hour, and every other metric kept its series count. Only one metric changed, and it stepped at the deploy instead of following the traffic.',
    },
    {
      id: 'new-service-metrics',
      label: 'The new loyalty service started reporting on Tuesday and now sends far too many metrics',
      right: false,
      why: 'Loyalty has 46 series, under 0.1% of the total, and it was already reporting at 09:40. It cannot account for 118,676 new series.',
    },
    {
      id: 'export-interval-change',
      label: 'Someone shortened OTEL_METRIC_EXPORT_INTERVAL on checkout',
      right: false,
      why: 'The export interval is unchanged at 60 s. A shorter one would raise the points a minute for every metric, not for one, and the series counts would be the same.',
    },
  ],
  answerAfterViews: 2,
  hint:
    '<p>Series are combinations of attribute values: find the one metric whose count jumped and ask which attribute multiplies it.</p>',
};

// Step 2: the fix. `why` follows "Right." or "Not quite.".
const FIX = [
  {
    key: 'drop-the-label',
    label:
      'Stop recording <code>user.id</code> on the counter (or filter it out with a view while the fix ships), and keep the per-user detail on spans or logs',
    right: true,
    why: 'Series are the unique combinations of attribute values, so the only fix that works is fewer values: remove the attribute that has one value for each user. A per-customer lookup is what spans and logs are for, where one value for each request is normal and a user.id attribute costs no series; the 228 series that dashboards need stay. In Dash0, the Metric Explorer tree map and the metric sidebar show which metric and which attributes were behind the volume, and the guidance for random or unbounded values is to reduce them at the instrumentation layer. The same is true of <code>http.route</code> against a raw URL: a bounded template, never the raw value.',
  },
  {
    key: 'export-less',
    label: 'Export metrics every 5 minutes instead of every minute',
    why: `The number of series is the number of unique attribute combinations, not how often they are sent. Exporting every 5 minutes sends one point in five for every metric alike, the ${SERIES_BEFORE} useful series included, and leaves all ${n(SERIES_AFTER)} series, the user_id label and the query load of that many series in place. It also makes every graph coarser.`,
  },
  {
    key: 'cap-and-keep',
    label: 'Set a cardinality limit in the SDK and keep the label',
    why: 'The specification says SDKs SHOULD support a cardinality limit, with a default of 2000 per metric that SHOULD be used when none is set, and measurements past it are folded into one point marked otel.metric.overflow. That bounds the volume, but the label stays useless: the user ids seen first keep their series and every other user, and any bounded combination not yet seen, lands in the one overflow point, so a per-user answer is wrong. A limit is a safety net for a mistake, not a design.',
  },
  {
    key: 'spam-flag',
    label: 'Flag <code>checkout_attempts_total</code> as spam in Dash0 so it is dropped at ingestion',
    why: 'A spam filter drops the data points that match its criteria before they are stored, and what it drops cannot be recovered. It does not remove one label and keep the rest: the counter checkout needs, with its 228 useful series, would be dropped along with the new ones, and the filter reduces what Dash0 indexes, not what the service sends. The label is the thing to remove.',
  },
];

export default {
  id: 'the-bill',
  no: null,
  name: 'The bill',
  sub: 'Whose label is it?',
  icon: '\u{1F9FE}',
  rewardTitle: 'Series wrangler',
  cards: [],
  lights: ['checkout'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'tbl',
    steps: [
      {
        intro: 'Metric volume has jumped and dashboards are timing out. Find which metric grew, what changed in it and what changed in the code.',
        incident: SCENARIO,
      },
      {
        intro:
          'The cause is found: one new label with a value for every user. In the review, someone proposes how to bring the volume down.',
        question: 'Which fix removes the cause?',
        qid: 'tbl-q-fix',
        choice: { id: 'tbl-fix', choices: FIX },
      },
    ],
    finish:
      `You followed the volume to its source: one counter went from ${SERIES_BEFORE} to ${n(SERIES_AFTER)} series at a deploy, its label breakdown showed ` +
      `user_id with ${n(USERS)} values, and checkout 5.12.0 had added user.id to its attributes. The fix is to remove the attribute and keep per-user detail on spans or logs.\n\n` +
      'In Dash0, the Metric Explorer tree map sized by cardinality shows which metric is large and its sidebar shows the attributes behind it, ' +
      'and for random or unbounded values the advice is to cut them down at the instrumentation layer.',
  },
};
