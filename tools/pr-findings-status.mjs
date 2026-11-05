// The PR findings check in CI: runs the findings detector (tools/pr-findings.mjs `run`, the
// code a local `node tools/pr-findings.mjs <PR>` runs) and posts its verdict as the
// `PR findings` commit status on the PR head, so the merge gate reads the same in CI as
// locally. Called by .github/workflows/pr-findings.yml, which runs main's code only:
// comment events run it directly, PR and review events through the no-op relay workflow
// (pr-findings-relay.yml), whose completion triggers it by workflow_run.
// Usage (in that workflow): node tools/pr-findings-status.mjs prs
//   (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH; writes `prs=[...]` to GITHUB_OUTPUT)
//                           node tools/pr-findings-status.mjs report <pr-number>
// Status: success PASS, failure OPEN, error INCONCLUSIVE (or anything unexpected), pending
// while the PR is a draft or the detector runs. A closed PR gets none.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, defaultGh, run } from './pr-findings.mjs';

export const CONTEXT = 'PR findings';
export const RELAY = 'PR findings relay';
const MAX_DESCRIPTION = 140; // GitHub rejects a longer status description.
const SUMMARY = /^(?:PASS|OPEN|INCONCLUSIVE):/;

const prNumber = (v) => {
  if (!/^\d+$/.test(String(v))) throw new Error(`not a PR number: ${v}`);
  return Number(v);
};

/** The status for a detector exit code; anything but a known code is an error. */
export function statusFor({ exit, draft, summary }) {
  const state = { [EXIT.PASS]: 'success', [EXIT.OPEN]: 'failure', [EXIT.INCONCLUSIVE]: 'error' }[
    Number.isInteger(exit) ? exit : 'none'] ?? 'error';
  // A draft can't be merged: report what the verdict would be, but don't fail it yet.
  const text = draft ? `Draft, not gated yet. ${summary}` : String(summary);
  const description = text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
  return { state: draft ? 'pending' : state, description };
}

/** The PR numbers an event asks to re-evaluate. Throws on anything it cannot read. */
export async function resolvePrs({ name, event, repo, gh = defaultGh }) {
  if (name === 'issue_comment') return event.issue?.pull_request ? [prNumber(event.issue.number)] : [];
  if (name === 'workflow_dispatch') return [prNumber(event.inputs?.pr)];
  if (name === 'workflow_run') {
    // The relay ran for a PR event; its payload names no PR for a fork, so look the open
    // PRs up by head. Owner and branch come from the PR's author: sent as fields, never
    // spliced into the URL or a shell.
    const wr = event.workflow_run ?? {};
    const owner = wr.head_repository?.owner?.login;
    if (!wr.head_branch) throw new Error('workflow_run: no head branch');
    if (!owner) throw new Error('workflow_run: no head owner');
    const pulls = JSON.parse(await gh(['api', '-X', 'GET', `repos/${repo}/pulls`,
      '-f', 'state=open', '-f', `head=${owner}:${wr.head_branch}`, '-f', 'per_page=100']));
    if (!Array.isArray(pulls)) throw new Error(`workflow_run: expected a list of PRs, got ${JSON.stringify(pulls)}`);
    return pulls.map((p) => prNumber(p.number));
  }
  throw new Error(`unsupported event: ${name}`);
}

const postStatus = (gh, repo, sha, { state, description }, targetUrl) => gh(['api', '-X', 'POST',
  `repos/${repo}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${CONTEXT}`,
  '-f', `description=${description}`, '-f', `target_url=${targetUrl}`]);

/**
 * Evaluate one PR and post its status on the head commit: pending first, so a run that
 * dies part way leaves a non-green status, then the verdict. Returns the job's exit code:
 * 0 when the status was posted (or the PR is closed), 1 when it could not be.
 */
export async function report({ repo, pr, gh = defaultGh, detect = run, log = console.log, targetUrl }) {
  try {
    const n = prNumber(pr);
    const info = JSON.parse(await gh(['api', `repos/${repo}/pulls/${n}`]));
    if (info.state !== 'open') {
      log(`PR ${repo}#${n} is ${info.state}: no status posted`);
      return 0;
    }
    const sha = info.head?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`PR ${n}: no usable head sha (${sha})`);
    await postStatus(gh, repo, sha, { state: 'pending', description: 'Evaluating review comments' }, targetUrl);
    const lines = [];
    const exit = await detect({ repo, pr: n, gh, log: (s) => { lines.push(s); log(s); } });
    // The detector's last line is its summary (PASS, OPEN or INCONCLUSIVE); none is an error.
    const last = lines.at(-1);
    const status = SUMMARY.test(last ?? '') ? statusFor({ exit, draft: info.draft === true, summary: last })
      : { state: 'error', description: 'INCONCLUSIVE: the detector printed no summary' };
    await postStatus(gh, repo, sha, status, targetUrl);
    log(`posted ${CONTEXT} = ${status.state} on ${sha}`);
    return 0;
  } catch (err) {
    log(`ERROR ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, pr] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  if (cmd === 'prs') {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const prs = await resolvePrs({ name: process.env.GITHUB_EVENT_NAME, event, repo });
      console.log(`PRs to evaluate: ${prs.join(', ') || 'none'}`);
      appendFileSync(process.env.GITHUB_OUTPUT, `prs=${JSON.stringify(prs)}\n`);
    } catch (err) {
      console.error(`ERROR ${err.message}`);
      process.exitCode = 1;
    }
  } else if (cmd === 'report' && pr) {
    const targetUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    process.exitCode = await report({ repo, pr, targetUrl });
  } else {
    console.error('usage: node tools/pr-findings-status.mjs prs | report <pr-number>');
    process.exitCode = 1;
  }
}
