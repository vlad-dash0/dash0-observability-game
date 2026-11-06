// A Spot it decoy's whyNot is shown on a failed Check for every decoy picked, so it must not hand over an answer:
// no whyNot text may contain a fault line's key (the text before `=`) or the fault line's full text. Otherwise
// one Check with every line picked reads the answers off the feedback. Specs come from the live registry, so a
// new Spot board is covered without editing this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';

/** Every Spot it spec, as { no, spec }, from declarative (play.steps) and hand-written (CONTENT.steps) levels. */
async function allSpotSpecs() {
  const out = [];
  for (const act of ACTS) {
    for (const level of [...act.levels, ...(act.boss ? [act.boss] : [])]) {
      const mod = await import(`../levels/${level.id}.mjs`);
      const byId = new Map();
      for (const s of [...(mod.default.play?.steps ?? []), ...(mod.CONTENT?.steps ?? [])]) if (s?.spot) byId.set(s.spot.id, s.spot);
      for (const spec of byId.values()) out.push({ no: mod.default.no, spec });
    }
  }
  return out;
}

const plain = (html) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `text` contain `needle` as a whole name (not inside a longer one; a sentence-ending dot is fine)? */
const mentions = (text, needle) => new RegExp(`(?<![\\w.])${escapeRe(needle)}(?!\\w|\\.\\w)`).test(text);

/** The fault names a decoy's whyNot gives away: `<fault id>: <what it names>`, for every decoy of the spec. */
export function leaks(spec) {
  const found = [];
  const faults = spec.lines.filter((l) => spec.faults.includes(l.id));
  for (const [decoy, why] of Object.entries(spec.whyNot ?? {})) {
    const text = plain(why);
    for (const f of faults) {
      const at = f.text.indexOf('=');
      const key = at > 0 ? f.text.slice(0, at).trim() : null;
      if (text.includes(f.text)) found.push(`${decoy} -> ${f.id}: its full text`);
      else if (key && mentions(text, key)) found.push(`${decoy} -> ${f.id}: its key ${key}`);
    }
  }
  return found;
}

// Known and deferred: boards whose decoy explanations still name a fault line. Pinned to exactly what leaks today:
// fixing a board fails this test until its entry goes. No board may be added here without an issue.
const KNOWN = {};

test('leaks reads a key as a whole name, and a full line', () => {
  const spec = {
    lines: [{ id: 'a', text: 'http.method=POST' }, { id: 'b', text: 'http.request.method=POST' }, { id: 'c', text: 'x' }],
    faults: ['a'],
    whyNot: { b: 'It replaced <code>http.method</code>.', c: 'http.request.method is fine; http.method_original too.' },
  };
  assert.deepEqual(leaks(spec), ['b -> a: its key http.method']);
  assert.deepEqual(leaks({ ...spec, whyNot: { b: 'Seen as http.method=POST here.' } }), ['b -> a: its full text']);
  assert.deepEqual(leaks({ ...spec, whyNot: { b: 'The stable name for the request method.' } }), []);
});

test('no Spot board has a decoy whyNot that names a fault line (key or full text)', async () => {
  const specs = await allSpotSpecs();
  assert.equal(specs.length >= 8, true, 'the boards are seen');
  const found = {};
  for (const { no, spec } of specs) {
    const l = leaks(spec);
    if (l.length) found[`${no} ${spec.id}`] = l;
  }
  assert.deepEqual(found, KNOWN, 'boards whose decoy explanation names a fault line');
});
