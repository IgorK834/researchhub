/** @jest-environment jsdom */
import { Editor } from '@tiptap/core';
import {
  analysisBlock,
  isAnalysisBlockAttrs,
  isAnalysisReference,
  validateAnalysisNodes,
} from './analysisReference';
import {
  documentExtensions,
  readStoredDocument,
  savedDocumentOf,
} from './documentContent';
import { documentNavigation } from './documentNavigation';
import { blockId, reference, newerId } from '../../analysis/testing/semanticFixtures';

test('semantic metadata round trips through the real editor and changes only on an explicit update', () => {
  const block = analysisBlock(reference, '<script>caption</script>', blockId);
  const content = { type: 'doc' as const, content: [block] };
  const editor = new Editor({ extensions: documentExtensions, content });
  try {
    const saved = savedDocumentOf(editor);
    expect(saved).toEqual(content);
    expect(readStoredDocument(JSON.parse(JSON.stringify(saved)))).toEqual(content);
    expect(
      documentNavigation(editor.state.doc, 0).analyses?.[0]?.attrs.reference,
    ).toEqual(reference);
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('analysisResult', {
      reference: { ...reference, executionId: newerId },
    });
    expect(savedDocumentOf(editor).content?.[0]?.attrs?.['reference']).toEqual({
      ...reference,
      executionId: newerId,
    });
    expect(saved.content?.[0]?.attrs?.['reference']).toEqual(reference);
    expect(editor.getHTML()).not.toContain('<script>');
  } finally {
    editor.destroy();
  }
});
test('reference validators reject malformed, additional or executable metadata', () => {
  for (const value of [
    null,
    [],
    {},
    { ...reference, analysisId: 'bad' },
    { ...reference, executionId: 4 },
    { ...reference, outputId: '' },
    { ...reference, outputId: 'x'.repeat(101) },
    { ...reference, renderMode: 'IMAGE' },
    { ...reference, code: 'evil()' },
  ])
    expect(isAnalysisReference(value)).toBe(false);
  for (const mode of ['CHART', 'TABLE', 'SUMMARY'])
    expect(isAnalysisReference({ ...reference, renderMode: mode })).toBe(true);
  for (const value of [
    null,
    {},
    { blockId, reference, caption: 4 },
    { blockId: 'bad', reference, caption: '' },
    { blockId, reference, caption: 'x'.repeat(1001) },
  ])
    expect(isAnalysisBlockAttrs(value)).toBe(false);
  expect(() => analysisBlock({ ...reference, outputId: '' }, '', blockId)).toThrow();
  expect(analysisBlock(reference, '').attrs?.['blockId']).toMatch(/^[a-f0-9-]{36}$/);
});
test('invalid references cannot be silently removed by normalization or duplicated by clipboard operations', () => {
  const block = analysisBlock(reference, '', blockId);
  for (const bad of [
    { ...block, content: [] },
    { ...block, attrs: { ...block.attrs, url: 'https://evil' } },
    { type: 'doc', content: [block, block] },
    {
      type: 'doc',
      content: Array.from({ length: 51 }, (_, i) =>
        analysisBlock(
          reference,
          '',
          `44444444-4444-4444-8444-${i.toString().padStart(12, '0')}`,
        ),
      ),
    },
  ]) {
    expect(() => validateAnalysisNodes(bad)).toThrow();
    expect(readStoredDocument(bad)).toBeNull();
  }
  let deep: unknown = block;
  for (let i = 0; i < 66; i++) deep = { type: 'doc', content: [deep] };
  expect(() => validateAnalysisNodes(deep)).toThrow();
  validateAnalysisNodes(null);
  validateAnalysisNodes({ type: 'paragraph' });
});
