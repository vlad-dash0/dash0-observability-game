// Level 8.4: Frontend / RUM. Act 8 "Operating at scale". Kettle & Co's shop now sends telemetry from the browser. In the lab the browser
// and the checkout service share an origin, the Web SDK sends the `traceparent` header, and checkout's server span has to be joined
// to the browser span that header names (Build it, `edit: ['parent']`): the fetch call, not the click that started it, and not the
// same-looking call of another visitor's trace. In production the shop, the checkout API and the OTLP endpoint are three origins, and
// two requests fail on CORS (Choice): the browser's export to the OTLP endpoint, and the checkout call that now carries `traceparent`.
// Hints are off on the Build it step (the default ladder: hints in early acts only). Nothing is sent or parsed.
// Spec: https://www.w3.org/TR/trace-context/#traceparent-header , https://opentelemetry.io/docs/languages/js/exporters/ , https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
// Dash0 docs: https://www.dash0.com/docs/dash0/monitoring/websites/website-monitoring , https://www.dash0.com/docs/dash0/monitoring/websites/correlate-sessions-backend-traces , https://www.dash0.com/docs/dash0/monitoring/websites/proxying-the-ingestion-endpoint , https://www.dash0.com/docs/dash0/monitoring/websites/understand-web-vitals
// Docs (GitHub README, not an allowed Spec host; the Collector's CORS settings): https://github.com/open-telemetry/opentelemetry-collector/blob/main/receiver/otlpreceiver/README.md#cors-cross-origin-resource-sharing
//
// Facts used (each read on the page named, 2026-11-07). W3C Trace Context: `traceparent` is `version-trace-id-parent-id-trace-flags`, and
// the parent-id is the ID of the caller's span. OpenTelemetry JS exporters page, "Usage in the Browser": a browser exporter must use
// HTTP/JSON or HTTP/protobuf; if the website and the collector are at different origins the browser might block the requests going out
// to the collector, so the collector's http receiver is given `cors` with `allowed_origins` (and `allowed_headers`, `max_age`); the page
// recommends putting a reverse proxy in front of a collector exposed to the public internet, which can set the right CORS headers. The
// Collector's OTLP receiver README (GitHub): `cors.allowed_origins` is the origins to allow requests from, and `allowed_headers` allows
// additional request headers outside the default safelist. Dash0 Correlate Sessions with Backend Traces: the Web SDK propagates trace
// context with every HTTP request to an instrumented backend by including a `traceparent` header (trace ID, the parent span ID that
// identifies the frontend request span as the parent of backend spans, trace flags), and the backend creates child spans linked to the
// frontend request span; by default trace context is sent only to same-origin requests, so a cross-origin request needs the SDK
// configured to propagate to that origin. Dash0 Proxy the Ingestion Endpoint: a proxy in front of Dash0's ingestion must handle CORS
// preflight (OPTIONS) requests and return Access-Control-Allow-* headers. Dash0 website monitoring: the Websites Explorer combines user
// behaviour, Core Web Vitals and session details; Web Vitals are LCP, INP and CLS, reported at the 75th percentile (p75).
//
// MDN, Cross-Origin Resource Sharing (CORS) (read 2026-11-08): a page can only request resources from its own origin unless the
// response from the other origin includes the right CORS headers; a cross-origin request carries an `Origin` header naming the
// page's origin, and the server opts in with `Access-Control-Allow-Origin`; for requests that can have side effects the browser
// "preflights" with an HTTP `OPTIONS` request, whose `Access-Control-Request-Headers` lists the headers the real request will carry,
// and the reply's `Access-Control-Allow-Headers` confirms which are permitted; the only request headers a script may set without
// that are the CORS-safelisted ones: `Accept`, `Accept-Language`, `Content-Language`, `Content-Type` (with extra rules) and `Range`.
// `traceparent` is not in that list, which is how the level knows it needs to be allowed.
//
// Stated as reasoning, with no source (MDN does not say it in these words): that the browser does not send the real request when a
// header it wants to send is missing from the preflight reply's allowed list; that the export request, made by the page, is a
// cross-origin request with the page's origin (MDN states this for requests in general, not for the OTLP exporter); and that the
// preflight applies to `traceparent` specifically as the Web SDK adds it. The board shows the replies as data (what each reply
// lists), so the choice reads from them. The names of the Web SDK's own cross-origin setting are not used.
//
// Invented for the game: the company, the three origins (shop.kettle.example, api.kettle.example, otlp.kettle.example), every span ID,
// trace ID, name and time on the Build it board, the other visitor's trace, and the two failing requests of the Choice.

const T1 = 'a3f1c9e25b84d4f6a9c0e1d2b3a4f5e6';
const T2 = '9d8c7b6a5f4e3d2c1b0a998877665544';
const CLICK = '1a2b3c4d5e6f7081';
const CART = '2b3c4d5e6f708192';
const PAY = '3c4d5e6f708192a3';
const SERVER = '4d5e6f708192a3b4';
const DB = '5e6f708192a3b4c5';
const CLICK2 = '6f708192a3b4c5d6';
const PAY2 = '708192a3b4c5d6e7';
const SERVER2 = '8192a3b4c5d6e7f8';
const PAY_B = '2c9d8e7f6a5b4c3d';
const STATUS = '9b8a7c6d5e4f3a2b';

const span = (traceId, spanId, service, name, kind, startMs, endMs, parentId) => ({
  spanId, traceId, name, service, kind, startMs, endMs, status: 'UNSET', attributes: {}, events: [], parentId, links: [],
});

// Checkout's server span arrived as a root. The browser span its traceparent names is the fetch call (PAY), not the click that began
// it (CLICK), not the earlier fetch of the cart (CART), not the same-looking call of the other visitor's trace (PAY2), and not the
// twin in its own trace, PAY_B: the second checkout call sent, with the same start and end as PAY, enclosing the server span the
// same way. The board labels the twins by their span id, and only the parent id in the header tells which one the server span answers.
// The waterfall lists same-start siblings by span id, so PAY_B is the upper twin row and the upper Parent button, and the later fetch
// of the order status (STATUS, which ends after the server span) sits between the twins and the server span: neither "the upper twin"
// nor "the row above the server span" is the right span.
const TREE = {
  id: 'frum-tree',
  spans: [
    span(T1, CLICK, 'shop-web', 'click Pay', 'INTERNAL', 0, 1250, null),
    span(T1, CART, 'shop-web', 'GET /cart', 'CLIENT', 20, 160, CLICK),
    span(T1, PAY_B, 'shop-web', 'POST /checkout', 'CLIENT', 205, 1195, CLICK),
    span(T1, PAY, 'shop-web', 'POST /checkout', 'CLIENT', 205, 1195, CLICK),
    span(T1, SERVER, 'checkout', 'POST /checkout', 'SERVER', 230, 1160, null),
    span(T1, STATUS, 'shop-web', 'GET /order-status', 'CLIENT', 1200, 1240, CLICK),
    span(T1, DB, 'checkout', 'INSERT orders', 'CLIENT', 300, 1100, SERVER),
    span(T2, CLICK2, 'shop-web', 'click Pay', 'INTERNAL', 150, 1300, null),
    span(T2, PAY2, 'shop-web', 'POST /checkout', 'CLIENT', 215, 1180, CLICK2),
    span(T2, SERVER2, 'checkout', 'POST /checkout', 'SERVER', 240, 1170, PAY2),
  ],
  edit: ['parent'],
  answer: { [SERVER]: { parentId: PAY } },
  helps: {}, // the help ladder's last rung (docs/M1-DESIGN.md §4.2): no helps, a Check button, no hints
};

// `why` follows "Right." or "Not quite.".
const CORS = [
  {
    key: 'page-origin-api-header',
    label: 'Allow <code>https://shop.kettle.example</code> on the OTLP endpoint, and <code>traceparent</code> in the API\'s allowed headers',
    right: true,
    why:
      'The export request is sent by the page, so its origin is <code>https://shop.kettle.example</code> and the endpoint has to allow that origin: on a Collector that is <code>allowed_origins</code> under <code>cors</code> on the HTTP receiver, or the same headers set by a reverse proxy in front of it. ' +
      'The trace context travels on the call to the API, so the reply that blocks it is the API\'s, and it is the API that has to list <code>traceparent</code>. ' +
      'Dash0\'s website monitoring then shows the sessions and their Core Web Vitals (LCP, INP and CLS, at p75), and a request links to its backend trace through the header you just followed.',
  },
  {
    key: 'page-origin-otlp-header',
    label: 'Allow <code>https://shop.kettle.example</code> on the OTLP endpoint, and <code>traceparent</code> in that endpoint\'s allowed headers',
    why: 'The origin is right. The header is not: <code>traceparent</code> is sent on the call to the checkout API, and the reply that blocks that call is the API\'s, which lists Content-Type and Authorization only. A longer list on the telemetry endpoint leaves that reply as it is, and payments keep failing.',
  },
  {
    key: 'api-origin-api-header',
    label: 'Allow <code>https://api.kettle.example</code> on the OTLP endpoint, and <code>traceparent</code> in the API\'s allowed headers',
    why: 'The header is right. The origin is not: the export request is sent by the page, so it carries the shop\'s origin, not the API\'s. The endpoint would still not allow the origin that sent it, the browser would keep blocking the export, and no browser spans would arrive.',
  },
  {
    key: 'api-origin-otlp-header',
    label: 'Allow <code>https://api.kettle.example</code> on the OTLP endpoint, and <code>traceparent</code> in that endpoint\'s allowed headers',
    why: 'Both changes land in the wrong place. The origin that has to be allowed is the page\'s, and the header has to be allowed by the API, whose reply to the preflight is the one that lacks it. Payments still fail and no browser spans arrive.',
  },
];

export default {
  id: 'frontend-rum',
  no: '8.4',
  name: 'Frontend / RUM',
  sub: 'The trace starts in the browser',
  icon: '\u{1F310}',
  rewardTitle: 'Browser tracer',
  cards: [],
  lights: ['storefront', 'api-gateway'],
  scoring: { parMs: null },
  play: {
    prefix: 'frum',
    steps: [
      {
        intro:
          '<p>A browser can produce spans too, so a trace can start at the click. In Kettle &amp; Co\'s shop, the instrumentation records a span for the click on Pay and one for each fetch call the click makes.</p>' +
          `<p>In the lab, the shop and the checkout service share an origin, and the SDK adds <code>traceparent: 00-${T1}-${PAY}-01</code> to the call.</p>` +
          '<p>The code that sends the checkout call ran twice, so two identical calls left together; the board tells them apart by the end of their span id, which each row shows.</p>' +
          '<p>Another visitor clicked Pay at the same moment, in trace <code>9d8c7b6a</code>. Checkout\'s server span for one of the two calls arrived as a root.</p>',
        question: 'Give checkout\'s server span its parent.',
        qid: 'frum-q-tree',
        build: TREE,
      },
      {
        intro:
          'In production the shop is served from <code>https://shop.kettle.example</code>, the checkout API from <code>https://api.kettle.example</code> and the telemetry endpoint from <code>https://otlp.kettle.example</code>: three origins. ' +
          'The SDK is set to send trace context to the API\'s origin; by default it sends it only to the page\'s own origin. The API already allows the shop\'s origin, <code>https://shop.kettle.example</code>. Since then, two requests fail. ' +
          'The SDK\'s export <code>POST https://otlp.kettle.example/v1/traces</code> is blocked: the reply has no <code>Access-Control-Allow-Origin</code> header, and no browser spans reach Dash0. ' +
          'Before the checkout call to <code>https://api.kettle.example</code>, the browser asks whether it may send the header <code>traceparent</code>. ' +
          'The reply lists <code>Access-Control-Allow-Headers: Content-Type, Authorization</code>, so the browser does not send the call, and the payment fails.',
        question: 'Which change makes both work?',
        qid: 'frum-q-cors',
        choice: { id: 'frum-cors', choices: CORS },
      },
    ],
    finish:
      'A trace can start in the browser: the traceparent header names the browser span that made the call, and the backend span becomes its child. Across origins, the browser decides what may be sent: the telemetry endpoint must allow the page\'s origin, and the API must allow the traceparent header.',
  },
};
