// Level copy rules (docs/M1-DESIGN.md §1, §7): every level file names its spec in a
// `// Spec: <https URL>` line, level and card copy has no em dash, and every spec URL,
// in a level file or on a card, points at opentelemetry.io, www.w3.org, prometheus.io, perses.dev, developer.mozilla.org or www.dash0.com (the last for Dash0 product claims).
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
const SPEC_HOSTS = ['opentelemetry.io', 'www.w3.org', 'prometheus.io', 'perses.dev', 'developer.mozilla.org', 'www.dash0.com'];

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

test('every level file has a `// Spec: <https URL>` line on opentelemetry.io, www.w3.org, prometheus.io, perses.dev, developer.mozilla.org or www.dash0.com', () => {
  for (const f of LEVEL_FILES) {
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

test('every card specUrl is on opentelemetry.io, www.w3.org, prometheus.io, perses.dev, developer.mozilla.org or www.dash0.com', () => {
  for (const c of DECK) {
    assert.equal(SPEC_HOSTS.includes(hostOf(c.specUrl)), true, `${c.id}: ${c.specUrl}`);
  }
});

test('a Dash0 docs Spec line is accepted and lookalike hosts are not', () => {
  const src = '// Spec: https://www.dash0.com/docs/dash0/telemetry/logging/patterns\n';
  const [url] = specUrls(src);
  assert.equal(SPEC_HOSTS.includes(hostOf(url)), true);
  for (const bad of ['https://www.dash0.com.evil.example/', 'https://dash0.com.example/', 'https://evil.example/www.dash0.com/']) {
    assert.equal(SPEC_HOSTS.includes(hostOf(bad)), false, bad);
  }
});

test('the scanners have teeth: Spec line URLs and hosts', () => {
  const src = '// Spec: https://opentelemetry.io/a/#b , https://www.w3.org/TR/x/\n//Spec: https://no.example/\n';
  assert.deepEqual(specUrls(src), ['https://opentelemetry.io/a/#b', 'https://www.w3.org/TR/x/']);
  assert.deepEqual(specUrls('// Spec: docs/FOUNDATION.md §5'), []);
  assert.equal(SPEC_HOSTS.includes(hostOf('https://opentelemetry.io.evil.example/')), false);
  for (const ok of ['https://perses.dev/perses/docs/api/dashboard/', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS']) assert.equal(SPEC_HOSTS.includes(hostOf(ok)), true, ok);
  for (const bad of ['https://perses.dev.evil.example/', 'https://www.perses.dev/perses/docs/', 'https://perses.dev@evil.example/perses/docs/', 'https://evil.example/developer.mozilla.org/', 'https://mozilla.org/']) assert.equal(SPEC_HOSTS.includes(hostOf(bad)), false, bad);
});

// A penalty is not always a star (at 3+ penalties it may cost none), so player copy says
// "counts as one penalty", never "costs a star". Comment lines are not player copy.
const COST_A_STAR = /\bcosts? (?:a|one|1) star\b/i;
const codeLines = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
const COPY_FILES = [
  ...readdirSync(join(ROOT, 'lib/widgets')).filter((f) => f.endsWith('.mjs')).map((f) => `lib/widgets/${f}`),
  ...LEVEL_FILES.map((f) => `levels/${f}`),
];

test('no player-facing string in lib/widgets or levels says a penalty "costs a star"', () => {
  assert.ok(COPY_FILES.length > 20, 'the scan found the files');
  for (const rel of COPY_FILES) {
    const hit = codeLines(read(rel)).find((l) => COST_A_STAR.test(l));
    assert.equal(hit, undefined, `${rel}: say "counts as one penalty": ${hit?.trim()}`);
  }
});

test('the costs-a-star scanner has teeth: copy lines match, comment lines do not', () => {
  assert.ok(codeLines("x: 'A wrong pick costs a star.',").some((l) => COST_A_STAR.test(l)));
  assert.ok(codeLines("'Each cost one star'").some((l) => COST_A_STAR.test(l)));
  assert.ok(!codeLines('// a wrong pick costs a star').some((l) => COST_A_STAR.test(l)));
  assert.ok(!codeLines("'costs no star now'").some((l) => COST_A_STAR.test(l)));
});
