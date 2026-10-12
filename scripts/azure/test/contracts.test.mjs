import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=process.env.BICEP_BIN;
const compile=file=>JSON.parse(execFileSync(binary||'az',binary?['build',join(root,'infra/azure',file),'--stdout']:['bicep','build','--file',join(root,'infra/azure',file),'--stdout'],{encoding:'utf8',maxBuffer:16*1024*1024}));
const resources=t=>Object.values(t.resources||{});
const main=compile('main.bicep'),monitoring=compile('modules/monitoring.bicep'),budget=compile('modules/budget.bicep'),dashboard=compile('modules/dashboard.bicep');
test('emitted staging ARM enforces staging, single action group, signal names and disabled-before-validation alerts',()=>{
 assert.deepEqual(main.parameters.environment.allowedValues,['staging']);
 assert.equal(main.parameters.poolSize.defaultValue,5);
 assert.equal(resources(monitoring).filter(r=>r.type==='Microsoft.Insights/actionGroups').length,1);
 const rules=resources(monitoring).find(r=>r.type==='Microsoft.Insights/scheduledQueryRules');assert.ok(rules.copy);
 assert.match(JSON.stringify(monitoring.variables),/connection-pressure/);
 assert.match(JSON.stringify(monitoring.variables),/http-5xx/);
 assert.equal(rules.properties.enabled,"[parameters('enabled')]");assert.equal(monitoring.parameters.enabled.defaultValue,false);
 const storage=resources(monitoring).find(r=>r.type==='Microsoft.Insights/metricAlerts');assert.equal(storage.properties.criteria.allOf[0].metricName,'storage_percent');assert.equal(storage.properties.criteria.allOf[0].threshold,80);
 const group=resources(monitoring).find(r=>r.type==='Microsoft.Insights/actionGroups');assert.match(JSON.stringify(group),/alertEmail/);
 assert.equal(resources(monitoring).find(r=>r.type==='Microsoft.Insights/components').properties.RetentionInDays,30);
 const queries=JSON.parse(readFileSync(join(root,'infra/azure/queries/signals.json')));assert.match(queries.p95Latency,/percentile\(todouble\(duration\), 95\)/);assert.doesNotMatch(queries.p95Latency,/1ms/);
 for(const key of ['connectionPressure','connectionWaiters','connectionTimeouts','aiUnavailable'])assert.match(queries[key],/hikaricp_connections|researchhub_ai_provider_unavailable/);
});
test('budget thresholds represent 5/10/20 USD and cover tagged managed resources at subscription scope',()=>{
 assert.deepEqual(budget.parameters.alertAmountsUsd.defaultValue,[5,10,20]);
 const resource=resources(budget)[0];assert.equal(resource.properties.notifications.final.threshold,100);
 assert.equal(resource.properties.filter.tags.name,'validation-group');
 assert.match(budget.$schema,/subscriptionDeploymentTemplate/);
 const dash=resources(dashboard)[0];assert.equal(dash.type,'Microsoft.Portal/dashboards');
 const all=JSON.stringify(dashboard);for(const metric of ['Replicas','UsageNanoCores','WorkingSetBytes','active_connections','cpu_percent','storage_percent'])assert.ok(all.includes(metric));
 assert.ok(all.includes('AI mean latency'));assert.ok(all.includes('Sandbox failures'));
});
test('all shell wrappers fail closed on production and dry run never runs Azure',t=>{
 const temp=mkdtempSync(join(tmpdir(),'rh-shell-test-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const marker=join(temp,'deleted');const group='rg-rh-staging-test',subscription='11111111-2222-3333-4444-555555555555';
 const id=`/subscriptions/${subscription}/resourceGroups/${group}`;
 writeFileSync(join(temp,'az'),`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('delete'))fs.writeFileSync(${JSON.stringify(marker)},'deleted');console.log(JSON.stringify({name:${JSON.stringify(group)},id:${JSON.stringify(id)},tags:{project:'researchhub',environment:'production',owner:'student',purpose:'ephemeral-validation','managed-by':'bicep'}}));`,{mode:0o700});
 const env={...process.env,AZ_SUBSCRIPTION_ID:subscription,AZ_RESOURCE_GROUP:group,ENVIRONMENT:'staging',PATH:temp+':'+process.env.PATH};
 for(const name of ['deploy-staging','seed-staging','run-smoke','run-load-test','collect-results','destroy-staging','ttl-check']){
  const file=join(root,'scripts/azure',name+'.sh');assert.match(readFileSync(file,'utf8'),/^#![^\n]+\nset -euo pipefail/);
  const dry=spawnSync('bash',[file,'--dry-run'],{env,encoding:'utf8'});assert.equal(dry.status,0,dry.stderr);assert.ok(dry.stdout.length);assert.equal(existsSync(marker),false);
  const production=spawnSync('bash',[file,'--dry-run'],{env:{...env,ENVIRONMENT:'production'},encoding:'utf8'});assert.notEqual(production.status,0);
 }
 const destroy=spawnSync('bash',[join(root,'scripts/azure/destroy-staging.sh')],{env,encoding:'utf8'});assert.notEqual(destroy.status,0);assert.equal(existsSync(marker),false);assert.match(destroy.stderr,/guard/);
});
test('manual workflows use OIDC, protected environment and pinned actions; production input guard fails',()=>{
 for(const name of ['azure-staging-deploy','azure-staging-destroy','azure-ttl-check']){
  const text=readFileSync(join(root,'.github/workflows',name+'.yml'),'utf8');
  for(const match of text.matchAll(/uses: ([^\s]+)/g))assert.match(match[1],/@[a-f0-9]{40}$/);
  assert.match(text,/environment: azure-staging/);assert.match(text,/id-token: write/);assert.doesNotMatch(text,/secrets\.|client-secret|creds:/);
  if(name!=='azure-ttl-check'){assert.match(text,/workflow_dispatch:/);assert.doesNotMatch(text,/schedule:|pull_request:|push:/);}
  if(name==='azure-staging-destroy'){
    const block=text.match(/name: Require staging and dedicated group[\s\S]*?run: \|\n([\s\S]*?)      - uses:/)[1];
    const guard=block.split('\n').map(line=>line.trimStart()).join('\n');
    assert.notEqual(spawnSync('bash',['-e','-c',guard],{env:{...process.env,REQUESTED_ENVIRONMENT:'production',AZ_RESOURCE_GROUP:'rg-rh-staging-test'}}).status,0);
  }
 }
});
