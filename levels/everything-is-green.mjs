// Act 7 boss: Everything is green. Customers cannot load Kettle & Co's shop and every dashboard and alert is green. The cause is
// an expired TLS certificate on the CDN edge: browsers refuse the connection during the handshake, so no request reaches the
// instrumented service, and the span-based alerts and the inside-the-cluster health check have nothing to fail on. The player follows it
// from the span numbers (requests collapse at one window, errors stay at zero), to who still sends requests (only internal tools),
// to a request made from outside (it resolves and connects, then fails on the certificate), to what the alert rules measure (spans, and
// an internal /health). Four views hold the chain (clues); two are red herrings; three are neutral. Scored. Three clues unlock the
// answers, and the outside request is the only view that refutes the second hypothesis in front of the load balancer (a lapsed DNS
// record or domain), so a board without it keeps two defensible causes and the player has to make the request. A plain-data Scenario for the incident engine,
// played through one declarative `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3, docs/DECLARATIVE-LEVELS.md §2),
// then one closing Choice on what would have paged (7.2: the SLI source; 7.4: probing from outside).
// The scenario is designed for this game (decided on #135, owner decision 2026-11-01).
// Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/synthetics/synthetic-monitoring , https://www.dash0.com/docs/dash0/monitoring/synthetics/explore-run-details
//
// Facts used (each read on the page named in its parentheses, 2026-11-07, as levels/synthetic-checks.mjs uses them): a SERVER span
// covers server-side handling of a remote request (the trace API page, SpanKind). In Dash0, a synthetic check sends requests to your
// websites and APIs at regular intervals from public or private locations and fires a notification when an assertion fails; a check
// run shows a timeline of DNS resolution, TCP connection, SSL/TLS handshake, request send, response wait and download, and error
// attributes that highlight network errors such as a TLS error (the synthetic monitoring and run details pages).
//
// Stated as reasoning, with no source (as levels/synthetic-checks.mjs does): a browser that refuses an expired certificate during the
// handshake sends no HTTP request, so the code behind the CDN never handles one and your service's spans hold nothing for it. The copy
// scopes this to your service's spans and to a certificate the CDN edge serves; whether a CDN or load balancer records its own
// events for a refused handshake depends on the product and is not claimed.
//
// Invented for the game: the company, the hostnames, every number and time, the curl line (curl's usual form for an expired
// certificate, abridged and shown as illustration, since curl's lines differ by version and TLS backend), the callers view, the load balancer behind the CDN, and the alert rules. Every figure the views
// and the answers state is derived from TABLE below and pinned in test/everything-is-green.test.mjs, so the story and the
// arithmetic cannot disagree.
//
// Why the dashboards are green: the shop's server spans still hold TABLE.internal requests a window, from internal tools that
// reach the origin without the CDN, and none of them fails. The error ratio is 0 of 240, a value and not 0/0 (an empty ratio would
// show no data, not green), the burn rate is that ratio over the 0.1% the 99.9% target allows, so 0, and the health check goes to the
// origin from inside the cluster, so it never meets the certificate. No rule watches how many requests arrive.

const fmt = (n) => n.toLocaleString('en-US');

/** The one table every figure in the views and the answers comes from. */
export const TABLE = {
  sloTarget: 0.999,
  // Server spans of the shop, one row per 5-minute window, named by its start. The certificate expires at 08:00.
  windows: [
    { at: '07:55', requests: 12000, errors: 12, p99Ms: 210 },
    { at: '08:00', requests: 240, errors: 0, p99Ms: 190 },
    { at: '09:15', requests: 240, errors: 0, p99Ms: 190 },
  ],
  internal: 240, // requests a window from internal tools, which reach the origin directly
  lastWeek: { at: '09:15', requests: 12300 }, // the same window a week earlier, a normal morning
  expiresAt: '08:00',
  rules: { errorRatioPct: 1, burnRate: 14.4, p99LimitMs: 800, rateFloor: 0.5 },
  healthPassed: 60, // of the last 60 one-minute runs
  outsideAt: '09:22', // the on-call makes the outside request after the 09:21 page
};

const ratioPct = (w) => Math.round((w.errors / w.requests) * 1000) / 10;
const burn = (w) => Math.round((w.errors / w.requests / (1 - TABLE.sloTarget)) * 10) / 10;
const one = (n) => n.toFixed(1);
const [BEFORE, FIRST, NOW] = TABLE.windows;
const visitors = (w) => w.requests - TABLE.internal;
const lastWeekVisitors = TABLE.lastWeek.requests - TABLE.internal;
const dropPct = Math.round(((BEFORE.requests - FIRST.requests) / BEFORE.requests) * 100);
const rateHalf = TABLE.rules.rateFloor * TABLE.lastWeek.requests; // the line a request-rate rule waits for, from the usual for the hour on the board

const row = (cells, th) => `<tr>${cells.map((c, i) => (th && i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`;

const SPANS_VIEW =
  '<p>Server spans of the shop, 5-minute windows named by their start:</p>' +
  '<table><caption>Server spans of the shop</caption>' +
  '<thead><tr><th scope="col">Window</th><th scope="col">Requests</th><th scope="col">Errors</th><th scope="col">Error ratio</th><th scope="col">Burn rate</th><th scope="col">p99</th></tr></thead>' +
  `<tbody>${TABLE.windows
    .map((w) => row([w.at, fmt(w.requests), fmt(w.errors), `${one(ratioPct(w))}%`, one(burn(w)), `${w.p99Ms} ms`], true))
    .join('')}</tbody></table>` +
  `<p>Requests fell by ${dropPct}% between the first two windows and have stayed there. Every window still has requests, so each ratio has a value: ${fmt(NOW.errors)} of ${fmt(NOW.requests)} failed.</p>`;

const CALLERS_VIEW =
  `<p>The ${NOW.at} window, requests by caller. Visitors come through the CDN edge, then the load balancer, then the pods; internal tools call the load balancer directly.</p>` +
  '<table><caption>Requests by caller</caption>' +
  `<thead><tr><th scope="col">Caller</th><th scope="col">${NOW.at} today</th><th scope="col">${TABLE.lastWeek.at} last week</th></tr></thead>` +
  '<tbody>' +
  row(['Browsers', fmt(visitors(NOW)), fmt(lastWeekVisitors)], true) +
  row(['Internal tools', fmt(TABLE.internal), fmt(TABLE.internal)], true) +
  row(['Counted by the load balancer', fmt(NOW.requests), fmt(TABLE.lastWeek.requests)], true) +
  '</tbody></table>' +
  `<p>The ${fmt(TABLE.internal)} internal requests fail no more often than before.</p>`;

const RULES_VIEW =
  `<p>The shop's alert rules, state at ${NOW.at}:</p>` +
  '<table><caption>Alert rules</caption>' +
  '<thead><tr><th scope="col">Rule</th><th scope="col">Reads</th><th scope="col">Pages when</th><th scope="col">State</th></tr></thead>' +
  '<tbody>' +
  row(['Error ratio of the shop\'s server spans', `${one(ratioPct(NOW))}%`, `above ${TABLE.rules.errorRatioPct}%`, 'Quiet'], true) +
  row(['Burn rate of the shop\'s server spans, over 5 minutes and 1 hour', `${one(burn(NOW))} in both`, `above ${TABLE.rules.burnRate} in both`, 'Quiet'], true) +
  row(['p99 of the shop\'s server spans', `${NOW.p99Ms} ms`, `above ${fmt(TABLE.rules.p99LimitMs)} ms`, 'Quiet'], true) +
  row(['Health check of the origin\'s /health, run every minute from inside the cluster', `passed ${TABLE.healthPassed} of ${TABLE.healthPassed}`, 'a run fails', 'Quiet'], true) +
  '</tbody></table>' +
  '<p>No rule watches how many requests arrive.</p>';

const OUTSIDE_VIEW =
  `<p>A request from a laptop outside the network, at ${TABLE.outsideAt}, to the shop's public hostname (curl output, abridged):</p>` +
  '<pre data-wrap><code>$ curl -v -I https://shop.kettle.example/\n' +
  '* Host shop.kettle.example:443 was resolved.\n' +
  '* Connected to shop.kettle.example (203.0.113.10) port 443\n' +
  '[...]\n' +
  '* SSL certificate problem: certificate has expired\n' +
  'curl: (60) SSL certificate problem: certificate has expired</code></pre>' +
  `<p>The certificate the CDN edge serves for <code>shop.kettle.example</code> ends at ${TABLE.expiresAt} today. The same request to the origin by its internal name returns 200.</p>`;

const SCENARIO = {
  id: 'everything-is-green',
  alert: {
    title: 'Shop unreachable, dashboards green',
    html:
      '<p>PAGE 09:21, from support and not from an alert: customers have reported since 08:10 that the shop will not load. ' +
      'Every dashboard is green and no alert has fired. Find out why the monitoring says nothing is wrong.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 5 },
  views: [
    { id: 'span-numbers', label: 'Server spans of the shop', costMin: 3, kind: 'clue', html: SPANS_VIEW },
    { id: 'who-calls', label: 'Requests by caller', costMin: 3, kind: 'clue', html: CALLERS_VIEW },
    { id: 'outside-request', label: 'A request from outside', costMin: 3, kind: 'clue', html: OUTSIDE_VIEW },
    { id: 'alert-rules', label: 'Alert rules and checks', costMin: 4, kind: 'clue', html: RULES_VIEW },
    {
      id: 'origin-pods',
      label: 'Pods behind the load balancer',
      costMin: 2,
      kind: 'neutral',
      html: '<p>6 of 6 pods are Running with no restarts in 24 hours, at 9% CPU and 31% memory. None is under pressure.</p>',
    },
    {
      id: 'last-deploy',
      label: 'Recent deploys and config changes',
      costMin: 2,
      kind: 'neutral',
      html: '<p>The last deploy of the shop was on Tuesday, and nothing was released near 08:00.</p>',
    },
    {
      id: 'database',
      label: 'Database',
      costMin: 2,
      kind: 'neutral',
      html: '<p>11 of 200 connections are in use and the slowest query takes 5 ms. The database is quiet and healthy.</p>',
    },
    {
      id: 'collector-health',
      label: 'The Collector',
      costMin: 4,
      kind: 'herring',
      html:
        '<p>Spans accepted, refused and exported by the Collector, last 24 hours: no refusals and no export failures, apart from 90 seconds of retries at 06:42 that recovered. ' +
        'The inventory sync job\'s span arrives in every 5-minute window, so telemetry is flowing.</p>',
    },
    {
      id: 'payment-latency',
      label: 'The payment provider',
      costMin: 3,
      kind: 'herring',
      html:
        '<p>p99 of the shop\'s outgoing calls to the payment provider rose to 1.8 s from 09:02 to 09:06, on 14 test orders placed by internal tools, ' +
        'and was back to 320 ms from 09:07. The shop has had no browser visitors since 08:00.</p>',
    },
  ],
  hypotheses: [
    {
      id: 'expired-certificate',
      label: 'The certificate on the CDN edge has expired, so browsers refuse to connect',
      right: true,
      why:
        `In the span numbers, requests fell from ${fmt(BEFORE.requests)} to ${fmt(FIRST.requests)} in the window starting ${FIRST.at}, and the callers view shows that only internal tools still send any: no browser request reaches the shop. ` +
        `The request from outside resolves the hostname and connects, then fails on a certificate that ends at ${TABLE.expiresAt}. The monitoring is green because it measures requests that arrive: ` +
        `${fmt(NOW.errors)} of ${fmt(NOW.requests)} failed is ${one(ratioPct(NOW))}%, the burn rate is ${one(burn(NOW))}, and the health check goes to the origin from inside the cluster, where the certificate is never presented.`,
    },
    {
      id: 'collector-dropping',
      label: 'The Collector is dropping the shop\'s spans, so the dashboards show only part of the real traffic',
      right: false,
      why:
        'The Collector refused and failed to export nothing apart from 90 seconds of retries at 06:42, and the inventory sync job\'s span arrives in every window. ' +
        `The load balancer, which does not use spans, counts the same ${fmt(NOW.requests)} requests in the ${NOW.at} window, so the requests are missing before they reach telemetry, not after. ` +
        'And dropped spans could not make a visitor\'s request fail on a certificate.',
    },
    {
      id: 'payment-provider-slow',
      label: 'The payment provider is slow, so shoppers give up at checkout',
      right: false,
      why:
        'The slow calls ran from 09:02 to 09:06, more than an hour after the traffic fell, and they were test orders from internal tools. ' +
        `Shoppers cannot give up at checkout when they never load the page: browsers sent ${fmt(visitors(NOW))} requests in the ${NOW.at} window against ${fmt(lastWeekVisitors)} a week earlier.`,
    },
    {
      id: 'dns-lapsed',
      label: 'The shop\'s public hostname no longer resolves, because the DNS record or the domain lapsed',
      right: false,
      why:
        'Only the request from outside rules this out, and it does: the hostname resolved and the connection opened, and the request failed afterwards, at the certificate (curl error 60). ' +
        'A name that no longer resolved would have failed earlier, with curl error 6, Could not resolve host, before any certificate was presented.',
    },
    {
      id: 'origin-overloaded',
      label: 'The origin is overloaded and refuses new connections from browsers',
      right: false,
      why:
        'The pods are at 9% CPU and the database is quiet, and an overloaded origin would show errors or slow requests in its spans. ' +
        `The internal requests that do arrive take ${NOW.p99Ms} ms at p99, faster than the ${BEFORE.p99Ms} ms of the ${BEFORE.at} window, and the same origin answers 200 when called by its internal name.`,
    },
  ],
  answerAfterViews: 3,
  hint:
    '<p>Green means the numbers see nothing wrong, not that nothing is wrong. For each number, ask what it counts and where it is counted, and compare that with what a customer does first.</p>',
};

// Step 2: what would have paged. `why` follows "Right." or "Not quite.".
const PAGE = [
  {
    key: 'outside-check',
    label: 'A probe of the public hostname, run every minute from a public location, that pages on failure',
    right: true,
    why:
      'The check makes the request from outside the network the way a visitor does, so it meets the expired certificate that the spans and the internal health check never meet. ' +
      'In Dash0, a synthetic check sends requests at regular intervals from locations you choose and fires a notification when an assertion fails, and a check run breaks the request into DNS resolution, TCP connection and the SSL/TLS handshake and shows a TLS error as such. ' +
      'It pages in the first minute after the certificate ends and says which step failed.',
  },
  {
    key: 'tighter-ratio',
    label: `An error-ratio alert on the shop's server spans, with the threshold lowered from ${TABLE.rules.errorRatioPct}% to 0.1%`,
    why: `The ratio is ${fmt(NOW.errors)} of ${fmt(NOW.requests)}, which is ${one(ratioPct(NOW))}% under any threshold above zero. A failed handshake never becomes a span of the shop's service, so no threshold on the shop's server spans can make them report it.`,
  },
  {
    key: 'load-balancer-sli',
    label: 'An SLI computed from the load balancer\'s request counts instead of from server spans',
    why:
      `The load balancer is the better source for requests it turned away (7.2), but here the refusal happens in front of it, at the CDN edge. It counted ${fmt(NOW.requests)} requests in the ${NOW.at} window, all good, so its ratio reads ${one(ratioPct(NOW))}% failed just as the spans do.`,
  },
  {
    key: 'faster-health',
    label: 'A /health check on the origin from inside the cluster, run every 10 seconds instead of every minute',
    why: `Every run already passes (${TABLE.healthPassed} of ${TABLE.healthPassed}), and running it more often only repeats a passing result. The check goes to the origin from inside the cluster, a path that never meets the CDN edge or its certificate.`,
  },
  {
    key: 'rate-drop',
    label: `An alert on the request rate of the shop's server spans falling below half of the usual for that hour`,
    why:
      `This one would have fired: the ${NOW.at} window holds ${fmt(NOW.requests)} requests against ${fmt(TABLE.lastWeek.requests)} at that hour a week earlier, far under the half (${fmt(rateHalf)}) it waits for. ` +
      'It says only that traffic fell, and a certificate, a DNS fault, a bad release and a holiday all look the same in it. A probe from outside names the step that failed, which is what the question asks for.',
  },
];

export default {
  id: 'everything-is-green',
  no: null,
  name: 'Everything is green',
  sub: 'The monitoring says fine',
  icon: '\u{1F7E2}',
  rewardTitle: 'Outside looker',
  cards: [],
  lights: ['storefront', 'api-gateway'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'eig',
    steps: [
      {
        intro: 'Customers cannot load the shop and nothing has paged. Find out why every dashboard says all is well.',
        incident: SCENARIO,
      },
      {
        intro: 'The incident is explained. In the review, someone asks which addition would have paged at 08:00.',
        question: 'Which addition would have paged within minutes of the certificate ending, and named the step that failed?',
        qid: 'eig-q-page',
        choice: { id: 'eig-page', choices: PAGE },
      },
    ],
    finish:
      'You found why green meant nothing: every number counted requests that arrived, and the check ran from inside, while the failure sat in front of the service. ' +
      'Spans and an SLI tell you how the requests that arrive are doing; a probe from outside tells you whether a visitor can arrive at all.',
  },
};
