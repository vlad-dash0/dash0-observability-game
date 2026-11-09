// A stub ctx's guide seam for the widget tests (#17 P3): askedGuide() is one hint plus a
// notification, exactly what lib/level-context.mjs does, so a board under test can be asked.
export function withGuide(ctx) {
  const listeners = new Set();
  ctx.onGuideHint = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  ctx.askedGuide = () => {
    ctx.hint();
    for (const fn of [...listeners]) fn();
  };
  return ctx;
}
