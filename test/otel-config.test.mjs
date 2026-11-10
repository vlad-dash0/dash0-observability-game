// lib/otel/config.mjs: server telemetry config from env, dormant unless fully valid.
// Spec: the header of lib/otel/config.mjs; the validators are in lib/dash0/ingress.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverTelemetryConfig } from '../lib/otel/config.mjs';
import { ENV_ON } from './helpers/otel.mjs';

const E = 'DASH0_OTLP_ENDPOINT';
const T = 'DASH0_AUTH_TOKEN';
const D = 'DASH0_DATASET';

test('nothing set, or only empty strings, is off', () => {
  assert.deepEqual(serverTelemetryConfig({}), { state: 'off' });
  assert.deepEqual(serverTelemetryConfig({ [E]: '', [T]: '', [D]: '' }), { state: 'off' });
});

test('a valid trio is on; the dataset is null when unset', () => {
  assert.deepEqual(serverTelemetryConfig(ENV_ON), {
    state: 'on',
    tracesUrl: 'https://ingress.eu-west-1.aws.dash0.com/v1/traces',
    token: 'auth_TOKENCANARY123456',
    dataset: 'oncall-api',
  });
  const { [D]: _d, ...noDataset } = ENV_ON;
  assert.equal(serverTelemetryConfig(noDataset).dataset, null);
});

test('invalid names the field and the reason, never a value', () => {
  const { [E]: ep, [T]: tok, [D]: ds } = ENV_ON;
  const cases = [
    [{ [E]: ep }, 'token', 'empty'],
    [{ [T]: tok }, 'endpoint', 'empty'],
    [{ [D]: ds }, 'endpoint', 'empty'],
    [{ ...ENV_ON, [E]: 'https://ingress.evil.example' }, 'endpoint', 'unknown-host'],
    [{ ...ENV_ON, [E]: `${ep}/v1/traces` }, 'endpoint', 'signal-path'],
    [{ ...ENV_ON, [T]: 'Bearer auth_TOKENCANARY123456' }, 'token', 'bearer-prefix'],
    [{ ...ENV_ON, [D]: 'bad dataset!' }, 'dataset', 'format'],
  ];
  for (const [env, field, reason] of cases) {
    const got = serverTelemetryConfig(env);
    assert.deepEqual(got, { state: 'invalid', field, reason });
    const json = JSON.stringify(got).toLowerCase();
    assert.ok(!json.includes('evil') && !json.includes('ingress.') && !json.includes('canary'));
  }
});

test('localhost is accepted only off Vercel', () => {
  const local = { ...ENV_ON, [E]: 'http://localhost:4318' };
  assert.equal(serverTelemetryConfig(local).tracesUrl, 'http://localhost:4318/v1/traces');
  assert.deepEqual(serverTelemetryConfig({ ...local, VERCEL: '1' }), { state: 'invalid', field: 'endpoint', reason: 'not-https' });
});
