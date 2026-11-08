// Save codes (#18): the codec, every refusal, and the merge an import does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSALS, SAVE_VERSION, decodeProgress, encodeProgress, previewImport } from '../lib/save-code.mjs';
import { emptyProgress, mergeProgress, registryIds } from '../lib/progress.mjs';

const level = (id, no, extra = {}) => ({ id, no, name: `Level ${id}`, actId: 'a0', kind: 'level', scored: true, cards: [], ...extra });
const REG = {
  acts: [{ id: 'a0', no: 0, name: 'A0', sub: '', levelIds: ['a', 'b', 'c', 'd'], bossId: null }],
  levels: { a: level('a', '0.1'), b: level('b', '0.2'), c: level('c', '0.3'), d: level('d', '0.4', { scored: false }) },
  order: ['a', 'b', 'c', 'd'],
  cardIds: ['c1', 'c2', 'c3'],
};
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-03T04:05:06.789Z';
const rec = (levels, cards = []) => ({ v: 1, levels, cards });

// Local is better on a, the code is better on b, only the code has c, only local has d.
const LOCAL = rec({ a: { stars: 5, at: T2 }, b: { stars: 1, at: T1 }, d: { stars: 0, at: null } }, ['c1']);
const CODE = rec({ a: { stars: 2, at: T1 }, b: { stars: 4, at: T2 }, c: { stars: 3, at: T2 } }, ['c2', 'c3']);

// A code with a hand-made payload and a correct checksum, to reach the shape checks.
function forge(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const b64 = Buffer.from(bytes).toString('base64url');
  const head = `oc${SAVE_VERSION}.${b64}`;
  return `${head}.${checksumOf(head)}`;
  function checksumOf(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
// Records hold null-prototype level maps; compare them as plain JSON.
const norm = (r) => JSON.parse(JSON.stringify(r));
const refused = (code) => decodeProgress(code, REG);

test('the code is versioned, three dot-separated parts, and round trips exactly', () => {
  const code = encodeProgress(LOCAL, REG);
  assert.match(code, /^oc1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const got = decodeProgress(code, REG);
  assert.equal(got.ok, true);
  assert.equal(got.dropped, 0);
  assert.deepEqual(norm(got.progress), LOCAL);
});

test('an empty record round trips; the code is short for a small save', () => {
  const code = encodeProgress(emptyProgress(), REG);
  assert.deepEqual(norm(decodeProgress(code, REG).progress), norm(emptyProgress()));
  assert.ok(encodeProgress(CODE, REG).length < 160);
});

test('whitespace and line breaks from copying are ignored', () => {
  const code = encodeProgress(CODE, REG);
  const wrapped = `  ${code.slice(0, 10)}\n${code.slice(10, 30)} \t${code.slice(30)}\n`;
  assert.deepEqual(norm(decodeProgress(wrapped, REG).progress), CODE);
});

test('encode writes only registry ids, so an unknown level never leaves this browser', () => {
  const code = encodeProgress(rec({ a: { stars: 1, at: null }, zzz: { stars: 5, at: null } }, ['c1', 'ghost']), REG);
  const got = decodeProgress(code, REG);
  assert.deepEqual(Object.keys(got.progress.levels), ['a']);
  assert.deepEqual(got.progress.cards, ['c1']);
});

test('ids this build does not know are dropped and counted, never invented', () => {
  const code = forge({ l: [['a', 3, null], ['future-level', 5, null]], c: ['c1', 'future-card'] });
  const got = decodeProgress(code, REG);
  assert.equal(got.ok, true);
  assert.deepEqual(norm(got.progress), rec({ a: { stars: 3, at: null } }, ['c1']));
  assert.equal(got.dropped, 2);
});

test('refuses: empty, not a string, no code shape', () => {
  assert.deepEqual(refused(''), { ok: false, reason: 'empty' });
  assert.deepEqual(refused(' \n '), { ok: false, reason: 'empty' });
  for (const bad of [null, undefined, 42, {}, 'hello', 'oc1', 'oc1.abc', 'oc1..', 'oc1.abc.1234', 'oc1.a!b.12345678', 'x'.repeat(30000)]) {
    assert.deepEqual(refused(bad), { ok: false, reason: 'format' }, String(bad).slice(0, 20));
  }
});

test('refuses another version, before it looks at the checksum or payload', () => {
  const code = encodeProgress(LOCAL, REG);
  assert.deepEqual(refused(code.replace(/^oc1/, 'oc2')), { ok: false, reason: 'version' });
  assert.deepEqual(refused(code.replace(/^oc1/, 'oc0')), { ok: false, reason: 'version' });
  assert.deepEqual(refused(code.replace(/^oc1/, 'oc12')), { ok: false, reason: 'version' });
});

test('refuses a bad checksum: a changed character, a cut-off payload, a changed checksum', () => {
  const [head, payload, sum] = encodeProgress(LOCAL, REG).split('.');
  const flip = payload[5] === 'A' ? 'B' : 'A';
  assert.deepEqual(refused(`${head}.${payload.slice(0, 5)}${flip}${payload.slice(6)}.${sum}`), { ok: false, reason: 'checksum' });
  assert.deepEqual(refused(`${head}.${payload.slice(0, -4)}.${sum}`), { ok: false, reason: 'checksum' });
  const wrongSum = sum[0] === '0' ? `1${sum.slice(1)}` : `0${sum.slice(1)}`;
  assert.deepEqual(refused(`${head}.${payload}.${wrongSum}`), { ok: false, reason: 'checksum' });
});

test('refuses a truncated code (cut before the checksum is whole)', () => {
  const code = encodeProgress(LOCAL, REG);
  for (const n of [3, 10, code.length - 9, code.length - 1]) {
    assert.equal(refused(code.slice(0, n)).ok, false, `cut at ${n}`);
  }
  assert.equal(refused(code.slice(0, -1)).reason, 'format');
});

test('refuses a wrong shape even with a valid checksum, and imports nothing of it', () => {
  const shapes = {
    'not json': 'plain text',
    'an array': [],
    'null': null,
    'no cards': { l: [] },
    'no levels': { c: [] },
    'levels not a list': { l: {}, c: [] },
    'row too short': { l: [['a', 1]], c: [] },
    'row not a list': { l: ['a'], c: [] },
    'bad id': { l: [['A b', 1, null]], c: [] },
    'reserved id': { l: [['constructor', 1, null]], c: [] },
    'id not a string': { l: [[7, 1, null]], c: [] },
    'stars as text': { l: [['a', '3', null]], c: [] },
    'stars fractional': { l: [['a', 2.5, null]], c: [] },
    'stars too many': { l: [['a', 6, null]], c: [] },
    'stars negative': { l: [['a', -1, null]], c: [] },
    'bad time': { l: [['a', 1, 'NOT A TIME!']], c: [] },
    'time as number': { l: [['a', 1, 12345]], c: [] },
    'duplicate level': { l: [['a', 1, null], ['a', 2, null]], c: [] },
    'bad card id': { l: [], c: ['Bad Card'] },
    'card not a string': { l: [], c: [3] },
    'duplicate card': { l: [], c: ['c1', 'c1'] },
    'one good, one bad row': { l: [['a', 3, null], ['b', 'x', null]], c: ['c1'] },
    'too many levels': { l: Array.from({ length: 501 }, (_, i) => [`l${i}`, 1, null]), c: [] },
  };
  for (const [name, payload] of Object.entries(shapes)) {
    assert.deepEqual(refused(forge(payload)), { ok: false, reason: 'shape' }, name);
  }
});

test('a payload that is not valid UTF-8 is a shape refusal; decode never throws', () => {
  const head = 'oc1.gP8';
  let h = 0x811c9dc5;
  for (let i = 0; i < head.length; i++) h = Math.imul(h ^ head.charCodeAt(i), 0x01000193);
  const code = `${head}.${(h >>> 0).toString(16).padStart(8, '0')}`;
  assert.deepEqual(refused(code), { ok: false, reason: 'shape' });
  assert.doesNotThrow(() => decodeProgress(code, undefined));
  assert.deepEqual(decodeProgress(encodeProgress(LOCAL, REG), undefined), { ok: false, reason: 'shape' });
});

test('every refusal reason has player text, plain, with no em dash', () => {
  assert.deepEqual(Object.keys(REFUSALS).sort(), ['checksum', 'empty', 'format', 'shape', 'version']);
  for (const t of Object.values(REFUSALS)) assert.ok(t.length > 10 && !t.includes('—'));
});

test('import preview with unequal fixtures: added, improved, kept, new cards, in both directions', () => {
  const p = previewImport(LOCAL, CODE, REG);
  assert.deepEqual(p.added, [{ id: 'c', stars: 3 }]);
  assert.deepEqual(p.improved, [{ id: 'b', from: 1, to: 4 }]);
  assert.deepEqual(p.kept, ['a']);
  assert.equal(p.newCards, 2);
  assert.equal(p.changed, true);
});

test('the merged record keeps the better of each side and never lowers anything', () => {
  const { merged } = previewImport(LOCAL, CODE, REG);
  assert.deepEqual(norm(merged.levels), {
    a: { stars: 5, at: T1 }, // local stars win, earliest time wins
    b: { stars: 4, at: T1 },
    c: { stars: 3, at: T2 },
    d: { stars: 0, at: null }, // local only, a 0-star completion stays complete
  });
  assert.deepEqual(merged.cards, ['c1', 'c2', 'c3']);
  assert.deepEqual(norm(merged), norm(mergeProgress(CODE, LOCAL, { keep: registryIds(REG) })));
  for (const id of Object.keys(LOCAL.levels)) assert.ok(merged.levels[id].stars >= LOCAL.levels[id].stars);
});

test('importing a code that is worse than local changes nothing', () => {
  const worse = rec({ a: { stars: 1, at: T2 }, b: { stars: 0, at: null } }, ['c1']);
  const p = previewImport(LOCAL, worse, REG);
  assert.equal(p.changed, false);
  assert.deepEqual(p.added, []);
  assert.deepEqual(p.improved, []);
  assert.deepEqual(p.kept, ['a', 'b']);
  assert.deepEqual(norm(p.merged), norm(mergeProgress(LOCAL, LOCAL, { keep: registryIds(REG) })));
});

test('importing your own code again is not a change; into empty progress everything is added', () => {
  assert.equal(previewImport(LOCAL, LOCAL, REG).changed, false);
  const fresh = previewImport(emptyProgress(), LOCAL, REG);
  assert.deepEqual(fresh.added.map((a) => a.id), ['a', 'b', 'd']);
  assert.deepEqual(norm(fresh.merged), LOCAL);
  assert.equal(previewImport(LOCAL, emptyProgress(), REG).changed, false);
});

test('a 0-star completion imported over nothing counts as added', () => {
  const p = previewImport(emptyProgress(), rec({ a: { stars: 0, at: null } }), REG);
  assert.deepEqual(p.added, [{ id: 'a', stars: 0 }]);
});
