// Level 8.3: Migrating vendors. Act 8 "Operating at scale". Kettle & Co moves its dashboards and alerts from a proprietary monitoring
// tool (invented, never named) to a tool that queries with PromQL over OpenTelemetry metrics. The player sorts twelve constructs by
// what the move does to them: translated, approximated, manual or skipped (Sort it), then decides what to do with a converted p99 alert
// whose estimate pages where the old tool stayed quiet (Choice). Nothing is translated or run. Hints are off on the sort (the default
// ladder: hints in early acts only).
// Spec: https://prometheus.io/docs/prometheus/latest/querying/functions/ , https://prometheus.io/docs/practices/histograms/ , https://opentelemetry.io/docs/specs/otel/metrics/sdk/#explicit-bucket-histogram-aggregation
// Dash0 docs: https://www.dash0.com/docs/dash0/dashboards/import-dashboards
// Owner: DART naming confirmed by the owner 2026-11-09 (#263); no public page
//
// Facts used (each read on the page named, 2026-11-07). Prometheus functions page: `predict_linear(v range-vector, t scalar)` predicts the value of a
// series t seconds from now using simple linear regression, and should only be used with gauges; `increase` is "extrapolated to cover the
// full time range", so it can return a non-integer result even when a counter only increases by integers; for classic histograms
// `histogram_quantile` interpolates inside the bucket the quantile falls into, assuming the observations are spread uniformly in that
// bucket (linear interpolation). Prometheus histograms page: the quantile is calculated on the server from bucket counts; a bucket
// boundary exactly at an SLO value allows an accurate calculation, and the estimate is more accurate with higher bucket resolution.
// OpenTelemetry metrics SDK: the Explicit Bucket Histogram Aggregation takes the bucket Boundaries as a configuration parameter, and the
// ExplicitBucketBoundaries advisory parameter can be set on an instrument. Dash0 import page: Grafana dashboards import through a
// conversion utility that converts Prometheus queries only (Elasticsearch, InfluxDB and custom data sources are not supported), supports
// time series, stat, gauge, pie, table and text panels, shows a placeholder for a panel it cannot convert (heatmaps and custom panels are
// the examples), may omit some panel options, and translates an unsupported variable into a text variable.
//
// Stated as reasoning, with no source: the four buckets are the game's plain generic labels (translated, approximated, manual, skipped), not
// the statuses of any named migration tool. The old tool, its functions and what it computes are invented, so each sort item says in its
// label what the old tool does; no claim is made about any real vendor. DART is named from the owner line above only: its name and that
// it brings dashboards, alerts and rules over to Dash0 as Terraform, nothing about how it works; the four buckets are not its statuses.
// A big-number "exact count" is placed in "approximated" because `increase` extrapolates; that is a property of PromQL's `increase` as
// the functions page states it, not of any tool.
//
// Invented for the game: the company, the old tool, the twelve constructs, and every number in step 2 (1,000 requests in 5 minutes, 900 at
// or under 0.5 s, 985 at or under 1 s, 1,000 at or under 2.5 s, the 15 slowest between 1.0 and 1.1 s, a 1.2 s threshold). The estimate
// 1 + (990 - 985) / (1000 - 985) * (2.5 - 1) = 1.5 s, and 1.067 s with a boundary at 1.2 s, are recomputed in test/migrating-vendors.test.mjs.

const SORT = {
  id: 'mv-sort',
  helps: { hints: false },
  buckets: [
    { id: 'translated', label: 'Translated: means the same in the new tool' },
    { id: 'approximated', label: 'Approximated: close, but check the numbers' },
    { id: 'manual', label: 'Manual: someone rebuilds it by hand' },
    { id: 'skipped', label: 'Skipped: nothing to carry over' },
  ],
  items: [
    {
      id: 'p95-chart',
      label: 'A line chart of p95 latency, which the old tool computes from every raw sample',
      bucket: 'approximated',
      why: 'The new tool receives latency as histogram buckets, and a percentile is estimated from them: for a classic histogram, <code>histogram_quantile</code> assumes the requests are spread evenly inside the bucket the percentile falls in. The chart comes out close, not equal.',
    },
    {
      id: 'ratio-alert',
      label: 'An alert when the error ratio stays above 2% for 5 minutes',
      bucket: 'translated',
      why: 'Failed requests divided by all requests over the same window means the same thing in PromQL, and the "for 5 minutes" condition has a counterpart in an alert rule. The meaning survives the move.',
      whyNot: {
        approximated: 'It is a ratio of two <code>rate</code>s, and both extrapolate the same way over the same window, so the extrapolation cancels and the ratio is unchanged in practice. That is why it differs from the exact count, which has no second number to cancel against.',
        manual: 'Nothing here is left to rebuild: the ratio and the "for 5 minutes" condition both convert as written.',
        skipped: 'An error-ratio alert is still needed in the new tool, so it is not left behind.',
      },
    },
    {
      id: 'agent-panel',
      label: 'A panel of the old tool\'s own agent version and licence usage',
      bucket: 'skipped',
      why: 'It describes the tool you are leaving. Nothing in the new tool needs it, so it stays behind.',
    },
    {
      id: 'anomaly-chart',
      label: 'A chart that marks request rates outside the old tool\'s learned normal band',
      bucket: 'manual',
      why: 'The band comes from the old tool\'s own model, and the model does not move. The need is still real, so someone decides what "normal" means in a query they write, for instance the same hour last week with a margin.',
    },
    {
      id: 'memory-chart',
      label: 'A line chart of memory in use per host, from a gauge',
      bucket: 'translated',
      why: 'A gauge is plotted as it is: select the series, group by host. There is nothing to compute, so there is nothing to lose.',
    },
    {
      id: 'p99-alert',
      label: 'An alert on the 99th percentile of checkout latency above 1.2 seconds',
      bucket: 'approximated',
      why: 'It is the same estimate as the p95 chart, now deciding whether someone is paged, and 1.2 s sits inside a bucket, not on a boundary, so the estimate is interpolated there. Step 2 shows a window where the estimate and the raw-sample percentile land on opposite sides of a threshold.',
    },
    {
      id: 'retired-alert',
      label: 'An alert on a queue the team retired last year',
      bucket: 'skipped',
      why: 'The queue is gone, so the alert has nothing to watch. Moving a monitoring tool is a good time to leave it behind.',
    },
    {
      id: 'failed-count',
      label: 'A big number showing exactly how many checkouts failed in the last hour',
      bucket: 'approximated',
      why: 'It becomes <code>increase</code> over an hour, which extrapolates to cover the full window, so it can read 41.7 where the old tool said 42. The number is right to within a fraction, not exact.',
      whyNot: {
        translated: 'The query converts, but the result does not mean the same: <code>increase</code> extrapolates to cover the full window, so it can return a fraction where the old tool counted whole checkouts.',
        manual: 'Nobody has to rebuild it. The query converts on its own, and only the exactness is lost.',
        skipped: 'The count is still wanted, so it is carried over, with the caveat that it is close, not exact.',
      },
    },
    {
      id: 'paging-alert',
      label: 'An alert that phones the on-call engineer through the old tool\'s own paging app',
      bucket: 'manual',
      why: 'The condition may well convert, but the phone call does not: the paging app, the schedule and the escalation steps have to be set up again by hand in the new tool\'s notification channels.',
      whyNot: {
        translated: 'Only the condition translates. The phone call goes through the old tool\'s own paging app, which the new tool does not have, so the paging side is set up again by hand.',
        approximated: 'Nothing about the numbers is estimated here. What is missing is the paging path itself, and no query turns that into something close.',
        skipped: 'The engineer still has to be paged, so the need stays and the path is rebuilt.',
      },
    },
    {
      id: 'unused-dashboard',
      label: 'A dashboard nobody has opened in a year',
      bucket: 'skipped',
      why: 'Converting it would cost effort and add a dashboard to maintain, and nobody would miss it. Leaving it out is a decision, not a gap.',
    },
    {
      id: 'disk-alert',
      label: 'An alert that the disk fills within 4 hours, from the old tool\'s least-squares straight-line forecast over the last 6 hours',
      bucket: 'translated',
      why: 'PromQL has <code>predict_linear</code>, which fits a straight line to a gauge over a window and projects it forward. With a 6 hour window and 4 hours ahead it is the same least-squares method over the same window, so the alert means the same thing.',
      whyNot: {
        approximated: 'A forecast sounds like an estimate, but <code>predict_linear</code> is the same least-squares line over the same 6 hour window, so nothing is approximated by the move.',
        manual: 'PromQL has the function, so nobody rebuilds anything by hand.',
        skipped: 'A disk that fills is exactly what the team still wants to hear about.',
      },
    },
    {
      id: 'logs-panel',
      label: 'A panel whose single query combines request counts with a text search over logs',
      bucket: 'manual',
      why: 'PromQL queries metrics, and the old tool\'s one-query mix of two signals has no one-query counterpart. The panel is rebuilt by hand, for instance as two panels side by side.',
    },
  ],
};

const FIX = [
  {
    key: 'boundary',
    label: 'Add a bucket boundary at 1.2 s to the request-duration histogram',
    right: true,
    why:
      'The estimate is only as good as the buckets around the threshold. With boundaries at 0.5, 1 and 2.5 s, the 990th request of 1,000 falls in the 1 to 2.5 s bucket, 5 of its 15 requests in, so the estimate is 1 + 5/15 &times; 1.5 = 1.5 s. ' +
      'With a boundary at 1.2 s, all 15 slow requests sit in the 1 to 1.2 s bucket and the estimate is 1 + 5/15 &times; 0.2 = about 1.07 s, below the threshold, as the raw samples say. ' +
      'Bucket boundaries are set in the metrics SDK, so this is a change to the services, not to the query. Running both alerts for a while shows where they still disagree before the old one goes. ' +
      'Dash0\'s import of Grafana dashboards asks for the same care: it converts Prometheus queries only and a list of common panel types, shows a placeholder for a panel it cannot convert and may omit some panel options, so read the result.',
  },
  {
    key: 'keep',
    label: 'Keep the converted alert and watch whether it pages again',
    why: 'It is not the same query. The old tool computed the percentile from raw samples; the new one estimates it from buckets. In this window the two readings sit on opposite sides of the threshold, so the new alert pages for a window the old one called healthy.',
  },
  {
    key: 'raise',
    label: 'Raise the converted threshold to 1.5 s so it stops paging',
    why: 'The estimate comes from the bucket counts, not from how long the slow requests took: it reads 1.5 s for 1.05 s and for 1.4 s alike. A threshold of 1.5 s fits this window and misses the next one where the real p99 is 1.4 s, a latency the old alert would have paged on.',
  },
  {
    key: 'mean',
    label: 'Alert on the mean latency instead, from the histogram\'s sum and count',
    why: 'The mean needs no buckets, and it changes what the alert says. Every request in this window took at most 1.1 s, so the mean cannot reach 1.2 s; it would stay quiet even if the tail were far slower, because a few slow requests barely move an average over 1,000.',
  },
];

export default {
  id: 'migrating-vendors',
  no: '8.3',
  name: 'Migrating vendors',
  sub: 'Not everything maps 1:1',
  icon: '\u{1F69A}',
  rewardTitle: 'Migration lead',
  cards: [],
  lights: ['storefront'],
  scoring: { parMs: null },
  play: {
    prefix: 'mv',
    steps: [
      {
        intro:
          'Kettle &amp; Co is moving its dashboards and alerts off a proprietary monitoring tool, with a query language of its own, to a tool that queries OpenTelemetry metrics with PromQL. ' +
          'A move rarely maps one to one, so each construct ends up in one of four places. ' +
          '<b>Translated</b>: it means the same thing in the new tool. <b>Approximated</b>: it converts to something close, and the numbers can differ. ' +
          '<b>Manual</b>: it is still needed and nothing converts it, so someone rebuilds it. <b>Skipped</b>: nothing in the new tool needs it. ' +
          'The new tool receives counters, gauges and histograms, here with fixed bucket boundaries.',
        question: 'Sort each dashboard panel and alert by what the move does to it.',
        qid: 'mv-q-sort',
        sort: SORT,
      },
      {
        intro:
          'The p99 alert was converted to <code>histogram_quantile(0.99, ...)</code> over the new tool\'s request-duration histogram, with bucket boundaries at 0.5, 1 and 2.5 seconds, and it pages above 1.2 seconds. ' +
          'One 5-minute window held 1,000 requests: 900 took 0.5 s or less, 985 took 1 s or less and all 1,000 took 2.5 s or less. The 15 slowest took between 1.0 and 1.1 s. ' +
          'The old alert, working from the raw samples, read no more than 1.1 s and stayed quiet. The converted alert paged.',
        question: 'What do you do before the old alert is removed?',
        qid: 'mv-q-fix',
        choice: { id: 'mv-fix', choices: FIX },
      },
    ],
    finish:
      'Moving off a proprietary tool is part translation, with several places where the meaning shifts: a percentile becomes an estimate from buckets, an exact count becomes an extrapolated one, and what has no counterpart is rebuilt or left behind. ' +
      'Check each converted query against the old one on the same data before you switch it off.\n\n' +
      'When the move is to Dash0, DART (Dashboards, Alerts &amp; Rules to Terraform) brings dashboards, alerts and rules over as Terraform, and the sorting still matters: some of them need a person, whatever the tool.',
  },
};
