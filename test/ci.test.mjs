// The CI merge gate (#35): an `All checks` job that needs every other job and fails unless
// all of them succeeded. Branch protection is unavailable on this plan, so this single
// status is what a merge waits on; a job left out of its `needs` would never gate a merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const GATE = 'all-checks';

// Minimal reader for the shape ci.yml uses: a top-level `jobs:` map whose ids sit at a
// two-space indent, `needs:` as a flow list (`[a, b]`), a block list or a single id.
// Anything else (anchors, other indents) is refused rather than guessed at.
function readJobs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) throw new Error('no top-level jobs: key');
  const jobs = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue; // blank or comment-only
    if (/^\S/.test(line)) break; // next top-level key
    const id = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (id) {
      current = { lines: [] };
      jobs.set(id[1], current);
    } else if (/^ {2}\S/.test(line) || !current) {
      throw new Error(`unexpected line in jobs: ${line}`);
    } else {
      current.lines.push(line);
    }
  }
  for (const job of jobs.values()) {
    job.text = job.lines.join('\n');
    const i = job.lines.findIndex((l) => /^ {4}needs:/.test(l));
    if (i < 0) { job.needs = []; continue; }
    const rest = job.lines[i].replace(/^ {4}needs:\s*/, '').replace(/\s+#.*$/, '');
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) throw new Error(`multi-line flow needs: ${rest}`);
      job.needs = rest.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (rest) {
      job.needs = [rest];
    } else {
      job.needs = [];
      for (const l of job.lines.slice(i + 1)) {
        const item = /^ {6}- ([\w-]+)\s*(?:#.*)?$/.exec(l);
        if (!item) break;
        job.needs.push(item[1]);
      }
    }
  }
  return jobs;
}

test('the job reader sees every job and each needs form', () => {
  const jobs = readJobs([
    'on: push',
    'jobs:',
    '  a:',
    '',
    '  # a comment between jobs',
    '    runs-on: x',
    '  b:',
    '    needs: [a, c]',
    '  c:',
    '    needs: a',
    '  d:',
    '    needs:',
    '      - a',
    '      - b # comment',
    '    steps: []',
    'env: {}',
  ].join('\n'));
  assert.deepEqual([...jobs.keys()], ['a', 'b', 'c', 'd']);
  assert.deepEqual(jobs.get('a').needs, []);
  assert.deepEqual(jobs.get('b').needs, ['a', 'c']);
  assert.deepEqual(jobs.get('c').needs, ['a']);
  assert.deepEqual(jobs.get('d').needs, ['a', 'b']);
  assert.throws(() => readJobs('jobs:\n   odd-indent:\n'), /unexpected|jobs/);
});

test('ci.yml has an all-checks job named exactly "All checks"', () => {
  const jobs = readJobs(CI);
  assert.ok(jobs.has(GATE), `ci.yml jobs: ${[...jobs.keys()].join(', ')}`);
  const names = jobs.get(GATE).lines.filter((l) => /^ {4}name:/.test(l));
  assert.deepEqual(names.map((l) => l.trim()), ['name: All checks']);
});

test('all-checks needs every other CI job', () => {
  const jobs = readJobs(CI);
  const others = [...jobs.keys()].filter((id) => id !== GATE);
  assert.ok(others.length > 0, 'expected at least the test job');
  const needs = jobs.get(GATE).needs;
  const missing = others.filter((id) => !needs.includes(id));
  assert.deepEqual(missing, [], `add these jobs to ${GATE}.needs`);
  const unknown = needs.filter((id) => !jobs.has(id));
  assert.deepEqual(unknown, [], 'all-checks needs jobs that do not exist');
});

test('all-checks runs always and fails unless every needed job succeeded', () => {
  const gate = readJobs(CI).get(GATE).text;
  // Without always() a failed dependency skips the gate, and a skipped check can read as
  // passing; the gate must run and report failure itself.
  assert.match(gate, /^ {4}if: always\(\)\s*$/m);
  assert.match(gate, /needs\.\*\.result/);
  assert.match(gate, /"\$r" = success/, 'each result must equal success (not merely "not failure")');
});

// Only ci.yml's jobs are gated. A new workflow file would add a check `All checks` does not
// wait on, so adding one means extending this list and gating its jobs deliberately.
const WORKFLOWS = ['ci.yml'];

test('every workflow file is on the allow-list', () => {
  const files = readdirSync(join(ROOT, '.github/workflows')).sort();
  assert.deepEqual(files, WORKFLOWS);
});
