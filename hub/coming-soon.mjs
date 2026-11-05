// Acts shown on the hub and the globe but not playable (#177 P7). Never in levels/index.mjs ACTS,
// so never in the registry, unlock, progress, stars or cards. When an act gets its first level, add
// it to ACTS and delete its entry here (test/coming-soon.test.mjs fails while it is in both).
export const COMING_SOON = Object.freeze([
  Object.freeze({
    id: 'act-7',
    no: 7,
    name: 'Alerting and SLOs',
    sub: 'Wake me only when it matters',
    teaser: 'Good alerts, SLOs and error budgets, burn-rate alerts and synthetic checks.',
  }),
  Object.freeze({
    id: 'act-8',
    no: 8,
    name: 'Operating at scale',
    sub: 'As code',
    teaser:
      'Dashboards as code, semantic convention upgrades, migrating vendors, browser telemetry and AI-assisted debugging.',
  }),
]);
