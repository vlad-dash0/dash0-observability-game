// Level 8.5: AI-assisted debugging. Act 8 "Operating at scale". Checkout fails for about 1 order in 11 at the last step, and an AGENT runs
// the queries: each view shows the query the agent ran and what came back. The agent is simulated, an authored view per query: no
// model is called and no real MCP server is reached, and the copy says so. Three clues hold the chain (the failures are spread over
// both versions of checkout, so it is not the release; a failing trace ends at a 503 from the inventory service, before any payment
// call; the request rate never moved, so it is not a surge). Four views are neutral; two are red herrings (the release list and the
// card charge times, which point at the release and at the payment provider). The nuance is a neutral view, not a herring: the agent's
// failed-requests query used a legacy attribute name (`http.status_code`, the old name 8.2 teaches) and got 0 spans, which tempts "nothing is
// failing". Looking at it costs no penalty. Step 2 puts it beside the versions query (same window and service, the stable name
// `http.response.status_code`, 984 failed) and asks WHY it found nothing: the closing Choice grades the nuance.
// Agents need good semantic conventions as much as people do. Scored. A plain-data Scenario for the incident engine, played through
// one declarative `incident` step (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3, docs/DECLARATIVE-LEVELS.md §2), then one
// closing Choice on why the failed-requests query found nothing, which the incident step does not grade.
// The scenario is designed for this game (issue #138).
// Spec: https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/
// Dash0 docs: https://www.dash0.com/docs/dash0/ai/mcp , https://www.dash0.com/docs/dash0/ai/agent0/overview , https://www.dash0.com/docs/dash0/ai/agent0/overview/use-agent0/query-telemetry-via-mcp
//
// Facts used (each read on the page named, 2026-11-07). The old-to-stable pair is the one level 8.2 uses (HTTP migration page):
// `http.status_code` became `http.response.status_code`; `OTEL_SEMCONV_STABILITY_OPT_IN=http` emits the stable conventions and
// stops emitting the old ones the instrumentation emitted before, and `http/dup` emits both. Dash0 "About the Dash0 MCP Server": it
// lets AI assistants such as Claude, Claude Code and Cursor query your Dash0 data through read-only tools, over the Model Context
// Protocol. Dash0 "Agent0 overview": Agent0 reads your telemetry directly, in the OpenTelemetry semantic conventions it was produced
// in. Dash0 "Query Telemetry via MCP": the direct tools take `filters` of `key`, `operator` and `value`, and the keys to filter on
// are discovered with `getAttributeKeys`, which lists the attribute keys present in a kind of telemetry over a time range.
// Not claimed: how any agent turns a question into a query, that an agent "learns" a name, what Agent0 does when a filter matches
// nothing, anything about cost or credits, or that the query and result shapes below are the ones the tools print.
//
// Invented for the game: the company and its checkout, the services and pods, every time and count in the TABLE, the six-pod split of
// two versions, the traces and what they hold, the order in which checkout calls inventory and payment, and the query and result
// shapes the simulated agent prints (they are not the output of any tool).

const fmt = (n) => n.toLocaleString('en-US');

/** The one table every figure in the views and the answers comes from. */
export const TABLE = {
  releaseAt: '09:40', // checkout 2.14.0 goes live on 3 of its 6 pods
  failuresFrom: '10:12',
  ruleFiredAt: '10:27', // 15 minutes above 5% after the failures start
  queryAt: '10:36', // the agent's queries run until here
  // Card charges, 95th percentile in ms (the card charge times view, a herring: failing orders never reach a charge).
  charges: [
    { at: '09:50', p95Ms: 410 },
    { at: '10:12', p95Ms: 430 },
    { at: '10:30', p95Ms: 520 },
  ],
  beforeMin: 32, // 09:40 to 10:12
  afterMin: 24, // 10:12 to 10:36
  // One row per version: requests and failed requests before and after 10:12, 225 requests a minute each.
  versions: [
    { v: '2.13.4', beforeRequests: 7200, beforeErrors: 8, afterRequests: 5400, afterErrors: 492 },
    { v: '2.14.0', beforeRequests: 7200, beforeErrors: 7, afterRequests: 5400, afterErrors: 492 },
  ],
  // Requests a minute to POST /checkout, both versions together.
  rate: [
    { at: '09:50', perMin: 448 },
    { at: '10:10', perMin: 452 },
    { at: '10:12', perMin: 449 },
    { at: '10:30', perMin: 451 },
  ],
  errorRatioRulePct: 5,
  sampledTraces: 20,
  services: 23,
  nodes: 9,
};

const per1000 = (errors, requests) => ((errors / requests) * 1000).toFixed(1);
const failedAfter = TABLE.versions.reduce((n, x) => n + x.afterErrors, 0); // 984
const requestsAfter = TABLE.versions.reduce((n, x) => n + x.afterRequests, 0); // 10,800
const pctAfter = ((failedAfter / requestsAfter) * 100).toFixed(1); // 9.1
const [OLD, NEW] = TABLE.versions;

const row = (cells) => `<tr><th scope="row">${cells[0]}</th>${cells.slice(1).map((c) => `<td>${c}</td>`).join('')}</tr>`;

const VERSIONS_VIEW =
  `<p>The agent was asked how the failed checkout requests of the last hour are spread over the versions. Version ${NEW.v} went live on 3 of the 6 pods at ${TABLE.releaseAt}.</p>` +
  '<pre><code>spans where service.name = checkout and http.response.status_code = 500\n' +
  `group by service.version, ${TABLE.releaseAt} to ${TABLE.failuresFrom} and ${TABLE.failuresFrom} to ${TABLE.queryAt}</code></pre>` +
  '<table><caption>Failed requests per 1,000 requests</caption>' +
  `<thead><tr><th scope="col">Version</th><th scope="col">${TABLE.releaseAt} to ${TABLE.failuresFrom}</th><th scope="col">${TABLE.failuresFrom} to ${TABLE.queryAt}</th></tr></thead>` +
  `<tbody>${[OLD, NEW].map((x) => row([x.v, per1000(x.beforeErrors, x.beforeRequests), per1000(x.afterErrors, x.afterRequests)])).join('')}</tbody></table>` +
  `<p>Both versions fail at the same rate from ${TABLE.failuresFrom}: from ${TABLE.failuresFrom} to ${TABLE.queryAt} each version had ${fmt(OLD.afterErrors)} failed requests, ${fmt(failedAfter)} failed in all. The version that went live at ${TABLE.releaseAt} ran ${TABLE.beforeMin} minutes before that at the rate of the one that did not change.</p>`;

const TRACE_VIEW =
  `<p>The agent opened one of the ${TABLE.sampledTraces} failing traces it found since ${TABLE.failuresFrom}; all ${TABLE.sampledTraces} end the same way. Checkout reserves stock first and takes the payment after.</p>` +
  '<pre><code>POST /checkout   SERVER  500  1842 ms\n' +
  '  POST           CLIENT  503  1790 ms  server.address=inventory.kettle.example</code></pre>' +
  '<p>No span in the trace calls the payment provider.</p>';

const RATE_VIEW =
  '<p>The agent was asked how many requests a minute checkout took in the last hour, and whether that changed.</p>' +
  '<table><caption>Requests a minute to POST /checkout</caption>' +
  '<thead><tr><th scope="col">Time</th><th scope="col">Requests a minute</th></tr></thead>' +
  `<tbody>${TABLE.rate.map((x) => row([x.at, fmt(x.perMin)])).join('')}</tbody></table>` +
  `<p>The rate did not change at ${TABLE.failuresFrom} or since.</p>`;

const RULE_VIEW =
  `<p>The agent read the rule that paged you: checkout error ratio above ${TABLE.errorRatioRulePct}% for 15 minutes. ` +
  `It has been firing since ${TABLE.ruleFiredAt}. The ratio since ${TABLE.failuresFrom} is ${pctAfter}%.</p>`;

const NODES_VIEW = `<p>${TABLE.nodes} of ${TABLE.nodes} nodes in the checkout pool are Ready.</p>`;

const SERVICES_VIEW =
  `<p>The agent listed the ${TABLE.services} services that sent data in the last 10 minutes, among them checkout, inventory, payments and recommendations. ` +
  'Every one of them sent data in the last minute.</p>';

const LEGACY_VIEW =
  `<p>The agent was asked how many checkout requests failed from ${TABLE.failuresFrom} to ${TABLE.queryAt}.</p>` +
  '<pre><code>spans where service.name = checkout and http.status_code = 500\n' +
  'result: 0 spans</code></pre>' +
  `<p>The agent's answer: no failed checkout requests from ${TABLE.failuresFrom} to ${TABLE.queryAt}.</p>`;

const CHANGES_VIEW =
  '<p>The agent was asked what changed in the last hour.</p>' +
  '<table><caption>Changes in the last hour</caption>' +
  '<thead><tr><th scope="col">Time</th><th scope="col">Service</th><th scope="col">Change</th></tr></thead>' +
  '<tbody>' +
  `<tr><th scope="row">${TABLE.releaseAt}</th><td>checkout</td><td>release ${NEW.v} on 3 of 6 pods</td></tr>` +
  '<tr><th scope="row">10:10</th><td>recommendations</td><td>release 5.2.0</td></tr>' +
  '</tbody></table>' +
  `<p>The agent lists recommendations 5.2.0 as the change closest to ${TABLE.failuresFrom}. It does not say whether checkout calls that service.</p>`;

const CHARGES_VIEW =
  '<p>The agent was asked how long card charges took in the last hour.</p>' +
  '<table><caption>Card charge time, 95th percentile</caption>' +
  '<thead><tr><th scope="col">Time</th><th scope="col">Milliseconds</th></tr></thead>' +
  `<tbody>${TABLE.charges.map((x) => row([x.at, fmt(x.p95Ms)])).join('')}</tbody></table>` +
  `<p>The slowest charges got slower after ${TABLE.failuresFrom}. The agent does not say whether the failing orders reached a charge.</p>`;

const SCENARIO = {
  id: 'ai-assisted-debugging',
  alert: {
    title: 'Checkout failing at the last step',
    html:
      `<p>PAGE ${TABLE.ruleFiredAt}: the checkout error ratio rule is firing, and customers report that their order fails at the last step. ` +
      'An agent has read access to the telemetry and runs the queries you pick. The agent is simulated: no model is called and no real MCP server is reached. ' +
      'Each view is a query it ran and what came back, written for the game.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 5 },
  views: [
    { id: 'failures-by-version', label: 'Agent: failures by version, last hour', costMin: 4, kind: 'clue', html: VERSIONS_VIEW },
    { id: 'failing-trace', label: 'Agent: one failing trace', costMin: 4, kind: 'clue', html: TRACE_VIEW },
    { id: 'request-rate', label: 'Agent: requests a minute, last hour', costMin: 3, kind: 'clue', html: RATE_VIEW },
    { id: 'alert-rule', label: 'Agent: the rule that paged', costMin: 2, kind: 'neutral', html: RULE_VIEW },
    { id: 'node-status', label: 'Agent: node status', costMin: 3, kind: 'neutral', html: NODES_VIEW },
    { id: 'service-list', label: 'Agent: services sending data, last 10 minutes', costMin: 2, kind: 'neutral', html: SERVICES_VIEW },
    { id: 'failed-requests', label: `Agent: failed requests, ${TABLE.failuresFrom} to ${TABLE.queryAt}`, costMin: 1, kind: 'neutral', html: LEGACY_VIEW },
    { id: 'recent-changes', label: 'Agent: changes in the last hour', costMin: 4, kind: 'herring', html: CHANGES_VIEW },
    { id: 'card-charges', label: 'Agent: card charge times, last hour', costMin: 3, kind: 'herring', html: CHARGES_VIEW },
  ],
  hypotheses: [
    {
      id: 'inventory-failing',
      label: 'Checkout\'s stock reservations at the inventory service are failing, and checkout returns them as 500s',
      right: true,
      why:
        `The failing trace shows checkout's call to inventory.kettle.example returning 503 and checkout answering 500, with no payment call after it. The failures begin at ${TABLE.failuresFrom} on both versions, ` +
        `${per1000(OLD.afterErrors, OLD.afterRequests)} per 1,000 requests each, so it is not the ${TABLE.releaseAt} release, and the request rate stayed near ${fmt(TABLE.rate[0].perMin)} a minute.`,
    },
    {
      id: 'bad-release',
      label: 'The checkout release that went out this morning, version 2.14.0, has a bug that fails some customer orders',
      right: false,
      why:
        `Both versions fail at the same rate from ${TABLE.failuresFrom}: ${per1000(OLD.afterErrors, OLD.afterRequests)} per 1,000 requests for ${OLD.v}, which did not change, and ${per1000(NEW.afterErrors, NEW.afterRequests)} for ${NEW.v}. ` +
        `And ${NEW.v} ran from ${TABLE.releaseAt} to ${TABLE.failuresFrom} at ${per1000(NEW.beforeErrors, NEW.beforeRequests)} per 1,000, about the ${per1000(OLD.beforeErrors, OLD.beforeRequests)} of ${OLD.v}. A bug in the new release would not fail the old one.`,
    },
    {
      id: 'payment-timeouts',
      label: 'The payment provider is timing out on card charges, and checkout returns those failures as 500s',
      right: false,
      why: 'Checkout reserves stock before it takes payment, and the failing trace ends at the stock reservation: no span in it calls the payment provider, so a slow charge cannot be what fails these orders.',
    },
    {
      id: 'order-surge',
      label: 'A surge of orders at the shop overloaded checkout, so some of its requests fail under the load',
      right: false,
      why: `The request rate was ${fmt(TABLE.rate[0].perMin)} a minute at ${TABLE.rate[0].at}, ${fmt(TABLE.rate[2].perMin)} at ${TABLE.rate[2].at} and ${fmt(TABLE.rate[3].perMin)} at ${TABLE.rate[3].at}. Nothing changed when the failures began, so there was no surge.`,
    },
  ],
  answerAfterViews: 3,
  hint:
    '<p>A cause has to explain where the failing requests stop and whether the release explains the failures. Which cause fits what the views show?</p>',
};

// Step 2: why the agent's failed-requests query found nothing. Both queries share the window (10:12 to 10:36) and the service, so only the
// attribute name differs on screen, and the labels are all about the name: only knowing the 8.2 migration pair separates them.
// `why` follows "Right." or "Not quite.".
const WINDOW = `${TABLE.failuresFrom} to ${TABLE.queryAt}`;
const WHY_EMPTY = [
  {
    key: 'old-name',
    label: 'The query used the name the status code had before the HTTP conventions went stable',
    right: true,
    why:
      `The failed-requests query asks for http.status_code, the name before the HTTP conventions went stable. Checkout sends http.response.status_code now (its opt-in is http, level 8.2), so the old name matches nothing even while orders fail: the versions query, on the same spans and the same window, counted ${fmt(failedAfter)} failed from ${WINDOW}. ` +
      'Use the names the spans carry. In Dash0, Agent0 reads telemetry in the OpenTelemetry semantic conventions it was produced in, and getAttributeKeys, one of the tools of the Dash0 MCP Server, lists the attribute keys present, so check the keys present before you ask for a name.',
  },
  {
    key: 'invented-name',
    label: 'The agent made up an attribute name for the status code that OpenTelemetry does not list',
    why: 'http.status_code was a real OpenTelemetry name: it is the name the HTTP conventions used before http.response.status_code replaced it (the migration pair of level 8.2). The agent did not make it up, but checkout no longer sends it.',
  },
  {
    key: 'newer-name',
    label: "The query used a newer name for the status code than checkout's instrumentation sends yet",
    why: `The direction is the other way round: http.status_code is the older name, and the 8.2 migration renamed it to http.response.status_code. Checkout's spans already carry the newer one, as the ${fmt(failedAfter)} failed from ${WINDOW} show. The empty query used the older name.`,
  },
  {
    key: 'metric-label',
    label: 'The status code is a metric label while spans store it under a different key',
    why: 'Both names are span attribute names in the HTTP conventions (the migration page renames one to the other), so spans do carry the status code as an attribute. The two queries differ by the name the migration renamed, not by metric against span.',
  },
];

export default {
  id: 'ai-assisted-debugging',
  no: '8.5',
  name: 'AI-assisted debugging',
  sub: 'The agent asks by name',
  icon: '\u{1F916}',
  rewardTitle: 'Query reader',
  cards: [],
  lights: ['checkout', 'inventory'],
  scoring: { parMs: null },
  play: {
    prefix: 'aad',
    steps: [
      {
        intro:
          'Orders are failing at the last step and you are asking an agent to run the queries. It shows each query and what came back. Find out why orders fail.',
        incident: SCENARIO,
      },
      {
        intro:
          `The incident is explained. The agent's failed-requests query answered "no failed requests", and its versions query counted ${fmt(failedAfter)} failed from ${WINDOW}. Here are the two queries, for the same window and the same service.`,
        code:
          `Failed-requests query, ${WINDOW}:\n` +
          '  spans where service.name = checkout and http.status_code = 500\n' +
          '  result: 0 spans\n\n' +
          `Versions query, the ${WINDOW} column of the step 1 versions query:\n` +
          '  spans where service.name = checkout and http.response.status_code = 500\n' +
          `  result: ${fmt(failedAfter)} failed`,
        question: "Why did the agent's failed-requests query return nothing?",
        qid: 'aad-q-why',
        choice: { id: 'aad-why', choices: WHY_EMPTY },
      },
    ],
    finish:
      'You read an empty answer as a question about a name, not as proof of health. A query on an old attribute name matches nothing, so use the names the spans carry.\n\n' +
      'In Dash0, the MCP Server lets an assistant query your telemetry with read-only tools, Agent0 reads telemetry in the OpenTelemetry semantic conventions it was produced in, and you check the keys present with getAttributeKeys on the Dash0 MCP Server before you ask for a name.',
  },
};
