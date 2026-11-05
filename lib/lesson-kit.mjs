// Shared level primitives. Pure and DOM-free at import time, so every level and
// `node --test` can import it (adapted from R's lesson-kit).

// lib/ui imports escapeHtml from here (a cycle): it is a function declaration, so it is
// initialised before either module body runs. Keep it one.
import { lesson } from './ui/text.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape text for markup; null and undefined become ''. Use on player input. */
// Safe for element text and quoted attribute values only (not URLs, scripts or CSS).
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** The lesson voice: the kit's glow card (lib/ui lesson) around TRUSTED authored HTML (not escaped). */
export function speech(html) {
  return lesson(html);
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
