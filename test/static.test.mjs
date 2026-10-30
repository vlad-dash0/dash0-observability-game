// Static checks on the shell: CSP-safe markup, the deployed headers, the vendored
// Alpine build and local references. Spec: docs/FOUNDATION.md §6 F1 and §7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { headersFor, ignoreMatcher } from '../tools/serve.mjs';

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
// Every element, including those inside <template> content (Alpine x-for / x-if bodies),
// which querySelectorAll does not enter.
function deepAll(root) {
  return [...root.querySelectorAll('*')].flatMap((el) =>
    el.localName === 'template' && el.content ? [el, ...deepAll(el.content)] : [el]);
}
const all = deepAll(document);
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
  const font = headersFor(vercel, '/fonts/MartianMono-1.1.0-Regular.woff2');
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

test('the markup walk enters <template> content', () => {
  assert.ok(all.some((el) => el.classList?.contains('level-card')), 'level cards live in an x-for template');
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

// ---- the favicon (#39) --------------------------------------------------------------

test('index.html links the SVG favicon, so browsers do not probe /favicon.ico', () => {
  const icons = [...document.head.querySelectorAll('link')]
    .filter((l) => (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('icon'));
  assert.equal(icons.length, 1, 'expected exactly one <link rel="icon">');
  assert.equal(icons[0].getAttribute('href'), '/favicon.svg');
  assert.equal(icons[0].getAttribute('type'), 'image/svg+xml');
});

/**
 * Why `svg` is unsafe as a favicon under the CSP, as messages ([] when it is fine).
 * Animation (SMIL) and xml-stylesheet are out because they can rewrite attributes or
 * pull in a sheet after the static checks have passed.
 */
function faviconProblems(svg) {
  const out = [];
  const { document: icon } = parseHTML(`<!DOCTYPE html><html><body>${svg}</body></html>`);
  const root = icon.body.firstElementChild;
  if (root?.localName !== 'svg') return ['favicon.svg must have an <svg> root'];
  if (root.getAttribute('xmlns') !== 'http://www.w3.org/2000/svg') out.push('<svg> needs the SVG xmlns');
  if (!root.hasAttribute('viewBox')) out.push('favicon.svg needs a viewBox to scale');
  if (/<\s*(style|script|foreignObject)\b/i.test(svg)) out.push('no <style>, <script> or <foreignObject>');
  if (/<\s*(set|animate\w*)\b/i.test(svg)) out.push('no SMIL <set> or <animate*>');
  if (/<\?\s*xml-stylesheet\b/i.test(svg)) out.push('no <?xml-stylesheet?>');
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const name of el.getAttributeNames()) {
      const n = name.toLowerCase();
      if (n === 'style') out.push(`<${el.localName} style> is blocked by style-src 'self'`);
      if (n.startsWith('on')) out.push(`<${el.localName} ${name}> is an inline handler`);
      if ((n === 'href' || n === 'xlink:href') && !el.getAttribute(name).startsWith('#')) {
        out.push(`<${el.localName} ${name}> must be a #fragment`);
      }
    }
  }
  if (/@import|url\(\s*['"]?(?!#)/i.test(svg)) out.push('no external url() or @import');
  return out;
}

test('the favicon checker flags each unsafe construct', () => {
  const svg = (inner, pre = '') => `${pre}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${inner}</svg>`;
  assert.deepEqual(faviconProblems(svg('<rect fill="#000"/><use href="#a"/>')), []);
  assert.deepEqual(faviconProblems(svg('<rect style="fill:red"/>')), ["<rect style> is blocked by style-src 'self'"]);
  assert.deepEqual(faviconProblems(svg('<style>rect{}</style>')), ['no <style>, <script> or <foreignObject>']);
  assert.deepEqual(faviconProblems(svg('<image href="data:image/png;base64,AA"/>')), ['<image href> must be a #fragment']);
  assert.deepEqual(faviconProblems(svg('<a><set attributeName="href" to="https://x.test/"/></a>')),
    ['no SMIL <set> or <animate*>']);
  for (const tag of ['animate', 'animateTransform', 'animateMotion']) {
    assert.deepEqual(faviconProblems(svg(`<rect><${tag} attributeName="x" to="1"/></rect>`)),
      ['no SMIL <set> or <animate*>'], tag);
  }
  assert.deepEqual(faviconProblems(svg('<rect/>', '<?xml-stylesheet href="https://x.test/a.css"?>\n')),
    ['no <?xml-stylesheet?>']);
});

test('favicon.svg is a small, deployed, CSP-safe SVG', () => {
  assert.ok(isFile(join(ROOT, 'favicon.svg')), 'favicon.svg does not exist');
  assert.equal(ignoreMatcher(read('.vercelignore'))('favicon.svg'), false, 'favicon.svg is not deployed');
  const svg = read('favicon.svg');
  assert.ok(svg.length < 1024, `favicon.svg is ${svg.length} bytes; keep it under 1 KB`);
  assert.deepEqual(faviconProblems(svg), []);
});

// ---- local references in CSS and JS -----------------------------------------------

const isExternal = (ref) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const isFile = (path) => existsSync(path) && statSync(path).isFile();
// A local ref: '/x' from the site root, anything else from the referring file's dir.
const resolveRef = (ref, fromFile) =>
  ref.startsWith('/') ? join(ROOT, ref.split(/[?#]/)[0]) : resolve(dirname(fromFile), ref.split(/[?#]/)[0]);

/** Every file under `dir` (repo-relative) with one of `exts`, skipping node_modules and dotdirs. */
function walk(dir, exts) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

/** url(...) targets in a stylesheet, comments stripped. */
function cssUrls(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2].trim());
}

/** Static and dynamic import / export-from specifiers in a module, comments stripped. */
function importSpecifiers(js) {
  const text = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /(?:\bimport\s*\(\s*|\bimport\s+|\bfrom\s+)(['"])([^'"\n]+)\1/g;
  return [...text.matchAll(re)].map((m) => m[2]);
}
const isLocalSpecifier = (s) => s.startsWith('./') || s.startsWith('../') || s.startsWith('/');

test('the ref scanners find url() and import specifiers', () => {
  assert.deepEqual(cssUrls('a{src:url("/f.woff2") format("woff2")} /* url(/no.png) */ b{background:url(x.png)}'),
    ['/f.woff2', 'x.png']);
  assert.deepEqual(
    importSpecifiers("import a from './a.mjs';\nimport './b.mjs';\nexport { c } from \"../c.mjs\";\n" +
      "const d = await import('./d.mjs');\n// import x from './comment.mjs';\nimport { e } from 'linkedom';"),
    ['./a.mjs', './b.mjs', '../c.mjs', './d.mjs', 'linkedom'],
  );
});

test('every local url() in styles/*.css exists on disk', () => {
  const sheets = walk('styles', ['.css']);
  assert.ok(sheets.length > 0);
  let count = 0;
  for (const rel of sheets) {
    for (const ref of cssUrls(read(rel))) {
      if (isExternal(ref)) continue;
      count++;
      assert.ok(isFile(resolveRef(ref, join(ROOT, rel))), `${rel}: url(${ref}) does not exist`);
    }
  }
  assert.ok(count > 0, 'expected local url() references (the fonts)');
});

test('every local import specifier in a .mjs file exists on disk', () => {
  // This file is skipped: its scanner self-test holds sample specifiers in strings.
  const modules = walk('', ['.mjs']).filter((rel) => rel !== 'test/static.test.mjs');
  assert.ok(modules.includes('main.mjs') && modules.includes('test/game.test.mjs'));
  for (const rel of modules) {
    for (const spec of importSpecifiers(read(rel)).filter(isLocalSpecifier)) {
      assert.ok(isFile(resolveRef(spec, join(ROOT, rel))), `${rel}: import '${spec}' does not exist`);
    }
  }
});

test('everything main.mjs imports, transitively, is deployed (not in .vercelignore)', () => {
  const ignored = ignoreMatcher(read('.vercelignore'));
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    assert.ok(!ignored(rel), `${rel} is imported by the app but excluded from the deployment`);
    for (const spec of importSpecifiers(read(rel)).filter(isLocalSpecifier)) {
      visit(relative(ROOT, resolveRef(spec, join(ROOT, rel))).split('\\').join('/'));
    }
  };
  visit('main.mjs');
  assert.ok(seen.has('app.mjs') && seen.has('hub/map-data.mjs'), `walked ${[...seen].join(', ')}`);
});

// Tripwire, not proof. A failing assert.equal / deepEqual on a linkedom node (or a ctx
// holding one) makes node's assertion message inspect linkedom's huge circular graph: it
// runs synchronously for minutes, once took tens of GB, and --test-timeout cannot stop
// it. This line-based check catches the common forms only: an equality assertion whose
// first argument is a getElementById / querySelector(All) / closest call, a q( / qa(
// helper call, or ctxs.<id> / ctx. A node held in a variable, a second argument, or a
// call split over lines gets through. Compare booleans or strings instead, e.g.
// `assert.equal(el === null, true)`.
const DOM_OPERAND = new RegExp(
  String.raw`assert\.(?:equal|notEqual|strictEqual|notStrictEqual|deepEqual|deepStrictEqual|notDeepEqual|notDeepStrictEqual)\(\s*` +
    String.raw`(?:(?:[\w.]+\.)?(?:getElementById|querySelectorAll|querySelector|closest)\([^()]*\)|qa?\([^()]*\)|ctxs\.\w+|ctx)\s*,`,
);

test('the DOM-operand guard spots node and ctx operands, not their string properties', () => {
  assert.ok(DOM_OPERAND.test("assert.equal(document.getElementById('a'), null)"));
  assert.ok(DOM_OPERAND.test("assert.equal(el.closest('.x'), null, 'm')"));
  assert.ok(DOM_OPERAND.test('assert.deepEqual(ctxs.y, undefined)'));
  assert.ok(DOM_OPERAND.test("assert.equal(q('#fin'), null)"));
  assert.ok(DOM_OPERAND.test("assert.deepEqual(qa('.choice'), [])"));
  assert.ok(DOM_OPERAND.test("assert.deepEqual(body.querySelectorAll('p'), [])"));
  assert.ok(!DOM_OPERAND.test("assert.equal(qa('.choice').length, 2)"));
  assert.ok(!DOM_OPERAND.test("assert.equal(seq('#a'), 1)"), 'the operand must open the call');
  assert.ok(!DOM_OPERAND.test("assert.equal(document.getElementById('a') === null, true)"));
  assert.ok(!DOM_OPERAND.test("assert.equal(q('#a').getAttribute('cx'), '5')"));
  assert.ok(!DOM_OPERAND.test("assert.equal(dom.document.getElementById('ov-body').innerHTML, '')"));
});

test('no test passes a DOM node or a level ctx to an equality assertion', () => {
  const files = walk('test', ['.mjs']).filter((rel) => rel !== 'test/static.test.mjs');
  for (const rel of files) {
    read(rel).split('\n').forEach((line, i) => {
      assert.ok(!DOM_OPERAND.test(line), `${rel}:${i + 1} compares a DOM node; compare a boolean: ${line.trim()}`);
    });
  }
});
