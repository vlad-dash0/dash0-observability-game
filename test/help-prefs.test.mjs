// The stored "Don't show again" choice for the how-to-play cards (lib/help-prefs.mjs, #199).
// Its own key, never oncall.progress; a corrupt or unreadable value means "show the card".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './helpers/fake-storage.mjs';
import { HELP_KEY, hideHelp, readHiddenHelp } from '../lib/help-prefs.mjs';

const at = (value) => fakeStorage({ initial: value === undefined ? {} : { [HELP_KEY]: value } });
const read = (store) => readHiddenHelp(() => store);
const sorted = (set) => [...set].sort();

test('HELP_KEY is its own key', () => {
  assert.equal(HELP_KEY, 'oncall.help');
});

test('readHiddenHelp: absent is fresh and empty', () => {
  const r = read(at());
  assert.equal(r.status, 'fresh');
  assert.deepEqual(sorted(r.hidden), []);
});

test('readHiddenHelp: a stored list is ok', () => {
  const r = read(at('{"v":1,"hidden":["sort","choice"]}'));
  assert.equal(r.status, 'ok');
  assert.deepEqual(sorted(r.hidden), ['choice', 'sort']);
});

test('readHiddenHelp: bad JSON, or the wrong shape, is corrupt and empty (the card shows)', () => {
  for (const text of ['{bad', '[]', '"x"', '{"hidden":["sort"]}', '{"v":1,"hidden":"sort"}', '{"v":1}']) {
    const r = read(at(text));
    assert.equal(r.status, 'corrupt', text);
    assert.equal(r.hidden.size, 0, text);
  }
});

test('readHiddenHelp: a newer version is future, best effort', () => {
  const r = read(at('{"v":2,"hidden":["sort"]}'));
  assert.equal(r.status, 'future');
  assert.deepEqual(sorted(r.hidden), ['sort']);
});

test('readHiddenHelp: a throwing storage is unavailable and empty', () => {
  for (const getStorage of [
    () => {
      throw new Error('blocked');
    },
    () => ({
      getItem() {
        throw new Error('blocked');
      },
    }),
  ]) {
    const r = readHiddenHelp(getStorage);
    assert.equal(r.status, 'unavailable');
    assert.equal(r.hidden.size, 0);
  }
});

test('readHiddenHelp: only well-formed ids, deduped, own keys, capped at 100', () => {
  const r = read(at(JSON.stringify({ v: 1, hidden: ['sort', 7, 'Bad Id', '__proto__', 'sort', null, 'constructor-x'] })));
  assert.deepEqual(sorted(r.hidden), ['constructor-x', 'sort']);
  const many = Array.from({ length: 150 }, (_, i) => `w-${i}`);
  assert.equal(read(at(JSON.stringify({ v: 1, hidden: many }))).hidden.size, 100);
});

test('hideHelp: reads, unions and writes sorted, keeping unknown stored keys', () => {
  const store = at('{"v":1,"hidden":["build","zz-later"]}');
  const r = hideHelp(() => store, ['sort', 'choice']);
  assert.deepEqual(r, { saved: true });
  assert.equal(store.data.get(HELP_KEY), '{"v":1,"hidden":["build","choice","sort","zz-later"]}');
});

test('hideHelp: a fresh store gets just the keys; bad keys are not written', () => {
  const store = at();
  assert.equal(hideHelp(() => store, ['sort', 'Bad Id', 'sort']).saved, true);
  assert.equal(store.data.get(HELP_KEY), '{"v":1,"hidden":["sort"]}');
});

test('hideHelp: a corrupt value is overwritten, with no backup key', () => {
  const store = at('{bad');
  assert.deepEqual(hideHelp(() => store, ['sort', 'choice']), { saved: true });
  assert.equal(store.data.get(HELP_KEY), '{"v":1,"hidden":["choice","sort"]}');
  assert.deepEqual([...store.data.keys()], [HELP_KEY]);
});

test('hideHelp: a newer version is refused and left byte-unchanged', () => {
  const text = '{"v":2,"hidden":["sort"],"x":1}';
  const store = at(text);
  assert.deepEqual(hideHelp(() => store, ['choice']), { saved: false, reason: 'future' });
  assert.equal(store.data.get(HELP_KEY), text);
  assert.equal(store.sets.length, 0);
});

test('hideHelp: a throwing setItem, getItem or getter is unavailable', () => {
  assert.deepEqual(hideHelp(() => fakeStorage({ throwOn: ['setItem'] }), ['sort']), { saved: false, reason: 'unavailable' });
  assert.deepEqual(hideHelp(() => fakeStorage({ throwOn: ['getItem'] }), ['sort']), { saved: false, reason: 'unavailable' });
  const blocked = () => {
    throw new Error('blocked');
  };
  assert.deepEqual(hideHelp(blocked, ['sort']), { saved: false, reason: 'unavailable' });
});
