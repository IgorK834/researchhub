import type { Editor } from '@tiptap/core';
import type { Citation } from '../../ai/api/generationApi';
import { commentRange } from './commentAnchor';
import type { EditorCitation } from '../api/researchCitation';

/** Resolve the live CRDT mark at click time, never the offsets at inference time. */
export function insertCommentCitation(
  editor: Editor,
  anchorId: string,
  citation: Citation,
): boolean {
  const range = commentRange(editor.state.doc, anchorId);
  if (!range || !editor.isEditable) return false;
  const metadata: EditorCitation = {
    ...citation,
    schemaVersion: '1.0',
    citationId: `c:${citation.chunkId}`,
    label: (citation.title || 'Source').slice(0, 200),
    displayStyle: 'NUMERIC',
    locator: {
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      sectionTitle: citation.sectionTitle,
    },
  };
  const adjacent = editor.state.doc.nodeAt(range.to);
  if (
    adjacent?.type.name === 'researchCitation' &&
    (adjacent.attrs['citation'] as EditorCitation).chunkId === citation.chunkId
  )
    return true;
  return editor
    .chain()
    .focus()
    .insertContentAt(range.to, {
      type: 'researchCitation',
      attrs: { citation: metadata },
    })
    .run();
}
