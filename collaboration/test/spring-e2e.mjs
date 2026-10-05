import {createService} from '../dist/service.js';
import {configuration} from '../dist/config.js';
import {HocuspocusProvider} from '@hocuspocus/provider';
import * as Y from 'yjs';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const tokens=JSON.parse(process.env.E2E_TOKENS), room=process.env.E2E_ROOM;
const config=configuration({...process.env,COLLABORATION_PORT:'0'});
const wait=async condition=>{const end=Date.now()+10000;while(!condition()){if(Date.now()>end)throw Error('E2E timeout');await new Promise(r=>setTimeout(r,10));}};
const clients=[];
let server;
const client=(token,name=room)=>{
 const doc=new Y.Doc();
 const provider=new HocuspocusProvider({url:`ws://127.0.0.1:${server.address.port}`,name,token,document:doc,WebSocketPolyfill:WebSocket});
 const c={doc,provider};clients.push(c);return c;
};
try {
 server=createService(config); await server.listen();
 const a=client(tokens[0]),b=client(tokens[1]); await wait(()=>a.provider.isSynced&&b.provider.isSynced);
 const text=new Y.XmlText();text.insert(0,'Both authors'); a.doc.getXmlFragment('default').get(0).insert(0,[text]);
 b.doc.getMap('metadata').set('title','Simultaneous report');
 await wait(()=>!a.provider.hasUnsyncedChanges&&!b.provider.hasUnsyncedChanges&&b.doc.getXmlFragment('default').toString().includes('Both authors'));
 assert.equal(a.doc.getMap('metadata').get('title'),'Simultaneous report');
 const wrong=client(tokens[0],'document:22222222-2222-2222-2222-222222222222');let denied=false;wrong.provider.on('authenticationFailed',()=>{denied=true;});await wait(()=>denied);
 clients.splice(0).forEach(c=>{c.provider.destroy();c.doc.destroy();}); await server.destroy();
 server=createService(config);await server.listen();const c=client(tokens[0]);await wait(()=>c.provider.isSynced);
 assert.equal(c.doc.getMap('metadata').get('title'),'Simultaneous report');assert.ok(c.doc.getXmlFragment('default').toString().includes('Both authors'));
 console.log('Spring + PostgreSQL + Hocuspocus + two Yjs clients + restart: PASS');
} finally {clients.forEach(c=>{c.provider.destroy();c.doc.destroy();});if(server)await server.destroy();}
