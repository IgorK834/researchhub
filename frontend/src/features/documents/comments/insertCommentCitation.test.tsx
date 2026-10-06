/** @jest-environment jsdom */
import { Editor, getSchema } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { documentExtensions } from '../api/documentContent';
import { attachCommentAnchor, commentRange } from './commentAnchor';
import { insertCommentCitation } from './insertCommentCitation';
import type { Citation } from '../../ai/api/generationApi';

const content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Nearby Evidence text' }] },
  ],
};
const citation: Citation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: 'v',
  chunkId: 'b'.repeat(64),
  contentHash: 'a'.repeat(64),
  processingVersion: 'v1',
  pageStart: null,
  pageEnd: null,
  sectionTitle: 'Theory',
  spans: [],
  title: null,
};
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
it('inserts at the current marked text, retains provenance and never duplicates an adjacent citation on retry', () => {
  const editor = new Editor({ extensions: documentExtensions, content });
  editors.push(editor);
  editor.commands.setTextSelection({ from: 8, to: 16 });
  const anchor = attachCommentAnchor(editor)!;
  editor.commands.insertContentAt(1, 'New ');
  expect(insertCommentCitation(editor, anchor.id, citation)).toBe(true);
  expect(editor.state.doc.textContent).toBe('New Nearby Evidence text');
  const to = commentRange(editor.state.doc, anchor.id)!.to;
  const inserted = editor.state.doc.nodeAt(to)!;
  expect(inserted.type.name).toBe('researchCitation');
  expect(inserted.attrs['citation']).toEqual(
    expect.objectContaining({
      ...citation,
      schemaVersion: '1.0',
      citationId: `c:${citation.chunkId}`,
      displayStyle: 'NUMERIC',
      label: 'Source',
    }),
  );
  const snapshot = editor.getJSON();
  expect(insertCommentCitation(editor, anchor.id, citation)).toBe(true);
  expect(editor.getJSON()).toEqual(snapshot);
  expect(insertCommentCitation(editor, 'missing', citation)).toBe(false);
  editor.setEditable(false);
  expect(insertCommentCitation(editor, anchor.id, citation)).toBe(false);
});
it('replicates explicit insertion to another Yjs editor and survives a binary reload with its source version', () => {
  const schema = getSchema(documentExtensions);
  const a = prosemirrorJSONToYDoc(schema, content, 'default'),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const create = (doc: Y.Doc): Editor => {
    const editor = new Editor({
      extensions: [
        ...documentExtensions.map((extension) =>
          extension.name === 'starterKit'
            ? extension.configure({ undoRedo: false })
            : extension,
        ),
        Collaboration.configure({ document: doc }),
      ],
    });
    editors.push(editor);
    return editor;
  };
  const owner = create(a),
    peer = create(b);
  owner.commands.setTextSelection({ from: 8, to: 16 });
  const anchor = attachCommentAnchor(owner)!;
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  peer.commands.insertContentAt(1, 'Peer ');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  expect(
    insertCommentCitation(owner, anchor.id, { ...citation, title: 'Source title' }),
  ).toBe(true);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(peer.getJSON()).toEqual(owner.getJSON());
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, Y.encodeStateAsUpdate(a));
  const reloaded = create(recovered);
  expect(reloaded.getJSON()).toEqual(owner.getJSON());
  expect(
    reloaded.state.doc.nodeAt(commentRange(reloaded.state.doc, anchor.id)!.to)!.attrs[
      'citation'
    ].sourceVersionId,
  ).toBe('v');
  editors.splice(0).forEach((editor) => editor.destroy());
  a.destroy();
  b.destroy();
  recovered.destroy();
});
