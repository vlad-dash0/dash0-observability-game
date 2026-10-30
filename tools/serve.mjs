// Zero-dependency dev server: serves the repo root as static files and sends the
// same headers vercel.json declares, so the CSP bites locally as it does in production.
// Usage: npm run dev   (PORT=8080 npm run dev to change the port)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

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

// vercel.json `source` uses path-to-regexp; we support only the regex-group form
// (`/(.*)`, `/vendor/(.*)`). Anything else is refused rather than silently unmatched.
function sourceRegExp(source) {
  if (/:[A-Za-z_]/.test(source)) {
    throw new Error(`tools/serve.mjs: unsupported vercel.json source "${source}"`);
  }
  return new RegExp(`^${source}$`);
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

async function resolveFile(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  if (rel.split(/[/\\]/).some((part) => part.startsWith('.'))) return null; // .env, .git
  let file = join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return null;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

export function startServer({ port = 3000, host = '127.0.0.1' } = {}) {
  const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  config.headers?.forEach((rule) => sourceRegExp(rule.source)); // fail at startup
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const headers = headersFor(config, pathname);
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed\n');
    let file;
    try {
      file = await resolveFile(pathname);
    } catch {
      return send(400, 'Bad Request\n');
    }
    if (!file) return send(404, 'Not Found\n');
    const body = await readFile(file);
    send(200, body, TYPES[extname(file)] ?? 'application/octet-stream');
  });
  server.listen(port, host, () => console.log(`serving ${ROOT} at http://localhost:${port}/`));
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
