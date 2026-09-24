/**
 * @jest-environment jsdom
 */
import { Editor } from '@tiptap/core';

import {
  documentExtensions,
  EMPTY_DOCUMENT,
  readStoredDocument,
  savedDocumentOf,
  type ProseMirrorDocument,
} from './documentContent';

/**
 * The stored format and the value a save sends.
 *
 * These run a real, headless Tiptap editor with the same extensions the page uses, because the property worth
 * proving is about Tiptap's output: that what would be PATCHed is the ProseMirror tree, with its structure and
 * marks, and not a string of HTML.
 */

let editor: Editor | undefined;

function editorWith(content: ProseMirrorDocument): Editor {
  editor = new Editor({ extensions: documentExtensions, content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** What the textarea editor wrote for "First", "", "Second". Rows like this are already in the database. */
const PARAGRAPHS_FROM_THE_TEXTAREA = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
  ],
};

describe('the save payload', () => {
  it('is a document object, not a string of HTML', () => {
    const payload = savedDocumentOf(editorWith(EMPTY_DOCUMENT));

    expect(typeof payload).toBe('object');
    expect(payload.type).toBe('doc');
    expect(Array.isArray(payload.content)).toBe(true);
  });

  it('keeps a heading, a bold mark, and a list item', () => {
    const tiptap = editorWith(EMPTY_DOCUMENT);
    tiptap
      .chain()
      .setContent('')
      .insertContent({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Method' }],
      })
      .run();
    tiptap.commands.insertContentAt(tiptap.state.doc.content.size, {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Measured with ' },
        { type: 'text', text: 'care', marks: [{ type: 'bold' }] },
      ],
    });
    tiptap.commands.insertContentAt(tiptap.state.doc.content.size, {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Ten samples' }] },
          ],
        },
      ],
    });

    const payload = savedDocumentOf(tiptap);
    const serialised = JSON.stringify(payload);

    expect(payload.content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Method' }],
    });
    expect(payload.content).toContainEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Measured with ' },
        { type: 'text', text: 'care', marks: [{ type: 'bold' }] },
      ],
    });
    expect(payload.content).toContainEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Ten samples' }] },
          ],
        },
      ],
    });
    // No markup anywhere in what would be sent.
    expect(serialised).not.toMatch(/<\/?(h2|strong|ul|li|p)>/);
  });

  it('survives a reopen: the saved value opens to the same document', () => {
    const tiptap = editorWith(EMPTY_DOCUMENT);
    tiptap.commands.insertContent('Bold words');
    tiptap.commands.selectAll();
    tiptap.commands.toggleBold();
    tiptap.commands.setHeading({ level: 1 });
    const saved = savedDocumentOf(tiptap);
    tiptap.destroy();

    const reopened = readStoredDocument(JSON.parse(JSON.stringify(saved)));

    expect(reopened).toEqual(saved);
    expect(savedDocumentOf(editorWith(reopened ?? EMPTY_DOCUMENT))).toEqual(saved);
  });

  it('keeps a table the toolbar inserts', () => {
    const tiptap = editorWith(EMPTY_DOCUMENT);
    tiptap.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });

    const table = savedDocumentOf(tiptap).content?.find((node) => node.type === 'table');

    expect(table?.content).toHaveLength(2);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(table?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it('keeps text that looks like markup as text', () => {
    const tiptap = editorWith(EMPTY_DOCUMENT);
    tiptap.commands.insertContent({ type: 'text', text: '<b>not bold</b> & <script>' });

    expect(savedDocumentOf(tiptap).content?.[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '<b>not bold</b> & <script>' }],
    });
  });
});

describe('readStoredDocument', () => {
  it('opens a paragraph-only document from the textarea editor unchanged', () => {
    expect(readStoredDocument(PARAGRAPHS_FROM_THE_TEXTAREA)).toEqual(
      PARAGRAPHS_FROM_THE_TEXTAREA,
    );
  });

  it('opens it in the editor without losing a paragraph, including the empty one', () => {
    const opened = readStoredDocument(PARAGRAPHS_FROM_THE_TEXTAREA);

    expect(opened).not.toBeNull();
    expect(savedDocumentOf(editorWith(opened ?? EMPTY_DOCUMENT))).toEqual(
      PARAGRAPHS_FROM_THE_TEXTAREA,
    );
  });

  it('opens the empty document a new one is created with', () => {
    expect(readStoredDocument(EMPTY_DOCUMENT)).toEqual(EMPTY_DOCUMENT);
  });

  it('refuses content that is not a document rather than throwing', () => {
    expect(readStoredDocument(undefined)).toBeNull();
    expect(readStoredDocument(null)).toBeNull();
    expect(readStoredDocument('<p>html</p>')).toBeNull();
    expect(readStoredDocument([1, 2, 3])).toBeNull();
    expect(readStoredDocument({})).toBeNull();
    expect(readStoredDocument({ type: 'paragraph' })).toBeNull();
  });

  it('refuses a node the schema does not know, instead of letting the editor open it empty', () => {
    // Tiptap would log a warning and show an empty document. Saving that would erase the stored text.
    expect(
      readStoredDocument({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] },
          { type: 'image', attrs: { src: 'diagram.png' } },
        ],
      }),
    ).toBeNull();
  });

  it('refuses an empty text node, which is invalid ProseMirror', () => {
    expect(
      readStoredDocument({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
      }),
    ).toBeNull();
  });
});
