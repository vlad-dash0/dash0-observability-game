// The dev server (tools/serve.mjs) behaves like the Vercel deployment: same headers,
// same files refused, and no way out of its root. Spec: docs/FOUNDATION.md §5 F1, §7.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { chmodSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, ignoreMatcher, startServer, STUB_REPLY } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const rule = (source) => vercel.headers.find((h) => h.source === source).headers;
const quiet = () => {};

// Raw request: the path goes on the wire exactly as written (fetch would normalise it).
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    // A handler that throws never answers; fail fast instead of hanging the suite.
    req.setTimeout(2000, () => req.destroy(new Error(`no response for ${path}`)));
    req.end();
  });
}

async function listen(opts) {
  const server = startServer({ port: 0, log: quiet, ...opts });
  await once(server, 'listening');
  return { server, port: server.address().port };
}

function assertHeaders(res, expected) {
  for (const { key, value } of expected) {
    assert.equal(res.headers[key.toLowerCase()], value, `${key} on the response`);
  }
}

// ---- against the real repo ------------------------------------------------------
let repo;
before(async () => { repo = await listen({}); });
after(() => repo?.server.close());

test('the running server sends the vercel.json headers', async () => {
  const page = await get(repo.port, '/');
  assert.equal(page.status, 200);
  assertHeaders(page, rule('/(.*)'));
  assert.equal(page.headers['cache-control'], undefined);
  const vendored = await get(repo.port, '/vendor/alpine-3.14.1.min.js');
  assert.equal(vendored.status, 200);
  assertHeaders(vendored, [...rule('/(.*)'), ...rule('/vendor/(.*)')]);
  const font = await get(repo.port, '/fonts/MartianMono-1.1.0-Regular.woff2');
  assert.equal(font.status, 200);
  assertHeaders(font, [...rule('/(.*)'), ...rule('/fonts/(.*)')]);
});

test('headers are matched on the decoded path', async () => {
  const res = await get(repo.port, '/vendor%2Falpine-3.14.1.min.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('dotfiles, traversal and .vercelignore entries are 404', async () => {
  for (const path of [
    '/.env', '/.gitignore', '/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd',
    '/tools/serve.mjs', '/package.json', '/node_modules/linkedom/package.json',
    '/node_modules/linkedom/esm/index.js', // not caught by the package.json line
    '/docs/FOUNDATION.md', '/test/static.test.mjs', '/vendor/SHA256SUMS',
  ]) {
    assert.equal((await get(repo.port, path)).status, 404, path);
  }
  assert.equal((await get(repo.port, '/vercel.json')).status, 200, 'vercel.json stays served, as on Vercel');
});

// ---- against a throwaway root: escapes that need files to exist ---------------------
let tmp;
let site;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'serve-test-'));
  writeFileSync(join(tmp, 'secret.txt'), 'outside');
  const root = join(tmp, 'site');
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'config'), 'dotfile');
  writeFileSync(join(root, 'index.html'), '<!doctype html>');
  writeFileSync(join(root, 'locked.txt'), 'no read');
  chmodSync(join(root, 'locked.txt'), 0o000);
  writeFileSync(join(root, 'vercel.json'), JSON.stringify({ headers: [] }));
  writeFileSync(join(root, '.vercelignore'), '# none\n');
  symlinkSync(join(tmp, 'secret.txt'), join(root, 'link.txt'));
  mkdirSync(join(root, 'api'));
  writeFileSync(
    join(root, 'api', 'hello.mjs'),
    `export async function POST(req) {
       const got = await req.text();
       return new Response(JSON.stringify({ got, type: req.headers.get('content-type'), path: new URL(req.url).pathname }), { status: 201, headers: { 'x-hello': 'yes' } });
     }`,
  );
  writeFileSync(
    join(root, 'api', 'cookies.mjs'),
    `export async function GET() {
       const headers = new Headers();
       headers.append('Set-Cookie', 'a=1; Path=/; HttpOnly');
       headers.append('Set-Cookie', 'b=2; Path=/; Secure');
       return new Response('ok', { status: 200, headers });
     }`,
  );
  writeFileSync(
    join(root, 'api', 'bounce.mjs'),
    `export async function GET() {
       const headers = new Headers({ Location: '/api/cookies?from=bounce' });
       headers.append('Set-Cookie', 'state=xyz; Path=/');
       return new Response(null, { status: 302, headers });
     }`,
  );
  site = await listen({ root });
});
after(() => {
  site?.server.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('a path cannot climb out of the root', async () => {
  assert.equal((await get(site.port, '/index.html')).status, 200);
  for (const path of ['/..%2fsecret.txt', '/..%2F..%2Fsecret.txt', '/%2e%2e%2fsecret.txt']) {
    const res = await get(site.port, path);
    assert.equal(res.status, 404, path);
    assert.ok(!res.body.includes('outside'), path);
  }
});

test('a trailing slash on a file is 404', async () => {
  assert.equal((await get(site.port, '/index.html/')).status, 404);
});

test('a malformed path is a 400 that still carries the vercel.json headers', async () => {
  for (const path of ['/%zz', '/%E0%A4%A']) {
    const res = await get(repo.port, path);
    assert.equal(res.status, 400, path);
    assertHeaders(res, rule('/(.*)'));
  }
});

test('a symlink cannot point out of the root', async () => {
  const res = await get(site.port, '/link.txt');
  assert.equal(res.status, 404);
  assert.ok(!res.body.includes('outside'));
});

test('dot segments are refused even when not ignored', async () => {
  assert.equal((await get(site.port, '/.git/config')).status, 404);
});

const isRoot = process.getuid?.() === 0;
test('an unreadable file is a 500 and the server stays up', { skip: isRoot && 'root ignores file modes' }, async () => {
  assert.equal((await get(site.port, '/locked.txt')).status, 500);
  assert.equal((await get(site.port, '/index.html')).status, 200);
});

test('a missing .vercelignore refuses to start', () => {
  const bare = join(tmp, 'bare');
  mkdirSync(bare);
  writeFileSync(join(bare, 'vercel.json'), '{}');
  assert.throws(() => startServer({ root: bare, port: 0, log: quiet }), /\.vercelignore/);
});

// ---- pure helpers -----------------------------------------------------------------
test('ignoreMatcher follows the .vercelignore forms we use', () => {
  const ignored = ignoreMatcher('# c\n\ndocs/\nREADME.md\nvendor/SUMS\n*.log\n.env.*\n');
  for (const p of ['docs/a.md', 'docs/x/y.md', 'README.md', 'vendor/README.md', 'vendor/SUMS', 'x.log', 'a/b/x.log', '.env.local']) {
    assert.ok(ignored(p), p);
  }
  for (const p of ['docsx/a.md', 'a/docs', 'vendor/OTHER', 'x/vendor/SUMS', 'log', 'index.html']) {
    assert.ok(!ignored(p), p);
  }
  assert.throws(() => ignoreMatcher('!keep.md'), /unsupported/);
});

test('a leading / anchors an ignore line to the root', () => {
  const ignored = ignoreMatcher('/foo\n/bar/\n');
  assert.ok(ignored('foo'));
  assert.ok(!ignored('a/foo'), '/foo must not match a/foo');
  assert.ok(ignored('bar/x.js'));
  assert.ok(!ignored('a/bar/x.js'), '/bar/ must not match a/bar/');
});

test('the real .vercelignore excludes top-level tooling dirs only', () => {
  const ignored = ignoreMatcher(readFileSync(join(ROOT, '.vercelignore'), 'utf8'));
  for (const p of ['test/x.js', 'tools/serve.mjs', 'docs/a.md', '.github/workflows/ci.yml']) {
    assert.ok(ignored(p), p);
  }
  for (const p of ['lib/test/x.js', 'api/tools/x.js', 'lib/docs/x.js', 'index.html']) {
    assert.ok(!ignored(p), `${p} must still deploy`);
  }
});

test('header sources outside (...) groups are literal', () => {
  const config = { headers: [{ source: '/sw.js', headers: [{ key: 'X-T', value: '1' }] }] };
  assert.deepEqual(headersFor(config, '/sw.js'), { 'X-T': '1' });
  assert.deepEqual(headersFor(config, '/swXjs'), {});
});

// ---- api/<name>.mjs routes (the guide, #17 P2) ---------------------------------------

function send(port, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error(`no response for ${method} ${path}`)));
    req.end(body);
  });
}
const JSON_TYPE = { 'content-type': 'application/json' };
const question = (over = {}) => JSON.stringify({ v: 1, levelId: 'resources', stepId: 'res-pod', question: 'What does a resource describe?', ...over });

test('POST /api/<name> reaches api/<name>.mjs as a Web Request, and the vercel.json headers still apply', async () => {
  const res = await send(site.port, 'POST', '/api/hello', { body: 'ping', headers: { 'content-type': 'text/x' } });
  assert.equal(res.status, 201);
  assert.equal(res.headers['x-hello'], 'yes');
  assert.deepEqual(JSON.parse(res.body), { got: 'ping', type: 'text/x', path: '/api/hello' });
  const real = await send(repo.port, 'GET', '/api/guide');
  assertHeaders(real, rule('/(.*)'));
});

test('every Set-Cookie the function sets reaches the client, not just the last', async () => {
  const res = await send(site.port, 'GET', '/api/cookies');
  assert.deepEqual(res.headers['set-cookie'], ['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure']);
});

test('a 302 keeps its status, Location and cookie, and is not followed', async () => {
  const res = await send(site.port, 'GET', '/api/bounce');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/api/cookies?from=bounce');
  assert.deepEqual(res.headers['set-cookie'], ['state=xyz; Path=/']);
  assert.equal(res.body, '', 'the redirect body is not the target');
});

test('a method the function does not export, or a name with no function, is refused', async () => {
  assert.equal((await send(site.port, 'GET', '/api/hello')).status, 404, 'hello exports no GET');
  assert.equal((await send(site.port, 'PUT', '/api/hello', { body: 'x' })).status, 405);
  assert.equal((await send(site.port, 'DELETE', '/api/hello')).status, 405);
  assert.equal((await send(site.port, 'POST', '/api/nothing', { body: 'x' })).status, 404);
  assert.equal((await send(site.port, 'GET', '/api/hello/extra')).status, 404);
  assert.equal((await send(site.port, 'POST', '/api/hello', { body: 'x'.repeat(20000) })).status, 413);
});

test('function source is never served as a file', async () => {
  for (const path of ['/api/hello.mjs', '/api/guide.mjs', '/api/guide.mjs?x=1', '/api/%67uide.mjs']) {
    const target = path.includes('guide') ? repo : site;
    const res = await get(target.port, path);
    assert.equal(res.status, 404, path);
    assert.ok(!res.body.includes('createGuide') && !res.body.includes('export'), path);
  }
});

test('the real guide answers on /api/guide: status on GET, 503 on POST without a key', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const status = await send(repo.port, 'GET', '/api/guide');
    assert.equal(status.status, 200);
    assert.deepEqual(JSON.parse(status.body), { v: 1, configured: false });
    const ask = await send(repo.port, 'POST', '/api/guide', { body: question(), headers: JSON_TYPE });
    assert.equal(ask.status, 503);
    assert.deepEqual(JSON.parse(ask.body), { error: 'not-configured' });
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('GUIDE_STUB: the guide answers with a canned reply, no key and no network', async () => {
  const stub = await listen({ stub: true });
  try {
    assert.deepEqual(JSON.parse((await send(stub.port, 'GET', '/api/guide')).body), { v: 1, configured: true });
    const origin = `http://127.0.0.1:${stub.port}`;
    const ask = await send(stub.port, 'POST', '/api/guide', { body: question(), headers: { ...JSON_TYPE, origin } });
    assert.equal(ask.status, 200);
    assert.deepEqual(JSON.parse(ask.body), { ok: true, hint: STUB_REPLY });
    const cross = await send(stub.port, 'POST', '/api/guide', { body: question(), headers: { ...JSON_TYPE, origin: 'http://evil.test' } });
    assert.equal(cross.status, 403);
  } finally {
    stub.server.close();
  }
});

test('AUTH_STUB: the dev server answers /api/progress and /api/leaderboard (not 503)', async () => {
  const stub = await listen({ authStub: true });
  try {
    const board = await send(stub.port, 'GET', '/api/leaderboard');
    assert.equal(board.status, 200);
    assert.deepEqual(JSON.parse(board.body), { v: 1, ok: true, size: 0, top: [], me: null });
    const progress = await send(stub.port, 'GET', '/api/progress');
    assert.equal(progress.status, 401, 'configured, so it asks for a session instead of 503');
  } finally {
    stub.server.close();
  }
});

// A static import or re-export with a relative path, on one line or several (`import {\n a,\n b\n} from './x.mjs'`).
const IMPORT = /^\s*(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm;

test('the import walk reads multi-line imports', () => {
  const found = [...`import {\n  a,\n  b,\n} from './guide-api.test.mjs';\nimport './static.test.mjs';\nexport { c } from './game.test.mjs';`.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(found, ['./guide-api.test.mjs', './static.test.mjs', './game.test.mjs']);
});

test('the real .vercelignore keeps every api function and everything it imports in the deployment', () => {
  const ignored = ignoreMatcher(readFileSync(join(ROOT, '.vercelignore'), 'utf8'));
  const functions = readdirSync(join(ROOT, 'api')).filter((f) => f.endsWith('.mjs'));
  assert.ok(functions.length >= 6, 'the walk starts from every api/*.mjs, not only the guide');
  for (const file of functions) {
    assert.ok(!ignored(`api/${file}`), `api/${file} deploys`);
    // Walk the static imports from the function: each file must deploy, or the function fails on Vercel.
    const seen = new Set();
    const walk = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      assert.ok(!ignored(rel), `${rel} is imported by api/${file} but .vercelignore keeps it out`);
      const src = readFileSync(join(ROOT, rel), 'utf8');
      for (const [, a, b] of src.matchAll(IMPORT)) {
        walk(join(dirname(rel), a ?? b));
      }
    };
    walk(`api/${file}`);
    assert.ok(seen.has('lib/otel/server.mjs') && seen.has('lib/otlp/send.mjs'), `api/${file} reaches the telemetry modules`);
    if (file === 'guide.mjs') assert.ok(seen.has('lib/guide/context.mjs') && seen.has('levels/index.mjs'), 'the walk reached the core and the levels');
  }
});

test('TELEMETRY_STUB prints one line per span, with no network', async () => {
  const lines = [];
  const saved = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network in TELEMETRY_STUB'); };
  const stub = await listen({ telemetryStub: true, log: (l) => lines.push(l) });
  try {
    assert.ok(lines.some((l) => l.startsWith('TELEMETRY_STUB=1')), 'the startup line says so');
    const before = lines.length;
    const res = await send(stub.port, 'GET', '/api/leaderboard');
    assert.equal(res.status, 503, 'the function still answers as before');
    const spans = lines.slice(before).filter((l) => l.startsWith('span GET /api/leaderboard'));
    assert.equal(spans.length, 1, lines.join('\n'));
    assert.match(spans[0], /"http\.response\.status_code":503/);
  } finally {
    globalThis.fetch = saved;
    stub.server.close();
  }
});

test('AUTH_STUB handlers are instrumented too', async () => {
  const lines = [];
  const stub = await listen({ authStub: true, telemetryStub: true, log: (l) => lines.push(l) });
  try {
    const res = await send(stub.port, 'GET', '/api/account');
    assert.equal(res.status, 200);
    assert.equal(lines.filter((l) => l.startsWith('span GET /api/account')).length, 1, lines.join('\n'));
  } finally {
    stub.server.close();
  }
});
