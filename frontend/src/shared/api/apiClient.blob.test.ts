/** @jest-environment jsdom */
import { apiClient, ApiError, ApiTransportError, apiCredentials } from './index';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
it('uses the same authenticated GET policy and cancellation for binary artifacts', async () => {
  const blob = new Blob(['chart'], { type: 'image/svg+xml' });
  const signal = new AbortController().signal;
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
  globalThis.fetch = fetchMock;
  await expect(apiClient.getBlob('/api/artifact', { signal })).resolves.toBe(blob);
  expect(fetchMock).toHaveBeenCalledWith('/api/artifact', {
    method: 'GET',
    headers: { Accept: 'image/png, image/svg+xml' },
    signal,
    credentials: apiCredentials,
  });
});
it('preserves ProblemDetail and fails safely on unreadable binary responses', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    statusText: 'Not found',
    headers: { get: () => 'application/problem+json' },
    text: () =>
      Promise.resolve(
        JSON.stringify({ status: 404, code: 'RESOURCE_NOT_FOUND', title: 'Not found' }),
      ),
  });
  await expect(apiClient.getBlob('/api/artifact')).rejects.toBeInstanceOf(ApiError);
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.reject(new Error('disconnected')),
  });
  await expect(apiClient.getBlob('/api/artifact')).rejects.toBeInstanceOf(
    ApiTransportError,
  );
});
