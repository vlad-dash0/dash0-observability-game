// A declarative level (docs/DECLARATIVE-LEVELS.md): one step of each live step type, so the
// generated suites (test/play.test.mjs, test/answers.test.mjs, levels-play) have a play level
// before any shipped level is declarative. Not registered in levels/index.mjs. A fresh copy per
// call, so a test may edit it.
import { incidentScenario } from './incident-scenario.mjs';
import { FIXTURE_CARD } from './fixture-level.mjs';

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
      ],
      finish: 'You played every live step type.',
    },
  };
}

export default playFixture();
