/** @jest-environment jsdom */
import { fetchCitationFragment } from './citationEvidence';
import { apiClient } from '../../../shared/api';
import type { Citation } from './generationApi';
jest.mock('../../../shared/api', () => ({ apiClient: { get: jest.fn() } }));
const get = jest.mocked(apiClient.get);
const citation: Citation = {
  workspaceId: 'w/1',
  sourceId: 's/1',
  sourceVersionId: 'v1',
  chunkId: 'chunk/1',
  processingVersion: 'version:old',
  contentHash: 'hash',
  pageStart: 2,
  pageEnd: 2,
  sectionTitle: null,
  spans: [],
};
beforeEach(() => jest.resetAllMocks());
it('reads the exact cited processing version through the authorized endpoint and forwards cancellation', async () => {
  const fragment = { ...citation, content: 'Original passage' };
  get.mockResolvedValue(fragment);
  const signal = new AbortController().signal;
  expect(await fetchCitationFragment(citation, signal)).toEqual(fragment);
  expect(get).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/sources/s%2F1/retrieval/chunks/chunk%2F1?processingVersion=version%3Aold',
    { signal },
  );
});
it.each([
  'workspaceId',
  'sourceId',
  'sourceVersionId',
  'chunkId',
  'processingVersion',
  'contentHash',
  'content',
])('rejects a mismatched %s without using a newer extraction', async (field) => {
  get.mockResolvedValue({
    ...citation,
    content: 'Passage',
    [field]: field === 'content' ? null : 'different',
  });
  await expect(fetchCitationFragment(citation)).rejects.toThrow('does not match');
  expect(get).toHaveBeenCalledTimes(1);
});
it('preserves server access errors', async () => {
  get.mockRejectedValue(new Error('Unavailable'));
  await expect(fetchCitationFragment(citation)).rejects.toThrow('Unavailable');
});
