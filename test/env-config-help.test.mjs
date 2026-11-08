// The Env config help ladder core (#159 E1): lib/widgets/env-config-help.mjs. The reference
// passes the one grader, every checker code is mapped for tier 2, and tiers 1 and 2 never name
// the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig } from '../lib/widgets/env-config.mjs';
import { ENV_HINT, GIVEN, ISSUE_VARIABLE, PROCESS, REFERENCE, TARGET, hintFor } from '../lib/widgets/env-config-help.mjs';

const plain = (html) => html.replace(/<[^>]*>/g, '');
// One text per code checkConfig can report (the given config reports two on its own).
const TEXTS = {
  'parse-error': 'NOEQUALS',
  'parse-error-more': Array.from({ length: 22 }, () => 'NOEQUALS').join('\n'),
  'sdk-disabled': `${REFERENCE}\nOTEL_SDK_DISABLED=true`,
  'resource-attributes-invalid': 'OTEL_SERVICE_NAME=checkout\nOTEL_RESOURCE_ATTRIBUTES=service.version',
  'service-name-missing': GIVEN,
  'service-name-wrong': REFERENCE.replace('=checkout', '=cart'),
  'service-name-conflict': REFERENCE.replace('=service.version', '=service.name=cart,service.version'),
  'version-missing': REFERENCE.replace('service.version=1.4.2,', ''),
  'version-wrong': REFERENCE.replace('1.4.2', ''),
  'deprecated-environment': REFERENCE.replace('deployment.environment.name', 'deployment.environment'),
  'environment-missing': REFERENCE.replace(',deployment.environment.name=production', ''),
  'environment-wrong': REFERENCE.replace('=production', '=staging'),
};

test('the REFERENCE passes the one grader, and GIVEN does not', () => {
  assert.equal(checkConfig(REFERENCE, TARGET, PROCESS).ok, true);
  assert.equal(checkConfig(GIVEN, TARGET, PROCESS).ok, false);
});

test('tier 1 is the authored hint in a <p>; tier 3 hands out the reference', () => {
  assert.deepEqual(hintFor(GIVEN, 1), { html: `<p>${ENV_HINT}</p>` });
  const t3 = hintFor(GIVEN, 3);
  assert.equal(t3.apply, REFERENCE);
  assert.equal(t3.html, '<p>Filled in for you: a config that passes.</p>');
});

for (const [code, text] of Object.entries(TEXTS)) {
  test(`tier 2 for ${code}: its mapped variable and kind, no value and no checker message`, () => {
    const issues = checkConfig(text, TARGET, PROCESS).issues;
    assert.ok(issues.some((i) => i.code === code), 'the fixture reports this code');
    // parse-error-more always follows a parse-error, so tier 2 words the first issue.
    const { variable, kind } = ISSUE_VARIABLE[issues[0].code];
    const { html, apply } = hintFor(text, 2);
    assert.equal(apply, undefined);
    assert.ok(html.startsWith('<p>') && html.endsWith('</p>'));
    assert.ok(html.includes(kind), 'the kind sentence');
    if (variable !== null) assert.ok(html.includes(`<code>${variable}</code>`), 'the variable');
    assert.doesNotMatch(plain(html), /checkout|1\.4\.2|production|staging|cart|unknown_service/);
    assert.ok(!html.includes(issues[0].message), 'a checker message can carry the expected value');
  });
}

test('every code the checker can report is mapped and exercised, and no mapping is stale', () => {
  assert.deepEqual(Object.keys(ISSUE_VARIABLE).sort(), Object.keys(TEXTS).sort());
});

test('tier 2 on a bad line names the line number; on a passing text it says to press Check', () => {
  assert.match(hintFor(`${REFERENCE}\n\nNOEQUALS`, 2).html, /^<p>On line 5: a line is not a valid NAME=value line\./);
  assert.equal(hintFor(REFERENCE, 2).html, '<p>Yours already passes: press Check.</p>');
});

test('tier 2 compares the answer resource size with the player resource size', () => {
  assert.match(hintFor(GIVEN, 2).html, /The answer's resource has 3 attributes; yours has 2\./);
  assert.match(hintFor('OTEL_SERVICE_NAME=checkout', 2).html, /yours has 1\./);
});

test('tiers 1 and 2 never contain a reference line or a value', () => {
  const lines = REFERENCE.split('\n');
  for (const text of [GIVEN, ...Object.values(TEXTS)]) {
    for (const tier of [1, 2]) {
      const html = hintFor(text, tier).html;
      for (const line of lines) assert.ok(!html.includes(line), `tier ${tier} holds "${line}"`);
      assert.doesNotMatch(plain(html), /checkout|1\.4\.2|production/);
    }
  }
});
