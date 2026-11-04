// Act 6 boss "Errors tripled overnight" beyond the play-through: the scenario pinned (views, kinds, costs, budget,
// burn rate, answerAfterViews), the engine's validator and budget arithmetic on it, the ONE table of figures every
// text states (1,000 requests a second, 40 of them failed, a tail_sampling policy that keeps every error and 30% of
// the rest: 328 requests are counted, so the error ratio goes from 4.0% to 12.2%, about 3x, while the error count stays
// 40 and the load balancer stays at 1,000), the shortcuts a player could take through the real incident engine, the
// reference path within budget (I7), one penalty per run (herring, exhaustion, wrong hypothesis), and a focus walk that
// ends on Finish. Structure mirrors test/silence.test.mjs. The happy and sloppy runs are generated from the level's data
// (test/play.test.mjs). Asserts strings, numbers and booleans only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDom, q, qa, click } from './helpers/dom.mjs';
import { recordFocus } from './helpers/focus.mjs';
import { createLevelContext } from '../lib/level-context.mjs';
import { emptyProgress, starTotals } from '../lib/progress.mjs';
import { answer, budgetLeft, canAnswer, newIncident, openView, validateScenario } from '../lib/widgets/incident.mjs';
import { liveRegistry } from '../app.mjs';
import { checkConfig } from '../lib/configure/check.mjs';
import { COLLECTOR_SCHEMA } from '../lib/configure/collector.mjs';
import { expectedStarMax } from './helpers/stars.mjs';
import { litIds } from './helpers/lights.mjs';
import { levelState } from '../lib/unlock.mjs';

const LIVE = liveRegistry();
const MAX_STARS = expectedStarMax(LIVE);
const ID = 'errors-tripled';
const BOSS = LIVE.levels[ID];
const S = BOSS.play.steps[0].incident;
const CHOICE = BOSS.play.steps[1].choice.choices;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const view = (id) => S.views.find((v) => v.id === id);
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const cost = (kind) => S.views.filter((v) => v.kind === kind).reduce((n, v) => n + v.costMin, 0);
const CLUES = ['rate-vs-lb', 'error-count', 'collector-diff'];
const NEUTRALS = ['collector-health', 'backend-ingest'];
const HERRINGS = ['payments-deploy', 'provider-blip'];
const RIGHT = 'metrics-after-sampling';
const RULE = 'counted-after-sampling';

// The figures, derived here from three inputs and nothing else.
const REQUESTS = 1000; // a second, at the load balancer, before and after
const ERRORS = 40; // a second, before and after
const BLIP = 52; // failed requests a second at the provider's incident peak, 03:30 to 03:40
const KEEP_REST = 0.3; // the probabilistic policy keeps 30% of the traces that did not fail
const KEPT = ERRORS + Math.round((REQUESTS - ERRORS) * KEEP_REST);
const RATIO_BEFORE = (ERRORS / REQUESTS) * 100;
const RATIO_AFTER = (ERRORS / KEPT) * 100;
const DROP = Math.round((1 - KEPT / REQUESTS) * 100);
const f1 = (x) => x.toFixed(1);

// ---- content pin ---------------------------------------------------------------------

test('errors-tripled: scenario pin: id, budget, burn rate, answerAfterViews, views with kinds and costs, hypotheses', () => {
  assert.equal(S.id, ID);
  assert.equal(S.alert.title, 'Error ratio tripled overnight');
  assert.deepEqual(S.budget, { startPct: 100, burnPctPerMin: 6 });
  assert.equal(S.answerAfterViews, 3);
  assert.deepEqual(
    S.views.map((v) => `${v.id}|${v.kind}|${v.costMin}`),
    [
      'rate-vs-lb|clue|3', 'error-count|clue|3', 'collector-diff|clue|3',
      'collector-health|neutral|3', 'backend-ingest|neutral|3',
      'payments-deploy|herring|3', 'provider-blip|herring|4',
    ],
  );
  assert.deepEqual(
    S.hypotheses.map((h) => `${h.id}|${h.right}`),
    ['metrics-after-sampling|true', 'payments-regression|false', 'traffic-fell|false', 'provider-failing|false'],
  );
});

test('errors-tripled: valid; clues plus neutrals cost 15 min and leave 10%, so only a herring can exhaust the budget', () => {
  assert.deepEqual(validateScenario(S), []);
  assert.equal(cost('clue'), 9);
  assert.equal(cost('neutral'), 6);
  const left = S.budget.startPct - (cost('clue') + cost('neutral')) * S.budget.burnPctPerMin;
  assert.equal(left, 10);
  for (const h of S.views.filter((v) => v.kind === 'herring')) {
    assert.equal(h.costMin * S.budget.burnPctPerMin > left, true, `${h.id} spends more than the ${left}% that is left`);
  }
  assert.equal(S.views.every((v) => v.costMin <= 4), true, 'no view is a long wait');
  assert.equal(S.views.length, 7, 'a small board');
});

test('errors-tripled: a scored Act 6 boss lighting the Collector, no cards, mechanics derived from the one incident step', () => {
  assert.deepEqual(
    { id: BOSS.id, no: BOSS.no, mechanics: [...BOSS.mechanics], cards: [...BOSS.cards], lights: [...BOSS.lights], scored: BOSS.scored, parMs: BOSS.scoring.parMs, kind: BOSS.kind, actId: BOSS.actId },
    { id: ID, no: null, mechanics: ['incident'], cards: [], lights: ['collector'], scored: true, parMs: null, kind: 'boss', actId: 'act-6' },
  );
  assert.equal(LIVE.acts.find((a) => a.id === 'act-6').bossId, ID);
  assert.deepEqual(BOSS.play.steps.map((s) => Object.keys(s).find((k) => ['incident', 'choice'].includes(k))), ['incident', 'choice']);
  assert.equal(S.hypotheses.length, 4);
  assert.equal(BOSS.name, 'Errors tripled overnight');
});

test('errors-tripled: lights the Collector (shared with 5.x and 6.2), and the boss waits for the act\'s levels and comes right after them', () => {
  const lit = (done) => {
    const p = emptyProgress();
    for (const id of done) p.levels[id] = { stars: 3, at: null };
    return litIds(LIVE, p).sort();
  };
  assert.deepEqual(lit([ID]), ['collector']);
  assert.deepEqual(lit(['tail-sampling']), ['collector']);
  const act = [...LIVE.acts.find((a) => a.id === 'act-6').levelIds];
  assert.equal(act.length >= 2, true);
  const earlier = LIVE.order.slice(0, LIVE.order.indexOf(act[0]));
  const partly = emptyProgress();
  for (const id of [...earlier, ...act.slice(0, act.length - 1)]) partly.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, partly, LIVE), 'locked', 'the boss is locked until the act\'s levels are done');
  const all = emptyProgress();
  for (const id of [...earlier, ...act]) all.levels[id] = { stars: 3, at: null };
  assert.equal(levelState(ID, all, LIVE), 'open');
  assert.equal(LIVE.order[LIVE.order.indexOf(act[act.length - 1]) + 1], ID);
  assert.equal(LIVE.order[LIVE.order.length - 1], ID, 'the act-6 boss is the last level');
});

test('errors-tripled: star totals count the boss (the derived scored-level max), and a 3-star boss is 3 of them', () => {
  assert.deepEqual(starTotals(emptyProgress(), LIVE), { earned: 0, max: MAX_STARS });
  const p = emptyProgress();
  p.levels[ID] = { stars: 3, at: null };
  assert.deepEqual(starTotals(p, LIVE), { earned: 3, max: MAX_STARS });
});

test('errors-tripled: no em dash in the level file', () => {
  assert.equal(read(`levels/${ID}.mjs`).includes('\u2014'), false);
});

// ---- one table of figures: alert, views, hypotheses and Choice agree -------------------

test('the figures: 40 of 1,000 is 4.0%; counted after the sampler, 40 of 328 is 12.2%, about 3x, and the rate falls 67%', () => {
  assert.equal(KEPT, 328);
  assert.equal(f1(RATIO_BEFORE), '4.0');
  assert.equal(f1(RATIO_AFTER), '12.2');
  assert.equal(DROP, 67);
  assert.equal(Math.round(RATIO_AFTER / RATIO_BEFORE), 3, 'tripled');
  assert.equal(RATIO_AFTER / RATIO_BEFORE > 2.9 && RATIO_AFTER / RATIO_BEFORE < 3.1, true, `${RATIO_AFTER / RATIO_BEFORE} is within 3% of 3x`);
});

test('the alert states the two ratios, and the title is true: 4.0% to 12.2% is three times', () => {
  const a = plain(S.alert.html);
  assert.equal(a.includes(`${f1(RATIO_AFTER)}%`) && a.includes(`${f1(RATIO_BEFORE)}%`), true);
  assert.equal(/three times|tripled/.test(a + S.alert.title), true);
  assert.equal(/02:05/.test(a), true);
  assert.equal(a.includes('tail_sampling') || a.includes('span_metrics'), false, 'the alert names no cause');
});

test('rate-vs-lb: the load balancer is flat at 1,000 a second while span metrics fall to 328, minus 67%', () => {
  const t = plain(view('rate-vs-lb').html);
  for (const w of ['Load balancer', 'traces.span.metrics.calls', '1,000', String(KEPT), `${DROP}%`, '01:00', '06:00']) {
    assert.equal(t.includes(w), true, `rate-vs-lb says "${w}"`);
  }
  assert.equal(t.includes('tail_sampling'), false, 'the clue does not give the cause away');
  assert.equal(plain(view('rate-vs-lb').html.replace(/<table[\s\S]*<\/table>/, '')).split(/(?<=\.)\s/).length <= 2, true, 'the evidence plus at most one sentence');
});

test('error-count: the error count is 40 a second before and after, only the ratio moves, 4.0% to 12.2%', () => {
  const t = plain(view('error-count').html);
  for (const w of ['status.code', String(ERRORS), `${f1(RATIO_BEFORE)}%`, `${f1(RATIO_AFTER)}%`, '01:00', '06:00']) {
    assert.equal(t.includes(w), true, `error-count says "${w}"`);
  }
  assert.equal((view('error-count').html.match(/<td>40<\/td>/g) ?? []).length, 2, 'the same count in both columns');
  assert.equal(t.includes('tail_sampling'), false);
});

test('collector-diff: tail_sampling joined the traces pipeline that feeds span_metrics, with a policy for every error and 30% of the rest', () => {
  const html = view('collector-diff').html;
  const t = plain(html);
  assert.equal(/\+\s+processors: \[memory_limiter, tail_sampling, batch\]/.test(html), true, 'the diff adds tail_sampling to the processors');
  assert.equal(/-\s+processors: \[memory_limiter, batch\]/.test(html), true);
  assert.equal(/exporters: \[otlp_grpc\/dash0, span_metrics\]/.test(html), true, 'the exporters line lists the connector, unchanged');
  assert.equal(/[+-]\s+exporters:/.test(html), false, 'the exporters line is not in the change');
  assert.equal((html.match(/exporters: \[[^\]]*span_metrics/g) ?? []).length, 1, 'one connector instance: exactly one pipeline feeds span_metrics, and it samples');
  assert.equal(/receivers: \[span_metrics\]/.test(html), true, 'the metrics pipeline that receives from the connector is shown');
  assert.equal(html.includes('status_codes: [ERROR]'), true);
  assert.equal(html.includes(`sampling_percentage: ${KEEP_REST * 100}`), true);
  assert.equal(html.includes('spanmetrics'), false, 'the connector type is span_metrics, as in 6.2');
  const applied = /applied at (\d\d:\d\d)/.exec(t)[1];
  const jump = /since (\d\d:\d\d)/.exec(plain(S.alert.html))[1];
  assert.equal(Number(jump.slice(3)) - Number(applied.slice(3)), 1, 'the ratio moves a minute after the change');
});

test('herrings and neutrals say why they do not explain it, in times and numbers the clues contradict', () => {
  const deploy = plain(view('payments-deploy').html);
  assert.equal(deploy.includes('02:20') && deploy.includes('02:05') && /already/.test(deploy), true, 'the deploy came after the jump');
  const blip = plain(view('provider-blip').html);
  assert.equal(blip.includes('03:30') && blip.includes('03:40') && blip.includes(`${f1(RATIO_AFTER)}%`) && /03:00/.test(blip), true);
  assert.equal(BLIP > ERRORS, true, 'the incident peak is above the flat 40, so "rose" is true');
  assert.equal(blip.includes(`rose to ${BLIP} a second`), true, 'the herring sentence shows the peak');
  assert.equal(blip.includes(`back to ${ERRORS} by 03:45`), true);
  assert.equal(plain(view('collector-health').html).includes('no restarts'), true);
  assert.equal(plain(view('backend-ingest').html).includes('no rejected'), true);
});

test('each wrong hypothesis is refuted with the figures; the right one cites the clues', () => {
  const why = (id) => plain(S.hypotheses.find((h) => h.id === id).why);
  const right = why(RIGHT) + plain(S.hypotheses.find((h) => h.id === RIGHT).label);
  for (const w of ['span_metrics', 'tail_sampling', '02:04', String(KEPT), String(ERRORS), '1,000', '30%']) assert.equal(right.includes(w), true, w);
  assert.equal(why('payments-regression').includes(String(ERRORS)) && why('payments-regression').includes('02:20'), true);
  assert.equal(why('traffic-fell').includes('1,000') && why('traffic-fell').includes('load balancer'), true);
  assert.equal(why('provider-failing').includes('03:40') && why('provider-failing').includes(String(ERRORS)), true);
});

test('every percentage and every rate in the story comes from the one table', () => {
  const all = plain(
    [S.alert.html, ...S.views.map((v) => v.html), ...S.hypotheses.map((h) => h.label + h.why), ...CHOICE.map((c) => c.label + c.why), BOSS.play.steps[0].intro, BOSS.play.steps[1].intro, BOSS.play.finish].join(' '),
  );
  const pcts = new Set(all.match(/\d+(\.\d+)?%/g));
  // 38% is the neutral Collector-health view's own memory figure; every other percentage is the table's.
  assert.deepEqual([...pcts].sort(), [`${f1(RATIO_AFTER)}%`, `${f1(RATIO_BEFORE)}%`, '30%', `${DROP}%`, '70%', '38%'].sort());
  const nums = new Set((all.match(/\b\d{1,3}(,\d{3})*\b/g) ?? []).filter((x) => Number(x.replace(',', '')) >= 100 && !/^(0|2026)/.test(x)));
  // 400 is limit_mib of the memory_limiter in the config shown (a config value, not a story figure).
  for (const x of nums) assert.equal(['1,000', '328', '288', '960', '100', '400'].includes(x), true, `unexplained figure ${x}`);
});

test('the closing Choice grades the nuance: a ratio counted after a sampler that keeps every error is biased; uniform sampling would not be', () => {
  const right = CHOICE.find((c) => c.right);
  assert.equal(right.key, RULE);
  const t = plain(right.label + right.why);
  for (const w of ['span_metrics', 'tail_sampling', `${ERRORS} / ${KEPT}`, `${f1(RATIO_AFTER)}%`, `${ERRORS} / 1,000`, `${f1(RATIO_BEFORE)}%`, 'before sampling']) {
    assert.equal(t.includes(w), true, w);
  }
  assert.deepEqual(CHOICE.filter((c) => !c.right).map((c) => c.key).sort(), ['errors-undercounted', 'uniform-sampling']);
  const uniform = plain(CHOICE.find((c) => c.key === 'uniform-sampling').why);
  assert.equal(uniform.includes('6.1') && uniform.includes('every error') && uniform.includes('4.0%'), true, 'the 6.1 arithmetic: the same share of both leaves the ratio alone');
  const under = plain(CHOICE.find((c) => c.key === 'errors-undercounted').why);
  assert.equal(under.includes('status_code') && under.includes(String(ERRORS)), true);
  assert.equal(CHOICE.length, 3);
});

// ---- the config on the screen is one config the Collector accepts ----------------------

// The collector-diff view shows the whole gateway config, with + and - lines for the change. Both states are rebuilt from it: the
// config after (drop the - lines) and the config before (drop the + lines), each checked by the real checkConfig, then the
// connector rules checkConfig does not model: every connector is exported by a traces pipeline and received by a metrics
// pipeline, and there is exactly one span_metrics instance, fed by exactly one pipeline (the spanmetrics README's Single Writer
// Principle), so no unsampled pipeline feeds the same connector.
const rawLines = () => {
  const pre = /<pre><code>([\s\S]*)<\/code><\/pre>/.exec(view('collector-diff').html)[1];
  return pre.split('\n');
};
const stateOf = (keep, drop) => rawLines().filter((l) => !l.startsWith(drop)).map((l) => (l.startsWith(keep) ? ` ${l.slice(1)}` : l)).map((l) => l.slice(1)).join('\n');
const AFTER = stateOf('+', '-');
const BEFORE_CFG = stateOf('-', '+');
const pipelinesOf = (doc) => Object.entries(doc.service.pipelines).map(([name, p]) => ({ name, ...p }));
const connectorProblems = (doc) => {
  const problems = [];
  const ps = pipelinesOf(doc);
  for (const id of Object.keys(doc.connectors ?? {})) {
    const out = ps.filter((p) => p.exporters.includes(id));
    const into = ps.filter((p) => p.receivers.includes(id));
    if (out.length === 0) problems.push(`${id} is never exported`);
    if (into.length === 0) problems.push(`${id} is never received`);
    for (const p of out) if (!p.name.startsWith('traces')) problems.push(`${id} exported by ${p.name}`);
    for (const p of into) if (!p.name.startsWith('metrics')) problems.push(`${id} received by ${p.name}`);
  }
  return problems;
};
const spanMetrics = (doc) => Object.keys(doc.connectors ?? {}).filter((id) => id.startsWith('span_metrics'));
const accepted = (yaml) => {
  const r = checkConfig(yaml, COLLECTOR_SCHEMA);
  assert.deepEqual(r.errors.map((e) => `${e.kind} ${e.path}`), []);
  assert.equal(r.verdict.flowing, true);
  assert.deepEqual(r.verdict.inactive, [], 'nothing defined is left unused');
  assert.deepEqual(connectorProblems(r.doc), []);
  assert.deepEqual(spanMetrics(r.doc), ['span_metrics'], 'exactly one span_metrics instance');
  const feeding = pipelinesOf(r.doc).filter((p) => p.exporters.includes('span_metrics')).map((p) => `${p.name}:${p.processors.includes('tail_sampling')}`);
  return { doc: r.doc, feeding };
};

test('the config shown is one config the Collector accepts, after and before the change, with one span_metrics instance fed by one pipeline', () => {
  const after = accepted(AFTER);
  assert.deepEqual(after.feeding, ['traces:true'], 'after: the one pipeline that feeds the connector samples first');
  assert.deepEqual(Object.keys(after.doc.service.pipelines).sort(), ['metrics/spans', 'traces']);
  const before = accepted(BEFORE_CFG);
  assert.deepEqual(before.feeding, ['traces:false'], 'before: the same pipeline had no sampling');
  assert.equal('tail_sampling' in before.doc.processors, false);
});

test('the config check has teeth: a second connector instance, an unreceived connector, an undefined policy processor or an unused one is refused', () => {
  const second = AFTER.replace('exporters: [otlp_grpc/dash0, span_metrics]', 'exporters: [otlp_grpc/dash0, span_metrics, span_metrics/2]').replace('    span_metrics:', '    span_metrics:\n    span_metrics/2:');
  const r2 = checkConfig(second, COLLECTOR_SCHEMA);
  assert.deepEqual(spanMetrics(r2.doc), ['span_metrics', 'span_metrics/2']);
  assert.deepEqual(connectorProblems(r2.doc), ['span_metrics/2 is never received']);
  const unreceived = checkConfig(AFTER.replace('receivers: [span_metrics]', 'receivers: [otlp]'), COLLECTOR_SCHEMA);
  assert.deepEqual(connectorProblems(unreceived.doc), ['span_metrics is never received']);
  const undefinedProc = checkConfig(AFTER.replace('    tail_sampling:\n', '    tail_sampling_x:\n'), COLLECTOR_SCHEMA);
  assert.deepEqual(undefinedProc.errors.map((e) => e.kind), ['unknown-ref'], 'an id the pipeline lists but nothing defines');
  const unused = checkConfig(AFTER.replace('processors: [memory_limiter, tail_sampling, batch]', 'processors: [memory_limiter, batch]'), COLLECTOR_SCHEMA);
  assert.deepEqual(unused.verdict.inactive.map((x) => x.id), ['tail_sampling']);
});

// The 328 check models the kept share (a deterministic every-Nth pick of the healthy requests); it does not run the
// tail_sampling processor, whose probabilistic policy samples by a hash of the trace ID.
test('the policies shown, run over 1,000 requests of which 40 fail, keep exactly 40 + 288 = 328, the figure every text states', () => {
  const { doc } = accepted(AFTER);
  const policies = doc.processors.tail_sampling.policies;
  assert.deepEqual(policies.map((p) => p.type), ['status_code', 'probabilistic'], 'two policies: a trace is kept when any of them samples it');
  assert.deepEqual(policies[0].status_code.status_codes, ['ERROR']);
  const pct = policies[1].probabilistic.sampling_percentage;
  assert.equal(pct, KEEP_REST * 100);
  let kept = 0;
  let keptErrors = 0;
  let keptHealthy = 0;
  let healthySeen = 0;
  for (let i = 0; i < REQUESTS; i += 1) {
    const isError = i < ERRORS;
    const voted = policies.map((p) => {
      if (p.type === 'status_code') return isError && p.status_code.status_codes.includes('ERROR');
      const share = Math.floor(((healthySeen + 1) * pct) / 100) > Math.floor((healthySeen * pct) / 100);
      return !isError && share;
    });
    if (!isError) healthySeen += 1;
    if (voted.some(Boolean)) {
      kept += 1;
      if (isError) keptErrors += 1;
      else keptHealthy += 1;
    }
  }
  assert.deepEqual({ kept, keptErrors, keptHealthy }, { kept: KEPT, keptErrors: ERRORS, keptHealthy: 288 });
  assert.equal(f1((keptErrors / kept) * 100), f1(RATIO_AFTER));
  assert.equal(f1((ERRORS / REQUESTS) * 100), f1(RATIO_BEFORE));
  assert.equal(REQUESTS - kept, 672, 'requests the connector never sees: 67% of 1,000');
});

// ---- sources -------------------------------------------------------------------------

test('sources: Spec lines are opentelemetry.io, Docs lines are GitHub READMEs, the invented figures are marked', () => {
  const src = read(`levels/${ID}.mjs`);
  const lines = src.split('\n');
  const spec = lines.filter((l) => /^\/\/ Spec: /.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(spec.length > 0 && spec.every((u) => new URL(u).host === 'opentelemetry.io'), true);
  for (const u of [
    'https://opentelemetry.io/docs/concepts/sampling/#tail-sampling',
    'https://opentelemetry.io/docs/collector/configuration/#connectors',
  ]) assert.equal(spec.some((s) => s.startsWith(u)), true, u);
  const docs = lines.filter((l) => /^\/\/ Docs/.test(l)).flatMap((l) => l.match(/https:\/\/[^\s,]+/g) ?? []);
  assert.equal(docs.length > 0 && docs.every((u) => new URL(u).host === 'github.com'), true);
  for (const u of [
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md',
    'https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/connector/spanmetricsconnector/README.md',
  ]) assert.equal(docs.includes(u), true, u);
  assert.equal(lines.some((l) => /^\/\/ Invented for the game:/.test(l)), true);
  assert.equal(lines.some((l) => /^\/\/ Dash0 tie-in: n\/a/.test(l)), true);
  assert.equal(/dash0\.com\/docs/.test(src), false, 'no Dash0 page is cited: none was verified for this scenario');
  assert.equal(/\bthe spec says\b/i.test(src), false);
});

// ---- play ----------------------------------------------------------------------------

/** Start the boss with the real ctx; counts ctx.mistake() calls. */
function start() {
  const dom = makeDom();
  const focus = recordFocus(dom.window);
  const finished = [];
  const slips = { mistakes: 0 };
  const ctx = createLevelContext({
    level: BOSS,
    ovBody: dom.body,
    ovActions: dom.actions,
    now: () => 0,
    shuffle: (a) => a,
    reduceMotion: true,
    onFinish: (_id, r) => finished.push(r),
    signal: new AbortController().signal,
  });
  const mistake = ctx.mistake;
  ctx.mistake = () => {
    slips.mistakes += 1;
    mistake();
  };
  BOSS.run(ctx);
  return { finished, focus, slips };
}

const text = (sel) => q(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
const open = (id) => click(`[data-view="${id}"]`);
const guess = (id) => click(`[data-hypothesis="${id}"]`);
const budget = () => text('[data-budget-text]');
const locked = () => qa('[data-hypothesis]').map((b) => b.disabled).join();
const FEEDBACK = `#${ID}-feedback`;
/** After the right hypothesis: Next, the closing Choice answered right, then Finish. */
const finish = () => {
  click('#eto-next');
  click(`[data-pick="${RULE}"]`);
  click('[data-finish]');
};

test('errors-tripled: the first screen shows the alert, a full budget, seven views, locked hypotheses and a disabled Next', () => {
  start();
  assert.equal(text('.incident-alert h3'), 'Error ratio tripled overnight');
  assert.equal(budget(), 'Error budget: 100% left (0 min in).');
  assert.equal(qa('[data-view]').length, 7);
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#eto-next').disabled, true);
  assert.equal(qa('[data-finish]').length, 0, 'Finish is on the closing step');
});

test('errors-tripled: it takes three clue looks to unlock the answers (answerAfterViews 3): two are not enough', () => {
  start();
  open('rate-vs-lb');
  open('error-count');
  assert.equal(locked(), 'true,true,true,true');
  open('collector-diff');
  assert.equal(locked(), 'false,false,false,false');
});

test('errors-tripled: neutral and herring views never unlock the answers; only clue views do', () => {
  start();
  for (const id of [...NEUTRALS, ...HERRINGS]) open(id);
  assert.equal(locked(), 'true,true,true,true', 'every neutral and herring view is open and the answers are still locked');
  open('rate-vs-lb');
  open('error-count');
  assert.equal(locked(), 'true,true,true,true', 'two clues are still not enough');
  open('collector-diff');
  assert.equal(locked(), 'false,false,false,false');
});

// ---- reference path (I7) and shortcuts -----------------------------------------------

test('errors-tripled: the reference path (the three clues, then metrics-after-sampling) solves with 46% of the budget left and no penalty', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const id of CLUES) {
    const r = openView(S, st, id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 46);
  assert.equal(canAnswer(S, st), true);
  assert.equal(answer(S, st, RIGHT).outcome, 'right');
  assert.equal(mistakes, 0);
});

test('errors-tripled: shortcut: opening every view in order ends at 0%, with a herring, the exhaustion and a second herring; the answer is still open', () => {
  let st = newIncident(S);
  let mistakes = 0;
  for (const v of S.views) {
    const r = openView(S, st, v.id);
    st = r.state;
    mistakes += Number(r.herring) + Number(r.exhaustedNow);
  }
  assert.equal(budgetLeft(S, st), 0);
  assert.equal(mistakes, 3, 'two herrings and one exhaustion; no mistake for the clues or neutrals');
  assert.equal(answer(S, st, RIGHT).outcome, 'right', 'the incident is still solvable at 0');
});

test('errors-tripled: shortcut: clues in any order are never penalised, and every clue plus neutral in any order never exhausts', () => {
  for (const order of [CLUES, [...CLUES].reverse(), ['collector-diff', 'rate-vs-lb', 'error-count']]) {
    let st = newIncident(S);
    let mistakes = 0;
    for (const id of order) {
      const r = openView(S, st, id);
      st = r.state;
      mistakes += Number(r.herring) + Number(r.exhaustedNow);
    }
    assert.equal(mistakes, 0, order.join());
    assert.equal(budgetLeft(S, st), 46, order.join());
  }
  let st = newIncident(S);
  for (const id of [...NEUTRALS, ...CLUES]) {
    const r = openView(S, st, id);
    st = r.state;
    assert.equal(r.exhaustedNow, false, id);
  }
  assert.equal(budgetLeft(S, st), 10);
});

test('errors-tripled: shortcut impossible: both neutrals leave every hypothesis disabled at 64%, so no lucky first guess can win without a clue', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  assert.equal(budget(), 'Error budget: 64% left (6 min in).');
  assert.equal(locked(), 'true,true,true,true');
  assert.equal(q('#eto-next').disabled, true);
  assert.equal(finished.length, 0);
  assert.equal(slips.mistakes, 0);
});

test('errors-tripled: shortcut impossible: neutrals plus two clues still lock the answers; the third clue unlocks them and a first-try right guess wins with 5 stars', () => {
  const { finished, slips } = start();
  for (const id of NEUTRALS) open(id);
  open('rate-vs-lb');
  open('error-count');
  assert.equal(locked(), 'true,true,true,true');
  open('collector-diff');
  assert.equal(locked(), 'false,false,false,false');
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 0);
  assert.equal(finished[0].stars, 5);
});

test('errors-tripled: shortcut: solving the incident does not finish the level; there is no Finish on the incident screen', () => {
  const { finished } = start();
  for (const id of CLUES) open(id);
  guess(RIGHT);
  assert.equal(finished.length, 0);
  assert.equal(qa('[data-finish]').length, 0);
  assert.equal(q('#eto-next').disabled, false);
});

test('errors-tripled: the shortest path is the three clues; it solves at 46% with no penalty and 5 stars', () => {
  const { finished, slips } = start();
  for (const id of CLUES) open(id);
  assert.equal(q('#eto-next').disabled, true, 'Next waits for the right answer');
  guess(RIGHT);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), 'Error budget: 46% left (9 min in).');
  finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].stars, 5);
  assert.equal(finished[0].text, BOSS.play.finish);
});

// ---- penalties: one each from a clean start ------------------------------------------

test('errors-tripled: a herring costs one mistake on its first open only, and the run still finishes with 4 stars', () => {
  const { slips, finished } = start();
  open('payments-deploy');
  assert.equal(slips.mistakes, 1);
  assert.equal(text(FEEDBACK).includes('red herring'), true);
  open('payments-deploy');
  assert.equal(slips.mistakes, 1, 'a repeat open is free');
  for (const id of CLUES) open(id);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('errors-tripled: the second herring is a second mistake; a wrong answer on top is a third and leaves 2 stars', () => {
  const { slips, finished } = start();
  open('payments-deploy');
  open('provider-blip');
  for (const id of CLUES) open(id);
  assert.equal(slips.mistakes, 2);
  guess('traffic-fell');
  assert.equal(slips.mistakes, 3);
  guess(RIGHT);
  finish();
  assert.equal(slips.mistakes, 3);
  assert.equal(finished[0].stars, 2);
});

for (const id of ['payments-regression', 'traffic-fell', 'provider-failing']) {
  test(`errors-tripled: guessing ${id} costs one mistake, once, and is then disabled`, () => {
    const { slips, finished } = start();
    for (const v of CLUES) open(v);
    guess(id);
    assert.equal(slips.mistakes, 1);
    assert.equal(q(`[data-hypothesis="${id}"]`).disabled, true);
    assert.equal(text(FEEDBACK).startsWith('Not quite.'), true);
    guess(RIGHT);
    finish();
    assert.equal(slips.mistakes, 1);
    assert.equal(finished[0].stars, 4);
  });
}

test('errors-tripled: every clue and neutral leaves 10% and no mistake; a herring then spends the rest, a herring mistake and an exhaustion mistake in one open', () => {
  const { slips, finished } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  assert.equal(slips.mistakes, 0, '15 min in: 10% left, nothing spent yet');
  assert.equal(budget(), 'Error budget: 10% left (15 min in).');
  open('payments-deploy');
  assert.equal(slips.mistakes, 2);
  assert.equal(budget(), 'Error budget: 0% left (18 min in).');
  assert.equal(text(FEEDBACK).includes('red herring, and the error budget is spent'), true);
  assert.equal(q(`[data-hypothesis="${RIGHT}"]`).disabled, false, 'still answerable at 0');
  guess(RIGHT);
  finish();
  assert.equal(finished[0].stars, 3, 'two penalties leave 3 stars (the star rule: 2 penalties)');
});

test('errors-tripled: opening a view again costs neither time nor a mistake, so repeat opens cannot exhaust the budget', () => {
  const { slips } = start();
  for (const id of [...CLUES, ...NEUTRALS]) open(id);
  for (const id of ['rate-vs-lb', 'collector-diff', 'backend-ingest']) open(id);
  assert.equal(slips.mistakes, 0);
  assert.equal(budget(), 'Error budget: 10% left (15 min in).');
});

test('errors-tripled: a wrong answer on the closing step costs one mistake, once, and leaves 4 stars', () => {
  const { slips, finished } = start();
  for (const id of CLUES) open(id);
  guess(RIGHT);
  click('#eto-next');
  click('[data-pick="uniform-sampling"]');
  assert.equal(slips.mistakes, 1);
  assert.equal(q('[data-finish]').disabled, true, 'Finish waits for the right rule');
  click(`[data-pick="${RULE}"]`);
  click('[data-finish]');
  assert.equal(slips.mistakes, 1);
  assert.equal(finished[0].stars, 4);
});

test('errors-tripled: focus walk: first view, an opened heading, then Finish', () => {
  const { focus } = start();
  assert.equal(focus.last(), 'view:rate-vs-lb');
  open('rate-vs-lb');
  assert.equal(focus.last(), 'heading:rate-vs-lb');
  open('error-count');
  open('collector-diff');
  guess(RIGHT);
  assert.equal(focus.last(), '#eto-next');
  click('#eto-next');
  click(`[data-pick="${RULE}"]`);
  assert.equal(focus.last(), '#eto-finish');
  assert.equal(q('[data-finish]').id, 'eto-finish');
  assert.deepEqual(focus.unfocusable(), []);
});
