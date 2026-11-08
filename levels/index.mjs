// The ordered level registry: acts in unlock order, each with its levels in play
// order and an optional boss. lib/registry.mjs buildRegistry validates and freezes
// it; act and kind come from the position here (docs/FOUNDATION.md §2.1-2.2).
//
// TO ADD A LEVEL: one file, one line here, one answer line (or one driver).
//   1. levels/<id>.mjs default-exports { id, no, name, sub?, icon, rewardTitle, cards?,
//      lights?, scored?, scoring?, ... } and one of two modes; never `act` or `kind`:
//      - declarative: `play: { prefix?, steps: [...], finish }` (choice, sort, build and
//        incident steps; docs/DECLARATIVE-LEVELS.md §2). `mechanics` is derived; leave it out.
//        Spec URLs stay as `// Spec: <https URL>` comment lines.
//      - hand-written: `mechanics` and `run(ctx)`, for anything that needs a function. Wire
//        buttons with `el.onclick = ...` after ctx.renderStep (CSP), give the Finish button
//        `data-finish`, and skip timers when ctx.reduceMotion.
//   2. Import it here and add it to an act's `levels` (or as its `boss`). New cards
//      go in cards/deck.mjs; `lights` names node ids from the map.
//   3. Declarative: add ANSWERS['<id>'] (one line per step) in test/answers.test.mjs; the
//      generated suites (test/play.test.mjs, levels-play) cover the rest. Hand-written: add
//      DRIVERS['<id>'] (happy and sloppy runs) in test/levels-play.test.mjs.
//
// Act: { id, no, name, sub, levels: [level, ...], boss: level | null }.
import agentVsGateway from './agent-vs-gateway.mjs';
import autoVsManual from './auto-vs-manual.mjs';
import baggage from './baggage.mjs';
import cardinality from './cardinality.mjs';
import checkoutIsSlow from './checkout-is-slow.mjs';
import collectingLogs from './collecting-logs.mjs';
import connectToDash0 from './connect-to-dash0.mjs';
import contextPropagation from './context-propagation.mjs';
import correlation from './correlation.mjs';
import detectorsAndKubernetes from './detectors-and-kubernetes.mjs';
import distributions from './distributions.mjs';
import errorsTripled from './errors-tripled.mjs';
import eventsAndLinks from './events-and-links.mjs';
import exemplars from './exemplars.mjs';
import goodAlerts from './good-alerts.mjs';
import headSampling from './head-sampling.mjs';
import histograms from './histograms.mjs';
import instruments from './instruments.mjs';
import itsUs from './its-us.mjs';
import monitoringVsObservability from './monitoring-vs-observability.mjs';
import namingYourService from './naming-your-service.mjs';
import orderMatters from './order-matters.mjs';
import otlpEndpoints from './otlp-endpoints.mjs';
import ottlAndTransforms from './ottl-and-transforms.mjs';
import pipelines from './pipelines.mjs';
import promqlBasics from './promql-basics.mjs';
import resources from './resources.mjs';
import redAndUse from './red-and-use.mjs';
import silence from './silence.mjs';
import slisAndSlos from './slis-and-slos.mjs';
import burnRateAlerts from './burn-rate-alerts.mjs';
import syntheticChecks from './synthetic-checks.mjs';
import semanticConventionVersions from './semantic-convention-versions.mjs';
import spanKinds from './span-kinds.mjs';
import spansAndTraces from './spans-and-traces.mjs';
import statusAndErrors from './status-and-errors.mjs';
import structuredLogs from './structured-logs.mjs';
import tailSampling from './tail-sampling.mjs';
import temporality from './temporality.mjs';
import filterOrSampler from './filter-or-sampler.mjs';
import the34PercentErrorRate from './the-34-percent-error-rate.mjs';
import the3amErrors from './the-3am-errors.mjs';
import theBill from './the-bill.mjs';
import thePager from './the-pager.mjs';
import theSignals from './the-signals.mjs';
import whatCostsMoney from './what-costs-money.mjs';
import whoIsTalking from './who-is-talking.mjs';
import whyOpentelemetry from './why-opentelemetry.mjs';

export const ACTS = [
  {
    id: 'act-0',
    no: 0,
    name: 'Orientation',
    sub: 'Day one',
    teaser: 'Monitoring vs observability, the four signals, why OpenTelemetry exists, and your first page.',
    levels: [monitoringVsObservability, theSignals, whyOpentelemetry],
    boss: thePager,
  },
  {
    id: 'act-1',
    no: 1,
    name: 'Resources and identity',
    sub: 'Who is talking?',
    teaser: 'Say who is talking: resource attributes, service names, detectors and Kubernetes metadata.',
    levels: [resources, namingYourService, detectorsAndKubernetes],
    boss: whoIsTalking,
  },
  {
    id: 'act-2',
    no: 2,
    name: 'Traces',
    sub: 'Follow the request',
    teaser: 'Follow a request: spans, traces, span kinds, status, context propagation, baggage, events, links and auto vs manual instrumentation.',
    levels: [spansAndTraces, spanKinds, statusAndErrors, contextPropagation, baggage, eventsAndLinks, autoVsManual],
    boss: checkoutIsSlow,
  },
  {
    id: 'act-3',
    no: 3,
    name: 'Metrics',
    sub: 'How much, how often',
    teaser: 'Measure with metrics: instruments, temporality, histograms, PromQL, cardinality, exemplars, and the RED and USE methods.',
    levels: [instruments, temporality, histograms, promqlBasics, cardinality, exemplars, redAndUse],
    boss: theBill,
  },
  {
    id: 'act-4',
    no: 4,
    name: 'Logs',
    sub: 'What did it say?',
    teaser: 'Make logs useful: structured logs, correlating them with traces, and collecting them.',
    levels: [structuredLogs, correlation, collectingLogs],
    boss: the3amErrors,
  },
  {
    id: 'act-5',
    no: 5,
    name: 'The Collector',
    sub: 'The plumbing',
    teaser: 'Run the Collector: pipelines, processor order, OTLP endpoints, agent or gateway, OTTL and distributions.',
    levels: [pipelines, orderMatters, otlpEndpoints, agentVsGateway, ottlAndTransforms, distributions],
    boss: silence,
  },
  {
    id: 'act-6',
    no: 6,
    name: 'Sampling and cost',
    sub: 'You can\'t keep everything',
    teaser: 'Keep what matters: head sampling, tail sampling, and what costs money.',
    levels: [headSampling, tailSampling, whatCostsMoney],
    boss: errorsTripled,
  },
  {
    id: 'act-7',
    no: 7,
    name: 'Alerting and SLOs',
    sub: 'Wake me only when it matters',
    badges: ['dash0'],
    teaser: 'Good alerts, SLOs and error budgets, burn-rate alerts and synthetic checks.',
    levels: [goodAlerts, slisAndSlos, burnRateAlerts, syntheticChecks],
    boss: null,
  },
  {
    id: 'act-8',
    no: 8,
    name: 'Operating at scale',
    sub: 'As code',
    badges: ['dash0'],
    teaser:
      'Dashboards as code, semantic convention upgrades, migrating vendors, browser telemetry and AI-assisted debugging.',
    levels: [semanticConventionVersions],
    boss: null,
  },
  {
    id: 'act-9',
    no: 9,
    name: 'Live Demo',
    sub: 'Does that answer hold?',
    badges: ['customer-calls'],
    teaser: 'Judge confident answers about filters and error rates, connect the game to a Dash0 (practice works without an account), then find its incident in a trace view.',
    levels: [filterOrSampler, the34PercentErrorRate, connectToDash0],
    boss: itsUs,
  },
];
