/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCanvasConversation } from './useCanvasConversation';
import * as api from './conversationApi';
jest.mock('./conversationApi');
const state = {
  schemaVersion: '1.0',
  turnId: 't',
  conversationId: 'c',
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
} as const;
const scope = { sourceVersionIds: [], analysisOutputs: [] };
function setup(id: string | null = null) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCanvasConversation('w', id), { wrapper });
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.fetchConversationHistory).mockResolvedValue({
    conversation: { id: 'c' } as api.Conversation,
    messages: [],
    nextBeforeSequence: null,
    turns: [],
  });
  jest.mocked(api.startCanvasConversation).mockResolvedValue(state);
  jest.mocked(api.sendCanvasTurn).mockResolvedValue(state);
});
it('does nothing when no retry or cancellable operation exists', async () => {
  const { result } = setup();
  await act(async () => {
    expect(await result.current.retry()).toBe(false);
    await result.current.cancel();
  });
  expect(api.startCanvasConversation).not.toHaveBeenCalled();
  expect(api.cancelCanvasTurn).not.toHaveBeenCalled();
  const existing = setup('c');
  await act(async () => existing.result.current.cancel());
  expect(api.cancelCanvasTurn).not.toHaveBeenCalled();
});
it('fences double submits and keeps the accepted server work independent of component lifetime', async () => {
  let finish!: (value: api.CanvasTurnState) => void;
  jest.mocked(api.startCanvasConversation).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, unmount } = setup();
  let send!: Promise<boolean>;
  await act(async () => {
    send = result.current.send('ctx', 'First', scope);
    expect(await result.current.send('ctx', 'Duplicate', scope)).toBe(false);
  });
  expect(api.startCanvasConversation).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(state);
    expect(await send).toBe(true);
  });
  expect(result.current.conversationId).toBe('c');
  await act(async () => {
    await result.current.send('ctx', 'Second', scope);
  });
  expect(api.sendCanvasTurn).toHaveBeenCalledWith(
    'w',
    'c',
    expect.objectContaining({ instruction: 'Second', replyToMessageId: null }),
  );
  unmount();
  expect(api.cancelCanvasTurn).not.toHaveBeenCalled();
});
it('retries an existing turn with its exact request identity and captures cancellation failures', async () => {
  jest.mocked(api.sendCanvasTurn).mockRejectedValueOnce(new Error('timeout'));
  const { result } = setup('c');
  await act(async () => {
    expect(await result.current.send('ctx', 'Continue', scope, 'm', 'proposal')).toBe(
      false,
    );
  });
  expect(result.current.retryAvailable).toBe(true);
  await act(async () => {
    expect(await result.current.retry()).toBe(true);
  });
  expect(jest.mocked(api.sendCanvasTurn).mock.calls[0]).toEqual(
    jest.mocked(api.sendCanvasTurn).mock.calls[1],
  );
  jest.mocked(api.fetchConversationHistory).mockResolvedValue({
    conversation: { id: 'c' } as api.Conversation,
    messages: [],
    nextBeforeSequence: null,
    turns: [state],
  });
  await act(async () => {
    await result.current.history.refetch();
  });
  await waitFor(() => expect(result.current.pending).toEqual(state));
  jest.mocked(api.cancelCanvasTurn).mockRejectedValue(new Error('Cancellation denied'));
  await act(async () => result.current.cancel());
  expect((result.current.error as Error).message).toBe('Cancellation denied');
});
