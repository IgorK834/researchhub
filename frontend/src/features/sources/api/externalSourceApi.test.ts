import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import {
  fetchExternalAvailability,
  fetchExternalSources,
  searchExternalSources,
  recordExternalSource,
} from './externalSourceApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
beforeEach(() => jest.clearAllMocks());
it('reads only workspace-owned availability and bounded recorded references', async () => {
  const signal = new AbortController().signal;
  await fetchExternalAvailability('w/1', signal);
  await fetchExternalSources('w/1', 2, signal);
  await fetchExternalSources('w1');
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/external-sources/availability',
    { signal },
  );
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/external-sources?page=2&size=30',
    { signal },
  );
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w1/external-sources?page=0&size=30',
    { signal: undefined },
  );
});
it('sends explicit per-request consent and records server-issued identifiers after CSRF priming', async () => {
  const signal = new AbortController().signal;
  await searchExternalSources('w1', 'solar', true, signal);
  await recordExternalSource('w1', 'search1', 'hit1');
  expect(apiClient.get).toHaveBeenCalledWith(CSRF_PRIMING_PATH);
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/w1/external-sources/search',
    { body: { query: 'solar', externalSearchEnabled: true }, signal },
  );
  expect(apiClient.post).toHaveBeenCalledWith('/api/workspaces/w1/external-sources', {
    body: { searchId: 'search1', resultId: 'hit1' },
  });
});
it('preserves disabled consent and refuses writes if CSRF priming fails', async () => {
  await searchExternalSources('w1', 'solar', false);
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/w1/external-sources/search',
    { body: { query: 'solar', externalSearchEnabled: false }, signal: undefined },
  );
  jest.mocked(apiClient.get).mockRejectedValueOnce(new Error('Unauthenticated'));
  await expect(recordExternalSource('w1', 'search1', 'hit1')).rejects.toThrow(
    'Unauthenticated',
  );
});
