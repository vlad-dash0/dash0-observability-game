// Act 2 boss: Checkout is slow. Checkout p95 is over 2 s and the error budget burns while
// the player investigates with traces, a triage comparison and a few dashboards. Two views
// hold the answer (an N+1 query in inventory, introduced by version 2.4.0); two are red
// herrings; the rest are neutral. Scored. A plain-data Scenario for the incident engine
// (lib/widgets/incident.mjs, docs/M1-DESIGN.md §4.3). Spec: docs/M1-DESIGN.md §6 Boss
// checkout-is-slow.
// Spec: https://opentelemetry.io/docs/concepts/signals/traces/ , https://opentelemetry.io/docs/specs/semconv/database/database-spans/
import { escapeHtml } from '../lib/lesson-kit.mjs';
import { incidentLesson, renderIncident, mountIncident } from '../lib/widgets/incident-view.mjs';
import { newIncident } from '../lib/widgets/incident.mjs';
import { compareAttribute } from '../lib/widgets/triage.mjs';

// The requests behind the triage view: slow checkouts (> 2 s) and a sample of normal ones.
// Each carries the attributes of its inventory span. Version 2.4.0 separates the two sets;
// the region does not.
const slow = (region) => ({ 'service.version': '2.4.0', 'cloud.region': region });
const normal = (version, region) => ({ 'service.version': version, 'cloud.region': region });
const TRIAGE = {
  slow: ['eu-west-1', 'us-east-1', 'eu-west-1', 'us-east-1', 'eu-west-1', 'us-east-1'].map(slow),
  normal: [
    ...Array(6).fill('eu-west-1').map((r) => normal('2.3.9', r)),
    ...Array(7).fill('us-east-1').map((r) => normal('2.3.9', r)),
    normal('2.4.0', 'eu-west-1'),
  ],
};

/** A comparison table: one row per value, share of slow requests then of normal ones. */
function triageHtml(attr) {
  const pct = (n) => (n === null ? 'no data' : `${n}%`);
  const rows = compareAttribute(TRIAGE.slow, TRIAGE.normal, attr)
    .map((r) => `<tr><th scope="row">${escapeHtml(r.value)}</th><td>${pct(r.slowPct)}</td><td>${pct(r.baselinePct)}</td></tr>`)
    .join('');
  return (
    `<table><caption><code>${escapeHtml(attr)}</code> on the inventory span</caption>` +
    `<thead><tr><th scope="col">Value</th><th scope="col">Slow requests</th><th scope="col">Normal requests</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

const SCENARIO = {
  id: 'checkout-is-slow',
  alert: {
    title: 'Checkout is slow',
    html: '<p>PAGE: checkout p95 is 2.6 s (it was 400 ms). The alert names no cause. Find it before the error budget runs out.</p>',
  },
  budget: { startPct: 100, burnPctPerMin: 4 },
  views: [
    {
      id: 'trace-slow',
      label: 'A slow trace',
      costMin: 5,
      kind: 'clue',
      html:
        '<p>One slow <code>GET /checkout</code> trace, 2.6 s. Nearly all of it is inside inventory: its <code>GET /stock</code> SERVER span lasts 2.1 s.</p>' +
        '<p>Under that span sit 40 <code>SELECT stock</code> CLIENT spans, one after another, about 50 ms each. Each starts when the one before it ends, and none overlap.</p>',
    },
    {
      id: 'triage',
      label: 'Compare slow with normal',
      costMin: 4,
      kind: 'clue',
      html:
        '<p>Which attribute separates the slow checkouts from the normal ones?</p>' +
        `${triageHtml('service.version')}${triageHtml('cloud.region')}`,
    },
    {
      id: 'deploys',
      label: 'Deploys',
      costMin: 2,
      kind: 'neutral',
      html: '<p>Today: inventory 2.4.0 deployed at 14:03. No other service changed.</p>',
    },
    {
      id: 'checkout-logs',
      label: 'Checkout logs',
      costMin: 4,
      kind: 'neutral',
      html: '<p>Requests complete with status 200. There are no errors and no timeouts, only long durations.</p>',
    },
    {
      id: 'db-metrics',
      label: 'Database metrics',
      costMin: 6,
      kind: 'neutral',
      html: '<p>Database CPU is 30%, connections are steady and replica lag is near 0. Nothing is saturated.</p>',
    },
    {
      id: 'gateway-latency',
      label: 'Gateway latency',
      costMin: 4,
      kind: 'neutral',
      html: '<p>The gateway adds 3 ms at p95, as usual. The time is spent behind it.</p>',
    },
    {
      id: 'payments-errors',
      label: 'Payments errors',
      costMin: 5,
      kind: 'herring',
      html: '<p>The payment provider error rate is 0.4%, the same as every day this week. Slow checkouts do not wait on payments.</p>',
    },
    {
      id: 'redis-cpu',
      label: 'Redis CPU',
      costMin: 3,
      kind: 'herring',
      html: '<p>Redis CPU is 12% and flat all day. Cart and session lookups are fast.</p>',
    },
  ],
  hypotheses: [
    {
      id: 'n-plus-one',
      label: 'An N+1 query in inventory',
      right: true,
      why: 'One request makes a query per item instead of one query for all items: 40 sequential SELECT stock CLIENT spans under one GET /stock. It started with inventory 2.4.0, which every slow request runs.',
    },
    {
      id: 'provider',
      label: 'The payment provider is slow',
      right: false,
      why: 'The slow traces spend their time in inventory, not in the call to the provider.',
    },
    {
      id: 'redis',
      label: 'Redis is overloaded',
      right: false,
      why: 'Redis shows no sign of load, and the slow time sits in database spans under inventory.',
    },
    {
      id: 'replicas',
      label: 'The database needs more replicas',
      right: false,
      why: 'The database is not saturated (30% CPU, replica lag near 0). More replicas would not shorten 40 queries that run one after another.',
    },
  ],
  answerAfterViews: 1,
};

const FINISH =
  'You found an N+1 query: inventory 2.4.0 runs one query per item, 40 sequential database CLIENT spans under one request. ' +
  'The trace showed where the time goes, and comparing slow with normal requests showed what changed.';

/** The boss's data (pinned by test/checkout-is-slow.test.mjs). */
export const CONTENT = { scenario: SCENARIO, triage: TRIAGE, finish: FINISH };

export default {
  id: 'checkout-is-slow',
  no: null,
  name: 'Checkout is slow',
  sub: 'Find the cause before the budget runs out',
  icon: '\u{1F6A8}',
  rewardTitle: 'On-call hero',
  mechanics: ['incident'],
  widgets: ['incident'],
  cards: [],
  lights: ['inventory'],
  scored: true,
  scoring: { parMs: null },
  run(ctx) {
    ctx.renderStep(
      `<div class="lesson-intro">${ctx.speech(
        incidentLesson('Checkout is slow and the error budget is burning. Every look costs minutes. Open what you need, then name the cause.'),
      )}</div>
      <div class="lesson-stage">${renderIncident(SCENARIO, newIncident(SCENARIO), { escapeHtml: ctx.escapeHtml })}</div>`,
      '<button class="btn" id="cis-finish" data-finish disabled>Finish</button>',
    );
    const finish = ctx.ovActions.querySelector('#cis-finish');
    mountIncident(ctx, SCENARIO, {
      onComplete: () => {
        finish.disabled = false;
        return finish;
      },
    });
    finish.onclick = () => ctx.finish({ text: FINISH, cards: [] });
  },
};
