/** @jest-environment jsdom */
import { act, fireEvent, render, screen, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Y from 'yjs';
import { DocumentEditorForm } from '../components/DocumentEditorForm';
import { useRealtimeDocument } from './useRealtimeDocument';
import { useDocumentAutosave } from '../autosave/useDocumentAutosave';
import { queryKeys } from '../../../shared/api';
import type { WorkspaceDocument } from '../api/documentApi';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { SelectionBookmark } from '@tiptap/pm/state';
const mockCanvasEditor = {
  state: { selection: { getBookmark: () => mockCanvasBookmark } },
} as Editor;
const mockCanvasBookmark = {} as SelectionBookmark;
const mockContextPreview = jest.fn();
const mockBodyEditor = jest.fn();
jest.mock('../components/CanvasContextPreview', () => ({
  CanvasContextPreview: (props: { onClose: () => void }) => {
    mockContextPreview(props);
    return <button onClick={props.onClose}>Close context</button>;
  },
}));
jest.mock('../provenance/DocumentProvenance', () => ({
  DocumentProvenance: ({
    onExplainOperation,
  }: {
    onExplainOperation?: (id: string, versions: readonly string[]) => void;
  }) => (
    <button
      disabled={!onExplainOperation}
      onClick={() => onExplainOperation?.('accepted-proposal', ['v1'])}
    >
      Explain accepted
    </button>
  ),
}));
jest.mock('./useRealtimeDocument', () => ({ useRealtimeDocument: jest.fn() }));
jest.mock('../components/DocumentHistory', () => ({ DocumentHistory: () => null }));
jest.mock('../components/DocumentBodyEditor', () => ({
  DocumentBodyEditor: ({
    onChange,
    onCanvasAi,
    onEditorReady,
    selectionActionsEnabled,
  }: {
    onChange: (content: unknown) => void;
    onCanvasAi?: (editor: Editor, bookmark: SelectionBookmark) => void;
    onEditorReady?: (editor: Editor | null) => void;
    selectionActionsEnabled?: boolean;
  }) => {
    mockBodyEditor({ selectionActionsEnabled });
    return (
      <>
        <button onClick={() => onEditorReady?.(mockCanvasEditor)}>Ready editor</button>
        <button
          type="button"
          onClick={() => onChange({ type: 'doc', content: [{ type: 'paragraph' }] })}
        >
          Body change
        </button>
        <button
          disabled={!onCanvasAi}
          onClick={() => onCanvasAi?.(mockCanvasEditor, mockCanvasBookmark)}
        >
          Ask context
        </button>
      </>
    );
  },
}));
const mockSave = jest.fn();
jest.mock('../api/useDocuments', () => ({
  useArchiveDocument: () => ({ error: null }),
  useSaveDocument: () => mockSave,
}));
const document: WorkspaceDocument = {
  id: 'doc',
  title: 'Report',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  contentFormat: 'PROSEMIRROR_JSON',
  revision: 1,
  createdAt: 'time',
  updatedAt: 'time',
  archivedAt: null,
};
const edit = jest.fn(),
  checkpoint = jest.fn(),
  retry = jest.fn();
let doc: Y.Doc;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);
beforeEach(() => {
  jest.clearAllMocks();
  Reflect.set(process.env, 'RESEARCHHUB_COLLABORATION_ENABLED', 'true');
  doc = new Y.Doc();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.mocked(useRealtimeDocument).mockReturnValue({
    provider: null,
    user: undefined,
    participants: [],
    accessRevoked: false,
    stateReplaced: false,
    doc,
    ready: true,
    connected: true,
    title: 'Shared title',
    failureDetail: undefined,
    autosave: {
      status: 'saved',
      revision: 3,
      savedAt: 'server',
      error: null,
      blocked: false,
      edit,
      saveNow: checkpoint,
      retry,
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(process.env, 'RESEARCHHUB_COLLABORATION_ENABLED');
  doc.destroy();
  client.clear();
});
const form = (canEdit = true) =>
  render(
    <DocumentEditorForm
      workspaceId="workspace"
      document={document}
      canEdit={canEdit}
      onDiscardLocalChanges={jest.fn()}
      onReplaced={jest.fn()}
    />,
    { wrapper },
  );
it('routes title and body authoring through Yjs and refreshes immutable history after checkpoint', async () => {
  form();
  expect((screen.getByLabelText('Title') as HTMLTextAreaElement).value).toBe(
    'Shared title',
  );
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
  expect(edit).toHaveBeenCalledWith({ title: 'New title', content: document.content });
  fireEvent.click(screen.getByRole('button', { name: 'Body change' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
  expect(checkpoint).toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const stored = { ...document, revision: 4 };
  const notify = jest.mocked(useRealtimeDocument).mock.calls[0]![3]!;
  await act(async () => notify(stored));
  expect(client.getQueryData(queryKeys.document('workspace', 'doc'))).toEqual(stored);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: queryKeys.documentVersions('workspace', 'doc'),
  });
});
it('passes the pinned canvas selection and durable room state into context capture and closes the review', () => {
  form();
  expect(mockContextPreview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ask context' }));
  expect(mockContextPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      editor: mockCanvasEditor,
      bookmark: mockCanvasBookmark,
      workspaceId: 'workspace',
      documentId: 'doc',
      realtime: expect.objectContaining({ connected: true }),
      autosave: expect.objectContaining({ revision: 3, status: 'saved' }),
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close context' }));
  expect(screen.queryByRole('button', { name: 'Close context' })).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
});
it('shows connection and durable failure recovery without presenting a title error', () => {
  const value = jest.mocked(useRealtimeDocument)('workspace', document, true);
  jest.mocked(useRealtimeDocument).mockReturnValue({
    ...value,
    connected: false,
    failureDetail: 'The save service is unavailable.',
    autosave: { ...value.autosave, status: 'failed', blocked: true },
  });
  form();
  expect(screen.getByText(/Offline — changes are kept/)).not.toBeNull();
  expect(screen.getByText(/The save service is unavailable/)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
  expect(retry).toHaveBeenCalled();
  expect((screen.getByLabelText('Title') as HTMLTextAreaElement).readOnly).toBe(true);
});
it('waits for initial sync and does not expose an editing transport to viewers', () => {
  const value = jest.mocked(useRealtimeDocument)('workspace', document, true);
  jest
    .mocked(useRealtimeDocument)
    .mockReturnValue({ ...value, connected: false, ready: false });
  const view = form();
  expect(screen.getByText('Connecting to collaboration…')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Body change' })).toBeNull();
  view.unmount();
  form(false);
  expect(jest.mocked(useRealtimeDocument).mock.calls.at(-1)![2]).toBe(false);
});
it('disabled legacy autosave cannot schedule, flush or retry full-document writes', () => {
  const { result, unmount } = renderHook(
    () =>
      useDocumentAutosave(
        'workspace',
        'doc',
        { title: 'Report', content: document.content as never },
        1,
        'time',
        false,
      ),
    { wrapper },
  );
  act(() => {
    result.current.edit({
      title: 'Legacy replacement',
      content: document.content as never,
    });
    result.current.saveNow();
    result.current.retry();
    window.dispatchEvent(new Event('online'));
  });
  unmount();
  expect(mockSave).not.toHaveBeenCalled();
});

it('waits for a durable acknowledgement before enabling a historical checkpoint', () => {
  const value = jest.mocked(useRealtimeDocument)('workspace', document, true);
  jest
    .mocked(useRealtimeDocument)
    .mockReturnValue({ ...value, autosave: { ...value.autosave, status: 'saving' } });
  form();
  expect(
    (screen.getByRole('button', { name: 'Save version' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
  expect(checkpoint).not.toHaveBeenCalled();
});

it('shows actual room participants in the topbar and locks authoring after live revocation', () => {
  const value = jest.mocked(useRealtimeDocument)('workspace', document, true);
  const statusHost = window.document.createElement('div'),
    presenceHost = window.document.createElement('div');
  window.document.body.append(statusHost, presenceHost);
  jest.mocked(useRealtimeDocument).mockReturnValue({
    ...value,
    participants: [
      { userId: 'one', displayName: 'Ada', colorId: 'blue' },
      { userId: 'two', displayName: 'Ben', colorId: 'coral' },
    ],
  });
  const props = {
    workspaceId: 'workspace',
    document,
    canEdit: true,
    onDiscardLocalChanges: jest.fn(),
    onReplaced: jest.fn(),
    statusHost,
    presenceHost,
  };
  const view = render(<DocumentEditorForm {...props} />, { wrapper });
  expect(screen.getByRole('group', { name: 'In this document now' })).not.toBeNull();
  jest
    .mocked(useRealtimeDocument)
    .mockReturnValue({ ...value, accessRevoked: true, connected: false });
  view.rerender(<DocumentEditorForm {...props} />);
  expect(screen.getByText(/Editing access has changed/)).not.toBeNull();
  expect(screen.getByText('Read-only')).not.toBeNull();
  expect(screen.queryByRole('group', { name: 'In this document now' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try now' })).toBeNull();
  expect((screen.getByLabelText('Title') as HTMLTextAreaElement).readOnly).toBe(true);
  expect(screen.queryByText(/You’re a viewer/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Archive document' })).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
  view.unmount();
  statusHost.remove();
  presenceHost.remove();
});

it('activates when workspace permissions arrive later and never falls back to REST after demotion', () => {
  const props = {
    workspaceId: 'workspace',
    document,
    onDiscardLocalChanges: jest.fn(),
    onReplaced: jest.fn(),
  };
  const view = render(<DocumentEditorForm {...props} canEdit={false} />, { wrapper });
  expect(jest.mocked(useRealtimeDocument).mock.calls.at(-1)![2]).toBe(false);
  view.rerender(<DocumentEditorForm {...props} canEdit />);
  expect(jest.mocked(useRealtimeDocument).mock.calls.at(-1)![2]).toBe(true);
  view.rerender(<DocumentEditorForm {...props} canEdit={false} />);
  expect(jest.mocked(useRealtimeDocument).mock.calls.at(-1)![2]).toBe(true);
  expect(mockSave).not.toHaveBeenCalled();
});
it('does not offer new canvas work in an archived workspace', () => {
  render(
    <DocumentEditorForm
      workspaceId="workspace"
      document={document}
      canEdit={false}
      isViewer
      contextCaptureEnabled={false}
      onDiscardLocalChanges={jest.fn()}
      onReplaced={jest.fn()}
    />,
    { wrapper },
  );
  expect(
    (screen.getByRole('button', { name: 'Ask context' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('opens an explicit saved proposal or accepted operation with a bounded evidence scope', () => {
  Reflect.set(process.env, 'RESEARCHHUB_COLLABORATION_ENABLED', 'false');
  const provenanceHost = window.document.createElement('div');
  window.document.body.append(provenanceHost);
  render(
    <DocumentEditorForm
      workspaceId="workspace"
      document={document}
      canEdit
      provenanceHost={provenanceHost}
      onDiscardLocalChanges={jest.fn()}
      onReplaced={jest.fn()}
      renderAuthoring={({ onExplainSuggestion }) => (
        <button
          disabled={!onExplainSuggestion}
          onClick={() =>
            onExplainSuggestion?.({
              id: 'saved-proposal',
              citations: [
                { sourceVersionId: 'v1' },
                { sourceVersionId: null },
                { sourceVersionId: 'v1' },
              ],
            } as never)
          }
        >
          Explain saved proposal
        </button>
      )}
    />,
    { wrapper },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ready editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain saved proposal' }));
  expect(mockBodyEditor).toHaveBeenLastCalledWith({ selectionActionsEnabled: false });
  expect(mockContextPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      editor: mockCanvasEditor,
      bookmark: mockCanvasBookmark,
      proposal: {
        id: 'saved-proposal',
        title: 'Saved AI proposal',
        sourceVersionIds: ['v1'],
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close context' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain accepted' }));
  expect(mockContextPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      proposal: {
        id: 'accepted-proposal',
        title: 'Accepted AI text',
        sourceVersionIds: ['v1'],
      },
    }),
  );
  provenanceHost.remove();
});
