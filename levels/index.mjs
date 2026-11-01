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
import contextPropagation from './context-propagation.mjs';
import correlation from './correlation.mjs';
import detectorsAndKubernetes from './detectors-and-kubernetes.mjs';
import distributions from './distributions.mjs';
import eventsAndLinks from './events-and-links.mjs';
import histograms from './histograms.mjs';
import instruments from './instruments.mjs';
import monitoringVsObservability from './monitoring-vs-observability.mjs';
import namingYourService from './naming-your-service.mjs';
import orderMatters from './order-matters.mjs';
import otlpEndpoints from './otlp-endpoints.mjs';
import ottlAndTransforms from './ottl-and-transforms.mjs';
import pipelines from './pipelines.mjs';
import promqlBasics from './promql-basics.mjs';
import resources from './resources.mjs';
import redAndUse from './red-and-use.mjs';
import spanKinds from './span-kinds.mjs';
import spansAndTraces from './spans-and-traces.mjs';
import statusAndErrors from './status-and-errors.mjs';
import structuredLogs from './structured-logs.mjs';
import temporality from './temporality.mjs';
import the3amErrors from './the-3am-errors.mjs';
import thePager from './the-pager.mjs';
import theSignals from './the-signals.mjs';
import whyOpentelemetry from './why-opentelemetry.mjs';

export const ACTS = [
  {
    id: 'act-0',
    no: 0,
    name: 'Orientation',
    sub: 'Day one',
    levels: [monitoringVsObservability, theSignals, whyOpentelemetry],
    boss: thePager,
  },
  {
    id: 'act-1',
    no: 1,
    name: 'Resources and identity',
    sub: 'Who is talking?',
    levels: [resources, namingYourService, detectorsAndKubernetes],
    boss: null,
  },
  {
    id: 'act-2',
    no: 2,
    name: 'Traces',
    sub: 'Follow the request',
    levels: [spansAndTraces, spanKinds, statusAndErrors, contextPropagation, baggage, eventsAndLinks, autoVsManual],
    boss: checkoutIsSlow,
  },
  {
    id: 'act-3',
    no: 3,
    name: 'Metrics',
    sub: 'How much, how often',
    levels: [instruments, temporality, histograms, promqlBasics, cardinality, redAndUse],
    boss: null,
  },
  {
    id: 'act-4',
    no: 4,
    name: 'Logs',
    sub: 'What did it say?',
    levels: [structuredLogs, correlation, collectingLogs],
    boss: the3amErrors,
  },
  {
    id: 'act-5',
    no: 5,
    name: 'The Collector',
    sub: 'The plumbing',
    levels: [pipelines, orderMatters, otlpEndpoints, agentVsGateway, ottlAndTransforms, distributions],
    boss: null,
  },
];
