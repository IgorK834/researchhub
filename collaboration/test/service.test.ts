import {afterEach, describe, expect, it} from 'vitest';
import {HocuspocusProvider} from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {createServer} from 'node:http';
import {prosemirrorJSONToYDoc, yDocToProsemirrorJSON} from 'y-prosemirror';
import {createService, log} from '../src/service.js';
import {Backend, BackendError, accessRoom, type State} from '../src/backend.js';
import {configuration} from '../src/config.js';
import {stateHash, reconstruct, editorSnapshot} from '../src/snapshot.js';
import {schema} from '../src/schema.js';
import * as encoding from 'lib0/encoding';
import type {Patch} from '../src/operations.js';

const room = 'document:11111111-1111-1111-1111-111111111111';
const config = configuration({COLLABORATION_PORT: '0', COLLABORATION_SERVICE_TOKEN: 'x'.repeat(32), COLLABORATION_RECHECK_MS: '100'});
const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {for (const task of cleanup.reverse()) await task(); cleanup.length = 0;});
async function until(condition: () => boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!condition()) {if (Date.now() > end) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10));}
}
async function fixture(initial?: State, lifetime = 60000) {
  let stored = initial ?? {sequence: 0, state: null, stateSha256: null, title: 'Report', content: JSON.stringify({type: 'doc', content: [{type: 'paragraph'}]}), revision: 1, savedAt: new Date().toISOString()};
  let denied = false;
  let failed = false;
  const backend = new Backend(config);
  backend.authorize = async (token, name) => {
    if (denied || !['editor', 'owner'].includes(token) || name !== room) throw new BackendError(403,false);
    return {documentId: room.substring(9), workspaceId: 'workspace', userId: token, user: {userId: token, displayName: token, colorId: 'blue'}, expiresAt: new Date(Date.now()+lifetime).toISOString()};
  };
  backend.load = async () => stored;
  backend.save = async (_token, _room, sequence, state, title, content) => {
    if (failed || sequence !== stored.sequence) throw new BackendError(503,true);
    stored = {sequence: sequence+1, stateSha256: stateHash(state), state: Buffer.from(state).toString('base64'), title, content: JSON.stringify(content), revision: stored.revision+1, savedAt: new Date().toISOString()};
    return stored;
  };
  const events: string[] = [];
  const service = createService(config, backend, event => {events.push(event);});
  await service.listen(); cleanup.push(() => service.destroy());
  const url = `ws://127.0.0.1:${service.address.port}`;
  const client = (token = 'editor', name = room) => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({url, name, token, document: doc, WebSocketPolyfill: WebSocket});
    cleanup.push(() => {provider.destroy(); doc.destroy();});
    return {doc, provider};
  };
  return {backend, service, url, client, stored: () => stored, events, deny: () => {denied = true;}, fail: () => {failed = true;}};
}
async function operationFixture(live=false) {
  const f=await fixture({sequence:0,state:null,stateSha256:null,title:'Report',revision:1,savedAt:new Date().toISOString(),content:JSON.stringify({type:'doc',content:[{type:'paragraph',attrs:{blockId:'target'},content:[{type:'text',text:'original'}]},{type:'paragraph',content:[{type:'text',text:'outside'}]}]})});
  const a=f.client(),b=live ? f.client('owner') : undefined;
  await until(()=>a.provider.isSynced&&(!b||b.provider.isSynced));
  let state=f.stored(),receipt:unknown=null,commits=0,fail=false,lost=false;
  const before=JSON.parse(state.content).content[0];
  const patch:Patch={parent:[],index:0,before:[before],after:[schema.nodeFromJSON({type:'paragraph',attrs:{blockId:'generated'},content:[{type:'text',text:'generated'}]}).toJSON()],generatedBlocks:['generated']};
  const id='22222222-2222-4222-8222-222222222222';
  f.backend.call=async <T>(path:string,body:any):Promise<T>=>{
    if(path==='ai/load')return {operation:{documentId:room.substring(9),epoch:0,receipt},state,patch:receipt ? null : patch} as T;
    if(path!=='ai/commit')throw new BackendError(404,false);
    if(fail)throw new BackendError(503,true);
    if(!receipt){commits++;state={...state,sequence:state.sequence+1,revision:state.revision+1,state:body.state,content:body.content,stateSha256:stateHash(Buffer.from(body.state,'base64'))};receipt={operationId:id,revision:state.revision,kind:'ACCEPT',proposalId:'proposal'};}
    if(lost){lost=false;throw new BackendError(0,true);}
    return {receipt,state} as T;
  };
  const apply=(headers:Record<string,string>={'X-Collaboration-Service-Token':config.serviceToken},body:unknown={operationId:id,room})=>fetch(f.url.replace('ws:','http:')+'/internal/canvas/apply',{method:'POST',headers,body:typeof body==='string' ? body : JSON.stringify(body)});
  return {f,a,b,apply,patch,commits:()=>commits,state:()=>state,fail:()=>{fail=true;},loseResponse:()=>{lost=true;}};
}
describe('frozen canvas operations',()=>{
  it('commits exactly once for two connected clients and recovers a lost commit response',async()=>{
    const o=await operationFixture(true);o.loseResponse();const first=await o.apply();expect(first.status).toBe(200);
    await until(()=>o.a.doc.getXmlFragment('default').toString().includes('generated')&&o.b!.doc.getXmlFragment('default').toString().includes('generated'));
    const replay=await o.apply();expect(await replay.json()).toEqual(await first.json());expect(o.commits()).toBe(1);
    expect(o.b!.doc.getXmlFragment('default').toString()).toContain('outside');
  });
  it('rejects failed persistence before exposing any candidate to the room',async()=>{
    const o=await operationFixture(true);o.fail();expect((await o.apply()).status).toBe(503);expect(o.commits()).toBe(0);
    expect(o.b!.doc.getXmlFragment('default').toString()).toContain('original');expect(o.b!.doc.getXmlFragment('default').toString()).not.toContain('generated');
  });
  it('requires service authentication and bounded known operation identity and room',async()=>{
    const o=await operationFixture();expect((await o.apply({})).status).toBe(403);
    expect((await o.apply(undefined,'bad')).status).toBe(409);expect((await o.apply(undefined,'x'.repeat(1025))).status).toBe(409);
    expect((await o.apply(undefined,{operationId:'invented',room})).status).toBe(409);
    expect((await o.apply(undefined,{operationId:'22222222-2222-4222-8222-222222222222',room:room+':1'})).status).toBe(409);
    o.f.backend.call=async()=>{throw new BackendError(403,false);};expect((await o.apply()).status).toBe(403);
  });
  it('applies and replays durable state when there is no loaded room',async()=>{
    const o=await operationFixture();o.a.provider.destroy();await until(()=>!o.f.service.hocuspocus.documents.has(room));
    expect((await o.apply()).status).toBe(200);expect((await o.apply()).status).toBe(200);expect(o.commits()).toBe(1);
    expect(reconstruct(o.state()).getXmlFragment('default').toString()).toContain('generated');
  });
});
describe('realtime security and durability', () => {
  it('exchanges edits between two clients, persists before ack and reconnects from binary state', async () => {
    const f = await fixture();
    const a = f.client(), b = f.client();
    await until(() => a.provider.isSynced && b.provider.isSynced);
    const text = new Y.XmlText(); text.insert(0, 'simultaneous');
    a.doc.getXmlFragment('default').get(0).insert(0, [text]);
    b.doc.getMap('metadata').set('title', 'Shared title');
    await until(() => !a.provider.hasUnsyncedChanges && !b.provider.hasUnsyncedChanges && b.doc.getXmlFragment('default').toString().includes('simultaneous'));
    expect(f.stored().content).toContain('simultaneous');
    expect(f.stored().title).toBe('Shared title');
    a.provider.disconnect(); b.provider.disconnect();
    const recovered = await fixture(f.stored());
    const c = recovered.client(); await until(() => c.provider.isSynced);
    expect(c.doc.getXmlFragment('default').toString()).toContain('simultaneous');
    expect(c.doc.getMap('metadata').get('title')).toBe('Shared title');
    expect(f.events).toContain('document.persisted');
    const health = await fetch(f.url.replace('ws:', 'http:')+'/health'); expect(health.status).toBe(200);
    expect((await fetch(f.url.replace('ws:', 'http:')+'/unknown')).status).toBe(404);
  });
  it('exchanges ephemeral presence and cursor state, removes it on disconnect and never snapshots it', async () => {
    const f = await fixture(); const a = f.client(), b = f.client('owner');
    await until(() => a.provider.isSynced && b.provider.isSynced);
    const revision = f.stored().revision, binary = f.stored().state;
    a.provider.setAwarenessField('user', {userId:'editor', displayName:'editor', colorId:'blue'});
    b.provider.setAwarenessField('user', {userId:'owner', displayName:'owner', colorId:'blue'});
    a.provider.setAwarenessField('cursor', {anchor:{tname:'default',assoc:0},head:{tname:'default',assoc:0}});
    await until(()=>b.provider.awareness!.getStates().get(a.doc.clientID)?.cursor != null && a.provider.awareness!.getStates().get(b.doc.clientID)?.user != null);
    expect(f.stored().revision).toBe(revision); expect(f.stored().state).toBe(binary);
    b.provider.disconnect(); await until(()=>!a.provider.awareness!.getStates().has(b.doc.clientID));
    expect(f.stored().content).not.toContain('userId');
  });
  it('drops queued awareness after disconnect instead of reviving a ghost or blocking reconnect',async()=>{
    const f=await fixture();const a=f.client(),b=f.client('owner');await until(()=>a.provider.isSynced&&b.provider.isSynced);
    a.provider.setAwarenessField('user',{userId:'editor',displayName:'editor',colorId:'blue'});
    await until(()=>b.provider.awareness!.getStates().get(a.doc.clientID)?.user!=null);
    const original=f.backend.authorize;let waiting=false;let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    f.backend.authorize=async(token,name)=>{if(token==='editor'){waiting=true;await gate;}return original(token,name);};
    a.provider.setAwarenessField('cursor',{anchor:{tname:'default'},head:{tname:'default'}});
    await until(()=>waiting);a.provider.disconnect();
    await until(()=>!b.provider.awareness!.getStates().has(a.doc.clientID));
    release();f.backend.authorize=original;await a.provider.connect();
    await until(()=>a.provider.isSynced&&b.provider.awareness!.getStates().get(a.doc.clientID)?.user!=null);
    expect(f.events.filter(event=>event==='message.rejected')).toEqual([]);
  });
  it('rejects spoofed awareness identity before it can reach a peer', async () => {
    const f=await fixture(); const a=f.client(), b=f.client('owner'); await until(()=>a.provider.isSynced&&b.provider.isSynced);
    a.provider.setAwarenessField('user',{userId:'owner',displayName:'owner',colorId:'blue',email:'private@test'});
    await until(()=>f.events.includes('message.rejected'));
    expect(b.provider.awareness!.getStates().get(a.doc.clientID)?.user).toBeUndefined();
  });
  it('denies anonymous, non-member and substituted rooms', async () => {
    const f = await fixture();
    for (const [token, name] of [['', room], ['outsider', room], ['editor', room+'x']]) {
      const c = f.client(token, name); let denied = false;
      c.provider.on('authenticationFailed', () => {denied = true;});
      await until(() => denied); expect(c.provider.isSynced).toBe(false);
    }
  });
  it('disconnects existing clients when membership is revoked', async () => {
    const f = await fixture(); const c = f.client(); await until(() => c.provider.isSynced);
    let closed = false; c.provider.on('close', () => {closed = true;}); f.deny(); await until(() => closed);
  });
  it('closes an expired credential for renewal and fails closed when Spring cannot revalidate', async () => {
    const expiry = await fixture(undefined, 180); const a = expiry.client();
    let reason = ''; a.provider.on('close', (data)=>{reason=(data.event ?? data).reason;});
    await until(()=>a.provider.isSynced); await until(()=>reason==='ACCESS_EXPIRED');
    const outage=await fixture(); const b=outage.client(); await until(()=>b.provider.isSynced);
    let unavailable=false;b.provider.on('close',(data)=>{unavailable=(data.event ?? data).reason==='ACCESS_UNAVAILABLE';});
    outage.backend.authorize=async()=>{throw new BackendError(503,true);};
    await until(()=>unavailable); expect(outage.events).toContain('connection.access.ended');
  });
  it('rejects an incoming edit immediately after revocation, before the periodic check',async()=>{
    const f=await fixture();const a=f.client();await until(()=>a.provider.isSynced);
    let revoked=false;a.provider.on('stateless',({payload})=>{if(JSON.parse(payload).event==='accessRevoked')revoked=true;});
    const before=f.stored().revision;f.deny();a.doc.getMap('metadata').set('title','Unauthorized');
    await until(()=>revoked);expect(f.stored().revision).toBe(before);expect(f.stored().title).toBe('Report');
  });
  it('never overlaps periodic authorization requests for a slow backend',async()=>{
    const f=await fixture();const a=f.client();await until(()=>a.provider.isSynced);
    const authorize=f.backend.authorize;let inFlight=0,max=0;
    f.backend.authorize=async(token,name)=>{
      inFlight++;max=Math.max(max,inFlight);
      try {await new Promise(resolve=>setTimeout(resolve,250));return await authorize(token,name);}
      finally{inFlight--;}
    };
    await new Promise(resolve=>setTimeout(resolve,450));expect(max).toBe(1);
  });
  it('does not apply or acknowledge an update when persistence fails', async () => {
    const f = await fixture(); const a = f.client(), b = f.client(); await until(() => a.provider.isSynced && b.provider.isSynced);
    f.fail(); a.doc.getMap('metadata').set('title', 'Uncommitted');
    await until(() => f.events.includes('document.persistence.failed'));
    expect(f.stored().title).toBe('Report'); expect(b.doc.getMap('metadata').get('title')).toBe('Report');
  });
  it('rejects invalid titles and unsupported stateless broadcasts', async () => {
    const f = await fixture(); const a = f.client(); await until(() => a.provider.isSynced);
    a.doc.getMap('metadata').set('title', ''); await until(() => f.events.includes('message.rejected'));
    expect(f.stored().title).toBe('Report');
    const b = f.client(); await until(() => b.provider.isSynced); b.provider.sendStateless('forged');
    await until(() => f.events.filter(event => event === 'message.rejected').length >= 2);
  });
  it('rejects disallowed origins and credentials in query strings', async () => {
    const f = await fixture();
    for (const [url, origin] of [[f.url, 'https://evil.test'], [f.url+'?token=secret', 'http://localhost:3000']]) {
      const c = new WebSocket(url, {origin}); cleanup.push(() => c.terminate());
      let failed = false; c.on('error', () => {failed = true;}); await until(() => failed);
    }
  });
});
it('validates environment configuration and emits structured logs', () => {
  expect(configuration({...process.env, COLLABORATION_SERVICE_TOKEN: 'x'.repeat(32)}).port).toBe(8091);
  for (const extra of [{COLLABORATION_HOST: 'bad'}, {COLLABORATION_PORT: '-1'}, {COLLABORATION_SERVICE_TOKEN: ''}, {COLLABORATION_ALLOWED_ORIGINS: '*'}, {COLLABORATION_RECHECK_MS: '6000'}, {COLLABORATION_BACKEND_URL: 'ftp://localhost'}]) {
    expect(() => configuration({COLLABORATION_SERVICE_TOKEN: 'x'.repeat(32), ...extra})).toThrow();
  }
  log('test.event', {test: true});
});
it('preserves citations, figures, tables and historical analysis references through Yjs', () => {
  const content = {type: 'doc', content: [{type: 'figure', content: [{type: 'paragraph', content: [{type: 'researchCitation', attrs: {citation: {sourceVersionId: 'original', origin: 'AI'}}}]}, {type: 'figureCaption', content: [{type: 'text', text: 'Figure'}]}]}, {type: 'analysisResult', attrs: {blockId: 'block', reference: {executionId: 'historic'}, caption: 'Measurement'}}]};
  const doc = prosemirrorJSONToYDoc(schema, content, 'default');
  expect(yDocToProsemirrorJSON(doc, 'default')).toEqual(content); doc.destroy();
});
it('Spring adapter sends only the internal service token and scoped contracts', async () => {
  const calls: {url: string; body: any; token?: string}[] = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => {body += chunk;}); req.on('end', () => {
      calls.push({url: req.url!, body: JSON.parse(body), token: req.headers['x-collaboration-service-token'] as string});
      res.setHeader('Content-Type', 'application/json'); res.statusCode = req.url!.endsWith('authorize') ? 403 : 200; res.end('{}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise(resolve => server.close(resolve)));
  const backend = new Backend({...config, backendUrl: `http://127.0.0.1:${(server.address() as any).port}`});
  await expect(backend.authorize('opaque', room)).rejects.toThrow(); await backend.load('opaque', room);
  await backend.save('opaque', room, 2, new Uint8Array([1]), 'Report', {type: 'doc'});
  expect(calls[2].body.state).toBe('AQ=='); expect(calls.every(call => call.token === config.serviceToken)).toBe(true);
});

it('fails room loading visibly instead of reseeding a corrupt committed snapshot',async()=>{
 const f=await fixture({sequence:1,state:'AQ==',stateSha256:'0'.repeat(64),title:'Stale legacy',content:JSON.stringify({type:'doc',content:[{type:'paragraph'}]}),revision:2,savedAt:'time'});
 const c=f.client();await until(()=>f.events.includes('document.load.failed'));
 expect(c.provider.isSynced).toBe(false);expect(f.stored().sequence).toBe(1);
});

it('retires connected replicas with a distinct restore notification before accepting stale updates',async()=>{
 const f=await fixture();const c=f.client();await until(()=>c.provider.isSynced);
 let replaced=false;c.provider.on('stateless',({payload}:{payload:string})=>{if(JSON.parse(payload).event==='stateReplaced')replaced=true;});
 const before=f.stored();f.backend.authorize=async()=>{throw new BackendError(409,false,'COLLABORATION_STATE_REPLACED');};
 await until(()=>replaced);expect(f.stored()).toEqual(before);expect(f.events).toContain('connection.access.ended');
});
it('addresses each restored document epoch explicitly while retaining legacy room compatibility',()=>{
 const access={documentId:'id',workspaceId:'w',userId:'u',user:{userId:'u',displayName:'U',colorId:'blue'},expiresAt:'later'};
 expect(accessRoom(access)).toBe('document:id');expect(accessRoom({...access,epoch:0})).toBe('document:id');expect(accessRoom({...access,epoch:3})).toBe('document:id:3');
});

it('rejects a restore race at persistence without applying the obsolete candidate to another client',async()=>{
 const f=await fixture();const a=f.client(),b=f.client('owner');await until(()=>a.provider.isSynced&&b.provider.isSynced);
 let replaced=false;a.provider.on('stateless',({payload}:{payload:string})=>{if(JSON.parse(payload).event==='stateReplaced')replaced=true;});
 const before=f.stored();f.backend.save=async()=>{throw new BackendError(409,false,'COLLABORATION_STATE_REPLACED');};
 a.doc.getMap('metadata').set('title','Obsolete after restore');await until(()=>replaced);
 expect(f.stored()).toEqual(before);expect(b.doc.getMap('metadata').get('title')).toBe('Report');
});
