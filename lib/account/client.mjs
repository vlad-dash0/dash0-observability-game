// The browser side of sign-in, saved progress and the leaderboard (#273 P6a; docs/FOUNDATION.md §2.9).
// Fetch wrappers for /api/account, /api/progress and /api/leaderboard. Three outcomes, never a
// fake empty: a 502, a 503, a network error or an odd body is `{state: 'unavailable'}`, never an
// empty board, no account or 0 stars. `fetch` is injected; nothing here touches window or storage.
// Every function resolves, never rejects.
import { isPlainObject } from '../progress.mjs';

export const ACCOUNT_URL = '/api/account';
export const PROGRESS_URL = '/api/progress';
export const LEADERBOARD_URL = '/api/leaderboard';
const UNAVAILABLE = Object.freeze({ state: 'unavailable' });
const JSON_HEADERS = { 'content-type': 'application/json' };

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isRank = (n) => Number.isInteger(n) && n >= 1;
const orNull = (check) => (v) => v === null || check(v);

/** {status, body} for a request; null on a network error. A body that is not JSON is null. */
async function call(fetch, url, init) {
  try {
    const res = await fetch(url, init);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** GET /api/account body → `{state: 'unconfigured'}`, `{state: 'signedOut'}`, `{state: 'signedIn', nick, listed}` or unavailable. Pure. */
export function accountOutcome(status, body) {
  if (status !== 200 || !isPlainObject(body) || body.v !== 1) return UNAVAILABLE;
  if (body.configured === false) return { state: 'unconfigured' };
  if (body.configured !== true) return UNAVAILABLE;
  if (body.signedIn === false) return { state: 'signedOut' };
  if (body.signedIn === true && typeof body.nick === 'string' && body.nick !== '' && typeof body.listed === 'boolean') {
    return { state: 'signedIn', nick: body.nick, listed: body.listed };
  }
  return UNAVAILABLE;
}

/** The POST /api/progress outcome: ok (the merged progress, stars or null, rank or null), signedOut (401), limited (429) or unavailable. Pure. */
export function progressOutcome(status, body) {
  if (status === 401) return { state: 'signedOut' };
  if (status === 429) {
    const s = Number(body?.retryAfterS);
    return { state: 'limited', retryAfterS: Number.isFinite(s) && s > 0 ? s : 60 };
  }
  if (status !== 200 || !isPlainObject(body) || body.v !== 1 || !isPlainObject(body.progress)) return UNAVAILABLE;
  if (!orNull(isCount)(body.stars) || !orNull(isRank)(body.rank)) return UNAVAILABLE;
  return { state: 'ok', progress: body.progress, stars: body.stars, rank: body.rank };
}

/** The GET /api/leaderboard outcome: ok (size, top, me or null; top may be empty) or unavailable. Pure. */
export function boardOutcome(status, body) {
  if (status !== 200 || !isPlainObject(body) || body.v !== 1 || body.ok !== true) return UNAVAILABLE;
  if (!isCount(body.size) || !Array.isArray(body.top)) return UNAVAILABLE;
  const top = [];
  for (const r of body.top) {
    if (!isPlainObject(r) || !isRank(r.rank) || typeof r.nick !== 'string' || r.nick === '' || !orNull(isCount)(r.stars)) return UNAVAILABLE;
    top.push({ rank: r.rank, nick: r.nick, stars: r.stars });
  }
  let me = null;
  if (body.me !== null && body.me !== undefined) {
    const m = body.me;
    if (!isPlainObject(m) || !orNull(isCount)(m.stars) || !orNull(isRank)(m.rank) || typeof m.listed !== 'boolean') return UNAVAILABLE;
    me = { stars: m.stars, rank: m.rank, listed: m.listed };
  }
  return { state: 'ok', size: body.size, top, me };
}

/** The POST /api/account outcome for one action: ok (plus nick or listed), taken, invalid (reason), signedOut, limited or unavailable. Pure. */
export function actionOutcome(status, body) {
  if (status === 401) return { state: 'signedOut' };
  if (status === 409) return { state: 'taken' };
  if (status === 429) return { state: 'limited' };
  if (status === 400 && isPlainObject(body) && body.field === 'nick') {
    return { state: 'invalid', reason: typeof body.reason === 'string' ? body.reason : 'format' };
  }
  if (status !== 200 || !isPlainObject(body) || body.v !== 1 || body.ok !== true) return UNAVAILABLE;
  const out = { state: 'ok' };
  if (typeof body.nick === 'string') out.nick = body.nick;
  if (typeof body.listed === 'boolean') out.listed = body.listed;
  return out;
}

export function createAccountClient({ fetch }) {
  const act = async (payload) => {
    const r = await call(fetch, ACCOUNT_URL, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ v: 1, ...payload }) });
    return r === null ? UNAVAILABLE : actionOutcome(r.status, r.body);
  };
  return {
    /** Who is signed in (one GET; the page asks once). */
    async account() {
      const r = await call(fetch, ACCOUNT_URL, { method: 'GET' });
      return r === null ? UNAVAILABLE : accountOutcome(r.status, r.body);
    },
    /** Merge `progress` into the account's saved copy: POST `{v:1, progress}`, nothing else (a sent total is a 400). */
    async syncProgress(progress) {
      const r = await call(fetch, PROGRESS_URL, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ v: 1, progress }) });
      return r === null ? UNAVAILABLE : progressOutcome(r.status, r.body);
    },
    async leaderboard() {
      const r = await call(fetch, LEADERBOARD_URL, { method: 'GET' });
      return r === null ? UNAVAILABLE : boardOutcome(r.status, r.body);
    },
    signOut: () => act({ action: 'signout' }),
    setNickname: (nick) => act({ action: 'nickname', nick }),
    setListing: (listed) => act({ action: 'listing', listed: listed === true }),
    deleteAccount: () => act({ action: 'delete', confirm: 'delete' }),
  };
}
