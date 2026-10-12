import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fields = new Set(['environment', 'location', 'owner', 'studentContext', 'deployApplications',
  'backendImage', 'workerImage', 'frontendImage', 'maxReplicas', 'poolSize', 'schedulerHeadroom',
  'rolloutSurge', 'maxConnections', 'reservedConnections', 'otherConnections', 'ttlHours']);
export const BICEP_VERSION = '0.48.1';

export function validateConfig(config) {
  if (!config || Array.isArray(config) || typeof config !== 'object'
    || Object.keys(config).some(key => !fields.has(key))) throw new Error('Unknown configuration field');
  if (config.environment !== 'dev') throw new Error('Only disposable dev is implemented');
  if (typeof config.owner !== 'string' || !/^[a-z][a-z0-9-]{1,15}$/.test(config.owner)) throw new Error('owner must be a lowercase alias, 2–16 characters');
  if (typeof config.location !== 'string' || !/^[a-z0-9]+$/.test(config.location)) throw new Error('Invalid location');
  if (typeof config.studentContext !== 'string' || !/^[a-z0-9-]{1,32}$/.test(config.studentContext)) throw new Error('Invalid student context');
  const ranges = { maxReplicas: [1, 2], poolSize: [1, 8], schedulerHeadroom: [2, 10], rolloutSurge: [1, 2],
    maxConnections: [1, 50], reservedConnections: [15, 50], otherConnections: [0, 50], ttlHours: [1, 24] };
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (!Number.isInteger(config[field]) || config[field] < min || config[field] > max) throw new Error(`Invalid ${field}`);
  }
  const connections = (config.maxReplicas + config.rolloutSurge) * (config.poolSize + config.schedulerHeadroom);
  const limit = Math.floor(0.8 * (config.maxConnections - config.reservedConnections - config.otherConnections));
  if (connections > limit) throw new Error('Database connection budget exceeded, including rollout and reserved connections');
  if (typeof config.deployApplications !== 'boolean') throw new Error('deployApplications must be boolean');
  for (const field of ['backendImage', 'workerImage', 'frontendImage']) {
    if (typeof config[field] !== 'string' || (config[field] !== '' || config.deployApplications)
      && !/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9/_.-]+@sha256:[a-f0-9]{64}$/.test(config[field])) {
      throw new Error(`${field} must identify a public image by immutable sha256 digest`);
    }
  }
  return { resourceGroupName: `rg-rh-dev-${config.owner}`, connections, limit };
}

export function parameters(config, env, now = new Date()) {
  validateConfig(config);
  const values = Object.fromEntries(['environment', 'location', 'owner', 'studentContext', 'deployApplications',
    'backendImage', 'workerImage', 'frontendImage', 'maxReplicas', 'poolSize'].map(key => [key, config[key]]));
  values.expiresAt = new Date(now.getTime() + config.ttlHours * 3600000).toISOString();
  for (const [param, variable] of [['databasePassword', 'RH_DB_PASSWORD'],
    ['workerServiceToken', 'RH_WORKER_SERVICE_TOKEN'], ['metricsScrapeToken', 'RH_METRICS_SCRAPE_TOKEN']]) {
    const value = param === 'databasePassword' || config.deployApplications ? env[variable] ?? '' : '';
    if ((param === 'databasePassword' || config.deployApplications) &&
      (typeof value !== 'string' || value.length < 32 || value.length > 128 || value.trim() !== value || /[\r\n\0]/.test(value))) {
      throw new Error(`Missing or invalid ${variable} (32–128 characters)`);
    }
    values[param] = value;
  }
  const password = values.databasePassword;
  if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(pattern => pattern.test(password)).length < 3
    || password.toLowerCase().includes('researchhub')) throw new Error('RH_DB_PASSWORD must meet Azure password complexity and exclude the login');
  if (config.deployApplications && new Set([values.databasePassword, values.workerServiceToken, values.metricsScrapeToken]).size !== 3) {
    throw new Error('Use distinct database, worker and metrics credentials');
  }
  return { '$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0', parameters: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) };
}

// The executor receives argument arrays, never a shell command or credentials in argv.
export function deploy(mode, config, env, template, execute, now = new Date()) {
  if (!['what-if', 'deploy'].includes(mode)) throw new Error('Use validate, what-if or deploy');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.AZURE_SUBSCRIPTION_ID ?? '')) throw new Error('Set AZURE_SUBSCRIPTION_ID explicitly');
  const payload = parameters(config, env, now);
  const version = execute(['bicep', 'version']);
  if (!version.includes(`version ${BICEP_VERSION} `)) throw new Error(`Install Bicep ${BICEP_VERSION}`);
  const directory = mkdtempSync(join(tmpdir(), 'researchhub-azure-'));
  try {
    const file = join(directory, 'deployment.parameters.json');
    writeFileSync(file, JSON.stringify(payload), { mode: 0o600 });
    const common = ['--subscription', env.AZURE_SUBSCRIPTION_ID, '--location', config.location,
      '--name', `researchhub-dev-${config.owner}`, '--template-file', template, '--parameters', `@${file}`];
    // ARM validation runs before a mutating deployment. What-if alone also performs provider validation.
    execute(['deployment', 'sub', 'validate', ...common, '--output', 'none']);
    return execute(['deployment', 'sub', mode === 'deploy' ? 'create' : 'what-if', ...common,
      ...(mode === 'deploy' ? ['--query', 'properties.outputs', '--output', 'json']
        : ['--result-format', 'ResourceIdOnly', '--no-pretty-print'])]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
