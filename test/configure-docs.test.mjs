// docs/M1-DESIGN.md §4.8 states every message the checker emits. This keeps the doc and the
// code on one set of strings: each example below must appear in the doc AND be produced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { MAX_CHARS } from '../lib/configure/parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const design = read('docs/M1-DESIGN.md');
const section = design.slice(design.indexOf('### 4.8 '), design.indexOf('## 5. Phases'));

const SCHEMA = {
  root: {
    type: 'mapping', required: ['must'],
    keys: {
      must: { type: 'string', enum: ['1.0', '1.1'] },
      n: { type: 'integer' }, l: { type: 'list', min: 2, items: { type: 'any' } },
      m: { type: 'mapping', min: 1, additional: { type: 'any' } }, k: { type: 'mapping', additional: { type: 'any' }, keyPattern: '^[a-z]$' },
    },
  },
};
// [text of the doc, checker input, schema]
const EXAMPLES = [
  ['the file is longer than 32768 characters', `a: ${'x'.repeat(MAX_CHARS)}`, SCHEMA],
  ['bad indentation of a mapping entry', 'a: b: c', SCHEMA],
  ['unknown tag !<tag:yaml.org,2002:js/function>', 'a: !!js/function x', SCHEMA],
  ['expected a single document in the stream, but found more', 'a: 1\n---\nb: 2', SCHEMA],
  ['duplicate key', 'a: 1\na: 2', SCHEMA],
  ['the top level must be a mapping, got a list', '- 1', SCHEMA],
  ['the top level must be a mapping, got an empty document', '', SCHEMA],
  ['aliases (*name) are not supported', 'a: &a [1]\nb: *a', SCHEMA],
  ['expected a mapping, got a list', 'must: "1.0"\nm: [1]', SCHEMA],
  ['expected an integer, got a string', 'must: "1.0"\nn: x', SCHEMA],
  ['must be one of "1.0", "1.1"', 'must: "2"', SCHEMA],
  ['missing required key "exporters"', 'service:\n  pipelines:\n    traces:\n      receivers: [a]', COLLECTOR_SCHEMA],
  ['unknown key "log_levl"', 'must: "1.0"\nlog_levl: 1', SCHEMA],
  ['invalid key "Bad": expected', 'must: "1.0"\nk: {Bad: 1}', SCHEMA],
  ['needs at least 2 items', 'must: "1.0"\nl: [1]', SCHEMA],
  ['needs at least 1 entry', 'must: "1.0"\nm: {}', SCHEMA],
  ['"otlp/typo" is not defined under exporters or connectors',
    'receivers: {otlp: }\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [otlp/typo]', COLLECTOR_SCHEMA],
];

test('every message example in §4.8 is in the doc and is what the checker emits', () => {
  for (const [example, text, schema] of EXAMPLES) {
    assert.ok(section.includes(example), `§4.8 does not state ${JSON.stringify(example)}`);
    const messages = checkConfig(text, schema).errors.map((e) => e.message);
    assert.ok(messages.some((m) => m.includes(example)), `${JSON.stringify(example)} is not emitted; got ${JSON.stringify(messages)}`);
  }
});

test('§4.8 and the code agree on the vendored parser, the size cap and the default key message', () => {
  assert.ok(section.includes('vendor/js-yaml-4.3.2.mjs'));
  assert.ok(section.includes('`MAX_CHARS` = 32768'));
  assert.match(read('lib/configure/parse.mjs'), /from '\.\.\/\.\.\/vendor\/js-yaml-4\.3\.2\.mjs'/);
  const defaulted = { root: { type: 'mapping', additional: { type: 'any' }, keyPattern: '^[a-z]+$' } };
  assert.equal(checkConfig('A: 1', defaulted).errors[0].message, 'invalid key "A": expected a key matching ^[a-z]+$');
  assert.ok(section.includes('a key matching <keyPattern>'));
});
