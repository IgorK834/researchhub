import {it, expect, afterEach} from 'vitest';
import {createServer} from 'node:http';
import * as Y from 'yjs';
import {Backend, BackendError, type State} from '../src/backend.js';
import {configuration} from '../src/config.js';
import {schema} from '../src/schema.js';
import {prepareEmptyText} from '../src/emptyText.js';
import {editorSnapshot, reconstruct, stateHash} from '../src/snapshot.js';
const original: State = {sequence: 0, state: null, stateSha256: null, title: 'Legacy', content: JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Seed once'}]}]}),revision:1,savedAt:'time'};
const cleanup: (()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const stop of cleanup.splice(0)) await stop();});
it('seeds valid legacy content once and checks binary integrity, projection and title',()=>{
 const doc=reconstruct(original);
 const bytes=Y.encodeStateAsUpdate(doc);
 const stored={...original,sequence:1,state:Buffer.from(bytes).toString('base64'),stateSha256:stateHash(bytes)};
 const recovered=reconstruct(stored);
 expect(editorSnapshot(recovered)).toEqual({title:'Legacy',content:JSON.parse(original.content)});
 expect(()=>reconstruct({...stored,stateSha256:'0'.repeat(64)})).toThrow('integrity');
 expect(()=>reconstruct({...stored,title:'Stale'})).toThrow('projection');
 expect(()=>reconstruct({...stored,content:JSON.stringify({type:'doc',content:[{type:'paragraph'}]})})).toThrow('projection');
 expect(()=>reconstruct({...original,sequence:1})).toThrow('missing');
 expect(()=>reconstruct({...original,content:'[]'})).toThrow();
 expect(()=>reconstruct({...original,title:' '})).toThrow('title');
 expect(()=>reconstruct({...original,title:'x'.repeat(501)})).toThrow('title');
 doc.destroy(); recovered.destroy();
});
it('does not silently seed legacy content when a checksummed binary is invalid',()=>{
 const bytes=new Uint8Array([255]);
 expect(()=>reconstruct({...original,sequence:1,state:Buffer.from(bytes).toString('base64'),stateSha256:stateHash(bytes)})).toThrow();
});
it('retries only transient failures, keeping the identical receipt and bytes after a lost response',async()=>{
 const bodies: any[]=[];
 let mode='lost';
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
  if(mode==='lost'&&bodies.length===1){res.destroy();return;}
  res.setHeader('content-type','application/json');res.statusCode=mode==='denied'?409:mode==='unavailable'?503:200;res.end('{}');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 cleanup.push(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const backend=new Backend(configuration({COLLABORATION_BACKEND_URL:`http://127.0.0.1:${(server.address() as any).port}`,COLLABORATION_SERVICE_TOKEN:'x'.repeat(32)}));
 const save=()=>backend.save('token','document:id',0,new Uint8Array([1]),'Legacy',{type:'doc'});
 await save();expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);expect(bodies[0].snapshotId).toMatch(/^[a-f0-9-]{36}$/);
 mode='denied';await expect(save()).rejects.toMatchObject({status:409,transient:false});expect(bodies).toHaveLength(3);
 mode='unavailable';await expect(save()).rejects.toBeInstanceOf(BackendError);expect(bodies).toHaveLength(5);expect(bodies[4]).toEqual(bodies[3]);
});

it('prepares empty nested text blocks without altering materialized content or reseeding',()=>{
 const input={...original,content:JSON.stringify({type:'doc',content:[{type:'blockquote',content:[{type:'paragraph'}]},{type:'codeBlock'}]})};
 const doc=reconstruct(input);const before=editorSnapshot(doc);
 prepareEmptyText(doc);expect(schema.nodeFromJSON(editorSnapshot(doc).content).toJSON()).toEqual(schema.nodeFromJSON(before.content).toJSON());
 const bytes=Y.encodeStateAsUpdate(doc);prepareEmptyText(doc);expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
 doc.destroy();
});
