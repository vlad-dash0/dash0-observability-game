// PromQL subset parser (docs/M1-DESIGN.md §4.6): text -> AST, or a failure result.
// Grammar and precedence follow https://prometheus.io/docs/prometheus/latest/querying/basics/
// and https://prometheus.io/docs/prometheus/latest/querying/operators/ for what is supported;
// everything else real PromQL has is reported `unsupported`, never `syntax`.
//
// Nodes (`vt` is the value type: 'scalar' | 'vector' | 'matrix'):
//   {type:'num', value} | {type:'neg', arg} | {type:'paren', arg}
//   {type:'sel', matchers:[{label, op, value, re?}]}      (the metric name is a `__name__` matcher)
//   {type:'matrix', sel, range}                           (range in seconds; only valid as rate/increase's argument)
//   {type:'call', fn, args}     fn: rate | increase | histogram_quantile
//   {type:'agg', op, arg, by?: string[], without?: string[]}
//   {type:'bin', op, lhs, rhs, matching: {kind:'on'|'ignoring', labels} | null}

import { lex, QueryFail, syntax, unsupported } from './lex.mjs';

export const AGGS = new Set(['sum', 'avg', 'min', 'max', 'count']);
const AGGS_UNSUPPORTED = new Set(['topk', 'bottomk', 'quantile', 'stddev', 'stdvar', 'count_values', 'group', 'limitk', 'limit_ratio']);
export const SUPPORTED_FUNCS = { rate: 1, increase: 1, histogram_quantile: 2 };
// Every other function in the Prometheus docs: known, so reported unsupported rather than "unknown".
const KNOWN_FUNCS = new Set(`abs absent absent_over_time acos acosh asin asinh atan atanh avg_over_time ceil changes clamp
  clamp_max clamp_min cos cosh count_over_time day_of_month day_of_week day_of_year days_in_month deg delta deriv
  double_exponential_smoothing exp first_over_time floor histogram_avg histogram_count histogram_fraction
  histogram_stddev histogram_stdvar histogram_sum holt_winters hour idelta info irate label_join label_replace
  last_over_time ln log10 log2 mad_over_time max_over_time min_over_time minute month pi predict_linear
  present_over_time quantile_over_time rad resets round scalar sgn sin sinh sort sort_by_label sort_by_label_desc
  sort_desc sqrt stddev_over_time stdvar_over_time sum_over_time tan tanh time timestamp vector year`.split(/\s+/));
const SET_OPS = new Set(['and', 'or', 'unless', 'atan2']);
export const PREC = { '==': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3 };
const MATCH_OPS = new Set(['=', '!=', '=~', '!~']);
const TYPE_NAME = { scalar: 'scalar', vector: 'instant vector', matrix: 'range vector' };

/** Does `matcher` accept the label value `value` ('' for an absent label)? Regexes are anchored. */
export function testMatcher(m, value) {
  switch (m.op) {
    case '=': return value === m.value;
    case '!=': return value !== m.value;
    case '=~': return m.re.test(value);
    default: return !m.re.test(value);
  }
}

/** Parse `src`: `{kind:'ok', ast}` | `{kind:'syntax', message, at}` | `{kind:'unsupported', what}`. */
export function parse(src) {
  try {
    return { kind: 'ok', ast: parseAll(src) };
  } catch (e) {
    if (e instanceof QueryFail) return e.result;
    throw e;
  }
}

function parseAll(src) {
  const toks = lex(src);
  let p = 0;
  const peek = (n = 0) => toks[Math.min(p + n, toks.length - 1)];
  const next = () => toks[p++];
  const isOp = (v, n = 0) => peek(n).t === 'op' && peek(n).v === v;
  const isId = (v, n = 0) => peek(n).t === 'id' && peek(n).v === v;
  const describe = (t) => (t.t === 'eof' ? 'end of input' : `"${src.slice(t.at, t.end)}"`);
  const expectOp = (v) => {
    if (!isOp(v)) throw syntax(`expected "${v}", got ${describe(peek())}`, peek().at);
    return next();
  };
  const expectType = (node, vt, what, at) => {
    if (node.vt !== vt) throw syntax(`expected type ${TYPE_NAME[vt]} in ${what}, got ${TYPE_NAME[node.vt]}`, at);
  };

  function labelList() {
    expectOp('(');
    const labels = [];
    while (!isOp(')')) {
      if (peek().t !== 'id') throw syntax(`expected a label name, got ${describe(peek())}`, peek().at);
      labels.push(next().v);
      if (isOp(',')) next();
      else break;
    }
    expectOp(')');
    return labels;
  }

  function selector(name, at) {
    const matchers = name === null ? [] : [{ label: '__name__', op: '=', value: name }];
    if (isOp('{')) {
      next();
      while (!isOp('}')) {
        if (peek().t !== 'id') throw syntax(`expected a label name, got ${describe(peek())}`, peek().at);
        const label = next().v;
        if (peek().t !== 'op' || !MATCH_OPS.has(peek().v)) throw syntax(`expected a label matcher (=, !=, =~, !~), got ${describe(peek())}`, peek().at);
        const op = next().v;
        if (peek().t !== 'str') throw syntax(`expected a string, got ${describe(peek())}`, peek().at);
        const value = peek().v;
        const strAt = next().at;
        const m = { label, op, value };
        if (op === '=~' || op === '!~') {
          try {
            m.re = new RegExp(`^(?:${value})$`, 's');
          } catch {
            throw syntax(`invalid regular expression ${JSON.stringify(value)}`, strAt);
          }
        }
        matchers.push(m);
        if (isOp(',')) next();
        else break;
      }
      expectOp('}');
    }
    if (!matchers.some((m) => !testMatcher(m, ''))) throw syntax('vector selector must contain at least one non-empty matcher', at);
    return { type: 'sel', matchers, vt: 'vector', at };
  }

  function postfix(node) {
    if (isOp('[')) {
      const at = peek().at;
      next();
      if (peek().t !== 'dur') throw syntax(`expected a duration, got ${describe(peek())}`, peek().at);
      const range = next().v;
      // `:1m` lexes as one identifier (a metric name may contain colons), so catch both shapes.
      if (isOp(':') || (peek().t === 'id' && peek().v.startsWith(':'))) throw unsupported('subquery ([range:step])');
      expectOp(']');
      if (node.type !== 'sel') throw syntax('ranges only allowed for vector selectors', node.at ?? at);
      node = { type: 'matrix', sel: node, range, vt: 'matrix', at: node.at };
    }
    if (isOp('[')) throw unsupported('subquery ([range:step])');
    if (isId('offset')) throw unsupported('offset modifier');
    if (isOp('@')) throw unsupported('@ modifier');
    return node;
  }

  function call(name, at) {
    if (SUPPORTED_FUNCS[name] === undefined) {
      if (KNOWN_FUNCS.has(name)) throw unsupported(`function ${name}()`);
      throw syntax(`unknown function ${JSON.stringify(name)}`, at);
    }
    expectOp('(');
    const args = [];
    while (!isOp(')')) {
      args.push(binary(0));
      if (isOp(',')) next();
      else break;
    }
    expectOp(')');
    if (args.length !== SUPPORTED_FUNCS[name]) {
      throw syntax(`expected ${SUPPORTED_FUNCS[name]} argument(s) in call to ${JSON.stringify(name)}, got ${args.length}`, at);
    }
    const what = `call to function ${JSON.stringify(name)}`;
    if (name === 'histogram_quantile') {
      expectType(args[0], 'scalar', what, args[0].at ?? at);
      expectType(args[1], 'vector', what, args[1].at ?? at);
    } else expectType(args[0], 'matrix', what, args[0].at ?? at);
    return { type: 'call', fn: name, args, vt: 'vector' };
  }

  function aggregate(op, at) {
    let grouping = null;
    const clause = () => {
      const kind = next().v;
      if (grouping) throw syntax('aggregation can have only one grouping clause', toks[p - 1].at);
      grouping = { kind, labels: labelList() };
    };
    if (isId('by') || isId('without')) clause();
    expectOp('(');
    const arg = binary(0);
    expectOp(')');
    if (isId('by') || isId('without')) clause();
    expectType(arg, 'vector', `aggregation ${op}`, arg.at ?? at);
    return { type: 'agg', op, arg, vt: 'vector', ...(grouping ? { [grouping.kind]: grouping.labels } : {}) };
  }

  function primary() {
    const t = peek();
    if (t.t === 'num') { next(); return { type: 'num', value: t.v, vt: 'scalar', at: t.at }; }
    if (t.t === 'str') throw unsupported('string literal');
    if (isOp('(')) {
      next();
      const arg = binary(0);
      expectOp(')');
      return { type: 'paren', arg, vt: arg.vt, at: t.at };
    }
    if (isOp('{')) return selector(null, t.at);
    if (t.t === 'id') {
      const lower = t.v.toLowerCase();
      if ((lower === 'inf' || lower === 'nan') && !isOp('(', 1) && !isOp('{', 1)) {
        next();
        return { type: 'num', value: lower === 'inf' ? Infinity : NaN, vt: 'scalar', at: t.at };
      }
      const callish = isOp('(', 1);
      const grouped = isId('by', 1) || isId('without', 1);
      if (AGGS_UNSUPPORTED.has(t.v) && (callish || grouped)) throw unsupported(`aggregation ${t.v}`);
      next();
      if (AGGS.has(t.v) && (callish || grouped)) return aggregate(t.v, t.at);
      if (callish) return call(t.v, t.at);
      return selector(t.v, t.at);
    }
    throw syntax(`unexpected ${describe(t)}`, t.at);
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const t = next();
      const arg = unary();
      if (arg.vt === 'matrix') throw syntax('unary expression only allowed on expressions of type scalar or instant vector', t.at);
      if (t.v === '+') return arg;
      return arg.type === 'num' ? { ...arg, value: -arg.value } : { type: 'neg', arg, vt: arg.vt, at: t.at };
    }
    return postfix(primary());
  }

  function binary(minPrec) {
    let lhs = unary();
    for (;;) {
      const t = peek();
      if ((t.t === 'op' && (t.v === '%' || t.v === '^')) || (t.t === 'id' && SET_OPS.has(t.v))) throw unsupported(`operator ${t.v}`);
      const prec = t.t === 'op' ? PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return lhs;
      next();
      let matching = null;
      if (isId('bool')) throw unsupported('bool modifier');
      if (isId('on') || isId('ignoring')) {
        const kind = next().v;
        matching = { kind, labels: labelList() };
        if (isId('group_left') || isId('group_right')) throw unsupported(`${peek().v} (many-to-one matching)`);
      }
      const rhs = binary(prec + 1);
      if (lhs.vt === 'matrix' || rhs.vt === 'matrix') throw syntax('binary expression must contain only scalar and instant vector types', t.at);
      if (matching && (lhs.vt !== 'vector' || rhs.vt !== 'vector')) throw syntax('vector matching only allowed between instant vectors', t.at);
      if (lhs.vt === 'scalar' && rhs.vt === 'scalar' && prec === 1) throw syntax('comparisons between scalars must use BOOL modifier', t.at);
      lhs = { type: 'bin', op: t.v, lhs, rhs, matching, vt: lhs.vt === 'scalar' && rhs.vt === 'scalar' ? 'scalar' : 'vector', at: lhs.at };
    }
  }

  const ast = binary(0);
  if (peek().t !== 'eof') throw syntax(`unexpected ${describe(peek())}`, peek().at);
  return ast;
}
