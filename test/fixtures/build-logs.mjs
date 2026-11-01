// Fixture L1 (#113, docs/M1-DESIGN.md §4.2, logs mode): two traces and five log records,
// deliberately unequal. T2 (0af7…) sorts before T1 (4bf9…) but starts later, at 30. S2 and S4
// overlap across traces; `l-cart` falls inside S1, S2 and S4 and is told apart by its
// order.id; span ids are out of time order; the record times (-40) widen the axis. The
// payments retry-worker record falls inside S3's window and service but its thread.name
// differs, so no span was active and it stays unlinked.
export const T1 = '4bf92f3577b34da6a3ce929d0e0e4736';
export const T2 = '0af7651916cd43dd8448eb211c80319c';
export const S1 = 'bbbbbbbbbbbbbbb1';
export const S2 = 'aaaaaaaaaaaaaaa2';
export const S3 = 'ddddddddddddddd3';
export const S4 = 'ccccccccccccccc4';

const span = (spanId, traceId, parentId, name, service, kind, startMs, endMs, attributes = {}) => ({
  spanId, traceId, parentId, name, service, kind, startMs, endMs, status: 'UNSET', attributes, events: [], links: [],
});

const log = (id, timeMs, severity, service, body, attributes) => ({
  id, timeMs, severity, service, body, traceId: null, spanId: null, attributes,
});

/** The fixture as a Build it spec in logs mode (a fresh copy each call). */
export function logsSpec() {
  return {
    id: 'l1',
    edit: ['logs'],
    spans: [
      span(S1, T1, null, 'POST /checkout', 'checkout', 'SERVER', 0, 100, { 'order.id': '8841' }),
      span(S2, T1, S1, 'validate cart', 'checkout', 'INTERNAL', 20, 40),
      span(S3, T1, S1, 'POST /charge', 'payments', 'SERVER', 50, 90, { 'thread.name': 'http-exec-1' }),
      span(S4, T2, null, 'POST /checkout', 'checkout', 'SERVER', 30, 80, { 'order.id': '8842' }),
    ],
    logs: [
      log('l-boot', -40, 'INFO', 'checkout', 'Application started', { 'thread.name': 'main' }),
      log('l-cart', 30, 'DEBUG', 'checkout', 'Cart validated', { 'order.id': '8841' }),
      log('l-other', 60, 'INFO', 'checkout', 'Order accepted', { 'order.id': '8842' }),
      log('l-charge', 70, 'INFO', 'payments', 'Charge submitted', { 'thread.name': 'http-exec-1' }),
      log('l-worker', 75, 'ERROR', 'payments', 'Retry worker gave up on charge', { 'thread.name': 'retry-worker-2' }),
    ],
    answer: { 'l-boot': null, 'l-cart': S2, 'l-other': S4, 'l-charge': S3, 'l-worker': null },
  };
}
