// Level 7.4: Synthetic checks. Act 7 "Alerting and SLOs". Kettle & Co's checkout is fully instrumented, and customers still tell the team
// about outages first. The player sorts nine failures into "your server spans see it" and "only a probe from outside sees it" (Sort it),
// then chooses the alert that would have paged for an expired TLS certificate, where the spans read healthy (Choice). No synthetic run is
// simulated. Hints are off on the sort (the default ladder: hints in early acts only).
// Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind , https://opentelemetry.io/docs/specs/semconv/http/http-spans/
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/synthetics/synthetic-monitoring , https://www.dash0.com/docs/dash0/monitoring/synthetics/explore-run-details , https://www.dash0.com/docs/dash0/monitoring/alerting/about-notifications
//
// Facts used (each read on the page named in its parentheses, 2026-11-07): a SERVER span covers server-side handling of a remote request
// (the trace API page, SpanKind); the HTTP spans page has an example of a client call that fails with a DNS error, seen from the client
// side. In Dash0, synthetic checks are scripted tests that send requests to your websites and APIs at regular intervals from public or
// private locations, and a notification fires when an assertion fails; a check run shows a timeline of DNS resolution, TCP connection,
// SSL/TLS handshake, request send, response wait and download, and error attributes that highlight network errors such as a timeout or a
// TLS error; notification channels deliver alerts from check rules and synthetic checks (the synthetic monitoring page, the run details
// page, the notification channels page).
//
// Stated as reasoning, with no source: a request that fails before it reaches instrumented code (a failed DNS lookup, a failed TLS
// handshake, an answer from a CDN cache or from the load balancer) never becomes a server span in your service, because a server span is
// made by the code that handles the request. The copy says "never reaches" and does not cite a page for it.
//
// Invented for the game: the company, the nine failures, and every number in step 2 (3,000 requests against a usual 12,000, 0 errors, 180 ms).

const SORT = {
  id: 'sc-sort',
  helps: { hints: false },
  buckets: [
    { id: 'spans', label: 'Your server spans see it' },
    { id: 'probe', label: 'Only a probe from outside sees it' },
  ],
  items: [
    {
      id: 'handler-throws',
      label: 'A handler throws an exception on an empty cart',
      bucket: 'spans',
      why: 'The request reached checkout and the handler failed while handling it, so the server span records the error status and the exception.',
    },
    {
      id: 'tls-expired',
      label: 'The TLS certificate on the public hostname has expired',
      bucket: 'probe',
      why: 'Clients refuse the connection during the handshake, before any HTTP request is sent. No request reaches checkout, so there is no server span. A probe does the handshake itself and fails.',
    },
    {
      id: 'slow-query',
      label: 'One SQL query in checkout takes 4 seconds',
      bucket: 'spans',
      why: 'The request got in, so the server span is long and the database client span under it shows where the time went.',
    },
    {
      id: 'dns-stale',
      label: 'A DNS record still points the hostname at a retired address',
      bucket: 'probe',
      why: 'Clients resolve the name to an address that no longer serves checkout, and their requests go nowhere. Nothing arrives to be traced. A probe resolves the name like a visitor does and fails the same way.',
    },
    {
      id: 'inventory-loop',
      label: 'A loop in checkout calls the inventory service 30 times per request',
      bucket: 'spans',
      why: 'The requests arrive and run, slowly, and the trace shows 30 client spans under one server span.',
    },
    {
      id: 'cdn-stale',
      label: 'The CDN serves a broken page from its cache',
      bucket: 'probe',
      why: 'The CDN answers visitors itself, so the request never travels to your service, and your spans see a quiet, healthy origin. A probe fetches the page from outside and can check what it got.',
    },
    {
      id: 'payment-timeout',
      label: 'The payment provider times out on a call',
      bucket: 'spans',
      why: 'The request reached checkout, which then called out and waited. The client span for the call and the server span above it both record the failure.',
    },
    {
      id: 'lb-no-targets',
      label: 'The load balancer has no healthy target left',
      bucket: 'probe',
      why: 'The load balancer answers with an error of its own and forwards nothing to checkout, so no server span exists for those requests. A probe sees the error response.',
    },
    {
      id: 'bad-deploy',
      label: 'A bad deploy makes every request to /pay return 500',
      bucket: 'spans',
      why: 'The requests reach the new code, which fails them, so each one becomes a server span with an error status.',
    },
  ],
};

const ALERT = [
  {
    key: 'error-ratio',
    label: 'Error ratio of checkout\'s server spans above 2%',
    why: 'The spans hold 0 errors in 3,000 requests, a ratio of 0%. The failed handshakes never reached checkout, so there is nothing to count, and the ratio stays at 0% while most visitors cannot connect.',
  },
  {
    key: 'burn-rate',
    label: 'Burn rate of checkout\'s spans above 14.4 in both windows',
    why: 'It is built on the same spans: 0 errors divided by the 0.001 the SLO allows is a burn rate of 0, in both windows. The rule from 7.3 is sound, and it is blind to requests that never arrive.',
  },
  {
    key: 'p99',
    label: 'p99 latency of checkout\'s server spans above 1 second',
    why: 'The requests that do arrive still take 180 ms at p99, exactly as usual. A span describes a request that got in, and latency says nothing about the ones that did not.',
  },
  {
    key: 'probe',
    label: 'A probe requesting the public hostname every minute',
    right: true,
    why:
      'The probe makes its own request from outside the way a visitor does: the DNS lookup, then the TLS handshake, and with an expired certificate the handshake fails, whatever the spans say. ' +
      'In Dash0, a synthetic check sends requests to your endpoint at regular intervals from locations you choose and fires a notification when an assertion fails. ' +
      'A check run breaks down DNS resolution, TCP connection and the SSL/TLS handshake and shows a TLS error as such, and notification channels deliver the alert. ' +
      'Keep the spans for why a request that arrived went wrong; use the probe to learn that requests are not arriving.',
  },
];

export default {
  id: 'synthetic-checks',
  no: '7.4',
  name: 'Synthetic checks',
  sub: 'See what users see',
  icon: '\u{1F4E1}',
  rewardTitle: 'Edge watcher',
  cards: ['synthetics-see-the-edge'],
  lights: ['storefront', 'api-gateway'],
  scoring: { parMs: null },
  play: {
    prefix: 'sc',
    steps: [
      {
        intro:
          'Every request that reaches Kettle &amp; Co\'s checkout becomes a server span, and still the team hears about some outages from customers first. ' +
          'A <b>probe</b> is a request the team sends itself, at regular intervals, from outside, the way a visitor would; a <b>synthetic check</b> is a probe with a pass or fail on what comes back.',
        question: 'For each failure, say who sees it: your server spans, or only a probe from outside.',
        qid: 'sc-q-sort',
        sort: SORT,
      },
      {
        intro:
          'Last night the TLS certificate on checkout\'s public hostname expired and browsers refused to connect. Checkout\'s server spans for the last 5 minutes: ' +
          '3,000 requests (usually 12,000), all from internal tools that do not check certificates, 0 errors, p99 latency 180 ms (usually 180 ms). Nothing paged.',
        question: 'Which alert would have paged the on-call engineer?',
        qid: 'sc-q-alert',
        choice: { id: 'sc-alert', choices: ALERT },
      },
    ],
    finish:
      'You can tell what server spans see from what only a probe sees: a request that never reaches your service leaves no span. ' +
      'Spans tell you why a request that arrived went wrong, and a probe from outside tells you whether requests can arrive at all.',
  },
};
