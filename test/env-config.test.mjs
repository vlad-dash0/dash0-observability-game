// lib/widgets/env-config.mjs: the level 1.2 config checker. Spec: docs/FOUNDATION.md §4
// and §6 F6, checked against the OpenTelemetry spec (URLs in the module header).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../lib/lesson-kit.mjs';
import {
  checkConfig,
  effectiveResource,
  parseEnv,
  renderIssues,
} from '../lib/widgets/env-config.mjs';

const NODE = { processName: 'node' };
const WANT = { serviceName: 'checkout', environment: 'production' };
const GOOD = [
  'OTEL_SERVICE_NAME=checkout',
  'OTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production',
].join('\n');
const codes = (r) => r.issues.map((i) => i.code);

// parseEnv

test('parseEnv skips comments and blank lines, strips export and double quotes', () => {
  const r = parseEnv('# a comment\n\n  \nexport A=1\nB="two words"\n  # indented comment\nC=x=y');
  assert.deepEqual(r.vars, { A: '1', B: 'two words', C: 'x=y' });
  assert.deepEqual(r.errors, []);
});

test('parseEnv: a duplicate name keeps the last value', () => {
  assert.deepEqual(parseEnv('A=1\nA=2').vars, { A: '2' });
});

test('parseEnv: a line without = is an error on that line', () => {
  const r = parseEnv('NOEQUALS');
  assert.deepEqual(r.vars, {});
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 1);
  assert.equal(parseEnv('A=1\n\nNOPE').errors[0].line, 3);
});

test('parseEnv: an invalid variable name is an error, not a variable', () => {
  const r = parseEnv('OTEL SERVICE NAME=checkout');
  assert.deepEqual(r.vars, {});
  assert.equal(r.errors[0].line, 1);
});

test('parseEnv: __proto__ is stored as data, not as the prototype', () => {
  const r = parseEnv('__proto__=x');
  assert.equal(Object.getPrototypeOf(r.vars), Object.prototype);
  assert.equal(Object.hasOwn(r.vars, '__proto__'), true);
});

// effectiveResource

test('no service name anywhere falls back to unknown_service:<process>', () => {
  const r = effectiveResource({}, NODE);
  assert.equal(r.attributes['service.name'], 'unknown_service:node');
  assert.equal(r.source, 'default');
  assert.deepEqual(r.errors, []);
});

test('an unknown process name falls back to bare unknown_service', () => {
  assert.equal(effectiveResource({}, {}).attributes['service.name'], 'unknown_service');
});

test('OTEL_SERVICE_NAME wins over service.name in OTEL_RESOURCE_ATTRIBUTES', () => {
  const r = effectiveResource(
    { OTEL_SERVICE_NAME: 'checkout', OTEL_RESOURCE_ATTRIBUTES: 'service.name=cart' },
    NODE,
  );
  assert.equal(r.attributes['service.name'], 'checkout');
  assert.equal(r.source, 'OTEL_SERVICE_NAME');
});

test('an empty OTEL_SERVICE_NAME counts as unset', () => {
  const r = effectiveResource(
    { OTEL_SERVICE_NAME: '', OTEL_RESOURCE_ATTRIBUTES: 'service.name=cart' },
    NODE,
  );
  assert.equal(r.attributes['service.name'], 'cart');
  assert.equal(r.source, 'OTEL_RESOURCE_ATTRIBUTES');
});

test('an empty OTEL_RESOURCE_ATTRIBUTES counts as unset, with no error', () => {
  const r = effectiveResource({ OTEL_RESOURCE_ATTRIBUTES: '' }, NODE);
  assert.equal(r.source, 'default');
  assert.deepEqual(r.errors, []);
});

test('a blank entry in OTEL_RESOURCE_ATTRIBUTES (trailing comma) is skipped, not an error', () => {
  const r = effectiveResource({ OTEL_RESOURCE_ATTRIBUTES: 'service.name=cart,' }, NODE);
  assert.equal(r.attributes['service.name'], 'cart');
  assert.deepEqual(r.errors, []);
});

test('resource attribute keys and values are percent-decoded and trimmed', () => {
  const r = effectiveResource(
    { OTEL_RESOURCE_ATTRIBUTES: 'service.version=1.2%2C3, team%3Dname = a%20b' },
    NODE,
  );
  assert.equal(r.attributes['service.version'], '1.2,3');
  assert.equal(r.attributes['team=name'], 'a b');
});

test('one invalid entry discards the whole OTEL_RESOURCE_ATTRIBUTES, with an error', () => {
  for (const bad of [
    'service.name=cart,service.version=1,oops',
    'service.name=cart,=nokey',
    'service.name=cart,service.version=%ZZ',
  ]) {
    const r = effectiveResource({ OTEL_RESOURCE_ATTRIBUTES: bad }, NODE);
    assert.equal(r.attributes['service.name'], 'unknown_service:node', bad);
    assert.equal(r.attributes['service.version'], undefined, bad);
    assert.equal(r.errors.length, 1, bad);
  }
});

// checkConfig

test('checkConfig: a correct config passes', () => {
  assert.deepEqual(checkConfig(GOOD, WANT), { ok: true, issues: [] });
});

test('checkConfig: no service name anywhere is service-name-missing', () => {
  const r = checkConfig(
    'OTEL_RESOURCE_ATTRIBUTES=service.version=1,deployment.environment.name=production',
    WANT,
  );
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['service-name-missing']);
  assert.match(r.issues[0].message, /unknown_service:node/);
});

test('checkConfig: a different service name is service-name-wrong', () => {
  const r = checkConfig(GOOD.replace('=checkout', '=cart'), WANT);
  assert.deepEqual(codes(r), ['service-name-wrong']);
});

test('checkConfig: service.name in resource attributes alone is accepted', () => {
  const r = checkConfig(
    'OTEL_RESOURCE_ATTRIBUTES=service.name=checkout,service.version=1,deployment.environment.name=production',
    WANT,
  );
  assert.deepEqual(r, { ok: true, issues: [] });
});

test('checkConfig: no service.version is version-missing', () => {
  const r = checkConfig(GOOD.replace('service.version=1.4.2,', ''), WANT);
  assert.deepEqual(codes(r), ['version-missing']);
});

test('checkConfig: the old deployment.environment key is deprecated-environment only', () => {
  const r = checkConfig(GOOD.replace('deployment.environment.name', 'deployment.environment'), WANT);
  assert.deepEqual(codes(r), ['deprecated-environment']);
});

test('checkConfig: no environment at all is environment-missing', () => {
  const r = checkConfig(GOOD.replace(',deployment.environment.name=production', ''), WANT);
  assert.deepEqual(codes(r), ['environment-missing']);
});

test('checkConfig: a different environment is environment-wrong', () => {
  const r = checkConfig(GOOD.replace('=production', '=staging'), WANT);
  assert.deepEqual(codes(r), ['environment-wrong']);
});

test('checkConfig: parse errors and a discarded OTEL_RESOURCE_ATTRIBUTES are issues', () => {
  const r = checkConfig(`${GOOD}\nNOEQUALS`, WANT);
  assert.deepEqual(codes(r), ['parse-error']);
  assert.equal(r.issues[0].line, 3);
  const bad = checkConfig(`${GOOD},oops`, WANT);
  assert.deepEqual(codes(bad), [
    'resource-attributes-invalid',
    'version-missing',
    'environment-missing',
  ]);
});

test('checkConfig: one parse-error per bad line, every other issue once', () => {
  const r = checkConfig(
    'OTEL_SERVICE_NAME=cart\nOTEL_SERVICE_NAME=cart\nNOPE\nNOPE AGAIN\n' +
      'OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production',
    WANT,
  );
  assert.deepEqual(r.issues.filter((i) => i.code === 'parse-error').map((i) => i.line), [3, 4]);
  assert.deepEqual(codes(r), [
    'parse-error',
    'parse-error',
    'service-name-wrong',
    'version-missing',
    'deprecated-environment',
  ]);
});

// renderIssues

test('renderIssues escapes player input', () => {
  const r = checkConfig(`${GOOD}\nOTEL_SERVICE_NAME=<img src=x onerror=alert(1)>`, WANT);
  assert.deepEqual(codes(r), ['service-name-wrong']);
  const html = renderIssues(r.issues, escapeHtml);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-code="service-name-wrong"/);
});

test('renderIssues renders nothing for no issues', () => {
  assert.equal(renderIssues([], escapeHtml), '');
});

test('renderIssues escapes the issue code too', () => {
  const html = renderIssues([{ code: '"><x>', message: 'm' }], escapeHtml);
  assert.doesNotMatch(html, /"><x>/);
  assert.match(html, /&quot;&gt;&lt;x&gt;/);
});

// Review follow-ups (#14)

test('parseEnv: a lone double quote is a value, not an empty quoted string', () => {
  assert.equal(parseEnv('A="').vars.A, '"');
  assert.equal(parseEnv("A='").vars.A, "'");
});

test('parseEnv: a quoted value with no closing quote is an unclosed-quote error', () => {
  for (const line of ['A="checkout', "A='checkout", 'A="checkout # prod', "A='x\""]) {
    const r = parseEnv(line);
    assert.deepEqual(r.vars, {}, line);
    assert.equal(r.errors.length, 1, line);
    assert.equal(r.errors[0].line, 1, line);
    assert.match(r.errors[0].message, /unclosed quote/, line);
  }
  const c = checkConfig(`${GOOD}\nOTEL_SERVICE_NAME="checkout`, WANT);
  assert.deepEqual(codes(c), ['parse-error']);
  assert.match(c.issues[0].message, /^Line 3: unclosed quote\.$/);
});

test('parseEnv: an inline comment after an unquoted value is cut', () => {
  assert.equal(parseEnv('OTEL_SERVICE_NAME=checkout # prod').vars.OTEL_SERVICE_NAME, 'checkout');
  assert.equal(parseEnv('A=a#b').vars.A, 'a#b');
});

test('parseEnv: an inline comment after a quoted value is cut; other trailing text is an error', () => {
  assert.equal(parseEnv('OTEL_SERVICE_NAME="checkout" # prod').vars.OTEL_SERVICE_NAME, 'checkout');
  assert.equal(parseEnv('A="x # y"').vars.A, 'x # y');
  const r = parseEnv('A="checkout" prod');
  assert.deepEqual(r.vars, {});
  assert.equal(r.errors[0].line, 1);
});

test('parseEnv: single quotes are stripped, with no escape processing', () => {
  assert.equal(parseEnv("OTEL_SERVICE_NAME='checkout'").vars.OTEL_SERVICE_NAME, 'checkout');
  assert.equal(parseEnv("A='a\\nb'").vars.A, 'a\\nb');
});

test('parseEnv: export followed by a tab is still stripped', () => {
  assert.deepEqual(parseEnv('export\tA=1').vars, { A: '1' });
});

test('an unencoded = inside a resource attribute value discards the whole variable', () => {
  const r = effectiveResource({ OTEL_RESOURCE_ATTRIBUTES: 'service.name=cart,service.version=1=2' }, NODE);
  assert.equal(r.attributes['service.name'], 'unknown_service:node');
  assert.equal(r.errors.length, 1);
});

test('a whitespace-only OTEL_SERVICE_NAME counts as unset', () => {
  const ra = effectiveResource(
    { OTEL_SERVICE_NAME: '  ', OTEL_RESOURCE_ATTRIBUTES: 'service.name=cart' },
    NODE,
  );
  assert.equal(ra.attributes['service.name'], 'cart');
  const none = parseEnv('OTEL_SERVICE_NAME="  "').vars;
  assert.equal(effectiveResource(none, NODE).attributes['service.name'], 'unknown_service:node');
});

test('checkConfig: parse errors are capped at 20, then one parse-error-more with the count', () => {
  const r = checkConfig(`${GOOD}\n${'NOPE\n'.repeat(100)}`, WANT);
  assert.equal(codes(r).filter((c) => c === 'parse-error').length, 20);
  const more = r.issues.filter((i) => i.code === 'parse-error-more');
  assert.equal(more.length, 1);
  assert.match(more[0].message, /and 80 more bad lines\.$/);
});

test('checkConfig: parse-error-more says "line" for exactly one more', () => {
  const r = checkConfig(`${GOOD}\n${'NOPE\n'.repeat(21)}`, WANT);
  const more = r.issues.filter((i) => i.code === 'parse-error-more');
  assert.equal(more.length, 1);
  assert.match(more[0].message, /and 1 more bad line\.$/);
});

test('checkConfig: empty attribute values are set but empty, reported as -wrong', () => {
  const ra = (s) => `OTEL_RESOURCE_ATTRIBUTES=${s}`;
  const name = checkConfig(ra('service.name=,service.version=1,deployment.environment.name=production'), WANT);
  assert.deepEqual(codes(name), ['service-name-wrong']);
  assert.match(name.issues[0].message, /empty/);
  const version = checkConfig(GOOD.replace('service.version=1.4.2', 'service.version='), WANT);
  assert.deepEqual(codes(version), ['version-wrong']);
  assert.match(version.issues[0].message, /empty/);
  const env = checkConfig(GOOD.replace('name=production', 'name='), WANT);
  assert.deepEqual(codes(env), ['environment-wrong']);
  assert.match(env.issues[0].message, /empty/);
});
