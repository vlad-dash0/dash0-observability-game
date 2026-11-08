// Level 7.3: Burn-rate alerts. Act 7 "Alerting and SLOs". Kettle & Co's checkout has a 99.9% SLO. The player writes a burn rate as a
// PromQL ratio of rates over one window (Query it, on the checkout-http data), then chooses the paging rule for two incidents told
// in numbers: a 5-minute window alone pages on a blip, a 1-hour window alone keeps paging after the fix, both together do neither
// (Choice). PromQL here has no and/or/unless, so the two-window rule cannot be a query. Hints are on for the Query it step only, as in 7.2.
// Spec: https://prometheus.io/docs/prometheus/latest/querying/functions/#rate , https://prometheus.io/docs/prometheus/latest/querying/operators/#arithmetic-binary-operators , https://prometheus.io/docs/concepts/metric_types/#counter
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/alerting/slos , https://www.dash0.com/docs/dash0/monitoring/alerting/alert-on-slos , https://www.dash0.com/docs/dash0/monitoring/alerting/about-notifications
//
// Facts used (each read on the page named in its parentheses, 2026-11-07): rate() calculates the per-second average rate of increase
// of the series in the range vector and adjusts for counter resets from target restarts (the functions page); a counter only goes up,
// or resets to zero on a restart (the metric types page); arithmetic operators are defined between a vector and a scalar (the
// operators page). In Dash0, a burn rate of 1 spends the error budget exactly as the window closes and a burn rate of 10 spends it ten
// times faster; SLOs have a rolling 28-day window; the fast burn signal fires when 2% of the window's budget is spent in an hour, and on
// the 28-day window that tier is a burn rate of 13.44; each tier pairs its window with a shorter confirmation window, so the signal
// fires only while the problem is still happening and clears on its own after recovery, and the longer window decides how much
// evidence is needed; the SLO exposes ready-made fast burn and slow burn signals and you create a check rule on them instead of
// combining two windows yourself; notification channels deliver alerts from check rules and synthetic checks (the SLOs page, the
// alerting on SLOs page, the notification channels page).
//
// Worked out in the game, not copied from a source (test/burn-rate-alerts.test.mjs recomputes each): the burn rate of a failure ratio
// is the ratio divided by (1 - target); the 14.4 line is 2% of a 30-day budget spent in one hour, 0.02 x 720 hours; every number in the
// two incidents. The 30-day window is illustrative (the data is one hour; Dash0 uses 28 days).
//
// Invented for the game: the company, the 99.9% target, the two incidents. The dataset has no blip followed by a sustained burn, so
// the blip against the sustained failure is told in the copy and graded by the Choice, never shown in the data, and the copy says so.

const RULE = [
  {
    key: 'short-only',
    label: 'The 5-minute burn rate above 14.4, on its own',
    why:
      'Incident A reads 100 on the 5-minute window, so this pages for a 30-second hiccup that spent 1.2% of the budget (30 seconds of the 2,592 a 99.9% target allows over 30 days). ' +
      'It does clear quickly after incident B, which is the half of the answer that works.',
  },
  {
    key: 'long-only',
    label: 'The 1-hour burn rate above 14.4, on its own',
    why:
      'It stays quiet for incident A (8.3) and pages for incident B (167). But six minutes after the rollback it still reads 167: the hour still holds all ten minutes of failures, ' +
      'and the reading stays above 14.4 for about 59 minutes after the fix, until less than 52 seconds of failures are left in the hour. The engineer is paged about something already fixed. ' +
      'It is slow to start as well: with 2% of requests failing (a burn rate of 20) it needs 43 minutes to cross the line.',
  },
  {
    key: 'either',
    label: 'The 5-minute burn rate above 14.4, or the 1-hour one',
    why:
      'Incident A reads 100 on the 5-minute window, so it pages just as the 5-minute rule does, and after incident B it keeps paging for as long as the 1-hour reading stays high. ' +
      'Taking whichever window is worse gives you the blips of the short one and the stale page of the long one.',
  },
  {
    key: 'both',
    label: 'Both the 5-minute and 1-hour burn rates above 14.4',
    right: true,
    why:
      'Incident A reads 100 and 8.3: the 1-hour window is below 14.4, so no page. Incident B pages once both are above 14.4, and six minutes after the rollback the 5-minute reading is 0, so the page clears while the 1-hour one still reads 167. ' +
      'The long window decides how much evidence is needed; the short one confirms that it is still happening. The pair starts as slowly as the long window, and what it gains is no blips and a quick clear. ' +
      'Dash0 pairs windows this way for you: an SLO exposes ready-made fast burn and slow burn signals, each tier paired with a shorter confirmation window (13.44 for 2% of the budget in an hour, on its 28-day window), ' +
      'so you create a check rule on them instead of combining two windows yourself, and notification channels deliver the alert.',
  },
];

export default {
  id: 'burn-rate-alerts',
  no: '7.3',
  name: 'Burn-rate alerts',
  sub: 'Fast enough, not jumpy',
  icon: '\u{1F525}',
  rewardTitle: 'Burn watcher',
  cards: ['multi-window-burn'],
  lights: ['checkout'],
  scoring: { parMs: null },
  play: {
    prefix: 'br',
    steps: [
      {
        intro:
          'Kettle &amp; Co\'s checkout has an SLO of <b>99.9%</b> good requests over 30 days (the window is illustrative: the data is one hour), so its error budget is the other 0.1%. ' +
          'The <b>burn rate</b> says how fast that budget is being spent: 1 spends it exactly as the window closes, 10 spends it ten times faster. ' +
          'It is the error ratio divided by the share the SLO allows, <code>1 - 0.999</code>. ' +
          'The counter <code>http_server_requests_total</code> has the labels <code>service</code>, <code>route</code> and <code>status</code>, and a failure has status 500. Checkout deployed 20 minutes ago.',
        question: 'Write checkout\'s burn rate over the last hour.',
        qid: 'br-q-burn',
        query: {
          id: 'br-burn',
          dataset: 'checkout-http',
          at: 3600,
          reference:
            'sum(rate(http_server_requests_total{service="checkout", status="500"}[1h])) / ' +
            'sum(rate(http_server_requests_total{service="checkout"}[1h])) / 0.001',
          helps: { hints: true },
          hint: 'Take the failed share of the requests and divide it by what the SLO allows. Both sides of the share are sums over one window, and a counter needs the function that turns it into a speed.',
          explain:
            'Checkout burned its budget about 35 times faster than the SLO allows over the last hour. The hour holds two different stretches: before the deploy about 11 times, ' +
            'and in the last 5 minutes 83.3 times, so the window changes the reading. Without <code>rate()</code> you divide the totals since the counters restarted at the deploy, ' +
            '20 minutes of them, and read 83.3, which hides the 40 minutes before it. Leave out the division by 0.001 and you read the failed share, 0.035, which is not a burn rate.',
        },
      },
      {
        intro:
          'A burn rate above 14.4 for an hour spends 2% of the 30-day budget (14.4 x 1 hour out of 720 hours), which is worth a page. When every request fails, the burn rate is 1 / 0.001 = 1,000. ' +
          'The checkout data you queried has no blip followed by a long failure, so two incidents are told in numbers here, not in data. ' +
          'Incident A: a pod restart fails every request for 30 seconds. Right after it, the 5-minute burn rate reads 100 and the 1-hour burn rate reads 8.3. ' +
          'Incident B: a bad deploy fails every request for 10 minutes, then is rolled back. Six minutes after the rollback, the 5-minute burn rate reads 0 and the 1-hour burn rate reads 167. ' +
          'The team wants a page for B, none for A, and B\'s page gone soon after the rollback.',
        question: 'Which paging rule does that?',
        qid: 'br-q-rule',
        choice: { id: 'br-rule', choices: RULE },
      },
    ],
    finish:
      'You can turn an SLO into a burn rate: the failed share of the requests, from rates over one window, divided by what the SLO allows. ' +
      'You know a short window alone pages on blips and a long window alone keeps paging after the fix. A paging rule needs both.',
  },
};
