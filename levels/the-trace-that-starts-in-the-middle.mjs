// Level 9.4: The trace that starts in the middle. Act 9 "Live Demo" (docs/LIVE-DEMO.md). The player hears a confident answer to a
// customer, "cart's SDK ignores the header and starts over, so its spans float loose", and says whether it holds (Choice): the
// spans of cart and payments carry web's trace ID, and their parent-ids name spans that no exporter sends, because a mesh sidecar
// between each caller and callee writes a parent-id of its own into the header and exports no span. Then the sidecars pass the header
// through unchanged, and the player rebuilds the tree the fix will give (Build it, `edit: ['parent']`): each server span joins the
// CLIENT span of the call that carried the header, not the SERVER span around it and not a parallel call. The presenter has no
// name and no affiliation.
// Source: written for the game from the Act 9 design on issue #240 (docs/LIVE-DEMO.md). Nothing below identifies a customer, a person or a product.
// Spec: https://www.w3.org/TR/trace-context/#parent-id , https://www.w3.org/TR/trace-context/#mutating-the-traceparent-field , https://opentelemetry.io/docs/concepts/context-propagation/
//
// Facts used (each read on the page named, 2026-11-08). W3C Trace Context, 3.2.2.4 parent-id: "This is the ID of this request as known
// by the caller (in some tracing systems, this is known as the span-id, where a span is the execution of a client request)."
// W3C 3.4 Mutating the traceparent Field: "A vendor receiving a traceparent request header MUST send it to outgoing requests. It MAY
// mutate the value of this header before passing it to outgoing requests." and "Unmodified header propagation is typically
// implemented in pass-through services like proxies." and, among the allowed mutations, "Update parent-id: The value of the parent-id
// field can be set to the new value representing the ID of the current operation." OpenTelemetry, Context propagation: "When Service A
// calls Service B, Service A includes a trace ID and a span ID as part of the context. Service B uses these values to create a new
// span that belongs to the same trace, setting the span from Service A as its parent."
//
// Stated as reasoning, with no source (neither page says it in these words): that a rewritten parent-id leaves a hole in the trace
// unless some exporter sends the span it names (a parent-id is only a pointer; the W3C text allows the mutation and does not say who
// must export the span); and that a mesh sidecar with tracing export off exports no span. The sidecars, their settings and the lab are invented.
//
// Invented for the game: the company, the three services (web, cart, payments), every span ID, trace ID, name and time, the sidecars
// and their settings, and the parallel calls. How 9.4 differs from 2.4 and 8.4: in 2.4 a proxy DROPS the header and the trace splits
// in two (the Choice finds the hop, one orphan to join). In 8.4 the header is intact and the trace starts in the browser (the
// Build it has two identical twin calls, one orphan, one hop). Here the header arrives but its parent-id is a pointer to nothing and
// the trace ID is intact; the player diagnoses that from the data and rebuilds two hops, where every client span that could be the parent
// overlaps the server span in time, and no name, verb or position tells them apart, only the IDs.

const T = '5d2b8f0e7c41a396b0d4e8f21a7c3b95';
const WEB_S = '1e7a3c9d5b2f8046';
const WEB_C = '9c3e1a7d4b6f2085';
const WEB_C2A = '2f8b6d0a1c5e9347';
const WEB_C2B = 'f7a1d5f3b9e0c462';
const CART_S = '4b9e2c6a0d8f1573';
const CART_C = 'e0a4c8f2b6d19375';
const CART_C2A = '3d7b1f5a9c2e8064';
const CART_C2B = '8c2e6a0d4f1b7953';
const PAY_S = 'a5f1b9d3c7e20468';
const PAY_DB = '6e0c4a8f2d1b5973';
const MESH1 = 'c70d3b9f1a5e8264'; // the parent-id the sidecar wrote for the web to cart call: no exporter sends this span
const MESH2 = 'f4a82e6c0b1d7935'; // the same for the cart to payments call

const span = (spanId, service, name, kind, startMs, endMs, parentId) => ({
  spanId, traceId: T, name, service, kind, startMs, endMs, status: 'UNSET', attributes: {}, events: [], parentId, links: [],
});

// One checkout request, as the backend received it with the sidecars rewriting parent-id. Cart's and payments' server spans arrive
// with a parent-id that is not the id of any received span. Each server span sits inside three client spans of its caller (the call
// that carried the header and two parallel calls), all enclosing it, so timing cannot pick. Client spans carry the bare HTTP method as
// their name (a client has no route to put in a name), so no server name matches a client name; the right client is not its caller's
// only POST (one parallel call is a POST too, listed above it on the web board); and the timings share no position between the two
// hops, and no span ID order picks it either (the decoy POST on web has the largest ID there, the right one on cart) (web: the right client is the latest to start, the tightest and the first to end; cart: the earliest to start, the widest and
// the last to end), so no rule by name, verb, middle, extreme or row position passes both hops (test/the-trace-that-starts-in-the-middle.test.mjs).
// Only the ids tell them apart, read from the header against the id table.
const TREE = {
  id: 'ttsm-tree',
  spans: [
    span(WEB_S, 'web', 'POST /checkout', 'SERVER', 0, 400, null),
    span(WEB_C2A, 'web', 'GET', 'CLIENT', 20, 385, WEB_S),
    span(WEB_C2B, 'web', 'POST', 'CLIENT', 25, 375, WEB_S),
    span(WEB_C, 'web', 'POST', 'CLIENT', 30, 365, WEB_S),
    span(CART_S, 'cart', 'POST /cart/checkout', 'SERVER', 40, 360, MESH1),
    span(CART_C, 'cart', 'POST', 'CLIENT', 85, 315, CART_S),
    span(CART_C2A, 'cart', 'GET', 'CLIENT', 90, 310, CART_S),
    span(CART_C2B, 'cart', 'POST', 'CLIENT', 100, 290, CART_S),
    span(PAY_S, 'payments', 'POST /payments/charge', 'SERVER', 120, 280, MESH2),
    span(PAY_DB, 'payments', 'INSERT charges', 'CLIENT', 140, 260, PAY_S),
  ],
  edit: ['parent'],
  answer: { [CART_S]: { parentId: WEB_C }, [PAY_S]: { parentId: CART_C } },
  helps: {}, // the help ladder's last rung (docs/M1-DESIGN.md §4.2): no helps, a Check button, no hints
};

const traceparent = (parentId) => `00-${T}-${parentId}-01`;
const code = (text) => `<code>${text}</code>`;
const header = (text) => `<code data-token>${text}</code>`; // a traceparent: kept whole on a line while it fits
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

// Step 1 data: every span as received, and the header on each hop before and after its sidecar. Data text, authored constants.
const RECEIVED_ROWS = TREE.spans
  .map((s) => row([s.service, code(s.name), s.kind, code(s.spanId), s.parentId === null ? 'none' : code(s.parentId)]))
  .join('');
const HOP_ROWS = [
  row(['web to cart', header(traceparent(WEB_C)), header(traceparent(MESH1))]),
  row(['cart to payments', header(traceparent(CART_C)), header(traceparent(MESH2))]),
].join('');

// Step 2 data: the client spans' ids, so the header's parent-id can be looked up, and the headers once the sidecars pass them through.
const CLIENT_ROWS = TREE.spans
  .filter((s) => s.kind === 'CLIENT' && s.service !== 'payments')
  .map((s) => row([s.service, code(s.name), code(s.spanId)]))
  .join('');
const PASS_ROWS = [row(['web to cart', header(traceparent(WEB_C))]), row(['cart to payments', header(traceparent(CART_C))])].join('');

// Step 1: does the presenter's answer hold? `why` follows "Right." or "Not quite.".
const VERDICT = [
  {
    key: 'holds',
    label: 'It holds: cart\'s SDK ignored the header and started over, so its span is an orphan',
    why: `Cart's spans carry trace ${T.slice(0, 8)}, web's trace ID, so its SDK continued the trace and did not start one. The orphan is a parent-ID problem, not a trace-ID problem.`,
  },
  {
    key: 'never-sent',
    label: 'It is wrong: web never sent a traceparent, so cart had nothing to continue',
    why: `Web did send one: the "Left the caller" column shows ${header(traceparent(WEB_C))}, and cart's spans share its trace ID. The trace ID arrived. What changed on the way is the parent-ID.`,
  },
  {
    key: 'rewritten',
    label: 'It is wrong: the sidecar replaced the parent-id with a span it never exports',
    right: true,
    why:
      `The header left web naming web's client span, ${code(WEB_C)}, and reached cart naming ${code(MESH1)}, which is no received span: the sidecar wrote it. The sidecars show tracing export: none, so no one ever sends that span. ` +
      `Cart's SDK did what the header said (same trace, parent ${code(MESH1)}), and the hole is the parent that does not exist. The same happens between cart and payments.`,
  },
  {
    key: 'dropped',
    label: 'It is wrong: the sidecar\'s span was dropped on export, so cart\'s parent is missing',
    why: 'The sidecars show tracing export: none, so they never produced an export to drop. A parent-id that no span carries is not a lost span, it is an id nothing ever sent, written into the header by the sidecar.',
  },
];

export default {
  id: 'the-trace-that-starts-in-the-middle',
  no: '9.4',
  name: 'The trace that starts in the middle',
  sub: 'Does that answer hold?',
  icon: '\u{1F9ED}',
  rewardTitle: 'Parent finder',
  cards: [],
  lights: ['storefront', 'cart', 'payments'],
  scored: true,
  scoring: { parMs: null },
  play: {
    prefix: 'ttsm',
    steps: [
      {
        intro:
          'On a call, a customer shows a checkout trace in which cart and payments float loose, each with a parent no one can open. The presenter answers without a pause: ' +
          '"Cart\'s SDK ignores the header web sends, so it starts over. That is why its span has no parent."',
        show:
          '<p>The three services run behind a mesh: a sidecar sits between each caller and callee, forwards the call and writes a <code>traceparent</code> header on it. Sidecar settings: <code>tracing export: none</code>. ' +
          'Here is the trace as received, and the header on each hop before and after its sidecar:</p>' +
          `<table><caption>Spans received, one trace (${T.slice(0, 8)})</caption><thead><tr><th scope="col">Service</th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Span ID</th><th scope="col">Parent ID</th></tr></thead><tbody>${RECEIVED_ROWS}</tbody></table>` +
          `<table><caption>The traceparent on each hop</caption><thead><tr><th scope="col">Hop</th><th scope="col">Left the caller</th><th scope="col">Reached the callee</th></tr></thead><tbody>${HOP_ROWS}</tbody></table>`,
        question: 'Does the presenter\'s answer hold?',
        qid: 'ttsm-q-verdict',
        choice: { id: 'ttsm-verdict', choices: VERDICT },
      },
      {
        intro:
          'You change the sidecars to pass <code>traceparent</code> through unchanged. The W3C text allows it. A vendor must send the header on and may change it first, so sending it on unchanged is allowed too. ' +
          'The board shows the old trace. Cart\'s and payments\' server spans still point at the IDs the sidecars wrote, which no received span carries; with the fix, each takes the parent the header it receives names. ' +
          'Web and cart also made parallel calls while the call ran, some of them POSTs; their server spans are not in this capture. Calls with the same name are told apart by the end of their span ID.',
        show:
          `<table><caption>The traceparent on each hop after the fix</caption><thead><tr><th scope="col">Hop</th><th scope="col">Header</th></tr></thead><tbody>${PASS_ROWS}</tbody></table>` +
          `<table><caption>CLIENT spans of web and cart, by ID</caption><thead><tr><th scope="col">Service</th><th scope="col">Name</th><th scope="col">Span ID</th></tr></thead><tbody>${CLIENT_ROWS}</tbody></table>`,
        question: 'Rebuild the tree the fix gives: join cart\'s and payments\' server spans to their parents.',
        qid: 'ttsm-q-tree',
        build: TREE,
      },
    ],
    finish:
      'A parent ID is a pointer to a span. Here the sidecars wrote an ID for a span they never export, so the child pointed at nothing; passing the header through unchanged keeps the pointer to the caller\'s own span. ' +
      'The parent a header names is the CLIENT span of the call that carried it, not the SERVER span around it and not a parallel call.',
  },
};
