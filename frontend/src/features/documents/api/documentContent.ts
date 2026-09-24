/**
 * Conversion between the plain text a textarea holds and the ProseMirror JSON a document stores.
 *
 * This exists because the storage format is chosen for where the editor is going, not for where it is. The
 * backend stores a ProseMirror document node (docs/context.md section 9 names Tiptap and ProseMirror as the
 * eventual editor), so writing that shape from the start means introducing the real editor later will not need
 * a data migration. Until then the UI is a textarea, and these two functions are the whole adapter.
 *
 * Deliberately not a ProseMirror dependency, and deliberately not HTML. A round trip through here keeps
 * paragraph breaks and nothing else, which is honest about what the current UI can edit — silently dropping
 * marks a user cannot see would be worse than not supporting them.
 */

/** A ProseMirror text node. */
interface TextNode {
  readonly type: 'text';
  readonly text: string;
}

/** A ProseMirror paragraph. Omits `content` entirely when empty: an empty text node is not valid. */
interface ParagraphNode {
  readonly type: 'paragraph';
  readonly content?: readonly TextNode[];
}

/** The top-level document node, which is what the backend stores and requires to be a JSON object. */
export interface ProseMirrorDocument {
  readonly type: 'doc';
  readonly content: readonly ParagraphNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds a document from textarea text. Each line becomes a paragraph.
 *
 * Empty input still produces one empty paragraph rather than an empty document, because a document with no
 * blocks has nowhere to put a cursor — the same reason an editor always shows at least one line.
 */
export function toProseMirrorDocument(text: string): ProseMirrorDocument {
  const lines = text.split('\n');

  return {
    type: 'doc',
    content: lines.map((line) =>
      line.length === 0
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] },
    ),
  };
}

/**
 * Reads the text back out of a stored document.
 *
 * Tolerant by design: the content is `unknown` because it arrives as arbitrary JSON, and an editor that threw
 * on an unfamiliar node would lock a user out of their own document. Anything it does not recognise
 * contributes no text, and paragraph boundaries become newlines.
 */
export function toPlainText(content: unknown): string {
  if (!isRecord(content) || !Array.isArray(content['content'])) {
    return '';
  }

  return (content['content'] as readonly unknown[])
    .map((block) => textOfBlock(block))
    .join('\n');
}

function textOfBlock(block: unknown): string {
  if (!isRecord(block) || !Array.isArray(block['content'])) {
    return '';
  }

  return (block['content'] as readonly unknown[])
    .map((child) =>
      isRecord(child) && typeof child['text'] === 'string' ? child['text'] : '',
    )
    .join('');
}
