// How Build it names a span, pure and DOM-free: one rule for the view (controls, status, row
// labels), the help messages and checkBuild's issue messages (#69, #228).

/** The first 8 hex characters of a trace id: how the board names a trace (the full id goes in a tooltip). */
export const shortTrace = (traceId) => traceId.slice(0, 8);

/**
 * The one rule for naming a span: `name (service)`, plus `, trace <8 hex>` (the same code the
 * trace shows everywhere else) only when another span in the spec has the same name and
 * service, and `, span id \u2026<last 4 hex>` as well when another twin shows the same trace code
 * (the span id is then the only thing left that differs; the full id if the last 4 collide
 * too). The twin set is computed once here; the view (`v.label`, `v.bold`, `v.bare`), the mount
 * (`text`) and the help messages (`bold`) share it. `bare` never carries the suffix, for places that already print the ids.
 */
export function namer(spans, e) {
  const key = (s) => `${s.name}\u0000${s.service}`;
  const twins = new Map();
  for (const s of spans) twins.set(key(s), [...(twins.get(key(s)) ?? []), s]);
  const suffix = (s) => {
    const same = twins.get(key(s));
    if (same.length < 2) return '';
    const trace = `, trace ${shortTrace(s.traceId)}`;
    const sameCode = same.filter((o) => o.spanId !== s.spanId && shortTrace(o.traceId) === shortTrace(s.traceId));
    if (!sameCode.length) return trace;
    const tail = s.spanId.slice(-4);
    return `${trace}, span id ${sameCode.some((o) => o.spanId.slice(-4) === tail) ? s.spanId : `\u2026${tail}`}`;
  };
  return {
    label: (s) => `${e(s.name)} (${e(s.service)}${e(suffix(s))})`,
    bold: (s) => `<b>${e(s.name)}</b> (${e(s.service)}${e(suffix(s))})`,
    bare: (s) => `${e(s.name)} (${e(s.service)})`,
    suffix: (s) => e(suffix(s)),
    text: (s) => `${s.name} (${s.service}${suffix(s)})`,
  };
}
