// Browser entry: the only file that touches Alpine. Loaded as a module before the
// deferred Alpine script (index.html), so `alpine:init` is registered in time.
import { createGame, liveRegistry } from './app.mjs';
import { mountGlobe } from './lib/globe-render.mjs';
import { isDebugMode } from './lib/debug-mode.mjs';
import { prefersReducedMotion } from './lib/lesson-kit.mjs';
import { readTheme } from './lib/theme.mjs';

// First statement: apply the stored theme before Alpine renders anything (the CSP
// allows no inline script in <head>, so this is as early as it gets).
document.documentElement.dataset.theme = readTheme(() => window.localStorage);

function browserDeps() {
  return {
    registry: liveRegistry(),
    storage: () => window.localStorage,
    document,
    window,
    debug: isDebugMode(window.location.search),
    now: Date.now,
    rand: Math.random,
    reduceMotion: () => prefersReducedMotion(window),
    // three.js loads on the first mount, after the hub has rendered.
    globe: (host, view) => mountGlobe(host, { window, document, ...view }),
    reportError: (e) => console.error(e),
  };
}

document.addEventListener('alpine:init', () => {
  window.Alpine.data('game', () => createGame(browserDeps()));
});
