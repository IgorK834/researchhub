/** @jest-environment jsdom */
import { ApiError } from '../../../shared/api';
import { askWorkspaceQuestion } from './questionApi';

const originalFetch = globalThis.fetch;
function response(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  document.cookie = 'XSRF-TOKEN=; Max-Age=0';
});

it('uses workspace scope, CSRF and cancellation without accepting client model/context fields', async () => {
  document.cookie = 'XSRF-TOKEN=csrf';
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(undefined, 204))
    .mockResolvedValueOnce(response({ status: 'SUPPORTED' }));
  const question = { question: 'What is kinetic energy?', selectedSourceIds: ['s1'] };
  const signal = new AbortController().signal;
  expect(await askWorkspaceQuestion('w/1', question, signal)).toEqual({
    status: 'SUPPORTED',
  });
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    1,
    '/api/auth/csrf',
    expect.objectContaining({ method: 'GET' }),
  );
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    2,
    '/api/workspaces/w%2F1/ai/questions',
    expect.objectContaining({
      method: 'POST',
      signal,
      body: JSON.stringify(question),
      headers: expect.objectContaining({ 'X-XSRF-TOKEN': 'csrf' }),
    }),
  );
});
it('preserves omitted and empty selections as different requests', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(response({}));
  await askWorkspaceQuestion('w1', { question: 'Q' });
  await askWorkspaceQuestion('w1', { question: 'Q', selectedSourceIds: [] });
  expect((globalThis.fetch as jest.Mock).mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ body: '{"question":"Q"}' }),
  );
  expect((globalThis.fetch as jest.Mock).mock.calls[1]?.[1]).not.toHaveProperty('signal');
  expect((globalThis.fetch as jest.Mock).mock.calls[3]?.[1]).toEqual(
    expect.objectContaining({ body: '{"question":"Q","selectedSourceIds":[]}' }),
  );
});
it('preserves authorization and budget errors from the shared transport', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(undefined, 204))
    .mockResolvedValueOnce(
      response(
        {
          status: 404,
          code: 'RESOURCE_NOT_FOUND',
          title: 'Not found',
          detail: 'Source was not found',
        },
        404,
      ),
    );
  await expect(
    askWorkspaceQuestion('w1', { question: 'Q', selectedSourceIds: ['other'] }),
  ).rejects.toBeInstanceOf(ApiError);
});
