// Fixtures for the server telemetry tests (lib/otel/): a recording fake ingress, fake timers, a
// sequential clock, pinned random bytes and a handler that logs like an api/ function.
import { reply } from '../../lib/http.mjs';

export const ENV_ON = Object.freeze({
  DASH0_OTLP_ENDPOINT: 'https://ingress.eu-west-1.aws.dash0.com',
  DASH0_AUTH_TOKEN: 'auth_TOKENCANARY123456',
  DASH0_DATASET: 'oncall-api',
});

// A fake fetch that records {url, init, body}. mode 'stall' never settles and ignores the signal,
// 'abort' never settles but rejects when the signal aborts, 'throw' rejects with a TypeError.
export function ingress({ status = 200, text = '{}', mode } = {}) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, init, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    if (mode === 'stall') return new Promise(() => {});
    if (mode === 'abort') {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (mode === 'throw') return Promise.reject(new TypeError('fetch failed: auth_TOKENCANARY123456'));
    return Promise.resolve(new Response(text, { status }));
  };
  return { fetch, calls };
}

// Fake setTimeout/clearTimeout. pending() lists what is armed, fire(ms) runs the oldest timer armed with that delay.
export function timers() {
  let seq = 0;
  const armed = new Map();
  return {
    setTimeout(fn, ms) {
      seq += 1;
      armed.set(seq, { fn, ms });
      return seq;
    },
    clearTimeout(id) {
      armed.delete(id);
    },
    pending: () => [...armed.values()].map(({ ms }) => ({ ms })),
    active: () => armed.size,
    fire(ms) {
      for (const [id, t] of armed) {
        if (t.ms === ms) {
          armed.delete(id);
          t.fn();
          return true;
        }
      }
      throw new Error(`no timer armed for ${ms}`);
    },
  };
}

// Sequential now(): the listed values, then the last one plus 1 per further call. calls counts.
export function clock(values) {
  let i = 0;
  const now = () => {
    now.calls = i + 1;
    const v = i < values.length ? values[i] : values[values.length - 1] + (i - values.length + 1);
    i += 1;
    return v;
  };
  now.calls = 0;
  return now;
}

// Pinned random(n): call i returns n bytes of fills[i] (the last fill repeats); a fill may be a number or an array of bytes.
export function bytes(...fills) {
  let i = 0;
  const random = (n) => {
    const fill = fills[Math.min(i, fills.length - 1)];
    i += 1;
    random.calls = i;
    const out = new Uint8Array(n);
    if (Array.isArray(fill)) fill.forEach((b, k) => { out[k % n] = b; });
    else out.fill(fill);
    return out;
  };
  random.calls = 0;
  return random;
}

// A handler that logs one line through t.log and answers `status`.
export const h = (t, status, outcome) => async () => {
  t.log({ msg: 'x', outcome, status, ms: 1 });
  return reply(status, {});
};

// An OTLP request body -> [{name, kind, ..., attrs: {key: value}}]
export function spansOf(body) {
  return body.resourceSpans[0].scopeSpans[0].spans.map((s) => ({
    ...s,
    attrs: attrsOf(s.attributes),
  }));
}
export function attrsOf(list) {
  return Object.fromEntries(
    list.map(({ key, value }) => [key, value.stringValue ?? (value.intValue !== undefined ? Number(value.intValue) : value.boolValue ?? value.doubleValue)]),
  );
}
export const resourceOf = (body) => attrsOf(body.resourceSpans[0].resource.attributes);
