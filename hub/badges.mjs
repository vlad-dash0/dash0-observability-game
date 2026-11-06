// Act badges: the one place a badge id gets its label and kit chip tone (docs/FOUNDATION.md §2.2).
// An act lists ids in `badges`; lib/registry.mjs rejects unknown ones; the hub card and the About
// dialog render `{id, label, tone}` as a kit chip with x-text. Plain text only.
export const BADGES = Object.freeze({
  dash0: Object.freeze({ label: 'Dash0', tone: 'hint' }),
  'customer-calls': Object.freeze({ label: 'From customer calls', tone: 'attention' }),
});

/** Ids to `[{id, label, tone}]`, in the order given. */
export function badgeViews(ids) {
  return Array.from(ids ?? [], (id) => ({ id, label: BADGES[id].label, tone: BADGES[id].tone }));
}
