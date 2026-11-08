// Static checks on the shell: CSP-safe markup, the deployed headers, the vendored
// Alpine build and local references. Spec: docs/FOUNDATION.md §6 F1 and §7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { headersFor, ignoreMatcher } from '../tools/serve.mjs';
import { INGRESS_HOSTS, INGRESS_PORTS, cspOrigin } from '../lib/dash0/ingress.mjs';
import { definedClasses } from './helpers/css.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const ALPINE = 'alpine-3.14.1.min.js';
const JS_YAML = 'js-yaml-5.5.0.mjs';
// three.js keeps its upstream file names (the module imports './three.core.min.js'), so the
// version is in the directory.
const THREE = ['three-0.180.0/three.module.min.js', 'three-0.180.0/three.core.min.js'];

// docs/FOUNDATION.md §7, verbatim while INGRESS_HOSTS is empty. connect-src is 'self' plus one
// https origin per INGRESS_HOSTS entry (lib/dash0/ingress.mjs is the one source of truth,
// docs/DASH0-LAB.md), so the validator's allowlist and vercel.json cannot drift.
const M0_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; object-src 'none'";
// One origin per host and port, rendered by the validator's own cspOrigin (443 implicit).
const originsFor = (hosts, ports = INGRESS_PORTS) => hosts.flatMap((h) => ports.map((p) => cspOrigin(h, p)));
const cspFor = (hosts, ports = INGRESS_PORTS) =>
  M0_CSP.replace("connect-src 'self';", `connect-src ${["'self'", ...originsFor(hosts, ports)].join(' ')};`);
const CSP = cspFor(INGRESS_HOSTS);

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

test('git tracks no node_modules path, and .gitignore ignores a bare node_modules', (t) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    t.skip('git is not available');
    return;
  }
  const bad = tracked.filter((p) => p.split('/').includes('node_modules'));
  assert.deepEqual(bad, []);
  const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('node_modules'), '.gitignore needs a bare node_modules line (a trailing slash misses symlinks)');
});

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

// T9 (#158): a class with no CSS rule is a typo or dead markup. Static class attributes and
// the quoted class names in :class bindings, template content included.
test('T9 every class index.html writes has a CSS rule', () => {
  const defined = definedClasses();
  const used = new Set();
  for (const el of all) {
    for (const c of (el.getAttribute('class') ?? '').split(/\s+/)) if (c) used.add(c);
    for (const m of (el.getAttribute(':class') ?? '').matchAll(/'([\w-]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('ui-btn') && used.has('overlay') && used.has('show'), 'the scan sees static and bound classes');
  assert.deepEqual([...used].filter((c) => !defined.has(c)).sort(), [], 'index.html classes with no rule in styles/');
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

// I4 (docs/DASH0-LAB.md): the validator's host set is exactly connect-src minus 'self'.
test("vercel.json connect-src is 'self' plus exactly the INGRESS_HOSTS origins", () => {
  const d = directives(headerRule('/(.*)')['Content-Security-Policy']);
  assert.deepEqual(d['connect-src'], ["'self'", ...originsFor(INGRESS_HOSTS)]);
  assert.ok(Object.isFrozen(INGRESS_HOSTS), 'INGRESS_HOSTS is frozen');
  // The derivation: the M0 policy for an empty list, one origin per host otherwise.
  assert.equal(cspFor([]), M0_CSP);
  assert.match(cspFor(['a.example', 'b.example']), /; connect-src 'self' https:\/\/a\.example https:\/\/b\.example; base-uri/);
  // A non-443 ingress port is part of the origin, or the browser blocks the request.
  assert.match(cspFor(['a.example'], [4318]), /; connect-src 'self' https:\/\/a\.example:4318; base-uri/);
  assert.match(cspFor(['a.example'], [443]), /; connect-src 'self' https:\/\/a\.example; base-uri/);
});

test('vercel.json keeps the hardening headers and the vendor cache rule', () => {
  const h = headerRule('/(.*)');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.equal(
    h['Permissions-Policy'],
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()',
  );
  assert.equal(headerRule('/vendor/(.*)')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(headerRule('/fonts/(.*)')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(vercel.functions, undefined, 'no serverless functions yet');
});

// The reviewed set: a feature joins only after a check that Chrome does not flag it as
// unrecognised (#37: browsing-topics, unrecognised where Chrome's Topics feature is
// disabled, did). This test pins the header to that set, so a new name or a typo needs a
// deliberate edit here; it does not itself verify what any browser recognises.
const PERMISSIONS_POLICY_FEATURES = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'display-capture'];

// Feature names of a Permissions-Policy value, each of which must deny all origins:
// `feature=()`, optionally with whitespace inside the empty list (RFC 8941).
function deniedFeatures(value) {
  return value.split(',').map((e) => e.trim()).map((entry) => {
    const m = /^([a-z-]+)=\(\s*\)$/.exec(entry);
    assert.ok(m, `Permissions-Policy entry "${entry}" is not of the form feature=()`);
    return m[1];
  });
}

test('Permissions-Policy names only reviewed features, each denied', () => {
  const names = deniedFeatures(headerRule('/(.*)')['Permissions-Policy']);
  for (const name of names) {
    assert.ok(PERMISSIONS_POLICY_FEATURES.includes(name), `unreviewed Permissions-Policy feature "${name}"`);
  }
  assert.deepEqual([...names].sort(), [...PERMISSIONS_POLICY_FEATURES].sort());
});

test('a denied feature may have whitespace inside its empty list, but nothing else', () => {
  assert.deepEqual(deniedFeatures('camera=( ), usb=()'), ['camera', 'usb']);
  assert.throws(() => deniedFeatures('camera=(self)'), /not of the form feature=\(\)/);
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
  assert.ok(sums[JS_YAML], `${JS_YAML} is not listed in SHA256SUMS`);
  for (const f of THREE) assert.ok(sums[f], `${f} is not listed in SHA256SUMS`);
  // Every vendored file, in subdirectories too (not the two bookkeeping files), is pinned and documented.
  const files = readdirSync(VENDOR, { recursive: true })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => statSync(join(VENDOR, f)).isFile() && f !== 'README.md' && f !== 'SHA256SUMS')
    .sort();
  assert.deepEqual(Object.keys(sums).sort(), files, 'vendor/ and SHA256SUMS list different files');
  const readme = readFileSync(join(VENDOR, 'README.md'), 'utf8');
  for (const file of files) assert.ok(readme.includes(`\`${file}\``), `vendor/README.md does not list ${file}`);
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

test('index.html links the SVG favicon first, then PNG fallbacks', () => {
  const links = [...document.head.querySelectorAll('link')];
  const rel = (l) => (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
  const icons = links.filter((l) => rel(l).includes('icon'));
  assert.equal(icons.length, 2, 'expected an SVG and a PNG <link rel="icon">');
  assert.equal(icons[0].getAttribute('href'), '/favicon.svg');
  assert.equal(icons[0].getAttribute('type'), 'image/svg+xml');
  assert.equal(icons[1].getAttribute('href'), '/favicon-32.png');
  assert.equal(icons[1].getAttribute('type'), 'image/png');
  assert.equal(icons[1].getAttribute('sizes'), '32x32');
  const touch = links.filter((l) => rel(l).includes('apple-touch-icon'));
  assert.equal(touch.length, 1, 'expected one apple-touch-icon');
  assert.equal(touch[0].getAttribute('href'), '/apple-touch-icon.png');
});

test('the PNG favicon fallbacks exist, are deployed and have the right size', () => {
  const ignored = ignoreMatcher(read('.vercelignore'));
  for (const [file, px] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    assert.ok(isFile(join(ROOT, file)), `${file} does not exist`);
    assert.equal(ignored(file), false, `${file} is not deployed`);
    const png = readFileSync(join(ROOT, file));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [px, px], `${file} must be ${px}x${px}`);
  }
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
  for (const rel of ['app.mjs', 'hub/map-data.mjs', 'lib/globe-render.mjs', `vendor/${THREE[0]}`]) {
    assert.ok(seen.has(rel), `${rel} not reached; walked ${[...seen].join(', ')}`);
  }
});

// Tripwire, not proof. A failing assert.equal / deepEqual on a linkedom node (or a ctx
// holding one) makes node's assertion message inspect linkedom's huge circular graph: it
// runs synchronously for minutes, once took tens of GB, and --test-timeout cannot stop
// it. This line-based check catches the common forms only: an equality assertion whose
// first argument is a getElementById / querySelector(All) / closest call, a q( / qa(
// helper call, or ctxs.<id> / ctx. A node held in a variable is caught by the per-file check below; a call split
// over lines gets through. Compare booleans or strings instead, e.g.
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

// Per file: identifiers assigned straight from a DOM lookup (const card = q('#x')), then an
// equality assertion with one as the first or second argument. Same-line, simple forms only.
const ASSERT_FN = String.raw`assert\.(?:equal|notEqual|strictEqual|notStrictEqual|deepEqual|deepStrictEqual)\(`;
const DOM_ASSIGN = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:[\w.]+\.)?(?:getElementById|querySelectorAll|querySelector|closest|qa?)\([^()]*\)(?!\s*[.?[])/g;
const domIdents = (text) => [...text.matchAll(DOM_ASSIGN)].map((m) => m[1]);
const domVarAsserts = (text) => {
  const ids = domIdents(text);
  if (ids.length === 0) return () => false;
  const alt = ids.join('|');
  const re = new RegExp(`${ASSERT_FN}\\s*(?:(?:${alt})\\s*,|[^()]*,\\s*(?:${alt})\\s*[,)])`);
  return (line) => re.test(line);
};

test('the DOM-operand guard also spots a node held in a variable', () => {
  const src = "const card = shell.querySelector('#x');\nassert.equal(card, null);";
  const hit = domVarAsserts(src);
  assert.equal(hit('assert.equal(card, null)'), true);
  assert.equal(hit('assert.deepEqual(1, card)'), true);
  assert.equal(hit("assert.equal(card, null, 'm')"), true);
  assert.equal(hit('assert.equal(card === null, true)'), false);
  assert.equal(hit('assert.equal(card.id, "x")'), false);
  assert.equal(hit('assert.equal(cardinal, 1)'), false);
  assert.equal(domVarAsserts('const n = 5;')('assert.equal(n, 5)'), false);
});

test('no test passes a DOM node or a level ctx to an equality assertion', () => {
  const files = walk('test', ['.mjs']).filter((rel) => rel !== 'test/static.test.mjs');
  for (const rel of files) {
    const text = read(rel);
    const held = domVarAsserts(text);
    text.split('\n').forEach((line, i) => {
      assert.ok(!DOM_OPERAND.test(line), `${rel}:${i + 1} compares a DOM node; compare a boolean: ${line.trim()}`);
      assert.ok(!held(line), `${rel}:${i + 1} compares a DOM node held in a variable; use === null, true: ${line.trim()}`);
    });
  }
});

test('How to play card flows between the overlay header and the level (never over the board)', () => {
  const { document } = parseHTML(read('index.html'));
  const kids = [...document.querySelector('.overlay').children].map((c) => c.getAttribute('class'));
  const howto = kids.indexOf('howto');
  assert.ok(howto > kids.indexOf('lesson-top'), 'card sits after the header');
  assert.ok(howto < kids.indexOf('level-host'), 'card sits before the level');
  const css = read('styles/hub.css');
  const rule = css.slice(css.indexOf('.howto {'), css.indexOf('}', css.indexOf('.howto {')));
  assert.doesNotMatch(rule, /position:\s*(fixed|absolute|sticky)/, 'the card stays in the flow');
  assert.match(rule, /max-height:\s*\d+vh/, 'the card is capped so the level keeps room at 320px');
});
