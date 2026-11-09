// Ask the guide, the browser side (#17 P4): whether the guide is on (GET /api/guide, once per page,
// cached) and one question (POST /api/guide) turned into a typed outcome the panel renders. The
// contract is docs/FOUNDATION.md §2.8. `fetch` is injected; nothing here touches window, so it
// imports cleanly under node --test. Unknown or failed means off: the panel stays hidden.

/** The longest question the server takes (MAX_QUESTION in api/guide.mjs; test/guide-panel.test.mjs checks they agree). */
export const MAX_QUESTION = 300;
export const GUIDE_URL = '/api/guide';

/**
 * Outcome kinds `ask` resolves to, each `{kind, ...}`: `ok` (hint), `withheld`, `rate-limited` (retryAfterS),
 * `unavailable` (no such help here, or no key), `upstream` (the model side failed), `rejected` (the server
 * refused the question itself), `failed` (no usable answer: network, odd body, an unexpected status),
 * `aborted` (the signal fired). Never throws.
 */
export function createGuideClient({ fetch, url = GUIDE_URL }) {
  let status = null; // the one status request of this page
  let configured = false;
  const load = () => {
    status ??= (async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        const body = res.ok ? await res.json() : null;
        configured = body?.v === 1 && body.configured === true;
      } catch {
        configured = false;
      }
      return configured;
    })();
    return status;
  };

  async function ask(levelId, stepId, question, signal) {
    if (signal?.aborted) return { kind: 'aborted' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, levelId, stepId, question }),
        signal,
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (signal?.aborted) return { kind: 'aborted' };
      return outcomeOf(res.status, body);
    } catch {
      return signal?.aborted ? { kind: 'aborted' } : { kind: 'failed' };
    }
  }

  return {
    /** Resolves true when the server has a key; false for anything else. Fetched once. */
    status: load,
    /** The cached answer: false until `status()` has resolved. */
    get configured() {
      return configured;
    },
    ask,
  };
}

/** The outcome for an HTTP status and parsed body (null when it was not JSON). Pure. */
export function outcomeOf(status, body) {
  const b = body !== null && typeof body === 'object' ? body : {};
  if (status === 200) {
    if (b.ok === true && typeof b.hint === 'string' && b.hint.trim() !== '') return { kind: 'ok', hint: b.hint };
    if (b.ok === false && b.error === 'withheld') return { kind: 'withheld' };
    return { kind: 'failed' };
  }
  if (status === 429) {
    const s = Number(b.retryAfterS);
    return { kind: 'rate-limited', retryAfterS: Number.isFinite(s) && s > 0 ? s : 60 };
  }
  if (status === 404 || status === 503) return { kind: 'unavailable' };
  if (status === 502) return { kind: 'upstream' };
  if (status === 400 || status === 413) return { kind: 'rejected' };
  return { kind: 'failed' };
}
