// lib/configure/check.mjs: validate parsed config against a declarative schema, name the
// offending key path, and say whether each pipeline flows. Spec: docs/M1-DESIGN.md §4.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, describeError, referenceProblems } from '../lib/configure/check.mjs';
import { validateSchema } from '../lib/configure/schema.mjs';

// A small SDK-shaped schema with deliberately odd names, so the checker is shown to be generic.
const SDK = {
  root: {
    type: 'mapping',
    required: ['file_format'],
    keys: {
      file_format: { type: 'string', enum: ['1.0', '1.1'] },
      disabled: { type: 'boolean' },
      log_level: { type: 'string', enum: ['debug', 'info', 'warn'] },
      ratio: { type: 'number' },
      max_attrs: { type: 'integer' },
      resource: {
        type: 'mapping',
        keys: {
          attributes: {
            type: 'list', min: 1,
            items: { type: 'mapping', required: ['name', 'value'], keys: { name: { type: 'string' }, value: { type: 'any' } } },
          },
        },
      },
      tags: { type: 'mapping', additional: { type: 'string' }, keyPattern: '^[a-z]+$', keyExpect: 'lower-case letters' },
      opts: { type: 'mapping', nullable: true, keys: { fast: { type: 'boolean' } } },
      pair: { type: 'mapping', min: 2, additional: { type: 'any' } },
    },
  },
};
const sdk = (text) => checkConfig(text, SDK);
const errs = (text) => sdk(text).errors;

test('a valid config is ok, with the parsed doc, no errors and no verdict (no pipelines in this schema)', () => {
  const r = sdk('file_format: "1.0"\ndisabled: false\nratio: 0.25\nmax_attrs: 128\nopts:\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.verdict, null);
  assert.deepEqual(r.doc, { file_format: '1.0', disabled: false, ratio: 0.25, max_attrs: 128, opts: null });
});

test('a parse failure is the only error, with no doc and no verdict', () => {
  const r = sdk('file_format: [1.0\n');
  assert.equal(r.ok, false);
  assert.equal(r.doc, null);
  assert.equal(r.verdict, null);
  assert.deepEqual(r.errors.map((e) => [e.kind, e.line, e.column]), [['parse', 2, 1]]);
});

test('a missing required key is named by its full path', () => {
  assert.deepEqual(errs('disabled: true'), [
    { kind: 'missing-key', path: 'file_format', message: 'missing required key "file_format"' },
  ]);
  assert.deepEqual(errs('file_format: "1.0"\nresource:\n  attributes:\n    - name: a\n      value: 1\n    - name: b\n    - value: 2'), [
    { kind: 'missing-key', path: 'resource.attributes[1].value', message: 'missing required key "value"' },
    { kind: 'missing-key', path: 'resource.attributes[2].name', message: 'missing required key "name"' },
  ]);
});

test('an unknown key is named, with the allowed keys sorted', () => {
  assert.deepEqual(errs('file_format: "1.0"\nlog_levl: info\nresource:\n  atributes: []'), [
    {
      kind: 'unknown-key', path: 'log_levl', message: 'unknown key "log_levl"',
      allowed: ['disabled', 'file_format', 'log_level', 'max_attrs', 'opts', 'pair', 'ratio', 'resource', 'tags'],
    },
    { kind: 'unknown-key', path: 'resource.atributes', message: 'unknown key "atributes"', allowed: ['attributes'] },
  ]);
});

test('keys named like Object.prototype members are unknown, not inherited', () => {
  assert.deepEqual(errs('file_format: "1.0"\nconstructor: 1\n__proto__: {x: 1}\ntoString: 2').map((e) => [e.kind, e.path]),
    [['unknown-key', 'constructor'], ['unknown-key', '__proto__'], ['unknown-key', 'toString']]);
});

test('a wrong type says what was expected and what was found', () => {
  const e = errs('file_format: 1.0\ndisabled: "no"\nratio: high\nmax_attrs: 1.5\nresource: [a]\ntags: x\nlog_level:\n');
  assert.deepEqual(e.map((x) => [x.path, x.message, x.expected, x.got]), [
    ['file_format', 'expected a string, got a number', 'string', 'number'],
    ['disabled', 'expected a boolean, got a string', 'boolean', 'string'],
    ['ratio', 'expected a number, got a string', 'number', 'string'],
    ['max_attrs', 'expected an integer, got a number', 'integer', 'number'],
    ['resource', 'expected a mapping, got a list', 'mapping', 'list'],
    ['tags', 'expected a mapping, got a string', 'mapping', 'string'],
    ['log_level', 'expected a string, got null', 'string', 'null'],
  ]);
  assert.deepEqual(errs('file_format: "1.0"\nresource:\n  attributes: {a: 1}').map((x) => [x.path, x.message]),
    [['resource.attributes', 'expected a list, got a mapping']]);
  assert.deepEqual(errs('file_format: "1.0"\nresource:\n  attributes:\n    - plain').map((x) => [x.path, x.message]),
    [['resource.attributes[0]', 'expected a mapping, got a string']]);
});

test('an enum value outside the set is named with the allowed values', () => {
  assert.deepEqual(errs('file_format: "2.0"\nlog_level: trace'), [
    { kind: 'bad-value', path: 'file_format', message: 'must be one of "1.0", "1.1"', allowed: ['1.0', '1.1'] },
    { kind: 'bad-value', path: 'log_level', message: 'must be one of "debug", "info", "warn"', allowed: ['debug', 'info', 'warn'] },
  ]);
});

test('a type error is reported once, and an enum is not checked on top of it', () => {
  assert.deepEqual(errs('file_format: 2').map((e) => e.kind), ['wrong-type']);
});

test('min counts: a list or mapping with too few entries', () => {
  assert.deepEqual(errs('file_format: "1.0"\nresource:\n  attributes: []\npair: {only: 1}'), [
    { kind: 'too-few', path: 'resource.attributes', message: 'needs at least 1 item', min: 1 },
    { kind: 'too-few', path: 'pair', message: 'needs at least 2 entries', min: 2 },
  ]);
});

test('key patterns apply to the keys of a mapping with `additional`', () => {
  assert.deepEqual(errs('file_format: "1.0"\ntags:\n  ok: fine\n  Bad: x\n  n2: 5'), [
    { kind: 'bad-key', path: 'tags.Bad', message: 'invalid key "Bad": expected lower-case letters' },
    { kind: 'bad-key', path: 'tags.n2', message: 'invalid key "n2": expected lower-case letters' },
  ]);
  // The value of an invalid key is not checked as well: one problem, one error.
  assert.deepEqual(errs('file_format: "1.0"\ntags:\n  Bad: 5').map((e) => e.kind), ['bad-key']);
  assert.deepEqual(errs('file_format: "1.0"\ntags:\n  ok: 5').map((e) => [e.path, e.message]),
    [['tags.ok', 'expected a string, got a number']]);
});

test('a nullable mapping accepts an empty value, and a plain one does not', () => {
  assert.deepEqual(errs('file_format: "1.0"\nopts:'), []);
  assert.deepEqual(errs('file_format: "1.0"\nresource:').map((e) => [e.path, e.message]),
    [['resource', 'expected a mapping, got null']]);
});

test('keys with dots or spaces are quoted in paths', () => {
  assert.deepEqual(errs('file_format: "1.0"\nresource:\n  "a.b c": 1').map((e) => e.path), ['resource["a.b c"]']);
});

test('errors come in document order: required first, then each key in the order written', () => {
  assert.deepEqual(errs('zzz: 1\nlog_level: nope\naaa: 2').map((e) => e.path), ['file_format', 'zzz', 'log_level', 'aaa']);
});

test('checkConfig refuses an invalid schema instead of passing everything', () => {
  assert.throws(() => checkConfig('a: 1', { root: { type: 'mapp' } }), /invalid schema: root: unknown type "mapp"/);
  assert.throws(() => checkConfig('a: 1', null), /invalid schema/);
});

test('validateSchema lists authoring mistakes with their location', () => {
  assert.deepEqual(validateSchema(SDK), []);
  assert.deepEqual(validateSchema({ root: { type: 'list' } }), ['root: a list needs items']);
  assert.deepEqual(validateSchema({ root: { type: 'mapping', required: ['x'], keys: { y: { type: 'string' } } } }),
    ['root: required key "x" is not in keys']);
  assert.deepEqual(validateSchema({ root: { type: 'mapping', keyPattern: '(' } }),
    ['root: keyPattern is not a valid regular expression']);
  assert.deepEqual(validateSchema({ root: { type: 'string', enum: [] } }), ['root: enum must be a non-empty list']);
  assert.deepEqual(validateSchema({ root: { type: 'mapping', keys: { a: { type: 'nope' } } } }),
    ['root.keys.a: unknown type "nope"']);
  assert.deepEqual(validateSchema({ root: { type: 'mapping' }, refs: [{ at: 'a[', in: ['b'] }] }),
    ['refs[0]: bad path pattern "a["']);
  assert.deepEqual(validateSchema({ root: { type: 'mapping' }, pipelines: { at: 'p', stages: [] } }),
    ['pipelines: stages must be a non-empty list']);
  assert.deepEqual(validateSchema({ root: { type: 'mapping' }, pipelines: { at: 'p', stages: [{ key: 'k', in: [] }] } }),
    ['pipelines.stages[0]: in must be a non-empty list of paths']);
});

test('validateSchema requires string fields where a path or pattern is expected', () => {
  const base = { root: { type: 'any' } };
  const v = (extra) => validateSchema({ ...base, ...extra });
  assert.deepEqual(v({ refs: [{ in: ['x'] }] }), ['refs[0]: at must be a string']);
  assert.deepEqual(v({ refs: [{ at: 5, in: ['x'] }] }), ['refs[0]: at must be a string']);
  assert.deepEqual(v({ refs: [{ at: 'a', in: [7] }] }), ['refs[0]: in entries must be strings']);
  assert.deepEqual(v({ refs: {} }), ['refs: must be a list']);
  assert.deepEqual(v({ refs: [null] }), ['refs[0]: a ref must be an object']);
  assert.deepEqual(v({ refs: [{ at: 'a', in: ['x'], aat: 'b' }] }), ['refs[0]: unknown property "aat"']);
  assert.deepEqual(v({ pipelines: { stages: [{ key: 'r', in: ['x'] }] } }), ['pipelines: at must be a string']);
  assert.deepEqual(v({ pipelines: { at: ['a'], stages: [{ key: 'r', in: ['x'] }] } }), ['pipelines: at must be a string']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ ky: 'r', in: ['x'] }] } }),
    ['pipelines.stages[0]: unknown property "ky"', 'pipelines.stages[0]: key must be a string']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ key: 'r.s', in: ['x'] }] } }),
    ['pipelines.stages[0]: key "r.s" must be a single plain key']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ key: '*', in: ['x'] }] } }),
    ['pipelines.stages[0]: key "*" must be a single plain key']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ key: 'r[]', in: ['x'] }] } }),
    ['pipelines.stages[0]: key "r[]" must be a single plain key']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ key: 'r', in: [null] }] } }),
    ['pipelines.stages[0]: in entries must be strings']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [7] } }), ['pipelines.stages[0]: a stage must be an object']);
  assert.deepEqual(v({ pipelines: 'x' }), ['pipelines: must be an object']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ key: 'r', in: ['x'] }] }, refz: [] }), ['schema: unknown property "refz"']);
  assert.deepEqual(v({ pipelines: { at: 'a', stages: [{ key: 'r', in: ['x'] }] } }), []);
});

test('validateSchema requires string or list-of-string node fields', () => {
  const m = (props) => validateSchema({ root: { type: 'mapping', ...props } });
  assert.deepEqual(m({ keyPattern: 5 }), ['root: keyPattern must be a string']);
  assert.deepEqual(m({ keyPattern: '^a$', keyExpect: 5 }), ['root: keyExpect must be a string']);
  assert.deepEqual(m({ keys: { a: { type: 'any' } }, required: 'a' }), ['root: required must be a list of strings']);
  assert.deepEqual(m({ keys: { a: { type: 'any' } }, required: [1] }), ['root: required must be a list of strings']);
});

// ---- cross-references ---------------------------------------------------------------

const WIRE = {
  root: {
    type: 'mapping',
    keys: {
      sinks: { type: 'mapping', additional: { type: 'any' } },
      taps: { type: 'mapping', additional: { type: 'any' } },
      jobs: { type: 'mapping', additional: { type: 'mapping', keys: { send_to: { type: 'list', items: { type: 'string' } } } } },
    },
  },
  refs: [{ at: 'jobs.*.send_to[]', in: ['sinks', 'taps'] }],
};
const wire = (text) => checkConfig(text, WIRE).errors;

test('refs: a name must be defined under one of the listed sections; the path names the item', () => {
  assert.deepEqual(wire('sinks: {s1: , s2: }\ntaps: {t1: }\njobs:\n  j1:\n    send_to: [s1, nope, t1]\n  j2:\n    send_to: [s2, s9]'), [
    { kind: 'unknown-ref', path: 'jobs.j1.send_to[1]', message: '"nope" is not defined under sinks or taps', ref: 'nope', in: ['sinks', 'taps'] },
    { kind: 'unknown-ref', path: 'jobs.j2.send_to[1]', message: '"s9" is not defined under sinks or taps', ref: 's9', in: ['sinks', 'taps'] },
  ]);
});

test('refs: a single section reads "under <section>"; a missing section defines nothing', () => {
  const one = { root: WIRE.root, refs: [{ at: 'jobs.*.send_to[]', in: ['sinks'] }] };
  assert.deepEqual(checkConfig('sinks: {a: }\njobs: {j: {send_to: [t1]}}', one).errors.map((e) => e.message),
    ['"t1" is not defined under sinks']);
  assert.deepEqual(wire('jobs: {j: {send_to: [a]}}').map((e) => e.path), ['jobs.j.send_to[0]']);
});

test('refs: a name equal to an inherited property name is still undefined', () => {
  assert.deepEqual(wire('sinks: {a: }\njobs: {j: {send_to: [constructor, toString]}}').map((e) => e.ref), ['constructor', 'toString']);
});

test('refs: non-string items are the schema\'s business, not a second error', () => {
  assert.deepEqual(wire('sinks: {a: }\njobs: {j: {send_to: [7]}}').map((e) => [e.kind, e.path]), [['wrong-type', 'jobs.j.send_to[0]']]);
});

// ---- referenceProblems and describeError ----------------------------------------------

test('describeError renders an error for a log or a test message', () => {
  assert.equal(describeError({ kind: 'unknown-key', path: 'a.b', message: 'unknown key "b"' }), 'a.b: unknown key "b"');
  assert.equal(describeError({ kind: 'parse', path: '', message: 'bad indentation of a mapping entry', line: 3, column: 2 }),
    'line 3, column 2: bad indentation of a mapping entry');
  assert.equal(describeError({ kind: 'root', path: '', message: 'the top level must be a mapping, got a list', line: null, column: null }),
    'the top level must be a mapping, got a list');
});

test('referenceProblems: a reference that passes, with a given that fails, has no problems', () => {
  assert.deepEqual(referenceProblems(SDK, 'file_format: "1.0"', 'disabled: true'), []);
  assert.deepEqual(referenceProblems(SDK, 'file_format: "1.0"'), []);
});

test('referenceProblems: names each way the reference fails its own checker', () => {
  assert.deepEqual(referenceProblems(SDK, 'file_format: "9"\nzzz: 1'), [
    'reference: file_format: must be one of "1.0", "1.1"',
    'reference: zzz: unknown key "zzz"',
  ]);
  assert.deepEqual(referenceProblems(SDK, 'a: [1'), ['reference: line 1, column 6: unexpected end of the stream within a flow collection']);
});

test('referenceProblems: a given that already passes is a problem (nothing to fix)', () => {
  assert.deepEqual(referenceProblems(SDK, 'file_format: "1.0"', 'file_format: "1.1"'),
    ['given: already passes the checker, so there is nothing to fix']);
});

test('referenceProblems: a given that does not parse still counts as failing', () => {
  assert.deepEqual(referenceProblems(SDK, 'file_format: "1.0"', 'a: [1'), []);
});

test('pipelineStages: stages in schema order with string items and their indexes; malformed or missing give empty stages', async () => {
  const { pipelineStages, pipelineComponents } = await import('../lib/configure/check.mjs');
  const { COLLECTOR_SCHEMA } = await import('../lib/configure/collector.mjs');
  const text = 'service:\n  pipelines:\n    traces:\n      receivers: [a, 3, b]\n      exporters: x\n    metrics: 5\n';
  const r = checkConfig(text, COLLECTOR_SCHEMA);
  const flat = (name) => pipelineStages(r, COLLECTOR_SCHEMA, name).map((s) => `${s.key}=${s.items.map(([i, v]) => `${i}:${v}`).join(',')}`).join(' ');
  assert.equal(flat('traces'), 'receivers=0:a,2:b processors= exporters=');
  assert.equal(flat('metrics'), 'receivers= processors= exporters=');
  assert.equal(flat('logs'), 'receivers= processors= exporters=');
  assert.equal([...pipelineComponents(r, COLLECTOR_SCHEMA, 'traces')].join(), 'a,b');
});
