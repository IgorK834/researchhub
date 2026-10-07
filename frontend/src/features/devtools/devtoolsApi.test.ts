import { apiClient } from '../../shared/api';
import { loadOverview, loadTrace } from './devtoolsApi';
jest.mock('../../shared/api', () => ({ apiClient: { get: jest.fn() } }));
test('bounded read-only API uses encoded workspace/trace paths and forwards cancellation', async () => {
  jest.mocked(apiClient.get).mockResolvedValue({});
  const signal = new AbortController().signal;
  await loadOverview('w/?', 30, signal);
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w%2F%3F/devtools/ai?days=30',
    { signal },
  );
  await loadTrace('w1', 't/?', signal);
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w1/devtools/ai/traces/t%2F%3F',
    { signal },
  );
  await loadOverview('w1', 7);
  await loadTrace('w1', 't1');
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w1/devtools/ai/traces/t1',
    { signal: undefined },
  );
});
