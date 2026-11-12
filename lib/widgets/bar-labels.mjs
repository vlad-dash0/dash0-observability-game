// Waterfall bar labels, placed by measurement (#332). build-it-view.mjs renders each label inside
// its bar from an estimate of the track width; here the browser's real text and track widths decide:
// inside the bar when it fits, else just right of the bar, else just left of it, else inside with the
// name cut to an ellipsis (the duration always stays). Attributes only (x, dx, text-anchor, data-out),
// so the CSP holds. Where the browser cannot measure (a test DOM, a hidden board) nothing changes.

const GAP_PX = 7;
const PAD_END_PX = 3; // what an inside label leaves at the bar's far end
const ELLIPSIS = '…';

/** The percent in an SVG length attribute ("12.5%") as a number. */
const pct = (el, attr) => parseFloat(el.getAttribute(attr)) || 0;

/** Place every bar label under `board` by measurement. Safe to call again after a resize or a redraw. */
export function fitBarLabels(board) {
  for (const text of board.querySelectorAll('[data-bar-label]')) {
    if (typeof text.getComputedTextLength !== 'function') return;
    const track = text.closest('.wf-track');
    const bar = track?.querySelector('[data-bar]');
    const nameSpan = text.querySelector('[data-bar-name]');
    const trackW = track?.getBoundingClientRect().width ?? 0;
    if (!bar || !nameSpan || !(trackW > 0)) continue;
    nameSpan.dataset.full ??= nameSpan.textContent;
    const full = nameSpan.dataset.full;
    const barX = (pct(bar, 'x') / 100) * trackW;
    const barW = (pct(bar, 'width') / 100) * trackW;
    const place = (x, dx, anchor) => {
      text.setAttribute('x', `${x}%`);
      text.setAttribute('dx', String(dx));
      if (anchor) text.setAttribute('text-anchor', 'end');
      else text.removeAttribute('text-anchor');
      if (dx === GAP_PX && x === pct(bar, 'x')) text.removeAttribute('data-out');
      else text.setAttribute('data-out', '');
    };
    nameSpan.textContent = full;
    nameSpan.removeAttribute('data-cut');
    const w = text.getComputedTextLength();
    if (GAP_PX + w + PAD_END_PX <= barW) place(pct(bar, 'x'), GAP_PX, false);
    else if (barX + barW + GAP_PX + w <= trackW) place(pct(bar, 'x') + pct(bar, 'width'), GAP_PX, false);
    else if (w + GAP_PX <= barX) place(pct(bar, 'x'), -GAP_PX, true);
    else {
      place(pct(bar, 'x'), GAP_PX, false);
      const room = barW - GAP_PX - PAD_END_PX;
      let n = full.length;
      while (n > 1 && text.getComputedTextLength() > room) {
        n -= 1;
        nameSpan.textContent = `${full.slice(0, n).trimEnd()}${ELLIPSIS}`;
      }
    }
  }
}

/** Fit now, once the fonts have loaded, and whenever the board's width changes (a phone turning). */
export function watchBarLabels(board, { signal } = {}) {
  let lastWidth;
  const fit = () => {
    lastWidth = board.clientWidth;
    fitBarLabels(board);
  };
  const g = globalThis;
  if (typeof g.ResizeObserver === 'function') {
    const ro = new g.ResizeObserver(() => {
      if (board.clientWidth !== lastWidth) fit();
    });
    ro.observe(board);
    signal?.addEventListener('abort', () => ro.disconnect(), { once: true });
  }
  g.document?.fonts?.ready?.then(fit, () => {});
  return fit;
}
