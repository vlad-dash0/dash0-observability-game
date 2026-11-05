// Level 7.1: Good alerts. Act 7 "Alerting and SLOs". Kettle & Co's on-call engineer was paged all night, mostly for nothing. The
// player reads seven Prometheus alerting rules and spots the three that page badly (Spot it): one compares a counter's total with a
// threshold, so it fires for good; one pages on a cause (busy CPUs) no user feels; one has `for: 0s`, so it flaps. Then one Choice:
// how to fix the rule that has fired for three days (alert on increase() over a window, not a bigger threshold, not a longer `for`,
// not delta()). Hints are off (the default ladder: hints in early acts only).
// Spec: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/ , https://prometheus.io/docs/practices/alerting/ , https://prometheus.io/docs/prometheus/latest/querying/functions/ , https://prometheus.io/docs/concepts/metric_types/#counter
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/alerting/create-check-rules , https://www.dash0.com/docs/dash0/monitoring/alerting/create-check-rules-from-scratch
//
// Facts used (each read on the pages above, 2026-11-05): an alerting rule has an `expr` and an optional `for` clause, which makes
// Prometheus wait that long between first seeing an element in the expression's output and counting the alert as firing for it, and it
// checks the alert stays active at each evaluation (alerting rules page). Alert on symptoms tied to end-user pain rather than every
// possible cause (the alerting practices page). A counter is cumulative: it only increases, or is reset to zero on restart (the metric
// types page). `increase()` and `rate()` adjust automatically for counter resets from target restarts, and `delta` should only be used
// with gauges (the functions page). Dash0 check rules continuously evaluate PromQL expressions against telemetry and trigger alerts when
// values cross defined thresholds, and the For grace period is how long the threshold must be exceeded before alerting (the two Dash0
// pages). Not claimed: that a Prometheus rule file is accepted by Dash0 as it is.
//
// Invented for the game: the company, the services, the metric names, every threshold and window, and the seven rules. The rules are
// shown one per line as "alert: name expr: expression for: duration", not as a rules file.

const SPOT = {
  id: 'ga-spot',
  target: 'config',
  helps: { hints: false },
  lines: [
    { id: 'counter-value', text: 'alert: CheckoutErrors expr: http_requests_total{job="checkout", code=~"5.."} > 500 for: 5m' },
    { id: 'error-ratio', text: 'alert: CheckoutErrorRatio expr: sum(rate(http_requests_total{job="checkout", code=~"5.."}[5m])) / sum(rate(http_requests_total{job="checkout"}[5m])) > 0.02 for: 10m' },
    { id: 'queue-age', text: 'alert: OrdersWaiting expr: max(orders_oldest_age_seconds{job="orders"}) > 900 for: 15m' },
    { id: 'payments-increase', text: 'alert: PaymentsFailing expr: increase(payments_failed_total{job="payments"}[10m]) > 20 for: 5m' },
    { id: 'cause-cpu', text: 'alert: CheckoutHighCpu expr: avg(rate(process_cpu_seconds_total{job="checkout"}[5m])) > 0.9 for: 15m' },
    { id: 'checkout-slow', text: 'alert: CheckoutSlow expr: histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="checkout"}[5m]))) > 2 for: 10m' },
    { id: 'no-for', text: 'alert: SearchSlowP99Latency expr: histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="search"}[1m]))) > 1 for: 0s' },
  ],
  faults: ['counter-value', 'cause-cpu', 'no-for'],
  whyNot: {
    'error-ratio': 'A symptom users feel: the share of checkout requests that fail, from rates over 5 minutes, and it must hold for 10 minutes before it pages.',
    'queue-age': 'A gauge is a current value, so comparing it with a threshold is right, no rate needed. And orders waiting over 15 minutes are something customers notice.',
    'payments-increase': '<code>increase()</code> over 10 minutes turns the counter into the failures in that window, so the alert resolves when they stop.',
    'checkout-slow': 'A symptom, slow checkouts, from the histogram\'s rate over 5 minutes, and it waits 10 minutes before it pages, so one slow minute does not wake anyone.',
  },
  explain:
    '<code>CheckoutErrors</code> compares a cumulative counter\'s value with 500. A counter only grows until the process restarts, so once it passes 500 the rule fires and never resolves: alert on <code>rate()</code> or <code>increase()</code> over a window. ' +
    '<code>CheckoutHighCpu</code> pages on a cause: busy CPUs may hurt no one, and when they do, the error and latency rules already fire. Page on symptoms users feel and keep causes on a dashboard. ' +
    '<code>SearchSlow</code> has <code>for: 0s</code>, so it fires on the first evaluation over the line, and a p99 over 1 minute crosses it and falls back often: the alert flaps. ' +
    'A <code>for</code> duration makes the condition hold that long before the alert fires.',
};

const FIX = [
  {
    key: 'raise',
    label: 'Raise the threshold to 5,000, so a normal day stays below it',
    why: 'The counter only grows, so a bigger threshold only delays the page: one day it passes 5,000 and fires for good, failing or not.',
  },
  {
    key: 'for-1h',
    label: 'Add <code>for: 1h</code>, so the condition must hold for an hour first',
    why: 'Once the total is over 500 it stays over, so the condition is true every hour after that. <code>for</code> delays the page; it cannot make it resolve.',
  },
  {
    key: 'increase',
    label: 'Alert on <code>increase()</code> over 10 minutes: failures in that window',
    right: true,
    why:
      '<code>increase(http_requests_total{job="checkout", code=~"5.."}[10m]) > 20</code> counts the failures in the last ten minutes, so it fires while checkout fails and resolves when it stops, and it adjusts for the reset when the process restarts. ' +
      'Better still, page on the share that fails, as <code>CheckoutErrorRatio</code> does. ' +
      'In Dash0, a check rule evaluates a PromQL expression against a threshold, and its For setting is how long the threshold must be exceeded before alerting.',
  },
  {
    key: 'delta',
    label: 'Alert on <code>delta()</code> over 10 minutes: the change across that window',
    why:
      'Prometheus says to use <code>delta()</code> with gauges only. On a counter, a restart resets the total to zero and delta reads that as a huge drop. ' +
      '<code>increase()</code> and <code>rate()</code> are the counter functions.',
  },
];

export default {
  id: 'good-alerts',
  no: '7.1',
  name: 'Good alerts',
  sub: 'Page on what users feel',
  icon: '\u{1F514}',
  rewardTitle: 'Alert tuner',
  cards: [],
  lights: ['checkout'],
  scoring: { parMs: null },
  play: {
    prefix: 'ga',
    steps: [
      {
        intro:
          'Kettle &amp; Co\'s on-call engineer was paged all night, mostly for nothing. These are the team\'s Prometheus alerting rules, one per line: ' +
          'the alert\'s name, the PromQL expression that makes it fire, and <code>for</code>, how long the expression must stay true before it pages.',
        question: 'Spot the rules that page badly: for something no user feels, without end, or on and off.',
        qid: 'ga-q-spot',
        spot: SPOT,
      },
      {
        intro: '<code>CheckoutErrors</code> has been firing for three days, and checkout has been fine for two of them.',
        question: 'How do you fix CheckoutErrors?',
        qid: 'ga-q-fix',
        choice: { id: 'ga-fix', choices: FIX },
      },
    ],
    finish:
      'You can tell a rule that pages for the right reason: alert on the rate of a counter, not its total, on symptoms users feel, and give the condition a for duration so one bad minute does not page.',
  },
};
