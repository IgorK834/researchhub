import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {prosemirrorJSONToYDoc, yDocToProsemirrorJSON} from 'y-prosemirror';
import type {State} from './backend.js';
import {schema} from './schema.js';

const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const stateHash = (state: Uint8Array): string => createHash('sha256').update(state).digest('hex');
export function editorSnapshot(document: Y.Doc): {title: string; content: unknown} {
  const content = yDocToProsemirrorJSON(document, 'default');
  schema.nodeFromJSON(content).check();
  const title = document.getMap('metadata').get('title');
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw new Error('Invalid title');
  // Match the domain title normalization without rewriting the user's live Y.Map while typing.
  return {title: title.trim(), content};
}
/** Reconstruct into a temporary document before exposing any state to room clients. */
export function reconstruct(snapshot: State): Y.Doc {
  const document = new Y.Doc();
  try {
    if (snapshot.state === null) {
      if (snapshot.sequence !== 0) throw new Error('Committed snapshot is missing');
      const content = JSON.parse(snapshot.content);
      schema.nodeFromJSON(content).check();
      const seed = prosemirrorJSONToYDoc(schema, content, 'default');
      try { Y.applyUpdate(document, Y.encodeStateAsUpdate(seed)); } finally {seed.destroy();}
      document.getMap('metadata').set('title', snapshot.title);
    } else {
      const bytes = Buffer.from(snapshot.state, 'base64');
      if (stateHash(bytes) !== snapshot.stateSha256) throw new Error('Snapshot integrity check failed');
      Y.applyUpdate(document, bytes);
      const editor = editorSnapshot(document);
      if (editor.title !== snapshot.title || JSON.stringify(ordered(schema.nodeFromJSON(editor.content).toJSON())) !== JSON.stringify(ordered(schema.nodeFromJSON(JSON.parse(snapshot.content)).toJSON()))) {
        throw new Error('Snapshot projection does not match binary state');
      }
    }
    editorSnapshot(document);
    return document;
  } catch (error) { document.destroy(); throw error; }
}
