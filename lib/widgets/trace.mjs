// Trace core (docs/M1-DESIGN.md §4.2): lay spans out as a waterfall and derive service-map
// edges from span kinds. Pure and DOM-free; inputs are never mutated. `serviceEdges` is
// the one home of "service-map edges from span kinds" (§2).
//
// Span = { spanId: 16 lc hex, traceId: 32 lc hex, name, service,
//   kind: SERVER|CLIENT|PRODUCER|CONSUMER|INTERNAL, startMs, endMs, status: UNSET|ERROR|OK,
//   attributes, events: [{name, atMs, attributes}], parentId: string|null, links: string[] }

export const KINDS = ['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'];
export const STATUSES = ['UNSET', 'ERROR', 'OK'];

const byStartThenId = (a, b) => a.startMs - b.startMs || (a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The shared time axis of a board: `{min, range, pct}` over all `spans` and any extra
 * `times` (ms, log timestamps). `pct(ms)` is an absolute time's position as a percentage
 * of the range (0 when the range is 0). The one home of "where a time sits", for bars,
 * ticks and cursors.
 */
export function timeAxis(spans, times = []) {
  if (spans.length === 0 && times.length === 0) return { min: 0, range: 0, pct: () => 0 };
  const min = Math.min(...spans.map((s) => s.startMs), ...times);
  const range = Math.max(...spans.map((s) => s.endMs), ...times) - min;
  return { min, range, pct: (ms) => (range > 0 ? ((ms - min) / range) * 100 : 0) };
}

/**
 * Waterfall rows for `spans`: `{rows, traces}`. `traces` are trace ids by earliest start
 * (ties by id); rows go trace by trace, depth-first, roots and children by startMs then
 * spanId. x and width are percentages (0..100) of the time range of all spans. A span
 * whose parent is not among the spans is a root with `orphan: true`; one whose parent is
 * in another trace is a root of its own trace with `crossTrace: true`. Spans caught in a
 * parent loop are laid out from their earliest member, so every span appears once.
 * `times` (log record timestamps) widen the range, so the rows' x and width follow `timeAxis`.
 */
export function waterfall(spans, { times = [] } = {}) {
  if (spans.length === 0) return { rows: [], traces: [] };
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const { min, range, pct } = timeAxis(spans, times);
  const len = (ms) => (range > 0 ? (ms / range) * 100 : 0);

  const first = new Map();
  for (const s of spans) {
    if (!first.has(s.traceId) || s.startMs < first.get(s.traceId)) first.set(s.traceId, s.startMs);
  }
  const traces = [...first.keys()].sort((a, b) => first.get(a) - first.get(b) || cmp(a, b));

  const children = new Map();
  const rootOf = (s) => {
    const p = s.parentId == null ? undefined : byId.get(s.parentId);
    return { root: !p || p.traceId !== s.traceId, orphan: s.parentId != null && !p, crossTrace: !!p && p.traceId !== s.traceId };
  };
  for (const s of spans) {
    if (rootOf(s).root) continue;
    if (!children.has(s.parentId)) children.set(s.parentId, []);
    children.get(s.parentId).push(s);
  }
  for (const list of children.values()) list.sort(byStartThenId);

  const rows = [];
  const seen = new Set();
  const visit = (s, depth) => {
    if (seen.has(s.spanId)) return;
    seen.add(s.spanId);
    const { orphan, crossTrace } = rootOf(s);
    rows.push({
      spanId: s.spanId, traceId: s.traceId, depth,
      x: pct(s.startMs), width: len(s.endMs - s.startMs),
      name: s.name, service: s.service, kind: s.kind, status: s.status, orphan, crossTrace,
    });
    for (const c of children.get(s.spanId) ?? []) visit(c, depth + 1);
  };
  for (const t of traces) {
    const inTrace = spans.filter((s) => s.traceId === t).sort(byStartThenId);
    for (const s of inTrace) if (rootOf(s).root) visit(s, 0);
    for (const s of inTrace) visit(s, 0); // only spans in a parent loop are still unseen
  }
  return { rows, traces };
}

/**
 * Service-map edges implied by span kinds, sorted by from, to, via and unique: a CLIENT
 * span's child SERVER span (same trace) in another service ('client-server'), and a
 * CONSUMER span whose parent (same trace) or link is a PRODUCER in another service
 * ('producer-consumer'). Edges point from the caller or producer.
 */
export function serviceEdges(spans) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const edges = new Map();
  const add = (from, to, via) => edges.set(JSON.stringify([from.service, to.service, via]), { from: from.service, to: to.service, via });
  for (const s of spans) {
    const p = s.parentId == null ? undefined : byId.get(s.parentId);
    const parent = p && p.traceId === s.traceId ? p : undefined;
    if (s.kind === 'SERVER' && parent?.kind === 'CLIENT' && parent.service !== s.service) add(parent, s, 'client-server');
    if (s.kind !== 'CONSUMER') continue;
    const sources = [parent, ...s.links.map((id) => byId.get(id))];
    for (const src of sources) {
      if (src?.kind === 'PRODUCER' && src.service !== s.service) add(src, s, 'producer-consumer');
    }
  }
  return [...edges.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.via, b.via));
}
