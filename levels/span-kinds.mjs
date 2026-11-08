// Level 2.2: Span kinds. Every span of a checkout came out INTERNAL, so the service map
// has no edges. The player gives each span its kind in Build it and watches the "Map
// edges" line (from serviceEdges) fill in, then says what one wrong kind would cost.
// Spec: docs/M1-DESIGN.md §6 Act 2.
// Spec: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
import { actions, feedback, finishButton, nextButton, question, setFeedback, step } from '../lib/ui/index.mjs';
import { choiceHtml, mountChoice } from '../lib/widgets/choice.mjs';
import { mountBuild, renderBuild } from '../lib/widgets/build-it-view.mjs';
import { applyState, newBuildState } from '../lib/widgets/build-it.mjs';
import { serviceEdges } from '../lib/widgets/trace.mjs';

const CHECKOUT_TRACE = 'c4e1b2a3d5f60718293a4b5c6d7e8f90';
const ORDERS_TRACE = 'a1b2c3d4e5f60718a9b0c1d2e3f40516';
const SHIPPING_TRACE = '7d3e9f1a2b4c5d6e8f9a0b1c2d3e4f50';
const CHECKOUT = '3a7f5c9e1b2d4f60';
const TOTALS = 'e8b14d2c6a9f0357';
const PAY_CALL = '6c2d8e0f4a1b3957';
const CHARGE = 'b5f3a1c7e9d20486';
const PROVIDER = '0d9e7c5b3a1f8264';
const PUBLISH = 'f1e2d3c4b5a69788';
const PROCESS = '2b4d6f8091a3c5e7';

const span = (spanId, traceId, service, name, startMs, endMs, parentId, links = []) => ({
  spanId, traceId, name, service, kind: 'INTERNAL', startMs, endMs, status: 'UNSET',
  attributes: {}, events: [], parentId, links,
});

// Step 1: every span given INTERNAL; the parents and the consumer's link are fixed. The
// publish and process spans are roots of their own traces, joined by the link. Help ladder
// (docs/M1-DESIGN.md §4.2): no queue; trace tint, instant feedback and hints on. The
// time-window guide needs parent editing, so it is off here.
const MAP = {
  id: 'kinds-map',
  spans: [
    span(CHECKOUT, CHECKOUT_TRACE, 'checkout', 'POST /checkout', 0, 120, null),
    span(PAY_CALL, CHECKOUT_TRACE, 'checkout', 'POST payments', 20, 100, CHECKOUT),
    span(CHARGE, CHECKOUT_TRACE, 'payments', 'POST /charge', 25, 95, PAY_CALL),
    span(PROVIDER, CHECKOUT_TRACE, 'payments', 'POST provider/charges', 30, 90, CHARGE),
    span(TOTALS, CHECKOUT_TRACE, 'checkout', 'compute totals', 5, 15, CHECKOUT),
    span(PUBLISH, ORDERS_TRACE, 'orders', 'orders publish', 130, 135, null),
    span(PROCESS, SHIPPING_TRACE, 'shipping', 'orders process', 150, 170, null, [PUBLISH]),
  ],
  edit: ['kind'],
  answer: {
    [CHECKOUT]: { kind: 'SERVER' },
    [PAY_CALL]: { kind: 'CLIENT' },
    [CHARGE]: { kind: 'SERVER' },
    [PROVIDER]: { kind: 'CLIENT' },
    [PUBLISH]: { kind: 'PRODUCER' },
    [PROCESS]: { kind: 'CONSUMER' },
  },
  helps: { tint: true, instant: true, hints: true },
};

// Step 2: what one wrong kind costs the map. `why` follows "Right." or "Not quite.".
const WRONG_KIND = [
  {
    key: 'nothing',
    label: 'Nothing: the map follows parent IDs',
    why: 'A parent ID says which span caused which, not which side of a call a span is on. Backends derive the edge from a CLIENT span and its SERVER child, so without the SERVER span there is no edge.',
  },
  {
    key: 'loses-edge',
    label: 'The checkout → payments edge disappears',
    right: true,
    why: 'Backends derive that edge from the CLIENT span in checkout and its SERVER child in payments. With <code>POST /charge</code> INTERNAL there is no SERVER span to pair with, so the edge is gone, though the call still happened.',
  },
  {
    key: 'provider',
    label: 'The payments → provider edge disappears instead',
    why: 'That edge was never drawn: the provider sends no spans, so <code>POST provider/charges</code> has no SERVER child to pair with. The edge that goes is checkout → payments.',
  },
];

/** The level's answer tables, in play order (pinned by test/act-2.test.mjs). */
export const CONTENT = {
  steps: [{ build: MAP }, { id: 'kinds', choices: WRONG_KIND }],
};

/** "Map edges: a → b, c → d." for `spans`, from serviceEdges (service names escaped). */
function edgesLine(spans, e) {
  const edges = serviceEdges(spans).map((x) => `${e(x.from)} → ${e(x.to)}`);
  return `Map edges: ${edges.length ? edges.join(', ') : 'none'}.`;
}

export default {
  id: 'span-kinds',
  no: '2.2',
  name: 'Span kinds',
  sub: 'Which side of the call?',
  icon: '\u{1F500}',
  rewardTitle: 'Map maker',
  mechanics: ['build'],
  widgets: ['build', 'choice'],
  cards: ['span-kind-edges'],
  lights: ['payments'],
  scoring: { parMs: null },
  run(ctx) {
    const bar = ctx.ovActions;
    const e = ctx.escapeHtml;

    const stepMap = () => {
      ctx.renderStep(
        step({
          wide: true,
          bodyHtml: `${ctx.speech(
          'Every span from this checkout came out INTERNAL, so the service map shows no ' +
            'edges. Backends derive the edges between services from span kinds: CLIENT calls ' +
            'out and SERVER handles the call; PRODUCER sends a message and CONSUMER processes it.',
          )}${question({ html: 'Give each span its kind.' })}${renderBuild(MAP, newBuildState(MAP), { escapeHtml: e })}${feedback({ id: 'kinds-edges' })}`,
        }),
        actions({ wide: true, buttonsHtml: nextButton('kinds-next') }),
      );
      const next = bar.querySelector('#kinds-next');
      const line = ctx.ovBody.querySelector('#kinds-edges');
      setFeedback(line, 'neutral', edgesLine(MAP.spans, e));
      mountBuild(ctx, MAP, {
        onComplete: () => {
          // The check passed, so every kind is the answer's: draw the map from it.
          const right = newBuildState(MAP);
          for (const [id, want] of Object.entries(MAP.answer)) right.spans[id].kind = want.kind;
          setFeedback(line, 'neutral', edgesLine(applyState(MAP, right), e));
          next.disabled = false;
          return next;
        },
      });
      next.onclick = stepWrongKind;
    };

    const stepWrongKind = () => {
      ctx.renderStep(
        step({
          wide: false,
          bodyHtml: `${ctx.speech(
          'A teammate wonders whether kinds matter, and suggests leaving payments\' ' +
            '<code>POST /charge</code> as INTERNAL.',
          )}${question({ id: 'kinds-q', html: 'What happens to the map if <code>POST /charge</code> is INTERNAL?' })}${choiceHtml(ctx, WRONG_KIND, { id: 'kinds', labelledBy: 'kinds-q' })}`,
        }),
        actions({ wide: false, buttonsHtml: finishButton('kinds-finish') }),
      );
      const finish = bar.querySelector('#kinds-finish');
      mountChoice(ctx, WRONG_KIND, {
        id: 'kinds',
        onRight: () => {
          finish.disabled = false;
          return finish;
        },
      });
      finish.onclick = () =>
        ctx.finish({
          text: 'Your spans say which side of each call they are on, so the service map can draw its edges.',
          cards: ['span-kind-edges'],
        });
    };

    stepMap();
  },
};
