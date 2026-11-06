// Level 8.2: Semantic convention versions. Act 8 "Operating at scale". Kettle & Co's checkout upgraded its instrumentation and
// runs with OTEL_SEMCONV_STABILITY_OPT_IN=http/dup, so its HTTP spans carry the old attribute names and the stable ones side by side.
// The player reads eight attributes of one server span and spots the three old names that stop arriving when the opt-in goes to
// `http` (Spot it), then answers what has to happen first (Choice): move every query, alert and dashboard to the stable names, then
// switch. Hints are off (the default ladder: hints in early acts only).
// Spec: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/ , https://opentelemetry.io/docs/specs/semconv/http/http-spans/
// Dash0 docs: https://www.dash0.com/docs/dash0/dashboards/reference-drilldown-filter-translation
//
// Facts used (each read on the pages above, 2026-11-05): the migration page maps `http.method` to `http.request.method`,
// `http.status_code` to `http.response.status_code`, `net.host.port` to `server.port` on server spans, and `http.target` to `url.path`
// plus `url.query`; `http.route` is "No change". `OTEL_SEMCONV_STABILITY_OPT_IN` accepts `http` (emit the stable conventions and stop
// emitting the old ones the instrumentation emitted before) and `http/dup` (emit both, for a phased rollout); `client.port` is an opt-in
// attribute of server spans (the port of the client that sent the request). Dash0 page: its drilldown filter translation page says a chart's PromQL filters and series labels are
// OpenTelemetry attributes (`service.name`, `http.response.status_code`), written with underscores in PromQL (`service_name`). Not
// claimed: that Dash0 reads both the old and the stable names, or that anything keeps working in Dash0 after the switch.
//
// Invented for the game: the company, the checkout service, the eight values on the span (POST, /checkout, 500, 8443, 51234) and the
// scenario of the week-ahead switch. Each attribute is shown as `key=value`.

const SPOT = {
  id: 'scv-spot',
  target: 'span',
  helps: { hints: false },
  lines: [
    { id: 'http-method', text: 'http.method=POST' },
    { id: 'client-port', text: 'client.port=51234' },
    { id: 'request-method', text: 'http.request.method=POST' },
    { id: 'server-port', text: 'server.port=8443' },
    { id: 'http-status-code', text: 'http.status_code=500' },
    { id: 'route', text: 'http.route=/checkout' },
    { id: 'response-status-code', text: 'http.response.status_code=500' },
    { id: 'net-host-port', text: 'net.host.port=8443' },
  ],
  faults: ['http-method', 'http-status-code', 'net-host-port'],
  whyNot: {
    'client-port': 'Not an old name: the port of the client that sent the request, which the opt-in does not touch.',
    'request-method': 'The stable name for the request method; it stays when the opt-in is <code>http</code>.',
    'server-port': 'The stable name for the port the request was addressed to, from the Host header.',
    route: 'Unchanged: <code>http.route</code> keeps its name with either opt-in, so it stays. Not every name that looks old has changed.',
    'response-status-code': 'The stable name for the response status code.',
  },
  explain:
    'Those three are the old names: <code>http.method</code>, <code>http.status_code</code> and <code>net.host.port</code>. ' +
    'With <code>OTEL_SEMCONV_STABILITY_OPT_IN=http/dup</code> the instrumentation sends the old and the stable names side by side; ' +
    'with <code>http</code> it sends only the stable ones, and the three old names stop arriving. <code>http.route</code> did not change.',
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
      'In Dash0, a chart\'s PromQL filters name OpenTelemetry attributes, with the dots written as underscores (<code>service.name</code> is <code>service_name</code>), so check your charts for the old names too.',
  },
  {
    key: 'keep-dup',
    label: 'Keep <code>http/dup</code> on for good, so no query, dashboard or alert has to change',
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
          'OpenTelemetry\'s HTTP semantic conventions went stable with new names: <code>http.target</code> became <code>url.path</code> plus <code>url.query</code>. ' +
          'Kettle &amp; Co\'s checkout upgraded its instrumentation and set <code>OTEL_SEMCONV_STABILITY_OPT_IN=http/dup</code>, so its HTTP spans carry the old and the stable names side by side. ' +
          'Next week the team sets it to <code>http</code>, which sends the stable names only. Here are eight attributes from one checkout server span. Each line is one attribute, as key=value.',
        question: 'Spot the attributes that stop arriving once the opt-in is set to http.',
        qid: 'scv-q-spot',
        spot: SPOT,
      },
      {
        intro: 'The team is ready to set the opt-in to <code>http</code>. While <code>http/dup</code> is on, this span carries 3 extra attributes, the old names.',
        question: 'What has to happen first?',
        qid: 'scv-q-switch',
        choice: { id: 'scv-switch', choices: SWITCH },
      },
    ],
    finish:
      'Semantic convention names change as they go stable. Send both names with http/dup, move every query, dashboard and alert to the stable names, then set the opt-in to http.',
  },
};
