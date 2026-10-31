// Level copy rules (docs/M1-DESIGN.md §1, §7): every level file names its spec in a
// `// Spec: <https URL>` line, level and card copy has no em dash, and every spec URL,
// in a level file or on a card, points at opentelemetry.io or www.w3.org.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECK } from '../cards/deck.mjs';
import { liveRegistry } from '../app.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const LEVEL_FILES = readdirSync(join(ROOT, 'levels'))
  .filter((f) => f.endsWith('.mjs') && f !== 'index.mjs')
  .sort();
const SPEC_HOSTS = ['opentelemetry.io', 'www.w3.org'];

// M0's level 1.2 predates the rule: its Spec line cites docs/FOUNDATION.md. Remove it
// from this list when that file gains an https Spec line (the last test below insists).
const NO_SPEC_URL_YET = ['naming-your-service.mjs'];

/** The https URLs on a file's `// Spec:` lines (a line may list several, comma-separated). */
function specUrls(src) {
  return src
    .split('\n')
    .filter((line) => /^\/\/ Spec: /.test(line))
    .flatMap((line) => line.match(/https:\/\/[^\s,]+/g) ?? []);
}

const hostOf = (url) => new URL(url).host;

test('the level files are the registered levels (nothing scanned is unregistered)', () => {
  const ids = LEVEL_FILES.map((f) => f.replace(/\.mjs$/, '')).sort();
  assert.deepEqual(ids, [...liveRegistry().order].sort());
});

test('every level file has a `// Spec: <https URL>` line on opentelemetry.io or www.w3.org', () => {
  for (const f of LEVEL_FILES) {
    if (NO_SPEC_URL_YET.includes(f)) continue;
    const urls = specUrls(read(`levels/${f}`));
    assert.notEqual(urls.length, 0, `${f} has no // Spec: https line`);
    for (const url of urls) {
      assert.equal(SPEC_HOSTS.includes(hostOf(url)), true, `${f}: ${url}`);
    }
  }
});

test('no em dash in level files or cards', () => {
  for (const f of [...LEVEL_FILES.map((x) => `levels/${x}`), 'cards/deck.mjs']) {
    const lines = read(f).split('\n');
    const hits = lines.map((l, i) => (l.includes('—') ? i + 1 : 0)).filter(Boolean);
    assert.deepEqual(hits, [], `${f}: em dash on lines`);
  }
});

test('every card specUrl is on opentelemetry.io or www.w3.org', () => {
  for (const c of DECK) {
    assert.equal(SPEC_HOSTS.includes(hostOf(c.specUrl)), true, `${c.id}: ${c.specUrl}`);
  }
});

test('the scanners have teeth: Spec line URLs, hosts and the exemption list', () => {
  const src = '// Spec: https://opentelemetry.io/a/#b , https://www.w3.org/TR/x/\n//Spec: https://no.example/\n';
  assert.deepEqual(specUrls(src), ['https://opentelemetry.io/a/#b', 'https://www.w3.org/TR/x/']);
  assert.deepEqual(specUrls('// Spec: docs/FOUNDATION.md §5'), []);
  assert.equal(SPEC_HOSTS.includes(hostOf('https://opentelemetry.io.evil.example/')), false);
  for (const f of NO_SPEC_URL_YET) {
    assert.deepEqual(specUrls(read(`levels/${f}`)), [], `${f} has a Spec URL now: drop it from NO_SPEC_URL_YET`);
  }
});
