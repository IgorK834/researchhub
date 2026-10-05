import {afterEach, expect, it} from 'vitest';
import {Awareness, applyAwarenessUpdate} from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {PresenceGuard} from '../src/presence.js';
const docs: Y.Doc[] = [];
const user = {userId:'author', displayName:'Author', colorId:'blue'};
function fixture() { const doc = new Y.Doc(); docs.push(doc); const awareness = new Awareness(doc); awareness.setLocalState(null); return {guard:new PresenceGuard(), awareness}; }
afterEach(()=>docs.splice(0).forEach(doc=>doc.destroy()));
const payload = (client:number, clock:number, state:unknown) => {
 const writer=encoding.createEncoder(); encoding.writeVarUint(writer,1); encoding.writeVarUint(writer,client); encoding.writeVarUint(writer,clock); encoding.writeVarString(writer,JSON.stringify(state)); return encoding.toUint8Array(writer);
};
it('binds a client to its session, accepts only canonical identity and relative cursor positions, and releases it on disconnect',()=>{
 const {guard,awareness}=fixture();
 for (const state of [{}, {user}, {user,cursor:null}, {user,cursor:{anchor:{type:{client:3,clock:2},item:null,tname:null,assoc:-1},head:{type:null,item:{client:3,clock:1},assoc:0}}}, {user,cursor:{anchor:{tname:'default'},head:{tname:'default',assoc:1}}}, null]) {
  expect(()=>guard.validate(payload(1,1,state),'a',user,awareness)).not.toThrow();
 }
 guard.disconnect('a'); guard.disconnect('unknown');
 expect(()=>guard.validate(payload(1,2,{user}),'b',user,awareness)).not.toThrow();
});
it('cannot forge identity, include private fields, malformed selection, or unlimited awareness data',()=>{
 const {guard,awareness}=fixture();
 for(const state of [[], 3, {email:'secret@test'}, {user:null}, {user:{...user,email:'secret@test'}}, {user:{...user,userId:'victim'}}, {user:{...user,displayName:'Victim'}}, {user:{...user,colorId:'red'}}, {cursor:{}}, {user,cursor:[]}, {user,cursor:{anchor:null,head:{}}}, {user,cursor:{anchor:{item:{client:-1,clock:1}},head:{}}}, {user,cursor:{anchor:{type:{client:1,clock:'2'}},head:{}}}, {user,cursor:{anchor:{tname:'private'},head:{}}}, {user,cursor:{anchor:{assoc:2},head:{}}}, {user,cursor:{anchor:{url:'https://evil'},head:{}}}, {user,cursor:{anchor:{},head:{},email:'secret'}}]) {
  expect(()=>guard.validate(payload(1,1,state),'a',user,awareness)).toThrow();
 }
 expect(()=>guard.validate(new Uint8Array(16_385),'a',user,awareness)).toThrow();
 expect(()=>guard.validate(new Uint8Array([65]),'a',user,awareness)).toThrow();
 expect(()=>guard.validate(payload(0x100000000,1,{user}),'a',user,awareness)).toThrow();
 const valid=payload(1,1,{user}); expect(()=>guard.validate(new Uint8Array([...valid,1]),'a',user,awareness)).toThrow();
});
it('permits harmless provider echoes but prevents takeover, remote removal and a second client identity per socket',()=>{
 const {guard,awareness}=fixture();
 const original=payload(1,3,{user});guard.validate(original,'a',user,awareness);applyAwarenessUpdate(awareness,original,null);
 expect(()=>guard.validate(original,'b',user,awareness)).not.toThrow();
 expect(()=>guard.validate(payload(1,2,null),'b',user,awareness)).not.toThrow();
 for (const update of [payload(1,3,null),payload(1,4,{user}),payload(3,2,null)]) expect(()=>guard.validate(update,'b',user,awareness)).toThrow();
 expect(()=>guard.validate(payload(2,1,{user}),'a',user,awareness)).toThrow();
});
