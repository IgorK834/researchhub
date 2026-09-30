/** @jest-environment jsdom */
import { ApiError, ApiTransportError } from '../../../shared/api';
import {
  createConversation,
  fetchConversations,
  fetchConversationHistory,
  streamConversationQuestion,
  type ConversationTurn,
} from './conversationApi';
import completed from '../../../../../contracts/ai/conversations/v1/completed.json';
import started from '../../../../../contracts/ai/conversations/v1/started.json';

const originalFetch = globalThis.fetch;
function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function stream(events: readonly { event: string; data: unknown }[]): Response {
  const chunks = events.map((event) =>
    new TextEncoder().encode(
      `event:${event.event}\ndata:${JSON.stringify(event.data)}\n\n`,
    ),
  );
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  document.cookie = 'XSRF-TOKEN=; Max-Age=0';
});
it('loads bounded workspace history and creates a conversation with session CSRF', async () => {
  document.cookie = 'XSRF-TOKEN=csrf';
  globalThis.fetch = jest.fn().mockResolvedValue(json({}));
  const signal = new AbortController().signal;
  await createConversation('w/1', 'Title', signal);
  await createConversation('w1', 'Title');
  await fetchConversations('w/1', 25, signal);
  await fetchConversations('w1');
  await fetchConversationHistory('w/1', 'c/1', 5, signal);
  await fetchConversationHistory('w1', 'c1');
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/ai/conversations',
    expect.objectContaining({
      method: 'POST',
      signal,
      body: '{"title":"Title"}',
      headers: expect.objectContaining({ 'X-XSRF-TOKEN': 'csrf' }),
    }),
  );
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/ai/conversations?offset=25',
    expect.objectContaining({ signal }),
  );
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/ai/conversations/c%2F1?beforeSequence=5',
    expect.objectContaining({ signal }),
  );
});
it('streams progress and validated completion while keeping the retry identity in the POST body', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(json(undefined, 204))
    .mockResolvedValueOnce(
      stream([
        { event: 'started', data: started },
        { event: 'retrieval_completed', data: { chunkCount: 1 } },
        { event: 'delta', data: { text: 'Lecture' } },
        { event: 'completed', data: completed },
      ]),
    );
  const question = { clientRequestId: 'request', question: 'Q', selectedSourceIds: [] };
  const events: string[] = [];
  const result = await streamConversationQuestion(
    'w/1',
    'c/1',
    question,
    (event) => events.push(event.event),
    new AbortController().signal,
  );
  expect(result).toEqual(completed as unknown as ConversationTurn);
  expect(events).toEqual(['started', 'retrieval_completed', 'delta', 'completed']);
  expect(globalThis.fetch).toHaveBeenLastCalledWith(
    '/api/workspaces/w%2F1/ai/conversations/c%2F1/messages/stream',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(question),
      headers: expect.objectContaining({ Accept: 'text/event-stream' }),
    }),
  );
});
it.each([
  {
    event: 'error',
    data: { code: 'AI_UNAVAILABLE', detail: 'Try later', retryable: true },
  },
  {
    event: 'error',
    data: { code: 'AI_OUTPUT_INVALID', detail: 'Invalid output', retryable: false },
  },
])('terminates with a safe machine-readable error: %j', async (event) => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(json(undefined, 204))
    .mockResolvedValueOnce(stream([event]));
  await expect(
    streamConversationQuestion(
      'w',
      'c',
      { clientRequestId: 'r', question: 'Q' },
      () => undefined,
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(ApiError);
});
it.each([
  { event: 'started', data: { conversationId: 'c', user: null } },
  { event: 'retrieval_completed', data: { chunkCount: -1 } },
  { event: 'delta', data: { text: 'x'.repeat(1001) } },
  {
    event: 'completed',
    data: { ...completed, assistant: { ...completed.assistant, status: 'PENDING' } },
  },
  {
    event: 'error',
    data: { code: 'SECRET_VENDOR_CODE', detail: 'Private', retryable: false },
  },
  { event: 'unknown', data: {} },
  { event: 'delta', data: null },
])('fails closed on malformed events: %j', async (event) => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(json(undefined, 204))
    .mockResolvedValueOnce(stream([event]));
  await expect(
    streamConversationQuestion(
      'w',
      'c',
      { clientRequestId: 'r', question: 'Q' },
      () => undefined,
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(ApiTransportError);
});
it('treats EOF without completion as an abandoned connection rather than a saved answer', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(json(undefined, 204))
    .mockResolvedValueOnce(stream([{ event: 'delta', data: { text: 'Partial' } }]));
  await expect(
    streamConversationQuestion(
      'w',
      'c',
      { clientRequestId: 'r', question: 'Q' },
      () => undefined,
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(ApiTransportError);
});
