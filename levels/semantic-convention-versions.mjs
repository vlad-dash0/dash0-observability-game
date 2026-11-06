// Level 8.2: Semantic convention versions. Act 8 "Operating at scale". Kettle & Co's checkout upgraded its instrumentation and
// runs with OTEL_SEMCONV_STABILITY_OPT_IN=http/dup, so its HTTP spans carry the old attribute names and the stable ones side by side.
// The player reads eight attributes of one server span and spots the three old names that stop arriving when the opt-in goes to
// `http` (Spot it), then answers what has to happen first (Choice): move every query, alert and dashboard to the stable names, then
// switch. Hints are off (the default ladder: hints in early acts only).
// Spec: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/ , https://opentelemetry.io/docs/specs/semconv/http/http-spans/
// Dash0 docs: https://www.dash0.com/docs/dash0/opentelemetry/semconvs/overview
//
// Facts used (each read on the pages above, 2026-11-05): the migration page maps `http.method` to `http.request.method`,
// `http.status_code` to `http.response.status_code`, `net.host.port` to `server.port` on server spans, and `http.target` to `url.path`
// plus `url.query`; `http.route` is "No change". `OTEL_SEMCONV_STABILITY_OPT_IN` accepts `http` (emit the stable conventions and stop
// emitting the old ones the instrumentation emitted before) and `http/dup` (emit both, for a phased rollout); `http/dup` has higher
// precedence than `http` when both are set. Dash0 page: its semantic conventions page says semantic convention names appear
// throughout the Dash0 UI, in explorer filters, metric queries and dashboard variables. Not claimed: that Dash0 reads both the old and
// the stable names, or that anything keeps working in Dash0 after the switch.
//
// Invented for the game: the company, the checkout service, the eight values on the span (POST, /checkout, 500, 8443) and the
// scenario of the week-ahead switch. Each attribute is shown as `key=value`.

const SPOT = {
  id: 'scv-spot',
  target: 'span',
  helps: { hints: false },
  lines: [
    { id: 'http-method', text: 'http.method=POST' },
    { id: 'url-path', text: 'url.path=/checkout' },
    { id: 'request-method', text: 'http.request.method=POST' },
    { id: 'server-port', text: 'server.port=8443' },
    { id: 'http-status-code', text: 'http.status_code=500' },
    { id: 'route', text: 'http.route=/checkout' },
    { id: 'response-status-code', text: 'http.response.status_code=500' },
    { id: 'net-host-port', text: 'net.host.port=8443' },
  ],
  faults: ['http-method', 'http-status-code', 'net-host-port'],
  whyNot: {
    'url-path': 'The stable name. It replaced the path part of <code>http.target</code>, which also carried the query string.',
    'request-method': 'The stable name. It replaced <code>http.method</code> and stays when the opt-in is <code>http</code>.',
    'server-port': 'The stable name for the port the server listens on. It replaced <code>net.host.port</code> on server spans.',
    route: 'Unchanged: <code>http.route</code> was already the name, so it stays in both modes. Looking old is not being old.',
    'response-status-code': 'The stable name. It replaced <code>http.status_code</code>.',
  },
  explain:
    'Those three are the old names: <code>http.method</code>, <code>http.status_code</code> and <code>net.host.port</code>. ' +
    'With <code>OTEL_SEMCONV_STABILITY_OPT_IN=http/dup</code> the instrumentation sends the old and the stable names side by side; ' +
    'with <code>http</code> it sends only the stable ones, and the old three stop arriving. <code>http.route</code> did not change.',
};

const SWITCH = [
  {
    key: 'switch-now',
    label: 'Switch now: the stable names are the same data, so everything keeps working',
    why: 'The data is the same, the names are not. A query, a dashboard panel or an alert rule that filters on <code>http.method</code> matches nothing once it stops arriving, and an alert that matches nothing stays quiet.',
  },
  {
    key: 'move-queries',
    label: 'Move every query, alert and dashboard to the stable names, then switch',
    right: true,
    why:
      'While <code>http/dup</code> is on, both names arrive, so you can move each query, dashboard and alert rule to <code>http.request.method</code>, <code>http.response.status_code</code> and <code>server.port</code> and see it still returns data. ' +
      'Then set <code>OTEL_SEMCONV_STABILITY_OPT_IN=http</code> and the old names stop. ' +
      'In Dash0, semantic convention names appear in explorer filters, metric queries and dashboard variables, so those are places to check.',
  },
  {
    key: 'keep-dup',
    label: 'Keep <code>http/dup</code> for good: sending both sets of names costs nothing extra',
    why: 'Every span then carries two copies of each attribute that changed, and the old names are the ones being replaced. <code>http/dup</code> is for the move, not the end state: the opt-in is meant for migrating.',
  },
];

export default {
  id: 'semantic-convention-versions',
  no: '8.2',
  name: 'Semantic convention versions',
  sub: 'Names change',
  icon: '\u{1F4D6}',
  rewardTitle: 'Convention keeper',
  cards: [],
  lights: ['storefront'],
  scoring: { parMs: null },
  play: {
    prefix: 'scv',
    steps: [
      {
        intro:
          'OpenTelemetry\'s HTTP semantic conventions went stable with new names: <code>http.method</code> became <code>http.request.method</code>. ' +
          'Kettle &amp; Co\'s checkout upgraded its instrumentation and set <code>OTEL_SEMCONV_STABILITY_OPT_IN=http/dup</code>, so its HTTP spans carry the old and the stable names side by side. ' +
          'Next week the team sets it to <code>http</code>, which sends the stable names only. Here are eight attributes from one checkout server span.',
        question: 'Spot the attributes that stop arriving once the opt-in is set to http.',
        qid: 'scv-q-spot',
        spot: SPOT,
      },
      {
        intro: 'The team is ready to set the opt-in to <code>http</code>.',
        question: 'What has to happen first?',
        qid: 'scv-q-switch',
        choice: { id: 'scv-switch', choices: SWITCH },
      },
    ],
    finish:
      'Semantic conventions change names as they go stable. Dual-emit with http/dup, move every query, dashboard and alert to the stable names, then switch to http.',
  },
};
