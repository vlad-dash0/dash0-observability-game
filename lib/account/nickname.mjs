// Nicknames for the leaderboard: validation, the case-insensitive uniqueness key, and a fun
// default made from the first name token of an email. The email, its domain and its full
// local part never appear in a result. Spec: the #273 design, section 2 (Nickname) and D1.
export const NICK_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
export const NICK_MAX = 20;
export const FALLBACK_BASE = 'player';

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', $: 's', '@': 'a', '!': 'i' };

// Lowercase with the leet characters folded to letters; everything else kept.
const leet = (nick) => nick.toLowerCase().replace(/[013457$@!]/g, (c) => LEET[c]);
// Letters only: the form reserved names and the long blocked words are matched on.
const fold = (nick) => leet(nick).replace(/[^a-z]/g, '');

// Reserved names, folded the same way, so adm1n and dasho are as reserved as admin and dash0.
const RESERVED = new Set(['admin', 'dash0', 'o11y-king', 'moderator', 'anonymous', 'unavailable', 'player'].map(fold));
const isReserved = (nick) => RESERVED.has(fold(nick));

// Small and mild on purpose. Short words that sit inside innocent names (Kshitij, Draper)
// count only as a whole token of the folded nick (split on anything but a-z); the longer,
// unambiguous ones count as a substring of the folded letters.
const BLOCKED_TOKENS = ['shit', 'rape', 'cunt', 'slut', 'nazi', 'porn'];
const BLOCKED_SUBSTRINGS = ['fuck', 'whore', 'bitch', 'nigg'];

const isBlocked = (nick) => {
  const tokens = leet(nick).split(/[^a-z]+/);
  if (tokens.some((t) => BLOCKED_TOKENS.includes(t))) return true;
  const f = fold(nick);
  return BLOCKED_SUBSTRINGS.some((w) => f.includes(w));
};

// → {ok:true} or {ok:false, reason: 'format' | 'reserved' | 'blocked'}.
export function validateNick(nick) {
  if (typeof nick !== 'string' || !NICK_RE.test(nick)) return { ok: false, reason: 'format' };
  if (isReserved(nick)) return { ok: false, reason: 'reserved' };
  if (isBlocked(nick)) return { ok: false, reason: 'blocked' };
  return { ok: true };
}

// → the lowercase uniqueness key, or null when the nickname does not validate.
export function nickKey(nick) {
  return validateNick(nick).ok ? nick.toLowerCase() : null;
}

// FNV-1a, 32 bit: stable across runs and platforms.
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const VOWEL = /[aeiou]/;
const isVowel = (c) => VOWEL.test(c);
const RULES = [
  { name: 'ster', apply: (b) => `${b}ster` },
  // bob -> bobber: only a consonant-vowel-consonant ending doubles, never w, x or y.
  {
    name: 'er',
    apply: (b) => {
      const n = b.length;
      const ok = n >= 3 && !b.endsWith('er') && isVowel(b[n - 2]) && !isVowel(b[n - 3]) && /[bcdfghjklmnpqrstvz]/.test(b[n - 1]);
      return ok ? `${b}${b[n - 1]}er` : null;
    },
  },
  // kyle -> kyloton: only a final vowel is dropped.
  { name: 'oton', apply: (b) => (isVowel(b[b.length - 1]) ? `${b.slice(0, -1)}oton` : null) },
  { name: 'inator', apply: (b) => `${b}inator` },
  { name: 'zilla', apply: (b) => `${b}zilla` },
];
// Salt picked so the owner's examples come out as given: vlad -> ster, bob -> er, kyle -> oton.
const RULE_SALT = 's28';
const BASE_MAX = 10; // keeps every rule result within 16 characters

// → the base: first token of the local part (up to the first @), accents stripped,
// lowercased, +tag dropped, [a-z0-9] only; the fallback when it is shorter than 3,
// reserved or blocked.
function baseOf(email) {
  const at = typeof email === 'string' ? email.indexOf('@') : -1;
  const local = at < 0 ? '' : email.slice(0, at);
  const plain = local.normalize('NFKD').replace(/\p{M}/gu, '');
  const first = plain.toLowerCase().split('+')[0].split(/[._-]/).find((t) => /[a-z0-9]/.test(t)) ?? '';
  const base = first.replace(/[^a-z0-9]/g, '').slice(0, BASE_MAX);
  return base.length < 3 || isReserved(base) || isBlocked(base) ? FALLBACK_BASE : base;
}

const fits = (nick) => validateNick(nick).ok;

// Appends `-tail`, cutting the head so the whole stays within NICK_MAX.
const withTail = (head, tail) => `${head.slice(0, NICK_MAX - tail.length - 1)}-${tail}`;

// → an ordered, finite, duplicate-free list of valid nicknames, always the same for the
// same email: the fun names (rules start at a hash of the base, applicable ones only),
// then the first with -2 to -99, then the first with a short tail hashed from the whole
// email, so fallback bases do not share one pool. Never contains the domain or the full
// local part (unless the local part is itself the base token).
export function defaultNickCandidates(email) {
  const base = baseOf(email);
  const rules = RULES.map((r) => ({ ...r, out: r.apply(base) })).filter((r) => r.out !== null);
  const start = (hash(`${RULE_SALT}:${base}`) >>> 8) % rules.length; // high bits: FNV's low bits mix poorly
  const fun = rules.map((_, i) => rules[(start + i) % rules.length].out).filter(fits);
  const first = fun[0];
  const numbered = [];
  for (let n = 2; n <= 99; n++) numbered.push(withTail(first, String(n)));
  const hashed = [];
  for (let i = 0; i < 8; i++) {
    const tail = (hash(`${String(email).toLowerCase()}:${i}`) & 0xffff).toString(16).padStart(4, '0');
    hashed.push(withTail(first, tail));
  }
  return [...new Set([...fun, ...numbered, ...hashed])].filter(fits);
}

// → the first candidate whose key `isTaken` (a set-like with has(), or a predicate) does not
// report, or null when every candidate is taken. Keys, not display forms, are compared.
export function pickNick(email, isTaken) {
  const taken = typeof isTaken === 'function' ? isTaken : (key) => isTaken.has(key);
  return defaultNickCandidates(email).find((nick) => !taken(nickKey(nick))) ?? null;
}
