// lib/promql/parse.mjs: the PromQL subset parser. Spec: docs/M1-DESIGN.md §4.6.
// Asserts kinds, strings and numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/promql/parse.mjs';

const kind = (q) => parse(q).kind;
const detail = (q) => {
  const r = parse(q);
  return r.kind === 'unsupported' ? r.what : `${r.message} @${r.at}`;
};

test('supported queries parse', () => {
  for (const q of [
    'x',
    'rate(x[5m])',
    'increase(x{a="1"}[1h30m])',
    'sum by (a, b) (rate(x{a="1",b!="2",c=~"x.*",d!~"y"}[1h]))',
    'sum(rate(x[5m])) by (a)',
    'sum without (a) (x)',
    'avg(x) + max(x) - min(x) * count(x)',
    'histogram_quantile(0.99, sum by (le) (rate(h_bucket[5m])))',
    'histogram_quantile(1 - 0.01, h_bucket)',
    'x / on(a) y',
    'x + ignoring(a, b) y',
    'x > 5',
    '5 < x',
    'x >= y',
    '-x',
    '(1 + 2) * 3',
    '{job="a"}',
    '1e3',
    'Inf',
    'x # trailing comment',
    "x{a='single', b=`back`,}",
  ]) {
    assert.equal(kind(q), 'ok', q + ' -> ' + detail(q));
  }
});

test('unsupported syntax is reported as unsupported with a name, never as a syntax error', () => {
  const cases = {
    'x offset 5m': /offset/,
    'rate(x[5m] offset 1h)': /offset/,
    'x @ 100': /@/,
    'rate(x[5m])[30m:1m]': /subquer/,
    'x[5m:1m]': /subquer/,
    'max_over_time(rate(x[5m])[30m:1m])': /max_over_time/,
    'topk(3, x)': /topk/,
    'quantile(0.9, x)': /quantile/,
    'stddev(x)': /stddev/,
    'label_replace(x, "a", "b", "c", "d")': /label_replace/,
    'irate(x[5m])': /irate/,
    'abs(x)': /abs/,
    'x and y': /and/,
    'x or y': /or/,
    'x unless y': /unless/,
    'x ^ 2': /\^/,
    'x % 2': /%/,
    'x > bool 1': /bool/,
    'x / on(a) group_left y': /group_left/,
    '"abc"': /string/,
  };
  for (const [q, what] of Object.entries(cases)) {
    assert.equal(kind(q), 'unsupported', q + ' -> ' + detail(q));
    assert.match(parse(q).what, what, q);
  }
});

test('syntax errors carry a message and the offset', () => {
  const cases = {
    'rate(x[5m]': [10, /expected "\)"/],
    'sum by a (x)': [7, /expected "\("/],
    'x{a=}': [4, /string/],
    'x{a="1"': [7, /expected "\}"/],
    'x +': [3, /end of input/],
    'x $': [2, /unexpected character/],
    '': [0, /end of input/],
    'x y': [2, /unexpected/],
    '{}': [0, /at least one non-empty matcher/],
    '{a=~""}': [0, /at least one non-empty matcher/],
    'x{a=~"("}': [5, /regular expression/],
    'rate(x)': [5, /range vector/],
    'rate(x[5m], 1)': [0, /1 argument/],
    'histogram_quantile(x, x)': [19, /scalar/],
    'sum(x[5m])': [4, /instant vector/],
    'x[5m] + 1': [6, /scalar and instant vector/],
    'rate(sum(x)[5m])': [11, /ranges only allowed for vector selectors/],
    '1 > 2': [2, /BOOL/],
    '1 / on(a) 2': [2, /instant vectors/],
    'foo(1)': [0, /unknown function/],
    'sum by (a) (x) by (b)': [15, /grouping/],
    'x[5mx]': [2, /duration|unexpected/],
  };
  for (const [q, [at, msg]] of Object.entries(cases)) {
    const r = parse(q);
    assert.equal(r.kind, 'syntax', q + ' -> ' + detail(q));
    assert.equal(r.at, at, q);
    assert.match(r.message, msg, q);
  }
});
