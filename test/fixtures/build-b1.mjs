// Fixture B1 (docs/M1-DESIGN.md §7 P5): the level 2.1 trace from §6. Trace 4bf9…: A
// storefront `POST /checkout` SERVER 0–100 root; B storefront `POST api-gateway` CLIENT
// 10–90 under A; C api-gateway `POST /checkout` SERVER 15–85 under B; D api-gateway
// `validate cart` INTERNAL 20–30 under C. E belongs to another trace (0af7…, which sorts
// before 4bf9… but starts later, at 40) and overlaps C on purpose, so parenting it there
// is a cross-trace-parent. Span ids are deliberately not in start order.

export const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
export const OTHER_TRACE = '0af7651916cd43dd8448eb211c80319c';
export const A = '00f067aa0ba902b7';
export const B = 'b7ad6b7169203331';
export const C = '53995c3f42cd8ad8';
export const D = '1d5c3a2f8e4b6a90';
export const E = '9e1f2a3b4c5d6e7f';

const span = (spanId, traceId, service, name, kind, startMs, endMs, parentId) => ({
  spanId, traceId, name, service, kind, startMs, endMs, status: 'UNSET',
  attributes: {}, events: [], parentId, links: [],
});

/** B1 assembled: every span under its right parent (a fresh copy each call). */
export function b1Spans() {
  return [
    span(A, TRACE, 'storefront', 'POST /checkout', 'SERVER', 0, 100, null),
    span(B, TRACE, 'storefront', 'POST api-gateway', 'CLIENT', 10, 90, A),
    span(C, TRACE, 'api-gateway', 'POST /checkout', 'SERVER', 15, 85, B),
    span(D, TRACE, 'api-gateway', 'validate cart', 'INTERNAL', 20, 30, C),
    span(E, OTHER_TRACE, 'storefront', 'GET /products', 'SERVER', 40, 60, null),
  ];
}

/** B1 as a Build it spec (edit: parent): every span given as a root; the answer is b1Spans()' parents. */
export function b1Spec() {
  return {
    id: 'b1',
    spans: b1Spans().map((s) => ({ ...s, parentId: null })),
    edit: ['parent'],
    answer: { [B]: { parentId: A }, [C]: { parentId: B }, [D]: { parentId: C } },
  };
}
