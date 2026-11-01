// Named fake TSDBs for Query it (docs/M1-DESIGN.md §4.6). "Data holds names, code holds
// functions" (docs/DECLARATIVE-LEVELS.md §2): a level names a dataset, the registry maps the
// name to a pure generator. A dataset is `{id, title, meta, series: [{labels, samples: [[t, v]]}]}`,
// seconds, series sorted by label set, no randomness.

import { labelKey } from './eval.mjs';

const deepFreeze = (v) => {
  if (v && typeof v === 'object') for (const k of Object.keys(v)) deepFreeze(v[k]);
  return Object.freeze(v);
};
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// checkout-http: an HTTP server's request counter and duration histogram, one scrape every 15s
// for an hour (t = 0..3600). At t = 2400 the checkout service deploys: its pods restart (every
// checkout counter resets to 0 and counts up again) and /pay gets slower and starts failing.
// The other routes are the control: identical before and after. Every figure is per scrape.
const SCRAPE = 15;
const END = 3600;
const DEPLOY_AT = 2400;
const LE = ['0.05', '0.1', '0.25', '0.5', '1', '2.5', '+Inf'];
const REP = [0.03, 0.07, 0.17, 0.4, 0.8, 1.8, 4]; // what _sum adds per observation in each bucket
// dist = observations per scrape in each (non-cumulative) bucket; err = those that answered 500.
const STEADY = (err, dist) => ({ before: { err, dist }, after: { err, dist } });
const ROUTES = [
  { service: 'checkout', route: '/pay', restarts: true,
    before: { err: 2, dist: [6, 24, 18, 9, 3, 0, 0] }, after: { err: 15, dist: [0, 6, 12, 12, 18, 9, 3] } },
  { service: 'checkout', route: '/quote', restarts: true, ...STEADY(0, [60, 40, 15, 5, 0, 0, 0]) },
  { service: 'cart', route: '/add', restarts: false, ...STEADY(0, [45, 30, 10, 5, 0, 0, 0]) },
  { service: 'cart', route: '/view', restarts: false, ...STEADY(0, [90, 40, 15, 5, 0, 0, 0]) },
];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function checkoutHttp() {
  const ticks = END / SCRAPE;
  const deployTick = DEPLOY_AT / SCRAPE;
  const series = [];
  // value after k scrapes of a counter growing by `b` per scrape, then `a` per scrape from the deploy on
  const counter = (b, a, restarts) => (k) =>
    restarts && k >= deployTick ? a * (k - deployTick) : b * Math.min(k, deployTick) + a * Math.max(0, k - deployTick);
  const add = (labels, perBefore, perAfter, restarts, rounded = false) => {
    const at = counter(perBefore, perAfter, restarts);
    const samples = Array.from({ length: ticks + 1 }, (_, k) => [k * SCRAPE, rounded ? round6(at(k)) : at(k)]);
    series.push({ labels, samples });
  };
  for (const { service, route, restarts, before, after } of ROUTES) {
    const base = { route, service };
    for (const [status, pick] of [['200', (p) => sum(p.dist) - p.err], ['500', (p) => p.err]]) {
      add({ __name__: 'http_server_requests_total', ...base, status }, pick(before), pick(after), restarts);
    }
    const total = (p) => sum(p.dist);
    add({ __name__: 'http_server_request_duration_seconds_count', ...base }, total(before), total(after), restarts);
    add({ __name__: 'http_server_request_duration_seconds_sum', ...base },
      sum(before.dist.map((n, i) => n * REP[i])), sum(after.dist.map((n, i) => n * REP[i])), restarts, true);
    LE.forEach((le, i) => {
      const upTo = (p) => sum(p.dist.slice(0, i + 1)); // cumulative, as `le` buckets are
      add({ __name__: 'http_server_request_duration_seconds_bucket', ...base, le }, upTo(before), upTo(after), restarts);
    });
  }
  series.sort((a, b) => (labelKey(a.labels) < labelKey(b.labels) ? -1 : 1));
  return {
    id: 'checkout-http',
    title: 'Checkout and cart HTTP metrics (one scrape per 15s, deploy at t=2400)',
    meta: { scrape: SCRAPE, start: 0, end: END, deployAt: DEPLOY_AT },
    series,
  };
}

/** name -> generator. A level names one of these; add a dataset here, never inline in a level. */
export const DATASETS = { 'checkout-http': checkoutHttp };

const cache = new Map();
/** The dataset registered as `name`, built once and deep-frozen. Throws on an unknown name. */
export function getDataset(name) {
  if (!Object.hasOwn(DATASETS, name)) throw new Error(`unknown dataset "${name}"`);
  if (!cache.has(name)) cache.set(name, deepFreeze(DATASETS[name]()));
  return cache.get(name);
}

export const datasetNames = () => Object.keys(DATASETS).sort();
