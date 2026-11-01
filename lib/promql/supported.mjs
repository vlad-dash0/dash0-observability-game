// The supported PromQL subset as data (docs/M1-DESIGN.md §4.6), for the Query it widget's
// "Supported here" list. Functions, aggregations, units and operators are read from the
// parser's own tables, so the list cannot drift from what parses; only the prose notes
// (selectors, matching) are written here. Pure, DOM-free.

import { UNITS } from './lex.mjs';
import { AGGS, PREC, SUPPORTED_FUNCS } from './parse.mjs';

const ops = (rank) => Object.keys(PREC).filter((op) => PREC[op] === rank);

/** `[{title, items: string[], note}]`; every string is plain text, to be escaped by the view. */
export const SUPPORTED = Object.freeze(
  [
    { title: 'Selectors', items: ['name', 'name{l="v"}', 'l!="v"', 'l=~"re"', 'l!~"re"'], note: 'Regexes match the whole value. One matcher must not match the empty string.' },
    { title: 'Range vectors', items: ['[5m]', ...Object.keys(UNITS)], note: 'Durations such as [1h30m]; only inside rate() and increase().' },
    { title: 'Functions', items: Object.keys(SUPPORTED_FUNCS), note: 'histogram_quantile takes the quantile first, then buckets with an le label.' },
    { title: 'Aggregations', items: [...AGGS], note: 'With by (...) or without (...), before or after the argument.' },
    { title: 'Arithmetic', items: [...ops(2), ...ops(3)], note: 'Parentheses and unary minus work; * and / bind tighter than + and -.' },
    { title: 'Comparison filters', items: ops(1), note: 'Keep the series that pass; there is no bool modifier.' },
    { title: 'Vector matching', items: ['on(…)', 'ignoring(…)'], note: 'One-to-one only; series are matched on identical labels.' },
  ].map((g) => Object.freeze({ ...g, items: Object.freeze(g.items) })),
);
