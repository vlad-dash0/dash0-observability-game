// The dev server (tools/serve.mjs) behaves like the Vercel deployment: same headers,
// same files refused, and no way out of its root. Spec: docs/FOUNDATION.md §5 F1, §7.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, ignoreMatcher, startServer } from '../tools/serve.mjs';

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
after(() => repo.server.close());

test('the running server sends the vercel.json headers', async () => {
  const page = await get(repo.port, '/');
  assert.equal(page.status, 200);
  assertHeaders(page, rule('/(.*)'));
  assert.equal(page.headers['cache-control'], undefined);
  const vendored = await get(repo.port, '/vendor/alpine-3.14.1.min.js');
  assert.equal(vendored.status, 200);
  assertHeaders(vendored, [...rule('/(.*)'), ...rule('/vendor/(.*)')]);
  // Status depends on whether F2's fonts exist yet; the headers must not.
  const font = await get(repo.port, '/fonts/MartianMono-Regular.woff2');
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
  site = await listen({ root });
});
after(() => {
  site.server.close();
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

test('a symlink cannot point out of the root', async () => {
  const res = await get(site.port, '/link.txt');
  assert.equal(res.status, 404);
  assert.ok(!res.body.includes('outside'));
});

test('dot segments are refused even when not ignored', async () => {
  assert.equal((await get(site.port, '/.git/config')).status, 404);
});

test('an unreadable file is a 500 and the server stays up', async () => {
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

test('header sources outside (...) groups are literal', () => {
  const config = { headers: [{ source: '/sw.js', headers: [{ key: 'X-T', value: '1' }] }] };
  assert.deepEqual(headersFor(config, '/sw.js'), { 'X-T': '1' });
  assert.deepEqual(headersFor(config, '/swXjs'), {});
});
