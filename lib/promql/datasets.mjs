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
// /pay's latency is not steady after the deploy: from the deploy to TAIL_AT its slow requests are
// fewer (`during`), and in the last 5 minutes (`after`) it gets worse. So the totals since the
// restart differ from the last 5 minutes, and a histogram query without rate() reads wrong values.
const SCRAPE = 15;
const END = 3600;
const DEPLOY_AT = 2400;
const TAIL_AT = END - 300;
const LE = ['0.05', '0.1', '0.25', '0.5', '1', '2.5', '+Inf'];
const REP = [0.03, 0.07, 0.17, 0.4, 0.8, 1.8, 4]; // what _sum adds per observation in each bucket
// dist = observations per scrape in each (non-cumulative) bucket; err = those that answered 500.
const STEADY = (err, dist) => ({ before: { err, dist }, after: { err, dist } });
const ROUTES = [
  { service: 'checkout', route: '/pay', restarts: true,
    before: { err: 2, dist: [6, 24, 18, 9, 3, 0, 0] }, after: { err: 15, dist: [0, 6, 12, 12, 18, 10, 2] },
    during: { err: 15, dist: [0, 6, 12, 12, 20, 10, 0] } },
  { service: 'checkout', route: '/quote', restarts: true, ...STEADY(0, [60, 40, 15, 5, 0, 0, 0]) },
  { service: 'cart', route: '/add', restarts: false, ...STEADY(0, [45, 30, 10, 5, 0, 0, 0]) },
  { service: 'cart', route: '/view', restarts: false, ...STEADY(0, [90, 40, 15, 5, 0, 0, 0]) },
];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function checkoutHttp() {
  const ticks = END / SCRAPE;
  const deployTick = DEPLOY_AT / SCRAPE;
  const tailTick = TAIL_AT / SCRAPE;
  const series = [];
  // value after k scrapes of a counter growing by `b` per scrape, then `d` per scrape from the deploy
  // to the last 5 minutes, then `a` per scrape; a restarting counter starts again at the deploy
  const counter = (b, d, a, restarts) => (k) => {
    const sinceDeploy = d * (Math.min(k, tailTick) - deployTick) + a * Math.max(0, k - tailTick);
    if (k < deployTick) return b * k;
    return (restarts ? 0 : b * deployTick) + sinceDeploy;
  };
  const add = (labels, perBefore, perDuring, perAfter, restarts, rounded = false) => {
    const at = counter(perBefore, perDuring, perAfter, restarts);
    const samples = Array.from({ length: ticks + 1 }, (_, k) => [k * SCRAPE, rounded ? round6(at(k)) : at(k)]);
    series.push({ labels, samples });
  };
  for (const { service, route, restarts, before, after, during = after } of ROUTES) {
    const base = { route, service };
    for (const [status, pick] of [['200', (p) => sum(p.dist) - p.err], ['500', (p) => p.err]]) {
      add({ __name__: 'http_server_requests_total', ...base, status }, pick(before), pick(during), pick(after), restarts);
    }
    const total = (p) => sum(p.dist);
    add({ __name__: 'http_server_request_duration_seconds_count', ...base }, total(before), total(during), total(after), restarts);
    add({ __name__: 'http_server_request_duration_seconds_sum', ...base },
      sum(before.dist.map((n, i) => n * REP[i])), sum(during.dist.map((n, i) => n * REP[i])),
      sum(after.dist.map((n, i) => n * REP[i])), restarts, true);
    LE.forEach((le, i) => {
      const upTo = (p) => sum(p.dist.slice(0, i + 1)); // cumulative, as `le` buckets are
      add({ __name__: 'http_server_request_duration_seconds_bucket', ...base, le }, upTo(before), upTo(during), upTo(after), restarts);
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

// checkout-spanmetrics: what a spanmetrics connector in the Collector emits for the same traffic
// as checkout-http, named as the connector names them after the 3.4 translation: `calls` (a
// monotonic Sum, so `_total`) and `duration` (a Histogram in milliseconds, the connector's default
// unit). The connector counts, so a service deploy is no reset. A success is STATUS_CODE_UNSET (an
// HTTP server span is only set to error for a 5xx), and a series exists only for a status the span
// has had. The CLIENT span is checkout's outbound call to the payment provider, once per /pay.
// Errored requests are the slowest ones, so summed over status each span has the checkout-http
// distribution (cart /view adds 1 failing request per scrape that checkout-http does not have). The
// connector does not count checkout-http's `during` phase: only the last 5 minutes (`after`) match.
const SERVER = 'SPAN_KIND_SERVER';
const CLIENT = 'SPAN_KIND_CLIENT';
const SPAN_LE = ['50', '100', '250', '500', '1000', '2500', '+Inf'];
const SPANS = [
  { service_name: 'checkout', span_name: 'POST /pay', span_kind: SERVER, ...ROUTES[0] },
  { service_name: 'checkout', span_name: 'GET /quote', span_kind: SERVER, ...ROUTES[1] },
  { service_name: 'cart', span_name: 'POST /add', span_kind: SERVER, ...ROUTES[2] },
  { service_name: 'cart', span_name: 'GET /view', span_kind: SERVER, ...STEADY(1, ROUTES[3].before.dist) },
  { service_name: 'checkout', span_name: 'POST', span_kind: CLIENT, ...ROUTES[0] },
];
/** `dist` with `err` observations taken off the slowest non-empty buckets: [ok, failed]. */
function splitByStatus({ err, dist }) {
  const failed = dist.map(() => 0);
  let left = err;
  for (let i = dist.length - 1; i >= 0 && left > 0; i--) {
    failed[i] = Math.min(dist[i], left);
    left -= failed[i];
  }
  return [dist.map((n, i) => n - failed[i]), failed];
}

function checkoutSpanmetrics() {
  const ticks = END / SCRAPE;
  const deployTick = DEPLOY_AT / SCRAPE;
  const series = [];
  const add = (labels, perBefore, perAfter, rounded = false) => {
    const at = (k) => perBefore * Math.min(k, deployTick) + perAfter * Math.max(0, k - deployTick);
    series.push({ labels, samples: Array.from({ length: ticks + 1 }, (_, k) => [k * SCRAPE, rounded ? round6(at(k)) : at(k)]) });
  };
  for (const { before, after, ...span } of SPANS) {
    const dims = { service_name: span.service_name, span_kind: span.span_kind, span_name: span.span_name };
    const [okB, errB] = splitByStatus(before);
    const [okA, errA] = splitByStatus(after);
    for (const [status, b, a] of [['STATUS_CODE_UNSET', okB, okA], ['STATUS_CODE_ERROR', errB, errA]]) {
      if (sum(b) + sum(a) === 0) continue; // never seen: the connector creates no series
      const base = { ...dims, status_code: status };
      add({ __name__: 'traces_span_metrics_calls_total', ...base }, sum(b), sum(a));
      add({ __name__: 'traces_span_metrics_duration_milliseconds_count', ...base }, sum(b), sum(a));
      add({ __name__: 'traces_span_metrics_duration_milliseconds_sum', ...base },
        sum(b.map((n, i) => n * REP[i] * 1000)), sum(a.map((n, i) => n * REP[i] * 1000)), true);
      SPAN_LE.forEach((le, i) => {
        const upTo = (d) => sum(d.slice(0, i + 1));
        add({ __name__: 'traces_span_metrics_duration_milliseconds_bucket', ...base, le }, upTo(b), upTo(a));
      });
    }
  }
  series.sort((a, b) => (labelKey(a.labels) < labelKey(b.labels) ? -1 : 1));
  return {
    id: 'checkout-spanmetrics',
    title: 'Span metrics for checkout and cart, from a spanmetrics connector (one scrape per 15s)',
    meta: { scrape: SCRAPE, start: 0, end: END, deployAt: DEPLOY_AT },
    series,
  };
}

/** name -> generator. A level names one of these; add a dataset here, never inline in a level. */
export const DATASETS = { 'checkout-http': checkoutHttp, 'checkout-spanmetrics': checkoutSpanmetrics };

const cache = new Map();
/** The dataset registered as `name`, built once and deep-frozen. Throws on an unknown name. */
export function getDataset(name) {
  if (!Object.hasOwn(DATASETS, name)) throw new Error(`unknown dataset "${name}"`);
  if (!cache.has(name)) cache.set(name, deepFreeze(DATASETS[name]()));
  return cache.get(name);
}

export const datasetNames = () => Object.keys(DATASETS).sort();
