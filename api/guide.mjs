// Ask the guide (#17 P2): a Vercel Node function (Web Request in, Response out, one named export per
// HTTP method; docs/FOUNDATION.md §2.8). GET says whether a key is set; POST answers one player question
// about one step through the Anthropic Messages API. The model is told only what the player can see
// (lib/guide/context.mjs) and its reply is withheld if it states the answer. Nothing secret or personal
// leaves this file: no key, question, reply or address in a response or a log line.
import { liveRegistry } from '../app.mjs';
import { answerTokens, findStep, guideAllowed, stepContext, withholds } from '../lib/guide/context.mjs';
import { createLimiter } from '../lib/guide/limit.mjs';
import { systemPrompt, userMessage } from '../lib/guide/prompt.mjs';
import { isId } from '../lib/registry.mjs';

const MODEL = 'claude-haiku-5-5';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_BODY_BYTES = 2048;
const MAX_QUESTION = 300;
const MAX_REPLY = 600;
const MAX_TOKENS = 300;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_STEP_ID = 100;
const BODY_KEYS = ['v', 'levelId', 'stepId', 'question'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/**
 * The handlers over injected `env`, `fetch`, `now`, `log` and `limiter` (and a built `registry`), so a test
 * drives them with fakes. Defaults are the real ones; the registry is built on first use.
 */
export function createGuide({
  env = process.env,
  fetch = globalThis.fetch,
  now = Date.now,
  log = (line) => console.log(JSON.stringify(line)),
  limiter = createLimiter({ now }),
  registry = null,
} = {}) {
  let built = registry;
  const configured = () => typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY !== '';

  async function GET(request) {
    if (request.method !== 'GET') return reply(405, { error: 'method-not-allowed' }, { allow: 'GET' });
    return reply(200, { v: 1, configured: configured() });
  }

  async function POST(request) {
    const started = now();
    let levelId = null;
    let stepId = null;
    const done = (status, body, outcome, headers) => {
      log({ msg: 'guide', levelId, stepId, outcome, status, ms: now() - started });
      return reply(status, body, headers);
    };
    try {
      if (request.method !== 'POST') return done(405, { error: 'method-not-allowed' }, 'method', { allow: 'POST' });
      if (!sameOrigin(request)) return done(403, { error: 'forbidden' }, 'forbidden');
      if (!configured()) return done(503, { error: 'not-configured' }, 'not-configured');
      if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) {
        return done(415, { error: 'unsupported-media-type' }, 'media-type');
      }
      const declared = Number(request.headers.get('content-length'));
      if (declared > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return done(413, { error: 'too-large' }, 'too-large');

      const parsed = parseBody(text);
      if (parsed.field) return done(400, { ok: false, error: 'bad-request', field: parsed.field }, 'bad-request');
      const { question } = parsed;

      built ??= liveRegistry();
      const level = built.levels[parsed.levelId];
      const found = findStep(level, parsed.stepId);
      if (found === null) return done(404, { error: 'unknown-step' }, 'unknown-step');
      levelId = parsed.levelId;
      stepId = parsed.stepId;
      const { type, spec, step } = found;
      const tokens = guideAllowed(type, spec) ? answerTokens(type, spec, step) : null;
      if (tokens === null) return done(404, { error: 'unavailable' }, 'unavailable');

      const taken = limiter.take(clientKey(request));
      if (!taken.ok) {
        return done(429, { error: 'rate-limited', retryAfterS: taken.retryAfterS }, 'rate-limited', { 'retry-after': String(taken.retryAfterS) });
      }

      const answer = await askModel(systemPrompt(stepContext(level, found)), userMessage(question));
      if (answer === null) return done(502, { error: 'upstream' }, 'upstream');
      const sent = answer.slice(0, MAX_REPLY); // cut first: the filter must see exactly what goes out, a cut can end on an answer's digits
      if (withholds(sent, tokens)) return done(200, { ok: false, error: 'withheld' }, 'withheld');
      return done(200, { ok: true, hint: sent }, 'answered');
    } catch {
      return done(500, { error: 'internal' }, 'error'); // never the error: it could carry the key or the text
    }
  }

  /** The model's plain-text reply, or null for any failure (status, timeout, shape, empty). Upstream bodies go nowhere. */
  async function askModel(system, content) {
    try {
      const res = await fetch(MESSAGES_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content }] }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data?.content)) return null;
      const out = data.content.map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('').trim();
      return out === '' ? null : out;
    } catch {
      return null;
    }
  }

  return { GET, POST };
}

function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** An `Origin` header, when sent, must name the host the request came to; a request without one (curl) passes. */
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    const host = request.headers.get('host') ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const clientKey = (request) => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

/** `{levelId, stepId, question}` from the request text, or `{field}` naming what is wrong. Fields are listed, never bound blindly. */
function parseBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { field: 'body' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { field: 'body' };
  if (Object.keys(body).some((k) => !BODY_KEYS.includes(k))) return { field: 'body' }; // a `pick` would make the guide a yes/no oracle
  if (body.v !== 1) return { field: 'v' };
  if (!isId(body.levelId)) return { field: 'levelId' };
  if (typeof body.stepId !== 'string' || body.stepId === '' || body.stepId.length > MAX_STEP_ID) return { field: 'stepId' };
  if (typeof body.question !== 'string') return { field: 'question' };
  const question = body.question.trim();
  if (question === '' || question.length > MAX_QUESTION || CONTROL.test(question)) return { field: 'question' };
  return { levelId: body.levelId, stepId: body.stepId, question };
}

const guide = createGuide();
export const GET = guide.GET;
export const POST = guide.POST;
