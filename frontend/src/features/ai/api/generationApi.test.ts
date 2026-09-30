/** @jest-environment jsdom */
import { ApiError } from '../../../shared/api';
import {
  generateStructured,
  fetchGeneration,
  fetchModelMetadata,
  citationPath,
  validateCitationVersion,
  type Citation,
} from './generationApi';

const originalFetch = globalThis.fetch;
const citation: Citation = {
  workspaceId: 'w/1',
  sourceId: 's/1',
  sourceVersionId: null,
  chunkId: 'a',
  processingVersion: 'retrieval-1:x',
  contentHash: 'hash',
  pageStart: 2,
  pageEnd: 2,
  sectionTitle: 'Theory',
  spans: [{ unitId: 'unit/2', characterStart: 10, characterEnd: 20 }],
};
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
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

it('primes CSRF and sends bounded feature input through the shared transport', async () => {
  document.cookie = 'XSRF-TOKEN=test-csrf';
  const signal = new AbortController().signal;
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(undefined, 204))
    .mockResolvedValueOnce(response({ result: 'test' }));
  const command = {
    instruction: 'Summarize',
    evidence: [{ sourceId: 's1', chunkId: 'a', processingVersion: 'v1' }],
  };
  expect(await generateStructured('w/1', command, signal)).toEqual({ result: 'test' });
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    1,
    '/api/auth/csrf',
    expect.objectContaining({ method: 'GET' }),
  );
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    2,
    '/api/workspaces/w%2F1/ai/generations',
    expect.objectContaining({
      method: 'POST',
      signal,
      body: JSON.stringify(command),
      headers: expect.objectContaining({ 'X-XSRF-TOKEN': 'test-csrf' }),
    }),
  );
  globalThis.fetch = jest.fn().mockResolvedValue(response({}));
  await generateStructured('w1', command);
  expect((globalThis.fetch as jest.Mock).mock.calls[1]?.[1]).not.toHaveProperty('signal');
});
it('scopes saved responses, model metadata and citation validation to a workspace', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(response({ provider: 'deterministic' }));
  const signal = new AbortController().signal;
  await fetchGeneration('w/1', 'r/1', signal);
  await fetchGeneration('w1', 'r1');
  await fetchModelMetadata('w1');
  await validateCitationVersion('w/1', 's/1', 'v:1', signal);
  await validateCitationVersion('w1', 's1', 'v1');
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    1,
    '/api/workspaces/w%2F1/ai/generations/r%2F1',
    expect.objectContaining({ method: 'GET', signal }),
  );
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    3,
    '/api/workspaces/w1/ai/model',
    expect.objectContaining({ method: 'GET' }),
  );
  expect(globalThis.fetch).toHaveBeenNthCalledWith(
    4,
    '/api/workspaces/w%2F1/sources/s%2F1/retrieval?processingVersion=v%3A1',
    expect.objectContaining({ method: 'GET', signal }),
  );
});
it.each([
  ['AI_UNAVAILABLE', 503],
  ['AI_REFUSED', 422],
  ['AI_OUTPUT_INVALID', 502],
  ['AI_PROVIDER_ERROR', 502],
  ['AI_CONTEXT_TOO_LARGE', 413],
])('preserves safe application error %s', async (code, status) => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(undefined, 204))
    .mockResolvedValueOnce(
      response({ status, code, detail: 'Safe error', title: 'Model error' }, status),
    );
  try {
    await generateStructured('w1', { instruction: 'test', evidence: [] });
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  }
});
it('keeps the cited retrieval version, source unit and page in links', () => {
  expect(citationPath(citation)).toBe(
    '/app/workspaces/w%2F1/sources/s%2F1?processingVersion=retrieval-1%3Ax&unit=unit%2F2&page=2',
  );
  expect(citationPath({ ...citation, spans: [], pageStart: null })).toBe(
    '/app/workspaces/w%2F1/sources/s%2F1?processingVersion=retrieval-1%3Ax',
  );
});
