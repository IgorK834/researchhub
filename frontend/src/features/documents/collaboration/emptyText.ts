import * as Y from 'yjs';
import type { Schema } from '@tiptap/pm/model';

/** Group empty text-container creation with the author's paragraph insertion in collaborative undo. */
export const EMPTY_TEXT_ORIGIN = {};
/** A shared empty XmlText prevents two writers allocating competing text identities in an empty paragraph. */
export function prepareEmptyText(document: Y.Doc, schema: Schema): void {
  const empty: Y.XmlElement[] = [];
  const visit = (fragment: Y.XmlFragment): void => {
    for (const child of fragment.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (schema.nodes[child.nodeName]?.isTextblock && child.length === 0)
        empty.push(child);
      else visit(child);
    }
  };
  visit(document.getXmlFragment('default'));
  if (empty.length)
    document.transact(
      () => empty.forEach((node) => node.insert(0, [new Y.XmlText()])),
      EMPTY_TEXT_ORIGIN,
    );
}
