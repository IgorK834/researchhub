/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { apiClient } from '../../../shared/api';
import { documentExtensions } from '../api/documentContent';
import { analysisBlock } from '../api/analysisReference';
import { DocumentProvenance, type OriginOperation } from './DocumentProvenance';

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  jest.restoreAllMocks();
});
function editor(blockId: string | null = 'block'): Editor {
  const current = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId },
          content: [{ type: 'text', text: 'Selected claim' }],
        },
      ],
    },
  });
  editors.push(current);
  return current;
}
function setup(
  current: Editor | null,
  onExplainOperation?: (id: string, versions: readonly string[]) => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentProvenance
        workspaceId="w"
        documentId="d"
        editor={current}
        onExplainOperation={onExplainOperation}
      />
    </QueryClientProvider>,
  );
}
const operation: OriginOperation = {
  id: 'op',
  blockId: 'block',
  category: 'AI_GENERATED',
  actorUserId: 'u',
  actorName: 'Former member',
  operationType: 'AI_ACCEPTED',
  sourceOperationId: 'suggestion',
  documentRevision: 7,
  createdAt: '2026-10-06T12:00:00Z',
  metadata: {
    model: { provider: 'fixture', name: 'test-model' },
    editedBeforeAcceptance: true,
    citations: [
      {
        workspaceId: 'w',
        sourceId: 's',
        sourceVersionId: null,
        chunkId: 'a'.repeat(64),
        contentHash: 'b'.repeat(64),
        processingVersion: 'v1',
        pageStart: 7,
        pageEnd: 7,
        sectionTitle: null,
        title: 'Paper',
        spans: [],
      },
    ],
  },
};
it('shows recorded AI origin, source operation, human acceptance and exact source link without authorship percentages', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue([operation]);
  const current = editor();
  setup(current);
  await screen.findByText('AI generated');
  expect(screen.getByText('Source operation: suggestion')).not.toBeNull();
  expect(screen.getByText('Edited by a person before acceptance.')).not.toBeNull();
  expect(screen.getByText(/Former member/)).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'Paper · p. 7' }).getAttribute('href'),
  ).toContain('/sources/s?');
  expect(screen.getByText(/not AI detection/)).not.toBeNull();
  expect(get).toHaveBeenCalledWith(
    '/api/workspaces/w/documents/d/blocks/block/provenance',
    expect.anything(),
  );
  act(() => current.commands.setTextSelection(3));
  await waitFor(() =>
    expect(screen.getByLabelText('Selected block').textContent).toContain(
      'Selected claim',
    ),
  );
});
it('preserves earlier AI modifications alongside human/imported and analysis operations', async () => {
  jest.spyOn(apiClient, 'get').mockResolvedValue([
    {
      ...operation,
      id: '1',
      category: 'HUMAN',
      operationType: 'CITATION_ADDED',
      sourceOperationId: null,
      metadata: {},
    },
    {
      ...operation,
      id: '2',
      category: 'AI_REWRITTEN',
      metadata: {
        citations: [{ ...operation.metadata.citations![0]!, title: '', pageStart: null }],
      },
    },
    {
      ...operation,
      id: '3',
      category: 'IMPORTED',
      operationType: 'INSERTED',
      metadata: {},
    },
    {
      ...operation,
      id: '4',
      category: 'ANALYSIS_DERIVED',
      operationType: 'EDITED',
      metadata: {
        analysis: {
          analysisId: 'analysis',
          executionId: 'execution',
          outputId: 'chart-1',
          renderMode: 'CHART',
        },
      },
    },
    { ...operation, id: '5', category: 'HUMAN', operationType: 'TRACKED', metadata: {} },
  ]);
  setup(editor());
  await screen.findByText('AI rewritten');
  expect(screen.getByText('Imported content')).not.toBeNull();
  expect(screen.getByText('Tracking started · v7')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Open source' })).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'Open analysis provenance' }).getAttribute('href'),
  ).toContain('execution=execution');
});
it('handles no editor, legacy and empty saved history honestly', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue([]);
  let view = setup(null);
  expect(screen.getByText(/Select a paragraph/)).not.toBeNull();
  view.unmount();
  view = setup(editor(null));
  expect(screen.getByText(/cannot be inferred/)).not.toBeNull();
  expect(get).not.toHaveBeenCalled();
  view.unmount();
  setup(editor());
  await screen.findByText(/No saved operations yet/);
});
it('shows request errors and a bounded-history notice', async () => {
  jest.spyOn(apiClient, 'get').mockRejectedValue(new Error('Offline'));
  const view = setup(editor());
  await screen.findByRole('alert');
  view.unmount();
  jest
    .mocked(apiClient.get)
    .mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ ...operation, id: String(i) })),
    );
  setup(editor());
  await screen.findByText(/latest 200/);
});
it('inspects a selected analysis node without requiring editable prose', async () => {
  jest
    .spyOn(apiClient, 'get')
    .mockResolvedValue([{ ...operation, category: 'ANALYSIS_DERIVED' }]);
  const current = new Editor({
    extensions: documentExtensions,
    editable: false,
    content: {
      type: 'doc',
      content: [
        analysisBlock(
          {
            analysisId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            executionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            outputId: 'chart',
            renderMode: 'CHART',
          },
          'Chart',
        ),
      ],
    },
  });
  editors.push(current);
  current.view.dispatch(
    current.state.tr.setSelection(NodeSelection.create(current.state.doc, 0)),
  );
  setup(current);
  await screen.findByText('Analysis derived');
});

it('uses recorded accepted proposal identity and explicit versions when opening a follow-up', async () => {
  jest.spyOn(apiClient, 'get').mockResolvedValue([
    {
      ...operation,
      metadata: {
        citations: [{ ...operation.metadata.citations![0]!, sourceVersionId: 'version' }],
      },
    },
  ]);
  const explain = jest.fn();
  setup(editor(), explain);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Explain accepted text in chat' }),
  );
  expect(explain).toHaveBeenCalledWith('suggestion', ['version']);
});
