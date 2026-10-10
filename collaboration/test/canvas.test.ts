import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { absolutePositionToRelativePosition, initProseMirrorDoc, prosemirrorJSONToYDoc } from 'y-prosemirror';
import { schema } from '../src/schema.js';
import { resolveCanvas, type ResolveRequest } from '../src/canvas.js';
import { createService } from '../src/service.js';
import { configuration } from '../src/config.js';
const docs: Y.Doc[] = [];afterEach(()=>{docs.forEach(doc=>doc.destroy());docs.length=0;});
function fixture(content?: unknown) {
  const doc=prosemirrorJSONToYDoc(schema,content??{type:'doc',content:[{type:'paragraph',attrs:{blockId:'11111111-1111-4111-8111-111111111111'},content:[{type:'text',text:'α: A😀B suffix'}]}]},'default');docs.push(doc);
  const fragment=doc.getXmlFragment('default');const {mapping}=initProseMirrorDoc(fragment,schema);
  const relative=(position:number)=>Buffer.from(Y.encodeRelativePosition(absolutePositionToRelativePosition(position,fragment,mapping))).toString('base64');
  const request:ResolveRequest={state:Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),stateVector:Buffer.from(Y.encodeStateVector(doc)).toString('base64'),relative:{start:relative(4),end:relative(8)}};
  return {doc,fragment,request,relative};
}
it('resolves UTF-16 positions and preserves target across insertion before selected text',()=>{
  const {doc,fragment,request}=fixture();expect(resolveCanvas(request).start.offset).toBe(3);expect(resolveCanvas(request).end.offset).toBe(7);
  const text=(fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;text.insert(0,'new ');
  request.state=Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  expect(()=>resolveCanvas(request)).toThrow('Unsaved');request.stateVector=null;
  expect(resolveCanvas(request).start.offset).toBe(7);expect(resolveCanvas(request).end.offset).toBe(11);
  fragment.delete(0,1);request.state=Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  expect(()=>resolveCanvas(request)).toThrow('Deleted');
});
it('rejects foreign shared types, invalid bytes and structural targets',()=>{
  const {doc,request,relative}=fixture();const other=doc.getText('other');other.insert(0,'private');
  request.state=Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');request.stateVector=null;
  request.relative.start=Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(other,0))).toString('base64');expect(()=>resolveCanvas(request)).toThrow('Wrong');
  request.relative.start='%%%';expect(()=>resolveCanvas(request)).toThrow();
  request.relative.start=relative(0);expect(()=>resolveCanvas(request)).toThrow();
  request.state='';expect(()=>resolveCanvas(request)).toThrow();
});
it('resolves analysis atoms and nested table cell carets',()=>{
  const {doc,relative,request}=fixture({type:'doc',content:[{type:'analysisResult',attrs:{blockId:'a',reference:{},caption:''}},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph'}]}]}]}]});
  request.relative={start:relative(0),end:relative(1)};expect(resolveCanvas(request)).toEqual({start:{blockId:'a',path:[0],offset:0},end:{blockId:'a',path:[0],offset:1}});
  request.relative={start:relative(5),end:relative(5)};expect(resolveCanvas(request).start.path).toEqual([1,0,0,0]);
  expect(doc).toBeTruthy();
});
it('HTTP resolver requires service authorization and returns bounded read-only results',async()=>{
  const config=configuration({COLLABORATION_PORT:'0',COLLABORATION_SERVICE_TOKEN:'k'.repeat(32)});const server=createService(config);await server.listen();
  try {
    const url=`http://127.0.0.1:${server.address.port}/internal/canvas/resolve`;
    expect((await fetch(url,{method:'POST',body:'{}'})).status).toBe(403);
    const {request}=fixture();const headers={'Content-Type':'application/json','X-Collaboration-Service-Token':config.serviceToken};
    expect((await fetch(url,{method:'POST',headers,body:JSON.stringify(request)})).status).toBe(200);
    expect((await fetch(url,{method:'POST',headers,body:'bad'})).status).toBe(409);
    expect((await fetch(url,{method:'POST',headers,body:JSON.stringify({state:'x'.repeat(5_500_000)})})).status).toBe(409);
  } finally {await server.destroy();}
});

it('pins read-only projection targets on the canonical snapshot and rejects mismatched identities',()=>{
  const {request}=fixture();
  const point={blockId:'11111111-1111-4111-8111-111111111111',path:[0],offset:3};
  request.target={kind:'TEXT',start:point,end:{...point,offset:7}};
  expect(resolveCanvas(request).relative).toBeTruthy();
  request.target.start={...point,blockId:'foreign'};expect(()=>resolveCanvas(request)).toThrow('Foreign');
  request.target.start={...point,path:[20]};expect(()=>resolveCanvas(request)).toThrow('Foreign');
  request.target=null;request.relative=undefined;expect(()=>resolveCanvas(request)).toThrow('Missing');
});
it('distinguishes both edges of adjacent analysis atoms, including reader-side pinning',()=>{
  const {request,relative}=fixture({type:'doc',content:[
    {type:'analysisResult',attrs:{blockId:'first',reference:{},caption:''}},
    {type:'analysisResult',attrs:{blockId:'second',reference:{},caption:''}},
    {type:'paragraph'},
  ]});
  request.relative={start:relative(1),end:relative(2)};
  expect(resolveCanvas(request)).toEqual({start:{blockId:'second',path:[1],offset:0},end:{blockId:'second',path:[1],offset:1}});
  request.target={kind:'ANALYSIS',start:{blockId:'second',path:[1],offset:0},end:{blockId:'second',path:[1],offset:1}};
  expect(resolveCanvas(request).relative).toBeTruthy();
});
