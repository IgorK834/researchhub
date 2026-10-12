/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CanvasProposalPreview } from './CanvasProposalPreview';
import * as api from '../api/canvasProposalApi';
jest.mock('../api/canvasProposalApi');
const pending: api.CanvasProposal = {
  schemaVersion: '2.0',
  id: 'p',
  contextId: 'ctx',
  state: 'PENDING',
  mode: 'INSERT_AT_ANCHOR',
  versionHash: 'a'.repeat(64),
  originalText: 'old',
  paragraphs: ['Proposed text'],
  citations: [],
  warnings: ['Review new claims'],
  operationId: null,
};
let current: api.CanvasProposal;
beforeEach(() => {
  jest.resetAllMocks();
  current = { ...pending };
  jest.mocked(api.fetchCanvasProposal).mockImplementation(async () => current);
  jest.mocked(api.acceptCanvasProposal).mockImplementation(async () => {
    current = { ...current, state: 'ACCEPTED', operationId: 'op' };
    return { operationId: 'op', proposalId: 'p', kind: 'ACCEPT', revision: 2 };
  });
  jest.mocked(api.rejectCanvasProposal).mockImplementation(async () => {
    current = { ...current, state: 'REJECTED' };
    return current;
  });
  jest.mocked(api.undoCanvasOperation).mockImplementation(async () => {
    current = { ...current, compensationId: 'undo' };
    return { operationId: 'undo', proposalId: 'p', kind: 'UNDO', revision: 3 };
  });
});
function setup(props: Partial<Parameters<typeof CanvasProposalPreview>[0]> = {}) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <CanvasProposalPreview
        workspaceId="w"
        documentId="doc"
        proposalId="p"
        canEdit
        {...props}
      />
    </QueryClientProvider>,
  );
}
it('keeps a preview separate from document editing and explicitly accepts one immutable version', async () => {
  const onApplied = jest.fn().mockResolvedValue(undefined),
    onApplying = jest.fn();
  setup({ onApplied, onApplying });
  expect(screen.getByText('Loading proposal…')).toBeDefined();
  await screen.findByText('Proposed text');
  fireEvent.click(screen.getByRole('button', { name: 'Insert proposal' }));
  await screen.findByText('Proposal: accepted');
  expect(api.acceptCanvasProposal).toHaveBeenCalledTimes(1);
  expect(api.acceptCanvasProposal).toHaveBeenCalledWith(
    'w',
    'doc',
    pending,
    expect.any(String),
  );
  expect(onApplied).toHaveBeenCalledTimes(1);
  expect(onApplying.mock.calls).toEqual([[true], [false]]);
  fireEvent.click(screen.getByRole('button', { name: 'Undo AI insertion' }));
  await screen.findByText('AI insertion undone');
  expect(api.undoCanvasOperation).toHaveBeenCalledWith(
    'w',
    'doc',
    'op',
    expect.any(String),
  );
  expect(screen.queryByRole('button', { name: 'Undo AI insertion' })).toBeNull();
});
it('reuses the acceptance UUID after a lost response and renders a safe failure', async () => {
  jest.mocked(api.acceptCanvasProposal).mockRejectedValueOnce(new Error('Lost response'));
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Insert proposal' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Insert proposal' }));
  await screen.findByText('Proposal: accepted');
  expect(jest.mocked(api.acceptCanvasProposal).mock.calls[0]![3]).toEqual(
    jest.mocked(api.acceptCanvasProposal).mock.calls[1]![3],
  );
});
it('rejects without calling document application and discloses original selection and citation changes', async () => {
  current = {
    ...pending,
    mode: 'REPLACE_RANGE',
    citations: [
      {
        workspaceId: 'w',
        sourceId: 's',
        chunkId: 'a'.repeat(64),
        contentHash: 'b'.repeat(64),
        processingVersion: '1',
        title: 'Source',
        sourceVersionId: 'v',
        spans: [],
        pageStart: null,
        pageEnd: null,
        sectionTitle: null,
      },
    ],
  };
  const onApplied = jest.fn();
  setup({ onApplied });
  await screen.findByText('Original selection');
  expect(screen.getByRole('link').getAttribute('href')).toContain('version=v');
  fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
  await screen.findByText('Proposal: rejected');
  expect(onApplied).not.toHaveBeenCalled();
  expect(api.acceptCanvasProposal).not.toHaveBeenCalled();
});
it('hides write actions for viewers and blocks unsaved/offline document acceptance', async () => {
  const view = setup({ canApply: false });
  const insert = await screen.findByRole('button', { name: 'Insert proposal' });
  expect((insert as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Wait for document changes/)).toBeDefined();
  view.unmount();
  setup({ canEdit: false });
  await screen.findByText('Proposed text');
  expect(screen.queryByRole('button')).toBeNull();
});
it('recovers a failed read and persists compensated status on history reload', async () => {
  jest.mocked(api.fetchCanvasProposal).mockRejectedValueOnce(new Error('Read failed'));
  current = { ...pending, state: 'ACCEPTED', operationId: 'op', compensationId: 'undo' };
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Reload proposal' }));
  await screen.findByText('AI insertion undone');
  expect(screen.queryByRole('button', { name: 'Undo AI insertion' })).toBeNull();
});
it('prevents duplicate clicks while an acceptance is in flight', async () => {
  let finish!: () => void;
  jest.mocked(api.acceptCanvasProposal).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => {
          current = { ...pending, state: 'ACCEPTED', operationId: 'op' };
          resolve({ operationId: 'op', proposalId: 'p', kind: 'ACCEPT', revision: 2 });
        };
      }),
  );
  setup();
  const button = await screen.findByRole('button', { name: 'Insert proposal' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(api.acceptCanvasProposal).toHaveBeenCalledTimes(1));
  finish();
  await screen.findByText('Proposal: accepted');
});
