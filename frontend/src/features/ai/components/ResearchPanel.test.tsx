/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResearchPanel, type ResearchSources } from './ResearchPanel';
import * as api from '../api/conversationApi';
import { fetchCitationFragment } from '../api/citationEvidence';
import { ApiError, ApiTransportError } from '../../../shared/api';
import fixture from '../../../../../contracts/ai/conversations/v1/completed.json';
import conversationFixture from '../../../../../contracts/ai/conversations/v1/conversation.json';
import emptyFixture from '../../../../../contracts/ai/questions/v1/no-evidence.json';
import type { QuestionResponse } from '../api/questionApi';

jest.mock('../api/conversationApi');
jest.mock('../api/citationEvidence');
const turn = fixture as api.ConversationTurn;
const conversation = conversationFixture as api.Conversation;
const fetchList = jest.mocked(api.fetchConversations);
const fetchHistory = jest.mocked(api.fetchConversationHistory);
const create = jest.mocked(api.createConversation);
const stream = jest.mocked(api.streamConversationQuestion);
const ready: ResearchSources = {
  sources: [
    { id: 's1', title: 'Lecture', ready: true },
    { id: 's2', title: 'Processing', ready: false },
  ],
  loading: false,
  error: null,
};
const failure = (code: 'AI_UNAVAILABLE' | 'RESOURCE_NOT_FOUND') =>
  new ApiError({
    type: 'about:blank',
    title: 'Failed',
    status: code === 'AI_UNAVAILABLE' ? 503 : 404,
    code,
    rawCode: code,
    detail: code === 'AI_UNAVAILABLE' ? 'Try again later' : 'Workspace was not found',
  });
function panel(sources = ready) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (workspaceId = 'w1', sourceProps = sources) => (
    <QueryClientProvider client={client}>
      <ResearchPanel workspaceId={workspaceId} sources={sourceProps} />
    </QueryClientProvider>
  );
  return { ...render(wrap()), wrap, client };
}
async function submit(question = '  What is kinetic energy?  ') {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('Research question'), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ask research question' }));
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchCitationFragment).mockImplementation(async (citation) => ({
    ...citation,
    content: 'Kinetic energy is half the mass times speed squared.',
  }));
  fetchList.mockResolvedValue({ items: [], nextOffset: null });
  fetchHistory.mockResolvedValue({
    conversation,
    messages: [],
    nextBeforeSequence: null,
  });
  create.mockResolvedValue(conversation);
  stream.mockResolvedValue(turn);
});
it('creates a conversation, submits an all-source question, and links the persisted answer to its PDF page', async () => {
  const view = panel();
  await submit();
  const link = await screen.findByRole('link', { name: '[S1] Lecture 5 · Page 38' });
  expect(link.getAttribute('href')).toContain('unit=unit-38&page=38');
  expect(create).toHaveBeenCalledWith(
    'w1',
    'What is kinetic energy?',
    expect.any(AbortSignal),
  );
  expect(stream.mock.calls[0]?.[2]).toEqual({
    clientRequestId: expect.any(String),
    question: 'What is kinetic energy?',
  });
  expect(screen.getByLabelText('Research question')).toHaveProperty('value', '');
  expect(screen.getAllByLabelText('Research answer message')).toHaveLength(1);
  fetchList.mockResolvedValue({ items: [conversation], nextOffset: null });
  fetchHistory.mockResolvedValue({
    conversation,
    messages: [turn.user, turn.assistant],
    nextBeforeSequence: null,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh history' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  const previousReads = fetchHistory.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  await waitFor(() =>
    expect(fetchHistory.mock.calls.length).toBeGreaterThan(previousReads),
  );
  expect(screen.getAllByLabelText('Research answer message')).toHaveLength(1);
  view.unmount();
});
it('loads saved history and paginates complete turns and conversations', async () => {
  const older = { ...turn.user, id: 'older', sequence: 1, content: 'Older question' };
  fetchList.mockImplementation(async (_workspace, offset) =>
    offset === 0
      ? { items: [conversation], nextOffset: 25 }
      : {
          items: [{ ...conversation, id: 'other', title: 'Other conversation' }],
          nextOffset: null,
        },
  );
  fetchHistory.mockImplementation(async (_workspace, _id, before) => ({
    conversation,
    messages:
      before === null
        ? [
            { ...turn.user, sequence: 3 },
            { ...turn.assistant, sequence: 4 },
          ]
        : [older],
    nextBeforeSequence: before === null ? 3 : null,
  }));
  panel();
  expect(await screen.findByText(turn.user.content)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
  expect(await screen.findByText('Older question')).not.toBeNull();
  expect(fetchHistory).toHaveBeenCalledWith(
    'w1',
    conversation.id,
    3,
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: 'More conversations' }));
  expect(
    await screen.findByRole('option', { name: 'Other conversation' }),
  ).not.toBeNull();
  expect(fetchList).toHaveBeenCalledWith('w1', 25, expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText('Conversation'), { target: { value: 'other' } });
  await waitFor(() =>
    expect(fetchHistory).toHaveBeenCalledWith(
      'w1',
      'other',
      null,
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(screen.getByLabelText('Research question')).toHaveProperty('value', '');
});
it('shows retrieval progress and answer preview, then keeps only the complete answer', async () => {
  let finish!: (result: api.ConversationTurn) => void;
  stream.mockImplementation(
    (_workspace, _id, _question, onEvent) =>
      new Promise((resolve) => {
        finish = resolve;
        onEvent({
          event: 'started',
          data: { conversationId: conversation.id, user: turn.user },
        });
      }),
  );
  panel();
  await submit();
  expect(await screen.findByText('Searching authorized sources…')).not.toBeNull();
  expect(screen.getByLabelText('Research question')).toHaveProperty('disabled', true);
  const onEvent = stream.mock.calls[0]![3];
  act(() => onEvent({ event: 'retrieval_completed', data: { chunkCount: 2 } }));
  expect(screen.getByText('Preparing a grounded answer…')).not.toBeNull();
  act(() => onEvent({ event: 'delta', data: { text: 'Complete answer preview' } }));
  expect(screen.getByLabelText('Answer preview').textContent).toBe(
    'Complete answer preview',
  );
  await act(async () => finish(turn));
  expect(screen.queryByLabelText('Answer preview')).toBeNull();
  expect(screen.getByRole('link', { name: '[S1] Lecture 5 · Page 38' })).not.toBeNull();
});
it('preserves an empty selection, selects only READY sources and displays explicit no-evidence answers', async () => {
  const emptyTurn: api.ConversationTurn = {
    ...turn,
    assistant: {
      ...turn.assistant,
      content: emptyFixture.answer,
      response: emptyFixture as QuestionResponse,
    },
  };
  stream.mockResolvedValue(emptyTurn);
  panel();
  fireEvent.click(screen.getByLabelText('Selected sources'));
  expect(screen.getByLabelText('Processing')).toHaveProperty('disabled', true);
  await submit();
  expect(await screen.findByText(emptyFixture.answer)).not.toBeNull();
  expect(stream.mock.calls[0]?.[2].selectedSourceIds).toEqual([]);
  fireEvent.click(screen.getByLabelText('Lecture'));
  await submit('Selected question');
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
  expect(stream.mock.calls[1]?.[2].selectedSourceIds).toEqual(['s1']);
  await waitFor(() =>
    expect(screen.getByLabelText('Research question')).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByLabelText('All workspace sources'));
});
it('retries a transient failure using the same request identity and no partial answer', async () => {
  stream
    .mockImplementationOnce(async (_w, _id, _q, onEvent) => {
      onEvent({ event: 'delta', data: { text: 'Transient preview' } });
      throw failure('AI_UNAVAILABLE');
    })
    .mockResolvedValueOnce(turn);
  panel();
  await submit();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Try again later',
  );
  expect(screen.queryByLabelText('Answer preview')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry answer' }));
  expect(
    await screen.findByRole('link', { name: '[S1] Lecture 5 · Page 38' }),
  ).not.toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
  expect(stream.mock.calls[1]?.[2]).toEqual(stream.mock.calls[0]?.[2]);
});
it('stops a stream, ignores its late result and safely retries after a disconnect', async () => {
  let finish!: (result: api.ConversationTurn) => void;
  stream
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new ApiTransportError('Disconnected'))
    .mockResolvedValueOnce(turn);
  panel();
  await submit();
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  const signal = stream.mock.calls[0]![4];
  fireEvent.click(screen.getByRole('button', { name: 'Stop answer' }));
  expect(signal.aborted).toBe(true);
  expect(await screen.findByText(/Stopped receiving the answer/)).not.toBeNull();
  await act(async () => finish(turn));
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry answer' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Disconnected');
  fireEvent.click(screen.getByRole('button', { name: 'Retry answer' }));
  expect(
    await screen.findByRole('link', { name: '[S1] Lecture 5 · Page 38' }),
  ).not.toBeNull();
});
it('clears private state across workspaces and after switching away from an active request', async () => {
  let finish!: (result: api.ConversationTurn) => void;
  stream.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = panel();
  await submit('Private question');
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  const signal = stream.mock.calls[0]![4];
  view.rerender(view.wrap('w2'));
  expect(signal.aborted).toBe(true);
  expect(screen.getByLabelText('Research question')).toHaveProperty('value', '');
  await act(async () => finish(turn));
  expect(screen.queryByRole('link')).toBeNull();
  await submit('Another private question');
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(stream.mock.calls[1]![4].aborted).toBe(true);
  await act(async () => finish(turn));
  expect(screen.queryByRole('link')).toBeNull();
});
it('handles local validation, source loading/errors and revoked history without displaying cached answers', async () => {
  const view = panel({ sources: [], loading: true, error: null });
  expect(screen.getByText('Loading sources for research…')).not.toBeNull();
  view.rerender(
    view.wrap('w1', { sources: [], loading: false, error: 'Sources unavailable' }),
  );
  expect(screen.getByRole('alert').textContent).toBe('Sources unavailable');
  view.rerender(view.wrap('w1', { sources: [], loading: false, error: null }));
  expect(screen.getByText('No ready sources are available yet.')).not.toBeNull();
  await submit('  ');
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Enter a question.',
  );
  expect(stream).not.toHaveBeenCalled();
  view.unmount();
  fetchList.mockResolvedValue({ items: [conversation], nextOffset: null });
  fetchHistory.mockResolvedValue({
    conversation,
    messages: [turn.user, turn.assistant],
    nextBeforeSequence: null,
  });
  panel();
  expect(
    await screen.findByRole('link', { name: '[S1] Lecture 5 · Page 38' }),
  ).not.toBeNull();
  fetchHistory.mockRejectedValue(failure('RESOURCE_NOT_FOUND'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Could not load history: Workspace was not found',
  );
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
    'disabled',
    true,
  );
});
it('renders pending/failed attempts and fails safely when conversations cannot be read', async () => {
  fetchList.mockResolvedValue({ items: [conversation], nextOffset: null });
  fetchHistory.mockResolvedValue({
    conversation,
    messages: [
      { ...turn.user, status: 'PENDING' },
      { ...turn.user, id: 'failed', status: 'FAILED' },
    ],
    nextBeforeSequence: null,
  });
  const view = panel();
  expect(await screen.findByText('Answer pending…')).not.toBeNull();
  expect(
    screen.getByText('No complete answer was saved for this attempt.'),
  ).not.toBeNull();
  view.unmount();
  fetchList.mockRejectedValue(failure('RESOURCE_NOT_FOUND'));
  panel();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Could not load conversations: Workspace was not found',
  );
  expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
    'disabled',
    true,
  );
});
it('abandons creation safely and handles a request with no relevant passages', async () => {
  let finishCreate!: (value: api.Conversation) => void;
  create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCreate = resolve;
      }),
  );
  const view = panel();
  await submit();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finishCreate(conversation));
  expect(stream).not.toHaveBeenCalled();
  stream.mockImplementationOnce(async (_w, _id, _q, onEvent) => {
    onEvent({ event: 'retrieval_completed', data: { chunkCount: 0 } });
    throw failure('RESOURCE_NOT_FOUND');
  });
  panel();
  await submit();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Workspace was not found',
  );
  expect(screen.queryByRole('button', { name: 'Retry answer' })).toBeNull();
});

it('shows quota timing without automatically resending the preserved research question', async () => {
  const limited = new ApiError({
    type: 'about:blank',
    title: 'Request limit reached',
    status: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    rawCode: 'RATE_LIMIT_EXCEEDED',
    detail: 'The request limit for this operation has been reached.',
    retryAfterSeconds: 45,
    quotaCategory: 'LLM',
  });
  stream.mockRejectedValue(limited);
  const view = panel();
  await submit('A claim worth checking');
  await screen.findByText(/Try again in 45 seconds/);
  expect(screen.getByLabelText('Research question')).toHaveProperty(
    'value',
    'A claim worth checking',
  );
  expect(screen.queryByRole('button', { name: 'Retry answer' })).toBeNull();
  expect(stream).toHaveBeenCalledTimes(1);
  view.unmount();
});
