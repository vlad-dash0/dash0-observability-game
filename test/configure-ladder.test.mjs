// The Configure it hint ladder in the real levels (#159 C2): every configure step of every level,
// through the registry, declares helps and has an authored tier 1 that names nothing the reference
// adds to the starting config (a component id, a section it creates, a setting it writes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { parseYaml } from '../lib/configure/parse.mjs';
import { configureHelps, hintFor } from '../lib/widgets/configure-it-help.mjs';

const levels = ACTS.flatMap((a) => [...a.levels, ...(a.boss ? [a.boss] : [])]);
const STEPS = levels.flatMap((lv) => (lv.play?.steps ?? []).filter((s) => s.configure).map((s) => ({ level: lv.id, spec: s.configure })));

const SEP = '\u0000';

/** Every path of a config, joined with a NUL (ids hold dots and slashes); a list of plain values contributes one path per value. */
function paths(node, base = [], out = new Set()) {
  if (Array.isArray(node)) {
    for (const v of node) {
      if (v !== null && typeof v === 'object') paths(v, base, out);
      else out.add([...base, String(v)].join(SEP));
    }
  } else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.add([...base, k].join(SEP));
      paths(v, [...base, k], out);
    }
  }
  return out;
}

const load = (text) => {
  const r = parseYaml(text);
  assert.ok(r.ok, text);
  return paths(r.doc);
};

/** What the reference adds that the starting config lacks: the names it writes, ids as whole words. */
function secrets(spec) {
  const have = load(spec.given);
  const words = new Set();
  for (const path of load(spec.reference)) {
    if (have.has(path)) continue;
    words.add(path.split(SEP).at(-1)); // the new name, or the new value in a list
  }
  return words;
}

const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'");
const has = (text, word) => new RegExp(`(^|[^\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(text);

test('the registry has configure steps to check', () => {
  assert.equal(STEPS.length, 6, STEPS.map((s) => s.level).join());
});

test('every configure step declares helps.hints and has an authored hint', () => {
  for (const { level, spec } of STEPS) {
    assert.equal(configureHelps(spec).hints, true, `${level}/${spec.id}: no helps.hints`);
    assert.ok(typeof spec.hint === 'string' && spec.hint.trim() !== '', `${level}/${spec.id}: no authored hint`);
  }
});

test('the secrets of a step are derived from its reference, not empty', () => {
  for (const { level, spec } of STEPS) assert.ok(secrets(spec).size > 0, `${level}/${spec.id}`);
  const known = secrets(STEPS.find((s) => s.level === 'pipelines').spec);
  assert.ok(known.has('memory_limiter') && known.has('health_check'));
});

test('tier 1 names nothing the reference adds to the starting config', () => {
  for (const { level, spec } of STEPS) {
    const text = textOf(hintFor(spec, {}, '', 1, { e: escapeHtml }).html);
    for (const w of secrets(spec)) assert.ok(!has(text, w), `${level}/${spec.id}: tier 1 names "${w}": ${text}`);
  }
});
