/** @jest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor, getSchema } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import Collaboration from '@tiptap/extension-collaboration';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { documentExtensions } from '../api/documentContent';
import { canvasEndpoint, canvasHash, captureCanvasTarget } from './canvasTarget';
const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../contracts/ai/canvas/v1/unicode.json'),
    'utf8',
  ),
);
beforeAll(() => {
  Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle });
});
it('shares Unicode UTF-16 offsets and hashes with Java and Python', async () => {
  const editor = new Editor({ extensions: documentExtensions, content: fixture.content });
  editor.commands.setTextSelection({ from: 4, to: 8 });
  const result = await captureCanvasTarget(editor, editor.state.selection, 3);
  expect(result.target).toEqual(fixture.capture.target);
  expect(await canvasHash('A😀B')).toBe(fixture.capture.target.hash);
  editor.destroy();
});
it('captures caret, empty paragraphs, nested cells and refuses structural atoms', async () => {
  const editor = new Editor({
    extensions: documentExtensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  const caret = await captureCanvasTarget(editor, editor.state.selection, 1);
  expect(caret.target.kind).toBe('CARET');
  expect(caret.target.hash).toBe(await canvasHash('\0'));
  editor.commands.setContent({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: '😀abc' }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  editor.commands.setTextSelection({ from: 4, to: 6 });
  const target = await captureCanvasTarget(editor, editor.state.selection, 1);
  expect(target.target.start.path).toEqual([0, 0, 0, 0]);
  expect(target.target.end.offset).toBe(2);
  expect(() => canvasEndpoint(editor.state.doc, 0)).toThrow();
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(4001) }] }],
  });
  editor.commands.setTextSelection({ from: 1, to: 4002 });
  await expect(captureCanvasTarget(editor, editor.state.selection, 1)).rejects.toThrow(
    '4000',
  );
  editor.destroy();
});
it('captures atom identities and relative positions from the real Yjs binding', async () => {
  const reference = {
    analysisId: crypto.randomUUID(),
    executionId: crypto.randomUUID(),
    outputId: 'chart',
    renderMode: 'CHART',
  };
  const content = {
    type: 'doc',
    content: [
      {
        type: 'analysisResult',
        attrs: { blockId: crypto.randomUUID(), reference, caption: '' },
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'abc' }] },
    ],
  };
  const doc = prosemirrorJSONToYDoc(getSchema(documentExtensions), content, 'default');
  const editor = new Editor({
    extensions: [
      ...documentExtensions.map((e) =>
        e.name === 'starterKit' ? e.configure({ undoRedo: false }) : e,
      ),
      Collaboration.configure({ document: doc }),
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
  );
  const result = await captureCanvasTarget(editor, editor.state.selection, 2, {
    doc,
    epoch: 0,
    sequence: 1,
  });
  expect(result.target.kind).toBe('ANALYSIS');
  expect(result.relative?.start).toBeTruthy();
  expect(result.stateVector).toBeTruthy();
  expect(
    Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(
        Uint8Array.from(atob(result.relative!.start), (c) => c.charCodeAt(0)),
      ),
      doc,
    ),
  ).not.toBeNull();
  editor.destroy();
  doc.destroy();
});
it('selects the correct identity when analysis atoms are adjacent', async () => {
  const reference = {
    analysisId: crypto.randomUUID(),
    executionId: crypto.randomUUID(),
    outputId: 'table',
    renderMode: 'TABLE',
  };
  const second = crypto.randomUUID();
  const editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'analysisResult',
          attrs: { blockId: crypto.randomUUID(), reference, caption: '' },
        },
        { type: 'analysisResult', attrs: { blockId: second, reference, caption: '' } },
        { type: 'paragraph' },
      ],
    },
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)),
  );
  const result = await captureCanvasTarget(editor, editor.state.selection, 1);
  expect(result.target.start).toEqual({ blockId: second, path: [1], offset: 0 });
  expect(result.target.end).toEqual({ blockId: second, path: [1], offset: 1 });
  editor.destroy();
});
it('does not split surrogate pairs at the bounds of caret fingerprints', async () => {
  const before = '😀' + 'x'.repeat(31),
    after = 'x'.repeat(31) + '😀';
  const editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: before + after }] }],
    },
  });
  editor.commands.setTextSelection(before.length + 1);
  const capture = await captureCanvasTarget(editor, editor.state.selection, 1);
  expect(capture.target.hash).toBe(
    await canvasHash('x'.repeat(31) + '\0' + 'x'.repeat(31)),
  );
  editor.destroy();
});
