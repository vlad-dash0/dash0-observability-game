// Zero-dependency dev server that behaves like the Vercel deployment: it sends the
// headers vercel.json declares (so the CSP bites locally) and refuses whatever
// .vercelignore keeps out of the deployment (node_modules/ included), plus dotfiles.
// It also runs `api/<name>.mjs` at `/api/<name>` (GET and POST) through a Node-to-Web Request adapter, as
// Vercel does (every Set-Cookie and any 3xx with its Location pass through unchanged); `GUIDE_STUB=1` swaps the guide's model call for a canned reply (local dev only, no key needed); `AUTH_STUB=1` gives the sign-in and account functions a stub Google user (dev@dash0.com) and an in-memory Redis (tools/fake-redis.mjs), data gone on restart; `TELEMETRY_STUB=1` prints one `span ...` line per span instead of sending traces (no network, no token; docs/FOUNDATION.md §2.10).
// Usage: npm run dev   (PORT=8080 npm run dev to change the port)
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRedis } from '../lib/account/redis.mjs';
import { consoleExporter, createServerTelemetry } from '../lib/otel/server.mjs';
import { createFakeRedis } from './fake-redis.mjs';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const API_NAME = /^\/api\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const API_METHODS = ['GET', 'POST'];
/** The adapter refuses a request body over this; the function enforces its own, smaller limit. */
const API_MAX_BODY = 16 * 1024;
/** What the stubbed model says: neutral, so it passes the answer filter. */
export const STUB_REPLY = 'Re-read what the question asks, then look at what each option says about it.';

/** The functions that take an auth-stub env and a Redis client, by file name: the factory each module exports. */
const AUTH_FACTORIES = { 'auth-start': 'createAuthStart', 'auth-callback': 'createAuthCallback', account: 'createAccount', progress: 'createProgress', leaderboard: 'createLeaderboard' };

/** What a TELEMETRY_STUB server tells the telemetry config: valid and never contacted, since the exporter is the console. */
const STUB_TELEMETRY_ENV = Object.freeze({ DASH0_OTLP_ENDPOINT: 'http://localhost:4318', DASH0_AUTH_TOKEN: 'auth_stub' });
/** The functions that make an outbound call to trace: their factory takes the traced `fetch`. */
const tracedFetch = (name, t) => (name === 'auth-callback' || name === 'guide' ? { fetch: t.trace(globalThis.fetch) } : {});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// vercel.json `source` uses path-to-regexp. We support literal paths plus `(...)` regex
// groups (`/(.*)`, `/vendor/(.*)`); params and modifiers are refused, not guessed at.
function sourceRegExp(source) {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '(') {
      const end = source.indexOf(')', i);
      if (end < 0) throw new Error(`tools/serve.mjs: unclosed group in source "${source}"`);
      out += source.slice(i, end + 1);
      i = end;
    } else if (/[:*+?{}]/.test(c)) {
      throw new Error(`tools/serve.mjs: unsupported vercel.json source "${source}"`);
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(`^${out}$`);
}

/** Headers vercel.json applies to `pathname`: every matching rule, later keys win. */
export function headersFor(config, pathname) {
  const out = {};
  for (const rule of config.headers ?? []) {
    if (!sourceRegExp(rule.source).test(pathname)) continue;
    for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

/**
 * Predicate over repo-relative paths for the .vercelignore forms we use: `dir/`,
 * `name` and `*.ext` match at any depth; a leading `/` or an inner `/` (`/dir/`,
 * `a/b`) anchors the line to the root. `*` stays within one segment. Negation, `**`, `?` and `[...]` throw rather than being misread.
 */
export function ignoreMatcher(text) {
  const rules = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    if (/^!|\*\*|[?[\]]/.test(line)) throw new Error(`tools/serve.mjs: unsupported .vercelignore line "${line}"`);
    const pat = line.replace(/^\/+|\/+$/g, '');
    return {
      re: new RegExp(`^${pat.split('*').map(escapeRe).join('[^/]*')}$`),
      dirOnly: line.endsWith('/'),
      anchored: line.startsWith('/') || pat.includes('/'),
      depth: pat.split('/').length,
    };
  });
  return (relPath) => {
    const parts = relPath.split('/');
    return rules.some(({ re, dirOnly, anchored, depth }) => {
      const starts = anchored ? [0] : parts.map((_, i) => i);
      return starts.some((i) => {
        const end = i + depth;
        // A dir-only rule needs at least one segment (the file) after the match.
        if (end > parts.length || (dirOnly && end === parts.length)) return false;
        return re.test(parts.slice(i, end).join('/'));
      });
    });
  };
}

/** A `fetch` that answers every Messages call with `STUB_REPLY`, for `GUIDE_STUB=1`. */
const stubFetch = async () => Response.json({ content: [{ type: 'text', text: STUB_REPLY }] });

/** The request body, or null when it is over `API_MAX_BODY`. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > API_MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** `req` as a Web Request, the shape a Vercel function gets. */
function toWebRequest(req, body) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  const host = req.headers.host ?? 'localhost';
  return new Request(`http://${host}${req.url}`, { method: req.method, headers, body: req.method === 'POST' ? body : undefined });
}

const inside = (root, p) => p === root || p.startsWith(root + sep);

// The real path of the file to serve for the decoded request path, or null (404).
async function resolveFile(root, ignored, decoded) {
  let file = resolve(root, `.${decoded}`);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    else if (decoded.endsWith('/')) return null; // `/index.html/`: a file is not a directory
    file = await realpath(file); // follow symlinks so the checks below see the target
    if (!(await stat(file)).isFile()) return null;
  } catch {
    return null;
  }
  if (!inside(root, file)) return null; // `..` or a symlink out of the root
  const rel = relative(root, file).split(sep).join('/');
  // Dotfiles (.git, .env); `..` means outside the root, which the guard above owns.
  if (rel.split('/').some((part) => part.startsWith('.') && part !== '..')) return null;
  if (ignored(rel)) return null; // not deployed, so not served
  if (rel.startsWith('api/')) return null; // function source runs, it is never read as a file
  return file;
}

export function startServer({ root = REPO, port = 3000, host = '127.0.0.1', log = console.log, stub = process.env.GUIDE_STUB === '1', authStub = process.env.AUTH_STUB === '1', telemetryStub = process.env.TELEMETRY_STUB === '1', env = null } = {}) {
  const realRoot = realpathSync(root);
  const config = JSON.parse(readFileSync(join(realRoot, 'vercel.json'), 'utf8'));
  config.headers?.forEach((rule) => sourceRegExp(rule.source)); // fail at startup
  let ignoreText;
  try {
    ignoreText = readFileSync(join(realRoot, '.vercelignore'), 'utf8');
  } catch (err) {
    throw new Error(`tools/serve.mjs: cannot read ${join(realRoot, '.vercelignore')}: ${err.code}`);
  }
  const ignored = ignoreMatcher(ignoreText);

  if (stub) log('GUIDE_STUB=1: /api/guide answers with a canned reply, no model is called');
  if (authStub) log('AUTH_STUB=1: sign-in is a stub (dev@dash0.com) over an in-memory Redis; use http://localhost, not 127.0.0.1');
  if (telemetryStub) log('TELEMETRY_STUB=1: every api request prints one span line, no trace is sent');
  const modules = new Map();
  let authEnv = null; // built on first use: the port is known once listening
  let fakeRedis = null;
  // A rebuilt handler set, wrapped as the module wraps its own. Under TELEMETRY_STUB the spans go to `log`
  // through a fake config; otherwise the real env decides, so a configured dev server sends traces.
  const instrumented = (name, build) => {
    const telemetry = telemetryStub
      ? createServerTelemetry({ name, env: STUB_TELEMETRY_ENV, log: (line) => log(typeof line === 'string' ? line : JSON.stringify(line)), exporter: consoleExporter(log) })
      : createServerTelemetry({ name, env: process.env });
    return telemetry.instrument(build(telemetry));
  };
  // `api/<name>.mjs` loaded once. The guide under the stub is built here with a fake key and the canned fetch.
  const handlersFor = async (name) => {
    if (!modules.has(name)) {
      modules.set(name, (async () => {
        const file = join(realRoot, 'api', `${name}.mjs`);
        const mod = await import(pathToFileURL(file).href);
        if (stub && name === 'guide') {
          return instrumented(name, (t) => mod.createGuide({ env: { ANTHROPIC_API_KEY: 'stub' }, fetch: t.trace(stubFetch), log: t.log }));
        }
        if (authStub && Object.hasOwn(AUTH_FACTORIES, name)) {
          // One fake store and one secret for every auth function; AUTH_ORIGIN is http://localhost, the only origin the stub accepts.
          fakeRedis ??= createFakeRedis();
          authEnv ??= { AUTH_STUB: '1', AUTH_ORIGIN: `http://localhost:${server.address().port}`, SESSION_SECRET: randomBytes(32).toString('hex') };
          const redis = createRedis({ url: fakeRedis.url, token: fakeRedis.token, fetch: fakeRedis.fetch });
          return instrumented(name, (t) => mod[AUTH_FACTORIES[name]]({ env: authEnv, redis, log: t.log, ...tracedFetch(name, t) }));
        }
        // A test passes `env` to run the real auth functions over a chosen environment instead of process.env.
        if (env !== null && Object.hasOwn(AUTH_FACTORIES, name)) {
          return instrumented(name, (t) => mod[AUTH_FACTORIES[name]]({ env, log: t.log, ...tracedFetch(name, t) }));
        }
        // The play events go to the console under TELEMETRY_STUB: the fake env turns them on, `send` replaces the network.
        if (telemetryStub && name === 'events') {
          return instrumented(name, (t) => mod.createEvents({ env: STUB_TELEMETRY_ENV, send: consoleExporter(log), log: t.log }));
        }
        // Under TELEMETRY_STUB the module's own wiring (real env, real exporter) is replaced by a console one.
        if (telemetryStub && (name === 'guide' || Object.hasOwn(AUTH_FACTORIES, name))) {
          const factory = name === 'guide' ? 'createGuide' : AUTH_FACTORIES[name];
          return instrumented(name, (t) => mod[factory]({ log: t.log, ...tracedFetch(name, t) }));
        }
        return mod;
      })());
    }
    return modules.get(name);
  };

  const server = createServer(async (req, res) => {
    const send = (status, body, headers, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    let pathname = req.url;
    let decoded;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
      decoded = decodeURIComponent(pathname);
    } catch {
      return send(400, 'Bad Request\n', headersFor(config, pathname));
    }
    const headers = headersFor(config, decoded);
    const api = API_NAME.exec(decoded);
    if (api) {
      if (!API_METHODS.includes(req.method)) return send(405, 'Method Not Allowed\n', { ...headers, Allow: API_METHODS.join(', ') });
      if (ignored(`api/${api[1]}.mjs`) || !(await stat(join(realRoot, 'api', `${api[1]}.mjs`)).then((st) => st.isFile(), () => false))) {
        return send(404, 'Not Found\n', headers);
      }
      try {
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        if (body === null) return send(413, 'Payload Too Large\n', headers);
        const handler = (await handlersFor(api[1]))[req.method];
        if (typeof handler !== 'function') return send(404, 'Not Found\n', headers);
        const out = await handler(toWebRequest(req, body));
        // Object.fromEntries would keep only the last Set-Cookie; Node takes an array for repeated headers.
        const outHeaders = { ...headers, ...Object.fromEntries(out.headers) };
        const cookies = out.headers.getSetCookie();
        if (cookies.length) outHeaders['set-cookie'] = cookies;
        res.writeHead(out.status, outHeaders);
        return res.end(Buffer.from(await out.arrayBuffer()));
      } catch (err) {
        log(`tools/serve.mjs: ${decoded}: ${err.code ?? err.message}`);
        return send(500, 'Internal Server Error\n', headers);
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed\n', headers);
    const file = await resolveFile(realRoot, ignored, decoded);
    if (!file) return send(404, 'Not Found\n', headers);
    let body;
    try {
      body = await readFile(file);
    } catch (err) {
      if (err.code === 'ENOENT') return send(404, 'Not Found\n', headers);
      log(`tools/serve.mjs: ${decoded}: ${err.code ?? err.message}`);
      return send(500, 'Internal Server Error\n', headers);
    }
    send(200, body, headers, TYPES[extname(file)] ?? 'application/octet-stream');
  });
  server.listen(port, host, () => log(`serving ${realRoot} at http://localhost:${server.address().port}/`));
  return server;
}

function portFromEnv(raw) {
  if (raw === undefined) return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`tools/serve.mjs: PORT must be an integer 1-65535, got "${raw}"`);
  }
  return port;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({ port: portFromEnv(process.env.PORT) });
}
