import * as Y from 'yjs';
import {schema} from './schema.js';
/** Keep a shared identity for text in empty blocks before any browser becomes editable. */
export function prepareEmptyText(document: Y.Doc): void {
  const visit = (fragment: Y.XmlFragment): void => {
    for (const child of fragment.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (schema.nodes[child.nodeName]?.isTextblock && child.length === 0) child.insert(0,[new Y.XmlText()]);
      else visit(child);
    }
  };
  document.transact(() => visit(document.getXmlFragment('default')));
}
