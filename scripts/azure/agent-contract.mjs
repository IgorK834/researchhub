import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
const root=fileURLToPath(new URL('../../',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'rh-agent-contract-'));
let server;
try {
 const agent=process.env.STAGING_AGENT_JAR;
 if(!agent)throw Error('Set STAGING_AGENT_JAR to the pinned local agent JAR');
 const lock=JSON.parse(readFileSync(join(root,'backend/observability/agent-lock.json')));
 if(createHash('sha256').update(readFileSync(agent)).digest('hex')!==lock.sha256)throw Error('Agent SHA-256 does not match lock');
 const report=readFileSync(join(root,'backend/target/surefire-reports/TEST-dev.researchhub.shared.observability.ObservabilityApiTest.xml'),'utf8');
 const cp=report.match(/<property name="java.class.path" value="([^"]+)"/)[1];
 const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin/java'):'java';
 const javac=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin/javac'):'javac';
 execFileSync(javac,['-cp',cp,'-d',temp,join(root,'scripts/azure/test/MetricProbe.java')]);
 const packets=[];
 server=http.createServer((request,response)=>{
  const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
   try{let raw=Buffer.concat(chunks);if(request.headers['content-encoding']==='gzip')raw=gunzipSync(raw);
    for(const line of raw.toString().split('\n').filter(Boolean)){const value=JSON.parse(line);packets.push(...(Array.isArray(value)?value:[value]));}
   }catch{/* Live-metrics envelopes are outside this ingestion contract. */}
   response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({itemsReceived:packets.length,itemsAccepted:packets.length,errors:[]}));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const env={...process.env,APPLICATIONINSIGHTS_CONNECTION_STRING:`InstrumentationKey=11111111-2222-3333-4444-555555555555;IngestionEndpoint=http://127.0.0.1:${port}/;LiveEndpoint=http://127.0.0.1:${port}/`,
  APPLICATIONINSIGHTS_CONFIGURATION_CONTENT:JSON.stringify({...JSON.parse(readFileSync(join(root,'backend/observability/applicationinsights.json'))),metricIntervalSeconds:5})};
 const child=spawn(java,['-javaagent:'+agent,'-cp',temp+':'+cp,'MetricProbe'],{env,stdio:'ignore'});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),45000);
 const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});clearTimeout(timeout);
 if(code!==0)throw Error('Agent probe failed or timed out');
 const records=packets.flatMap(packet=>(packet.data?.baseData?.metrics||[]).map(metric=>({...metric,dimensions:packet.data.baseData.properties||{}})));
 for(const queue of ['SOURCE_INGEST','ANALYSIS_EXECUTION'])if(!records.some(r=>r.name==='researchhub_worker_failures'&&r.value===0&&r.dimensions.queue===queue))throw Error('Missing zero failure counter for '+queue);
 if(!records.some(r=>r.name==='researchhub_ai_provider_unavailable'&&r.value===0))throw Error('Missing zero provider-unavailable counter');
 if(!records.some(r=>r.name==='researchhub_jobs_queue'&&r.value===0&&r.dimensions.status==='FAILED'))throw Error('Missing terminal-failure queue gauge');
 if(!records.some(r=>r.name==='researchhub_ai_request_duration'&&r.value===123&&r.count===1))throw Error('Timer sum/count units differ from KQL contract');
 console.log(JSON.stringify({passed:true,agent:lock.version,zeroCounters:true,timerSumMs:123,timerCount:1,names:[...new Set(records.filter(r=>/^researchhub_|^hikaricp_/.test(r.name)).map(r=>r.name))]},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}finally{server?.close();rmSync(temp,{recursive:true,force:true});}
