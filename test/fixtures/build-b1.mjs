// Fixture B1 (docs/M1-DESIGN.md §7 P5): the level 2.1 trace from §6, taken from the level
// itself (levels/spans-and-traces.mjs TREE) so the two cannot drift. Trace 4bf92f35: A
// storefront `POST /checkout` SERVER 0–100 root; B storefront `POST` CLIENT
// 10–90 under A; C api-gateway `POST /checkout` SERVER 15–85 under B; D api-gateway
// `validate cart` INTERNAL 20–30 under C. E belongs to another trace (0af76519, which sorts
// before 4bf92f35 but starts later, at 40) and overlaps C on purpose, so parenting it there
// is a cross-trace-parent. Span ids are deliberately not in start order.
import { CONTENT } from '../../levels/spans-and-traces.mjs';

const TREE = CONTENT.steps.find((s) => s.build).build;

export const [A, B, C, D, E] = TREE.spans.map((s) => s.spanId);
export const TRACE = TREE.spans[0].traceId;
export const OTHER_TRACE = TREE.spans[4].traceId;

/** B1 assembled: every span under its right parent (a fresh copy each call). */
export function b1Spans() {
  return structuredClone(TREE.spans).map((s) => ({ ...s, parentId: TREE.answer[s.spanId]?.parentId ?? s.parentId }));
}

/** B1 as a Build it spec (edit: parent): every span given as a root; the answer is b1Spans()' parents. */
export function b1Spec() {
  return {
    id: 'b1',
    spans: structuredClone(TREE.spans),
    edit: ['parent'],
    answer: structuredClone(TREE.answer),
  };
}
