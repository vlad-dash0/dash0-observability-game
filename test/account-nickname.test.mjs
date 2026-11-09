// Nicknames: validation, uniqueness key, fun deterministic defaults. Spec: #273 design
// section 2 and owner amendment D1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultNickCandidates, nickKey, pickNick, validateNick } from '../lib/account/nickname.mjs';

const first = (email) => defaultNickCandidates(email)[0];

test('the three owner examples, exactly', () => {
  assert.equal(first('vlad@dash0.com'), 'vladster');
  assert.equal(first('bob@dash0.com'), 'bobber');
  assert.equal(first('kyle@dash0.com'), 'kyloton');
});

test('base: first token, case and +tag folded, deterministic', () => {
  assert.equal(first('Vlad.Smith+news@dash0.com'), 'vladster');
  assert.equal(first('vlad_k@dash0.com'), 'vladster');
  assert.deepEqual(defaultNickCandidates('bob@dash0.com'), defaultNickCandidates('BOB@Dash0.com'));
  assert.deepEqual(defaultNickCandidates('bob@dash0.com').slice(0, 100), defaultNickCandidates('BOB@other.org').slice(0, 100));
});

test('a short, reserved or blocked base falls back to player', () => {
  for (const email of ['jo@dash0.com', 'x_y@dash0.com', 'ADMIN@dash0.com', 'shit@dash0.com', 'nobody-at-all']) {
    assert.ok(first(email).startsWith('player'), email);
  }
});

test('never leaks the domain or the rest of the local part', () => {
  for (const nick of defaultNickCandidates('ada.lovelace@dash0.com')) {
    assert.ok(!/lovel|dash0|@/.test(nick), nick);
  }
});

test('the er rule never doubles a final w, x or y, nor follows a vowel pair', () => {
  for (const email of ['jay@dash0.com', 'alex@dash0.com', 'drew@dash0.com']) {
    for (const nick of defaultNickCandidates(email)) assert.ok(!/yy|xx|ww/.test(nick), nick);
  }
  assert.ok(!defaultNickCandidates('joan@dash0.com').includes('joanner'));
});

test('accents are stripped, and the local part ends at the first @', () => {
  assert.equal(first('émile@dash0.com'), defaultNickCandidates('emile@dash0.com')[0]);
  assert.ok(first('émile@dash0.com').startsWith('emile'));
  assert.equal(first('vlad@evil@dash0.com'), 'vladster');
  assert.equal(first('bob@x@y'), 'bobber');
});

test('fallback emails get their own hex tails: deterministic, no email text', () => {
  const tails = (email) => defaultNickCandidates(email).filter((n) => /-[0-9a-f]{4}$/.test(n) && !/-\d+$/.test(n));
  const a = tails('jo@dash0.com');
  const b = tails('al@dash0.com');
  assert.ok(a.length > 0);
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, tails('JO@dash0.com'));
  for (const n of a) assert.ok(!/dash0|@/.test(n), n);
});

test('candidates are finite, unique, valid and not blocked', () => {
  for (const email of ['vlad@dash0.com', 'bob@dash0.com', 'kyle@dash0.com', 'jo@dash0.com', 'abcdefghijklmnop@dash0.com']) {
    const list = defaultNickCandidates(email);
    assert.ok(list.length > 50 && list.length < 200, email);
    assert.equal(new Set(list).size, list.length);
    for (const nick of list) assert.deepEqual(validateNick(nick), { ok: true }, nick);
  }
});

test('collision: the next rule, then numbered, keyed on the lowercase key', () => {
  assert.equal(pickNick('vlad@dash0.com', new Set(['vladster'])), 'vladder');
  const all = defaultNickCandidates('vlad@dash0.com');
  const taken = new Set(all.slice(0, 4).map((n) => n.toLowerCase()));
  assert.equal(pickNick('vlad@dash0.com', taken), 'vladster-2');
  assert.equal(pickNick('vlad@dash0.com', new Set(all.map((n) => n.toLowerCase()))), null);
});

test('nickKey lowercases, and is null for invalid names', () => {
  assert.equal(nickKey('Ada'), 'ada');
  assert.equal(nickKey('ADA'), nickKey('ada'));
  assert.equal(nickKey('a'), null);
  assert.equal(nickKey('Admin'), null);
});

test('validation at the length edges', () => {
  assert.deepEqual(validateNick('ab'), { ok: false, reason: 'format' });
  assert.deepEqual(validateNick('abc'), { ok: true });
  assert.deepEqual(validateNick('a'.repeat(20)), { ok: true });
  assert.deepEqual(validateNick('a'.repeat(21)), { ok: false, reason: 'format' });
});

test('validation: charset, reserved and blocked (leet folded)', () => {
  for (const bad of ['-abc', '_abc', 'a b c', 'ab@c', 'café', '', null, 5]) {
    assert.deepEqual(validateNick(bad), { ok: false, reason: 'format' }, String(bad));
  }
  for (const r of ['admin', 'ADMIN', 'Dash0', 'o11y-king', 'player', 'adm1n', 'ADM1N', 'dasho', 'pl4yer']) {
    assert.deepEqual(validateNick(r), { ok: false, reason: 'reserved' }, r);
  }
  for (const b of ['shit', 'xx-sh1t-xx', 'Sh1t99', 'F-u-c-k', 'fu_ck']) {
    assert.deepEqual(validateNick(b), { ok: false, reason: 'blocked' }, b);
  }
  assert.deepEqual(validateNick('a-b_c'), { ok: true });
});

test('short blocked words count only as a whole token; long ones as a substring', () => {
  for (const ok of ['Kshitij', 'Draper', 'grape', 'Essex-fan']) assert.deepEqual(validateNick(ok), { ok: true }, ok);
  for (const bad of ['shit', 'rape_x', 'x-rape', 'sh1t', 'bigfuckers', 'a-whore-x']) {
    assert.deepEqual(validateNick(bad), { ok: false, reason: 'blocked' }, bad);
  }
});
