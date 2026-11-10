// Pure markup and copy for the leaderboard, the account panel and the sign-in nudge (#273 P6a).
// Built from lib/ui helpers only. Player text (a nickname) is escaped. The three outcomes are
// kept apart: unavailable is never an empty board and a missing star count is never 0.
import { escapeHtml } from '../lesson-kit.mjs';
import { button, checkbox, feedback, field, note, table } from '../ui/index.mjs';

export const BOARD_UNAVAILABLE = 'Leaderboard unavailable';
export const BOARD_EMPTY = 'No one on the board yet';
export const BOARD_LOADING = 'Loading the leaderboard';
export const ACCOUNT_UNAVAILABLE = 'Account unavailable; your progress is still saved in this browser';
export const NUDGE_FALLBACK = 'Sign in to save your progress';
export const PRIVACY =
  'Optional, @dash0.com Google accounts only. We keep your Google account id, a nickname and your level stars and cards, nothing else. ' +
  'We never store or show your name or email. Signed-in players are listed on the leaderboard by default and can hide themselves in Account. ' +
  'Your default nickname is a fun name made from your email; change it any time. Delete your account to remove everything we hold; this browser keeps its own copy.';

/** "12 stars", "1 star", and "no stars yet" for null (and for 0: a zero is never shown). */
export function starsText(n) {
  if (!Number.isInteger(n) || n < 1) return 'no stars yet';
  return n === 1 ? '1 star' : `${n} stars`;
}

/** The nudge copy for a leaderboard outcome: the king, an empty board, or unavailable. Plain text (bind it with x-text). */
export function nudgeText(board) {
  if (board?.state !== 'ok') return NUDGE_FALLBACK;
  const king = board.top[0];
  if (!king) return 'Save your progress and be the first o11y king';
  return `Save your progress and see if you can beat the o11y king, ${king.nick} (${starsText(king.stars)})`;
}

/** The "You: ..." line under the top 10; '' for a signed-out viewer (me is null). */
export function meText(me) {
  if (me === null || me === undefined) return '';
  if (me.rank === null) return "You're not on the board";
  return `You: ${starsText(me.stars)}, #${me.rank}`;
}

/** The board modal body for `{state: 'loading'|'unavailable'|'ok', top, me}`. */
export function boardHtml(board) {
  const say = (t) => note(escapeHtml(t));
  if (board?.state === 'loading') return say(BOARD_LOADING);
  if (board?.state !== 'ok') return say(BOARD_UNAVAILABLE);
  const me = meText(board.me);
  const mine = me === '' ? '' : say(me);
  if (board.top.length === 0) return say(BOARD_EMPTY) + mine;
  const rows = board.top.map((r) => [`#${r.rank}`, r.nick, starsText(r.stars)]);
  return table({ caption: 'Top players', head: ['Rank', 'Nickname', 'Stars'], rows, numeric: [0] }) + mine;
}

/**
 * The account modal body for a signed-in player: nickname field and Save, the listing toggle,
 * Sign out, Delete with a two-step confirm, and the privacy copy. Ids are the contract (see app.mjs):
 * account-nick, account-nick-save, account-listed, account-signout, account-delete, account-delete-yes,
 * account-delete-no and the feedback region account-feedback.
 */
export function accountHtml({ nick, listed, confirmDelete = false }) {
  const remove = confirmDelete
    ? note('Delete your account and everything we hold? This browser keeps its own copy.') +
      button({ id: 'account-delete-yes', label: 'Yes, delete my account', variant: 'primary' }) +
      button({ id: 'account-delete-no', label: 'Keep my account' })
    : button({ id: 'account-delete', label: 'Delete account' });
  return [
    field({ id: 'account-nick', label: 'Nickname', value: nick, autocompleteOff: true }),
    button({ id: 'account-nick-save', label: 'Save nickname' }),
    checkbox({ id: 'account-listed', labelHtml: 'Show me on the leaderboard', checked: listed === true }),
    feedback({ id: 'account-feedback' }),
    button({ id: 'account-signout', label: 'Sign out' }),
    remove,
    note(escapeHtml(PRIVACY)),
  ].join('');
}
