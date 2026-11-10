// Browser entry: the only file that touches Alpine. Loaded as a module before the
// deferred Alpine script (index.html), so `alpine:init` is registered in time.
import { createGame, liveRegistry } from './app.mjs';
import { mountGlobe } from './lib/globe-render.mjs';
import { isDebugMode } from './lib/debug-mode.mjs';
import { prefersReducedMotion } from './lib/lesson-kit.mjs';
import { readTheme } from './lib/theme.mjs';
import { createTelemetry } from './lib/telemetry.mjs';

// First statement: apply the stored theme before Alpine renders anything (the CSP
// allows no inline script in <head>, so this is as early as it gets).
document.documentElement.dataset.theme = readTheme(() => window.localStorage);

// `?signin=ok|failed|domain|cancelled|unavailable` is where the sign-in redirect lands: read it once
// and strip it, so a reload or a shared link does not replay it.
function takeSignin() {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('signin');
  if (value === null) return null;
  url.searchParams.delete('signin');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return value;
}
const signin = takeSignin();

function browserDeps() {
  const debug = isDebugMode(window.location.search);
  return {
    registry: liveRegistry(),
    storage: () => window.localStorage,
    document,
    window,
    debug,
    telemetry: createTelemetry({
      fetch: window.fetch.bind(window),
      randomBytes: (n) => window.crypto.getRandomValues(new Uint8Array(n)),
      now: Date.now,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      reportError: (e) => console.error(e),
      allowLocal: debug,
    }),
    fetch: window.fetch.bind(window),
    signin,
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
