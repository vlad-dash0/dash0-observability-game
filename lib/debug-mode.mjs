// ?mode=debug (#162): the owner's way to open any level while building. Pure: main.mjs
// passes `window.location.search` once at load; only the exact value "debug" turns it on.
export function isDebugMode(search) {
  if (typeof search !== 'string') return false;
  return new URLSearchParams(search).get('mode') === 'debug';
}
