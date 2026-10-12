import {afterEach, expect, it} from 'vitest';
import * as Y from 'yjs';
import {prosemirrorJSONToYDoc, yDocToProsemirrorJSON} from 'y-prosemirror';
import {schema} from '../src/schema.js';
import {applyCanvasPatch, type Patch} from '../src/operations.js';
const docs:Y.Doc[]=[];afterEach(()=>{docs.forEach(d=>d.destroy());docs.length=0;});
function fixture(nested=false) {
 const doc=prosemirrorJSONToYDoc(schema,{type:'doc',content:nested ? [{type:'blockquote',content:[{type:'paragraph',attrs:{blockId:'target'},content:[{type:'text',text:'original'}]}]}] : [{type:'paragraph',attrs:{blockId:'target'},content:[{type:'text',text:'original'}]},{type:'paragraph',content:[{type:'text',text:'outside'}]}]},'default');docs.push(doc);
 const before=(yDocToProsemirrorJSON(doc,'default') as any).content;
 const patch:Patch={parent:[],index:0,before:[nested ? before[0].content[0] : before[0]],after:[schema.nodeFromJSON({type:'paragraph',attrs:{blockId:'generated'},content:[{type:'text',text:'generated'}]}).toJSON()],generatedBlocks:['generated']};
 return {doc,patch};
}
it('applies a frozen candidate while preserving remote Y types outside the splice',()=>{
 const {doc,patch}=fixture();const outside=doc.getXmlFragment('default').get(1);
 applyCanvasPatch(doc,patch);expect(doc.getXmlFragment('default').get(1)).toBe(outside);expect(doc.getXmlFragment('default').toString()).toContain('generated');
 expect(()=>applyCanvasPatch(doc,patch)).toThrow('Target stale');
 const inverse={...patch,before:patch.after,after:patch.before};applyCanvasPatch(doc,inverse);expect(doc.getXmlFragment('default').toString()).toContain('original');
});
it('reanchors a moved parent by stable identity and rejects duplicate/missing nodes',()=>{
 const {doc,patch}=fixture(true);applyCanvasPatch(doc,patch);expect(doc.getXmlFragment('default').toString()).toContain('generated');
 const {doc:changed,patch:stale}=fixture();stale.before[0].content[0].text='changed';expect(()=>applyCanvasPatch(changed,stale)).toThrow('Target stale');
});
it('supports revision-pinned untagged targets and rejects invalid structure',()=>{
 const {doc,patch}=fixture();delete patch.before[0].attrs.blockId;
 // Retain exact canonical null identity, as the server does for revision-pinned targets.
 (doc.getXmlFragment('default').get(0) as Y.XmlElement).removeAttribute('blockId');patch.before[0]=schema.nodeFromJSON(patch.before[0]).toJSON();
 applyCanvasPatch(doc,patch);expect(doc.getXmlFragment('default').toString()).toContain('generated');
 expect(()=>applyCanvasPatch(doc,{...patch,before:[]})).toThrow('Invalid patch');
 expect(()=>applyCanvasPatch(doc,{...patch,parent:[99]})).toThrow('Target stale');
});
