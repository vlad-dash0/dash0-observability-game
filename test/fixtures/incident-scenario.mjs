// A seeded, deterministic Incident engine scenario (docs/M1-DESIGN.md §4.3): plain data,
// no clock, no randomness. Reference path: open the two clues, then answer 'slow-query'.
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
