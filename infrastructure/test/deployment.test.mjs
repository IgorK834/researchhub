import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig, parameters, deploy, BICEP_VERSION } from '../scripts/deployment.mjs';

const fixture = JSON.parse(readFileSync(new URL('../environments/dev.json', import.meta.url)));
const now = new Date('2026-10-12T12:00:00Z');
const env = { AZURE_SUBSCRIPTION_ID: '11111111-2222-3333-4444-555555555555',
  RH_DB_PASSWORD: 'Aa0!'.repeat(10), RH_WORKER_SERVICE_TOKEN: 'b'.repeat(40), RH_METRICS_SCRAPE_TOKEN: 'c'.repeat(40) };
const apps = { ...fixture, deployApplications: true, ...Object.fromEntries(
  ['backendImage', 'workerImage', 'frontendImage'].map(key => [key, `ghcr.io/student/${key.toLowerCase()}@sha256:${'d'.repeat(64)}`])) };

test('default and two-replica budgets include rollout surge and reserved connections', () => {
  assert.deepEqual(validateConfig(fixture), { resourceGroupName: 'rg-rh-dev-student', connections: 20, limit: 28 });
  assert.equal(validateConfig({ ...fixture, maxReplicas: 2, poolSize: 6 }).connections, 24);
  assert.throws(() => validateConfig({ ...fixture, maxReplicas: 2 }), /budget/);
  assert.throws(() => validateConfig({ ...fixture, otherConnections: 11 }), /budget/);
  assert.equal(validateConfig(apps).connections, 20);
});

test('public configuration rejects secret/unknown keys, malformed fields and unsupported topology', () => {
  for (const value of [null, [], 'dev', { ...fixture, databasePassword: 'secret' }, { ...fixture, accidentalResource: true }]) {
    assert.throws(() => validateConfig(value), /field/);
  }
  for (const [key, value] of Object.entries({ environment: 'production', owner: 'Student', location: 'West Europe',
    studentContext: 'person@example.com', deployApplications: 'false', maxReplicas: 0, poolSize: 9,
    schedulerHeadroom: 0, rolloutSurge: 0, maxConnections: 51, reservedConnections: 14,
    otherConnections: -1, ttlHours: 25 })) assert.throws(() => validateConfig({ ...fixture, [key]: value }));
  assert.throws(() => validateConfig({ ...fixture, poolSize: 2.5 }), /poolSize/);
  assert.throws(() => validateConfig({ ...fixture, owner: undefined }), /owner/);
  assert.throws(() => validateConfig({ ...fixture, location: 12 }), /location/);
  assert.throws(() => validateConfig({ ...fixture, studentContext: null }), /context/);
});

test('runtime requires all image digests and never accepts tags, credentials or URL schemes', () => {
  for (const key of ['backendImage', 'workerImage', 'frontendImage']) {
    for (const value of ['', null, 'ghcr.io/student/image:latest', 'https://ghcr.io/student/image@sha256:' + 'a'.repeat(64),
      'user:password@ghcr.io/image', 'ghcr.io/student/image@sha256:short']) assert.throws(() => validateConfig({ ...apps, [key]: value }), /image/);
  }
  assert.throws(() => validateConfig({ ...fixture, backendImage: 'ghcr.io/image:latest' }), /image/);
});

test('secure values come only from private environment and public parameters agree with configuration', () => {
  const payload = parameters(fixture, env, now).parameters;
  assert.equal(payload.expiresAt.value, '2026-10-12T20:00:00.000Z');
  assert.equal(payload.poolSize.value, fixture.poolSize);
  assert.equal(payload.workerServiceToken.value, '');
  assert.equal(payload.databasePassword.value, env.RH_DB_PASSWORD);
  assert.equal(parameters(apps, env, now).parameters.workerServiceToken.value, env.RH_WORKER_SERVICE_TOKEN);
  assert.ok(parameters(fixture, env).parameters.expiresAt.value);
  for (const value of [undefined, null, 123, 'short', ' a'.repeat(20), 'a'.repeat(129), 'a'.repeat(35) + '\n', 'a'.repeat(35) + '\0']) {
    assert.throws(() => parameters(fixture, { ...env, RH_DB_PASSWORD: value }, now), /RH_DB_PASSWORD/);
  }
  for (const key of ['RH_WORKER_SERVICE_TOKEN', 'RH_METRICS_SCRAPE_TOKEN']) {
    assert.throws(() => parameters(apps, { ...env, [key]: undefined }, now), new RegExp(key));
  }
  assert.throws(() => parameters(apps, { ...env, RH_METRICS_SCRAPE_TOKEN: env.RH_WORKER_SERVICE_TOKEN }, now), /distinct/);
  for (const value of ['a'.repeat(40), 'Aa0!researchhub'.repeat(3)]) {
    assert.throws(() => parameters(fixture, { ...env, RH_DB_PASSWORD: value }, now), /complexity/);
  }
});

test('what-if validates first; secure parameters are private, removed and never present in argv', () => {
  const calls = [];
  let path;
  const execute = args => {
    calls.push(args);
    assert.ok(!args.some(arg => Object.values(env).slice(1).some(secret => arg.includes(secret))));
    if (args[0] === 'bicep') return `Bicep CLI version ${BICEP_VERSION} (test)`;
    path = args[args.indexOf('--parameters') + 1].slice(1);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(fileURLToPath(new URL('.', 'file://' + path))).mode & 0o777, 0o700);
    assert.equal(JSON.parse(readFileSync(path)).parameters.databasePassword.value, env.RH_DB_PASSWORD);
    assert.equal(args[args.indexOf('--subscription') + 1], env.AZURE_SUBSCRIPTION_ID);
    return 'safe-output';
  };
  assert.equal(deploy('what-if', fixture, env, '/path with spaces/main.bicep', execute, now), 'safe-output');
  assert.equal(calls[1][2], 'validate');
  assert.equal(calls[2][2], 'what-if');
  assert.ok(calls[2].includes('ResourceIdOnly'));
  assert.ok(calls[2].includes('/path with spaces/main.bicep'));
  assert.equal(existsSync(path), false);
});

test('deployment emits only outputs; failing ARM calls also clean private parameters', () => {
  const calls = [];
  deploy('deploy', apps, env, 'main.bicep', args => { calls.push(args); return `Bicep CLI version ${BICEP_VERSION} (test)`; }, now);
  assert.equal(calls[2][2], 'create');
  assert.ok(calls[2].includes('properties.outputs'));
  for (const stage of ['validate', 'what-if']) {
    let path;
    assert.throws(() => deploy('what-if', fixture, env, 'main.bicep', args => {
      if (args[0] === 'bicep') return `Bicep CLI version ${BICEP_VERSION} (test)`;
      path = args[args.indexOf('--parameters') + 1].slice(1);
      if (args[2] === stage) throw new Error('provider failure');
      return '';
    }, now), /provider failure/);
    assert.equal(existsSync(path), false);
  }
});

test('preflight failures never invoke a deployment', () => {
  const never = () => assert.fail('executor must not run');
  assert.throws(() => deploy('delete', fixture, env, 'main.bicep', never), /Use/);
  assert.throws(() => deploy('deploy', fixture, {}, 'main.bicep', never), /AZURE_SUBSCRIPTION_ID/);
  assert.throws(() => deploy('deploy', fixture, { ...env, AZURE_SUBSCRIPTION_ID: 'shell;bad' }, 'main.bicep', never), /AZURE/);
  assert.throws(() => deploy('deploy', { ...fixture, maxReplicas: 2 }, env, 'main.bicep', never), /budget/);
  assert.throws(() => deploy('deploy', fixture, env, 'main.bicep', () => 'version 0.1.0'), /Install/);
});
