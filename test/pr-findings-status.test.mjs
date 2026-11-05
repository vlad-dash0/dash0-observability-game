// The PR findings check in CI: tools/pr-findings-status.mjs runs the detector
// (tools/pr-findings.mjs `run`, the same code a local run uses) and posts its verdict as
// the `PR findings` commit status on the PR head. The workflow files that call it are
// checked for fork safety: the job that can write a status runs main's code only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../vendor/js-yaml-5.5.0.mjs';
import { CONTEXT, RELAY, report, resolvePrs, statusFor } from '../tools/pr-findings-status.mjs';
import { run } from '../tools/pr-findings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(40);

// A fake `gh` for the REST calls: GET a PR, list PRs by head, POST a status.
function fakeGh({ pr = { state: 'open', draft: false, head: { sha: SHA } }, pulls = [], failPost = false } = {}) {
  const calls = [];
  const posts = [];
  const gh = async (args) => {
    calls.push(args);
    const path = args.find((a) => a.startsWith('repos/'));
    if (/\/statuses\//.test(path)) {
      if (failPost) throw new Error('gh: HTTP 403');
      // Fields only as `-f key=value` pairs, so no value is ever parsed as a flag.
      const f = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '-f' ? [a.split(/=(.*)/s).slice(0, 2)] : [])));
      posts.push({ sha: path.split('/').at(-1), ...f });
      return '{}';
    }
    if (/\/pulls\/\d+$/.test(path)) return JSON.stringify(pr);
    if (/\/pulls$/.test(path)) return JSON.stringify(pulls);
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, calls, posts };
}
const quiet = () => {};
const detector = (exit, last) => async ({ log }) => { log('PR acme/game#7'); log(last); return exit; };

// --- the verdict ------------------------------------------------------------------------

test('statusFor: PASS is success, OPEN failure, INCONCLUSIVE error, on a ready PR', () => {
  assert.deepEqual(statusFor({ exit: 0, draft: false, summary: 'PASS: 2 finding(s)' }), { state: 'success', description: 'PASS: 2 finding(s)' });
  assert.deepEqual(statusFor({ exit: 1, draft: false, summary: 'OPEN: 1 of 2' }), { state: 'failure', description: 'OPEN: 1 of 2' });
  assert.deepEqual(statusFor({ exit: 2, draft: false, summary: 'INCONCLUSIVE: no review' }), { state: 'error', description: 'INCONCLUSIVE: no review' });
});

test('statusFor: an exit code the detector does not define is an error, never success', () => {
  for (const exit of [3, -1, null, undefined, '0']) {
    assert.equal(statusFor({ exit, draft: false, summary: 'x' }).state, 'error', String(exit));
  }
});

test('statusFor: a draft is pending (not gated) whatever the verdict, and says what it would be', () => {
  for (const exit of [0, 1, 2]) {
    const s = statusFor({ exit, draft: true, summary: 'OPEN: 1 of 2' });
    assert.equal(s.state, 'pending');
    assert.equal(s.description, 'Draft, not gated yet. OPEN: 1 of 2');
  }
});

test('statusFor: the description fits GitHub\'s 140-character limit', () => {
  const s = statusFor({ exit: 1, draft: false, summary: 'x'.repeat(300) });
  assert.equal(s.description.length, 140);
  assert.ok(s.description.endsWith('…'));
});

// --- which PRs an event names ---------------------------------------------------------------

test('resolvePrs: a comment on a PR names it; a comment on an issue names none', async () => {
  const { gh } = fakeGh();
  assert.deepEqual(await resolvePrs({ name: 'issue_comment', event: { issue: { number: 12, pull_request: { url: 'u' } } }, repo: 'acme/game', gh }), [12]);
  assert.deepEqual(await resolvePrs({ name: 'issue_comment', event: { issue: { number: 13 } }, repo: 'acme/game', gh }), []);
});

test('resolvePrs: a manual run takes a PR number and nothing else', async () => {
  const { gh } = fakeGh();
  assert.deepEqual(await resolvePrs({ name: 'workflow_dispatch', event: { inputs: { pr: '42' } }, repo: 'acme/game', gh }), [42]);
  for (const pr of ['', '4 2', '1;id', undefined]) {
    await assert.rejects(resolvePrs({ name: 'workflow_dispatch', event: { inputs: { pr } }, repo: 'acme/game', gh }), /not a PR number/, String(pr));
  }
});

test('resolvePrs: a relay run is matched to open PRs by head owner and branch, sent as fields', async () => {
  const { gh, calls } = fakeGh({ pulls: [{ number: 5 }, { number: 9 }] });
  const event = { workflow_run: { name: RELAY, head_branch: 'feat/x&base=y', head_repository: { owner: { login: 'forker' } } } };
  assert.deepEqual(await resolvePrs({ name: 'workflow_run', event, repo: 'acme/game', gh }), [5, 9]);
  const call = calls[0];
  assert.ok(call.includes('repos/acme/game/pulls'), call.join(' '));
  assert.ok(call.includes('head=forker:feat/x&base=y'), 'the branch is one field, not spliced into the URL');
  assert.ok(call.includes('state=open'));
});

test('resolvePrs: refuses what it cannot read instead of naming no PR', async () => {
  const { gh } = fakeGh({ pulls: { message: 'Not Found' } });
  const run = (name, event) => resolvePrs({ name, event, repo: 'acme/game', gh });
  const head = { head_branch: 'b', head_repository: { owner: { login: 'o' } } };
  await assert.rejects(run('workflow_run', { workflow_run: { ...head } }), /expected a list/);
  await assert.rejects(run('workflow_run', { workflow_run: { head_repository: head.head_repository } }), /no head branch/);
  await assert.rejects(run('workflow_run', { workflow_run: { head_branch: 'b' } }), /no head owner/);
  await assert.rejects(run('push', {}), /unsupported event: push/);
  const bad = fakeGh({ pulls: [{ number: '5; x' }] });
  await assert.rejects(resolvePrs({ name: 'workflow_run', event: { workflow_run: head }, repo: 'acme/game', gh: bad.gh }), /not a PR number/);
});

// --- report: evaluate and post ------------------------------------------------------------------

test('report: posts pending on the head first, then the verdict with the run link', async () => {
  const { gh, posts } = fakeGh();
  const code = await report({ repo: 'acme/game', pr: 7, gh, detect: detector(1, 'OPEN: 1 of 3 finding(s) in 1 review(s) have no disposition'), log: quiet, targetUrl: 'https://run/1' });
  assert.equal(code, 0);
  assert.deepEqual(posts.map((p) => [p.sha, p.state, p.context, p.target_url]), [
    [SHA, 'pending', CONTEXT, 'https://run/1'], [SHA, 'failure', CONTEXT, 'https://run/1'],
  ]);
  assert.equal(posts[1].description, 'OPEN: 1 of 3 finding(s) in 1 review(s) have no disposition');
  assert.equal(CONTEXT, 'PR findings');
});

test('report: a draft gets a pending status; a ready PR the verdict', async () => {
  const draft = fakeGh({ pr: { state: 'open', draft: true, head: { sha: SHA } } });
  await report({ repo: 'acme/game', pr: 7, gh: draft.gh, detect: detector(2, 'INCONCLUSIVE: no review'), log: quiet, targetUrl: 'u' });
  assert.deepEqual(draft.posts.map((p) => p.state), ['pending', 'pending']);
  const ready = fakeGh();
  await report({ repo: 'acme/game', pr: 7, gh: ready.gh, detect: detector(0, 'PASS: 3 finding(s) in 2 review(s), all dispositioned'), log: quiet, targetUrl: 'u' });
  assert.deepEqual(ready.posts.map((p) => p.state), ['pending', 'success']);
});

test('report: runs the detector on the PR it was given, with the same gh', async () => {
  const { gh } = fakeGh();
  let seen;
  await report({ repo: 'acme/game', pr: 7, gh, detect: async (a) => { seen = a; a.log('PASS: x'); return 0; }, log: quiet, targetUrl: 'u' });
  assert.equal(seen.repo, 'acme/game');
  assert.equal(seen.pr, 7);
  assert.equal(seen.gh, gh);
});

test('report: the default detector is pr-findings.mjs run(), the one a local run uses', async () => {
  const src = readFileSync(join(ROOT, 'tools/pr-findings-status.mjs'), 'utf8');
  assert.match(src, /import \{[^}]*\brun\b[^}]*\} from '\.\/pr-findings\.mjs'/);
  assert.match(src, /detect = run\b/);
  assert.equal(typeof run, 'function');
});

test('report: a closed PR gets no status', async () => {
  const { gh, posts } = fakeGh({ pr: { state: 'closed', draft: false, head: { sha: SHA } } });
  assert.equal(await report({ repo: 'acme/game', pr: 7, gh, detect: detector(0, 'PASS'), log: quiet, targetUrl: 'u' }), 0);
  assert.deepEqual(posts, []);
});

test('report: fails the job, posting nothing, when the PR has no usable head sha', async () => {
  const { gh, posts } = fakeGh({ pr: { state: 'open', draft: false, head: {} } });
  assert.equal(await report({ repo: 'acme/game', pr: 7, gh, detect: detector(0, 'PASS'), log: quiet, targetUrl: 'u' }), 1);
  assert.deepEqual(posts, []);
});

test('report: fails the job when the status cannot be posted, and a non-number PR is refused', async () => {
  const { gh } = fakeGh({ failPost: true });
  assert.equal(await report({ repo: 'acme/game', pr: 7, gh, detect: detector(0, 'PASS'), log: quiet, targetUrl: 'u' }), 1);
  const ok = fakeGh();
  assert.equal(await report({ repo: 'acme/game', pr: '7 ', gh: ok.gh, detect: detector(0, 'PASS'), log: quiet, targetUrl: 'u' }), 1);
  assert.deepEqual(ok.posts, []);
});

test('report: a detector that prints nothing is an error status, not success', async () => {
  const { gh, posts } = fakeGh();
  await report({ repo: 'acme/game', pr: 7, gh, detect: async () => 0, log: quiet, targetUrl: 'u' });
  assert.deepEqual(posts.map((p) => p.state), ['pending', 'error']);
});

// --- the workflows: fork safety ------------------------------------------------------------------

const yaml = (name) => load(readFileSync(join(ROOT, '.github/workflows', name), 'utf8'));
const FINDINGS = yaml('pr-findings.yml');
const RELAY_YML = yaml('pr-findings-relay.yml');
const steps = (wf) => Object.values(wf.jobs).flatMap((j) => j.steps ?? []);

test('the status workflow runs only on events that run main\'s copy of it', () => {
  // issue_comment and workflow_run always run the default branch's workflow file;
  // workflow_dispatch needs write access. pull_request(_target) and the review events are
  // not here: the review events would run the PR's copy of the workflow.
  assert.deepEqual(Object.keys(FINDINGS.on).sort(), ['issue_comment', 'workflow_dispatch', 'workflow_run']);
  assert.deepEqual(FINDINGS.on.workflow_run.workflows, [RELAY]);
  assert.equal(RELAY_YML.name, RELAY);
});

test('the relay covers every PR event that can change the verdict and has no permissions', () => {
  assert.deepEqual(Object.keys(RELAY_YML.on).sort(),
    ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread']);
  for (const t of ['opened', 'reopened', 'synchronize', 'ready_for_review', 'converted_to_draft']) {
    assert.ok(RELAY_YML.on.pull_request.types.includes(t), t);
  }
  assert.deepEqual(RELAY_YML.on.pull_request_review_thread.types.sort(), ['resolved', 'unresolved']);
  assert.deepEqual(RELAY_YML.permissions, {});
  for (const job of Object.values(RELAY_YML.jobs)) assert.equal(job.permissions, undefined);
  // It runs the PR's own copy, so it must check out and run nothing.
  for (const s of steps(RELAY_YML)) assert.equal(s.uses, undefined, 'the relay uses no action');
});

test('only the report job can write, and only statuses', () => {
  assert.deepEqual(FINDINGS.permissions, {});
  const writers = [];
  for (const [id, job] of Object.entries(FINDINGS.jobs)) {
    for (const [scope, level] of Object.entries(job.permissions ?? {})) {
      if (level !== 'read') writers.push(`${id}:${scope}:${level}`);
    }
  }
  assert.deepEqual(writers, ['report:statuses:write']);
  assert.deepEqual(Object.keys(FINDINGS.jobs.report.permissions).sort(), ['contents', 'issues', 'pull-requests', 'statuses']);
});

test('every checkout in the status workflow is main\'s code, without stored credentials', () => {
  const checkouts = steps(FINDINGS).filter((s) => /^actions\/checkout@/.test(s.uses ?? ''));
  assert.ok(checkouts.length >= 2);
  for (const s of checkouts) {
    assert.equal(s.with?.ref, '${{ github.event.repository.default_branch }}');
    assert.equal(s.with?.['persist-credentials'], false);
  }
});

test('no run script interpolates an expression (script injection); event data goes through env or the event file', () => {
  for (const s of [...steps(FINDINGS), ...steps(RELAY_YML)]) {
    if (s.run) assert.doesNotMatch(s.run, /\$\{\{/, s.run);
  }
});

test('report runs one at a time per PR, so an older evaluation never posts last', () => {
  const c = FINDINGS.jobs.report.concurrency;
  assert.match(c.group, /\$\{\{ matrix\.pr \}\}/);
  assert.equal(c['cancel-in-progress'], false);
  assert.equal(FINDINGS.jobs.report.strategy.matrix.pr, '${{ fromJSON(needs.resolve.outputs.prs) }}');
});

test('every action in every workflow is pinned to a commit sha', () => {
  for (const name of ['ci.yml', 'pr-findings.yml', 'pr-findings-relay.yml']) {
    for (const s of steps(yaml(name))) {
      if (s.uses) assert.match(s.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${name}: ${s.uses}`);
    }
  }
});

// A run that fails part way must not leave an earlier verdict standing on the head commit.
test('report posts pending first, with gh only, before any checkout or install', () => {
  const job = FINDINGS.jobs.report;
  const [first] = job.steps;
  assert.equal(first.id, 'head');
  assert.equal(first.uses, undefined, 'no action before the pending post');
  assert.match(first.run, /gh api "repos\/\$REPO\/pulls\/\$PR"/);
  assert.match(first.run, /\^\[0-9a-f\]\{40\}\$/, 'checks the head sha');
  assert.match(first.run, /-f state=pending/);
  assert.match(first.run, /statuses\/\$sha"/);
  assert.match(first.run, /echo "sha=\$sha" >> "\$GITHUB_OUTPUT"/);
  assert.equal(job.env.CONTEXT, CONTEXT, 'the shell steps post the same context as the tool');
});

// The head step run for real, under the shell Actions uses (bash -e -o pipefail), with a
// fake `gh` and `sleep` first on PATH. `gh api` prints the error body on a non-2xx and exits
// 1: the step must decide from the exit code, never from having output.
function runHead(replies) {
  const dir = mkdtempSync(join(tmpdir(), 'pr-findings-head-'));
  try {
    // Each reply is "<exit> <stdout>", one per call; POSTs always succeed and are logged.
    writeFileSync(join(dir, 'replies'), replies.join('\n') + '\n');
    writeFileSync(join(dir, 'gh'), [
      '#!/usr/bin/env bash',
      'd=$(dirname "$0")',
      'if [ "$2" = -X ]; then echo "$*" >> "$d/posts"; exit 0; fi',
      'n=$(cat "$d/n" 2>/dev/null || echo 0); echo $((n + 1)) > "$d/n"',
      'line=$(sed -n "$((n + 1))p" "$d/replies")',
      'echo "${line#* }"; exit "${line%% *}"',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(dir, 'out'), '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', FINDINGS.jobs.report.steps[0].run], {
      env: { PATH: `${dir}:${process.env.PATH}`, REPO: 'acme/game', PR: '7', CONTEXT, RUN_URL: 'u', GITHUB_OUTPUT: join(dir, 'out') },
      encoding: 'utf8',
    });
    const read = (f) => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return ''; } };
    return { code: r.status, output: read('out'), posts: read('posts'), log: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const HEAD = 'b'.repeat(40);

test('head step: every read failing (an error body on stdout) fails the step, with no sha', () => {
  const r = runHead(['1 {"message":"Server Error"}', '1 {"message":"Server Error"}', '1 {"message":"Server Error"}']);
  assert.notEqual(r.code, 0, r.log);
  assert.equal(r.output, '');
  assert.equal(r.posts, '');
  // Even output that reads like an open PR is not a success when gh exited non-zero.
  const lookalike = runHead(Array(3).fill(`1 open ${HEAD}`));
  assert.notEqual(lookalike.code, 0, lookalike.log);
  assert.equal(lookalike.posts, '');
});

test('head step: a read that fails, then succeeds, posts pending on the head and writes the sha', () => {
  const r = runHead(['1 {"message":"Server Error"}', `0 open ${HEAD}`]);
  assert.equal(r.code, 0, r.log);
  assert.equal(r.output, `sha=${HEAD}\n`);
  assert.match(r.posts, new RegExp(`statuses/${HEAD} -f state=pending -f context=PR findings`));
});

test('head step: only a literal "closed" skips the PR; anything unreadable fails the step', () => {
  const closed = runHead([`0 closed ${HEAD}`]);
  assert.equal(closed.code, 0, closed.log);
  assert.equal(closed.posts, '');
  for (const reply of ['0 garbage', '0 ', `0 OPEN ${HEAD}`, '0 open not-a-sha']) {
    const r = runHead([reply]);
    assert.notEqual(r.code, 0, `${reply}: ${r.log}`);
    assert.equal(r.posts, '', reply);
  }
});

test('report posts error on the head when any later step fails', () => {
  const last = FINDINGS.jobs.report.steps.at(-1);
  assert.equal(last.if, "failure() && steps.head.outputs.sha != ''");
  assert.match(last.run, /statuses\/\$SHA"/);
  assert.match(last.run, /-f state=error/);
  assert.match(last.run, /-f "context=\$CONTEXT"/);
  assert.equal(last.env.SHA, '${{ steps.head.outputs.sha }}');
});
