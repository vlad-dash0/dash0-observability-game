// Level 3.5: Cardinality. The player counts the series a counter makes (the product of the number of
// values of each attribute), spots the attributes whose values never stop growing (a user id, a raw
// URL, a request id) among the ones that do, keeps a series budget by using http.route, giving the tier a counter of its own and
// putting the user id on a span, and learns what Dash0's tree map and spam filters do about volume.
// Spec: docs/OUTLINE.md §4 Act 3.
// Spec: https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits , https://opentelemetry.io/docs/specs/otel/metrics/supplementary-guidelines/
// Spec: https://opentelemetry.io/docs/specs/semconv/http/http-metrics/ , https://opentelemetry.io/docs/specs/semconv/http/http-spans/
// Spec: https://prometheus.io/docs/practices/naming/#labels , https://prometheus.io/docs/practices/instrumentation/#do-not-overuse-labels
// Dash0 docs: https://www.dash0.com/docs/dash0/telemetry/metrics/identify-high-cardinality-metrics , https://www.dash0.com/docs/dash0/cost-control/spam-filters

// How many distinct values each attribute takes at Kettle & Co (an invented but fixed table). Every
// number in the copy and every cost below is computed from it, so they cannot disagree.
const VALUES = { method: 5, route: 14, status: 9, tier: 3, user: 31402, path: 48211 };
const n = (x) => x.toLocaleString('en-US');
const times = (...keys) => keys.map((k) => n(VALUES[k])).join(' × ');
const product = (...keys) => keys.reduce((acc, k) => acc * VALUES[k], 1);
const sum = (...xs) => xs.reduce((a, b) => a + b, 0);

const ROUTE_STATUS = product('route', 'status');
const ROUTE_STATUS_TIER = product('route', 'status', 'tier');
const PATH_STATUS = product('path', 'status');
const ROUTE_STATUS_USER = product('route', 'status', 'user');
const COST_NONE = 1; // a counter with no attributes is one series
const PLAN = sum(ROUTE_STATUS, VALUES.tier, 0);
const ONE_COUNTER = sum(ROUTE_STATUS_TIER, COST_NONE, 0); // the tier on the requests counter, nothing on the other
const CAP = 300;

// Step 1. `why` follows "Right." or "Not quite.".
const COMBOS = [
  {
    key: 'sum',
    label: `${VALUES.method} + ${VALUES.route} + ${VALUES.status} = ${n(VALUES.method + VALUES.route + VALUES.status)}: one series for each value`,
    why: 'A series is one value of every attribute together, not one value alone. A POST to one route with a 200 and a GET to the same route with a 200 are two series, so adding the counts leaves most of them out.',
  },
  {
    key: 'product',
    label: `${times('method', 'route', 'status')} = ${n(product('method', 'route', 'status'))}`,
    right: true,
    why: `Every combination of a method, a route and a status code is its own series, so the product is the most the counter can have. In practice fewer exist, because not every route answers every method and every code. One more attribute multiplies it again: add <code>user.id</code> with ${n(VALUES.user)} values and the bound is ${n(product('method', 'route', 'status', 'user'))}.`,
  },
  {
    key: 'attributes',
    label: '3: one series for each attribute',
    why: 'An attribute is a dimension, not a series. A counter with three attributes has one series for every combination of their values.',
  },
  {
    key: 'one',
    label: '1: a counter is a single number',
    why: 'Without attributes it would be one series. Every attribute splits it by that attribute\'s values.',
  },
];

// Step 2. Lines read `name{labels}`: one sample series for each attribute on the counter.
const SPOT = {
  id: 'cdn-spot',
  target: 'metric',
  helps: { hints: true },
  hint: 'Ask how many different values each label takes over a month, not what one value looks like.',
  lines: [
    { id: 'route', text: 'http_server_requests_total{http_route="/recommendations/{id}"}' },
    { id: 'method', text: 'http_server_requests_total{http_request_method="POST"}' },
    { id: 'url-path', text: 'http_server_requests_total{url_path="/recommendations/48211"}' },
    { id: 'port', text: 'http_server_requests_total{server_port="8443"}' },
    { id: 'user-id', text: 'http_server_requests_total{user_id="u-31402"}' },
    { id: 'status', text: 'http_server_requests_total{http_response_status_code="503"}' },
    { id: 'request-id', text: 'http_server_requests_total{request_id="xkqmvzthbwpr"}' },
    { id: 'region', text: 'http_server_requests_total{cloud_region="eu-west-1"}' },
  ],
  faults: ['url-path', 'user-id', 'request-id'],
  whyNot: {
    route: 'A route template: the dynamic segments are placeholders, so every request to the route carries the same value. The semantic conventions require <code>http.route</code> to be low-cardinality for this reason.',
    method: 'A short list of values. The semantic conventions map a method the instrumentation does not know to <code>_OTHER</code>, so this cannot grow without bound.',
    status: 'It looks like a number, but a status code is one of a short list of values. What makes an attribute high-cardinality is how many different values it takes, not what they look like.',
    port: 'A port is a number, but a service listens on a short list of ports that its configuration sets, and the list changes only when somebody changes that configuration. What makes an attribute high-cardinality is how many different values it takes, not how many digits it has.',
    region: 'A cloud provider has a short, published list of regions, and a company runs in a handful of them. Few values, and the set changes rarely.',
  },
  explain:
    'The URL path, the user id and the request id each take a new value for every URL, user or request, so each new one is a new series. ' +
    'For the URL, use <code>http.route</code>: the template with the ids replaced by placeholders, <code>/recommendations/{id}</code> and not <code>/recommendations/48211</code>. ' +
    'The price is more than the bill. Prometheus\' own guidance is not to use labels for unbounded values such as user IDs, and an SDK that implements the specification\'s cardinality limit ' +
    '(2,000 per metric by default) folds the combinations it has not seen yet into one point marked <code>otel.metric.overflow</code>, so the breakdown you added stops being accurate.',
};

// Step 3. Every cost is the product of the number of values of the attributes kept, in series. Adding an
// attribute to a counter multiplies that counter's cost; a second counter only adds its own. That is the
// deciding fact: the tier is cheap on its own counter (3) and dear on the requests counter (126 × 3).
// No cost heuristic finds the plan (test/trade-off-balance.test.mjs probes them all).
const BUDGET = {
  id: 'cdn-budget',
  unit: 'series',
  cap: CAP,
  helps: { hints: true },
  hint:
    'A counter\'s series are the number of values of every attribute on it, multiplied together, so each attribute you add to a counter multiplies that counter\'s total. Ask what one more attribute does to the counter that carries it, and which need a span could meet instead.',
  knobs: [
    {
      id: 'requests',
      label: 'Counter <code>http.server.requests</code>',
      options: [
        {
          id: 'route-status-tier',
          label: `<code>http.route</code>, <code>http.response.status_code</code> and <code>customer.tier</code>: ${times('route', 'status', 'tier')} = ${n(ROUTE_STATUS_TIER)}`,
          cost: ROUTE_STATUS_TIER,
          keeps: ['traffic-by-route', 'errors-by-route', 'served-by-tier'],
        },
        {
          id: 'route',
          label: `<code>http.route</code>: ${n(VALUES.route)}`,
          cost: VALUES.route,
          keeps: ['traffic-by-route'],
        },
        {
          id: 'path-status',
          label: `<code>url.path</code> and <code>http.response.status_code</code>: ${times('path', 'status')} = ${n(PATH_STATUS)}`,
          cost: PATH_STATUS,
          keeps: ['traffic-by-route', 'errors-by-route'],
        },
        {
          id: 'route-status',
          label: `<code>http.route</code> and <code>http.response.status_code</code>: ${times('route', 'status')} = ${n(ROUTE_STATUS)}`,
          cost: ROUTE_STATUS,
          keeps: ['traffic-by-route', 'errors-by-route'],
        },
        {
          id: 'route-status-user',
          label: `<code>http.route</code>, <code>http.response.status_code</code> and <code>user.id</code>: ${times('route', 'status', 'user')} = ${n(ROUTE_STATUS_USER)}`,
          cost: ROUTE_STATUS_USER,
          keeps: ['traffic-by-route', 'errors-by-route', 'one-customer'],
        },
      ],
    },
    {
      id: 'served',
      label: 'Counter <code>recommendations.served</code>',
      options: [
        { id: 'user', label: `<code>user.id</code>: ${n(VALUES.user)}`, cost: VALUES.user, keeps: ['one-customer'] },
        { id: 'none', label: 'No attributes', cost: COST_NONE },
        { id: 'tier', label: `<code>customer.tier</code>: ${n(VALUES.tier)}`, cost: VALUES.tier, keeps: ['served-by-tier'] },
      ],
    },
    {
      id: 'customer',
      label: 'Where one customer\'s failing requests can be found',
      options: [
        { id: 'nothing', label: 'Nowhere: no attribute carries the user', cost: 0 },
        { id: 'span-attribute', label: '<code>user.id</code> as an attribute on the checkout span: not a metric series, so 0', cost: 0, keeps: ['one-customer'] },
      ],
    },
  ],
  needs: [
    { id: 'traffic-by-route', label: 'the request rate of each route' },
    { id: 'errors-by-route', label: 'the error rate of each route' },
    { id: 'served-by-tier', label: 'recommendations served per customer tier' },
    { id: 'one-customer', label: 'one customer\'s failing requests' },
  ],
  answer: { requests: 'route-status', served: 'tier', customer: 'span-attribute' },
  whyNot: {
    'requests:route': 'The request rate of each route, and no status code, so no error rate. A series per route is cheap because it carries one attribute.',
    'requests:route-status-tier':
      `It keeps the tier on the same counter, and every attribute multiplies the counter: ${times('route', 'status', 'tier')} = ${n(ROUTE_STATUS_TIER)}, ` +
      `where a counter of its own for the tier adds ${VALUES.tier}. With the other counter and the span attribute the plan is ${n(ONE_COUNTER)} series, over the ${n(CAP)}.`,
    'requests:path-status':
      `It keeps the per-route view, and a raw URL is a new series for every id: ${n(PATH_STATUS)} series. <code>http.route</code> gives the same view in ${VALUES.route} routes.`,
    'requests:route-status-user':
      `Each of ${n(VALUES.user)} users multiplies the whole counter: ${n(ROUTE_STATUS_USER)} series, to find one customer. A span can carry that value for 0 series.`,
    'served:user':
      `One series for each of ${n(VALUES.user)} users, from a single counter, and still no tier. A per-customer view belongs on a span.`,
    'served:none': 'One series, and no tier: the question of how many recommendations each tier gets has no answer.',
    'customer:nothing': 'No attribute carries the user anywhere, so one customer\'s failing requests cannot be found.',
  },
  explain:
    `${n(ROUTE_STATUS)} series for the route and status counter, ${VALUES.tier} for the tier counter and 0 for the span attribute. ` +
    `The tier is cheap on a counter of its own, and an attribute multiplies the counter that carries it. ` +
    `Putting the tier on the requests counter instead would multiply it: ${times('route', 'status', 'tier')} = ${n(ROUTE_STATUS_TIER)}. ` +
    'Put the route template and the tier on the metrics, where a bounded set of values is what aggregation needs, and the user id on the span, where one value for each request is what a span is for. ' +
    'Spans have their own volume and cost, which this budget does not count.',
};

// Step 4: the Dash0 tie-in. `why` follows "Right." or "Not quite.".
const DASH0 = [
  {
    key: 'fix-source',
    label: 'Stop emitting the attribute at the source. A spam filter drops whole data points at ingestion, before they are stored, but it cannot remove one attribute and keep the rest',
    right: true,
    why: 'The tree map shows which metric is large, and its sidebar shows the attributes behind it. Dash0\'s guidance for random or unbounded values is to reduce them at the instrumentation layer. A spam filter matches data points and drops them before they are stored, and a drop cannot be recovered. The filtered data still passes through ingest and carries the ingest charge, so a filter cuts what is stored, not what you send. To filter before sending, you can export it as a Collector filter processor configuration.',
  },
  {
    key: 'spam-attribute',
    label: 'Add a spam filter on <code>user_id</code>: it strips that attribute and keeps the rest of each point',
    why: 'A spam filter drops the data points that match its criteria. It does not strip one attribute from a point and keep the point, so the counts you wanted would go too.',
  },
  {
    key: 'spam-free',
    label: 'Add a spam filter: dropped data is free, so the volume stops costing anything',
    why: 'Dropped data is not stored, but it still passes through SignalControl and carries the ingest charge. A spam filter reduces what is stored, not what you send.',
  },
  {
    key: 'leave',
    label: 'Leave it: a high cardinality score is only a number',
    why: 'A high score is not always a problem, but it is a prompt to ask whether all of those dimensions are needed. Here a user id is the reason for it, and nothing needs a series for every user.',
  },
];

export default {
  id: 'cardinality',
  no: '3.5',
  name: 'Cardinality',
  sub: 'Every label counts',
  icon: '\u{1F522}',
  rewardTitle: 'Series counter',
  cards: ['series-are-combinations'],
  lights: ['postgres'],
  scoring: { parMs: null },
  play: {
    prefix: 'cdn',
    steps: [
      {
        intro:
          'Kettle & Co\'s recommendations service counts the requests it serves in <code>http.server.requests</code>. ' +
          'A metric keeps one <b>series</b> for every unique combination of attribute values it has seen. ' +
          `This counter carries <code>http.request.method</code> (${VALUES.method} values), <code>http.route</code> ` +
          `(${VALUES.route} routes) and <code>http.response.status_code</code> (${VALUES.status} codes).`,
        question: 'At most how many series can this one counter have?',
        qid: 'cdn-q-combos',
        choice: { id: 'cdn-combos', choices: COMBOS },
      },
      {
        intro:
          'Then somebody adds attributes "to make the dashboards more useful". The Metric Explorer lists one sample ' +
          'series for each attribute now on the counter, with a value it carries. Some attributes stay a short, fixed ' +
          'list. Others take a new value for every URL, user or request.',
        question: 'Spot the attributes whose values never stop growing.',
        qid: 'cdn-q-spot',
        spot: SPOT,
      },
      {
        intro:
          'The team has a budget of ' +
          `${n(CAP)} series for the recommendations metrics, and four questions to keep answering. ` +
          'Every option shows its worst case: the product of the number of values of the attributes it keeps, for one ' +
          'metric. A plan costs the sum of the series of its two counters; a span attribute is not a metric series, so it costs 0.',
        question: 'Pick a setting for each of the three: keep every need and stay within the budget.',
        qid: 'cdn-q-budget',
        tradeoff: BUDGET,
      },
      {
        intro:
          'Dash0\'s Metric Explorer has a tree map that sizes every metric by its cardinality. The ' +
          '<code>recommendations.served</code> counter is a big tile since a <code>user_id</code> attribute shipped last ' +
          'quarter. Dash0 also has spam filters, which drop telemetry at ingestion.',
        question: 'What do you do about it?',
        qid: 'cdn-q-dash0',
        choice: { id: 'cdn-dash0', choices: DASH0 },
      },
    ],
    finish:
      'You can count the series a metric makes, spot the attributes that never stop growing, and keep to a budget with http.route and the user id on a span. Dash0 shows what drives volume, and a spam filter drops it at ingestion, though fixing the source comes first.',
  },
};
