// Level 1.2 config checker: parse a .env text, work out the resource an OTel SDK would
// build from it, and list what is wrong. Pure and DOM-free. Spec rules, as published:
// - Empty env var = unset: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/#parsing-empty-value
// - OTEL_SERVICE_NAME wins over service.name in OTEL_RESOURCE_ATTRIBUTES: same page.
// - OTEL_RESOURCE_ATTRIBUTES is `k=v,k=v`, percent-encoded; on any error the whole value is
//   discarded: https://opentelemetry.io/docs/specs/otel/resource/sdk/#specifying-resource-information-via-an-environment-variable
// - Fallback `unknown_service:<executable>`, or `unknown_service` when it is unknown:
//   https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/
// - `deployment.environment` is deprecated for `deployment.environment.name`:
//   https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SERVICE_NAME = 'service.name';
const SERVICE_VERSION = 'service.version';
const ENVIRONMENT = 'deployment.environment.name';
const OLD_ENVIRONMENT = 'deployment.environment';

/** Parse .env text into `{vars, errors}`; errors carry a 1-based `line`. Last duplicate wins. */
export function parseEnv(text) {
  const vars = new Map();
  const errors = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const body = line.startsWith('export ') ? line.slice(7).trimStart() : line;
      const eq = body.indexOf('=');
      if (eq === -1) {
        errors.push({ line: i + 1, message: 'expected NAME=value' });
        return;
      }
      const name = body.slice(0, eq).trim();
      if (!NAME.test(name)) {
        errors.push({ line: i + 1, message: 'not a valid variable name' });
        return;
      }
      let value = body.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      vars.set(name, value);
    });
  return { vars: Object.fromEntries(vars), errors };
}

/** Parse OTEL_RESOURCE_ATTRIBUTES; `{attributes}` or `{error}` (the whole value is discarded). */
function parseResourceAttributes(value) {
  const attributes = new Map();
  for (const entry of value.split(',')) {
    if (entry.trim() === '') continue;
    const eq = entry.indexOf('=');
    if (eq === -1) return { error: 'an entry has no "="' };
    let key;
    let val;
    try {
      key = decodeURIComponent(entry.slice(0, eq).trim());
      val = decodeURIComponent(entry.slice(eq + 1).trim());
    } catch {
      return { error: 'an entry has a bad percent-encoding' };
    }
    if (key === '') return { error: 'an entry has an empty key' };
    attributes.set(key, val);
  }
  return { attributes };
}

/**
 * The resource an SDK builds from `vars`: `{attributes, source, errors}`. `source` says where
 * service.name came from: 'OTEL_SERVICE_NAME' | 'OTEL_RESOURCE_ATTRIBUTES' | 'default'.
 */
export function effectiveResource(vars, { processName } = {}) {
  const attributes = new Map();
  const errors = [];
  const ra = vars.OTEL_RESOURCE_ATTRIBUTES;
  if (ra) {
    const parsed = parseResourceAttributes(ra);
    if (parsed.error) {
      errors.push({ message: `OTEL_RESOURCE_ATTRIBUTES ignored: ${parsed.error}` });
    } else {
      for (const [k, v] of parsed.attributes) attributes.set(k, v);
    }
  }
  let source = attributes.has(SERVICE_NAME) ? 'OTEL_RESOURCE_ATTRIBUTES' : 'default';
  if (vars.OTEL_SERVICE_NAME) {
    attributes.set(SERVICE_NAME, vars.OTEL_SERVICE_NAME);
    source = 'OTEL_SERVICE_NAME';
  }
  if (source === 'default') {
    attributes.set(SERVICE_NAME, processName ? `unknown_service:${processName}` : 'unknown_service');
  }
  return { attributes: Object.fromEntries(attributes), source, errors };
}

/**
 * Check .env text against the level's target: `{ok, issues:[{code, message, line?}]}`.
 * One `parse-error` per bad line; every other code at most once.
 */
export function checkConfig(text, { serviceName, environment }, { processName = 'node' } = {}) {
  const issues = [];
  const add = (code, message, extra = {}) => issues.push({ code, message, ...extra });
  const { vars, errors } = parseEnv(text);
  for (const e of errors) add('parse-error', `Line ${e.line}: ${e.message}.`, { line: e.line });
  const res = effectiveResource(vars, { processName });
  for (const e of res.errors) add('resource-attributes-invalid', `${e.message}.`);
  const attrs = res.attributes;

  if (res.source === 'default') {
    add('service-name-missing', `No service name: it shows up as ${attrs[SERVICE_NAME]}.`);
  } else if (attrs[SERVICE_NAME] !== serviceName) {
    add('service-name-wrong', `Service name is "${attrs[SERVICE_NAME]}", expected "${serviceName}".`);
  }
  if (!attrs[SERVICE_VERSION]) add('version-missing', 'No service.version.');
  if (Object.hasOwn(attrs, OLD_ENVIRONMENT)) {
    add('deprecated-environment', `${OLD_ENVIRONMENT} is deprecated; use ${ENVIRONMENT}.`);
  }
  if (!Object.hasOwn(attrs, ENVIRONMENT)) {
    if (!Object.hasOwn(attrs, OLD_ENVIRONMENT)) add('environment-missing', `No ${ENVIRONMENT}.`);
  } else if (attrs[ENVIRONMENT] !== environment) {
    add('environment-wrong', `${ENVIRONMENT} is "${attrs[ENVIRONMENT]}", expected "${environment}".`);
  }
  return { ok: issues.length === 0, issues };
}

/** Issues as an HTML list; every message is escaped (it can echo player input). */
export function renderIssues(issues, escapeHtml) {
  if (issues.length === 0) return '';
  const items = issues
    .map((i) => `<li data-code="${escapeHtml(i.code)}">${escapeHtml(i.message)}</li>`)
    .join('');
  return `<ul class="env-issues">${items}</ul>`;
}
