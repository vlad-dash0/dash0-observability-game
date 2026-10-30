// Zero-dependency dev server that behaves like the Vercel deployment: it sends the
// headers vercel.json declares (so the CSP bites locally) and refuses whatever
// .vercelignore keeps out of the deployment (node_modules/ included), plus dotfiles.
// Usage: npm run dev   (PORT=8080 npm run dev to change the port)
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * `name` and `*.ext` (any depth when there is no inner `/`), `a/b` (anchored). `*`
 * stays within one segment. Negation, `**`, `?` and `[...]` throw rather than being misread.
 */
export function ignoreMatcher(text) {
  const rules = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    if (/^!|\*\*|[?[\]]/.test(line)) throw new Error(`tools/serve.mjs: unsupported .vercelignore line "${line}"`);
    const pat = line.replace(/^\/+|\/+$/g, '');
    return {
      re: new RegExp(`^${pat.split('*').map(escapeRe).join('[^/]*')}$`),
      dirOnly: line.endsWith('/'),
      anchored: pat.includes('/'),
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

const inside = (root, p) => p === root || p.startsWith(root + sep);

// The real path of the file to serve for the decoded request path, or null (404).
async function resolveFile(root, ignored, decoded) {
  let file = resolve(root, `.${decoded}`);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
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
  return file;
}

export function startServer({ root = REPO, port = 3000, host = '127.0.0.1', log = console.log } = {}) {
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

  const server = createServer(async (req, res) => {
    const send = (status, body, headers, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    let decoded;
    try {
      decoded = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(400, 'Bad Request\n', {});
    }
    const headers = headersFor(config, decoded);
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
