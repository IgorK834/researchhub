import { mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const ruleNames = ['http-5xx', 'http-p95', 'connection-pressure', 'connection-waiters', 'connection-timeouts', 'processing-failures', 'ai-unavailable'];
export const requiredMetrics = ['hikaricp_connections_active', 'hikaricp_connections_max', 'hikaricp_connections_pending',
  'hikaricp_connections_timeout', 'researchhub_worker_failures', 'researchhub_jobs_queue', 'researchhub_ai_provider_unavailable', 'researchhub_ai_request_duration'];
export function context(env, config, root, now = new Date()) {
  if (env.ENVIRONMENT !== 'staging') throw new Error('Only ENVIRONMENT=staging is permitted');
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(env.AZ_SUBSCRIPTION_ID ?? '')) throw new Error('Invalid explicit AZ_SUBSCRIPTION_ID');
  if (!/^rg-rh-staging-[a-z0-9-]{2,24}$/.test(env.AZ_RESOURCE_GROUP ?? '') || /prod/i.test(env.AZ_RESOURCE_GROUP)) throw new Error('Refuse non-staging or production resource group');
  const owner = env.STAGING_OWNER || config.owner;
  if (!/^[a-z0-9-]{2,32}$/.test(owner)) throw new Error('Invalid owner alias');
  if (!Number.isInteger(config.ttlHours) || config.ttlHours < 1 || config.ttlHours > 24) throw new Error('TTL must be 1–24 hours');
  if (config.billingCurrency !== 'USD') throw new Error('Budget amounts require a USD billing subscription');
  if (config.maxReplicas !== 2 || config.poolSize !== 5 || 4 * (config.poolSize + 2) > 28) throw new Error('Staging rollout connection budget exceeded');
  if (!Array.isArray(config.budgetAlertsUsd) || config.budgetAlertsUsd.length !== 3
    || config.budgetAlertsUsd.some((n,i,a) => !Number.isInteger(n) || n <= 0 || n > 100 || i && n <= a[i-1])) throw new Error('Supply three ascending budget amounts');
  if(config.budgetAlertsUsd.slice(0,2).some(n=>100*n % config.budgetAlertsUsd[2]!==0))throw new Error('Budget thresholds must resolve to whole Azure percentage points');
  for (const name of ['p95Milliseconds', 'errorPercent', 'minimumRequests']) if (!Number.isInteger(config[name]) || config[name] <= 0) throw new Error(`Invalid ${name}`);
  const results=resolve(env.STAGING_RESULTS_DIR || join(root,'.demo/azure/staging/results'));
  const privateDir=resolve(env.STAGING_PRIVATE_DIR || join(root,'.demo/azure/staging/private'));
  if(results===privateDir||privateDir.startsWith(results+'/')||results.startsWith(privateDir+'/'))throw new Error('Private credentials must be outside evidence artifacts');
  return { env, config, root, subscription: env.AZ_SUBSCRIPTION_ID, group: env.AZ_RESOURCE_GROUP, owner,
    results, privateDir,
    now, ttl: new Date(now.getTime() + config.ttlHours * 3600000).toISOString() };
}
export function guardGroup(c, group) {
  const tags = group.tags || {};
  if (!/^rg-rh-staging-[a-z0-9-]{2,24}$/.test(group.name || '') || /prod/i.test(group.name || '') || group.name !== c.group || group.id?.split('/')[2]?.toLowerCase() !== c.subscription.toLowerCase()
    || tags.project !== 'researchhub' || tags.environment !== 'staging' || tags['managed-by'] !== 'bicep'
    || tags.purpose !== 'ephemeral-validation' || tags.owner !== c.owner || !/^[a-z0-9-]{2,32}$/.test(tags.owner || '')) throw new Error('Resource group ownership/production guard rejected operation');
  return group;
}
export function expiredGroups(groups, now) {
  return groups.filter(group => {
    const t = group.tags || {};
    return t.project === 'researchhub' && t.environment === 'staging' && t['managed-by'] === 'bicep'
      && t.purpose === 'ephemeral-validation' && /^rg-rh-staging-[a-z0-9-]{2,24}$/.test(group.name || '') && !/prod/i.test(group.name)
      && Number.isFinite(Date.parse(t.ttl)) && Date.parse(t.ttl) < now.getTime();
  });
}
export function privateJson(file, value) {
  mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 });
  chmodSync(resolve(file, '..'), 0o700); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); chmodSync(file, 0o600);
}
export function evidence(c, name, value) { mkdirSync(c.results, { recursive: true }); writeFileSync(join(c.results, name), JSON.stringify(value, null, 2) + '\n'); }
export function latestMigration(root) {
  const versions = readdirSync(join(root, 'backend/src/main/resources/db/migration')).map(name => /^V(\d+)__/.exec(name)).filter(Boolean).map(m => Number(m[1]));
  return String(Math.max(...versions));
}
export function digest(value) { if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('Invalid immutable image digest'); return value; }
export function identity(info, sha, image, migration) {
  const d = info.deployment;
  if (!d || d.commit !== sha || d.imageDigest !== image || d.flywayVersion !== migration || !d.instanceId || !Number.isFinite(Date.parse(d.buildTime))) throw new Error('Running instance identity/migration disagrees with deployment');
  return d;
}
export function params(c, state, options = {}) {
  const start = new Date(Date.UTC(c.now.getUTCFullYear(), c.now.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(c.now.getUTCFullYear() + 1, c.now.getUTCMonth(), 1)).toISOString();
  const values = { environment: 'staging', location: c.config.location, owner: c.owner, ttl: c.ttl,
    commit: state.sha, migrationVersion: state.migration, timestamp: c.now.toISOString(), alertEmail: c.env.ALERT_EMAIL,
    clientCidr: c.env.STAGING_CLIENT_CIDR, budgetStart: start, budgetEnd: end,
    budgetAlertsUsd: c.config.budgetAlertsUsd, p95Milliseconds: c.config.p95Milliseconds,
    errorPercent: c.config.errorPercent, minimumRequests: c.config.minimumRequests,
    databasePassword: state.databasePassword, workerToken: state.workerToken, metricsToken: state.metricsToken,
    backendDigest: state.digests?.backend || '', workerDigest: state.digests?.worker || '', frontendDigest: state.digests?.frontend || '',
    ...Object.fromEntries(['backend','worker','frontend'].map(name => [name+'Image', state.digests?.[name] ? `${state.outputs.registryServer}/${name}@${state.digests[name]}` : ''])),
    deployApplications: Boolean(state.digests), registrationMode: 'disabled', replicas: 1, poolSize: c.config.poolSize, ...options };
  return { '$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#', contentVersion: '1.0.0.0',
    parameters: Object.fromEntries(Object.entries(values).map(([name,value]) => [name,{value}])) };
}
export function publicPlan(action, c) {
  const scope = `--subscription ${c.subscription} --resource-group ${c.group}`;
  const groupScope = `--subscription ${c.subscription} --name ${c.group}`;
  const plans = {
    'deploy-staging': [`az group show ${groupScope} (ownership check; group create only if absent)`, `az bicep build --file infra/azure/main.bicep`,
      `az deployment group validate ${scope} --parameters @PRIVATE_TEMP_FILE`, `az deployment group what-if ${scope} --parameters @PRIVATE_TEMP_FILE --result-format ResourceIdOnly`,
      `az deployment group create ${scope} --parameters @PRIVATE_TEMP_FILE`, 'az acr login --name ACR_NAME',
      'docker build --platform linux/amd64 --build-arg BUILD_COMMIT=COMMIT_SHA -t ACR/backend:COMMIT_SHA backend',
      'docker push ACR/{backend,worker,frontend}:COMMIT_SHA; az acr repository show (resolve digests)',
      `az deployment group create ${scope} (one replica; Flyway on startup)`, 'GET /actuator/info with private bearer token; verify commit/digest/migration',
      `az resource tag ${scope} (deployment SHA/digests/migration/timestamp)`],
    'seed-staging': [`az group show ${groupScope} (guard)`, `az containerapp update ${scope} --name ca-rh-backend --set-env-vars REGISTRATION_MODE=open (CIDR-restricted window)`,
      'Synthetic REST accounts/workspace/source seed; private generated credentials', `az containerapp update ${scope} --name ca-rh-backend --set-env-vars REGISTRATION_MODE=disabled (finally)`],
    'run-smoke': ['HTTPS landing/login/CSRF; one authenticated session on two replicas; workspace/upload/processing/retrieval; deterministic source analysis; blob hash; foreign-workspace denial; sandbox remains unavailable'],
    'run-load-test': ['k6 run --duration 2m --vus 5 --summary-export RESULTS/load-summary.json scripts/azure/staging-load.js'],
    'collect-results': ['az monitor app-insights query (every alert query + telemetry presence)', 'az monitor metrics list (backend and PostgreSQL)',
      'az monitor log-analytics query (redacted structured metadata)', 'az resource update (enable alerts only after every source returns staging data)'],
    'destroy-staging': [`az group show ${groupScope} (refuse production/unowned group)`, `az group delete ${groupScope} --yes`, `az group exists ${groupScope}`],
    'ttl-check': [`az group list --subscription ${c.subscription}`, 'Report expired staging groups; fail/notify; deletion only if AUTO_DESTROY=true, with ownership guard per group'] };
  if (!plans[action]) throw new Error('Unknown staging action'); return plans[action];
}
export async function control(action, c, run, services) {
  const az = (...args) => run('az', [...args, '--subscription', c.subscription], true);
  const group = () => guardGroup(c, JSON.parse(az('group', 'show', '--name', c.group, '--output', 'json')));
  const scope = ['--resource-group', c.group];
  const stateFile = join(c.privateDir, 'state.json');
  let state;
  if (action !== 'ttl-check' && action !== 'destroy-staging' && action !== 'deploy-staging') { group(); state = JSON.parse(readFileSync(stateFile)); }
  if (action === 'deploy-staging') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.env.ALERT_EMAIL || '')) throw new Error('Set action group ALERT_EMAIL');
    const cidr = c.env.STAGING_CLIENT_CIDR || '';
    if (!/^(\d{1,3}\.){3}\d{1,3}\/(2[4-9]|3[0-2])$/.test(cidr) || cidr.split('/')[0].split('.').some(n => Number(n) > 255)) throw new Error('Set a restricted STAGING_CLIENT_CIDR (/24–/32)');
    if (run('git', ['status','--porcelain']).trim()) throw new Error('Deploy only a clean committed checkout');
    const sha = run('git', ['rev-parse','HEAD']).trim(); if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid Git commit');
    const billing=JSON.parse(az('rest','--method','post','--uri',`https://management.azure.com/subscriptions/${c.subscription}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`,
      '--body',JSON.stringify({type:'ActualCost',timeframe:'MonthToDate',dataset:{granularity:'None',aggregation:{totalCost:{name:'PreTaxCost',function:'Sum'}}}})));
    const currencyIndex=billing.properties?.columns?.findIndex(column=>column.name==='Currency');
    const currencies=new Set((billing.properties?.rows||[]).map(row=>row[currencyIndex]));
    if(currencies.size!==1||!currencies.has('USD'))throw new Error('Cannot verify USD billing currency; refuse ambiguously denominated budget');
    state = { sha, migration: latestMigration(c.root), databasePassword: 'Rh0!'+randomBytes(32).toString('hex'),
      workerToken: randomBytes(32).toString('hex'), metricsToken: randomBytes(32).toString('hex') };
    privateJson(stateFile, state);
    const exists = az('group','exists','--name',c.group).trim() === 'true';
    if (exists) group();
    else az('group','create','--name',c.group,'--location',c.config.location,'--tags',
      'project=researchhub','environment=staging',`owner=${c.owner}`,'purpose=ephemeral-validation','managed-by=bicep',`ttl=${c.ttl}`,'--output','none');
    az('group','update','--name',c.group,'--set',`tags.ttl=${c.ttl}`,'--output','none');
    const file = join(c.privateDir, 'deployment.parameters.json');
    const deploy = options => {
      privateJson(file, params(c,state,options));
      const common = ['deployment','group',...scope,'--name','researchhub-staging','--template-file',join(c.root,'infra/azure/main.bicep'),'--parameters','@'+file];
      az(...common.slice(0,2),'validate',...common.slice(2),'--output','none');
      az(...common.slice(0,2),'what-if',...common.slice(2),'--result-format','ResourceIdOnly','--no-pretty-print');
      const response=JSON.parse(az(...common.slice(0,2),'create',...common.slice(2),'--query','properties.outputs','--output','json'));
      state.outputs=Object.fromEntries(Object.entries(response).map(([key,value])=>[key,value.value])); privateJson(stateFile,state);
    };
    deploy({deployApplications:false});
    az('acr','login','--name',state.outputs.registryName);
    state.digests={};
    for (const [name,directory] of [['backend','backend'],['worker','ai-worker'],['frontend','.']]) {
      const image=`${state.outputs.registryServer}/${name}:${sha}`;
      run('docker',['build','--platform','linux/amd64','--label',`org.opencontainers.image.revision=${sha}`,'--build-arg',`BUILD_COMMIT=${sha}`,...(name==='frontend'?['-f','frontend/Dockerfile']:[]),'-t',image,directory]);
      run('docker',['push',image]);
      state.digests[name]=digest(az('acr','repository','show','--name',state.outputs.registryName,'--image',`${name}:${sha}`,'--query','digest','--output','tsv').trim());
    }
    deploy({replicas:1});
    const info=await services.waitInfo(state);
    identity(info,state.sha,state.digests.backend,state.migration); // Flyway is verified before scale-out.
    deploy({replicas:2});
    const manifest={sha,imageDigests:state.digests,migrationVersion:info.deployment.flywayVersion,environment:'staging',timestamp:c.now.toISOString(),
      resourceGroup:c.group,subscription:c.subscription,outputs:state.outputs,ttl:c.ttl};
    evidence(c,'deployment.json',manifest);
    az('group','update','--name',c.group,'--set',`tags.commit=${sha}`,`tags.migration=${manifest.migrationVersion}`,`tags.deployment-at=${manifest.timestamp}`,
      `tags.image-backend=${state.digests.backend}`,`tags.image-worker=${state.digests.worker}`,`tags.image-frontend=${state.digests.frontend}`,'--output','none');
    const resources=JSON.parse(az('resource','list',...scope,'--output','json'));
    for(const resource of resources) if(resource.tags) az('resource','tag','--ids',resource.id,'--is-incremental','--tags',
      `commit=${sha}`,`image-backend=${state.digests.backend}`,`image-worker=${state.digests.worker}`,`image-frontend=${state.digests.frontend}`,`migration=${manifest.migrationVersion}`,`deployment-at=${manifest.timestamp}`,'--output','none');
    return manifest;
  }
  if (action === 'destroy-staging') { group(); az('group','delete','--name',c.group,'--yes');
    if(az('group','exists','--name',c.group).trim()!=='false')throw new Error('Staging deletion did not finish');
    az('consumption','budget','delete','--budget-name',`researchhub-staging-${c.group}`);return {deleted:c.group}; }
  if (action === 'ttl-check') {
    const groups=JSON.parse(az('group','list','--output','json'));
    const invalid=groups.filter(g=>/^rg-rh-staging-[a-z0-9-]{2,24}$/.test(g.name||'')&&g.tags?.project==='researchhub'&&g.tags?.environment==='staging'&&g.tags?.['managed-by']==='bicep'&&!Number.isFinite(Date.parse(g.tags?.ttl)));
    if(invalid.length){evidence(c,'invalid-ttl-groups.json',invalid.map(g=>({name:g.name})));throw new Error('Missing or invalid TTL tags require operator attention');}
    const expired=expiredGroups(groups,c.now);
    evidence(c,'expired-groups.json',expired.map(g=>({name:g.name,ttl:g.tags.ttl})));
    if(c.env.AUTO_DESTROY==='true') for(const item of expired) {
      const target={...c,group:item.name,owner:item.tags.owner}; guardGroup(target,item);
      guardGroup(target,JSON.parse(az('group','show','--name',item.name,'--output','json')));
      az('group','delete','--name',item.name,'--yes');
      az('consumption','budget','delete','--budget-name',`researchhub-staging-${item.name}`);
    }
    if(expired.length)throw new Error(`Expired staging groups detected: ${expired.map(g=>g.name).join(', ')}`);
    return {expired:0};
  }
  if(action==='seed-staging') {
    try { az('containerapp','update',...scope,'--name','ca-rh-backend','--set-env-vars','REGISTRATION_MODE=open','--output','none');
      const seeded=await services.seed(state); privateJson(join(c.privateDir,'seed.json'),seeded); return {synthetic:true};
    } finally { az('containerapp','update',...scope,'--name','ca-rh-backend','--set-env-vars','REGISTRATION_MODE=disabled','--output','none'); }
  }
  if(action==='run-smoke') { const result=await services.smoke(state,JSON.parse(readFileSync(join(c.privateDir,'seed.json')))); evidence(c,'smoke.json',result);return result; }
  if(action==='run-load-test') { run('k6',['run','--duration','2m','--vus','5','--summary-export',join(c.results,'load-summary.json'),join(c.root,'scripts/azure/staging-load.js')]); return {load:'bounded'}; }
  if(action==='collect-results') return services.collect(state,az);
  throw new Error('Unknown staging action');
}
