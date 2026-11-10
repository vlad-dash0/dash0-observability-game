// Run a function on the next animation frame, or at once where there is none (node:test, a bare DOM).
// Kept outside lib/widgets, whose I2 guard keeps timers out of the widgets; the editor's resize refit
// needs the frame to stay clear of the "ResizeObserver loop" warning. Reads the global lazily, so it
// imports cleanly under node --test.

/** @param {() => void} fn */
export function nextFrame(fn) {
  if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(fn);
  else fn();
}
