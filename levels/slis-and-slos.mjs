// Level 7.2: SLIs and SLOs. Act 7 "Alerting and SLOs". Kettle & Co's checkout team wants a number for "checkout works". The player
// picks the shape of an SLI (good requests over valid requests, Choice), writes it as a PromQL ratio of rates over the checkout server
// spans (Query it), reads an error budget off an SLO target (Choice), and then meets the nuance: server spans never see a request the
// load balancer turned away, so the user-facing SLI is measured at the edge (Choice with a tempting wrong option). Hints are on for
// the Query it step only, as in 3.7.
// Spec: https://prometheus.io/docs/prometheus/latest/querying/functions/#rate , https://prometheus.io/docs/concepts/metric_types/#counter
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-spans/ , https://opentelemetry.io/docs/collector/components/connector/
// Docs (GitHub, spanmetrics connector README at v0.164.0, as levels/red-and-use.mjs cites it): https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.164.0/connector/spanmetricsconnector/README.md
//
// Facts used (each read on the page named in its parentheses, 2026-11-07): rate() calculates the per-second average rate of increase of the series in
// the range vector, and counter resets from target restarts are adjusted for (the functions page); a counter only goes up, or resets
// to zero on a restart (the metric types page); an HTTP server span is set to the error status for a 5xx and otherwise left unset
// (the HTTP spans page, as already used by 3.7); the spanmetrics connector counts spans into a calls metric, which a Prometheus
// backend sees as traces_span_metrics_calls_total, by service.name, span.name, span.kind and status.code, with the status codes
// STATUS_CODE_UNSET, STATUS_CODE_OK and STATUS_CODE_ERROR and the span kinds such as SPAN_KIND_SERVER (the spanmetrics README, as
// in 3.7; the connector page only lists the connectors).
//
// Invented for the game, not claimed from any source: the company, the numbers, the 99.9% target, the 30-day window (labelled
// illustrative in the copy because the data is one hour) and the load balancer story. The definitions of SLI, SLO and error budget
// are in the game's own words: an SLI is a ratio of good requests to valid requests, an SLO is the target for it, the budget is what the
// target leaves over. No edge counter exists in the data, so the edge-vs-server step is a Choice, not a query. No Dash0 claim.

const SLI = [
  {
    key: 'good-over-valid',
    label: 'Good requests over valid requests, as a share of the traffic',
    right: true,
    why: 'A ratio of good requests to valid requests is a number between 0 and 1 that means the same on a quiet night and on a sale day, and an SLO target can be set against it: 99.9% good. What counts as good and as valid is your decision, and it is written down once.',
  },
  {
    key: 'error-count',
    label: 'The number of failed requests per minute, as a count of errors',
    why: 'A count follows the traffic: a sale day has more failures with the same quality, and a quiet night hides a service that fails half of its few requests. A share of the requests does not move with the traffic.',
  },
  {
    key: 'uptime',
    label: 'The share of the time the checkout servers are up and answering',
    why: 'A server can be up and still fail every payment. Users do not feel whether a process runs, they feel whether their request worked, so the SLI counts requests, not time.',
  },
];

const BUDGET = [
  {
    key: 'thousand',
    label: '1,000 failed requests (0.1%)',
    right: true,
    why: 'The error budget is what the SLO leaves over: 100% minus 99.9% is 0.1%, and 0.1% of 1,000,000 valid requests is 1,000. Spend them on deploys and mistakes; once they are gone, the target is missed.',
  },
  {
    key: 'hundred',
    label: '100 failed requests (0.01%)',
    why: 'That is 0.01% of the requests. The target is 99.9% good, so the failures allowed are the other 0.1%, and 0.1% of 1,000,000 is 1,000.',
  },
  {
    key: 'ten-thousand',
    label: '10,000 failed requests (1%)',
    why: 'That is a 99% target. At 99.9%, the failures allowed are 0.1% of the valid requests, which is 1,000 of 1,000,000, a tenth of what this answer allows.',
  },
  {
    key: 'all-but',
    label: '999,000 failed requests (99.9%)',
    why: 'Inverted. The target is the share that must be good, 99.9%, so 999,000 of the 1,000,000 must succeed. The failures allowed are the 1,000 left over.',
  },
];

const EDGE = [
  {
    key: 'server-spans',
    label: 'Checkout\'s server spans: they carry the labels and they are the application\'s own record',
    why: 'A request the load balancer turned away never reached checkout, so it never became a span. The server-span SLI counts only the requests that got in, and it reads healthy through exactly the minutes users saw errors. Keep the spans to find out why, but do not measure the promise to users with them.',
  },
  {
    key: 'load-balancer',
    label: 'The load balancer\'s request counts: good responses over all responses it sent',
    right: true,
    why: 'The load balancer sees every request that reaches your infrastructure, including the ones that never reached a healthy pod, so its good-over-valid ratio is the one closest to what users got. It has fewer labels than a span, so use the server spans to find out where and why, and the load balancer for the SLI.',
  },
  {
    key: 'both-summed',
    label: 'Both, added together: server-span requests plus load-balancer requests',
    why: 'Every request that reached checkout is counted twice, once at the load balancer and once as a span, and the sum is not a share of anything. An SLI uses one source for its good requests and its valid requests.',
  },
];

export default {
  id: 'slis-and-slos',
  no: '7.2',
  name: 'SLIs and SLOs',
  sub: 'A number for "it works"',
  icon: '\u{1F3AF}',
  rewardTitle: 'Budget keeper',
  cards: [],
  lights: ['checkout', 'api-gateway'],
  scoring: { parMs: null },
  play: {
    prefix: 'sl',
    steps: [
      {
        intro:
          'Kettle &amp; Co\'s checkout team is tired of arguing about whether checkout is "fine". They want one number. ' +
          'An <b>SLI</b>, a service level indicator, is a measurement of how well the service is doing for its users. ' +
          'An <b>SLO</b>, a service level objective, is the target the team sets for it.',
        question: 'Which measurement makes the best SLI for "checkout works"?',
        qid: 'sl-q-sli',
        choice: { id: 'sl-sli', choices: SLI },
      },
      {
        intro:
          'The span metrics from 3.7 reach your backend as <code>traces_span_metrics_calls_total</code>, a counter with the labels ' +
          '<code>service_name</code>, <code>span_kind</code> and <code>status_code</code>. Checkout\'s own requests are its SERVER spans. ' +
          'A success is <code>STATUS_CODE_UNSET</code> and a failure is <code>STATUS_CODE_ERROR</code>. A counter only grows, so the SLI ' +
          'is built from rates.',
        question: 'Write the checkout SLI over the last 5 minutes: the rate of good server requests divided by the rate of all of them.',
        qid: 'sl-q-sli-query',
        query: {
          id: 'sl-sli-query',
          dataset: 'checkout-spanmetrics',
          at: 3600,
          reference:
            'sum(rate(traces_span_metrics_calls_total{service_name="checkout", span_kind="SPAN_KIND_SERVER", status_code!="STATUS_CODE_ERROR"}[5m])) / ' +
            'sum(rate(traces_span_metrics_calls_total{service_name="checkout", span_kind="SPAN_KIND_SERVER"}[5m]))',
          helps: { hints: true },
          hint: 'Good over valid: both sides are sums over the same requests of one service, the top side without the failures. A counter needs the function that turns it into a speed.',
          explain:
            'Checkout served 12 requests per second and 11 of them were good: 91.7%. Without <code>rate()</code> you divide the totals since the ' +
            'counters began, an hour of history, and read 96.5%, which hides the minutes that are failing now. Leave out the span kind and ' +
            'checkout\'s call to the payment provider counts as a request it serves: 87.5%.',
        },
      },
      {
        intro:
          'The team sets an SLO of <b>99.9%</b> good requests over a window of 30 days. The window is illustrative: the data you queried is one hour. ' +
          'Say checkout serves 1,000,000 valid requests in the window. Whatever the target leaves over is the <b>error budget</b>. ' +
          'Checkout measured 91.7% in the last step, far below 99.9%: right now its budget is spent, and that gap is what an SLO is for.',
        question: 'How many of those requests may fail before the SLO is missed?',
        qid: 'sl-q-budget',
        choice: { id: 'sl-budget', choices: BUDGET },
      },
      {
        intro:
          'Back to the 99.9% SLO over 30 days, with steady traffic. A deploy left checkout with no ready pod for one hour, and the load balancer ' +
          'in front of it (the edge of your system) answered 502 to every request in that hour: 1 hour of 720, so 0.14% of the month\'s requests. ' +
          'Checkout\'s server-span SLI for the 30 days reads 99.95%, which meets the target. Counted at the load balancer, which adds those 502s ' +
          'to the failures, it reads about 99.81%, which misses it. Customers wrote in.',
        question: 'Which source should the SLI come from?',
        qid: 'sl-q-edge',
        choice: { id: 'sl-edge', choices: EDGE },
      },
    ],
    finish:
      'You can turn "it works" into a ratio of good requests to valid requests, and compute it from rates, not from a counter\'s total. You can read the error budget off an SLO. You know a server-span SLI misses the requests that never reached the server.',
  },
};
