import * as Y from 'yjs';
import { initProseMirrorDoc, updateYFragment } from 'y-prosemirror';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { schema } from './schema.js';

export interface Patch { parent: number[]; index: number; before: Record<string, any>[]; after: Record<string, any>[]; generatedBlocks: string[] }
const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

/** Candidate-only mutation; stable Y types outside the splice survive the ProseMirror diff. */
export function applyCanvasPatch(document: Y.Doc, patch: Patch): Record<string, any> {
  if (!patch || !Array.isArray(patch.parent) || !patch.before.length || !patch.after.length) throw new Error('Invalid patch');
  const fragment = document.getXmlFragment('default');
  const {doc, meta} = initProseMirrorDoc(fragment, schema);
  const root = doc.toJSON();
  let parent = patch.parent, index = patch.index;
  const id = patch.before[0].attrs?.blockId;
  if (id) {
    const paths: number[][] = [];
    const find = (node: any, path: number[]): void => {
      if (node.attrs?.blockId === id) paths.push(path);
      node.content?.forEach((child: any, i: number) => find(child, [...path, i]));
    };
    find(root, []);
    if (paths.length !== 1) throw new Error('Target stale');
    parent = paths[0].slice(0, -1); index = paths[0].at(-1)!;
  }
  let owner = root;
  for (const i of parent) owner = owner.content?.[i];
  if (!owner || !Array.isArray(owner.content) || patch.before.some((node, i) => !same(schema.nodeFromJSON(node).toJSON(), owner.content[index+i]))) throw new Error('Target stale');
  owner.content.splice(index, patch.before.length, ...patch.after);
  const updated: ProseMirrorNode = schema.nodeFromJSON(root); updated.check();
  document.transact(() => updateYFragment(document, fragment, updated, meta), 'canvas-ai');
  return updated.toJSON();
}
