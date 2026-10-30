// linkedom has no focus model: record each focus() call as a string plus whether the
// element could take focus, never the node itself (comparing nodes in an assertion
// makes node inspect linkedom's whole graph; see test/static.test.mjs).

/**
 * The name a focus target is recorded under: `#id`, else `<data-key>:<value>` for its
 * first data-* attribute (`pick:fallback`, `bucket:metric`), else its tag name.
 */
export function focusName(el) {
  if (el.id) return `#${el.id}`;
  const data = el.getAttributeNames().find((n) => n.startsWith('data-'));
  if (data) return `${data.slice(5)}:${el.getAttribute(data)}`;
  return el.localName;
}

const NATIVE = new Set(['button', 'input', 'select', 'textarea']);

/** Whether a browser would focus `el`: connected, enabled, and natively focusable or tabindexed. */
function canFocus(el) {
  const native = NATIVE.has(el.localName) || (el.localName === 'a' && el.hasAttribute('href'));
  return !el.disabled && el.isConnected && (native || el.hasAttribute('tabindex'));
}

/**
 * Patch `window.HTMLElement.prototype.focus` (from makeDom()) to record calls.
 * Returns `{ names(), last(), unfocusable() }`, all strings: `last()` is 'body' before
 * any focus call; `unfocusable()` lists targets that were disabled, detached, or
 * neither natively focusable (button, input, select, textarea, a[href]) nor tabindexed.
 */
export function recordFocus(window) {
  const log = [];
  window.HTMLElement.prototype.focus = function focus() {
    log.push({ name: focusName(this), focusable: canFocus(this) });
  };
  return {
    names: () => log.map((f) => f.name),
    last: () => log.at(-1)?.name ?? 'body',
    unfocusable: () => log.filter((f) => !f.focusable).map((f) => f.name),
  };
}
