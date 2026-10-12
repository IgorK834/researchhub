import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { context, guardGroup, expiredGroups, control, params, identity, digest, publicPlan, privateJson, latestMigration } from '../control.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const config=JSON.parse(readFileSync(join(root,'infra/azure/environments/staging.json')));
const subscription='11111111-2222-3333-4444-555555555555',sha='a'.repeat(40),hash='sha256:'+'b'.repeat(64);
const env={ENVIRONMENT:'staging',AZ_SUBSCRIPTION_ID:subscription,AZ_RESOURCE_GROUP:'rg-rh-staging-test',ALERT_EMAIL:'observer@example.test',STAGING_CLIENT_CIDR:'192.0.2.1/32'};
const now=new Date('2026-10-12T12:00:00Z');
function setup(t){const temp=mkdtempSync(join(tmpdir(),'rh-staging-test-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));return context({...env,STAGING_PRIVATE_DIR:join(temp,'private'),STAGING_RESULTS_DIR:join(temp,'results')},config,root,now);}
const group=c=>({name:c.group,id:`/subscriptions/${c.subscription}/resourceGroups/${c.group}`,tags:{project:'researchhub',environment:'staging',owner:c.owner,purpose:'ephemeral-validation','managed-by':'bicep',ttl:'2026-10-12T10:00:00Z'}});
const state={sha,migration:latestMigration(root),metricsToken:'private-token',outputs:{frontendUrl:'https://staging.example.test'}};
test('explicit staging inputs, cost, capacity and private-artifact boundaries fail closed',()=>{
 assert.equal(context(env,config,root,now).ttl,'2026-10-12T20:00:00.000Z');assert.ok(context(env,config,root).now instanceof Date);
 for(const change of [{ENVIRONMENT:'production'},{ENVIRONMENT:undefined},{AZ_SUBSCRIPTION_ID:'bad'},{AZ_RESOURCE_GROUP:'rg-rh-production'},{AZ_RESOURCE_GROUP:'rg-rh-staging-prod-test'},{STAGING_OWNER:'person@example.com'},
 {STAGING_PRIVATE_DIR:'/tmp/a',STAGING_RESULTS_DIR:'/tmp/a'},{STAGING_PRIVATE_DIR:'/tmp/a/private',STAGING_RESULTS_DIR:'/tmp/a'},{STAGING_PRIVATE_DIR:'/tmp/a',STAGING_RESULTS_DIR:'/tmp/a/results'}])assert.throws(()=>context({...env,...change},config,root));
 for(const change of [{ttlHours:0},{ttlHours:25},{billingCurrency:'EUR'},{poolSize:8},{maxReplicas:3},{budgetAlertsUsd:[5,10]},{budgetAlertsUsd:[10,5,20]},{budgetAlertsUsd:[5,10,30]},{p95Milliseconds:0}])assert.throws(()=>context(env,{...config,...change},root));
});
test('ownership guard rejects production tags, foreign subscriptions and missing management tags',t=>{
 const c=setup(t);assert.equal(guardGroup(c,group(c)).name,c.group);
 for(const change of [{name:'rg-rh-prod'},{id:'/subscriptions/other/resourceGroups/test'},{tags:{}},{tags:{...group(c).tags,environment:'production'}},{tags:{...group(c).tags,owner:'other'}}])assert.throws(()=>guardGroup(c,{...group(c),...change}),/guard/);
 assert.throws(()=>guardGroup(c,{name:c.group}),/guard/);
 const groups=[group(c),{...group(c),tags:{...group(c).tags,ttl:'2099-01-01'}},{...group(c),tags:{...group(c).tags,ttl:'invalid'}},{name:'prod',tags:{...group(c).tags}}];
 assert.equal(expiredGroups(groups,now).length,1);assert.deepEqual(expiredGroups([{}],now),[]);
});
test('identity is pinned to completed runtime and exact migration',()=>{
 const info={deployment:{commit:sha,imageDigest:hash,flywayVersion:'44',instanceId:'replica-1',buildTime:now.toISOString()}};
 assert.equal(identity(info,sha,hash,'44').commit,sha);assert.throws(()=>identity({},sha,hash,'44'));
 for(const key of ['commit','imageDigest','flywayVersion','instanceId','buildTime'])assert.throws(()=>identity({deployment:{...info.deployment,[key]:''}},sha,hash,'44'));
 assert.equal(digest(hash),hash);assert.throws(()=>digest('latest'));
});
test('dry run plans do not require cloud credentials or execute Azure',t=>{
 const c=setup(t);for(const name of ['deploy-staging','seed-staging','run-smoke','run-load-test','collect-results','destroy-staging','ttl-check'])assert.ok(publicPlan(name,c).length);
 assert.throws(()=>publicPlan('production',c));
 const payload=params(c,{...state,databasePassword:'private-password',workerToken:'private-worker',metricsToken:'private-metrics'});
 assert.equal(payload.parameters.environment.value,'staging');assert.equal(payload.parameters.replicas.value,1);assert.equal(payload.parameters.deployApplications.value,false);
});
test('deploy validates, pushes SHA tags, migrates on one replica and only then scales to two',async t=>{
 const c=setup(t),calls=[],phases=[];let migrated=false;
 const outputs={registryName:'acrrhstaging',registryServer:'acrrhstaging.azurecr.io',frontendUrl:'https://staging.example.test'};
 const run=(program,args)=>{
 calls.push([program,args]);if(program==='git')return args[0]==='status'?'':sha;
 if(program==='docker'){assert.ok(!args.includes('latest'));return '';}
 if(args[0]==='rest')return JSON.stringify({properties:{columns:[{name:'Currency'}],rows:[['USD']]}});
 if(args[0]==='group'&&args[1]==='exists')return 'false';
 if(args[0]==='deployment'&&args[2]==='create'){
  const payload=JSON.parse(readFileSync(args[args.indexOf('--parameters')+1].slice(1))).parameters;
  phases.push({apps:payload.deployApplications.value,replicas:payload.replicas.value});
  if(payload.replicas.value===2)assert.equal(migrated,true);
  return JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,{value:v}])));
 }
 if(args[0]==='acr'&&args[1]==='repository')return hash;
 if(args[0]==='resource'&&args[1]==='list')return JSON.stringify([{id:'test',tags:{}},{id:'untaggable'}]);return '';
 };
 const result=await control('deploy-staging',c,run,{waitInfo:async s=>{migrated=true;return {deployment:{commit:s.sha,imageDigest:s.digests.backend,flywayVersion:s.migration,instanceId:'replica-1',buildTime:now.toISOString()}};}});
 assert.equal(result.environment,'staging');assert.deepEqual(phases,[{apps:false,replicas:1},{apps:true,replicas:1},{apps:true,replicas:2}]);
 assert.ok(existsSync(join(c.results,'deployment.json')));assert.equal(calls.filter(([p,a])=>p==='docker'&&a[0]==='push').length,3);
 assert.ok(calls.filter(([p])=>p==='az').every(([,a])=>a.includes(subscription)));
});
test('deployment preflight and wrong ownership never create or delete infrastructure',async t=>{
 const c=setup(t);
 await assert.rejects(control('deploy-staging',{...c,env:{...c.env,ALERT_EMAIL:''}},()=>assert.fail(),{}),/ALERT_EMAIL/);
 await assert.rejects(control('deploy-staging',{...c,env:{...c.env,STAGING_CLIENT_CIDR:'0.0.0.0/0'}},()=>assert.fail(),{}),/CIDR/);
 await assert.rejects(control('deploy-staging',c,()=> 'modified-file',{}),/clean/);
 await assert.rejects(control('deploy-staging',c,(p,a)=>p==='git'?(a[0]==='status'?'':'not-a-sha'):'',{}),/Git commit/);
 await assert.rejects(control('deploy-staging',c,(p,a)=>p==='git'?(a[0]==='status'?'':sha):a[0]==='rest'?JSON.stringify({properties:{columns:[{name:'Currency'}],rows:[['USD']]}}):a[1]==='exists'?'true':JSON.stringify({...group(c),tags:{environment:'production'}}),{}),/guard/);
 await assert.rejects(control('deploy-staging',c,(p,a)=>p==='git'?(a[0]==='status'?'':sha):JSON.stringify({properties:{columns:[{name:'Currency'}],rows:[['EUR']]}}),{}),/currency/);
});
test('destroy verifies live staging ownership before delete, then checks completion',async t=>{
 const c=setup(t),calls=[];
 const run=(_p,a)=>{calls.push(a);return a[1]==='show'?JSON.stringify(group(c)):a[1]==='exists'?'false':'';};
 assert.equal((await control('destroy-staging',c,run,{})).deleted,c.group);assert.equal(calls[0][1],'show');assert.equal(calls[1][1],'delete');
 await assert.rejects(control('destroy-staging',c,(_p,a)=>a[1]==='show'?JSON.stringify(group(c)):'true',{}),/did not finish/);
 let deleted=false;await assert.rejects(control('destroy-staging',c,(_p,a)=>{if(a[1]==='delete')deleted=true;return JSON.stringify({...group(c),tags:{...group(c).tags,environment:'production'}});},{}),/guard/);assert.equal(deleted,false);
});
test('TTL detects expiry, does not delete by default and rechecks ownership for automatic cleanup',async t=>{
 const c=setup(t);let deletes=0;
 const run=(_p,a)=>a[1]==='list'?JSON.stringify([group(c)]):a[1]==='show'?JSON.stringify(group(c)):a[1]==='delete'?(deletes++,''):'';
 await assert.rejects(control('ttl-check',c,run,{}),/Expired/);assert.equal(deletes,0);
 await assert.rejects(control('ttl-check',{...c,env:{...c.env,AUTO_DESTROY:'true'}},run,{}),/Expired/);assert.equal(deletes,1);
 assert.equal((await control('ttl-check',c,()=> '[]',{})).expired,0);
 await assert.rejects(control('ttl-check',c,()=>JSON.stringify([{...group(c),tags:{...group(c).tags,ttl:'invalid'}}]),{}),/invalid TTL/);
});
test('seeding always disables registration on failure; smoke/load/collection retain evidence',async t=>{
 const c=setup(t);privateJson(join(c.privateDir,'state.json'),state);let closed=false;
 const run=(_p,a)=>a[1]==='show'?JSON.stringify(group(c)):(a.includes('REGISTRATION_MODE=disabled')&&(closed=true),'');
 await assert.rejects(control('seed-staging',c,run,{seed:async()=>{throw Error('fixture failed');}}),/fixture/);assert.equal(closed,true);
 await control('seed-staging',c,run,{seed:async()=>({synthetic:true})});
 assert.equal((await control('run-smoke',c,run,{smoke:async()=>({passed:true})})).passed,true);
 assert.equal((await control('run-load-test',c,run,{})).load,'bounded');
 assert.equal(await control('collect-results',c,run,{collect:async()=>true}),true);
 await assert.rejects(control('unknown',c,run,{}),/Unknown/);
});
