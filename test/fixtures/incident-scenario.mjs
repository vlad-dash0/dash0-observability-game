// A seeded, deterministic Incident engine scenario (docs/M1-DESIGN.md §4.3): plain data,
// no clock, no randomness. Reference path: open the two clues, then answer 'slow-query'.
// The base budget is 20 minutes (100% at 5%/min), deliberately unlike the bosses' 25 (4%/min),
// and its view costs are all different (3/4/6/2), so a cost read from the wrong view, or a
// total read from the wrong rate, gives a different number. The variants below each change
// one thing a test needs to discriminate on.
export function incidentScenario() {
  return {
    id: 'checkout-slow',
    alert: { title: 'Checkout latency is burning the error budget', html: 'p95 checkout latency is <b>4s</b>.' },
    budget: { startPct: 100, burnPctPerMin: 5 },
    views: [
      { id: 'traces', label: 'Traces', costMin: 3, html: 'Slow spans all wait on one query.', kind: 'clue' },
      { id: 'db-metrics', label: 'Database metrics', costMin: 4, html: 'Query time is up 10x.', kind: 'clue' },
      { id: 'deploys', label: 'Deploy log', costMin: 6, html: 'Nothing deployed today.', kind: 'herring' },
      { id: 'status-page', label: 'Status page', costMin: 2, html: 'All green.', kind: 'neutral' },
    ],
    hypotheses: [
      { id: 'slow-query', label: 'A slow database query', right: true, why: 'Every slow trace waits on it.' },
      { id: 'bad-deploy', label: 'A bad deploy', right: false, why: 'No deploy happened.' },
      { id: 'network', label: 'Network loss', right: false, why: 'Other services are fine.' },
    ],
    answerAfterViews: 2,
  };
}

/** Three clues (a 1-minute `logs` clue last), still two needed: the counter must stop at 2. */
export function threeClues() {
  const s = incidentScenario();
  s.views.push({ id: 'logs', label: 'Logs', costMin: 1, html: 'Timeouts from the orders query.', kind: 'clue' });
  return s;
}

/** The right cause is the third hypothesis, so "the first hypothesis" and "the right one" differ. */
export function rightLast() {
  const s = incidentScenario();
  const [right, ...rest] = s.hypotheses;
  s.hypotheses = [...rest, right];
  return s;
}

/** A 2-minute budget (10% at 5%/min) of 1-minute views: one clue unlocks, a herring can spend the rest. */
export function tight() {
  const s = incidentScenario();
  s.budget = { startPct: 10, burnPctPerMin: 5 };
  s.views = [
    { id: 'a', label: 'A', costMin: 1, html: 'a', kind: 'clue' },
    { id: 'h', label: 'Herring', costMin: 1, html: 'h', kind: 'herring' },
    { id: 'b', label: 'B', costMin: 1, html: 'b', kind: 'neutral' },
    { id: 'c', label: 'C', costMin: 1, html: 'c', kind: 'neutral' },
  ];
  s.answerAfterViews = 1;
  return s;
}

/** A fractional rate: 100% at 2.3%/min is 43.478... minutes (shown 43.5, 44 cells). */
export function frac() {
  const s = incidentScenario();
  s.budget = { startPct: 100, burnPctPerMin: 2.3 };
  s.views = [
    { id: 'a', label: 'A', costMin: 14, html: 'a', kind: 'clue' },
    { id: 'b', label: 'B', costMin: 1, html: 'b', kind: 'neutral' },
  ];
  s.answerAfterViews = 1;
  return s;
}

/** A slow burn: 100% at 0.5%/min is 200 minutes, more cells than the kit meter draws (100). */
export function slow() {
  const s = incidentScenario();
  s.budget = { startPct: 100, burnPctPerMin: 0.5 };
  return s;
}

/** No clue needed first: the causes are open from the start. */
export function zero() {
  const s = incidentScenario();
  s.answerAfterViews = 0;
  return s;
}
