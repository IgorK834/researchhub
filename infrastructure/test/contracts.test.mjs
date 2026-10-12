import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const binary = process.env.BICEP_BIN;
const compile = file => JSON.parse(execFileSync(binary || 'az', binary
  ? ['build', `${root}infrastructure/${file}`, '--stdout']
  : ['bicep', 'build', '--file', `${root}infrastructure/${file}`, '--stdout'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
const main = compile('main.bicep');
const foundation = compile('modules/foundation.bicep');
const apps = compile('modules/applications.bicep');
const resource = (template, type, name) => Object.values(template.resources).find(item => item.type === type && (!name || item.name === name));

test('compiled foundation has no broad or deferred infrastructure and private managed database', () => {
  assert.equal(main.parameters.environment.allowedValues.join(), 'dev');
  assert.equal(main.parameters.deployApplications.defaultValue, false);
  for (const param of ['databasePassword', 'workerServiceToken', 'metricsScrapeToken']) assert.equal(main.parameters[param].type.toLowerCase(), 'securestring');
  const db = resource(foundation, 'Microsoft.DBforPostgreSQL/flexibleServers');
  assert.equal(db.properties.network.publicNetworkAccess, 'Disabled');
  assert.equal(db.sku.name, 'Standard_B1ms');
  assert.equal(db.properties.version, '17');
  assert.equal(db.properties.highAvailability.mode, 'Disabled');
  assert.equal(db.properties.backup.backupRetentionDays, 7);
  assert.equal(resource(foundation, 'Microsoft.DBforPostgreSQL/flexibleServers/configurations').properties.value, 'VECTOR');
  const forbidden = /Search|CognitiveServices|ServiceBus|KeyVault|sessionPools|\/jobs|managedClusters|insights\/components/i;
  for (const template of [foundation, apps]) assert.ok(Object.values(template.resources).every(item => !forbidden.test(item.type)));
});

test('compiled blob/log contracts cap exposure and separate credentials from outputs', () => {
  const storage = resource(foundation, 'Microsoft.Storage/storageAccounts');
  assert.equal(storage.properties.allowBlobPublicAccess, false);
  assert.equal(storage.properties.supportsHttpsTrafficOnly, true);
  assert.equal(storage.sku.name, 'Standard_LRS');
  const blobs = resource(foundation, 'Microsoft.Storage/storageAccounts/blobServices');
  assert.equal(blobs.properties.deleteRetentionPolicy.enabled, false);
  assert.equal(blobs.properties.isVersioningEnabled, false);
  assert.equal(resource(foundation, 'Microsoft.Storage/storageAccounts/blobServices/containers').properties.publicAccess, 'None');
  const logs = resource(foundation, 'Microsoft.OperationalInsights/workspaces');
  assert.equal(logs.properties.retentionInDays, 30);
  assert.equal(logs.properties.workspaceCapping.dailyQuotaGb, "[json('0.1')]");
  for (const template of [main, foundation, apps]) assert.doesNotMatch(JSON.stringify(template.outputs), /listKeys|Password|Token|secret/i);
});

test('compiled ingress and secrets preserve server authority and unsupported feature boundary', () => {
  const backend = resource(apps, 'Microsoft.App/containerApps', 'ca-rh-backend');
  const worker = resource(apps, 'Microsoft.App/containerApps', 'ca-rh-worker');
  const edge = resource(apps, 'Microsoft.App/containerApps', 'ca-rh-frontend');
  for (const app of [backend, worker]) {
    assert.equal(app.properties.configuration.ingress.external, false);
    assert.equal(app.properties.configuration.ingress.allowInsecure, false);
    assert.equal(app.properties.template.scale.minReplicas, 1);
  }
  assert.equal(edge.properties.configuration.ingress.external, true);
  assert.equal(edge.properties.template.scale.minReplicas, 0);
  assert.equal(edge.properties.configuration.secrets, undefined);
  const variables = Object.fromEntries(backend.properties.template.containers[0].env.map(item => [item.name, item]));
  for (const name of ['DB_PASSWORD', 'BLOB_CONNECTION_STRING', 'AI_WORKER_SERVICE_TOKEN', 'METRICS_SCRAPE_TOKEN']) assert.ok(variables[name].secretRef);
  for (const name of ['COLLABORATION_ENABLED', 'ANALYSIS_SANDBOX_ENABLED']) assert.equal(variables[name].value, 'false');
  assert.equal(variables.SPRING_PROFILES_ACTIVE.value, 'azure');
  assert.equal(variables.REGISTRATION_MODE.value, 'disabled');
  assert.match(variables.CORS_ALLOWED_ORIGINS.value, /https:\/\/ca-rh-frontend\./);
  assert.doesNotMatch(variables.CORS_ALLOWED_ORIGINS.value, /\*/);
  assert.match(variables.DB_URL.value, /sslmode=verify-full/);
  assert.match(variables.DB_URL.value, /sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory/);
  assert.match(variables.DB_POOL_MAX_SIZE.value, /poolSize/);
  assert.ok(!backend.properties.template.containers[0].env.some(item => /GEMINI|FOUNDRY|OPENAI|DOCKER/.test(item.name)));
  const caddy = readFileSync(`${root}frontend/docker/Caddyfile`, 'utf8');
  assert.doesNotMatch(caddy, /handle \/internal|handle \/collaboration/);
  const dockerfile = readFileSync(`${root}frontend/Dockerfile`, 'utf8');
  assert.match(dockerfile, /FROM caddy:2\.11\./); // HTTPS upstream Host rewriting is required for ACA routing.
});

test('cloud profiles keep Flyway, schema validation and shared durable state', () => {
  assert.match(readFileSync(`${root}backend/src/main/resources/application.yaml`, 'utf8'), /cloud: \[azure\]/);
  for (const name of ['azure']) {
    const profile = readFileSync(`${root}backend/src/main/resources/application-${name}.yaml`, 'utf8');
    assert.match(profile, /session-store: jdbc/);
    assert.match(profile, /store: postgres/);
    assert.match(profile, /flyway:\s+enabled: true/);
    assert.match(profile, /ddl-auto: validate/);
    assert.match(profile, /create-container: false/);
  }
});

test('ADRs have explicit status and trigger, unique IDs and portfolio links', () => {
  const ids = readdirSync(`${root}docs/adr`).filter(file => /^ADR-\d+.*\.md$/.test(file)).map(file => file.match(/^ADR-\d+/)[0]);
  assert.equal(new Set(ids).size, ids.length);
  const files = ['ADR-010-deployment-topology.md', 'ADR-013-collaboration-scale-out.md',
    'ADR-014-retention-and-erasure.md', 'ADR-015-azure-sandbox-runner.md'];
  for (const file of files) {
    const text = readFileSync(`${root}docs/adr/${file}`, 'utf8');
    assert.match(text, /Status: (Accepted|Proposed)/);
    assert.match(text, /Implementation trigger:/);
    for (const entry of ['README.md', 'docs/case-study.md']) assert.ok(readFileSync(`${root}${entry}`, 'utf8').includes(file));
  }
});
