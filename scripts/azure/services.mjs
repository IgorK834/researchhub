import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { evidence, identity, requiredMetrics, ruleNames } from './control.mjs';

export class Client {
  constructor(base, transport = fetch) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS staging endpoint');
    this.base = url.origin; this.transport = transport; this.cookies = new Map();
  }
  async request(path, { method = 'GET', body, expected = [200], token, binary = false } = {}) {
    const headers = { Cookie: [...this.cookies].map(([k,v]) => `${k}=${v}`).join(';') };
    if (this.cookies.has('XSRF-TOKEN')) headers['X-XSRF-TOKEN'] = decodeURIComponent(this.cookies.get('XSRF-TOKEN'));
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await this.transport(this.base + path, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(120000) });
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0,i), pair.slice(i+1)); }
    if (!expected.includes(response.status)) throw new Error(`Staging HTTP ${response.status}: ${path.split('?')[0]}`);
    const data = binary ? Buffer.from(await response.arrayBuffer()) : response.status === 204 ? null : await response.json();
    return { data, replica: response.headers.get('X-Replica-Id'), status: response.status };
  }
  async login(user) {
    await this.request('/api/auth/csrf', { expected: [204] });
    await this.request('/api/auth/login', { method: 'POST', body: {email:user.email,password:user.password} });
    await this.request('/api/auth/csrf', { expected: [204] });
  }
  async upload(route, name, content) {
    const form = new FormData(); form.set('file', new Blob([content], { type: 'text/plain' }), name);
    return (await this.request(route, { method: 'POST', body: form, expected: [201] })).data;
  }
}
export async function waitFor(read, accept, { attempts = 60, pause = () => delay(5000) } = {}) {
  for (let i = 0; i < attempts; i++) { const value = await read(); if (accept(value)) return value; if (i+1 < attempts) await pause(); }
  throw new Error('Bounded staging wait expired');
}
export function rows(response) {
  if (Array.isArray(response)) return response;
  return (response.tables || []).flatMap(table => table.rows.map(row => Object.fromEntries(table.columns.map((c,i) => [c.name,row[i]]))));
}
export function populatedPlatform(response, names) {
  return names.every(name => response.value?.some(metric => metric.name.value === name && metric.timeseries?.some(series =>
    series.data.some(point => Number.isFinite(point.maximum) || Number.isFinite(point.average)))));
}
export function services(c, transport = fetch, waitOptions = {}) {
  const client = state => new Client(state.outputs.frontendUrl, transport);
  return {
    async waitInfo(state) {
      const http = client(state);
      return waitFor(async () => { try { return (await http.request('/actuator/info',{token:state.metricsToken})).data; } catch { return null; } }, value => Boolean(value?.deployment), waitOptions);
    },
    async seed(state) {
      const http = client(state); const users = [];
      await waitFor(async()=>{try{return (await http.request('/api/public/config')).data;}catch{return null;}},value=>value?.registrationMode==='open',waitOptions);
      for (let i=0;i<6;i++) {
        const user={email:`staging-${state.sha.slice(0,8)}-${i}@rc-demo.example.test`,password:randomBytes(24).toString('base64url'),displayName:`Synthetic staging user ${i}`};
        await http.request('/api/auth/csrf',{expected:[204]});
        await http.request('/api/auth/register',{method:'POST',body:user,expected:[201]}); users.push(user);
      }
      await http.login(users[0]);
      const workspace=(await http.request('/api/workspaces',{method:'POST',body:{name:'Synthetic Azure RC validation',description:'Project-authored synthetic data only'},expected:[201]})).data;
      const route=`/api/workspaces/${workspace.id}`;
      for(const user of users.slice(1))await http.request(route+'/members',{method:'POST',body:{email:user.email,role:'VIEWER'},expected:[201,200]});
      const sources=[];
      for(const [name,content] of [
        ['rc-theory.txt','Synthetic RC theory: R = 10000 ohms. C = 470 microfarads. The theoretical time constant is 4.7 seconds. No participants or private measurements.'],
        ['rc-method.txt','Synthetic RC method: R = 10000 ohms and C = 470 microfarads. The expected time constant is 4.7 seconds. This authored fixture describes exponential discharge.']
      ]) {
        const source=await http.upload(route+'/sources',name,content);
        const ready=await waitFor(async()=> (await http.request(route+'/sources/'+source.id)).data, s=>['READY','FAILED'].includes(s.status),waitOptions);
        if(ready.status!=='READY')throw new Error('Synthetic processing failed');
        sources.push({id:ready.id,versionId:ready.activeVersionId,sha256:createHash('sha256').update(content).digest('hex')});
      }
      return {workspaceId:workspace.id,users,sources,synthetic:true};
    },
    async smoke(state, seed) {
      if(seed.synthetic!==true || seed.users.some(u=>!u.email.endsWith('@rc-demo.example.test')))throw new Error('Only synthetic seed accounts are permitted');
      const http=client(state);
      const landing=await http.request('/',{binary:true}); if(!landing.data.toString().includes('<html'))throw new Error('Landing page missing');
      await http.request('/actuator/info',{expected:[401]});
      await http.login(seed.users[0]);
      const replicas=new Set();
      for(let i=0;i<40;i++){
        const result=await http.request('/api/auth/me'); if(result.replica)replicas.add(result.replica);
        const reported=await http.request('/actuator/info',{token:state.metricsToken}); identity(reported.data,state.sha,state.digests.backend,state.migration);
        if(replicas.size>=2)break;
      }
      if(replicas.size<2)throw new Error('One authenticated session was not observed across two replicas');
      const route=`/api/workspaces/${seed.workspaceId}`;
      for(let i=0;i<40;i++)await http.request(route); // Real request samples for zero-error rate and p95 queries.
      const model=(await http.request(route+'/ai/model')).data; if(model.provider!=='deterministic')throw new Error('Metered AI provider is forbidden in staging validation');
      for(const source of seed.sources){const bytes=(await http.request(`${route}/sources/${source.id}/versions/${source.versionId}/content`,{binary:true})).data;
        if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new Error('Immutable Blob bytes/provenance mismatch');}
      const question=(await http.request(route+'/ai/questions',{method:'POST',body:{question:'What theoretical time constant is stated in the synthetic sources?'},expected:[200]})).data;
      if(question.status!=='SUPPORTED'||!question.citations?.length)throw new Error('Grounded retrieval did not produce source citations');
      const analysis=(await http.request(route+'/ai/source-analyses/comparisons',{method:'POST',body:{selectedSourceIds:seed.sources.map(s=>s.id),criteria:['method','main result'],instruction:'Compare these synthetic RC sources.'}})).data;
      if(analysis.kind!=='COMPARISON')throw new Error('Deterministic source analysis failed');
      await http.request('/api/workspaces/11111111-1111-1111-1111-111111111111',{expected:[403,404]});
      return {landing:true,login:true,sessionReplicas:[...replicas],workspace:true,uploadProcessing:true,retrieval:true,
        deterministicSourceAnalysis:true,blobHashes:true,workspaceDenial:true,actuatorAnonymousDenied:true,commit:state.sha,
        sandbox:'disabled per ADR-015; numerical execution is not claimed'};
    },
    async collect(state, az) {
      const queries=JSON.parse(readFileSync(join(c.root,'infra/azure/queries/signals.json')));
      const query=q=>JSON.parse(az('monitor','app-insights','query','--app',state.outputs.insightsAppId,'--analytics-query',q,'--output','json'));
      const presence=await waitFor(async()=>rows(query(queries.metricsPresent)), samples=>requiredMetrics.every(name=>samples.some(row=>row.name===name&&Number(row.Samples)>0)),waitOptions);
      evidence(c,'metric-presence.json',presence);
      if(!rows(query(queries.requestsPresent)).some(row=>Number(row.Samples)>0))throw new Error('No staging request telemetry');
      const queryKeys=['requestRate','errorRate','p95Latency','connectionPressure','connectionWaiters','connectionTimeouts','processingFailures','sandboxFailures','aiUnavailable','aiLatency'];
      const result={};
      for(const key of queryKeys){result[key]=query(queries[key].replaceAll('__MIN_REQUESTS__',String(c.config.minimumRequests)));
        if(!rows(result[key]).length)throw new Error(`Alert/dashboard query ${key} has no staging data`);}
      evidence(c,'application-insights.json',result);
      for(const [name,id,names] of [['backend',state.outputs.backendId,['Replicas','UsageNanoCores','WorkingSetBytes']],
        ['database',state.outputs.databaseId,['active_connections','cpu_percent','storage_percent']]]){
        const metrics=JSON.parse(az('monitor','metrics','list','--resource',id,'--metrics',...names,'--aggregation','Maximum','--interval','PT1M','--output','json'));
        evidence(c,`${name}-metrics.json`,metrics); if(!populatedPlatform(metrics,names))throw new Error(`Missing ${name} platform metrics`);
      }
      evidence(c,'structured-logs.json',JSON.parse(az('monitor','log-analytics','query','--workspace',state.outputs.workspaceId,'--analytics-query',queries.logs,'--output','json')));
      for(const name of [...ruleNames,'db-storage']){
        const type=name==='db-storage'?'metricAlerts':'scheduledQueryRules';
        az('resource','update','--resource-group',c.group,'--resource-type',`Microsoft.Insights/${type}`,'--name','alert-rh-'+name,'--set','properties.enabled=true','--output','none');
      }
      evidence(c,'telemetry-validation.json',{passed:true,metricNames:requiredMetrics,enabledRules:[...ruleNames,'db-storage'],timestamp:new Date().toISOString()});
      return {collected:true,alertsEnabled:8};
    }
  };
}
