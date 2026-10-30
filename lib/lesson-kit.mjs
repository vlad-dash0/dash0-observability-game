// Shared level primitives. Pure and DOM-free at import time, so every level and
// `node --test` can import it (adapted from R's lesson-kit).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape text for markup; null and undefined become ''. Use on player input. */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** A speech bubble around TRUSTED authored HTML (not escaped). */
export function speech(html) {
  return `<div class="speech"><div class="bubble">${html}</div></div>`;
}

/** A shuffled copy of `arr` (Fisher-Yates); `rand` returns [0, 1). */
export function shuffle(arr, rand = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** True when the user asked for reduced motion; false without a usable matchMedia. */
export function prefersReducedMotion(win = globalThis.window) {
  try {
    return !!(win && typeof win.matchMedia === 'function' &&
      win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}
