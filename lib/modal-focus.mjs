// Tab trap for the kit modals (docs/DESIGN-SYSTEM.md "Modal"). The page behind a modal is inert,
// so Tab would otherwise leave it for the browser's own controls; this sends Tab past the last
// control to the first and Shift+Tab before the first to the last, from any element inside the
// dialog, by document order. Pure: the keydown event, the modal element and the document come in.

const FOCUSABLE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The controls Tab can reach inside `modal`, in document order. */
export function focusables(modal) {
  return [...modal.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled === true || el.closest('[hidden]') !== null) return false;
    if (el.localName === 'input' && el.getAttribute('type') === 'hidden') return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  });
}

/**
 * Keep Tab inside `modal`. Returns true when it moved focus itself (and cancelled the key). Focus
 * outside the modal comes back in; a modal with nothing focusable keeps focus on itself.
 */
export function trapTab(e, modal, doc) {
  if (!e || e.key !== 'Tab' || !modal) return false;
  const list = focusables(modal);
  const stop = () => e.preventDefault?.();
  if (list.length === 0) {
    stop();
    return true;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = doc.activeElement;
  const inside = active != null && modal.contains(active);
  if (!inside) {
    stop();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  // Where Tab would go next is decided by position, so an inside element that is not listed (the
  // title, a scroller the browser makes focusable) wraps at the edges too, and Tab never leaves the dialog.
  // Rank by tree order (the modal first, then its descendants): linkedom's compareDocumentPosition
  // is wrong across sibling subtrees, and this holds in browsers too.
  const order = [modal, ...modal.querySelectorAll('*')];
  const rank = (el) => order.indexOf(el);
  const listed = list.includes(active);
  const at = rank(active);
  const hasNext = listed ? active !== last : list.some((el) => rank(el) > at);
  const hasPrev = listed ? active !== first : list.some((el) => rank(el) < at);
  if (e.shiftKey && !hasPrev) {
    stop();
    last.focus();
    return true;
  }
  if (!e.shiftKey && !hasNext) {
    stop();
    first.focus();
    return true;
  }
  return false;
}
