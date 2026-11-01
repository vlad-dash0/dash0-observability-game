// PromQL subset lexer plus the failure results shared by the parser and the evaluator
// (docs/M1-DESIGN.md §4.6). Failures are thrown internally as `QueryFail` and always turned
// into result objects at the public entry points; callers never see an exception for bad input.
// Spec: https://prometheus.io/docs/prometheus/latest/querying/basics/

/** Carries a result object: {kind:'syntax',message,at} | {kind:'unsupported',what} | {kind:'error',message}. */
export class QueryFail extends Error {
  constructor(result) {
    super(result.kind);
    this.result = result;
  }
}
export const syntax = (message, at) => new QueryFail({ kind: 'syntax', message, at });
export const unsupported = (what) => new QueryFail({ kind: 'unsupported', what });
export const failed = (message) => new QueryFail({ kind: 'error', message });

const UNITS = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };
const PUNCT = ['==', '=~', '!=', '!~', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '%', '^', '(', ')', '{', '}', '[', ']', ',', ':', '@'];
const DURATION = /^(?:\d+(?:ms|s|m|h|d|w|y))+(?![A-Za-z0-9_.])/;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_:][A-Za-z0-9_:]*/;

/** Tokens `{t: 'num'|'dur'|'id'|'str'|'op'|'eof', v, at, end}`; a duration's `v` is in seconds. */
export function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    const rest = src.slice(i);
    let m;
    const push = (t, v, len) => { toks.push({ t, v, at: i, end: i + len }); i += len; };
    if ((m = DURATION.exec(rest))) {
      const secs = [...m[0].matchAll(/(\d+)(ms|s|m|h|d|w|y)/g)].reduce((a, [, n, u]) => a + Number(n) * UNITS[u], 0);
      push('dur', secs, m[0].length);
    } else if ((m = NUMBER.exec(rest))) push('num', Number(m[0]), m[0].length);
    else if ((m = IDENT.exec(rest))) push('id', m[0], m[0].length);
    else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let v = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && c !== '`') {
          const e = src[++j];
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else v += src[j];
        j++;
      }
      if (j >= src.length) throw syntax('unterminated string', i);
      push('str', v, j + 1 - i);
    } else {
      const p = PUNCT.find((q) => rest.startsWith(q));
      if (!p) throw syntax(`unexpected character ${JSON.stringify(c)}`, i);
      push('op', p, p.length);
    }
  }
  toks.push({ t: 'eof', v: null, at: src.length, end: src.length });
  return toks;
}
