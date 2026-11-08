// The Env config help ladder core, pure (#159 E1; same contract as configure-it-help.mjs): the
// level 1.2 step 2 data (the given .env, the target, the REFERENCE .env) and the three hint
// tiers. Tier 2 reads the first problem the one grader (`checkConfig`) finds in the player's
// text and names where it sits through ISSUE_VARIABLE and how many pairs the answer has
// (`effectiveResource` of REFERENCE); it never echoes a value or a checker message, since those
// carry the expected value. Tier 3 hands out REFERENCE. DOM-free.

import { checkConfig, effectiveResource, parseEnv } from './env-config.mjs';

export const TARGET = Object.freeze({ serviceName: 'checkout', environment: 'production' });
export const PROCESS = Object.freeze({ processName: 'node' });

export const GIVEN = [
  'OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318',
  'OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production',
].join('\n');

/** An answer that passes `checkConfig` with TARGET: tier 3 fills it in. */
export const REFERENCE = [
  'OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318',
  'OTEL_SERVICE_NAME=checkout',
  'OTEL_RESOURCE_ATTRIBUTES=service.version=1.4.2,deployment.environment.name=production',
].join('\n');

/** Tier 1: the authored hint. Names neither the variable that sets the name nor any value. */
export const ENV_HINT =
  'The service name has a variable of its own, apart from the attribute list. Everything else the task asks for is one more pair in that list, and pairs are separated by commas.';

/**
 * Where each problem `checkConfig` can report sits (`variable`) and what is wrong, in words that
 * hold no value (`kind`). `variable` null: a line, not a variable. Keyed by issue code, so a new
 * code in the checker fails the coverage test until it is mapped here.
 */
export const ISSUE_VARIABLE = Object.freeze({
  'parse-error': { variable: null, kind: 'this is not a valid NAME=value line' },
  'parse-error-more': { variable: null, kind: 'more than one line is not a valid NAME=value line' },
  'sdk-disabled': { variable: 'OTEL_SDK_DISABLED', kind: 'this switches the SDK off, so nothing is reported' },
  'resource-attributes-invalid': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'one pair in the list is malformed, so the SDK throws the whole value away' },
  'service-name-missing': { variable: 'OTEL_SERVICE_NAME', kind: 'the SDK falls back to a made-up one' },
  'service-name-wrong': { variable: 'OTEL_SERVICE_NAME', kind: 'a name is set, but not the one this task asks for' },
  'service-name-conflict': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'the list holds a second service name, which is ignored and only misleads' },
  'version-missing': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'the list has no version pair' },
  'version-wrong': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'the version pair has no value' },
  'deprecated-environment': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'the environment pair uses the old key, which the task says not to use' },
  'environment-missing': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'the list has no environment pair' },
  'environment-wrong': { variable: 'OTEL_RESOURCE_ATTRIBUTES', kind: 'the environment pair has the wrong value' },
});

const size = (text) => Object.keys(effectiveResource(parseEnv(text).vars, PROCESS).attributes).length;
/** The 1-based line of the last `NAME=` assignment in `text` (the one that wins), or 0 when there is none. */
const lineOf = (text, name) => {
  let found = 0;
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const body = raw.trim().replace(/^export\s+/, '');
    if (body.startsWith('#')) return;
    const eq = body.indexOf('=');
    if (eq !== -1 && body.slice(0, eq).trim() === name) found = i + 1;
  });
  return found;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Hint tier `tier` (1 to 3) for the .env `text` typed so far: { html, apply? }; every html is a <p>.
 *   tier 1  ENV_HINT
 *   tier 2  the first problem checkConfig finds in `text`: its variable (or line number) and its
 *           kind from ISSUE_VARIABLE, then the answer's resource size set against the player's
 *   tier 3  `apply` = REFERENCE (the widget fills it in and runs Check, never a mistake)
 */
export function hintFor(text, tier) {
  if (tier === 1) return { html: `<p>${ENV_HINT}</p>` };
  if (tier === 3) return { apply: REFERENCE, html: '<p>Filled in for you: a config that passes.</p>' };
  const { ok, issues } = checkConfig(text, TARGET, PROCESS);
  if (ok) return { html: '<p>Yours already passes: press Check.</p>' };
  const [first] = issues;
  let { variable, kind } = ISSUE_VARIABLE[first.code];
  const { vars } = parseEnv(text);
  // The name can come from the attribute list: then that is the variable in use, not OTEL_SERVICE_NAME.
  if (first.code === 'service-name-wrong' && effectiveResource(vars, PROCESS).source === 'OTEL_RESOURCE_ATTRIBUTES') {
    variable = 'OTEL_RESOURCE_ATTRIBUTES';
    kind = "the list's service name is not the one this task asks for";
  }
  let lead;
  if (variable === null) {
    lead = `${first.line === undefined ? 'In your file' : `On line ${first.line}`}: ${kind}.`;
  } else if (!Object.hasOwn(vars, variable)) {
    lead = first.code === 'service-name-missing'
      ? `<code>${variable}</code> is not set, so ${kind}.`
      : `<code>${variable}</code> is not set in the file.`;
  } else if (first.code === 'service-name-missing') {
    const line = lineOf(text, variable);
    lead = `In <code>${variable}</code>${line ? ` (line ${line})` : ''}: it is empty, so ${kind}.`;
  } else {
    const line = lineOf(text, variable);
    lead = `In <code>${variable}</code>${line ? ` (line ${line})` : ''}: ${kind}.`;
  }
  return {
    html: `<p>${lead} The finished answer has ${plural(size(REFERENCE), 'pair')}, the service name included; yours has ${size(text)}.</p>`,
  };
}
