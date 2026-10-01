/** @jest-environment jsdom */
import { Editor } from '@tiptap/core';
import { documentExtensions, readStoredDocument } from './documentContent';
import type { Citation } from '../../ai/api/generationApi';
const citation: Citation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: null,
  chunkId: 'a'.repeat(64),
  processingVersion: 'v1',
  contentHash: 'b'.repeat(64),
  pageStart: 7,
  pageEnd: 7,
  sectionTitle: null,
  title: '<script>Source</script>',
  spans: [{ unitId: 'p7', characterStart: 0, characterEnd: 20 }],
};
test('versioned citation survives editor/save and renders escaped text with an authorized source route', () => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Claim.' },
          { type: 'researchCitation', attrs: { citation } },
        ],
      },
    ],
  };
  expect(readStoredDocument(content)).toEqual(content);
  const editor = new Editor({ extensions: documentExtensions, content });
  expect(editor.getJSON()).toEqual(content);
  const html = editor.getHTML();
  expect(html).toContain('&lt;script&gt;Source&lt;/script&gt;');
  const rendered = document.createElement('div');
  rendered.innerHTML = html;
  expect(rendered.querySelector('script')).toBeNull();
  expect(html).toContain('processingVersion=v1');
  expect(html).toContain('p. 7');
  editor.destroy();
});
test('malformed citation metadata is rejected before opening the editor', () => {
  for (const value of [{ sourceId: 's' }, 'unsafe', null]) {
    expect(
      readStoredDocument({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'researchCitation', attrs: { citation: value } }],
          },
        ],
      }),
    ).toBeNull();
  }
});
