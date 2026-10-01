/** @jest-environment jsdom */
import { Editor } from '@tiptap/core';
import { citationIdentity, citationReferences } from './researchCitation';
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

test('numbering follows reference order while stable identities, duplicates and metadata survive reload and undo', () => {
  const a = {
    ...citation,
    schemaVersion: '1.0',
    citationId: 'c:a',
    label: 'Paper A',
    displayStyle: 'NUMERIC',
    locator: { pageStart: 7, pageEnd: 7, sectionTitle: null },
  };
  const b = {
    ...a,
    citationId: 'c:b',
    sourceId: 'other',
    chunkId: 'c'.repeat(64),
    label: 'Paper B',
  };
  const node = (value: unknown) => ({
    type: 'researchCitation',
    attrs: { citation: value },
  });
  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [node(a), node(b), node(a)] }],
  };
  const editor = new Editor({ extensions: documentExtensions, content });
  expect(editor.view.dom.textContent).toBe(' [1] [2] [1]');
  expect(citationReferences(editor.state.doc).map((ref) => ref.citationId)).toEqual([
    'c:a',
    'c:b',
  ]);
  editor.commands.deleteRange({ from: 1, to: 2 });
  expect(editor.view.dom.textContent).toBe(' [1] [2]');
  expect(citationReferences(editor.state.doc).map((ref) => ref.citationId)).toEqual([
    'c:b',
    'c:a',
  ]);
  expect(
    JSON.parse(JSON.stringify(editor.getJSON())).content[0].content[1].attrs.citation,
  ).toEqual(a);
  editor.commands.undo();
  expect(editor.view.dom.textContent).toBe(' [1] [2] [1]');
  const saved = editor.getJSON();
  editor.destroy();
  expect(readStoredDocument(saved)).toEqual(saved);
  const reloaded = new Editor({ extensions: documentExtensions, content: saved });
  expect(reloaded.view.dom.textContent).toBe(' [1] [2] [1]');
  reloaded.commands.setNodeSelection(2);
  reloaded.commands.updateAttributes('researchCitation', {
    citation: { ...b, displayStyle: 'SOURCE' },
  });
  expect(reloaded.view.dom.textContent).toContain('Paper B, p. 7');
  expect(reloaded.getHTML()).toContain('Paper B, p. 7');
  reloaded.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Human text' }] }],
  });
  expect(citationReferences(reloaded.state.doc)).toEqual([]);
  reloaded.destroy();
});
test('source-level citations without a chunk retain locator and legacy citations retain identity', () => {
  const value = {
    ...citation,
    chunkId: null,
    pageStart: null,
    pageEnd: null,
    sectionTitle: 'Introduction',
    displayStyle: 'SOURCE',
  };
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'researchCitation', attrs: { citation: value } },
          {
            type: 'researchCitation',
            attrs: {
              citation: {
                ...value,
                chunkId: undefined,
                title: null,
                sectionTitle: null,
                spans: [],
              },
            },
          },
        ],
      },
    ],
  };
  const editor = new Editor({ extensions: documentExtensions, content });
  expect(readStoredDocument(editor.getJSON())).not.toBeNull();
  expect(editor.getHTML()).toContain('Introduction');
  expect(editor.getHTML()).toContain('[Source, source]');
  expect(citationIdentity(citation)).toBe(citationIdentity({ ...citation }));
  editor.destroy();
});
test('invalid entity versions, locators, identity, display and page ranges fail safely', () => {
  for (const change of [
    { schemaVersion: '2' },
    { citationId: '' },
    { label: '' },
    { displayStyle: 'HTML' },
    { locator: { pageStart: 9, pageEnd: 9, sectionTitle: null } },
    { pageEnd: 6 },
    { chunkId: 'bad' },
    { spans: [{ unitId: 2 }] },
    { sourceVersionId: 4 },
  ]) {
    expect(
      readStoredDocument({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'researchCitation',
                attrs: { citation: { ...citation, ...change } },
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  }
});

test('explicit reordering derives presentation numbers without changing reference metadata', () => {
  const a = { ...citation, citationId: 'c:a', displayStyle: 'NUMERIC' };
  const b = { ...a, citationId: 'c:b', sourceId: 'second', chunkId: 'c'.repeat(64) };
  const doc = (values: readonly unknown[]) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: values.map((value) => ({
          type: 'researchCitation',
          attrs: { citation: value },
        })),
      },
    ],
  });
  const editor = new Editor({ extensions: documentExtensions, content: doc([a, b]) });
  expect(editor.getHTML()).toContain(' [1]');
  expect(editor.getHTML()).toContain(' [2]');
  editor.commands.setContent(doc([b, a, b]));
  expect(editor.view.dom.textContent).toBe(' [1] [2] [1]');
  expect(citationReferences(editor.state.doc).map((ref) => ref.citationId)).toEqual([
    'c:b',
    'c:a',
  ]);
  expect(
    JSON.parse(JSON.stringify(editor.getJSON())).content[0].content[1].attrs.citation,
  ).toEqual(a);
  editor.destroy();
});
