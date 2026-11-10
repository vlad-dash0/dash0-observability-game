// `?signin=` (#273): where the sign-in redirect lands. Read once and stripped from the URL, so a reload
// or a shared link does not replay it. `win` is injected; a failing replaceState (a sandboxed frame) must
// never stop the game booting, so the value is still returned.
export function takeSignin(win) {
  let url;
  try {
    url = new URL(win.location.href);
  } catch {
    return null;
  }
  const value = url.searchParams.get('signin');
  if (value === null) return null;
  url.searchParams.delete('signin');
  try {
    win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
  } catch {
    // the URL keeps its query; the notice still shows
  }
  return value;
}
