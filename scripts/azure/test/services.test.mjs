import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { context, requiredMetrics } from '../control.mjs';
import { Client, waitFor, services, rows, populatedPlatform } from '../services.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),config=JSON.parse(readFileSync(join(root,'infra/azure/environments/staging.json')));
const sha='a'.repeat(40),hash='sha256:'+'b'.repeat(64);
const state={sha,migration:'44',digests:{backend:hash},metricsToken:'private-metrics',outputs:{frontendUrl:'https://staging.example.test',registryServer:'registry.azurecr.io',insightsAppId:'insights',workspaceId:'workspace',backendId:'backend',databaseId:'database'}};
const options={attempts:2,pause:async()=>{}};
function setup(t){const temp=mkdtempSync(join(tmpdir(),'rh-services-test-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));return context({ENVIRONMENT:'staging',AZ_SUBSCRIPTION_ID:'11111111-2222-3333-4444-555555555555',AZ_RESOURCE_GROUP:'rg-rh-staging-test',STAGING_PRIVATE_DIR:join(temp,'private'),STAGING_RESULTS_DIR:join(temp,'results')},config,root);}
function table(items){return {tables:[{columns:Object.keys(items[0]||{}).map(name=>({name})),rows:items.map(item=>Object.values(item))}]};}
function transport(flags={}){
 const contents=new Map();let replica=0,source=0;const calls=[];
 const fetch=async(url,opts)=>{
 const path=new URL(url).pathname;calls.push([path,opts]);let status=200,data={},binary=false;
 const headers=new Headers({'Content-Type':'application/json','X-Replica-Id':flags.oneReplica?'replica-1':`replica-${(path==='/api/auth/me'?replica++:replica)%2}`});
 if(path==='/'){data=flags.noLanding?'empty':'<!DOCTYPE html><html>test</html>';binary=true;}
 else if(path==='/api/public/config')data={registrationMode:'open'};
 else if(path==='/api/auth/csrf'){status=204;headers.append('Set-Cookie','XSRF-TOKEN=csrf%2Fvalue; Path=/; Secure');}
 else if(path==='/api/auth/register')status=201;
 else if(path==='/api/auth/login')headers.append('Set-Cookie','SESSION=private-session; Path=/; Secure');
 else if(path==='/actuator/info'){if(!opts.headers.Authorization)status=401;else data={deployment:{commit:sha,imageDigest:hash,flywayVersion:'44',buildTime:'2026-10-12T12:00:00Z',instanceId:'replica'}};}
 else if(path==='/api/workspaces'&&opts.method==='POST'){status=201;data={id:'workspace'};}
 else if(path.endsWith('/members'))status=201;
 else if(path.endsWith('/sources')&&opts.method==='POST'){
  status=201;const text=await opts.body.get('file').text();const id='source-'+ ++source;contents.set(id,text);data={id};
 } else if(path.includes('/sources/')&&!path.endsWith('/content')){const id=path.split('/sources/')[1];data={id,status:flags.processingFailed?'FAILED':'READY',activeVersionId:'version-1'};}
 else if(path.endsWith('/content')){data=flags.badBlob?'changed':contents.get(path.split('/sources/')[1].split('/')[0]);binary=true;}
 else if(path.endsWith('/ai/model'))data={provider:flags.metered?'paid':'deterministic'};
 else if(path.endsWith('/ai/questions'))data={status:flags.noEvidence?'INSUFFICIENT_EVIDENCE':'SUPPORTED',citations:flags.noEvidence?[]:[{sourceVersionId:'version-1'}]};
 else if(path.endsWith('/comparisons'))data={kind:flags.badAnalysis?'BAD':'COMPARISON'};
 else if(path.includes('11111111-1111-1111'))status=403;
 return new Response(status===204?null:binary?data:JSON.stringify(data),{status,headers});
 };return {fetch,calls};
}
test('HTTP client keeps CSRF/session private, rejects non-HTTPS and handles uploads and bearer info',async()=>{
 for(const url of ['http://staging.test','https://user:pass@staging.test','https://staging.test?q=secret','https://staging.test/#fragment'])assert.throws(()=>new Client(url));
 const mock=transport(),client=new Client(state.outputs.frontendUrl,mock.fetch);await client.login({email:'test@example.test',password:'private'});
 const source=await client.upload('/api/workspaces/x/sources','synthetic.txt','synthetic');assert.ok(source.id);
 assert.ok(mock.calls.find(([p])=>p.endsWith('/sources'))[1].headers['X-XSRF-TOKEN']==='csrf/value');
 assert.ok(client.cookies.get('SESSION'));await client.request('/actuator/info',{token:'token'});
 await assert.rejects(client.request('/actuator/info'),/HTTP 401/);
});
test('bounded waits accept actual data and fail when data never arrives',async()=>{
 let count=0;assert.equal(await waitFor(async()=>++count,value=>value===2,options),2);
 await assert.rejects(waitFor(async()=>false,v=>v,options),/expired/);
 assert.deepEqual(rows(table([{name:'metric',Samples:2}])) ,[{name:'metric',Samples:2}]);assert.deepEqual(rows([{Signal:0}]),[{Signal:0}]);assert.deepEqual(rows({}),[]);
 assert.equal(populatedPlatform({},['cpu']),false);
 assert.equal(populatedPlatform({value:[{name:{value:'cpu'},timeseries:[{data:[{average:0}]}]}]},['cpu']),true);
});
test('synthetic seed plus smoke exercise real HTTP contracts with provenance and two-replica evidence',async t=>{
 const c=setup(t),mock=transport(),s=services(c,mock.fetch,options);
 const seeded=await s.seed(state);assert.equal(seeded.users.length,6);assert.equal(seeded.sources.length,2);
 assert.equal((await s.waitInfo(state)).deployment.commit,sha);
 const result=await s.smoke(state,seeded);assert.equal(result.sessionReplicas.length,2);assert.equal(result.blobHashes,true);
 assert.ok(mock.calls.find(([p])=>p.endsWith('/ai/questions')));assert.ok(mock.calls.find(([p])=>p.endsWith('/comparisons')));
});
test('processing, authorization, provenance and metered-provider failures fail the smoke',async t=>{
 const c=setup(t);
 for(const flag of ['processingFailed']){const mock=transport({[flag]:true});await assert.rejects(services(c,mock.fetch,options).seed(state),/processing/);}
 for(const flag of ['oneReplica','noLanding','badBlob','metered','noEvidence','badAnalysis']){
  const mock=transport({[flag]:true}),s=services(c,mock.fetch,options),seeded=await s.seed(state);await assert.rejects(s.smoke(state,seeded));
 }
 await assert.rejects(services(c,transport().fetch,options).smoke(state,{synthetic:false,users:[]}),/synthetic/);
 await assert.rejects(services(c,transport().fetch,options).smoke(state,{synthetic:true,users:[{email:'real@real.test'}]}),/synthetic/);
 await assert.rejects(services(c,async()=>{throw Error('offline');},options).waitInfo(state),/expired/);
});
test('collection requires every actual metric and query before enabling all eight alert rules',async t=>{
 const c=setup(t),calls=[];
 const az=(...a)=>{calls.push(a);
  if(a.includes('app-insights')){const query=a[a.indexOf('--analytics-query')+1];return JSON.stringify(query.includes('by name')?table(requiredMetrics.map(name=>({name,Samples:1}))):query.includes('Samples=count()')?table([{Samples:30}]):table([{Signal:0}]));}
  if(a.includes('metrics')){const names=a.slice(a.indexOf('--metrics')+1,a.indexOf('--aggregation'));return JSON.stringify({value:names.map(name=>({name:{value:name},timeseries:[{data:[{maximum:1}]}]}))});}
  if(a.includes('log-analytics'))return '[]';return '';
 };
 const result=await services(c,transport().fetch,options).collect(state,az);assert.equal(result.alertsEnabled,8);
 assert.equal(calls.filter(a=>a[0]==='resource'&&a.includes('properties.enabled=true')).length,8);
 const incomplete=(...a)=>JSON.stringify(a.includes('app-insights')?table([]):{});
 await assert.rejects(services(c,transport().fetch,options).collect(state,incomplete),/expired/);
 const bad=(...a)=>{if(a.includes('metrics'))return '{}';return az(...a);};await assert.rejects(services(c,transport().fetch,options).collect(state,bad),/platform/);
 const noQueries=(...a)=>{if(a.includes('app-insights')&&!a[a.indexOf('--analytics-query')+1].includes('Samples=count()'))return JSON.stringify(table([]));return az(...a);};
 await assert.rejects(services(c,transport().fetch,options).collect(state,noQueries),/no staging data/);
 const noRequests=(...a)=>a.includes('app-insights')&&a[a.indexOf('--analytics-query')+1].includes('summarize Samples=count()')&&!a[a.indexOf('--analytics-query')+1].includes('by name')?JSON.stringify(table([{Samples:0}])):az(...a);
 await assert.rejects(services(c,transport().fetch,options).collect(state,noRequests),/request telemetry/);
});
