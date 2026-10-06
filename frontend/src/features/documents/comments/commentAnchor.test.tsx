/** @jest-environment jsdom */
import { Editor, getSchema } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { Fragment, Slice } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  documentExtensions,
  readStoredDocument,
  type ProseMirrorDocument,
} from '../api/documentContent';
import { DocumentBodyEditor } from '../components/DocumentBodyEditor';
import { attachCommentAnchor, commentRange, navigateToComment } from './commentAnchor';

const content: ProseMirrorDocument = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Nearby Evidence text' }] },
  ],
};
const editors: Editor[] = [];
function create(initialContent = content): Editor {
  const editor = new Editor({ extensions: documentExtensions, content: initialContent });
  editors.push(editor);
  return editor;
}
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(100, 200, 100, 20);
  Range.prototype.getClientRects = () =>
    [new DOMRect(100, 200, 100, 20)] as unknown as DOMRectList;
});
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

it('maps a structured anchor through nearby and partial edits, save/reload, deletion and undo', () => {
  const editor = create();
  editor.commands.setTextSelection({ from: 8, to: 16 });
  const anchor = attachCommentAnchor(editor)!;
  expect(anchor.quote).toBe('Evidence');
  editor.commands.insertContentAt(1, 'New ');
  expect(commentRange(editor.state.doc, anchor.id)).toEqual({ from: 12, to: 20 });
  editor.commands.setTextSelection({ from: 12, to: 14 });
  editor.commands.deleteSelection();
  expect(commentRange(editor.state.doc, anchor.id)).toEqual({ from: 12, to: 18 });
  const reloaded = create(readStoredDocument(editor.getJSON())!);
  expect(commentRange(reloaded.state.doc, anchor.id)).toEqual({ from: 12, to: 18 });
  const scroll = jest.fn();
  reloaded.view.dom.querySelector('span')!.scrollIntoView = scroll;
  expect(navigateToComment(reloaded, anchor.id)).toBe(true);
  expect(scroll).toHaveBeenCalled();
  reloaded.commands.deleteSelection();
  expect(commentRange(reloaded.state.doc, anchor.id)).toBeNull();
  expect(navigateToComment(reloaded, anchor.id)).toBe(false);
  reloaded.commands.undo();
  expect(commentRange(reloaded.state.doc, anchor.id)).not.toBeNull();
});

it('preserves overlapping anchors across two Yjs clients, concurrent edits and a binary reload', () => {
  const schema = getSchema(documentExtensions);
  const a = prosemirrorJSONToYDoc(schema, content, 'default');
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const make = (doc: Y.Doc): Editor =>
    new Editor({
      extensions: [
        ...documentExtensions.map((extension) =>
          extension.name === 'starterKit'
            ? extension.configure({ undoRedo: false })
            : extension,
        ),
        Collaboration.configure({ document: doc }),
      ],
    });
  const editorA = make(a),
    editorB = make(b);
  editorA.commands.setTextSelection({ from: 8, to: 16 });
  const first = attachCommentAnchor(editorA)!;
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  editorB.commands.setTextSelection({ from: 12, to: 20 });
  const second = attachCommentAnchor(editorB)!;
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  editorA.commands.insertContentAt(1, 'A ');
  editorB.commands.insertContentAt(20, ' B');
  const ua = Y.encodeStateAsUpdate(a),
    ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
  expect(editorA.getJSON()).toEqual(editorB.getJSON());
  for (const id of [first.id, second.id]) {
    expect(commentRange(editorA.state.doc, id)).not.toBeNull();
    expect(commentRange(editorB.state.doc, id)).toEqual(
      commentRange(editorA.state.doc, id),
    );
  }
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, Y.encodeStateAsUpdate(a));
  const reloaded = make(recovered);
  expect(reloaded.getJSON()).toEqual(editorA.getJSON());
  expect(commentRange(reloaded.state.doc, second.id)).not.toBeNull();
  editorA.destroy();
  editorB.destroy();
  reloaded.destroy();
  a.destroy();
  b.destroy();
  recovered.destroy();
});

it('strips thread identities on paste while preserving formatting and nested nodes', () => {
  const editor = create();
  editor.commands.setTextSelection({ from: 8, to: 16 });
  attachCommentAnchor(editor);
  editor.commands.setBold();
  const paragraph = editor.state.doc.firstChild!;
  let pasted = new Slice(Fragment.from(paragraph), 0, 0);
  editor.view.someProp('transformPasted', (transform) => {
    pasted = transform(pasted, editor.view, false);
  });
  expect(JSON.stringify(pasted.content.toJSON())).not.toContain('commentAnchor');
  expect(JSON.stringify(pasted.content.toJSON())).toContain('bold');
  expect(editor.getJSON()).toEqual(
    create(editor.getHTML() as unknown as ProseMirrorDocument).getJSON(),
  );
});

it('handles empty, too long, whitespace, code and malformed anchors without throwing', () => {
  const editor = create();
  expect(attachCommentAnchor(editor)).toBeNull();
  const long = create({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(2001) }] }],
  });
  long.commands.selectAll();
  expect(attachCommentAnchor(long)).toBeNull();
  const whitespace = create({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
  });
  whitespace.commands.selectAll();
  expect(attachCommentAnchor(whitespace)).toBeNull();
  const code = create({
    type: 'doc',
    content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }],
  });
  code.commands.selectAll();
  expect(attachCommentAnchor(code)).toBeNull();
  const invalid = create({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'text',
            marks: [{ type: 'commentAnchor', attrs: { ids: 42 } }],
          },
        ],
      },
    ],
  });
  expect(commentRange(invalid.state.doc, 'missing')).toBeNull();
  expect(navigateToComment(invalid, 'missing')).toBe(false);
});

it('offers a keyboard-accessible add-comment selection action and publishes the live editor', () => {
  const onComment = jest.fn(),
    ready = jest.fn();
  const view = render(
    <DocumentBodyEditor
      initialContent={content}
      editable
      onChange={jest.fn()}
      label="Review text"
      onComment={onComment}
      onEditorReady={ready}
    />,
  );
  const editor = ready.mock.calls[0]![0] as Editor;
  act(() => editor.commands.setTextSelection({ from: 8, to: 16 }));
  const action = screen.getByRole('button', { name: 'Add comment' });
  fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
  expect(document.activeElement).toBe(action);
  fireEvent.click(action);
  expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ quote: 'Evidence' }));
  expect(commentRange(editor.state.doc, onComment.mock.calls[0]![0].id)).not.toBeNull();
  view.unmount();
  expect(ready).toHaveBeenLastCalledWith(null);
});
