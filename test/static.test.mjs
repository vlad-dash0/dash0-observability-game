// Static checks on the shell: CSP-safe markup, the deployed headers, the vendored
// Alpine build and local references. Spec: docs/FOUNDATION.md §6 F1 and §7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { headersFor } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const ALPINE = 'alpine-3.14.1.min.js';

// docs/FOUNDATION.md §7, verbatim.
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; object-src 'none'";

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const html = read('index.html');
const { document } = parseHTML(html);
const all = [...document.querySelectorAll('*')];
const vercel = JSON.parse(read('vercel.json'));

function headerRule(source) {
  const rule = vercel.headers.find((h) => h.source === source);
  assert.ok(rule, `vercel.json has no headers rule for ${source}`);
  return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
}

function directives(csp) {
  return Object.fromEntries(
    csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    }),
  );
}

test('index.html has no inline scripts', () => {
  const scripts = [...document.querySelectorAll('script')];
  assert.ok(scripts.length >= 2, 'expected the module and Alpine scripts');
  for (const s of scripts) {
    assert.ok(s.getAttribute('src'), `script without src: ${s.outerHTML}`);
    assert.equal(s.textContent.trim(), '', `script with inline text: ${s.outerHTML}`);
  }
});

test('index.html has no on* or style attributes', () => {
  for (const el of all) {
    for (const name of el.getAttributeNames()) {
      const n = name.toLowerCase();
      assert.ok(!n.startsWith('on'), `<${el.localName} ${name}> is an inline handler`);
      assert.notEqual(n, 'style', `<${el.localName} style> is an inline style`);
    }
  }
});

test('index.html has no :style or x-bind:style bindings', () => {
  for (const el of all) {
    for (const name of el.getAttributeNames()) {
      const n = name.toLowerCase();
      assert.ok(n !== ':style' && n !== 'x-bind:style', `<${el.localName} ${name}> binds a style`);
    }
  }
});

test('main.mjs loads as a module before Alpine, and Alpine is deferred', () => {
  const srcs = [...document.querySelectorAll('script')].map((s) => s.getAttribute('src'));
  const main = srcs.indexOf('/main.mjs');
  const alpine = srcs.indexOf(`/vendor/${ALPINE}`);
  assert.ok(main >= 0, 'no /main.mjs script');
  assert.ok(alpine >= 0, `no /vendor/${ALPINE} script`);
  assert.ok(main < alpine, 'main.mjs must come before Alpine');
  const scripts = document.querySelectorAll('script');
  assert.equal(scripts[main].getAttribute('type'), 'module');
  assert.ok(scripts[alpine].hasAttribute('defer'), 'Alpine must be deferred');
  for (const el of scripts) {
    assert.ok(!el.hasAttribute('async'), `${el.getAttribute('src')} must not be async (breaks the order)`);
  }
});

test('vercel.json CSP equals the design, with no unsafe-inline and no framing', () => {
  const csp = headerRule('/(.*)')['Content-Security-Policy'];
  assert.equal(csp, CSP);
  const d = directives(csp);
  assert.ok(!d['script-src'].includes("'unsafe-inline'"), "script-src allows 'unsafe-inline'");
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
});

test('vercel.json keeps the hardening headers and the vendor cache rule', () => {
  const h = headerRule('/(.*)');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.equal(h['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  assert.equal(headerRule('/vendor/(.*)')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(headerRule('/fonts/(.*)')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(vercel.functions, undefined, 'no serverless functions yet');
});

test('the dev server sends the vercel.json headers', () => {
  const page = headersFor(vercel, '/');
  assert.equal(page['Content-Security-Policy'], CSP);
  assert.equal(page['Cache-Control'], undefined);
  const vendored = headersFor(vercel, `/vendor/${ALPINE}`);
  assert.equal(vendored['Content-Security-Policy'], CSP);
  assert.equal(vendored['Cache-Control'], 'public, max-age=31536000, immutable');
  const font = headersFor(vercel, '/fonts/MartianMono-Regular.woff2');
  assert.equal(font['Content-Security-Policy'], CSP);
  assert.equal(font['Cache-Control'], 'public, max-age=31536000, immutable');
});

test('vendored files match vendor/SHA256SUMS', () => {
  const lines = readFileSync(join(VENDOR, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
  const sums = Object.fromEntries(lines.map((l) => {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
    assert.ok(m, `malformed SHA256SUMS line: ${l}`);
    return [m[2], m[1]];
  }));
  assert.ok(sums[ALPINE], `${ALPINE} is not listed in SHA256SUMS`);
  for (const [file, want] of Object.entries(sums)) {
    const got = createHash('sha256').update(readFileSync(join(VENDOR, file))).digest('hex');
    assert.equal(got, want, `sha256 mismatch for vendor/${file}`);
  }
});

test('every local src and href in index.html exists on disk', () => {
  const refs = all.flatMap((el) => ['src', 'href'].map((a) => el.getAttribute(a)).filter(Boolean));
  assert.ok(refs.length > 0, 'expected local references');
  for (const ref of refs) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue; // external, data:, mailto:, fragment
    const path = join(ROOT, ref.split(/[?#]/)[0]);
    assert.ok(existsSync(path) && statSync(path).isFile(), `${ref} does not exist`);
  }
});
