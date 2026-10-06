/** @jest-environment jsdom */
import { Editor, getSchema } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import {
  documentExtensions,
  readStoredDocument,
  savedDocumentOf,
} from '../api/documentContent';
import { TrackBlockIdentity, stripIdentityDefaults } from './blockIdentity';
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function create(content: any, doc?: Y.Doc): Editor {
  const editor = new Editor({
    extensions: [
      ...documentExtensions.map((extension) =>
        extension.name === 'starterKit' && doc
          ? extension.configure({ undoRedo: false })
          : extension,
      ),
      TrackBlockIdentity,
      ...(doc ? [Collaboration.configure({ document: doc })] : []),
    ],
    ...(doc ? {} : { content }),
  });
  editors.push(editor);
  return editor;
}
it('never rewrites an untouched legacy document; tracks stable block identities on real edits, reload and splitting', () => {
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Human claim' }] }],
  };
  const editor = create(content);
  expect(savedDocumentOf(editor)).toEqual(content);
  editor.commands.setTextSelection(2);
  expect(savedDocumentOf(editor)).toEqual(content);
  editor.commands.insertContentAt(1, 'New ');
  const id = editor.getJSON().content![0]!.attrs!['blockId'];
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  editor.commands.insertContentAt(2, 'More ');
  expect(editor.getJSON().content![0]!.attrs!['blockId']).toBe(id);
  const reloaded = create(readStoredDocument(savedDocumentOf(editor)));
  expect(reloaded.getJSON().content![0]!.attrs!['blockId']).toBe(id);
  editor.commands.setTextSelection(6);
  editor.commands.splitBlock();
  const ids = editor.getJSON().content!.map((node) => node.attrs?.['blockId']);
  expect(new Set(ids).size).toBe(ids.length);
  expect(editor.getHTML()).toContain('data-block-id');
});
it('clipboard import retains formatting but assigns fresh identities and declares only import, including empty blocks', () => {
  const editor = create({ type: 'doc', content: [{ type: 'paragraph' }] });
  const original = getSchema(documentExtensions).nodeFromJSON({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        content: [{ type: 'text', text: 'Imported', marks: [{ type: 'bold' }] }],
      },
      { type: 'codeBlock' },
    ],
  });
  let slice = new Slice(original.content, 0, 0);
  editor.view.someProp('transformPasted', (transform) => {
    slice = transform(slice, editor.view, false);
    return false;
  });
  expect(slice.content.firstChild!.attrs['blockId']).not.toBe(
    original.firstChild!.attrs['blockId'],
  );
  expect(slice.content.firstChild!.attrs['originIntent']).toBe('IMPORTED');
  expect(slice.content.firstChild!.firstChild!.marks[0]!.type.name).toBe('bold');
  editor.commands.insertContent(slice.content.toJSON());
  expect(savedDocumentOf(editor).content![0]!.attrs!['originIntent']).toBe('IMPORTED');
});
it('replicates identities and imported origins across Yjs clients and binary restart', () => {
  const schema = getSchema(documentExtensions);
  const a = prosemirrorJSONToYDoc(
    schema,
    {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claim' }] }],
    },
    'default',
  );
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const first = create(null, a),
    peer = create(null, b);
  first.commands.insertContentAt(1, 'Nearby ');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(savedDocumentOf(peer)).toEqual(savedDocumentOf(first));
  const restarted = new Y.Doc();
  Y.applyUpdate(restarted, Y.encodeStateAsUpdate(b));
  const recovery = create(null, restarted);
  expect(savedDocumentOf(recovery)).toEqual(savedDocumentOf(first));
  a.destroy();
  b.destroy();
  restarted.destroy();
});
it('drops only nullable schema defaults and keeps an explicit identity', () => {
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: null, originIntent: null } },
      { type: 'heading', attrs: { blockId: 'id', originIntent: null, level: 2 } },
    ],
  };
  stripIdentityDefaults(content);
  expect(content.content[0]!.attrs).toBeUndefined();
  expect(content.content[1]!.attrs).toEqual({ blockId: 'id', level: 2 });
});

it('records inline clipboard insertion as a new import operation while retaining the existing block identity', () => {
  const editor = create({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        content: [{ type: 'text', text: 'Claim' }],
      },
    ],
  });
  editor.commands.setTextSelection(3);
  const paste = (slice: Slice) =>
    editor.view.someProp('handlePaste', (handle) =>
      handle(editor.view, new Event('paste') as ClipboardEvent, slice),
    );
  expect(paste(Slice.empty)).toBeFalsy();
  const slice = new Slice(Fragment.from(editor.schema.text('pasted')), 0, 0);
  expect(paste(slice)).toBe(true);
  const attrs = editor.getJSON().content![0]!.attrs!;
  expect(attrs['blockId']).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(attrs['originIntent']).toBe('IMPORTED');
  const first = attrs['importOperationId'];
  expect(first).toMatch(/^[a-f0-9-]{36}$/);
  expect(paste(slice)).toBe(true);
  expect(editor.getJSON().content![0]!.attrs!['importOperationId']).not.toBe(first);
  editor.commands.insertContent('human');
  expect(editor.getJSON().content![0]!.attrs!['originIntent']).toBe('IMPORTED');
});
it('repairs duplicate clipboard identities and avoids generating another transaction when nothing changed', () => {
  const editor = create({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } },
      { type: 'paragraph', attrs: { blockId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } },
    ],
  });
  editor.view.dispatch(editor.state.tr.setMeta('trackBlocks', true));
  const ids = editor.getJSON().content!.map((node) => node.attrs!['blockId']);
  expect(new Set(ids).size).toBe(2);
  editor.view.dispatch(editor.state.tr.setMeta('trackBlocks', true));
  expect(editor.getJSON().content!.map((node) => node.attrs!['blockId'])).toEqual(ids);
});
