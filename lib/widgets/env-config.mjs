// Level 1.2 config checker: parse a .env text, work out the resource an OTel SDK would
// build from it, and list what is wrong. Pure and DOM-free. Spec rules, as published:
// - Empty env var = unset: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/#parsing-empty-value
// - OTEL_SERVICE_NAME wins over service.name in OTEL_RESOURCE_ATTRIBUTES: same page.
// - OTEL_RESOURCE_ATTRIBUTES is `k=v,k=v`, percent-encoded; on any error the whole value is
//   discarded: https://opentelemetry.io/docs/specs/otel/resource/sdk/#specifying-resource-information-via-an-environment-variable
// - Fallback `unknown_service:<executable>`, or `unknown_service` when it is unknown:
//   https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/
// - OTEL_SDK_DISABLED=true (case-insensitive) disables the SDK: same env-var page.
// - Node also discards OTEL_RESOURCE_ATTRIBUTES when a key or value is over 255 characters
//   (after percent-decoding, as Node's ResourceAttributesEnvDetector does).
// - `deployment.environment` is deprecated for `deployment.environment.name`:
//   https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SERVICE_NAME = 'service.name';
const SERVICE_VERSION = 'service.version';
const ENVIRONMENT = 'deployment.environment.name';
const OLD_ENVIRONMENT = 'deployment.environment';
const MAX_PARSE_ERRORS = 20;
const MAX_ATTRIBUTE_LENGTH = 255;

/**
 * The value after `NAME=`: `{value}` or `{error}`. Quotes ('…' or "…") are taken verbatim;
 * an opening quote with no closing one is an error, except a lone quote character (`A="`).
 */
function parseValue(rest) {
  const v = rest.trimStart();
  const q = v[0];
  const quoted = q === '"' || q === "'";
  const end = quoted ? v.indexOf(q, 1) : -1;
  if (quoted && end === -1 && v.length > 1) return { error: 'unclosed quote' };
  if (end !== -1) {
    const tail = v.slice(end + 1).trimStart();
    if (tail !== '' && !tail.startsWith('#')) return { error: 'unexpected text after the closing quote' };
    return { value: v.slice(1, end) };
  }
  const hash = rest.search(/\s#/);
  return { value: (hash === -1 ? rest : rest.slice(0, hash)).trim() };
}

/**
 * Parse .env text into `{vars, errors}`; errors carry a 1-based `line`. Last duplicate wins.
 * Supports `#` comments (whole line, or after whitespace), `export`, and '…' / "…" values.
 */
export function parseEnv(text) {
  const vars = new Map();
  const errors = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const body = line.replace(/^export\s+/, '');
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
      const parsed = parseValue(body.slice(eq + 1));
      if (parsed.error) {
        errors.push({ line: i + 1, message: parsed.error });
        return;
      }
      vars.set(name, parsed.value);
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
    if (entry.includes('=', eq + 1)) return { error: 'a value has an unencoded "=" (use %3D)' };
    let key;
    let val;
    try {
      key = decodeURIComponent(entry.slice(0, eq).trim());
      val = decodeURIComponent(entry.slice(eq + 1).trim());
    } catch {
      return { error: 'an entry has a bad percent-encoding' };
    }
    if (key.length > MAX_ATTRIBUTE_LENGTH || val.length > MAX_ATTRIBUTE_LENGTH) {
      return { error: `a key or value is longer than ${MAX_ATTRIBUTE_LENGTH} characters` };
    }
    if (key === '') return { error: 'an entry has an empty key' };
    attributes.set(key, val);
  }
  return { attributes };
}

/**
 * The resource an SDK builds from `vars`: `{attributes, source, errors, shadowed}`. `source`
 * says where service.name came from: 'OTEL_SERVICE_NAME' | 'OTEL_RESOURCE_ATTRIBUTES' |
 * 'default'. `shadowed` is the RA service.name that OTEL_SERVICE_NAME overrode, if any.
 */
export function effectiveResource(vars, { processName } = {}) {
  const attributes = new Map();
  const errors = [];
  const ra = vars.OTEL_RESOURCE_ATTRIBUTES;
  if (ra?.trim()) {
    const parsed = parseResourceAttributes(ra);
    if (parsed.error) {
      errors.push({ message: `OTEL_RESOURCE_ATTRIBUTES ignored: ${parsed.error}` });
    } else {
      for (const [k, v] of parsed.attributes) attributes.set(k, v);
    }
  }
  let source = attributes.has(SERVICE_NAME) ? 'OTEL_RESOURCE_ATTRIBUTES' : 'default';
  let shadowed;
  if (vars.OTEL_SERVICE_NAME?.trim()) {
    shadowed = attributes.get(SERVICE_NAME);
    attributes.set(SERVICE_NAME, vars.OTEL_SERVICE_NAME);
    source = 'OTEL_SERVICE_NAME';
  }
  if (source === 'default') {
    attributes.set(SERVICE_NAME, processName ? `unknown_service:${processName}` : 'unknown_service');
  }
  return { attributes: Object.fromEntries(attributes), source, errors, shadowed };
}

/**
 * Check .env text against the level's target: `{ok, issues:[{code, message, line?}]}`.
 * One `parse-error` per bad line (the first 20, then one `parse-error-more`); every other
 * code at most once.
 */
export function checkConfig(text, { serviceName, environment }, { processName = 'node' } = {}) {
  const issues = [];
  const add = (code, message, extra = {}) => issues.push({ code, message, ...extra });
  const { vars, errors } = parseEnv(text);
  for (const e of errors.slice(0, MAX_PARSE_ERRORS)) {
    add('parse-error', `Line ${e.line}: ${e.message}.`, { line: e.line });
  }
  if (errors.length > MAX_PARSE_ERRORS) {
    const more = errors.length - MAX_PARSE_ERRORS;
    add('parse-error-more', `…and ${more} more bad ${more === 1 ? 'line' : 'lines'}.`);
  }
  const disabled = vars.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true';
  if (disabled) {
    add('sdk-disabled', 'OTEL_SDK_DISABLED=true turns the SDK off: nothing is reported.');
  }
  const res = effectiveResource(vars, { processName });
  for (const e of res.errors) add('resource-attributes-invalid', `${e.message}.`);
  const attrs = res.attributes;

  // A key present with an empty value is set but empty (SDKs keep it): `-wrong`, not `-missing`.
  const shown = (v) => (v === '' ? 'empty' : `"${v}"`);
  if (res.source === 'default') {
    // A disabled SDK reports nothing, so there is no fallback name to show.
    add(
      'service-name-missing',
      disabled ? 'No service name set.' : `No service name: it shows up as ${attrs[SERVICE_NAME]}.`,
    );
  } else if (attrs[SERVICE_NAME] !== serviceName) {
    add('service-name-wrong', `Service name is ${shown(attrs[SERVICE_NAME])}, expected "${serviceName}".`);
  }
  if (res.shadowed !== undefined && res.shadowed !== attrs[SERVICE_NAME]) {
    const raName = res.shadowed === '' ? `service.name (${shown(res.shadowed)})` : `service.name=${res.shadowed}`;
    add(
      'service-name-conflict',
      `${raName} in OTEL_RESOURCE_ATTRIBUTES is ignored because OTEL_SERVICE_NAME is set; remove it so nobody is misled.`,
    );
  }
  if (!Object.hasOwn(attrs, SERVICE_VERSION)) add('version-missing', 'No service.version.');
  else if (attrs[SERVICE_VERSION] === '') add('version-wrong', 'service.version is empty.');
  if (Object.hasOwn(attrs, OLD_ENVIRONMENT)) {
    add('deprecated-environment', `${OLD_ENVIRONMENT} is deprecated; use ${ENVIRONMENT}.`);
  }
  if (!Object.hasOwn(attrs, ENVIRONMENT)) {
    if (!Object.hasOwn(attrs, OLD_ENVIRONMENT)) add('environment-missing', `No ${ENVIRONMENT}.`);
  } else if (attrs[ENVIRONMENT] !== environment) {
    add('environment-wrong', `${ENVIRONMENT} is ${shown(attrs[ENVIRONMENT])}, expected "${environment}".`);
  }
  return { ok: issues.length === 0, issues };
}

/** Issues as an HTML list; every message is escaped (it can echo player input). */
export function renderIssues(issues, escapeHtml) {
  if (issues.length === 0) return '';
  const items = issues
    .map((i) => `<li data-code="${escapeHtml(i.code)}">${escapeHtml(i.message)}</li>`)
    .join('');
  return `<ul data-part="issues">${items}</ul>`;
}
