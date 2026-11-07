// The Configure it hint ladder in the real levels (#159 C2): every configure step of every level,
// through the registry, declares helps and has an authored tier 1 that names nothing the reference
// adds to the starting config or removes from it (a component id, a section it creates, a setting or value it writes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS } from '../levels/index.mjs';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { parseYaml } from '../lib/configure/parse.mjs';
import { configureHelps, hintFor } from '../lib/widgets/configure-it-help.mjs';
import { newConfigureState, runConfigure } from '../lib/widgets/configure-it.mjs';

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

/** Every scalar a config writes under a key, as `path = value`: values are not paths, but `routing_key: traceID` is a lesson. */
function leaves(node, base = [], out = new Map()) {
  if (Array.isArray(node)) {
    for (const v of node) if (v !== null && typeof v === 'object') leaves(v, base, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (v !== null && typeof v === 'object') leaves(v, [...base, k], out);
      else out.set([...base, k, String(v)].join(SEP), String(v));
    }
  }
  return out;
}

const loadDoc = (text) => {
  const r = parseYaml(text);
  assert.ok(r.ok, text);
  return r.doc;
};

/** Config keys that are also plain words the hints need (a component id is "the type, then a slash and a name"); the reference writes `type:` under a parser only. */
const PLAIN_WORDS = new Set(['type']);

/** What a hint must not name: the names and scalar values the reference adds, and the names of the starting config the reference drops or renames. Ids as whole words. */
function secrets(spec) {
  const [gd, rd] = [loadDoc(spec.given), loadDoc(spec.reference)];
  const [have, want] = [paths(gd), paths(rd)];
  const words = new Set();
  for (const path of want) if (!have.has(path)) words.add(path.split(SEP).at(-1)); // the new name, or the new value in a list
  for (const path of have) if (!want.has(path)) words.add(path.split(SEP).at(-1)); // a name the fix removes or renames
  const given = leaves(gd);
  for (const [path, value] of leaves(rd)) if (!given.has(path) && /\w{4,}/.test(value)) words.add(value);
  for (const w of PLAIN_WORDS) words.delete(w);
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
  assert.ok(secrets(STEPS.find((s) => s.level === 'agent-vs-gateway').spec).has('traceID'), 'a scalar the reference writes');
  assert.ok(secrets(STEPS.find((s) => s.level === 'collecting-logs').spec).has('filelog'), 'a name the fix renames away');
});

test('tier 1 names nothing the reference adds to the starting config', () => {
  for (const { level, spec } of STEPS) {
    const text = textOf(hintFor(spec, {}, '', 1, { e: escapeHtml }).html);
    for (const w of secrets(spec)) assert.ok(!has(text, w), `${level}/${spec.id}: tier 1 names "${w}": ${text}`);
  }
});

// ---- the grader agrees with the task (review of #238) ----------------------------------------

const specOf = (level) => STEPS.find((s) => s.level === level).spec;

test('agent-vs-gateway: sending metrics through load_balancing is wrong, the reference is right', () => {
  const spec = specOf('agent-vs-gateway');
  assert.equal(runConfigure(spec, newConfigureState(), spec.reference).outcome, 'right');
  const shortcut = spec.reference.replace(/(metrics:[\s\S]*?exporters: )\[otlp_grpc\/gateway\]/, '$1[load_balancing]');
  assert.notEqual(shortcut, spec.reference, 'the mutation changed the metrics exporters');
  const r = runConfigure(spec, newConfigureState(), shortcut);
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'uses', ['metrics']]);
});

test('agent-vs-gateway: metrics listing the gateway Service and load_balancing is wrong (reason forbids)', () => {
  const spec = specOf('agent-vs-gateway');
  assert.equal(runConfigure(spec, newConfigureState(), spec.reference).outcome, 'right');
  const both = spec.reference.replace(/(metrics:[\s\S]*?exporters: )\[otlp_grpc\/gateway\]/, '$1[otlp_grpc/gateway, load_balancing]');
  assert.notEqual(both, spec.reference, 'the mutation changed the metrics exporters');
  const r = runConfigure(spec, newConfigureState(), both);
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'forbids', ['metrics']]);
});

test('pipelines: deleting the health_check extension is wrong (reason extensions)', () => {
  const spec = specOf('pipelines');
  assert.equal(runConfigure(spec, newConfigureState(), spec.reference).outcome, 'right');
  const gone = spec.reference.replace('  extensions: [health_check]\n', '');
  assert.notEqual(gone, spec.reference);
  assert.equal(runConfigure(spec, newConfigureState(), gone).reason, 'extensions');
});

test('agent-vs-gateway: traces listing load_balancing and the gateway Service is wrong (reason forbids)', () => {
  const spec = specOf('agent-vs-gateway');
  const both = spec.reference.replace('exporters: [load_balancing]', 'exporters: [load_balancing, otlp_grpc/gateway]');
  assert.notEqual(both, spec.reference);
  const r = runConfigure(spec, newConfigureState(), both);
  assert.deepEqual([r.outcome, r.reason, r.unmet], ['wrong', 'forbids', ['traces']]);
});
