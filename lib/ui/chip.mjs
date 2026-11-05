// Kit chip (docs/DESIGN-SYSTEM.md "Components"): a mono pill. The tone colours the border and
// the dot only; the words carry the meaning. Pure string builder; DOM-free.

import { bool, int, oneOf, opts, text } from './check.mjs';

export const TONES = Object.freeze(['neutral', 'success', 'error', 'hint', 'attention']);
/** Service swatches follow the waterfall's --color-svc-0 .. -5. */
export const SWATCHES = 6;

/** `<span class="ui-chip" data-tone>`, with an optional dot, a service swatch (0-5) or a dashed border. */
export function chip(args) {
  const { text: label, tone = 'neutral', dot = false, swatch, dashed = false } = opts('chip', args, ['text', 'tone', 'dot', 'swatch', 'dashed']);
  const t = text('chip', label, 'text');
  oneOf('chip', tone, TONES, 'tone');
  bool('chip', dot, 'dot');
  bool('chip', dashed, 'dashed');
  if (swatch !== undefined) int('chip', swatch, 'swatch', 0, SWATCHES - 1);
  const d = dot ? '<i class="ui-chip-dot" aria-hidden="true"></i>' : '';
  const s = swatch === undefined ? '' : `<i class="ui-chip-swatch" data-svc="${swatch}" aria-hidden="true"></i>`;
  return `<span class="ui-chip${dashed ? ' ui-chip--dashed' : ''}" data-tone="${tone}">${d}${s}${t}</span>`;
}
