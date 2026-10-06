import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';

const types = ['paragraph', 'heading', 'codeBlock', 'figure'];
export const BlockIdentity = Extension.create({
  name: 'blockIdentity',
  addGlobalAttributes() {
    return [
      {
        types,
        attributes: {
          blockId: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attrs) =>
              attrs['blockId'] ? { 'data-block-id': attrs['blockId'] } : {},
          },
          importOperationId: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
          originIntent: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
        },
      },
    ];
  },
});
function imported(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isText) return node;
  const content = Fragment.fromArray(
    Array.from({ length: node.childCount }, (_, i) => imported(node.child(i))),
  );
  return node.type.create(
    types.includes(node.type.name)
      ? {
          ...node.attrs,
          blockId: crypto.randomUUID(),
          originIntent: 'IMPORTED',
          importOperationId: crypto.randomUUID(),
        }
      : node.type.name === 'analysisResult'
        ? { ...node.attrs, blockId: crypto.randomUUID() }
        : node.attrs,
    content,
    node.marks,
  );
}
/** Installed in the live editor only. The stored schema alone never invents history for legacy documents. */
export const TrackBlockIdentity = Extension.create({
  name: 'trackBlockIdentity',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (view, _event, slice) => {
            if (!slice.content.size) return false;
            const tr = view.state.tr.replaceSelection(slice);
            const position = tr.selection.$from;
            for (let depth = position.depth; depth > 0; depth--) {
              const node = position.node(depth);
              if (types.includes(node.type.name)) {
                tr.setNodeMarkup(position.before(depth), undefined, {
                  ...node.attrs,
                  blockId: node.attrs['blockId'] ?? crypto.randomUUID(),
                  originIntent: 'IMPORTED',
                  importOperationId: crypto.randomUUID(),
                });
                break;
              }
            }
            view.dispatch(tr.scrollIntoView());
            return true;
          },
          transformPasted: (slice) =>
            new Slice(
              Fragment.fromArray(
                Array.from({ length: slice.content.childCount }, (_, i) =>
                  imported(slice.content.child(i)),
                ),
              ),
              slice.openStart,
              slice.openEnd,
            ),
        },
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged || tr.getMeta('trackBlocks')))
            return null;
          const ids = new Set<string>();
          const tr = state.tr;
          state.doc.descendants((node, position) => {
            if (!types.includes(node.type.name)) return;
            const id = node.attrs['blockId'] as string | null;
            if (!id || ids.has(id)) {
              const fresh = crypto.randomUUID();
              ids.add(fresh);
              tr.setNodeMarkup(position, undefined, { ...node.attrs, blockId: fresh });
            } else ids.add(id);
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
/** Strip nullable schema defaults without changing legacy stored JSON. */
export function stripIdentityDefaults(node: Record<string, unknown>): void {
  const attrs = node['attrs'] as Record<string, unknown> | undefined;
  if (attrs) {
    for (const key of ['blockId', 'originIntent', 'importOperationId'])
      if (attrs[key] === null) delete attrs[key];
    if (Object.keys(attrs).length === 0) delete node['attrs'];
  }
  const content = node['content'];
  if (Array.isArray(content))
    content.forEach((child) => stripIdentityDefaults(child as Record<string, unknown>));
}
