// Level 9.6: The alert that stayed green. Act 9 "Live Demo" (docs/LIVE-DEMO.md), on Fiji. A presenter says "the checkout error alert has
// been green all afternoon, so checkout is healthy". The player says why it is green (Choice: the numerator selects a status value no
// series has, so the expression returns nothing), then fixes the rule (Query it, on the checkout-http data): the label, and a
// grouping by route so the one failing route is not averaged away. Either fix alone still returns nothing.
// Source: an anonymised call question (docs/LIVE-DEMO.md). Nothing below identifies a customer, a person or a product.
// Spec: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/ , https://prometheus.io/docs/prometheus/latest/querying/operators/ , https://prometheus.io/docs/prometheus/latest/querying/functions/#absent
//
// Facts used (each read on the page named in its parentheses, 2026-11-08): "Whenever the alert expression results in one or more
// vector elements at a given point in time, the alert counts as active for these elements' label sets" (the alerting rules page), so an
// expression that returns nothing never makes an alert active. Between an instant vector and a scalar, a comparison operator is applied
// to every sample and "vector elements between which the comparison result is false get dropped from the result vector"; `by` "drops
// labels that are not listed in the by clause" (the operators page). "absent(v instant-vector) returns an empty vector if the vector
// passed to it has any elements (float samples or histogram samples) and a 1-element vector with the value 1 if the vector passed to it
// has no elements. This is useful for alerting on when no time series exist for a given metric name and label combination." (the
// functions page).
//
// Worked out in the game, not copied from a source (test/the-alert-that-stayed-green.test.mjs recomputes each from the dataset): every
// figure below. Per scrape (15 s) since the deploy /pay serves 60 requests and fails 15, /quote serves 120 and fails none.
// Invented for the game: the company, the presenter, the rule's threshold of 0.1. The counter is the checkout-http one, with status
// values "200" and "500" only.

const THRESHOLD = 0.1;
const PAY_REQUESTS = 60; // per scrape since the deploy
const PAY_FAILED = 15;
const QUOTE_REQUESTS = 120;
const ALL_REQUESTS = PAY_REQUESTS + QUOTE_REQUESTS;
const SCRAPE_S = 15;
const WINDOW_SCRAPES = 300 / SCRAPE_S; // a [5m] window holds this many scrapes
const SERVICE_RATIO = (PAY_FAILED / ALL_REQUESTS).toFixed(3); // 15/180, the whole service's share
const PAY_RATIO = PAY_FAILED / PAY_REQUESTS; // 0.25

const M = 'http_server_requests_total';
const RULE =
  `sum(rate(${M}{service="checkout", status="5xx"}[5m])) / ` +
  `sum(rate(${M}{service="checkout"}[5m])) > ${THRESHOLD}`;
const REFERENCE =
  `sum by (route) (rate(${M}{service="checkout", status="500"}[5m])) / ` +
  `sum by (route) (rate(${M}{service="checkout"}[5m])) > ${THRESHOLD}`;

// Step 1: why is the alert green? `why` follows "Right." or "Not quite.". Labels are close in length; the right one is the third.
const WHY = [
  {
    key: 'sampling',
    label: 'Sampling dropped the failed requests, so the counter never saw most of them',
    why:
      'The server adds one to this counter for every request it handles, not from spans, so sampling cannot remove a request from it. ' +
      `The table shows the failures are counted: ${PAY_FAILED} of /pay's ${PAY_REQUESTS} requests a scrape carry status 500.`,
  },
  {
    key: 'window',
    label: 'The 5-minute window is too short, so the failures never lift the rate over 0.1',
    why:
      `The failures are steady: /pay has failed ${PAY_FAILED} of ${PAY_REQUESTS} requests on every scrape since the deploy, and 5 minutes hold ${WINDOW_SCRAPES} scrapes of them. ` +
      'A longer window averages the same steady failures and would still select the same series: the query returns nothing because of what it selects, not because of how long it looks.',
  },
  {
    key: 'selector',
    label: 'The counter has no series with status="5xx", so the numerator matches nothing',
    right: true,
    why:
      'The status label holds the exact values "200" and "500", and a selector with <code>status="5xx"</code> is an equality match on that text, not a class of codes, so it selects no series. ' +
      'A numerator with no series is empty, and an empty result divided by anything is empty. ' +
      'A rule fires when its expression returns something, so this one can never fire, however many requests fail.',
  },
];

export default {
  id: 'the-alert-that-stayed-green',
  no: '9.6',
  name: 'The alert that stayed green',
  sub: 'Does that answer hold?',
  icon: '\u{1F7E2}',
  rewardTitle: 'Green doubter',
  cards: [],
  lights: ['checkout'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'asg',
    steps: [
      {
        intro:
          'In a review, a presenter says: "The checkout error alert has been green all afternoon, so checkout is healthy." Checkout deployed 20 minutes ago. ' +
          'The counter <code>http_server_requests_total</code> is incremented by the server for every request it handles (it is not made from spans), and has the labels <code>service</code>, <code>route</code> and <code>status</code>. ' +
          `The alert expression is <code>${RULE}</code>, and it fires when that returns anything.`,
        show:
          '<table><caption>Checkout, per scrape (every 15 seconds), since the deploy</caption>' +
          '<thead><tr><th scope="col">Route</th><th scope="col">Requests</th><th scope="col">With status 500</th></tr></thead><tbody>' +
          `<tr><td>/pay</td><td>${PAY_REQUESTS}</td><td>${PAY_FAILED}</td></tr>` +
          `<tr><td>/quote</td><td>${QUOTE_REQUESTS}</td><td>0</td></tr></tbody></table>` +
          '<p>The only values the <code>status</code> label takes are "200" and "500".</p>',
        question: 'Why has the alert stayed green?',
        qid: 'asg-q-why',
        choice: { id: 'asg-why', choices: WHY },
      },
      {
        intro:
          `A selector that matches nothing is not the only problem. Even with the right status, the rule asks about the whole checkout service: /pay fails ${PAY_FAILED} of ${PAY_REQUESTS} requests, ` +
          `but /quote takes ${QUOTE_REQUESTS} healthy ones with it, and the rule only fires above ${THRESHOLD}.`,
        question:
          `Fix the rule so it returns one series per route, labelled route only, for each route whose share of failed requests over the last 5 minutes is above ${THRESHOLD}.`,
        qid: 'asg-q-rule',
        query: {
          id: 'asg-rule',
          dataset: 'checkout-http',
          at: 3600,
          given: RULE,
          reference: REFERENCE,
          helps: {},
          explain:
            `Two things were wrong, and fixing either alone still leaves the rule silent. <code>status="5xx"</code> selects no series, because the label holds "500": the numerator was empty. ` +
            `With only that fixed, the whole service fails ${PAY_FAILED} of ${ALL_REQUESTS} requests, ${SERVICE_RATIO}, which a comparison with ${THRESHOLD} drops from the result (the operators page: elements for which the comparison is false get dropped), so the rule is still empty and still silent. ` +
            `With only <code>by (route)</code> fixed, the numerator is still empty. With both, /pay reads ${PAY_RATIO}, above ${THRESHOLD}, and the rule returns <code>{route="/pay"}</code>, one series per route, labelled route only (<code>by</code> drops the other labels). ` +
            'A rule is active for each label set its expression returns (the alerting rules page), so the alert now carries the route that fails. ' +
            'To catch a typo like this early, <code>absent()</code> is a guard: the functions page says it "returns an empty vector if the vector passed to it has any elements" and a 1-element vector with the value 1 "if the vector passed to it has no elements", and that it is "useful for alerting on when no time series exist for a given metric name and label combination". ' +
            'Use it on a selector that must always have series, such as the status "200" ones: for status "500", no series may just mean no failures, so it is no rule on its own.',
        },
      },
    ],
    finish:
      'A green alert is not proof of health: an expression that returns nothing never fires. ' +
      `Check that the selector matches a series that exists, and group by the label that names the failure, so one route failing ${PAY_FAILED} of ${PAY_REQUESTS} is not averaged away by the rest.`,
  },
};
