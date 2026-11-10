// Server telemetry config for the api/ functions (epic #18): the three env names -> off, on or invalid.
// Pure: reads only the `env` it is given. A result never carries an input value, except tracesUrl
// and token in 'on' (the token goes only into the outgoing Authorization header).
// The validators are lib/dash0/ingress.mjs (parseEndpoint, checkToken, checkDataset), so the host
// allowlist and the reason names have one authority. The three-variable rule (all absent is off, any
// set must all validate) and the localhost rule are stated in this header.
//
// Facts used (2026-11-10). Vercel system environment variables: VERCEL is "1" when the code runs on
// Vercel (https://vercel.com/docs/environment-variables/system-environment-variables); the variables
// are exposed by turning on the project's "Enable access to System Environment Variables" setting, so a
// missing VERCEL reads as "not on Vercel" and http://localhost is then allowed (local dev server).
// Stated as reasoning, with no source: that setting only some of the three variables is `invalid`, not `off`, and a typo shows in the logs
// instead of silently turning telemetry off.
import { checkDataset, checkToken, parseEndpoint } from '../dash0/ingress.mjs';

export const ENV_KEYS = Object.freeze({
  endpoint: 'DASH0_OTLP_ENDPOINT',
  token: 'DASH0_AUTH_TOKEN',
  dataset: 'DASH0_DATASET',
});

const isSet = (v) => v !== undefined && v !== null && v !== '';

/** env -> {state:'off'} | {state:'on', tracesUrl, token, dataset|null} | {state:'invalid', field, reason}. */
export function serverTelemetryConfig(env) {
  const raw = {
    endpoint: env?.[ENV_KEYS.endpoint],
    token: env?.[ENV_KEYS.token],
    dataset: env?.[ENV_KEYS.dataset],
  };
  if (!isSet(raw.endpoint) && !isSet(raw.token) && !isSet(raw.dataset)) return { state: 'off' };
  const invalid = (field, reason) => ({ state: 'invalid', field, reason });
  const endpoint = parseEndpoint(raw.endpoint, { allowLocal: env?.VERCEL !== '1' });
  if (!endpoint.ok) return invalid('endpoint', endpoint.reason);
  const token = checkToken(raw.token);
  if (!token.ok) return invalid('token', token.reason);
  const dataset = checkDataset(raw.dataset);
  if (!dataset.ok) return invalid('dataset', dataset.reason);
  return { state: 'on', tracesUrl: endpoint.tracesUrl, token: raw.token, dataset: dataset.dataset };
}
