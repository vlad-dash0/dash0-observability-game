// The two numeric kernels of the subset, ported from Prometheus (promql/functions.go
// `extrapolatedRate`, promql/quantile.go `bucketQuantile`). Pure functions over plain numbers.
// Docs: https://prometheus.io/docs/prometheus/latest/querying/functions/#rate
//       https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile
// What is implemented, and what is not, is written out in docs/M1-DESIGN.md §4.6.

/**
 * rate()/increase() over `samples` ([[t, v]] ascending, already inside the window
 * (rangeStart, rangeEnd]; seconds). Treats the series as a counter: a sample lower than its
 * predecessor is a reset and the predecessor's value is added back. Extrapolates towards both
 * window edges: all the way if the nearest sample is within 1.1 x the average sample spacing
 * of the edge, otherwise by half a spacing; the start is never extrapolated past the point
 * where the counter would have been zero. `isRate` divides by `rangeSeconds` (the selector's
 * range, not the sampled interval). Fewer than two samples: `null` (no result, not zero).
 */
export function extrapolatedDelta(samples, rangeStart, rangeEnd, rangeSeconds, isRate) {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples.at(-1);
  let delta = last[1] - first[1];
  for (let i = 1; i < samples.length; i++) if (samples[i][1] < samples[i - 1][1]) delta += samples[i - 1][1];
  const sampled = last[0] - first[0];
  const avg = sampled / (samples.length - 1);
  let toStart = first[0] - rangeStart;
  const toEnd = rangeEnd - last[0];
  if (delta > 0 && first[1] >= 0) toStart = Math.min(toStart, sampled * (first[1] / delta));
  const threshold = avg * 1.1;
  let span = sampled;
  span += toStart >= threshold ? avg / 2 : toStart;
  span += toEnd >= threshold ? avg / 2 : toEnd;
  const factor = span / sampled / (isRate ? rangeSeconds : 1);
  return delta * factor;
}

/**
 * histogram_quantile for one classic histogram: `buckets` is [{le, count}] with cumulative
 * counts (`le` may be Infinity). Sorts by bound, sums duplicate bounds, raises any count below
 * its predecessor (monotonic fix), then interpolates linearly inside the bucket holding the
 * rank. A rank in the +Inf bucket answers the highest finite bound. NaN when there is no +Inf
 * bucket, fewer than two buckets, or no observations; -Inf below 0 and +Inf above 1.
 */
export function bucketQuantile(q, buckets) {
  if (Number.isNaN(q)) return NaN;
  if (q < 0) return -Infinity;
  if (q > 1) return Infinity;
  const sorted = [...buckets].sort((a, b) => a.le - b.le);
  if (sorted.length === 0 || sorted.at(-1).le !== Infinity) return NaN;
  const bs = [];
  for (const b of sorted) {
    if (bs.length && bs.at(-1).le === b.le) bs.at(-1).count += b.count;
    else bs.push({ le: b.le, count: b.count });
  }
  if (bs.length < 2) return NaN;
  for (let i = 1; i < bs.length; i++) bs[i].count = Math.max(bs[i].count, bs[i - 1].count);
  const observations = bs.at(-1).count;
  if (observations === 0) return NaN;
  let rank = q * observations;
  const b = bs.slice(0, -1).findIndex((x) => x.count >= rank);
  if (b === -1) return bs.at(-2).le;
  if (b === 0 && bs[0].le <= 0) return bs[0].le;
  let start = 0;
  let count = bs[b].count;
  if (b > 0) {
    start = bs[b - 1].le;
    count -= bs[b - 1].count;
    rank -= bs[b - 1].count;
  }
  return start + (bs[b].le - start) * (rank / count);
}
