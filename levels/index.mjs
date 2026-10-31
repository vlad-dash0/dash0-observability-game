// The ordered level registry: acts in unlock order, each with its levels in play
// order and an optional boss. lib/registry.mjs buildRegistry validates and freezes
// it; act and kind come from the position here (docs/FOUNDATION.md §2.1-2.2).
//
// TO ADD A LEVEL: one file, one line here, one driver.
//   1. levels/<id>.mjs default-exports { id, no, name, sub?, icon, rewardTitle,
//      mechanics, cards?, lights?, scored?, scoring?, run(ctx) }; never `act` or
//      `kind`. Wire buttons with `el.onclick = ...` after ctx.renderStep (CSP), give
//      the Finish button `data-finish`, and skip timers when ctx.reduceMotion.
//   2. Import it here and add it to an act's `levels` (or as its `boss`). New cards
//      go in cards/deck.mjs; `lights` names node ids from the map.
//   3. Add DRIVERS['<id>'] (happy and sloppy runs) in test/levels-play.test.mjs.
//
// Act: { id, no, name, sub, levels: [level, ...], boss: level | null }.
import monitoringVsObservability from './monitoring-vs-observability.mjs';
import namingYourService from './naming-your-service.mjs';
import spanKinds from './span-kinds.mjs';
import spansAndTraces from './spans-and-traces.mjs';
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
    levels: [namingYourService],
    boss: null,
  },
  {
    id: 'act-2',
    no: 2,
    name: 'Traces',
    sub: 'Follow the request',
    levels: [spansAndTraces, spanKinds],
    boss: null,
  },
];
