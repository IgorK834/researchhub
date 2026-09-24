import { toPlainText, toProseMirrorDocument } from './documentContent';

/**
 * The adapter between a textarea and the stored ProseMirror JSON.
 *
 * Tested on its own because it is the one piece of the document feature with rules of its own, and because both
 * directions have a failure mode that is invisible in the UI: an empty paragraph written as an empty text node
 * is invalid ProseMirror, and content the reader does not recognise must not throw and lock somebody out of
 * their own document.
 */
describe('toProseMirrorDocument', () => {
  it('makes a paragraph out of a line of text', () => {
    expect(toProseMirrorDocument('Measurements')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Measurements' }] }],
    });
  });

  it('makes one paragraph per line', () => {
    const document = toProseMirrorDocument('First\nSecond');

    expect(document.content).toHaveLength(2);
    expect(document.content[0]?.content?.[0]?.text).toBe('First');
    expect(document.content[1]?.content?.[0]?.text).toBe('Second');
  });

  it('writes an empty line as a paragraph with no content at all', () => {
    const document = toProseMirrorDocument('Above\n\nBelow');

    // Not `{ type: 'text', text: '' }`: an empty text node is invalid ProseMirror, and the editor that
    // eventually loads this would reject the document.
    expect(document.content[1]).toEqual({ type: 'paragraph' });
    expect(document.content).toHaveLength(3);
  });

  it('produces one empty paragraph for empty text', () => {
    expect(toProseMirrorDocument('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('keeps the text as text rather than as markup', () => {
    const document = toProseMirrorDocument('<b>not bold</b> & <script>');

    expect(document.content[0]?.content?.[0]?.text).toBe('<b>not bold</b> & <script>');
  });
});

describe('toPlainText', () => {
  it('reads the paragraph text back out', () => {
    expect(toPlainText(toProseMirrorDocument('Measurements'))).toBe('Measurements');
  });

  it('round-trips multiple paragraphs, including empty ones', () => {
    const text = 'First\n\nSecond\nThird';

    expect(toPlainText(toProseMirrorDocument(text))).toBe(text);
  });

  it('joins the text nodes inside one paragraph', () => {
    const split = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Two ' },
            { type: 'text', text: 'nodes' },
          ],
        },
      ],
    };

    expect(toPlainText(split)).toBe('Two nodes');
  });

  it('returns an empty string rather than throwing for content it does not recognise', () => {
    // The content is `unknown` because it is arbitrary JSON. An editor that threw here would lock a user out
    // of a document they can still see in the list.
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText(null)).toBe('');
    expect(toPlainText('a string')).toBe('');
    expect(toPlainText([1, 2, 3])).toBe('');
    expect(toPlainText({})).toBe('');
    expect(toPlainText({ type: 'doc' })).toBe('');
  });

  it('skips nodes it cannot read instead of losing the rest of the document', () => {
    const mixed = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] },
        { type: 'image', attrs: { src: 'diagram.png' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Also kept' }] },
      ],
    };

    expect(toPlainText(mixed)).toBe('Kept\n\nAlso kept');
  });
});
