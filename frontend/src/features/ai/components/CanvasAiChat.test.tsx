/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CanvasAiChat } from './CanvasAiChat';
import * as api from '../api/conversationApi';
import { apiClient } from '../../../shared/api';
import { useSourcesQuery } from '../../sources/api/useSources';
import type { CanvasContext } from '../../documents/provenance/canvasTarget';
import type { WorkspaceSource } from '../../sources/api/sourceApi';

jest.mock('../api/conversationApi');
jest.mock('../../sources/api/useSources');
jest.mock('../../../shared/api', () => ({
  ...jest.requireActual('../../../shared/api'),
  apiClient: { get: jest.fn() },
}));
jest.mock('./AnalysisEvidencePicker', () => ({
  AnalysisEvidencePicker: ({ onChange }: { onChange: (refs: unknown[]) => void }) => (
    <button
      onClick={() => onChange([{ analysisId: 'a', executionId: 'e', outputId: 'o' }])}
    >
      Select saved result
    </button>
  ),
}));
const context: CanvasContext = {
  schemaVersion: '1.0',
  contextId: 'ctx',
  documentId: 'doc',
  workspaceId: 'w',
  revision: 1,
  epoch: null,
  sequence: null,
  createdAt: 'now',
  snapshot: {
    target: {
      kind: 'TEXT',
      hash: 'a'.repeat(64),
      start: { blockId: 'b', path: [0], offset: 0 },
      end: { blockId: 'b', path: [0], offset: 4 },
    },
    text: 'User selection',
    before: '',
    after: '',
    sources: [],
    analyses: [],
  },
};
const state: api.CanvasTurnState = {
  schemaVersion: '1.0',
  turnId: 't1',
  conversationId: 'c1',
  status: 'ACCEPTED',
  contextId: 'ctx',
  intent: 'ANSWER',
  scope: { sourceVersionIds: [], analysisOutputs: [] },
  messageId: null,
  proposalId: null,
  executionId: null,
  failureCode: null,
  resultKind: null,
  memory: null,
};
const conversation: api.Conversation = {
  id: 'c1',
  workspaceId: 'w',
  createdBy: 'u',
  title: 'Question',
  createdAt: '2026-10-10',
  updatedAt: '2026-10-10',
  origin: { documentId: 'doc', contextId: 'ctx', documentTitle: 'My document' },
};
const user: api.ConversationMessage = {
  id: 'm1',
  clientRequestId: 'r1',
  sequence: 1,
  role: 'USER',
  status: 'PENDING',
  authorId: 'u',
  content: 'Question',
  selectedSourceIds: [],
  response: null,
  errorCode: null,
  createdAt: 'now',
  completedAt: null,
};
let history: api.ConversationHistory;
function Location() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}
function setup(props: Partial<Parameters<typeof CanvasAiChat>[0]> = {}) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <CanvasAiChat workspaceId="w" context={context} {...props} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, cache };
}
beforeEach(() => {
  jest.resetAllMocks();
  history = { conversation, messages: [], nextBeforeSequence: null, turns: [] };
  jest.mocked(api.fetchConversationHistory).mockImplementation(async () => history);
  jest.mocked(api.startCanvasConversation).mockImplementation(async () => {
    history = { ...history, messages: [user], turns: [state] };
    return state;
  });
  jest.mocked(api.sendCanvasTurn).mockResolvedValue({ ...state, turnId: 't2' });
  jest.mocked(api.cancelCanvasTurn).mockImplementation(async () => {
    history = {
      ...history,
      messages: [{ ...user, status: 'ABANDONED', errorCode: 'CONFLICT' }],
      turns: [{ ...state, status: 'CANCELLED' }],
    };
    return { ...state, status: 'CANCELLED' };
  });
  jest.mocked(apiClient.get).mockResolvedValue(context);
  jest.mocked(useSourcesQuery).mockReturnValue({
    data: [
      {
        id: 's',
        activeVersionId: 'v1',
        displayName: 'Lecture',
        status: 'READY',
        sourceType: 'PDF',
      } as WorkspaceSource,
    ],
    error: null,
    isPending: false,
  } as unknown as ReturnType<typeof useSourcesQuery>);
});
it('keeps an empty opening local, focuses the input and closes without a reservation', () => {
  const close = jest.fn();
  setup({ onClose: close });
  expect(document.activeElement).toBe(screen.getByLabelText('Ask about this context'));
  expect(screen.getByText(/saved in workspace history/)).toBeTruthy();
  expect(api.startCanvasConversation).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Cancel question' })).toBeNull();
});
it('reserves one first turn, disables duplicate sends, observes history and cancels explicitly', async () => {
  const close = jest.fn();
  const view = setup({ onClose: close });
  fireEvent.change(screen.getByLabelText('Ask about this context'), {
    target: { value: 'Explain' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByRole('button', { name: 'Cancel question' });
  expect(api.startCanvasConversation).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel question' }));
  await waitFor(() => expect(api.cancelCanvasTurn).toHaveBeenCalledWith('w', 'c1', 't1'));
  await screen.findByText(/No complete answer was saved/);
  fireEvent.click(screen.getByRole('button', { name: 'Open full chat' }));
  expect(close).toHaveBeenCalled();
  expect(screen.getByTestId('location').textContent).toBe(
    '/app/workspaces/w/ask?conversation=c1',
  );
  view.unmount();
  expect(api.cancelCanvasTurn).toHaveBeenCalledTimes(1);
});
it('retries a lost first response with unchanged identities, context, instruction and scope', async () => {
  jest
    .mocked(api.startCanvasConversation)
    .mockRejectedValueOnce(new Error('Lost response'));
  setup();
  fireEvent.change(screen.getByLabelText('Ask about this context'), {
    target: { value: 'Explain' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByRole('button', { name: 'Retry saved request' });
  expect(
    (screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved request' }));
  await screen.findByRole('button', { name: 'Cancel question' });
  expect(jest.mocked(api.startCanvasConversation).mock.calls[0]).toEqual(
    jest.mocked(api.startCanvasConversation).mock.calls[1],
  );
});
it('continues the same conversation, shows citations and truncation and permits an explicit narrowed scope', async () => {
  const answer: api.ConversationMessage = {
    ...user,
    id: 'm2',
    sequence: 2,
    role: 'ASSISTANT',
    status: 'COMPLETED',
    content: 'Saved answer',
    response: {
      status: 'INSUFFICIENT_EVIDENCE',
      reason: null,
      answer: 'Saved answer',
      citations: [
        {
          workspaceId: 'w',
          chunkId: 'h',
          sourceId: 's',
          title: 'Lecture',
          sourceVersionId: 'v1',
          processingVersion: 'p1',
          spans: [],
          pageStart: null,
        } as never,
      ],
      analysisCitations: [
        {
          workspaceId: 'w',
          evidenceId: 'a',
          analysisId: 'a',
          executionId: 'execution',
          title: 'Saved calculation',
        } as never,
      ],
      generation: null,
    },
  };
  history = {
    conversation,
    messages: [{ ...user, status: 'COMPLETED' }, answer],
    nextBeforeSequence: 1,
    turns: [
      {
        ...state,
        status: 'COMPLETED',
        messageId: 'm2',
        scope: { sourceVersionIds: ['v1'], analysisOutputs: [] },
        memory: { includedMessages: 2, omittedMessages: 5, memoryHash: 'h' },
      },
    ],
  };
  setup({ conversationId: 'c1', canEdit: true });
  await screen.findByText('Saved answer');
  expect(screen.getByText(/5 earlier messages omitted/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Lecture' }).getAttribute('href')).toBe(
    '/app/workspaces/w/sources/s?processingVersion=p1&version=v1',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reply to this answer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear reply' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reply to this answer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change evidence scope' }));
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByRole('button', { name: 'Select saved result' }));
  fireEvent.change(screen.getByLabelText('Ask about this context'), {
    target: { value: 'More' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await waitFor(() =>
    expect(api.sendCanvasTurn).toHaveBeenCalledWith(
      'w',
      'c1',
      expect.objectContaining({
        contextId: 'ctx',
        instruction: 'More',
        replyToMessageId: 'm2',
        scope: {
          sourceVersionIds: [],
          analysisOutputs: [{ analysisId: 'a', executionId: 'e', outputId: 'o' }],
        },
      }),
    ),
  );
  expect(api.startCanvasConversation).not.toHaveBeenCalled();
});
it('loads a pinned context from history and navigates to its document without another turn', async () => {
  history = { conversation, messages: [user], nextBeforeSequence: null, turns: [state] };
  setup({ context: undefined, conversationId: 'c1' });
  await screen.findByText('User selection');
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w/documents/doc/ai/contexts/ctx',
    expect.anything(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open document' }));
  expect(screen.getByTestId('location').textContent).toBe(
    '/app/workspaces/w/documents/doc',
  );
  expect(api.startCanvasConversation).not.toHaveBeenCalled();
});
it('keeps running work on close, safely renders malicious text and allows explicit context changes', async () => {
  const change = jest.fn();
  const view = setup({
    onChangeContext: change,
    context: {
      ...context,
      snapshot: { ...context.snapshot, text: '<script>steal()</script>' },
    },
  });
  expect(screen.getByText('<script>steal()</script>')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Change context' }));
  expect(change).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Ask about this context'), {
    target: { value: 'Explain' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByRole('button', { name: 'Cancel question' });
  view.unmount();
  expect(api.cancelCanvasTurn).not.toHaveBeenCalled();
});
it('shows history and source errors and blocks sends on revoked access', async () => {
  jest
    .mocked(api.fetchConversationHistory)
    .mockRejectedValue(new Error('Revoked access'));
  jest.mocked(useSourcesQuery).mockReturnValue({
    data: [],
    error: new Error('Sources unavailable'),
    isPending: false,
  } as unknown as ReturnType<typeof useSourcesQuery>);
  setup({ conversationId: 'c1' });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Change evidence scope' }));
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(
    (screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('keeps document focus when a saved conversation appears in the research panel', () => {
  const editor = document.createElement('textarea');
  document.body.append(editor);
  editor.focus();
  const view = setup({ conversationId: 'c' });
  expect(document.activeElement).toBe(editor);
  view.unmount();
  editor.remove();
});

it('sends an explicitly selected saved proposal with its immutable evidence versions and permits clearing it', async () => {
  setup({
    proposal: { id: 'proposal', title: 'Saved AI proposal', sourceVersionIds: ['v1'] },
  });
  expect(screen.getByText(/Follow-up target: Saved AI proposal/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Ask about this context'), {
    target: { value: 'Explain this proposal' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await waitFor(() =>
    expect(api.startCanvasConversation).toHaveBeenCalledWith(
      'w',
      expect.objectContaining({
        turn: expect.objectContaining({
          targetProposalId: 'proposal',
          scope: { sourceVersionIds: ['v1'], analysisOutputs: [] },
        }),
      }),
    ),
  );
});

it('can reuse a referenced proposal from saved history without guessing one from text', async () => {
  history = {
    conversation,
    messages: [
      {
        ...user,
        id: 'm2',
        role: 'ASSISTANT',
        status: 'COMPLETED',
        content: 'Saved explanation',
      },
    ],
    nextBeforeSequence: null,
    turns: [{ ...state, status: 'COMPLETED', messageId: 'm2', proposalId: 'proposal' }],
  };
  setup({ conversationId: 'c1' });
  fireEvent.click(
    await screen.findByRole('button', { name: 'Use this proposal as context' }),
  );
  expect(screen.getByText(/Follow-up target: Referenced AI proposal/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear proposal target' }));
  expect(screen.queryByText(/Follow-up target/)).toBeNull();
});
