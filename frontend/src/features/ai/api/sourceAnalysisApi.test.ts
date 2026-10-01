import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import {
  compareSources,
  fetchSourceAnalysis,
  findPotentialDisagreements,
} from './sourceAnalysisApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
const get = jest.mocked(apiClient.get),
  post = jest.mocked(apiClient.post);
beforeEach(() => jest.resetAllMocks());
test('scoped transports preserve explicit sources, criteria, baseline and CSRF', async () => {
  const command = {
    selectedSourceIds: ['s1', 's2'],
    criteria: ['method'],
    instruction: null,
  };
  post.mockResolvedValue({ id: 'a' });
  await expect(compareSources('w/1', command)).resolves.toEqual({ id: 'a' });
  expect(get).toHaveBeenCalledWith(CSRF_PRIMING_PATH);
  expect(post).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/ai/source-analyses/comparisons',
    { body: command },
  );
  await fetchSourceAnalysis('w/1', 'a/1');
  expect(get).toHaveBeenLastCalledWith('/api/workspaces/w%2F1/ai/source-analyses/a%2F1');
  await findPotentialDisagreements('w/1', 'a/1', 'Assess datasets');
  expect(post).toHaveBeenLastCalledWith(
    '/api/workspaces/w%2F1/ai/source-analyses/a%2F1/disagreements',
    { body: { instruction: 'Assess datasets' } },
  );
});
test('safe failures propagate without retried model calls', async () => {
  post.mockRejectedValue(new Error('Unavailable'));
  await expect(findPotentialDisagreements('w', 'a', null)).rejects.toThrow('Unavailable');
  expect(post).toHaveBeenCalledTimes(1);
});
