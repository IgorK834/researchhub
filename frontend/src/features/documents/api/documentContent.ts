import { getSchema, type Editor, type Extensions, type JSONContent } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { ResearchCitation } from './researchCitation';
import { DocumentFigure, FigureCaption } from './documentFigure';
import { AnalysisResultBlock, validateAnalysisNodes } from './analysisReference';

/**
 * The stored document format, and the one place that decides which nodes and marks it may contain.
 *
 * The backend stores a ProseMirror document node as JSON (`content_format` `PROSEMIRROR_JSON`) and does not
 * interpret authored prose. Reserved analysis references are validated against saved, authorized executions
 * on the server. The editor is Tiptap, so what it produces with `getJSON()` is
 * already that shape — there is no conversion on the way in or out, and in particular no HTML in either
 * direction. What this module adds is the schema both sides agree on, a check that stored content fits it
 * before the editor sees it, and the value a save sends.
 *
 * Kept free of React, so the save payload can be tested against a headless editor.
 */

/** The top-level document node, which is what the backend stores and requires to be a JSON object. */
export interface ProseMirrorDocument extends JSONContent {
  readonly type: 'doc';
}

/**
 * What the editor can express, and therefore what can be saved.
 *
 * StarterKit supplies paragraphs, headings, bold, italic, bullet and numbered lists, undo and redo, and a few
 * block types that cost nothing to keep (quotes, code, rules). Link is turned off: nothing in the toolbar creates
 * one, and an `href` stored in the document is a URL somebody else's browser will eventually follow.
 *
 * The table extensions are Tiptap's own, over `prosemirror-tables`. Column resizing is off, because it stores
 * pixel widths in the document, which is layout rather than content.
 *
 * Adding an extension widens what a saved document may contain, but every document that was valid before is
 * still valid, so it needs no migration. Removing one does the opposite: documents using it would no longer
 * open (see {@link readStoredDocument}), which is the case docs/development/persistence.md calls a new format.
 */
export const documentExtensions: Extensions = [
  StarterKit.configure({ link: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  ResearchCitation,
  DocumentFigure,
  FigureCaption,
  AnalysisResultBlock,
];

const documentSchema = getSchema(documentExtensions);

/**
 * The body of a new document: one empty paragraph.
 *
 * Not an empty `content` array, because a document with no blocks has nowhere to put a cursor. This is also
 * exactly what the textarea editor used to write for empty text, so the two agree.
 */
export const EMPTY_DOCUMENT: ProseMirrorDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads stored content into something the editor can open, or `null` when it cannot.
 *
 * Every document the textarea editor wrote is a `doc` of paragraphs, which fits this schema unchanged, so old
 * documents open as they are and nothing is rewritten.
 *
 * The check exists because of what Tiptap does otherwise: handed content that does not fit its schema, it logs a
 * warning and opens an **empty** document. Saving that would replace somebody's text with nothing. Returning
 * `null` lets the caller refuse to edit instead, and keep the stored content as it is.
 *
 * The value returned is the parsed node serialised again, which is what `getJSON()` would produce for it, so
 * saving a document without touching its body sends back the same thing the editor holds.
 */
export function readStoredDocument(content: unknown): ProseMirrorDocument | null {
  if (!isRecord(content) || content['type'] !== 'doc') {
    return null;
  }

  try {
    validateAnalysisNodes(content);
    const node = documentSchema.nodeFromJSON(content);
    node.check();
    return toSavedDocument(node.toJSON() as JSONContent);
  } catch {
    return null;
  }
}

/**
 * Narrows editor output to the stored shape, and refuses anything else.
 *
 * `getJSON()` always returns a `doc` for this schema, so the throw is a guard against a future change rather
 * than something a user can trigger — but if it ever fired, sending the wrong shape would be worse than not
 * saving.
 */
export function toSavedDocument(json: JSONContent): ProseMirrorDocument {
  if (!isRecord(json) || json.type !== 'doc') {
    throw new Error('The editor did not produce a document node');
  }
  validateAnalysisNodes(json);
  return json as ProseMirrorDocument;
}

/**
 * The value a save sends as `content`: the editor's ProseMirror JSON.
 *
 * `getJSON()`, never `getHTML()`. The stored format is the document tree, and a string of markup would make
 * every future reader of the column a sanitizer.
 */
export function savedDocumentOf(editor: Editor): ProseMirrorDocument {
  return toSavedDocument(editor.getJSON());
}
