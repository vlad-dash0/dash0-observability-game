// The account store (#273 P2b): profiles, progress, the leaderboard and rate limits over
// Upstash Redis. Pure: `redis` (lib/account/redis.mjs), `registry`, `now` and `random` are
// injected. Every store failure is {ok:false, reason:'store'}, never an empty list or a 0.
// No email or name is ever stored: the email is read once, to derive the nickname.
// Spec: the #273 design, sections 2, 3 and 7, with the owner amendments (listed by default,
// no `asked` field).
import { defaultNickCandidates, nickKey, validateNick } from './nickname.mjs';
import { decodeScore, encodeScore } from './score.mjs';
import { emptyProgress, mergeStored, migrate, sanitizeProgress, starTotals } from '../progress.mjs';
import { KEY_PREFIX as P } from './redis.mjs';

export const CAS_ATTEMPTS = 3;
export const DEFAULT_TOP = 10;
const STORE = Object.freeze({ ok: false, reason: 'store' });

export const keys = Object.freeze({
  sub: (sub) => `${P}sub:${sub}`,
  profile: (pid) => `${P}profile:${pid}`,
  progress: (pid) => `${P}progress:${pid}`,
  nick: (key) => `${P}nick:${key}`,
  board: `${P}board`,
  limit: (pid, route, window) => `${P}rl:${pid}:${route}:${window}`,
});

const defaultRandom = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const rowOf = (flat) => {
  const row = {};
  for (let i = 0; i < flat.length; i += 2) row[flat[i]] = flat[i + 1];
  return row;
};
const asRank = (zeroBased) => (zeroBased === null ? null : zeroBased + 1);

/**
 * → the store functions. `registry` is the live registry (the one starTotals counts over).
 * Results: {ok:true, ...} or {ok:false, reason} with reason 'store' (any Redis failure),
 * 'gone' (no such profile), 'conflict' (3 CAS attempts lost), 'limited', or for a nickname
 * 'format' | 'reserved' | 'blocked' | 'taken'.
 */
export function createStore({ redis, registry, now = Date.now, random = defaultRandom }) {
  // Runs `fn`; any thrown failure becomes the store refusal.
  async function guard(fn) {
    try {
      return await fn();
    } catch {
      return { ...STORE };
    }
  }

  const newPid = () => Buffer.from(random(16)).toString('base64url');

  // Claims the first free default nickname for `pid`; a key already held by this pid (a
  // crashed earlier attempt) counts as claimed. → the nick, or null when all are taken.
  async function claimDefaultNick(email, pid) {
    for (const nick of defaultNickCandidates(email)) {
      const key = keys.nick(nickKey(nick));
      const won = await redis.command(['SET', key, pid, 'NX']);
      if (won !== null || (await redis.command(['GET', key])) === pid) return nick;
    }
    return null;
  }

  function toProfile(pid, row) {
    return { pid, nick: row.nick, listed: row.listed === '1', gen: Number(row.gen), created: Number(row.created) };
  }

  // Create or load the profile for a Google `sub`. `email` only feeds the default nickname.
  // → {ok:true, created, profile:{pid, nick, listed, gen}}. A new profile is listed.
  async function signIn(sub, email) {
    if (typeof sub !== 'string' || sub === '') return { ok: false, reason: 'format' };
    return guard(async () => {
      const mine = newPid();
      const won = (await redis.command(['SET', keys.sub(sub), mine, 'NX'])) !== null;
      const pid = won ? mine : await redis.command(['GET', keys.sub(sub)]);
      if (typeof pid !== 'string') return { ...STORE };
      const row = rowOf(await redis.command(['HGETALL', keys.profile(pid)]));
      if (row.nick !== undefined) return { ok: true, created: false, profile: toProfile(pid, row) };
      // New, or a crash left the sub without a profile: (re)build it under the same pid.
      const nick = await claimDefaultNick(email, pid);
      if (nick === null) return { ...STORE };
      const made = { nick, nickKey: nickKey(nick), listed: '1', gen: '1', created: String(now()), sub };
      await redis.command(['HSET', keys.profile(pid), ...Object.entries(made).flat()]);
      // A delete that ran between the sub read and this write would leave an orphan profile
      // (and a listed one after its first save): recheck the sub, and take the rebuild back out.
      if ((await redis.command(['GET', keys.sub(sub)])) !== pid) {
        await removeAccount(pid);
        return { ...STORE };
      }
      return { ok: true, created: won, profile: toProfile(pid, made) };
    });
  }

  // → {ok:true, profile:{pid, nick, listed, gen} | null} (null: no such profile).
  async function loadProfile(pid) {
    return guard(async () => {
      const row = rowOf(await redis.command(['HGETALL', keys.profile(pid)]));
      return { ok: true, profile: row.nick === undefined ? null : toProfile(pid, row) };
    });
  }

  function readStored(row) {
    if (row.json === undefined) return null;
    const migrated = migrate(JSON.parse(row.json));
    if (migrated === null) throw new Error('stored progress is unreadable');
    return migrated;
  }

  // → {ok:true, progress, stars | null, rank | null, listed}. stars is null when nothing was
  // ever saved (not a zero); rank is over the listed set, null when unlisted.
  async function getProgress(pid) {
    return guard(async () => {
      const [prog, prof, rank] = await redis.pipeline([
        ['HGETALL', keys.progress(pid)],
        ['HGETALL', keys.profile(pid)],
        ['ZREVRANK', keys.board, pid],
      ]);
      const profile = rowOf(prof);
      if (profile.nick === undefined) return { ok: false, reason: 'gone' };
      const row = rowOf(prog);
      const stored = readStored(row);
      return {
        ok: true,
        progress: stored === null ? emptyProgress() : sanitizeProgress(stored),
        stars: stored === null ? null : Number(row.total),
        rank: asRank(rank),
        listed: profile.listed === '1',
      };
    });
  }

  // Merges `incoming` into the stored record and writes it with a compare-and-set on rev,
  // retrying up to CAS_ATTEMPTS times (the merge is monotone, so retries converge). The total is
  // computed here from scored registered levels only; reachedAt moves only when the total does.
  // → {ok:true, progress, stars, rank | null}.
  async function putProgress(pid, incoming) {
    return guard(async () => {
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const [prog] = await redis.pipeline([['HGETALL', keys.progress(pid)]]);
        const row = rowOf(prog);
        const merged = mergeStored(readStored(row), incoming, registry);
        const total = starTotals(merged, registry).earned;
        const t = now();
        const reachedAt = row.total !== undefined && Number(row.total) === total ? Number(row.reachedAt) : t;
        const score = encodeScore(total, reachedAt);
        const verdict = await redis.script(
          'cas-progress',
          [keys.progress(pid), keys.profile(pid), keys.board],
          [row.rev ?? '0', JSON.stringify(merged), total, reachedAt, score, pid],
        );
        if (verdict === 'gone') return { ok: false, reason: 'gone' };
        if (verdict === 'ok') {
          const rank = await redis.command(['ZREVRANK', keys.board, pid]);
          return { ok: true, progress: merged, stars: total, rank: asRank(rank) };
        }
        if (verdict !== 'conflict') return { ...STORE };
      }
      return { ok: false, reason: 'conflict' };
    });
  }

  // → {ok:true, nick} | {ok:false, reason: 'format' | 'reserved' | 'blocked' | 'taken' | 'gone' | 'store'}.
  async function setNickname(pid, nick) {
    const valid = validateNick(nick);
    if (!valid.ok) return { ok: false, reason: valid.reason };
    return guard(async () => {
      const next = keys.nick(nickKey(nick));
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const oldKey = (await redis.command(['HGET', keys.profile(pid), 'nickKey'])) ?? '';
        const verdict = await redis.script(
          'claim-nick',
          [keys.profile(pid), next, oldKey === '' ? next : keys.nick(oldKey)],
          [pid, nick, nickKey(nick), oldKey],
        );
        if (verdict === 'ok') return { ok: true, nick };
        if (verdict === 'taken' || verdict === 'gone') return { ok: false, reason: verdict };
        if (verdict !== 'conflict') return { ...STORE };
      }
      return { ok: false, reason: 'conflict' };
    });
  }

  // Listing on joins the board with the stored score; with no stored score only the flag is
  // set and the next progress write adds the entry. → {ok:true, listed} | gone | store.
  async function setListing(pid, listed) {
    return guard(async () => {
      const verdict = await redis.script(
        'set-listing',
        [keys.profile(pid), keys.progress(pid), keys.board],
        [listed ? '1' : '0', pid],
      );
      if (verdict === 'ok') return { ok: true, listed: Boolean(listed) };
      return verdict === 'gone' ? { ok: false, reason: 'gone' } : { ...STORE };
    });
  }

  // Reads the profile's sub and nickKey, then deletes everything under them; a profile that
  // changed in between answers 'conflict' and is read again. → 'ok' (or throws).
  async function removeAccount(pid) {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const [sub, nick] = await redis.pipeline([
        ['HGET', keys.profile(pid), 'sub'],
        ['HGET', keys.profile(pid), 'nickKey'],
      ]);
      const verdict = await redis.script(
        'delete-account',
        [keys.profile(pid), keys.progress(pid), keys.board, keys.sub(sub ?? ''), keys.nick(nick ?? '')],
        [pid, sub ?? '', nick ?? ''],
      );
      if (verdict === 'ok') return 'ok';
      if (verdict !== 'conflict') throw new Error('delete-account failed');
    }
    throw new Error('delete-account conflict');
  }

  // Removes the profile, progress, sub and nick claim (only if this pid holds each) and the board entry.
  async function deleteAccount(pid) {
    return guard(async () => {
      await removeAccount(pid);
      return { ok: true };
    });
  }

  // The top `n` listed players and, for a signed-in `pid`, their own line. Never a pid.
  // → {ok:true, size, top:[{rank, nick, stars}], me: {stars | null, rank | null, listed} | null}.
  // A listed pid with no profile (deleted mid-read) refuses the whole read rather than
  // dropping a row and shifting every rank.
  async function leaderboard({ pid = null, top = DEFAULT_TOP } = {}) {
    const n = Number.isFinite(top) ? Math.min(DEFAULT_TOP, Math.max(1, Math.floor(top))) : DEFAULT_TOP;
    return guard(async () => {
      const [flat, size] = await redis.pipeline([
        ['ZREVRANGE', keys.board, 0, n - 1, 'WITHSCORES'],
        ['ZCARD', keys.board],
      ]);
      const rows = [];
      for (let i = 0; i < flat.length; i += 2) rows.push({ pid: flat[i], score: Number(flat[i + 1]) });
      const nicks = rows.length ? await redis.pipeline(rows.map((r) => ['HGET', keys.profile(r.pid), 'nick'])) : [];
      const board = rows.map((r, i) => {
        if (typeof nicks[i] !== 'string') throw new Error('listed player without a profile');
        return { rank: i + 1, nick: nicks[i], stars: decodeScore(r.score).total };
      });
      let me = null;
      if (pid !== null) {
        const [total, listed, rank] = await redis.pipeline([
          ['HGET', keys.progress(pid), 'total'],
          ['HGET', keys.profile(pid), 'listed'],
          ['ZREVRANK', keys.board, pid],
        ]);
        me = { stars: total === null ? null : Number(total), rank: asRank(rank), listed: listed === '1' };
      }
      return { ok: true, size, top: board, me };
    });
  }

  // A fixed window of `windowS` seconds per pid and route: at most `max` hits.
  // → {ok:true} | {ok:false, reason:'limited', retryAfterS} | {ok:false, reason:'store'}.
  async function rateLimit(pid, route, { max, windowS }) {
    return guard(async () => {
      const t = now();
      const windowMs = windowS * 1000;
      const slot = Math.floor(t / windowMs);
      const key = keys.limit(pid, route, slot);
      const [, count] = await redis.pipeline([
        ['SET', key, 0, 'EX', windowS, 'NX'], // creates the key with its TTL, so it can never outlive the window
        ['INCR', key],
      ]);
      if (count <= max) return { ok: true };
      return { ok: false, reason: 'limited', retryAfterS: Math.max(1, Math.ceil(((slot + 1) * windowMs - t) / 1000)) };
    });
  }

  return { signIn, loadProfile, getProgress, putProgress, setNickname, setListing, deleteAccount, leaderboard, rateLimit };
}
