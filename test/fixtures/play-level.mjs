// A declarative level (docs/DECLARATIVE-LEVELS.md): one step of each live step type, so the
// generated suites (test/play.test.mjs, test/answers.test.mjs, levels-play) have a play level
// before any shipped level is declarative. Not registered in levels/index.mjs. A fresh copy per
// call, so a test may edit it.
import { incidentScenario } from './incident-scenario.mjs';
import { FIXTURE_CARD } from './fixture-level.mjs';
import { logsSpec } from './build-logs.mjs';

export { FIXTURE_CARD };

const SPAN = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', service: 'shop', status: 'UNSET', links: [] };

export function playFixture() {
  return {
    id: 'play-fixture',
    no: '0.1',
    name: 'Play fixture',
    icon: '*',
    rewardTitle: 'Play fixture finisher',
    cards: ['fixture-card'],
    play: {
      prefix: 'fx',
      steps: [
        {
          intro: 'Which signal tells you <b>where</b> a request spent its time?',
          question: 'Pick one.',
          choice: {
            id: 'fx-pick',
            choices: [
              { key: 'metric', label: 'A metric', why: 'A metric aggregates.' },
              { key: 'trace', label: 'A trace', right: true, why: 'Spans carry timing.' },
              { key: 'log', label: 'A log', why: 'A log has no tree.' },
            ],
          },
        },
        {
          intro: 'Who adds what?',
          question: 'Pick an item, then a bucket.',
          sort: {
            id: 'fx-sort',
            buckets: [{ id: 'auto', label: 'Automatic' }, { id: 'manual', label: 'Your code' }],
            items: [
              { id: 'server', label: 'Server span', bucket: 'auto', why: 'The agent adds it.', whyNot: { manual: 'No code needed.' } },
              { id: 'loyalty', label: 'Loyalty span', bucket: 'manual', why: 'Only your code knows it.' },
            ],
          },
        },
        {
          intro: 'The child span arrived as a root.',
          question: 'Give it its parent.',
          build: {
            id: 'fx-tree',
            spans: [
              { ...SPAN, spanId: 'aaaaaaaaaaaaaaa1', name: 'POST /pay', kind: 'SERVER', startMs: 0, endMs: 100, parentId: null },
              { ...SPAN, spanId: 'aaaaaaaaaaaaaaa2', name: 'charge', kind: 'CLIENT', startMs: 10, endMs: 90, parentId: null },
            ],
            edit: ['parent'],
            answer: { aaaaaaaaaaaaaaa2: { parentId: 'aaaaaaaaaaaaaaa1' } },
            hint: 'A parent starts first.',
          },
        },
        {
          intro: 'Checkout is slow.',
          code: '<img src=x onerror=alert(1)>',
          incident: incidentScenario(),
        },
        {
          intro: 'One attribute on this span will blow up your bill.',
          question: 'Spot the attribute that has unbounded values.',
          spot: {
            id: 'fx-spot',
            target: 'span',
            lines: [
              { id: 'route', text: 'http.route=/pay' },
              { id: 'user', text: 'user.id=8841' },
              { id: 'status', text: 'http.status_code=200' },
            ],
            faults: ['user'],
            whyNot: { route: 'A route comes from a small fixed set.' },
            explain: 'A user id has a new value for every user.',
          },
        },
        {
          intro: 'The bill is over budget, but you still need two signals.',
          question: 'Pick a plan that fits the cap and keeps what you need.',
          tradeoff: {
            id: 'fx-budget',
            unit: 'GB/day',
            cap: 12,
            knobs: [
              {
                id: 'sampling',
                label: 'Sampling',
                options: [
                  { id: 'head', label: 'Head 5%', cost: 2 },
                  { id: 'tail', label: 'Tail: keep errors', cost: 8, keeps: ['errors'] },
                  { id: 'all', label: 'Keep everything', cost: 18, keeps: ['errors'] },
                ],
              },
              {
                id: 'attrs',
                label: 'User attribute',
                options: [
                  { id: 'none', label: 'Drop it', cost: 1 },
                  { id: 'tier', label: 'user.tier', cost: 3, keeps: ['per-user'] },
                  { id: 'user', label: 'user.id', cost: 9, keeps: ['per-user'] },
                ],
              },
            ],
            needs: [
              { id: 'errors', label: 'every error trace' },
              { id: 'per-user', label: 'a per-user view' },
            ],
            answer: { sampling: 'tail', attrs: 'tier' },
            whyNot: { 'attrs:user': 'A raw user id has a new value for every user.' },
            explain: 'Tail sampling keeps the errors; a tier is bounded.',
          },
        },
        {
          intro: 'Checkout traffic looks busy. How much, per service?',
          question: 'Write a query for the request rate of each service.',
          query: {
            id: 'fx-query',
            dataset: 'checkout-http',
            at: 3000,
            reference: 'sum by (service) (rate(http_server_requests_total[5m]))',
            hint: 'A counter only grows: take its <code>rate</code> first.',
            explain: 'Rate turns a counter into a per-second figure; sum by keeps one series per service.',
          },
        },
        {
          intro: 'The Collector is up, but no traces reach Dash0. Read the config.',
          question: 'Fix the config so the traces pipeline flows.',
          configure: {
            id: 'fx-config',
            schema: 'collector',
            given: [
              'receivers:',
              '  otlp:',
              'exporters:',
              '  otlp/dash0:',
              'service:',
              '  pipelines:',
              '    traces:',
              '      receivers: [otlp]',
              '      exporters: [otlp/dash0x]',
              '',
            ].join('\n'),
            reference: [
              'receivers:',
              '  otlp:',
              'processors:',
              '  batch:',
              'exporters:',
              '  otlp/dash0:',
              'service:',
              '  pipelines:',
              '    traces:',
              '      receivers: [otlp]',
              '      processors: [batch]',
              '      exporters: [otlp/dash0]',
              '',
            ].join('\n'),
            target: ['traces'],
            uses: { traces: ['batch'] },
            hint: 'Compare the exporter name in the pipeline with the one defined above it.',
            explain: 'A pipeline can only use components that are defined, and the names must match exactly.',
          },
        },
        {
          intro: 'The checkout and payments logs carry no trace context yet.',
          question: 'Attach each log record to the span it was written in, or to none.',
          build: {
            ...logsSpec(),
            id: 'fx-logs',
            hint: 'A record belongs to a span only if that span was active when it was written. Compare the thread names.',
            explain: 'A log record carries a span_id only when it was written while that span was active.',
          },
        },
      ],
      finish: 'You played every live step type.',
    },
  };
}

export default playFixture();
