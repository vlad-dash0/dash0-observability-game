// How Build it names a span, pure and DOM-free: one rule for the view (controls, status, row
// labels), the help messages and checkBuild's issue messages (#69, #228).

/** The first 8 hex characters of a trace id: how the board names a trace (the full id goes in a tooltip). */
export const shortTrace = (traceId) => traceId.slice(0, 8);

const twinKey = (s) => `${s.name}\u0000${s.service}`;

/**
 * The span ids that tell twins apart: for each span with another span of the same name, service and
 * 8-hex trace code, `\u2026<last 4 hex>` (the full id when a twin shares those 4). Spans without such a twin are
 * absent. The one home of this rule: namer's `, span id ...` suffix and the board's row pill both read it.
 */
export function twinSpanIds(spans) {
  const groups = new Map();
  for (const s of spans) groups.set(twinKey(s), [...(groups.get(twinKey(s)) ?? []), s]);
  const out = new Map();
  for (const same of groups.values()) {
    for (const s of same) {
      const sameCode = same.filter((o) => o.spanId !== s.spanId && shortTrace(o.traceId) === shortTrace(s.traceId));
      if (!sameCode.length) continue;
      const tail = s.spanId.slice(-4);
      out.set(s.spanId, sameCode.some((o) => o.spanId.slice(-4) === tail) ? s.spanId : `\u2026${tail}`);
    }
  }
  return out;
}

/**
 * The one rule for naming a span: `name (service)`, plus `, trace <8 hex>` (the same code the
 * trace shows everywhere else) only when another span in the spec has the same name and
 * service, and `, span id \u2026<last 4 hex>` as well when another twin shows the same trace code
 * (the span id is then the only thing left that differs; the full id if the last 4 collide
 * too). The twin set is computed once here; the view (`v.label`, `v.bold`, `v.bare`), the mount
 * (`text`) and the help messages (`bold`) share it. `bare` never carries the suffix, for places that already print the ids.
 */
export function namer(spans, e) {
  const key = twinKey;
  const ids = twinSpanIds(spans);
  const twins = new Map();
  for (const s of spans) twins.set(key(s), [...(twins.get(key(s)) ?? []), s]);
  const suffix = (s) => {
    const same = twins.get(key(s));
    if (same.length < 2) return '';
    const trace = `, trace ${shortTrace(s.traceId)}`;
    return ids.has(s.spanId) ? `${trace}, span id ${ids.get(s.spanId)}` : trace;
  };
  return {
    label: (s) => `${e(s.name)} (${e(s.service)}${e(suffix(s))})`,
    bold: (s) => `<b>${e(s.name)}</b> (${e(s.service)}${e(suffix(s))})`,
    bare: (s) => `${e(s.name)} (${e(s.service)})`,
    suffix: (s) => e(suffix(s)),
    text: (s) => `${s.name} (${s.service}${suffix(s)})`,
  };
}
