// Tab trap for the kit modals (docs/DESIGN-SYSTEM.md "Modal"). The page behind a modal is inert,
// so Tab would otherwise leave it for the browser's own controls; this wraps Tab at the last
// control to the first and Shift+Tab at the first (or on the title, which takes focus by script
// only) to the last. Pure: the keydown event, the modal element and the document come in.

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
  if (e.shiftKey && (active === first || !list.includes(active))) {
    stop();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    stop();
    first.focus();
    return true;
  }
  return false;
}
