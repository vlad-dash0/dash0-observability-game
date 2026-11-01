// Tiny datasets for the PromQL tests: `ds` builds one from [labels, samples] pairs,
// `at` builds series with a single sample at time `t`.
export const ds = (...series) => ({ id: 'test', series: series.map(([labels, samples]) => ({ labels, samples })) });
export const at = (t, ...rows) => ds(...rows.map(([labels, v]) => [labels, [[t, v]]]));
export const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
