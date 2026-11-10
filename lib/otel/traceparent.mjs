// W3C trace-context `traceparent` parsing for the api/ functions (epic #18). Pure.
// Spec: https://www.w3.org/TR/trace-context/#traceparent-header (W3C Recommendation, 23 Nov 2021),
// also the game's card `broken-propagation` (cards/deck.mjs).
//
// Facts used (each read on the page named, 2026-11-10). The version `ff` is invalid. A trace-id or
// parent-id of all zeros is invalid. The grammar is lowercase hex (HEXDIGLC), so uppercase is invalid.
// Version 00 is the fixed-width form: `00-<32 hex>-<16 hex>-<2 hex>`, 55 characters (stated as
// reasoning from the grammar; no sentence says so). For a higher version the receiver parses the
// same first fields: a header shorter than 55 characters restarts the trace, the flags must be
// followed by the end of the string or '-', and unknown fields are never interpreted. The sampled
// flag is the least significant bit of trace-flags ("01" is sampled).
// tracestate is ignored by this game.

const FIXED_LENGTH = 55;
const FIELDS = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/;
const ALL_ZERO = /^0+$/;

/** header value -> {traceId, parentId, sampled} | null (start a new trace). */
export function parseTraceparent(value) {
  if (typeof value !== 'string' || value.length < FIXED_LENGTH) return null;
  const m = FIELDS.exec(value);
  if (m === null) return null;
  const [, version, traceId, parentId, flags] = m;
  if (version === 'ff') return null;
  if (version === '00' ? value.length !== FIXED_LENGTH : value.length > FIXED_LENGTH && value[FIXED_LENGTH] !== '-') {
    return null;
  }
  if (ALL_ZERO.test(traceId) || ALL_ZERO.test(parentId)) return null;
  return { traceId, parentId, sampled: (parseInt(flags, 16) & 1) === 1 };
}
