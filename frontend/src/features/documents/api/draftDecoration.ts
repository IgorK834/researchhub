import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export function blockBoundary(doc: Node, block: number): number {
  let position = 0;
  for (let index = 0; index < Math.min(block, doc.childCount); index++) {
    position += doc.child(index).nodeSize;
  }
  return position;
}

/** A view-only widget: never a document node, save payload, history entry or undo step. */
export function draftDecoration(
  host: HTMLElement,
  block: number,
  selectionEnd?: number,
): Plugin {
  return new Plugin({
    key: new PluginKey('authoringDraft'),
    props: {
      decorations: (state) =>
        DecorationSet.create(state.doc, [
          Decoration.widget(
            blockBoundary(
              state.doc,
              selectionEnd === undefined
                ? block
                : state.doc
                    .resolve(Math.min(selectionEnd, state.doc.content.size))
                    .index(0) + 1,
            ),
            () => host,
            {
              side: -1,
              ignoreSelection: true,
              stopEvent: () => true,
            },
          ),
        ]),
    },
  });
}
