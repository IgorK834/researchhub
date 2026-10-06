import { Mark, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

export interface CommentAnchor {
  readonly strategy: 'TEXT_MARK_V1';
  readonly id: string;
  readonly quote: string;
}

function anchorIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
}

/** Marks are mapped by ProseMirror transactions and carried by the existing Yjs fragment. */
export const CommentAnchorMark = Mark.create({
  name: 'commentAnchor',
  inclusive: false,
  keepOnSplit: false,
  addAttributes: () => ({
    ids: {
      default: [],
      parseHTML: (element: HTMLElement) =>
        element.getAttribute('data-comment-anchor')?.split(' ') ?? [],
      renderHTML: (attributes: Record<string, unknown>) => ({
        'data-comment-anchor': anchorIds(attributes['ids']).join(' '),
      }),
    },
  }),
  parseHTML: () => [{ tag: 'span[data-comment-anchor]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
  addProseMirrorPlugins() {
    // A pasted quote is new text, not a second location for someone else's thread.
    const strip = (fragment: Fragment): Fragment =>
      Fragment.fromArray(
        Array.from({ length: fragment.childCount }, (_, index) => {
          const node = fragment.child(index);
          return node.isText
            ? node.mark(node.marks.filter((mark) => mark.type.name !== 'commentAnchor'))
            : node.copy(strip(node.content));
        }),
      );
    return [
      new Plugin({
        props: {
          transformPasted: (slice) =>
            new Slice(strip(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ];
  },
});

export function attachCommentAnchor(editor: Editor): CommentAnchor | null {
  const { from, to } = editor.state.selection;
  const quote = editor.state.doc.textBetween(from, to, '\n');
  if (from === to || !quote.trim() || quote.length > 2000) return null;
  const id = crypto.randomUUID();
  const transaction = editor.state.tr;
  const type = editor.schema.marks['commentAnchor']!;
  editor.state.doc.nodesBetween(from, to, (node, position, parent) => {
    if (!node.isText || !parent?.type.allowsMarkType(type)) return;
    const previous = anchorIds(
      node.marks.find((mark) => mark.type === type)?.attrs['ids'],
    );
    transaction.addMark(
      Math.max(from, position),
      Math.min(to, position + node.nodeSize),
      type.create({ ids: [...previous, id].sort() }),
    );
  });
  if (!transaction.docChanged) return null;
  editor.view.dispatch(transaction);
  return { strategy: 'TEXT_MARK_V1', id, quote };
}

/** Resolves current positions from the tree; never caches offsets across transactions. */
export function commentRange(
  doc: ProseMirrorNode,
  id: string,
): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null;
  doc.descendants((node, position) => {
    if (!node.isText || !node.text?.trim()) return;
    if (
      node.marks.some(
        (mark) =>
          mark.type.name === 'commentAnchor' && anchorIds(mark.attrs['ids']).includes(id),
      )
    ) {
      if (range) range.to = position + node.nodeSize;
      else range = { from: position, to: position + node.nodeSize };
    }
  });
  return range;
}

export function navigateToComment(editor: Editor, id: string): boolean {
  const range = commentRange(editor.state.doc, id);
  if (!range) return false;
  // Focus before selecting: otherwise the DOM observer can restore the previous browser
  // selection while Tiptap's deferred focus is pending (especially beside inline citations).
  editor.view.focus();
  editor.commands.setTextSelection(range);
  const node = editor.view.dom.querySelector<HTMLElement>(
    `[data-comment-anchor~="${id}"]`,
  );
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return true;
}
