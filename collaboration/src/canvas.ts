import * as Y from 'yjs';
import { absolutePositionToRelativePosition, initProseMirrorDoc, relativePositionToAbsolutePosition } from 'y-prosemirror';
import type { Node } from '@tiptap/pm/model';
import { schema } from './schema.js';

interface Endpoint { blockId: string | null; path: number[]; offset: number }
export interface ResolveRequest { state: string; relative?: { start: string; end: string }; target?: {kind: string;start:Endpoint;end:Endpoint} | null; stateVector: string | null }
const base64 = (value: unknown, max: number): Uint8Array => {
  if (typeof value !== 'string' || !value.length || value.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid encoding');
  return Buffer.from(value, 'base64');
};
function endpoint(doc: Node, position: number, end = false): Endpoint {
  let result: Endpoint | undefined;
  const visit = (node: Node, start: number, path: number[]): void => {
    if (result) return;
    if (node.type.name === 'analysisResult' && (end ? position > start && position <= start + 1 : position >= start && position < start + 1))
      result = { blockId: node.attrs.blockId ?? null, path, offset: position - start };
    else if (node.isTextblock && position >= start + 1 && position <= start + 1 + node.content.size)
      result = { blockId: node.attrs.blockId ?? null, path, offset: position - start - 1 };
    else node.forEach((child, offset, index) => visit(child, start + 1 + offset, [...path, index]));
  };
  visit(doc, -1, []);
  if (!result) throw new Error('Target is not a text block or result');
  return result;
}
/** Pure read: never initializes a room, accepts live browser snapshots, broadcasts or executes code. */
export function resolveCanvas(request: ResolveRequest): { start: Endpoint; end: Endpoint; relative?: {start:string;end:string} } {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, base64(request.state, 5_333_336));
    if (request.stateVector !== null && !Buffer.from(Y.encodeStateVector(doc)).equals(Buffer.from(base64(request.stateVector, 65536)))) throw new Error('Unsaved state');
    const fragment = doc.getXmlFragment('default');
    const projection = initProseMirrorDoc(fragment, schema);
    const resolve = (value: string, end = false): Endpoint => {
      const relative = Y.decodeRelativePosition(base64(value, 1024));
      const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
      if (!absolute) throw new Error('Deleted target');
      let parent: Y.AbstractType<any> | null = absolute.type;
      while (parent && parent !== fragment) parent = parent.parent;
      if (parent !== fragment) throw new Error('Wrong shared type');
      const pos = relativePositionToAbsolutePosition(doc, fragment, relative, projection.mapping);
      if (pos === null) throw new Error('Deleted target');
      return endpoint(projection.doc, pos, end);
    };
    if (request.target) {
      const position = (point: Endpoint): number => {
        let node = projection.doc, start = -1;
        for (const index of point.path) {
          if (!Number.isInteger(index) || index < 0 || index >= node.childCount) throw new Error('Foreign path');
          let offset = 0; for(let i=0;i<index;i++) offset += node.child(i).nodeSize;
          start += 1 + offset; node = node.child(index);
        }
        const result = start + (request.target!.kind === 'ANALYSIS' ? 0 : 1) + point.offset;
        const checked = endpoint(projection.doc,result,request.target!.kind === 'ANALYSIS' && point.offset === 1);
        if (checked.blockId !== point.blockId || checked.offset !== point.offset || JSON.stringify(checked.path) !== JSON.stringify(point.path)) throw new Error('Foreign target');
        return result;
      };
      const encode = (point: Endpoint): string => Buffer.from(Y.encodeRelativePosition(absolutePositionToRelativePosition(position(point),fragment,projection.mapping))).toString('base64');
      const relative = {start:encode(request.target.start),end:encode(request.target.end)};
      return {start:resolve(relative.start),end:resolve(relative.end,true),relative};
    }
    if(!request.relative) throw new Error('Missing relative target');
    return { start: resolve(request.relative.start), end: resolve(request.relative.end,true) };
  } finally { doc.destroy(); }
}
