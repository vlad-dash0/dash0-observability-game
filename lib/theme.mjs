// Theme choice: 'dark' (default) or 'light', persisted in localStorage. The storage is
// injected as a getter (`() => window.localStorage`) and every access is guarded, so a
// blocked or full storage never breaks the game. Applying it is the caller's job:
// `document.documentElement.dataset.theme = theme` (styles/tokens.css reads it).

export const THEME_KEY = 'oncall.theme';

/** 'light' stays light; anything else (null, unknown, wrong type) is dark. */
export function resolveTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

/** The stored theme, or 'dark' when nothing is stored or storage throws. */
export function readTheme(getStorage) {
  try {
    return resolveTheme(getStorage().getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

/** Store the (resolved) theme; true on success, false when storage throws. */
export function writeTheme(getStorage, theme) {
  try {
    getStorage().setItem(THEME_KEY, resolveTheme(theme));
    return true;
  } catch {
    return false;
  }
}
