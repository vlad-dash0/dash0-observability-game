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
  assert.deepEqual(defaultNickCandidates('bob@dash0.com'), defaultNickCandidates('BOB@other.org'));
});

test('a short, reserved or blocked base falls back to player', () => {
  for (const email of ['jo@dash0.com', 'x_y@dash0.com', 'ADMIN@dash0.com', 'shit@dash0.com', 'nobody-at-all']) {
    assert.ok(first(email).startsWith('player'), email);
  }
});

test('never leaks the domain or the rest of the local part', () => {
  for (const nick of defaultNickCandidates('vlad.korobov@dash0.com')) {
    assert.ok(!/dash0|korobov|@/.test(nick), nick);
  }
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
  for (const r of ['admin', 'ADMIN', 'Dash0', 'o11y-king', 'player']) {
    assert.deepEqual(validateNick(r), { ok: false, reason: 'reserved' }, r);
  }
  for (const b of ['shit', 'xx-sh1t-xx', 'Sh1t99', 'F-u-c-k', 'fu_ck']) {
    assert.deepEqual(validateNick(b), { ok: false, reason: 'blocked' }, b);
  }
  assert.deepEqual(validateNick('a-b_c'), { ok: true });
});
